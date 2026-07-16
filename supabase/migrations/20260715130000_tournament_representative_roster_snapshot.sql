-- Restrict tournament participation to each profile's representative team and freeze eligible rosters at creation.

create or replace function public.rankball_profile_representative_team_id(p_profile_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  explicit_team_id text;
  fallback_team_id text;
begin
  select nullif(btrim(profile_row.app_settings->>'representativeTeamId'), '')
  into explicit_team_id
  from public.profiles profile_row
  where profile_row.id = safe_profile_id;

  if explicit_team_id is not null and exists (
    select 1
    from public.team_members member_row
    join public.teams team_row on team_row.id = member_row.team_id and team_row.deleted_at is null
    where member_row.user_id = safe_profile_id
      and member_row.team_id = explicit_team_id
  ) then
    return explicit_team_id;
  end if;

  select member_row.team_id
  into fallback_team_id
  from public.team_members member_row
  join public.teams team_row on team_row.id = member_row.team_id and team_row.deleted_at is null
  where member_row.user_id = safe_profile_id
  order by team_row.created_at nulls last, team_row.id
  limit 1;

  return fallback_team_id;
end;
$$;

create or replace function public.rankball_tournament_team_roster_snapshot(
  p_team_id text,
  p_capacity integer,
  p_ranked boolean,
  p_mmr_limit_mode text,
  p_mmr_range_mode text,
  p_allowed_age_groups jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_team_id text := nullif(btrim(p_team_id), '');
  safe_capacity integer := greatest(1, least(5, coalesce(p_capacity, 1)));
  team_mmr numeric;
  captain_id text;
  representative_member_ids jsonb := '[]'::jsonb;
  eligible_player_ids jsonb := '[]'::jsonb;
  member_rows jsonb := '[]'::jsonb;
  captain_representative boolean := false;
begin
  select coalesce(team_row.mmr, 1200)
  into team_mmr
  from public.teams team_row
  where team_row.id = safe_team_id
    and team_row.deleted_at is null;
  if team_mmr is null then
    raise exception 'tournament_team_not_found' using errcode = 'P0002';
  end if;

  select member_row.user_id
  into captain_id
  from public.team_members member_row
  where member_row.team_id = safe_team_id
    and member_row.role = 'captain'
  order by member_row.user_id
  limit 1;

  captain_representative := captain_id is not null
    and public.rankball_profile_representative_team_id(captain_id) = safe_team_id;

  with representative_roster as (
    select
      member_row.user_id,
      member_row.role,
      public.rankball_event_profile_age_group(member_row.user_id) as age_group,
      coalesce(public.rankball_event_profile_mmr(member_row.user_id), 1200) as player_mmr,
      public.rankball_event_profile_eligible(
        member_row.user_id,
        p_ranked,
        p_mmr_limit_mode,
        team_mmr,
        p_mmr_range_mode,
        p_allowed_age_groups
      ) as eligible
    from public.team_members member_row
    where member_row.team_id = safe_team_id
      and public.rankball_profile_representative_team_id(member_row.user_id) = safe_team_id
  )
  select
    coalesce(jsonb_agg(user_id order by role, user_id), '[]'::jsonb),
    coalesce(jsonb_agg(user_id order by role, user_id) filter (where eligible), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'userId', user_id,
      'role', role,
      'ageGroup', age_group,
      'mmr', player_mmr,
      'eligible', eligible
    ) order by role, user_id), '[]'::jsonb)
  into representative_member_ids, eligible_player_ids, member_rows
  from representative_roster;

  return jsonb_build_object(
    'teamId', safe_team_id,
    'teamMmr', team_mmr,
    'captainId', captain_id,
    'captainRepresentative', captain_representative,
    'capacity', safe_capacity,
    'representativeMemberIds', representative_member_ids,
    'eligiblePlayerIds', eligible_player_ids,
    'eligibleCount', jsonb_array_length(eligible_player_ids),
    'missingCount', greatest(0, safe_capacity - jsonb_array_length(eligible_player_ids)),
    'members', member_rows,
    'allowed', captain_representative and jsonb_array_length(eligible_player_ids) >= safe_capacity
  );
end;
$$;

