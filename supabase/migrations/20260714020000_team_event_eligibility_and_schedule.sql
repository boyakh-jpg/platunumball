-- Enforce team event eligibility and make tournament scheduling actionable.

create or replace function public.rankball_event_profile_age_group(p_profile_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when birth_year between 1900 and extract(year from current_date)::integer then
      case
        when extract(year from current_date)::integer - birth_year <= 12 then 'junior'
        when extract(year from current_date)::integer - birth_year <= 19 then 'rising'
        else 'open'
      end
    else coalesce(nullif(age_group, ''), 'open')
  end
  from public.profiles
  where id = nullif(btrim(p_profile_id), '')
$$;

create or replace function public.rankball_event_profile_mmr(p_profile_id text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case
    when coalesce(ratings->>'integrated', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (ratings->>'integrated')::numeric
    else 1200::numeric
  end
  from public.profiles
  where id = nullif(btrim(p_profile_id), '')
$$;

create or replace function public.rankball_event_profile_eligible(
  p_profile_id text,
  p_ranked boolean,
  p_mmr_limit_mode text,
  p_target_mmr numeric,
  p_mmr_range_mode text,
  p_allowed_age_groups jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_age_group text;
  profile_mmr numeric;
  mmr_gap integer;
  safe_age_groups jsonb := case when jsonb_typeof(p_allowed_age_groups) = 'array' then p_allowed_age_groups else '[]'::jsonb end;
begin
  if not exists (select 1 from public.profiles where id = nullif(btrim(p_profile_id), '')) then
    return false;
  end if;
  profile_age_group := public.rankball_event_profile_age_group(p_profile_id);
  if jsonb_array_length(safe_age_groups) > 0 and not safe_age_groups ? profile_age_group then
    return false;
  end if;
  if coalesce(p_ranked, true) and coalesce(p_mmr_limit_mode, 'block') = 'block' and p_target_mmr is not null then
    mmr_gap := case
      when p_mmr_range_mode = 'wide' then 360
      when p_mmr_range_mode in ('standard', 'normal') then 220
      else 120
    end;
    profile_mmr := coalesce(public.rankball_event_profile_mmr(p_profile_id), 1200);
    if profile_mmr < p_target_mmr - mmr_gap or profile_mmr > p_target_mmr + mmr_gap then
      return false;
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.rankball_team_event_eligibility(
  p_team_id text,
  p_capacity integer,
  p_ranked boolean,
  p_mmr_limit_mode text,
  p_target_mmr numeric,
  p_mmr_range_mode text,
  p_allowed_age_groups jsonb,
  p_require_captain_eligible boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_capacity integer := greatest(1, least(5, coalesce(p_capacity, 1)));
  captain_id text;
  eligible_ids jsonb := '[]'::jsonb;
  eligible_count integer := 0;
  captain_eligible boolean := false;
begin
  select user_id into captain_id
  from public.team_members
  where team_id = nullif(btrim(p_team_id), '') and role = 'captain'
  order by user_id
  limit 1;

  select coalesce(jsonb_agg(user_id order by role, user_id), '[]'::jsonb), count(*)
  into eligible_ids, eligible_count
  from public.team_members
  where team_id = nullif(btrim(p_team_id), '')
    and public.rankball_event_profile_eligible(
      user_id,
      p_ranked,
      p_mmr_limit_mode,
      p_target_mmr,
      p_mmr_range_mode,
      p_allowed_age_groups
    );

  captain_eligible := captain_id is not null and eligible_ids ? captain_id;
  return jsonb_build_object(
    'teamId', p_team_id,
    'capacity', safe_capacity,
    'captainId', captain_id,
    'captainEligible', captain_eligible,
    'eligiblePlayerIds', eligible_ids,
    'eligibleCount', eligible_count,
    'missingCount', greatest(0, safe_capacity - eligible_count),
    'allowed', captain_id is not null
      and eligible_count >= safe_capacity
      and (not coalesce(p_require_captain_eligible, false) or captain_eligible)
  );
end;
$$;

create or replace function public.rankball_assert_team_event_eligible(
  p_team_id text,
  p_capacity integer,
  p_ranked boolean,
  p_mmr_limit_mode text,
  p_target_mmr numeric,
  p_mmr_range_mode text,
  p_allowed_age_groups jsonb,
  p_require_captain_eligible boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  result := public.rankball_team_event_eligibility(
    p_team_id,
    p_capacity,
    p_ranked,
    p_mmr_limit_mode,
    p_target_mmr,
    p_mmr_range_mode,
    p_allowed_age_groups,
    p_require_captain_eligible
  );
  if nullif(result->>'captainId', '') is null then
    raise exception 'team_captain_required' using errcode = '23514';
  end if;
  if coalesce(p_require_captain_eligible, false) and not coalesce((result->>'captainEligible')::boolean, false) then
    raise exception 'team_captain_ineligible' using errcode = '23514';
  end if;
  if coalesce((result->>'eligibleCount')::integer, 0) < greatest(1, least(5, coalesce(p_capacity, 1))) then
    raise exception 'team_eligible_roster_insufficient' using errcode = '23514';
  end if;
  return result;
end;
$$;

create or replace function public.rankball_recruiting_team_event_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  host_mmr numeric;
  mmr_range_mode text;
  mmr_limit_mode text;
  host_result jsonb;
  target_result jsonb;
  captain_id text;
begin
  if new.status <> 'open' or new.host_join_mode <> 'team' then
    return new;
  end if;
  select coalesce(mmr, 1200) into host_mmr from public.teams where id = new.team_id and deleted_at is null;
  if host_mmr is null then raise exception 'recruiting_host_team_not_found' using errcode = 'P0002'; end if;
  mmr_range_mode := coalesce(nullif(new.room_state->>'mmrRangeMode', ''), nullif(new.rules->>'mmrRangeMode', ''), 'narrow');
  mmr_limit_mode := coalesce(nullif(new.room_state->>'mmrLimitMode', ''), nullif(new.rules->>'mmrLimitMode', ''), 'block');
  host_result := public.rankball_assert_team_event_eligible(
    new.team_id, new.side_capacity, new.ranked, mmr_limit_mode, host_mmr,
    mmr_range_mode, new.allowed_age_groups, true
  );
  captain_id := host_result->>'captainId';
  if new.player_id is distinct from captain_id then
    raise exception 'team_captain_required' using errcode = '42501';
  end if;
  if new.visibility = 'private' and new.target_team_id is not null then
    if new.target_team_id = new.team_id then raise exception 'recruiting_team_duplicate' using errcode = '23514'; end if;
    target_result := public.rankball_assert_team_event_eligible(
      new.target_team_id, new.side_capacity, new.ranked, mmr_limit_mode, host_mmr,
      mmr_range_mode, new.allowed_age_groups, true
    );
    captain_id := target_result->>'captainId';
    if tg_op = 'INSERT' and not exists (
      select 1
      from jsonb_array_elements(coalesce(new.room_state->'invitations', '[]'::jsonb)) invitation(value)
      where invitation.value->>'teamId' = new.target_team_id
        and invitation.value->>'targetUserId' = captain_id
        and coalesce(invitation.value->>'status', 'pending') = 'pending'
    ) then
      raise exception 'recruiting_opponent_captain_required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_recruiting_team_event_guard_trigger on public.recruiting_posts;
create trigger rankball_recruiting_team_event_guard_trigger
before insert or update of team_id, target_team_id, side_capacity, ranked, allowed_age_groups, rules, host_join_mode, player_id, room_state, status
on public.recruiting_posts
for each row execute function public.rankball_recruiting_team_event_guard();

create or replace function public.rankball_recruiting_application_event_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
  target_mmr numeric := 1200;
  mmr_range_mode text;
  mmr_limit_mode text;
  eligibility jsonb;
  candidate_id text;
begin
  select * into post_row from public.recruiting_posts where id = new.post_id;
  if post_row.id is null or post_row.status <> 'open' then return new; end if;
  if post_row.team_id is not null then
    select coalesce(mmr, 1200) into target_mmr from public.teams where id = post_row.team_id;
  elsif post_row.player_id is not null then
    target_mmr := coalesce(public.rankball_event_profile_mmr(post_row.player_id), 1200);
  end if;
  mmr_range_mode := coalesce(nullif(post_row.room_state->>'mmrRangeMode', ''), nullif(post_row.rules->>'mmrRangeMode', ''), 'narrow');
  mmr_limit_mode := coalesce(nullif(post_row.room_state->>'mmrLimitMode', ''), nullif(post_row.rules->>'mmrLimitMode', ''), 'block');

  if new.kind = 'team' then
    eligibility := public.rankball_assert_team_event_eligible(
      new.team_id, post_row.side_capacity, post_row.ranked, mmr_limit_mode, target_mmr,
      mmr_range_mode, post_row.allowed_age_groups, true
    );
    if new.player_id is distinct from eligibility->>'captainId' then
      raise exception 'team_captain_required' using errcode = '42501';
    end if;
    if coalesce((post_row.room_state->>'teamOnly')::boolean, post_row.host_join_mode = 'team')
       and jsonb_array_length(coalesce(new.player_ids, '[]'::jsonb)) < post_row.side_capacity then
      raise exception 'team_eligible_roster_insufficient' using errcode = '23514';
    end if;
    for candidate_id in select value from jsonb_array_elements_text(coalesce(new.player_ids, '[]'::jsonb))
    loop
      if not coalesce(eligibility->'eligiblePlayerIds', '[]'::jsonb) ? candidate_id then
        raise exception 'team_roster_player_ineligible' using errcode = '23514';
      end if;
    end loop;
  elsif not public.rankball_event_profile_eligible(
    new.player_id, post_row.ranked, mmr_limit_mode, target_mmr,
    mmr_range_mode, post_row.allowed_age_groups
  ) then
    raise exception 'recruiting_player_ineligible' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_recruiting_application_event_guard_trigger on public.recruiting_applications;
create trigger rankball_recruiting_application_event_guard_trigger
before insert or update of player_id, team_id, kind, player_ids, status
on public.recruiting_applications
for each row execute function public.rankball_recruiting_application_event_guard();

create or replace function public.rankball_tournament_team_event_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  capacity integer;
  team_mmr numeric;
begin
  if new.status = 'declined' then return new; end if;
  select * into tournament_row from public.tournaments where id = new.tournament_id;
  if tournament_row.id is null then return new; end if;
  capacity := greatest(1, least(5, coalesce(
    (tournament_row.rules->>'sideCapacity')::integer,
    substring(coalesce(tournament_row.mode, '5v5') from '^[0-9]+')::integer,
    5
  )));
  select coalesce(mmr, 1200) into team_mmr from public.teams where id = new.team_id and deleted_at is null;
  if team_mmr is null then raise exception 'tournament_team_not_found' using errcode = 'P0002'; end if;
  perform public.rankball_assert_team_event_eligible(
    new.team_id,
    capacity,
    tournament_row.ranked,
    coalesce(nullif(tournament_row.rules->>'mmrLimitMode', ''), tournament_row.mmr_limit_mode),
    team_mmr,
    coalesce(nullif(tournament_row.rules->>'mmrRangeMode', ''), 'narrow'),
    coalesce(tournament_row.rules->'allowedAgeGroups', '[]'::jsonb),
    false
  );
  return new;
end;
$$;

drop trigger if exists rankball_tournament_team_event_guard_trigger on public.tournament_teams;
create trigger rankball_tournament_team_event_guard_trigger
before insert or update of team_id, status
on public.tournament_teams
for each row execute function public.rankball_tournament_team_event_guard();

create or replace function public.rankball_tournament_match_roster_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  capacity integer;
begin
  if new.tournament_id is null then return new; end if;
  capacity := greatest(1, least(5, coalesce(
    (new.rules->>'sideCapacity')::integer,
    substring(coalesce(new.mode, '5v5') from '^[0-9]+')::integer,
    5
  )));
  new.rules := coalesce(new.rules, '{}'::jsonb) || jsonb_build_object(
    'sideCapacity', capacity,
    'rosterReady', jsonb_build_object('teamA', false, 'teamB', false)
  );
  return new;
end;
$$;

drop trigger if exists rankball_tournament_match_roster_defaults_trigger on public.matches;
create trigger rankball_tournament_match_roster_defaults_trigger
before insert on public.matches
for each row execute function public.rankball_tournament_match_roster_defaults();

create or replace function public.rankball_tournament_match_schedule_action(
  p_actor_profile_id text,
  p_tournament_id text,
  p_match_id text,
  p_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
<<tournament_match_schedule_action>>
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_tournament_id text := nullif(btrim(p_tournament_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  schedule_date date;
  schedule_time time;
  current_tournament public.tournaments%rowtype;
  current_match public.matches%rowtype;
  captain_row record;
  notified_count integer := 0;
  now_at timestamptz := now();
begin
  if safe_actor_id is null or safe_tournament_id is null or safe_match_id is null then
    raise exception 'tournament_schedule_target_missing' using errcode = '22023';
  end if;
  schedule_date := nullif(btrim(p_schedule->>'scheduledDate'), '')::date;
  schedule_time := nullif(btrim(p_schedule->>'scheduledTime'), '')::time;
  if schedule_date is null or schedule_time is null or schedule_date < current_date or schedule_date > current_date + 365 then
    raise exception 'invalid_tournament_match_schedule' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_tournament from public.tournaments where id = safe_tournament_id for update;
  if current_tournament.id is null then raise exception 'tournament_not_found' using errcode = 'P0002'; end if;
  if current_tournament.created_by <> safe_actor_id then raise exception 'tournament_owner_required' using errcode = '42501'; end if;
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null or current_match.tournament_id is distinct from safe_tournament_id then
    raise exception 'tournament_match_not_found' using errcode = 'P0002';
  end if;
  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed') or current_match.started_at is not null then
    raise exception 'tournament_match_schedule_locked' using errcode = '23514';
  end if;

  update public.matches
  set scheduled_date = tournament_match_schedule_action.schedule_date,
      scheduled_time = tournament_match_schedule_action.schedule_time,
      scheduled_at = tournament_match_schedule_action.schedule_date::text || ' ' || left(tournament_match_schedule_action.schedule_time::text, 5),
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('rosterReady', jsonb_build_object('teamA', false, 'teamB', false)),
      updated_at = now_at
  where id = safe_match_id;

  for captain_row in
    select tm.user_id as captain_id, tm.team_id,
      case when tm.team_id = current_match.team_a_id then 'teamA' else 'teamB' end as side_name
    from public.team_members tm
    where tm.role = 'captain' and tm.team_id in (current_match.team_a_id, current_match.team_b_id)
  loop
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id,
      discord_event, read_at, payload, created_at, updated_at
    ) values (
      'tournament-schedule-' || substr(md5(safe_match_id || ':' || captain_row.captain_id), 1, 24),
      captain_row.captain_id,
      captain_row.captain_id,
      '대회 경기 일정 확정',
      schedule_date::text || ' ' || left(schedule_time::text, 5) || ' 경기의 출전·후보 명단을 구성하세요.',
      'match',
      'tournament_match_schedule',
      safe_match_id,
      'match',
      null,
      jsonb_build_object(
        'targetUserId', captain_row.captain_id,
        'tournamentId', safe_tournament_id,
        'matchId', safe_match_id,
        'teamId', captain_row.team_id,
        'sideName', captain_row.side_name,
        'actionRequired', true,
        'homeAction', true,
        'webPath', '/app/matches?match=' || safe_match_id
      ),
      now_at,
      now_at
    ) on conflict (id) do update set
      body = excluded.body,
      target_user_id = excluded.target_user_id,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
    notified_count := notified_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'action', 'updateTournamentMatchSchedule',
    'tournamentId', safe_tournament_id,
    'matchId', safe_match_id,
    'scheduledDate', schedule_date,
    'scheduledTime', left(schedule_time::text, 5),
    'captainNotificationCount', notified_count,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_tournament_match_roster_action(
  p_actor_profile_id text,
  p_match_id text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := case when p_payload->>'sideName' = 'teamB' then 'teamB' else 'teamA' end;
  current_match public.matches%rowtype;
  side_team_id text;
  team_mmr numeric;
  capacity integer;
  captain_id text;
  eligibility jsonb;
  requested_active jsonb := '[]'::jsonb;
  requested_reserve jsonb := '[]'::jsonb;
  existing_active jsonb := '[]'::jsonb;
  stale_active jsonb := '[]'::jsonb;
  new_active jsonb := '[]'::jsonb;
  other_side_ids jsonb := '[]'::jsonb;
  reserves jsonb;
  now_at timestamptz := now();
begin
  if safe_actor_id is null or safe_match_id is null then raise exception 'match_roster_target_missing' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.tournament_id is null then raise exception 'tournament_match_required' using errcode = '23514'; end if;
  if current_match.scheduled_date is null or current_match.scheduled_time is null then raise exception 'tournament_schedule_required' using errcode = '23514'; end if;
  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or current_match.started_at is not null or current_match.ended_at is not null
     or exists (select 1 from public.match_results where match_id = safe_match_id) then
    raise exception 'match_roster_locked' using errcode = '23514';
  end if;

  side_team_id := case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
  select user_id into captain_id from public.team_members
  where team_id = side_team_id and role = 'captain'
  order by user_id limit 1;
  if captain_id is null or captain_id <> safe_actor_id then raise exception 'match_side_captain_required' using errcode = '42501'; end if;
  capacity := greatest(1, least(5, coalesce(
    (current_match.rules->>'sideCapacity')::integer,
    substring(current_match.mode from '^[0-9]+')::integer,
    5
  )));
  select coalesce(mmr, 1200) into team_mmr from public.teams where id = side_team_id;
  eligibility := public.rankball_assert_team_event_eligible(
    side_team_id,
    capacity,
    current_match.ranked,
    coalesce(nullif(current_match.rules->>'mmrLimitMode', ''), current_match.mmr_limit_mode),
    team_mmr,
    coalesce(nullif(current_match.rules->>'mmrRangeMode', ''), 'narrow'),
    coalesce(current_match.rules->'allowedAgeGroups', '[]'::jsonb),
    false
  );

  select coalesce(jsonb_agg(player_id order by first_order), '[]'::jsonb)
  into requested_active
  from (
    select player_id, min(ordinality)::integer as first_order
    from jsonb_array_elements_text(coalesce(p_payload #> '{roster,playerIds}', '[]'::jsonb)) with ordinality player(player_id, ordinality)
    group by player_id
    order by min(ordinality)
  ) selected;
  select coalesce(jsonb_agg(player_id order by first_order), '[]'::jsonb)
  into requested_reserve
  from (
    select player_id, min(ordinality)::integer as first_order
    from jsonb_array_elements_text(coalesce(p_payload #> '{roster,reservePlayerIds}', '[]'::jsonb)) with ordinality player(player_id, ordinality)
    group by player_id
    order by min(ordinality)
  ) selected;
  if jsonb_array_length(requested_active) <> capacity then raise exception 'team_eligible_roster_insufficient' using errcode = '23514'; end if;
  if (select count(*) from jsonb_array_elements_text(requested_reserve)) > 2 then raise exception 'match_reserve_full' using errcode = '23514'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(requested_active || requested_reserve) player(player_id)
    where not coalesce(eligibility->'eligiblePlayerIds', '[]'::jsonb) ? player.player_id
  ) then raise exception 'team_roster_player_ineligible' using errcode = '23514'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(requested_reserve) reserve(player_id)
    where requested_active ? reserve.player_id
  ) then raise exception 'match_roster_duplicate_player' using errcode = '23514'; end if;

  reserves := coalesce(current_match.reserve_players, jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb));
  select coalesce(jsonb_agg(user_id), '[]'::jsonb) into other_side_ids
  from public.match_players where match_id = safe_match_id and side <> safe_side;
  other_side_ids := other_side_ids || coalesce(reserves->(case when safe_side = 'teamA' then 'teamB' else 'teamA' end), '[]'::jsonb);
  if exists (
    select 1 from jsonb_array_elements_text(requested_active || requested_reserve) player(player_id)
    where other_side_ids ? player.player_id
  ) then raise exception 'match_roster_cross_side_duplicate' using errcode = '23514'; end if;

  select coalesce(jsonb_agg(user_id order by slot_order, user_id), '[]'::jsonb)
  into existing_active
  from public.match_players
  where match_id = safe_match_id and side = safe_side;
  if jsonb_array_length(existing_active) > capacity then raise exception 'match_roster_slot_overflow' using errcode = '23514'; end if;
  select coalesce(jsonb_agg(player_id), '[]'::jsonb) into stale_active
  from jsonb_array_elements_text(existing_active) player(player_id)
  where not requested_active ? player.player_id;
  select coalesce(jsonb_agg(player_id), '[]'::jsonb) into new_active
  from jsonb_array_elements_text(requested_active) player(player_id)
  where not existing_active ? player.player_id;

  if jsonb_array_length(new_active) > 0 then
    for slot_index in 0..jsonb_array_length(new_active) - 1 loop
      if slot_index < jsonb_array_length(stale_active) then
        update public.match_players
        set user_id = new_active->>slot_index, team_id = side_team_id
        where match_id = safe_match_id and side = safe_side and user_id = stale_active->>slot_index;
      else
        insert into public.match_players (match_id, team_id, user_id, side, slot_order)
        values (safe_match_id, side_team_id, new_active->>slot_index, safe_side, jsonb_array_length(existing_active) + slot_index)
        on conflict (match_id, user_id) do update set team_id = excluded.team_id, side = excluded.side, slot_order = excluded.slot_order;
      end if;
    end loop;
  end if;
  update public.match_players player_row
  set slot_order = requested.ordinality::integer - 1,
      team_id = side_team_id
  from jsonb_array_elements_text(requested_active) with ordinality requested(player_id, ordinality)
  where player_row.match_id = safe_match_id and player_row.user_id = requested.player_id;

  reserves := jsonb_set(reserves, array[safe_side], requested_reserve, true);
  update public.matches
  set reserve_players = reserves,
      played_player_ids = jsonb_set(coalesce(played_player_ids, '{}'::jsonb), array[safe_side], requested_active, true),
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'rosterReady', coalesce(rules->'rosterReady', '{}'::jsonb) || jsonb_build_object(safe_side, true)
      ),
      updated_at = now_at
  where id = safe_match_id;
  insert into public.match_agreements (match_id, user_id, side)
  select safe_match_id, player_id, safe_side from jsonb_array_elements_text(requested_active) player(player_id)
  on conflict (match_id, user_id) do nothing;

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = payload || jsonb_build_object('actionRequired', false, 'homeAction', false, 'resolvedAt', now_at),
      updated_at = now_at
  where target_user_id = safe_actor_id and match_id = safe_match_id and type = 'tournament_match_schedule';
  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = payload || jsonb_build_object('stale', true, 'actionRequired', false),
      updated_at = now_at
  where match_id = safe_match_id and type = 'tournament_roster_assignment'
    and payload->>'sideName' = safe_side
    and not (requested_active || requested_reserve) ? target_user_id;
  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    discord_event, read_at, payload, created_at, updated_at
  )
  select
    'tournament-roster-' || substr(md5(safe_match_id || ':' || safe_side || ':' || assignment.player_id), 1, 24),
    assignment.player_id,
    assignment.player_id,
    '대회 출전 명단',
    case when assignment.role_name = 'active' then '대회 경기 출전 선수로 배정됐습니다.' else '대회 경기 후보 선수로 배정됐습니다.' end,
    'match',
    'tournament_roster_assignment',
    safe_match_id,
    'match',
    null,
    jsonb_build_object(
      'targetUserId', assignment.player_id,
      'tournamentId', current_match.tournament_id,
      'matchId', safe_match_id,
      'teamId', side_team_id,
      'sideName', safe_side,
      'rosterRole', assignment.role_name,
      'webPath', '/app/matches?match=' || safe_match_id
    ),
    now_at,
    now_at
  from (
    select player_id, 'active'::text as role_name from jsonb_array_elements_text(requested_active) player(player_id)
    union all
    select player_id, 'reserve'::text from jsonb_array_elements_text(requested_reserve) player(player_id)
  ) assignment
  on conflict (id) do update set
    body = excluded.body,
    read_at = null,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'action', 'setMatchRecordTeamRoster',
    'matchId', safe_match_id,
    'sideName', safe_side,
    'activeCount', jsonb_array_length(requested_active),
    'reserveCount', jsonb_array_length(requested_reserve),
    'rosterReady', true,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_match_start_action_guarded(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
  capacity integer;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(p_match_id, '')));
  select * into current_match from public.matches where id = nullif(btrim(p_match_id), '') for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.tournament_id is not null then
    capacity := greatest(1, least(5, coalesce(
      (current_match.rules->>'sideCapacity')::integer,
      substring(current_match.mode from '^[0-9]+')::integer,
      5
    )));
    if not coalesce((current_match.rules #>> '{rosterReady,teamA}')::boolean, false)
       or not coalesce((current_match.rules #>> '{rosterReady,teamB}')::boolean, false)
       or (select count(*) from public.match_players where match_id = current_match.id and side = 'teamA') <> capacity
       or (select count(*) from public.match_players where match_id = current_match.id and side = 'teamB') <> capacity then
      raise exception 'tournament_roster_not_ready' using errcode = '23514';
    end if;
  end if;
  return public.rankball_match_start_action(p_actor_profile_id, p_match_id, p_started_at, p_agreed_at, p_attendance);
end;
$$;

create or replace function public.rankball_match_team_roster_action(
  p_actor_profile_id text,
  p_match_id text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_id text;
begin
  select match_row.tournament_id into tournament_id
  from public.matches match_row
  where match_row.id = nullif(btrim(p_match_id), '');
  if tournament_id is not null then
    return public.rankball_tournament_match_roster_action(p_actor_profile_id, p_match_id, p_payload);
  end if;
  return public.rankball_match_room_action(p_actor_profile_id, p_match_id, 'setMatchRecordTeamRoster', p_payload);
end;
$$;

create or replace function public.rankball_is_match_actor(target_match_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_id text := public.current_profile_id();
begin
  if public.current_is_admin(30) then return true; end if;
  if profile_id is null then return false; end if;
  if exists (
    select 1 from public.matches m
    where m.id = target_match_id and profile_id in (m.created_by, m.referee_id, m.former_referee_id)
  ) then return true; end if;
  if exists (
    select 1 from public.match_players mp
    where mp.match_id = target_match_id and mp.user_id = profile_id
  ) then return true; end if;
  if exists (
    select 1
    from public.matches m
    join public.team_members tm on tm.team_id in (m.team_a_id, m.team_b_id)
    where m.id = target_match_id and m.tournament_id is not null
      and tm.user_id = profile_id and tm.role = 'captain'
  ) then return true; end if;
  if exists (
    select 1 from public.matches m
    where m.id = target_match_id and (
      jsonb_path_exists(coalesce(m.reserve_players, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
      or jsonb_path_exists(coalesce(m.played_player_ids, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
      or jsonb_path_exists(coalesce(m.stat_recorders, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
    )
  ) then return true; end if;
  return false;
end;
$$;

update public.matches
set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
      'sideCapacity', greatest(1, least(5, coalesce((rules->>'sideCapacity')::integer, substring(mode from '^[0-9]+')::integer, 5))),
      'rosterReady', jsonb_build_object('teamA', false, 'teamB', false)
    ),
    updated_at = now()
where tournament_id is not null
  and started_at is null
  and ended_at is null
  and confirmed_at is null
  and cancelled_at is null
  and voided_at is null;

insert into public.notifications (
  id, user_id, target_user_id, title, body, tone, type, match_id,
  discord_event, read_at, payload, created_at, updated_at
)
select
  'tournament-schedule-' || substr(md5(match_row.id || ':' || captain.user_id), 1, 24),
  captain.user_id,
  captain.user_id,
  '대회 경기 일정 확정',
  match_row.scheduled_date::text || ' ' || left(match_row.scheduled_time::text, 5) || ' 경기의 출전·후보 명단을 구성하세요.',
  'match',
  'tournament_match_schedule',
  match_row.id,
  'match',
  null,
  jsonb_build_object(
    'targetUserId', captain.user_id,
    'tournamentId', match_row.tournament_id,
    'matchId', match_row.id,
    'teamId', captain.team_id,
    'sideName', case when captain.team_id = match_row.team_a_id then 'teamA' else 'teamB' end,
    'actionRequired', true,
    'homeAction', true,
    'webPath', '/app/matches?match=' || match_row.id
  ),
  now(),
  now()
from public.matches match_row
join public.team_members captain
  on captain.team_id in (match_row.team_a_id, match_row.team_b_id) and captain.role = 'captain'
where match_row.tournament_id is not null
  and match_row.scheduled_date is not null
  and match_row.scheduled_time is not null
  and match_row.started_at is null
  and match_row.ended_at is null
  and match_row.confirmed_at is null
  and match_row.cancelled_at is null
  and match_row.voided_at is null
on conflict (id) do update set
  body = excluded.body,
  target_user_id = excluded.target_user_id,
  read_at = null,
  payload = excluded.payload,
  updated_at = excluded.updated_at;

revoke all on function public.rankball_event_profile_age_group(text) from public, anon, authenticated;
revoke all on function public.rankball_event_profile_mmr(text) from public, anon, authenticated;
revoke all on function public.rankball_event_profile_eligible(text, boolean, text, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_team_event_eligibility(text, integer, boolean, text, numeric, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.rankball_assert_team_event_eligible(text, integer, boolean, text, numeric, text, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_roster_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_team_roster_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_event_profile_age_group(text) to service_role;
grant execute on function public.rankball_event_profile_mmr(text) to service_role;
grant execute on function public.rankball_event_profile_eligible(text, boolean, text, numeric, text, jsonb) to service_role;
grant execute on function public.rankball_team_event_eligibility(text, integer, boolean, text, numeric, text, jsonb, boolean) to service_role;
grant execute on function public.rankball_assert_team_event_eligible(text, integer, boolean, text, numeric, text, jsonb, boolean) to service_role;
grant execute on function public.rankball_tournament_match_roster_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_team_roster_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) to service_role;
grant execute on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
