begin;

create or replace function public.rankball_mmr_balance_for_players(
  p_team_a_ids jsonb,
  p_team_b_ids jsonb,
  p_range_mode text default 'narrow'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  range_limit numeric := case lower(coalesce(p_range_mode, 'narrow'))
    when 'wide' then 360
    when 'normal' then 220
    when 'standard' then 220
    else 120
  end;
  count_a integer := 0;
  count_b integer := 0;
  average_a numeric := 0;
  average_b numeric := 0;
  spread_a numeric := 0;
  spread_b numeric := 0;
  average_gap numeric := 0;
  violation numeric := 0;
begin
  with player_ids as (
    select distinct 'teamA'::text as side, value as user_id
    from jsonb_array_elements_text(case when jsonb_typeof(p_team_a_ids) = 'array' then p_team_a_ids else '[]'::jsonb end) ids(value)
    where nullif(btrim(value), '') is not null
    union
    select distinct 'teamB'::text, value
    from jsonb_array_elements_text(case when jsonb_typeof(p_team_b_ids) = 'array' then p_team_b_ids else '[]'::jsonb end) ids(value)
    where nullif(btrim(value), '') is not null
  ), rated as (
    select player.side, player.user_id, case
      when profile.ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$' then (profile.ratings->>'integrated')::numeric
      else 1200
    end as mmr
    from player_ids player
    left join public.profiles profile on profile.id = player.user_id
  )
  select
    count(*) filter (where side = 'teamA')::integer,
    count(*) filter (where side = 'teamB')::integer,
    coalesce(avg(mmr) filter (where side = 'teamA'), 0),
    coalesce(avg(mmr) filter (where side = 'teamB'), 0),
    coalesce(max(mmr) filter (where side = 'teamA') - min(mmr) filter (where side = 'teamA'), 0),
    coalesce(max(mmr) filter (where side = 'teamB') - min(mmr) filter (where side = 'teamB'), 0)
  into count_a, count_b, average_a, average_b, spread_a, spread_b
  from rated;

  average_gap := case when count_a > 0 and count_b > 0 then abs(average_a - average_b) else 0 end;
  violation := greatest(0, average_gap - range_limit)
    + greatest(0, spread_a - range_limit)
    + greatest(0, spread_b - range_limit);

  return jsonb_build_object(
    'sides', jsonb_build_object(
      'teamA', jsonb_build_object('count', count_a, 'average', round(average_a), 'spread', round(spread_a)),
      'teamB', jsonb_build_object('count', count_b, 'average', round(average_b), 'spread', round(spread_b))
    ),
    'averageGap', round(average_gap),
    'averageGapRaw', average_gap,
    'limit', range_limit,
    'violation', violation,
    'allowed', violation <= 0
  );
end;
$$;

create or replace function public.rankball_recruiting_uses_mmr_balance(p_post_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.recruiting_posts post
    where post.id = nullif(btrim(p_post_id), '')
      and coalesce(post.visibility, 'public') = 'public'
      and post.ranked is distinct from false
      and post.host_join_mode = 'player'
      and lower(coalesce(post.room_state->>'teamOnly', 'false')) <> 'true'
      and lower(coalesce(post.rules->>'formationMode', '')) <> 'pickup'
      and lower(coalesce(post.rules->>'matchIntent', '')) <> 'pickup'
  );
$$;

create or replace function public.rankball_recruiting_mmr_balance(
  p_post_id text,
  p_exclude_ids jsonb default '[]'::jsonb,
  p_add_ids jsonb default '[]'::jsonb,
  p_add_side text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
  exclude_ids jsonb := case when jsonb_typeof(p_exclude_ids) = 'array' then p_exclude_ids else '[]'::jsonb end;
  add_ids jsonb := case when jsonb_typeof(p_add_ids) = 'array' then p_add_ids else '[]'::jsonb end;
  team_a_ids jsonb := '[]'::jsonb;
  team_b_ids jsonb := '[]'::jsonb;
  range_mode text;
begin
  select * into post_row from public.recruiting_posts where id = nullif(btrim(p_post_id), '');
  if post_row.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;

  with existing_players as (
    select post_row.host_side as side, post_row.player_id as user_id
    where post_row.host_join_mode = 'player'
      and post_row.player_id is not null
      and lower(coalesce(post_row.room_state->>'hostReserve', 'false')) <> 'true'
    union all
    select application.side, application.player_id
    from public.recruiting_applications application
    where application.post_id = post_row.id and application.reserve = false and application.kind = 'player'
    union all
    select application.side, member.value
    from public.recruiting_applications application
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end
    ) member(value)
    where application.post_id = post_row.id and application.reserve = false and application.kind = 'team'
    union all
    select application.side, application.player_id
    from public.recruiting_applications application
    where application.post_id = post_row.id
      and application.reserve = false
      and application.kind = 'team'
      and jsonb_array_length(case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end) = 0
  ), combined as (
    select side, user_id from existing_players
    where user_id is not null and not (exclude_ids ? user_id)
    union
    select p_add_side, candidate.value
    from jsonb_array_elements_text(add_ids) candidate(value)
    where p_add_side in ('teamA', 'teamB') and nullif(btrim(candidate.value), '') is not null
  )
  select
    coalesce(jsonb_agg(to_jsonb(user_id)) filter (where side = 'teamA'), '[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(user_id)) filter (where side = 'teamB'), '[]'::jsonb)
  into team_a_ids, team_b_ids
  from combined;

  range_mode := coalesce(nullif(post_row.room_state->>'mmrRangeMode', ''), nullif(post_row.rules->>'mmrRangeMode', ''), 'narrow');
  return public.rankball_mmr_balance_for_players(team_a_ids, team_b_ids, range_mode);
end;
$$;

create or replace function public.rankball_recruiting_choose_mmr_placement(
  p_post_id text,
  p_player_ids jsonb,
  p_requested_reserve boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
  candidate_ids jsonb := case when jsonb_typeof(p_player_ids) = 'array' then p_player_ids else '[]'::jsonb end;
  candidate_count integer := 0;
  current_balance jsonb;
  balance_a jsonb;
  balance_b jsonb;
  current_violation numeric := 0;
  count_a integer := 0;
  count_b integer := 0;
  reserve_a integer := 0;
  reserve_b integer := 0;
  side_capacity integer := 0;
  bench_capacity integer := 0;
  chosen_side text;
  chosen_reserve boolean;
  chosen_balance jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(p_post_id, '')));
  select * into post_row from public.recruiting_posts where id = nullif(btrim(p_post_id), '') for update;
  if post_row.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;
  if not public.rankball_recruiting_uses_mmr_balance(post_row.id) then
    return jsonb_build_object('applies', false, 'allowed', true);
  end if;

  select count(distinct value)::integer into candidate_count
  from jsonb_array_elements_text(candidate_ids) candidate(value)
  where nullif(btrim(value), '') is not null;
  if candidate_count = 0 then return jsonb_build_object('applies', true, 'allowed', false); end if;

  current_balance := public.rankball_recruiting_mmr_balance(post_row.id);
  balance_a := public.rankball_recruiting_mmr_balance(post_row.id, candidate_ids, candidate_ids, 'teamA');
  balance_b := public.rankball_recruiting_mmr_balance(post_row.id, candidate_ids, candidate_ids, 'teamB');
  current_violation := coalesce((current_balance->>'violation')::numeric, 0);
  count_a := coalesce((current_balance #>> '{sides,teamA,count}')::integer, 0);
  count_b := coalesce((current_balance #>> '{sides,teamB,count}')::integer, 0);
  side_capacity := greatest(1, least(5, coalesce(post_row.side_capacity, 5)));
  bench_capacity := greatest(0, least(3, coalesce(post_row.bench_capacity, 0)));

  with reserve_players as (
    select application.side, application.player_id as user_id
    from public.recruiting_applications application
    where application.post_id = post_row.id and application.reserve = true and application.kind = 'player'
    union
    select application.side, member.value
    from public.recruiting_applications application
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end
    ) member(value)
    where application.post_id = post_row.id and application.reserve = true and application.kind = 'team'
    union
    select pinned.key, member.value
    from jsonb_each(case when jsonb_typeof(post_row.room_state->'pinnedReservePlayers') = 'object' then post_row.room_state->'pinnedReservePlayers' else '{}'::jsonb end) pinned(key, value)
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(pinned.value) = 'array' then pinned.value else '[]'::jsonb end) member(value)
    where pinned.key in ('teamA', 'teamB')
  )
  select
    count(distinct user_id) filter (where side = 'teamA')::integer,
    count(distinct user_id) filter (where side = 'teamB')::integer
  into reserve_a, reserve_b
  from reserve_players;

  with options as (
    select 'teamA'::text as side, false as reserve, balance_a as balance, count_a as occupancy
    where not coalesce(p_requested_reserve, false)
      and count_a + candidate_count <= side_capacity
      and ((balance_a->>'allowed')::boolean or (balance_a->>'violation')::numeric <= current_violation)
    union all
    select 'teamB', false, balance_b, count_b
    where not coalesce(p_requested_reserve, false)
      and count_b + candidate_count <= side_capacity
      and ((balance_b->>'allowed')::boolean or (balance_b->>'violation')::numeric <= current_violation)
    union all
    select 'teamA', true, current_balance, count_a + reserve_a
    where reserve_a + candidate_count <= bench_capacity
    union all
    select 'teamB', true, current_balance, count_b + reserve_b
    where reserve_b + candidate_count <= bench_capacity
  )
  select side, reserve, balance
  into chosen_side, chosen_reserve, chosen_balance
  from options
  order by
    reserve,
    abs((balance #>> '{sides,teamA,count}')::numeric - (balance #>> '{sides,teamB,count}')::numeric),
    (balance->>'violation')::numeric,
    (balance->>'averageGapRaw')::numeric,
    greatest((balance #>> '{sides,teamA,spread}')::numeric, (balance #>> '{sides,teamB,spread}')::numeric),
    occupancy,
    side
  limit 1;

  if chosen_side is null then
    return jsonb_build_object('applies', true, 'allowed', false, 'balance', current_balance);
  end if;
  return jsonb_build_object('applies', true, 'allowed', true, 'side', chosen_side, 'reserve', chosen_reserve, 'balance', chosen_balance);
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_recruiting_interest_player_action_pre_side_mmr_balance(text,text,text,text,text,boolean,text)') is null then
    alter function public.rankball_recruiting_interest_player_action(text, text, text, text, text, boolean, text)
      rename to rankball_recruiting_interest_player_action_pre_side_mmr_balance;
  end if;
  if to_regprocedure('public.rankball_recruiting_applicant_placement_action_pre_side_mmr_balance(text,text,text,text,boolean)') is null then
    alter function public.rankball_recruiting_applicant_placement_action(text, text, text, text, boolean)
      rename to rankball_recruiting_applicant_placement_action_pre_side_mmr_balance;
  end if;
  if to_regprocedure('public.rankball_recruiting_management_action_pre_side_mmr_balance(text,jsonb)') is null then
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_pre_side_mmr_balance;
  end if;
  if to_regprocedure('public.rankball_recruiting_invitation_decision_action_pre_side_mmr_balance(text,text,text,text)') is null then
    alter function public.rankball_recruiting_invitation_decision_action(text, text, text, text)
      rename to rankball_recruiting_invitation_decision_action_pre_side_mmr_balance;
  end if;
  if to_regprocedure('public.rankball_match_room_action_pre_side_mmr_balance(text,text,text,jsonb)') is null then
    alter function public.rankball_match_room_action(text, text, text, jsonb)
      rename to rankball_match_room_action_pre_side_mmr_balance;
  end if;
end;
$migration$;

create or replace function public.rankball_recruiting_interest_player_action(
  p_actor_profile_id text,
  p_post_id text,
  p_join_mode text default '',
  p_team_id text default null,
  p_side text default null,
  p_reserve boolean default false,
  p_position text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  placement jsonb;
begin
  placement := public.rankball_recruiting_choose_mmr_placement(p_post_id, jsonb_build_array(nullif(btrim(p_actor_profile_id), '')), p_reserve);
  if coalesce((placement->>'applies')::boolean, false) then
    if not coalesce((placement->>'allowed')::boolean, false) then
      raise exception 'recruiting_side_mmr_imbalance' using errcode = '23514';
    end if;
    p_side := placement->>'side';
    p_reserve := coalesce((placement->>'reserve')::boolean, false);
  end if;
  return public.rankball_recruiting_interest_player_action_pre_side_mmr_balance(
    p_actor_profile_id, p_post_id, p_join_mode, p_team_id, p_side, p_reserve, p_position
  );
end;
$$;

create or replace function public.rankball_recruiting_applicant_placement_action(
  p_actor_profile_id text,
  p_post_id text,
  p_player_id text,
  p_side text default null,
  p_reserve boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
  applies boolean := false;
  effective_actor text := nullif(btrim(p_actor_profile_id), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  before_balance jsonb;
  after_balance jsonb;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(p_post_id, '')));
  select * into post_row from public.recruiting_posts where id = nullif(btrim(p_post_id), '') for update;
  applies := public.rankball_recruiting_uses_mmr_balance(p_post_id);
  if applies then
    if effective_actor is distinct from safe_player_id
       and effective_actor is distinct from coalesce(nullif(post_row.room_state->>'ownerId', ''), post_row.player_id) then
      raise exception 'recruiting_applicant_placement_permission_denied' using errcode = '42501';
    end if;
    before_balance := public.rankball_recruiting_mmr_balance(p_post_id);
    effective_actor := safe_player_id;
  end if;

  result := public.rankball_recruiting_applicant_placement_action_pre_side_mmr_balance(
    effective_actor, p_post_id, safe_player_id, p_side, p_reserve
  );
  if applies and coalesce((result->>'ok')::boolean, false) then
    after_balance := public.rankball_recruiting_mmr_balance(p_post_id);
    if not (after_balance->>'allowed')::boolean
       and (after_balance->>'violation')::numeric > (before_balance->>'violation')::numeric then
      raise exception 'recruiting_side_mmr_imbalance' using errcode = '23514';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.rankball_recruiting_management_action(
  p_actor_profile_id text,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation jsonb := coalesce(p_operation, '{}'::jsonb);
  safe_action text := nullif(btrim(operation->>'action'), '');
  safe_post_id text := nullif(btrim(operation->>'postId'), '');
  candidate_ids jsonb;
  placement jsonb;
  before_balance jsonb;
  after_balance jsonb;
  result jsonb;
  applies boolean := false;
begin
  if safe_post_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
    applies := public.rankball_recruiting_uses_mmr_balance(safe_post_id);
  end if;
  if applies then before_balance := public.rankball_recruiting_mmr_balance(safe_post_id); end if;

  if applies and safe_action = 'interestRecruitingPost' then
    candidate_ids := case
      when jsonb_typeof(operation #> '{application,playerIds}') = 'array'
        and jsonb_array_length(operation #> '{application,playerIds}') > 0
        then operation #> '{application,playerIds}'
      else jsonb_build_array(nullif(btrim(p_actor_profile_id), ''))
    end;
    placement := public.rankball_recruiting_choose_mmr_placement(
      safe_post_id,
      candidate_ids,
      coalesce((operation #>> '{application,reserve}')::boolean, false)
    );
    if not coalesce((placement->>'allowed')::boolean, false) then
      raise exception 'recruiting_side_mmr_imbalance' using errcode = '23514';
    end if;
    operation := operation || jsonb_build_object(
      'application', coalesce(operation->'application', '{}'::jsonb) || jsonb_build_object(
        'side', placement->>'side',
        'reserve', coalesce((placement->>'reserve')::boolean, false)
      )
    );
  end if;

  result := public.rankball_recruiting_management_action_pre_side_mmr_balance(p_actor_profile_id, operation);
  if applies and safe_action in (
    'interestRecruitingPost', 'acceptRecruitingInvitation', 'joinRecruitingSideParty',
    'setRecruitingPartyPlayerPlacement', 'setRecruitingPartyPlayerReserve', 'setRecruitingTeamPartyRoster',
    'detachRecruitingPartyPlayer', 'removeRecruitingPartyPlayer', 'kickRecruitingApplicant'
  ) then
    after_balance := public.rankball_recruiting_mmr_balance(safe_post_id);
    if not (after_balance->>'allowed')::boolean
       and (after_balance->>'violation')::numeric > (before_balance->>'violation')::numeric then
      raise exception 'recruiting_side_mmr_imbalance' using errcode = '23514';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.rankball_recruiting_invitation_decision_action(
  p_actor_profile_id text,
  p_post_id text,
  p_invitation_id text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  applies boolean := public.rankball_recruiting_uses_mmr_balance(p_post_id);
  before_balance jsonb;
  after_balance jsonb;
  result jsonb;
begin
  if applies then
    perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(p_post_id, '')));
    before_balance := public.rankball_recruiting_mmr_balance(p_post_id);
  end if;
  result := public.rankball_recruiting_invitation_decision_action_pre_side_mmr_balance(
    p_actor_profile_id, p_post_id, p_invitation_id, p_action
  );
  if applies and lower(coalesce(p_action, '')) = 'acceptrecruitinginvitation' then
    after_balance := public.rankball_recruiting_mmr_balance(p_post_id);
    if not (after_balance->>'allowed')::boolean
       and (after_balance->>'violation')::numeric > (before_balance->>'violation')::numeric then
      raise exception 'recruiting_side_mmr_imbalance' using errcode = '23514';
    end if;
  end if;
  return result;
end;
$$;

create or replace function public.rankball_match_room_action(
  p_actor_profile_id text,
  p_match_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
  team_a_ids jsonb := '[]'::jsonb;
  team_b_ids jsonb := '[]'::jsonb;
  before_balance jsonb;
  after_balance jsonb;
  result jsonb;
  range_mode text;
  applies boolean := false;
begin
  if p_action = 'setMatchRoomPlayerPlacement' then
    perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(p_match_id, '')));
    select * into match_row from public.matches where id = nullif(btrim(p_match_id), '') for update;
    applies := lower(coalesce(match_row.rules->>'mmrBalancedSides', 'false')) = 'true';
    if applies then
      select
        coalesce(jsonb_agg(to_jsonb(user_id)) filter (where side = 'teamA'), '[]'::jsonb),
        coalesce(jsonb_agg(to_jsonb(user_id)) filter (where side = 'teamB'), '[]'::jsonb)
      into team_a_ids, team_b_ids
      from public.match_players where match_id = p_match_id;
      range_mode := coalesce(nullif(match_row.rules->>'mmrRangeMode', ''), 'narrow');
      before_balance := public.rankball_mmr_balance_for_players(team_a_ids, team_b_ids, range_mode);
    end if;
  end if;

  result := public.rankball_match_room_action_pre_side_mmr_balance(p_actor_profile_id, p_match_id, p_action, p_payload);
  if applies then
    select
      coalesce(jsonb_agg(to_jsonb(user_id)) filter (where side = 'teamA'), '[]'::jsonb),
      coalesce(jsonb_agg(to_jsonb(user_id)) filter (where side = 'teamB'), '[]'::jsonb)
    into team_a_ids, team_b_ids
    from public.match_players where match_id = p_match_id;
    after_balance := public.rankball_mmr_balance_for_players(team_a_ids, team_b_ids, range_mode);
    if not (after_balance->>'allowed')::boolean
       and (after_balance->>'violation')::numeric > (before_balance->>'violation')::numeric then
      raise exception 'match_side_mmr_imbalance' using errcode = '23514';
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.rankball_mmr_balance_for_players(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_uses_mmr_balance(text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_mmr_balance(text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_choose_mmr_placement(text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_interest_player_action_pre_side_mmr_balance(text, text, text, text, text, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_applicant_placement_action_pre_side_mmr_balance(text, text, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action_pre_side_mmr_balance(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_invitation_decision_action_pre_side_mmr_balance(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_room_action_pre_side_mmr_balance(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_interest_player_action(text, text, text, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_applicant_placement_action(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_management_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_invitation_decision_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_room_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_mmr_balance_for_players(jsonb, jsonb, text) to service_role;
grant execute on function public.rankball_recruiting_uses_mmr_balance(text) to service_role;
grant execute on function public.rankball_recruiting_mmr_balance(text, jsonb, jsonb, text) to service_role;
grant execute on function public.rankball_recruiting_choose_mmr_placement(text, jsonb, boolean) to service_role;
grant execute on function public.rankball_recruiting_interest_player_action(text, text, text, text, text, boolean, text) to service_role;
grant execute on function public.rankball_recruiting_applicant_placement_action(text, text, text, text, boolean) to service_role;
grant execute on function public.rankball_recruiting_management_action(text, jsonb) to service_role;
grant execute on function public.rankball_recruiting_invitation_decision_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_room_action(text, text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