create or replace function public.rankball_assert_tournament_team_snapshot_eligible(
  p_team_id text,
  p_capacity integer,
  p_ranked boolean,
  p_mmr_limit_mode text,
  p_mmr_range_mode text,
  p_allowed_age_groups jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  snapshot jsonb;
begin
  snapshot := public.rankball_tournament_team_roster_snapshot(
    p_team_id,
    p_capacity,
    p_ranked,
    p_mmr_limit_mode,
    p_mmr_range_mode,
    p_allowed_age_groups
  );
  if nullif(snapshot->>'captainId', '') is null then
    raise exception 'tournament_team_captain_required' using errcode = '23514';
  end if;
  if not coalesce((snapshot->>'captainRepresentative')::boolean, false) then
    raise exception 'tournament_team_representative_required' using errcode = '23514';
  end if;
  if coalesce((snapshot->>'eligibleCount')::integer, 0) < greatest(1, least(5, coalesce(p_capacity, 1))) then
    raise exception 'tournament_representative_roster_insufficient' using errcode = '23514';
  end if;
  return snapshot;
end;
$$;

create or replace function public.rankball_create_tournament_match_locked(
  p_tournament_id text,
  p_team_a_id text,
  p_team_b_id text,
  p_round integer,
  p_fixture integer,
  p_preferred_match_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  safe_match_id text;
  team_a_name text;
  team_b_name text;
  match_row jsonb;
  now_at timestamptz := now();
begin
  select * into tournament_row
  from public.tournaments
  where id = nullif(btrim(p_tournament_id), '')
  for update;

  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_team_a_id), '') is null or nullif(btrim(p_team_b_id), '') is null or p_team_a_id = p_team_b_id then
    raise exception 'invalid_tournament_pairing' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tournament_teams where tournament_id = tournament_row.id and team_id = p_team_a_id and status = 'accepted')
     or not exists (select 1 from public.tournament_teams where tournament_id = tournament_row.id and team_id = p_team_b_id and status = 'accepted') then
    raise exception 'tournament_pairing_team_not_accepted' using errcode = '23514';
  end if;

  safe_match_id := public.rankball_tournament_match_id(tournament_row.id, p_round, p_fixture, p_preferred_match_id);
  if exists (
    select 1 from public.matches
    where tournament_id = tournament_row.id
      and tournament_round = p_round
      and tournament_fixture = p_fixture
      and id <> safe_match_id
  ) then
    raise exception 'tournament_fixture_already_exists' using errcode = '23505';
  end if;

  select name into team_a_name from public.teams where id = p_team_a_id and deleted_at is null;
  select name into team_b_name from public.teams where id = p_team_b_id and deleted_at is null;
  if team_a_name is null or team_b_name is null then
    raise exception 'tournament_team_not_found' using errcode = 'P0002';
  end if;

  match_row := jsonb_build_object(
    'id', safe_match_id,
    'title', tournament_row.title || ' ' || case when tournament_row.format = 'tournament' then p_round::text || 'R-' || p_fixture::text else 'L-' || p_fixture::text end || ' · ' || team_a_name || ' vs ' || team_b_name,
    'mode', coalesce(tournament_row.mode, '5v5'),
    'court_id', tournament_row.court_id,
    'court_name', coalesce(tournament_row.court_name, '미정'),
    'visibility', coalesce(tournament_row.visibility, 'private'),
    'status', 'agreed',
    'ranked', coalesce(tournament_row.ranked, true),
    'mmr_limit_mode', coalesce(tournament_row.mmr_limit_mode, 'warn'),
    'trust_feedback', '{}'::jsonb,
    'referee_id', null,
    'former_referee_id', null,
    'referee_trust_min', 90,
    'stat_entry_minutes', 60,
    'dispute_minutes', 30,
    'stat_recorders', '{}'::jsonb,
    'played_player_ids', jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
    'reserve_players', jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
    'promoted_reserve_ids', '{}'::jsonb,
    'attendance', jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
    'referee_absence_request', null,
    'dispute_draft_result', null,
    'dispute_draft_updated_at', null,
    'dispute_resolved_at', null,
    'mmr_excluded_player_ids', '[]'::jsonb
  ) || jsonb_build_object(
    'anonymous_players', '{}'::jsonb,
    'tournament_id', tournament_row.id,
    'tournament_format', tournament_row.format,
    'tournament_round', p_round,
    'tournament_fixture', p_fixture,
    'tournament_mmr_policy', tournament_row.mmr_policy,
    'official', coalesce(tournament_row.official, false),
    'pre_registered', true,
    'scheduled_at', '일정 미정',
    'scheduled_date', null,
    'scheduled_time', null,
    'team_a_id', p_team_a_id,
    'team_b_id', p_team_b_id,
    'score_a', 0,
    'score_b', 0,
    'rules', coalesce(tournament_row.rules, '{}'::jsonb) || jsonb_build_object(
      'visibility', tournament_row.visibility,
      'rosterReady', jsonb_build_object('teamA', false, 'teamB', false)
    ),
    'memo', coalesce(nullif(tournament_row.memo, ''), '대회 경기입니다.'),
    'stakes', '대회 경기 MMR 가중치가 적용됩니다.',
    'objection_window', '30분',
    'evidence', '[]'::jsonb,
    'created_by', tournament_row.created_by,
    'created_at', now_at,
    'agreed_at', now_at,
    'started_at', null,
    'ended_at', null,
    'confirmed_at', null,
    'cancelled_at', null,
    'voided_at', null,
    'rating_result', null,
    'team_rating_result', null,
    'updated_at', now_at
  );

  perform public.rankball_persist_match_snapshot(
    match_row,
    '[]'::jsonb,
    null,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    false
  );

  update public.tournaments
  set match_ids = coalesce(match_ids, '[]'::jsonb) || to_jsonb(safe_match_id), updated_at = now_at
  where id = tournament_row.id
    and not coalesce(match_ids, '[]'::jsonb) ? safe_match_id;

  return jsonb_build_object(
    'id', safe_match_id,
    'tournamentId', tournament_row.id,
    'round', p_round,
    'fixture', p_fixture,
    'teamAId', p_team_a_id,
    'teamBId', p_team_b_id,
    'rosterPending', true
  );
