-- Keep tournament validation, bracket generation, and round advancement inside the database.

create or replace function public.rankball_tournament_match_id(
  p_tournament_id text,
  p_round integer,
  p_fixture integer,
  p_preferred_match_id text default null
)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(p_preferred_match_id), ''),
    'tm_' || substr(md5(coalesce(p_tournament_id, '') || ':' || coalesce(p_round, 0)::text || ':' || coalesce(p_fixture, 0)::text), 1, 24)
  )
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
  capacity integer;
  team_a_name text;
  team_b_name text;
  team_a_players jsonb := '[]'::jsonb;
  team_b_players jsonb := '[]'::jsonb;
  player_rows jsonb := '[]'::jsonb;
  agreement_rows jsonb := '[]'::jsonb;
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

  capacity := greatest(1, least(5, coalesce(substring(tournament_row.mode from '^(\d+)')::integer, 5)));
  select coalesce(jsonb_agg(user_id order by role, user_id), '[]'::jsonb)
  into team_a_players
  from (
    select user_id, role
    from public.team_members
    where team_id = p_team_a_id
    order by role, user_id
    limit capacity
  ) members;
  select coalesce(jsonb_agg(user_id order by role, user_id), '[]'::jsonb)
  into team_b_players
  from (
    select user_id, role
    from public.team_members
    where team_id = p_team_b_id
    order by role, user_id
    limit capacity
  ) members;

  if jsonb_array_length(team_a_players) = 0 or jsonb_array_length(team_b_players) = 0 then
    raise exception 'tournament_team_roster_empty' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(row_value order by side, slot_order), '[]'::jsonb)
  into player_rows
  from (
    select jsonb_build_object(
      'match_id', safe_match_id,
      'team_id', p_team_a_id,
      'user_id', player_id,
      'side', 'teamA',
      'slot_order', ordinality::integer - 1
    ) as row_value, 'teamA' as side, ordinality::integer as slot_order
    from jsonb_array_elements_text(team_a_players) with ordinality as player(player_id, ordinality)
    union all
    select jsonb_build_object(
      'match_id', safe_match_id,
      'team_id', p_team_b_id,
      'user_id', player_id,
      'side', 'teamB',
      'slot_order', ordinality::integer - 1
    ), 'teamB', ordinality::integer
    from jsonb_array_elements_text(team_b_players) with ordinality as player(player_id, ordinality)
  ) rows;

  select coalesce(jsonb_agg(row_value), '[]'::jsonb)
  into agreement_rows
  from (
    select jsonb_build_object('match_id', safe_match_id, 'user_id', player_id, 'side', 'teamA') as row_value
    from jsonb_array_elements_text(team_a_players) player(player_id)
    union all
    select jsonb_build_object('match_id', safe_match_id, 'user_id', player_id, 'side', 'teamB')
    from jsonb_array_elements_text(team_b_players) player(player_id)
  ) rows;

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
    'dispute_minutes', 120,
    'stat_recorders', '{}'::jsonb,
    'played_player_ids', jsonb_build_object('teamA', team_a_players, 'teamB', team_b_players),
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
    'rules', coalesce(tournament_row.rules, '{}'::jsonb) || jsonb_build_object('visibility', tournament_row.visibility),
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
    player_rows,
    null,
    '[]'::jsonb,
    agreement_rows,
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
    'teamBId', p_team_b_id
  );
end;
$$;

