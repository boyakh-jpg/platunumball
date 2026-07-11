create or replace function public.rankball_match_start_action(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{"teamA":[],"teamB":[]}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  requested_started_at timestamptz := nullif(btrim(coalesce(p_started_at, '')), '')::timestamptz;
  requested_agreed_at timestamptz := nullif(btrim(coalesce(p_agreed_at, '')), '')::timestamptz;
  current_match public.matches%rowtype;
  current_reserve jsonb;
  input_attendance jsonb;
  next_attendance jsonb;
  actor_side text;
  actor_side_attendance jsonb;
  next_started_at timestamptz;
  next_agreed_at timestamptz;
  next_rules jsonb;
  scheduled_at_kst timestamptz;
  active_player_count integer := 0;
  attended_player_count integer := 0;
  reserve_count integer := 0;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.referee_id is not null and current_match.referee_id <> '' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'referee_match_requires_replay', 'matchId', safe_match_id);
  end if;
  if current_match.created_by <> safe_actor_id then
    raise exception 'match_start_permission_denied' using errcode = '42501';
  end if;
  if current_match.status not in ('contract', 'agreed') or current_match.started_at is not null or current_match.ended_at is not null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_startable', 'matchId', safe_match_id);
  end if;
  if exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_exists', 'matchId', safe_match_id);
  end if;

  if coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_schedule_requires_replay', 'matchId', safe_match_id);
    end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if now() < scheduled_at_kst then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_checkin_time', 'matchId', safe_match_id);
    end if;
  end if;

  current_reserve := case
    when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players
    when jsonb_typeof(current_match.rules->'reservePlayers') = 'object' then current_match.rules->'reservePlayers'
    else '{}'::jsonb
  end;
  select count(*)
  into reserve_count
  from jsonb_each(current_reserve) item
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(item.value) = 'array' then item.value else '[]'::jsonb end) ids(value);

  if reserve_count > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_attendance_requires_replay', 'matchId', safe_match_id);
  end if;
  if jsonb_typeof(current_match.rules->'parties') = 'array' and jsonb_array_length(current_match.rules->'parties') > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'party_attendance_requires_replay', 'matchId', safe_match_id);
  end if;

  input_attendance := case
    when jsonb_typeof(p_attendance) = 'object'
      and (
        jsonb_typeof(p_attendance->'teamA') = 'array'
        or jsonb_typeof(p_attendance->'teamB') = 'array'
      )
      then p_attendance
    when jsonb_typeof(current_match.attendance) = 'object' then current_match.attendance
    else '{}'::jsonb
  end;
  if jsonb_typeof(input_attendance) <> 'object' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'attendance_snapshot_missing', 'matchId', safe_match_id);
  end if;

  select count(*)
  into active_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB');

  if active_player_count = 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_players_missing', 'matchId', safe_match_id);
  end if;
  if exists (
    select 1
    from public.match_players mp
    where mp.match_id = safe_match_id
      and coalesce(mp.side, '') not in ('teamA', 'teamB')
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'unsupported_match_side', 'matchId', safe_match_id);
  end if;

  next_attendance := jsonb_build_object(
    'teamA',
    case when jsonb_typeof(input_attendance->'teamA') = 'array' then input_attendance->'teamA' else '[]'::jsonb end,
    'teamB',
    case when jsonb_typeof(input_attendance->'teamB') = 'array' then input_attendance->'teamB' else '[]'::jsonb end
  );

  select mp.side
  into actor_side
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id = safe_actor_id
    and mp.side in ('teamA', 'teamB')
  order by mp.slot_order nulls last
  limit 1;

  if actor_side in ('teamA', 'teamB') then
    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
    into actor_side_attendance
    from (
      select distinct value
      from (
        select value from jsonb_array_elements_text(next_attendance->actor_side) ids(value)
        union all
        select safe_actor_id
      ) values_to_attend
      where value is not null and value <> ''
    ) distinct_values;
    next_attendance := jsonb_set(next_attendance, array[actor_side], actor_side_attendance, true);
  end if;

  select count(distinct mp.user_id)
  into attended_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and (
      (mp.side = 'teamA' and (next_attendance->'teamA') ? mp.user_id)
      or (mp.side = 'teamB' and (next_attendance->'teamB') ? mp.user_id)
    );

  if attended_player_count < active_player_count then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_attendance_missing', 'matchId', safe_match_id);
  end if;

  next_started_at := coalesce(requested_started_at, now());
  next_agreed_at := coalesce(current_match.agreed_at, requested_agreed_at, next_started_at);
  next_rules := jsonb_set(
    coalesce(current_match.rules, '{}'::jsonb),
    '{startedAt}',
    to_jsonb(next_started_at::text),
    true
  );

  update public.matches
  set
    status = 'agreed',
    agreed_at = next_agreed_at,
    started_at = next_started_at,
    attendance = next_attendance,
    rules = next_rules,
    updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'startMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'startedAt', next_started_at,
    'agreedAt', next_agreed_at,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_start_action(text, text, text, text, jsonb) from public;
revoke all on function public.rankball_match_start_action(text, text, text, text, jsonb) from anon;
revoke all on function public.rankball_match_start_action(text, text, text, text, jsonb) from authenticated;
grant execute on function public.rankball_match_start_action(text, text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