end;
$$;

create or replace function public.rankball_tournament_operation_action(
  p_actor_profile_id text,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  draft jsonb := coalesce(p_operation->'draft', '{}'::jsonb);
  safe_tournament_id text := coalesce(
    nullif(btrim(p_operation->>'preferredTournamentId'), ''),
    nullif(btrim(p_operation->>'tournamentId'), ''),
    nullif(btrim(draft->>'id'), '')
  );
  safe_team_id text := nullif(btrim(p_operation->>'teamId'), '');
  team_ids jsonb := '[]'::jsonb;
  preferred_match_ids jsonb := coalesce(p_operation->'preferredMatchIds', draft->'preferredMatchIds', '[]'::jsonb);
  team_count integer;
  missing_team_count integer;
  mmr_spread integer;
  max_mmr_gap integer;
  capacity integer;
  start_date date;
  end_date date;
  tournament_format text;
  tournament_row public.tournaments%rowtype;
  actor_representative_team_id text;
  rules_json jsonb;
  roster_snapshot jsonb;
  team_snapshot jsonb;
  team_entry record;
  now_at timestamptz := now();
  all_accepted boolean := false;
  pair_index integer := 0;
  team_a_id text;
  team_b_id text;
  match_id text;
  created_match jsonb;
  created_matches jsonb := '[]'::jsonb;
  bracket_size integer;
  match_count integer;
  bye_count integer;
  bye_indexes integer[] := array[]::integer[];
  left_index integer;
  right_index integer;
  first_round jsonb := '[]'::jsonb;
  pairings jsonb := '[]'::jsonb;
  byes jsonb := '[]'::jsonb;
  seed_index integer := 0;
  first_a_id text;
  first_b_id text;
  is_bye boolean;
  advance_result jsonb;
  declined_team_ids jsonb := '[]'::jsonb;
begin
  if safe_actor_id is null or not exists (select 1 from public.profiles where id = safe_actor_id) then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_action not in ('createTournament', 'approveTournamentTeam') then
    raise exception 'unsupported_tournament_operation' using errcode = '22023';
  end if;
  if safe_tournament_id is null then
    raise exception 'missing_tournament_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));
  actor_representative_team_id := public.rankball_profile_representative_team_id(safe_actor_id);

  if safe_action = 'createTournament' then
    if exists (select 1 from public.tournaments where id = safe_tournament_id) then
      raise exception 'tournament_already_exists' using errcode = '23505';
    end if;
    if nullif(btrim(draft->>'title'), '') is null then
      raise exception 'missing_tournament_title' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(draft->>'courtId', draft->>'court_id')), '') is null then
      raise exception 'missing_tournament_court' using errcode = '22023';
    end if;

    select coalesce(jsonb_agg(team_id order by ordinality), '[]'::jsonb), count(*)
    into team_ids, team_count
    from (
      select distinct on (team_id) team_id, min(ordinality) as ordinality
      from jsonb_array_elements_text(coalesce(draft->'teamIds', draft->'tournamentTeamIds', '[]'::jsonb)) with ordinality item(team_id, ordinality)
      where nullif(btrim(team_id), '') is not null
      group by team_id
      order by team_id, min(ordinality)
    ) ordered_teams;
    if team_count < 2 then
      raise exception 'tournament_requires_two_teams' using errcode = '23514';
    end if;
    select count(*) into missing_team_count
    from jsonb_array_elements_text(team_ids) item(team_id)
    where not exists (select 1 from public.teams where id = item.team_id and deleted_at is null);
    if missing_team_count > 0 then
      raise exception 'tournament_team_not_found' using errcode = 'P0002';
    end if;
    if actor_representative_team_id is null then
      raise exception 'tournament_representative_team_required' using errcode = '23514';
    end if;
    if not team_ids ? actor_representative_team_id or not exists (
      select 1 from public.team_members
      where team_id = actor_representative_team_id and user_id = safe_actor_id and role = 'captain'
    ) then
      raise exception 'tournament_creator_representative_team_required' using errcode = '23514';
    end if;

    start_date := nullif(coalesce(draft->>'scheduledDate', draft->>'tournamentStartDate'), '')::date;
    end_date := coalesce(nullif(draft->>'tournamentEndDate', '')::date, start_date);
    if start_date is null or end_date is null or start_date < current_date or end_date < start_date or end_date > current_date + 365 then
      raise exception 'invalid_tournament_schedule' using errcode = '22023';
    end if;

    max_mmr_gap := greatest(0, coalesce(nullif(coalesce(draft->>'tournamentMaxMmrGap', draft->>'maxMmrGap'), '')::integer, 250));
    select coalesce(max(mmr), 1200) - coalesce(min(mmr), 1200)
    into mmr_spread
    from public.teams
    where id in (select value from jsonb_array_elements_text(team_ids));
    if coalesce((draft->>'ranked')::boolean, true)
       and coalesce(draft->>'mmrLimitMode', 'warn') = 'block'
       and mmr_spread > max_mmr_gap then
      raise exception 'tournament_mmr_limit_exceeded' using errcode = '23514';
    end if;

    capacity := greatest(1, least(5, coalesce(substring(coalesce(nullif(btrim(draft->>'mode'), ''), '5v5') from '^(\d+)')::integer, 5)));
    rules_json := coalesce(draft->'rules', jsonb_build_object(
      'targetScore', coalesce((draft->>'targetScore')::integer, 21),
      'timeLimit', coalesce((draft->>'timeLimit')::integer, 12),
      'winByTwo', coalesce((draft->>'winByTwo')::boolean, false),
      'ball', coalesce(nullif(draft->>'ball', ''), '7호 공'),
      'attackRule', coalesce(nullif(draft->>'attackRule', ''), '공격권은 득점 후 교대'),
      'foulRule', coalesce(nullif(draft->>'foulRule', ''), '파울 콜 즉시 중단')
    ));
    roster_snapshot := jsonb_build_object('version', 1, 'capturedAt', now_at, 'teams', '{}'::jsonb);
    for team_entry in select value as team_id from jsonb_array_elements_text(team_ids) loop
      team_snapshot := public.rankball_assert_tournament_team_snapshot_eligible(
        team_entry.team_id,
        capacity,
        coalesce((draft->>'ranked')::boolean, true),
        coalesce(nullif(draft->>'mmrLimitMode', ''), nullif(rules_json->>'mmrLimitMode', ''), 'warn'),
        coalesce(nullif(rules_json->>'mmrRangeMode', ''), nullif(draft->>'mmrRangeMode', ''), 'narrow'),
        coalesce(rules_json->'allowedAgeGroups', '[]'::jsonb)
      );
      roster_snapshot := jsonb_set(roster_snapshot, array['teams', team_entry.team_id], team_snapshot, true);
    end loop;
    rules_json := rules_json || jsonb_build_object('teamRosterSnapshot', roster_snapshot);

    tournament_format := case when draft->>'tournamentFormat' = 'tournament' then 'tournament' else 'league' end;
    insert into public.tournaments (
      id, title, format, visibility, status, region, court_id, court_name, mode, ranked,
      official, start_date, end_date, schedule_policy, schedule_note, mmr_limit_mode,
      max_mmr_gap, mmr_policy, rules, memo, created_by, created_at, started_at,
      match_ids, team_statuses, team_approvals, bracket, updated_at
    ) values (
      safe_tournament_id,
      btrim(draft->>'title'),
      tournament_format,
      'private',
      'draft',
      nullif(btrim(draft->>'region'), ''),
      nullif(btrim(coalesce(draft->>'courtId', draft->>'court_id')), ''),
      nullif(btrim(coalesce(draft->>'court', draft->>'courtName')), ''),
      coalesce(nullif(btrim(draft->>'mode'), ''), '5v5'),
      coalesce((draft->>'ranked')::boolean, true),
      coalesce((draft->>'official')::boolean, false),
      start_date,
      end_date,
      coalesce(nullif(btrim(draft->>'tournamentSchedulePolicy'), ''), 'weekly'),
      coalesce(nullif(btrim(draft->>'tournamentScheduleNote'), ''), '초대팀 확정 후 경기별 일정을 배정합니다.'),
      case when draft->>'mmrLimitMode' in ('off', 'warn', 'block') then draft->>'mmrLimitMode' else 'warn' end,
      max_mmr_gap,
      case when draft->>'tournamentMmrPolicy' in ('gap_adjusted', 'standard', 'event_only') then draft->>'tournamentMmrPolicy' else 'gap_adjusted' end,
      rules_json,
      coalesce(nullif(draft->>'memo', ''), '비공개 초대 대회입니다.'),
      safe_actor_id,
      now_at,
      null,
      '[]'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      now_at
    );

    insert into public.tournament_teams (tournament_id, team_id, seed_order, status, approved_by, approved_at)
    select
      safe_tournament_id,
      item.team_id,
      item.ordinality::integer,
      case when item.team_id = actor_representative_team_id then 'accepted' else 'invited' end,
      case when item.team_id = actor_representative_team_id then safe_actor_id else null end,
      case when item.team_id = actor_representative_team_id then now_at else null end
    from jsonb_array_elements_text(team_ids) with ordinality item(team_id, ordinality);
  else
    select * into tournament_row
    from public.tournaments
    where id = safe_tournament_id
      and status = 'draft'
    for update;
    if tournament_row.id is null then
      raise exception 'tournament_not_approvable' using errcode = '23514';
    end if;
    if safe_team_id is null or not exists (
      select 1 from public.tournament_teams where tournament_id = safe_tournament_id and team_id = safe_team_id
    ) then
      raise exception 'tournament_team_not_found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.team_members
      where team_id = safe_team_id and user_id = safe_actor_id and role = 'captain'
    ) then
      raise exception 'tournament_team_captain_required' using errcode = '42501';
    end if;
    if actor_representative_team_id is distinct from safe_team_id then
      raise exception 'tournament_team_representative_required' using errcode = '23514';
    end if;

    if coalesce(jsonb_typeof(tournament_row.rules->'teamRosterSnapshot'), '') <> 'object' then
      capacity := greatest(1, least(5, coalesce(
        (tournament_row.rules->>'sideCapacity')::integer,
        substring(tournament_row.mode from '^(\d+)')::integer,
        5
      )));
      roster_snapshot := jsonb_build_object('version', 1, 'capturedAt', now_at, 'legacyBackfill', true, 'teams', '{}'::jsonb);
      for team_entry in
        select team_id, status
        from public.tournament_teams
        where tournament_id = safe_tournament_id
        order by seed_order
      loop
        team_snapshot := public.rankball_tournament_team_roster_snapshot(
          team_entry.team_id,
          capacity,
          tournament_row.ranked,
          tournament_row.mmr_limit_mode,
          coalesce(nullif(tournament_row.rules->>'mmrRangeMode', ''), 'narrow'),
          coalesce(tournament_row.rules->'allowedAgeGroups', '[]'::jsonb)
        );
        if coalesce((team_snapshot->>'allowed')::boolean, false) then
          roster_snapshot := jsonb_set(roster_snapshot, array['teams', team_entry.team_id], team_snapshot, true);
        else
          update public.tournament_teams
          set status = 'declined', approved_by = null, approved_at = null
          where tournament_id = safe_tournament_id and team_id = team_entry.team_id;
          declined_team_ids := declined_team_ids || to_jsonb(team_entry.team_id);
        end if;
      end loop;
      update public.tournaments
      set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('teamRosterSnapshot', roster_snapshot),
          updated_at = now_at
      where id = safe_tournament_id;
      tournament_row.rules := coalesce(tournament_row.rules, '{}'::jsonb) || jsonb_build_object('teamRosterSnapshot', roster_snapshot);
    end if;

    if not (coalesce(tournament_row.rules #> array['teamRosterSnapshot', 'teams'], '{}'::jsonb) ? safe_team_id) then
      raise exception 'tournament_team_snapshot_missing' using errcode = '23514';
    end if;
    update public.tournament_teams
    set status = 'accepted', approved_by = safe_actor_id, approved_at = now_at
    where tournament_id = safe_tournament_id and team_id = safe_team_id;
  end if;

  select
    coalesce(jsonb_agg(team_id order by seed_order), '[]'::jsonb),
    count(*),
    coalesce(bool_and(status = 'accepted'), false)
  into team_ids, team_count, all_accepted
  from public.tournament_teams
  where tournament_id = safe_tournament_id
    and status <> 'declined';

  if team_count < 2 then
    raise exception 'tournament_requires_two_teams' using errcode = '23514';
  end if;

  if all_accepted and not exists (select 1 from public.matches where tournament_id = safe_tournament_id) then
    select format into tournament_format from public.tournaments where id = safe_tournament_id;
    if tournament_format = 'league' then
      for team_a_index in 0..team_count - 2 loop
        for team_b_index in team_a_index + 1..team_count - 1 loop
          pair_index := pair_index + 1;
          team_a_id := team_ids->>team_a_index;
          team_b_id := team_ids->>team_b_index;
          match_id := preferred_match_ids->>(pair_index - 1);
          created_match := public.rankball_create_tournament_match_locked(safe_tournament_id, team_a_id, team_b_id, 1, pair_index, match_id);
          created_matches := created_matches || created_match;
          pairings := pairings || (created_match || jsonb_build_object('matchId', created_match->>'id', 'bracketMatch', pair_index));
        end loop;
      end loop;
      update public.tournaments
      set status = 'active', started_at = now_at,
          bracket = jsonb_build_object('format', 'league', 'generatedAt', now_at, 'fixtures', pairings),
          updated_at = now_at
      where id = safe_tournament_id;
    else
      bracket_size := 2;
      while bracket_size < team_count loop bracket_size := bracket_size * 2; end loop;
      match_count := bracket_size / 2;
      bye_count := bracket_size - team_count;
      left_index := 0;
      right_index := match_count - 1;
      while cardinality(bye_indexes) < bye_count and left_index <= right_index loop
        bye_indexes := array_append(bye_indexes, left_index);
        if cardinality(bye_indexes) < bye_count and right_index <> left_index then
          bye_indexes := array_append(bye_indexes, right_index);
        end if;
        left_index := left_index + 1;
        right_index := right_index - 1;
      end loop;

      for bracket_pair_index in 0..match_count - 1 loop
        is_bye := bracket_pair_index = any(bye_indexes);
        first_a_id := team_ids->>seed_index;
        seed_index := seed_index + 1;
        first_b_id := null;
        if not is_bye then
          first_b_id := team_ids->>seed_index;
          seed_index := seed_index + 1;
        end if;
        first_round := first_round || jsonb_build_object(
          'id', 'r1-' || (bracket_pair_index + 1)::text,
          'round', 1,
          'fixture', bracket_pair_index + 1,
          'teamAId', first_a_id,
          'teamBId', first_b_id,
          'byeTeamId', case when first_b_id is null then first_a_id else null end
        );
        if first_b_id is null then
          byes := byes || to_jsonb(first_a_id);
        else
          match_id := preferred_match_ids->>jsonb_array_length(created_matches);
          created_match := public.rankball_create_tournament_match_locked(safe_tournament_id, first_a_id, first_b_id, 1, bracket_pair_index + 1, match_id);
          created_matches := created_matches || created_match;
          pairings := pairings || (created_match || jsonb_build_object('matchId', created_match->>'id', 'bracketMatch', bracket_pair_index + 1));
        end if;
      end loop;
      update public.tournaments
      set status = 'active', started_at = now_at,
          bracket = jsonb_build_object(
            'format', 'tournament',
            'generatedAt', now_at,
            'seedOrder', team_ids,
            'bracketSize', bracket_size,
            'slots', (select coalesce(jsonb_agg(slot), '[]'::jsonb) from jsonb_array_elements(first_round) row, lateral jsonb_array_elements(jsonb_build_array(row->'teamAId', row->'teamBId')) slot),
            'firstRound', first_round,
            'rounds', jsonb_build_array(jsonb_build_object('id', 'round-1', 'name', '1라운드', 'pairings', pairings, 'byes', byes))
          ),
          updated_at = now_at
      where id = safe_tournament_id;
      advance_result := public.rankball_tournament_advance_locked(safe_tournament_id);
      created_matches := created_matches || coalesce(advance_result->'createdMatches', '[]'::jsonb);
    end if;
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
  ) values (
    'tournament-action-' || substr(md5(safe_tournament_id || ':' || safe_action || ':' || safe_actor_id || ':' || now_at::text), 1, 24),
    safe_actor_id,
    safe_actor_id,
    case when all_accepted then '대회 시작' when safe_action = 'createTournament' then '대회 생성' else '대회 참가 승인' end,
    case when all_accepted then '초대팀 승인이 완료되어 대진이 생성됐습니다.' when safe_action = 'createTournament' then '대회방을 만들었습니다.' else '대회 참가 승인이 완료됐습니다.' end,
    'match',
    'tournament',
    jsonb_build_object('tournamentId', safe_tournament_id),
    now_at,
    now_at
  ) on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'tournamentId', safe_tournament_id,
    'createdMatches', created_matches,
    'activeTeamCount', team_count,
    'declinedTeamIds', declined_team_ids,
    'tournamentSqlReducer', true,
    'representativeRosterSnapshot', true,
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
  tournament_row public.tournaments%rowtype;
  side_team_id text;
  team_mmr numeric;
  capacity integer;
  captain_id text;
  eligibility jsonb;
  team_snapshot jsonb;
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

  select * into tournament_row from public.tournaments where id = current_match.tournament_id;
  if tournament_row.id is null then raise exception 'tournament_not_found' using errcode = 'P0002'; end if;
  side_team_id := case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
  select user_id into captain_id from public.team_members
  where team_id = side_team_id and role = 'captain'
  order by user_id limit 1;
  if captain_id is null or captain_id <> safe_actor_id then raise exception 'match_side_captain_required' using errcode = '42501'; end if;
  if public.rankball_profile_representative_team_id(safe_actor_id) is distinct from side_team_id then
    raise exception 'tournament_team_representative_required' using errcode = '23514';
  end if;

  capacity := greatest(1, least(5, coalesce(
    (current_match.rules->>'sideCapacity')::integer,
    substring(current_match.mode from '^[0-9]+')::integer,
    5
  )));
  team_snapshot := tournament_row.rules #> array['teamRosterSnapshot', 'teams', side_team_id];
  if jsonb_typeof(tournament_row.rules->'teamRosterSnapshot') = 'object' and coalesce(jsonb_typeof(team_snapshot), '') <> 'object' then
    raise exception 'tournament_team_snapshot_missing' using errcode = '23514';
  end if;
  if jsonb_typeof(team_snapshot) = 'object' then
    eligibility := jsonb_build_object(
      'eligiblePlayerIds', coalesce(team_snapshot->'eligiblePlayerIds', '[]'::jsonb),
      'eligibleCount', coalesce((team_snapshot->>'eligibleCount')::integer, 0)
    );
  else
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
  end if;

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
  if jsonb_array_length(requested_reserve) > 2 then raise exception 'match_reserve_full' using errcode = '23514'; end if;
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
    'representativeRosterSnapshot', jsonb_typeof(team_snapshot) = 'object',
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_profile_representative_team_id(text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_team_roster_snapshot(text, integer, boolean, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_assert_tournament_team_snapshot_eligible(text, integer, boolean, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_operation_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_roster_action(text, text, jsonb) from public, anon, authenticated;

grant execute on function public.rankball_profile_representative_team_id(text) to service_role;
grant execute on function public.rankball_tournament_team_roster_snapshot(text, integer, boolean, text, text, jsonb) to service_role;
grant execute on function public.rankball_assert_tournament_team_snapshot_eligible(text, integer, boolean, text, text, jsonb) to service_role;
grant execute on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) to service_role;
grant execute on function public.rankball_tournament_operation_action(text, jsonb) to service_role;
grant execute on function public.rankball_tournament_match_roster_action(text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