create or replace function public.rankball_tournament_node_winner(
  p_tournament_id text,
  p_round integer,
  p_fixture integer
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  first_round_row jsonb;
  match_row public.matches%rowtype;
begin
  select * into tournament_row from public.tournaments where id = p_tournament_id;
  if tournament_row.id is null then return null; end if;

  if p_round = 1 then
    select value into first_round_row
    from jsonb_array_elements(coalesce(tournament_row.bracket->'firstRound', '[]'::jsonb))
    where coalesce((value->>'fixture')::integer, 0) = p_fixture
    limit 1;
    if nullif(first_round_row->>'byeTeamId', '') is not null then
      return first_round_row->>'byeTeamId';
    end if;
  end if;

  select * into match_row
  from public.matches
  where tournament_id = p_tournament_id
    and tournament_round = p_round
    and tournament_fixture = p_fixture
    and status = 'confirmed'
  limit 1;
  if match_row.id is null or match_row.score_a = match_row.score_b then return null; end if;
  return case when match_row.score_a > match_row.score_b then match_row.team_a_id else match_row.team_b_id end;
end;
$$;

create or replace function public.rankball_tournament_advance_locked(p_tournament_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  bracket_size integer;
  total_rounds integer;
  fixture_count integer;
  team_a_id text;
  team_b_id text;
  champion_id text;
  created_match jsonb;
  created_matches jsonb := '[]'::jsonb;
  rounds jsonb;
  round_index integer;
  round_entry jsonb;
  pairing jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(coalesce(p_tournament_id, '')));
  select * into tournament_row from public.tournaments where id = p_tournament_id for update;
  if tournament_row.id is null or tournament_row.format <> 'tournament' or tournament_row.status not in ('active', 'closed') then
    return jsonb_build_object('ok', true, 'skipped', true, 'createdMatches', created_matches);
  end if;

  bracket_size := greatest(2, coalesce((tournament_row.bracket->>'bracketSize')::integer, 2));
  total_rounds := greatest(1, ceil(ln(bracket_size::numeric) / ln(2::numeric))::integer);

  for round_no in 2..total_rounds loop
    fixture_count := greatest(1, bracket_size / power(2, round_no)::integer);
    for fixture_no in 1..fixture_count loop
      if exists (
        select 1 from public.matches
        where tournament_id = tournament_row.id
          and tournament_round = round_no
          and tournament_fixture = fixture_no
      ) then continue; end if;

      team_a_id := public.rankball_tournament_node_winner(tournament_row.id, round_no - 1, (fixture_no - 1) * 2 + 1);
      team_b_id := public.rankball_tournament_node_winner(tournament_row.id, round_no - 1, (fixture_no - 1) * 2 + 2);
      if team_a_id is null or team_b_id is null then continue; end if;

      created_match := public.rankball_create_tournament_match_locked(
        tournament_row.id,
        team_a_id,
        team_b_id,
        round_no,
        fixture_no,
        null
      );
      created_matches := created_matches || created_match;

      select bracket->'rounds' into rounds from public.tournaments where id = tournament_row.id;
      rounds := coalesce(rounds, '[]'::jsonb);
      round_index := round_no - 1;
      while jsonb_array_length(rounds) <= round_index loop
        rounds := rounds || jsonb_build_object(
          'id', 'round-' || (jsonb_array_length(rounds) + 1)::text,
          'name', (jsonb_array_length(rounds) + 1)::text || '라운드',
          'pairings', '[]'::jsonb,
          'byes', '[]'::jsonb
        );
      end loop;
      round_entry := rounds->round_index;
      pairing := created_match || jsonb_build_object(
        'matchId', created_match->>'id',
        'bracketMatch', fixture_no,
        'sourceRound', round_no - 1,
        'sourceFixtures', jsonb_build_array((fixture_no - 1) * 2 + 1, (fixture_no - 1) * 2 + 2)
      );
      round_entry := jsonb_set(
        round_entry,
        '{pairings}',
        coalesce(round_entry->'pairings', '[]'::jsonb) || pairing,
        true
      );
      rounds := jsonb_set(rounds, array[round_index::text], round_entry, true);
      update public.tournaments
      set bracket = jsonb_set(jsonb_set(coalesce(bracket, '{}'::jsonb), '{rounds}', rounds, true), '{updatedAt}', to_jsonb(now()), true),
          updated_at = now()
      where id = tournament_row.id;
    end loop;
  end loop;

  champion_id := public.rankball_tournament_node_winner(tournament_row.id, total_rounds, 1);
  if champion_id is not null then
    update public.tournaments
    set status = 'closed',
        bracket = coalesce(bracket, '{}'::jsonb) || jsonb_build_object('championTeamId', champion_id, 'completedAt', now()),
        updated_at = now()
    where id = tournament_row.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'tournamentId', tournament_row.id,
    'createdMatches', created_matches,
    'championTeamId', champion_id
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
  start_date date;
  end_date date;
  tournament_format text;
  now_at timestamptz := now();
  all_accepted boolean;
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
      coalesce(draft->'rules', jsonb_build_object(
        'targetScore', coalesce((draft->>'targetScore')::integer, 21),
        'timeLimit', coalesce((draft->>'timeLimit')::integer, 12),
        'winByTwo', coalesce((draft->>'winByTwo')::boolean, false),
        'ball', coalesce(nullif(draft->>'ball', ''), '7호 공'),
        'attackRule', coalesce(nullif(draft->>'attackRule', ''), '공격권은 득점 후 교대'),
        'foulRule', coalesce(nullif(draft->>'foulRule', ''), '파울은 콜한 쪽 기준으로 즉시 중단')
      )),
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
      case when exists (
        select 1 from public.team_members
        where team_id = item.team_id and user_id = safe_actor_id and role = 'captain'
      ) then 'accepted' else 'invited' end,
      case when exists (
        select 1 from public.team_members
        where team_id = item.team_id and user_id = safe_actor_id and role = 'captain'
      ) then safe_actor_id else null end,
      case when exists (
        select 1 from public.team_members
        where team_id = item.team_id and user_id = safe_actor_id and role = 'captain'
      ) then now_at else null end
    from jsonb_array_elements_text(team_ids) with ordinality item(team_id, ordinality);
  else
    select jsonb_agg(team_id order by seed_order), count(*)
    into team_ids, team_count
    from public.tournament_teams
    where tournament_id = safe_tournament_id;
    if not exists (select 1 from public.tournaments where id = safe_tournament_id and status = 'draft') then
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
    update public.tournament_teams
    set status = 'accepted', approved_by = safe_actor_id, approved_at = now_at
    where tournament_id = safe_tournament_id and team_id = safe_team_id;
  end if;

  select bool_and(status = 'accepted') into all_accepted
  from public.tournament_teams
  where tournament_id = safe_tournament_id;

  if all_accepted and not exists (select 1 from public.matches where tournament_id = safe_tournament_id) then
    select format into tournament_format from public.tournaments where id = safe_tournament_id;
    if tournament_format = 'league' then
      team_count := jsonb_array_length(team_ids);
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
      team_count := jsonb_array_length(team_ids);
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
    'tournamentSqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

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
  if current_match.status in ('confirmed', 'cancelled', 'void', 'closed') or current_match.started_at is not null then
    raise exception 'tournament_match_schedule_locked' using errcode = '23514';
  end if;
  update public.matches
  set scheduled_date = tournament_match_schedule_action.schedule_date,
      scheduled_time = tournament_match_schedule_action.schedule_time,
      scheduled_at = tournament_match_schedule_action.schedule_date::text || ' ' || left(tournament_match_schedule_action.schedule_time::text, 5),
      updated_at = now()
  where id = safe_match_id;
  return jsonb_build_object(
    'ok', true,
    'action', 'updateTournamentMatchSchedule',
    'tournamentId', safe_tournament_id,
    'matchId', safe_match_id,
    'scheduledDate', schedule_date,
    'scheduledTime', left(schedule_time::text, 5),
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_tournament_advance_on_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tournament_id is not null and new.tournament_format = 'tournament' and new.status = 'confirmed'
     and (tg_op = 'INSERT' or old.status is distinct from new.status or old.score_a is distinct from new.score_a or old.score_b is distinct from new.score_b) then
    perform public.rankball_tournament_advance_locked(new.tournament_id);
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_tournament_advance_on_match_trigger on public.matches;
create trigger rankball_tournament_advance_on_match_trigger
after insert or update of status, score_a, score_b on public.matches
for each row execute function public.rankball_tournament_advance_on_match();

revoke all on function public.rankball_tournament_match_id(text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_node_winner(text, integer, integer) from public, anon, authenticated;
revoke all on function public.rankball_tournament_advance_locked(text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_operation_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_tournament_match_id(text, integer, integer, text) to service_role;
grant execute on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) to service_role;
grant execute on function public.rankball_tournament_node_winner(text, integer, integer) to service_role;
grant execute on function public.rankball_tournament_advance_locked(text) to service_role;
grant execute on function public.rankball_tournament_operation_action(text, jsonb) to service_role;
grant execute on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
