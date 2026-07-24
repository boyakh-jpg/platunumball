-- Persist the complete shared room-edit payload atomically.
-- Recruiting edits retain participants; confirmed-match edits reset pregame agreement.

create or replace function public.rankball_room_rule_integer(
  p_source jsonb,
  p_key text,
  p_fallback integer,
  p_min integer,
  p_max integer
)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
  raw_value text;
  parsed_value integer;
begin
  if not coalesce(p_source, '{}'::jsonb) ? p_key then
    return greatest(p_min, least(p_max, p_fallback));
  end if;
  raw_value := p_source->>p_key;
  if coalesce(raw_value, '') !~ '^-?[0-9]+$' then
    raise exception 'invalid_room_rule_integer:%', p_key using errcode = '22023';
  end if;
  parsed_value := raw_value::integer;
  return greatest(p_min, least(p_max, parsed_value));
end;
$$;

create or replace function public.rankball_room_rule_boolean(
  p_source jsonb,
  p_key text,
  p_fallback boolean
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  raw_value text;
begin
  if not coalesce(p_source, '{}'::jsonb) ? p_key then
    return p_fallback;
  end if;
  raw_value := lower(coalesce(p_source->>p_key, ''));
  if raw_value in ('true', 't', '1', 'yes', 'on') then return true; end if;
  if raw_value in ('false', 'f', '0', 'no', 'off') then return false; end if;
  raise exception 'invalid_room_rule_boolean:%', p_key using errcode = '22023';
end;
$$;

create or replace function public.rankball_apply_room_rule_patch(
  p_current_rules jsonb,
  p_patch jsonb,
  p_mode text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  source_rules jsonb;
  five_on_five boolean := p_mode = '5v5';
  end_condition text;
  period_count integer;
  period_minutes integer;
  clock_mode text;
  last_period_stop_minutes integer;
  meeting_point text;
  win_by_two boolean;
begin
  if p_patch is not null and jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_room_rule_patch' using errcode = '22023';
  end if;
  source_rules := coalesce(p_current_rules, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);

  end_condition := coalesce(nullif(source_rules->>'endCondition', ''), case when five_on_five then 'time' else 'target_or_time' end);
  if end_condition not in ('time', 'target_or_time') then
    raise exception 'invalid_room_end_condition' using errcode = '22023';
  end if;

  period_count := public.rankball_room_rule_integer(source_rules, 'periodCount', case when five_on_five then 4 else 1 end, 1, 4);
  if period_count not in (1, 2, 4) then
    raise exception 'invalid_room_period_count' using errcode = '22023';
  end if;
  period_minutes := public.rankball_room_rule_integer(source_rules, 'periodMinutes', case when five_on_five then 10 else 12 end, 1, 60);

  clock_mode := coalesce(nullif(source_rules->>'clockMode', ''), case when five_on_five then 'stopped' else 'running' end);
  if clock_mode not in ('running', 'stopped') then
    raise exception 'invalid_room_clock_mode' using errcode = '22023';
  end if;
  last_period_stop_minutes := case
    when clock_mode = 'running'
      then public.rankball_room_rule_integer(source_rules, 'lastPeriodStopMinutes', 0, 0, period_minutes)
    else 0
  end;

  meeting_point := left(btrim(coalesce(source_rules->>'meetingPoint', '')), 120);
  if char_length(meeting_point) < 2 then
    raise exception 'room_meeting_point_required' using errcode = '23514';
  end if;
  win_by_two := end_condition = 'target_or_time'
    and public.rankball_room_rule_boolean(source_rules, 'winByTwo', not five_on_five);

  return coalesce(p_current_rules, '{}'::jsonb) || jsonb_build_object(
    'endCondition', end_condition,
    'targetScore', public.rankball_room_rule_integer(source_rules, 'targetScore', 21, 7, 99),
    'periodCount', period_count,
    'periodMinutes', period_minutes,
    'periodBreakMinutes', public.rankball_room_rule_integer(source_rules, 'periodBreakMinutes', 2, 0, 30),
    'halftimeMinutes', public.rankball_room_rule_integer(source_rules, 'halftimeMinutes', case when five_on_five then 10 else 5 end, 0, 30),
    'overtimeMinutes', public.rankball_room_rule_integer(source_rules, 'overtimeMinutes', case when five_on_five then 5 else 3 end, 1, 20),
    'clockMode', clock_mode,
    'lastPeriodStopMinutes', last_period_stop_minutes,
    'timeLimit', period_count * period_minutes,
    'ball', left(coalesce(nullif(btrim(source_rules->>'ball'), ''), '7호 공'), 40),
    'winByTwo', win_by_two,
    'attackRule', left(coalesce(nullif(btrim(source_rules->>'attackRule'), ''), '득점 후 공격권 교대'), 120),
    'foulRule', left(coalesce(nullif(btrim(source_rules->>'foulRule'), ''), '파울 콜 즉시 중단, 공격권 유지'), 120),
    'meetingPoint', meeting_point,
    'meetBeforeMinutes', public.rankball_room_rule_integer(source_rules, 'meetBeforeMinutes', 15, 0, 60)
  );
end;
$$;

create or replace function public.rankball_recruiting_room_update_action(
  p_actor_profile_id text,
  p_post_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  current_post public.recruiting_posts%rowtype;
  next_side_capacity integer;
  next_bench_capacity integer;
  mmr_range_mode text;
  next_rating_scale numeric;
  next_court_id text;
  next_court_name text;
  next_court_region text;
  next_rules jsonb;
  next_room_state jsonb;
  rule_revision integer;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'invalid_room_update_patch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select * into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;
  if current_post.status <> 'open' or current_post.confirmed_at is not null then
    raise exception 'recruiting_room_edit_locked' using errcode = '23514';
  end if;
  if current_post.player_id is distinct from safe_actor_id then
    raise exception 'recruiting_owner_required' using errcode = '42501';
  end if;

  if patch ? 'sideCapacity' and coalesce(patch->>'sideCapacity', '') !~ '^[0-9]+$' then
    raise exception 'invalid_side_capacity' using errcode = '22023';
  end if;
  next_side_capacity := coalesce((patch->>'sideCapacity')::integer, current_post.side_capacity);
  if next_side_capacity not in (1, 2, 3, 5) then
    raise exception 'unsupported_match_mode' using errcode = '23514';
  end if;

  if patch ? 'benchCapacity' and coalesce(patch->>'benchCapacity', '') !~ '^[0-3]$' then
    raise exception 'invalid_bench_capacity' using errcode = '22023';
  end if;
  next_bench_capacity := coalesce((patch->>'benchCapacity')::integer, current_post.bench_capacity);

  if public.rankball_recruiting_side_active_count(current_post, 'teamA') > next_side_capacity
     or public.rankball_recruiting_side_active_count(current_post, 'teamB') > next_side_capacity then
    raise exception 'recruiting_side_capacity_below_roster' using errcode = '23514';
  end if;
  if public.rankball_recruiting_side_bench_count(safe_post_id, 'teamA') > next_bench_capacity
     or public.rankball_recruiting_side_bench_count(safe_post_id, 'teamB') > next_bench_capacity then
    raise exception 'recruiting_bench_capacity_below_roster' using errcode = '23514';
  end if;

  mmr_range_mode := case
    when patch->>'mmrRangeMode' in ('narrow', 'normal', 'wide') then patch->>'mmrRangeMode'
    when coalesce(current_post.room_state->>'mmrRangeMode', current_post.rules->>'mmrRangeMode') in ('narrow', 'normal', 'wide')
      then coalesce(current_post.room_state->>'mmrRangeMode', current_post.rules->>'mmrRangeMode')
    else 'normal'
  end;
  next_rating_scale := case
    when current_post.ranked = false then 1
    when mmr_range_mode = 'narrow' then 1.1
    when mmr_range_mode = 'wide' then 0.8
    else 1
  end;

  next_court_id := case when patch ? 'courtId' then nullif(btrim(patch->>'courtId'), '') else current_post.court_id end;
  if next_court_id is null then raise exception 'invalid_room_court' using errcode = '23514'; end if;
  select court.id, court.name, coalesce(court.region_key, court.region)
  into next_court_id, next_court_name, next_court_region
  from public.courts court
  join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
  where court.id = next_court_id;
  if next_court_name is null then raise exception 'court_not_found' using errcode = 'P0002'; end if;

  next_rules := public.rankball_apply_room_rule_patch(
    coalesce(current_post.rules, '{}'::jsonb),
    patch,
    next_side_capacity::text || 'v' || next_side_capacity::text
  );
  rule_revision := case
    when coalesce(current_post.room_state->>'ruleRevision', '') ~ '^[0-9]+$'
      then (current_post.room_state->>'ruleRevision')::integer + 1
    else 1
  end;
  next_room_state := coalesce(current_post.room_state, '{}'::jsonb) || jsonb_build_object(
    'mmrRangeMode', mmr_range_mode,
    'ruleRevision', rule_revision,
    'ruleChangedAt', now_at
  );

  update public.recruiting_posts
  set mode = next_side_capacity::text || 'v' || next_side_capacity::text,
      side_capacity = next_side_capacity,
      bench_capacity = next_bench_capacity,
      court_id = next_court_id,
      court_name = next_court_name,
      region = coalesce(nullif(next_court_region, ''), current_post.region),
      rating_scale = next_rating_scale,
      rules = next_rules || jsonb_build_object(
        'sideCapacity', next_side_capacity,
        'benchCapacity', next_bench_capacity,
        'mmrRangeMode', mmr_range_mode,
        'ratingScale', next_rating_scale
      ),
      memo = case when patch ? 'memo' then left(coalesce(patch->>'memo', ''), 500) else memo end,
      stakes = case when patch ? 'stakes' then left(coalesce(patch->>'stakes', ''), 500) else stakes end,
      room_state = next_room_state,
      host_ready = true,
      updated_at = now_at
  where id = safe_post_id;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type,
    recruiting_post_id, payload, created_at, updated_at
  )
  select
    'notice-recruiting-rules-' || safe_post_id || '-' || rule_revision::text || '-' || profile.id,
    profile.id,
    profile.id,
    '방 정보 변경',
    current_post.title || '의 경기 규칙이 변경되었습니다.',
    'match',
    'recruiting_rules_changed',
    safe_post_id,
    jsonb_build_object(
      'targetUserId', profile.id,
      'recruitingPostId', safe_post_id,
      'ruleRevision', rule_revision,
      'actionRequired', false
    ),
    now_at,
    now_at
  from public.profiles profile
  where profile.id <> safe_actor_id
    and public.rankball_recruiting_is_related(current_post, profile.id)
  on conflict (id) do update set
    body = excluded.body,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'action', 'updateRecruitingRoomRules',
    'postId', safe_post_id,
    'ruleRevision', rule_revision,
    'participantsRetained', true,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_match_room_update_action(
  p_actor_profile_id text,
  p_match_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  current_match public.matches%rowtype;
  next_side_capacity integer;
  next_bench_capacity integer;
  active_a_count integer;
  active_b_count integer;
  reserve_a_count integer;
  reserve_b_count integer;
  next_court_id text;
  next_court_name text;
  next_court_region text;
  next_rules jsonb;
  rule_revision integer;
  convert_to_player boolean;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'invalid_room_update_patch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status not in ('contract', 'agreed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_room_edit_locked' using errcode = '23514';
  end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
     and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
    raise exception 'match_room_operator_required' using errcode = '42501';
  end if;

  if patch ? 'sideCapacity' and coalesce(patch->>'sideCapacity', '') !~ '^[0-9]+$' then
    raise exception 'invalid_side_capacity' using errcode = '22023';
  end if;
  next_side_capacity := coalesce(
    (patch->>'sideCapacity')::integer,
    case when coalesce(current_match.rules->>'sideCapacity', '') ~ '^[0-9]+$'
      then (current_match.rules->>'sideCapacity')::integer
      else substring(current_match.mode from '^[0-9]+')::integer
    end,
    5
  );
  if next_side_capacity not in (1, 2, 3, 5) then
    raise exception 'unsupported_match_mode' using errcode = '23514';
  end if;

  if patch ? 'benchCapacity' and coalesce(patch->>'benchCapacity', '') !~ '^[0-3]$' then
    raise exception 'invalid_bench_capacity' using errcode = '22023';
  end if;
  next_bench_capacity := coalesce(
    (patch->>'benchCapacity')::integer,
    case when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-3]$'
      then (current_match.rules->>'benchCapacity')::integer
      else 2
    end
  );

  select
    count(*) filter (where player.side = 'teamA')::integer,
    count(*) filter (where player.side = 'teamB')::integer
  into active_a_count, active_b_count
  from (
    select distinct side, user_id
    from public.match_players
    where match_id = safe_match_id and side in ('teamA', 'teamB')
  ) player;
  reserve_a_count := jsonb_array_length(
    case when jsonb_typeof(current_match.reserve_players->'teamA') = 'array'
      then current_match.reserve_players->'teamA' else '[]'::jsonb end
  );
  reserve_b_count := jsonb_array_length(
    case when jsonb_typeof(current_match.reserve_players->'teamB') = 'array'
      then current_match.reserve_players->'teamB' else '[]'::jsonb end
  );
  if active_a_count > next_side_capacity or active_b_count > next_side_capacity then
    raise exception 'match_side_capacity_below_roster' using errcode = '23514';
  end if;
  if reserve_a_count > next_bench_capacity or reserve_b_count > next_bench_capacity then
    raise exception 'match_bench_capacity_below_roster' using errcode = '23514';
  end if;

  next_court_id := case when patch ? 'courtId' then nullif(btrim(patch->>'courtId'), '') else current_match.court_id end;
  if next_court_id is null then raise exception 'invalid_room_court' using errcode = '23514'; end if;
  select court.id, court.name, coalesce(court.region_key, court.region)
  into next_court_id, next_court_name, next_court_region
  from public.courts court
  join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
  where court.id = next_court_id;
  if next_court_name is null then raise exception 'court_not_found' using errcode = 'P0002'; end if;

  rule_revision := case
    when coalesce(current_match.rules->>'ruleRevision', '') ~ '^[0-9]+$'
      then (current_match.rules->>'ruleRevision')::integer + 1
    else 1
  end;
  next_rules := public.rankball_apply_room_rule_patch(
    coalesce(current_match.rules, '{}'::jsonb) - 'startedAt',
    patch,
    next_side_capacity::text || 'v' || next_side_capacity::text
  ) || jsonb_build_object(
    'sideCapacity', next_side_capacity,
    'benchCapacity', next_bench_capacity,
    'ruleRevision', rule_revision,
    'ruleChangedAt', now_at
  );
  if nullif(btrim(next_court_region), '') is not null then
    next_rules := next_rules || jsonb_build_object('region', next_court_region);
  end if;
  convert_to_player := patch->>'matchJoinMode' = 'player';

  update public.matches
  set mode = next_side_capacity::text || 'v' || next_side_capacity::text,
      status = 'agreed',
      court_id = next_court_id,
      court_name = next_court_name,
      rules = next_rules,
      memo = case when patch ? 'memo' then left(coalesce(patch->>'memo', ''), 500) else memo end,
      stakes = case when patch ? 'stakes' then left(coalesce(patch->>'stakes', ''), 500) else stakes end,
      team_a_id = case when convert_to_player then null else team_a_id end,
      team_b_id = case when convert_to_player then null else team_b_id end,
      attendance = jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
      agreed_at = null,
      updated_at = now_at
  where id = safe_match_id;

  if convert_to_player then
    update public.match_players set team_id = null where match_id = safe_match_id;
  end if;
  delete from public.match_agreements where match_id = safe_match_id;

  with related_profiles as (
    select distinct player.user_id as profile_id
    from public.match_players player
    where player.match_id = safe_match_id
    union
    select reserve.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.reserve_players->'teamA') = 'array'
        then current_match.reserve_players->'teamA' else '[]'::jsonb end
      ||
      case when jsonb_typeof(current_match.reserve_players->'teamB') = 'array'
        then current_match.reserve_players->'teamB' else '[]'::jsonb end
    ) reserve(value)
  )
  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type,
    match_id, payload, created_at, updated_at
  )
  select
    'notice-match-rules-' || substr(md5(safe_match_id || ':' || rule_revision::text || ':' || profile.id), 1, 24),
    profile.id,
    profile.id,
    '경기 정보 변경',
    current_match.title || '의 경기 규칙이 변경되었습니다. 경기 전 동의를 다시 확인해 주세요.',
    'match',
    'match_rules_changed',
    safe_match_id,
    jsonb_build_object(
      'targetUserId', profile.id,
      'matchId', safe_match_id,
      'ruleRevision', rule_revision,
      'actionRequired', true
    ),
    now_at,
    now_at
  from related_profiles related
  join public.profiles profile on profile.id = related.profile_id
  where profile.id <> safe_actor_id
  on conflict (id) do update set
    body = excluded.body,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'action', 'updateMatchRoomRules',
    'matchId', safe_match_id,
    'ruleRevision', rule_revision,
    'agreementsReset', true,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_room_rule_integer(jsonb, text, integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.rankball_room_rule_boolean(jsonb, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.rankball_apply_room_rule_patch(jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_room_update_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_room_update_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_room_update_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_room_update_action(text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
