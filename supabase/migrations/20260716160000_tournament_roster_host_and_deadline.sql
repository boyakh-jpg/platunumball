-- Lock tournament sides to the first confirmed lineup and resolve lineup deadlines without MMR changes.

do $$
begin
  if to_regprocedure('public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_tournament_match_roster_action(text,text,jsonb)') is null then
      raise exception 'rankball_tournament_match_roster_action_missing' using errcode = '42883';
    end if;
    execute 'alter function public.rankball_tournament_match_roster_action(text, text, jsonb) rename to rankball_tournament_match_roster_action_legacy';
  end if;
end;
$$;

create or replace function public.rankball_swap_match_side_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  next_value jsonb;
  item_row record;
  next_key text;
begin
  if p_value is null then return null; end if;

  case jsonb_typeof(p_value)
    when 'object' then
      next_value := '{}'::jsonb;
      for item_row in select key, value from jsonb_each(p_value) loop
        next_key := case item_row.key
          when 'teamA' then 'teamB'
          when 'teamB' then 'teamA'
          when 'scoreA' then 'scoreB'
          when 'scoreB' then 'scoreA'
          when 'teamAId' then 'teamBId'
          when 'teamBId' then 'teamAId'
          when 'teamAName' then 'teamBName'
          when 'teamBName' then 'teamAName'
          else item_row.key
        end;
        next_value := next_value || jsonb_build_object(
          next_key,
          public.rankball_swap_match_side_json(item_row.value)
        );
      end loop;
      return next_value;
    when 'array' then
      select coalesce(
        jsonb_agg(public.rankball_swap_match_side_json(element.value) order by element.ordinality),
        '[]'::jsonb
      )
      into next_value
      from jsonb_array_elements(p_value) with ordinality element(value, ordinality);
      return next_value;
    when 'string' then
      if p_value = to_jsonb('teamA'::text) then return to_jsonb('teamB'::text); end if;
      if p_value = to_jsonb('teamB'::text) then return to_jsonb('teamA'::text); end if;
      return p_value;
    else
      return p_value;
  end case;
end;
$$;

create or replace function public.rankball_tournament_match_swap_pregame_sides(
  p_match_id text,
  p_changed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  changed_at timestamptz := coalesce(p_changed_at, now());
  current_match public.matches%rowtype;
  next_team_a_name text;
  next_team_b_name text;
begin
  if safe_match_id is null then
    raise exception 'match_side_swap_target_missing' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.tournament_id is null then raise exception 'tournament_match_required' using errcode = '23514'; end if;
  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null
     or exists (select 1 from public.match_results result_row where result_row.match_id = safe_match_id) then
    raise exception 'tournament_match_side_swap_locked' using errcode = '23514';
  end if;

  select team_row.name into next_team_a_name
  from public.teams team_row
  where team_row.id = current_match.team_b_id;
  select team_row.name into next_team_b_name
  from public.teams team_row
  where team_row.id = current_match.team_a_id;

  update public.match_players player_row
  set team_id = case player_row.side
        when 'teamA' then current_match.team_a_id
        when 'teamB' then current_match.team_b_id
        else player_row.team_id
      end,
      side = case player_row.side
        when 'teamA' then 'teamB'
        when 'teamB' then 'teamA'
        else player_row.side
      end
  where player_row.match_id = safe_match_id
    and player_row.side in ('teamA', 'teamB');

  update public.match_agreements agreement_row
  set side = case agreement_row.side when 'teamA' then 'teamB' else 'teamA' end
  where agreement_row.match_id = safe_match_id
    and agreement_row.side in ('teamA', 'teamB');

  update public.match_approvals approval_row
  set side = case approval_row.side when 'teamA' then 'teamB' else 'teamA' end
  where approval_row.match_id = safe_match_id
    and approval_row.side in ('teamA', 'teamB');

  update public.notifications notification_row
  set payload = public.rankball_swap_match_side_json(coalesce(notification_row.payload, '{}'::jsonb)),
      updated_at = changed_at
  where notification_row.match_id = safe_match_id;

  update public.discord_notification_deliveries delivery_row
  set payload = public.rankball_swap_match_side_json(coalesce(delivery_row.payload, '{}'::jsonb)),
      updated_at = changed_at
  where delivery_row.payload->>'matchId' = safe_match_id
     or delivery_row.notification_id in (
       select notification_row.id
       from public.notifications notification_row
       where notification_row.match_id = safe_match_id
     );

  update public.matches match_row
  set title = case
        when current_match.tournament_fixture is not null then
          case
            when current_match.tournament_format = 'tournament'
              then coalesce(current_match.tournament_round, 1)::text || 'R-' || current_match.tournament_fixture::text
            else 'L-' || current_match.tournament_fixture::text
          end || ' · ' || coalesce(next_team_a_name, 'A') || ' vs ' || coalesce(next_team_b_name, 'B')
        else current_match.title
      end,
      team_a_id = current_match.team_b_id,
      team_b_id = current_match.team_a_id,
      score_a = current_match.score_b,
      score_b = current_match.score_a,
      rules = public.rankball_swap_match_side_json(coalesce(current_match.rules, '{}'::jsonb)),
      evidence = public.rankball_swap_match_side_json(coalesce(current_match.evidence, '[]'::jsonb)),
      trust_feedback = public.rankball_swap_match_side_json(coalesce(current_match.trust_feedback, '{}'::jsonb)),
      stat_recorders = public.rankball_swap_match_side_json(coalesce(current_match.stat_recorders, '{}'::jsonb)),
      played_player_ids = public.rankball_swap_match_side_json(coalesce(current_match.played_player_ids, '{}'::jsonb)),
      reserve_players = public.rankball_swap_match_side_json(coalesce(current_match.reserve_players, '{}'::jsonb)),
      promoted_reserve_ids = public.rankball_swap_match_side_json(coalesce(current_match.promoted_reserve_ids, '{}'::jsonb)),
      attendance = public.rankball_swap_match_side_json(coalesce(current_match.attendance, '{}'::jsonb)),
      referee_absence_request = public.rankball_swap_match_side_json(current_match.referee_absence_request),
      dispute_draft_result = public.rankball_swap_match_side_json(current_match.dispute_draft_result),
      anonymous_players = public.rankball_swap_match_side_json(coalesce(current_match.anonymous_players, '{}'::jsonb)),
      rating_result = public.rankball_swap_match_side_json(current_match.rating_result),
      team_rating_result = public.rankball_swap_match_side_json(current_match.team_rating_result),
      updated_at = changed_at
  where match_row.id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'teamAId', current_match.team_b_id,
    'teamBId', current_match.team_a_id,
    'swapped', true
  );
end;
$$;

create or replace function public.rankball_tournament_match_roster_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  capacity integer;
  organizer_id text;
begin
  if new.tournament_id is null then return new; end if;

  capacity := greatest(1, least(5, coalesce(
    (new.rules->>'sideCapacity')::integer,
    substring(coalesce(new.mode, '5v5') from '^[0-9]+')::integer,
    5
  )));
  select tournament_row.created_by
  into organizer_id
  from public.tournaments tournament_row
  where tournament_row.id = new.tournament_id;

  new.rules := (
    coalesce(new.rules, '{}'::jsonb)
      - 'tournamentHostPlayerId'
      - 'tournamentHostTeamId'
      - 'tournamentHostSide'
      - 'lineupDeadlineOutcome'
  ) || jsonb_build_object(
    'sideCapacity', capacity,
    'rosterReady', jsonb_build_object('teamA', false, 'teamB', false),
    'rosterReadyAt', '{}'::jsonb,
    'lineupDeadlineState', 'pending',
    'lineupDeadlineCheckedAt', null,
    'tournamentOrganizerId', coalesce(
      nullif(btrim(new.rules->>'tournamentOrganizerId'), ''),
      organizer_id,
      new.created_by
    ),
    'tournamentSideAssignmentLocked', false,
    'sideAssignmentLocked', false
  );
  return new;
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
  current_match public.matches%rowtype;
  actor_team_id text;
  actor_side text;
  organizer_id text;
  assignment_locked boolean;
  deadline_status text;
  sanitized_payload jsonb;
  legacy_result jsonb;
  ready_at jsonb;
  now_at timestamptz := now();
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'match_roster_target_missing' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.tournament_id is null then raise exception 'tournament_match_required' using errcode = '23514'; end if;

  deadline_status := coalesce(nullif(current_match.rules->>'lineupDeadlineState', ''), 'pending');
  if deadline_status <> 'pending' then
    raise exception 'tournament_lineup_deadline_locked' using errcode = '23514';
  end if;

  select member_row.team_id
  into actor_team_id
  from public.team_members member_row
  where member_row.user_id = safe_actor_id
    and member_row.role = 'captain'
    and member_row.team_id in (current_match.team_a_id, current_match.team_b_id)
    and member_row.team_id = public.rankball_profile_representative_team_id(safe_actor_id)
  order by member_row.team_id
  limit 1;

  if actor_team_id is null then
    raise exception 'match_side_captain_required' using errcode = '42501';
  end if;

  actor_side := case when actor_team_id = current_match.team_a_id then 'teamA' else 'teamB' end;
  assignment_locked := coalesce(current_match.rules->>'tournamentSideAssignmentLocked', 'false') = 'true'
    or coalesce(current_match.rules->>'sideAssignmentLocked', 'false') = 'true';

  if not assignment_locked and actor_side = 'teamB' then
    perform public.rankball_tournament_match_swap_pregame_sides(safe_match_id, now_at);
    select * into current_match from public.matches where id = safe_match_id for update;
    actor_side := 'teamA';
  end if;

  sanitized_payload := jsonb_set(
    coalesce(p_payload, '{}'::jsonb),
    '{sideName}',
    to_jsonb(actor_side),
    true
  );
  legacy_result := public.rankball_tournament_match_roster_action_legacy(
    safe_actor_id,
    safe_match_id,
    sanitized_payload
  );

  select * into current_match from public.matches where id = safe_match_id for update;
  select tournament_row.created_by
  into organizer_id
  from public.tournaments tournament_row
  where tournament_row.id = current_match.tournament_id;
  organizer_id := coalesce(
    nullif(btrim(current_match.rules->>'tournamentOrganizerId'), ''),
    organizer_id,
    current_match.created_by
  );
  ready_at := coalesce(current_match.rules->'rosterReadyAt', '{}'::jsonb)
    || jsonb_build_object(actor_side, now_at);

  update public.matches match_row
  set created_by = case when assignment_locked then match_row.created_by else safe_actor_id end,
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'tournamentOrganizerId', organizer_id,
        'tournamentHostPlayerId', case
          when assignment_locked then coalesce(nullif(match_row.rules->>'tournamentHostPlayerId', ''), match_row.created_by)
          else safe_actor_id
        end,
        'tournamentHostTeamId', case
          when assignment_locked then coalesce(nullif(match_row.rules->>'tournamentHostTeamId', ''), match_row.team_a_id)
          else actor_team_id
        end,
        'tournamentHostSide', case
          when assignment_locked then coalesce(nullif(match_row.rules->>'tournamentHostSide', ''), 'teamA')
          else 'teamA'
        end,
        'tournamentSideAssignmentLocked', true,
        'sideAssignmentLocked', true,
        'rosterReadyAt', ready_at,
        'lineupDeadlineState', 'pending',
        'lineupDeadlineCheckedAt', null
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  return coalesce(legacy_result, '{}'::jsonb) || jsonb_build_object(
    'sideName', actor_side,
    'teamId', actor_team_id,
    'tournamentHostPlayerId', case when assignment_locked then current_match.rules->>'tournamentHostPlayerId' else safe_actor_id end,
    'tournamentHostTeamId', case when assignment_locked then current_match.rules->>'tournamentHostTeamId' else actor_team_id end,
    'tournamentHostSide', 'teamA',
    'sideAssignmentLocked', true,
    'rosterReadyAt', now_at
  );
end;
$$;

-- Rebind the generic roster reducer after the tournament function rename. PostgreSQL
-- dependencies otherwise keep pointing at the renamed legacy function by OID.
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
  safe_court_id text;
  safe_court_name text;
  allowed_court_ids jsonb;
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
  if current_match.status in ('cancelled', 'void', 'voided', 'closed', 'confirmed')
     or current_match.started_at is not null
     or current_match.ended_at is not null then
    raise exception 'tournament_match_schedule_locked' using errcode = '23514';
  end if;

  safe_court_id := coalesce(
    nullif(btrim(p_schedule->>'courtId'), ''),
    current_match.court_id,
    current_tournament.court_id
  );
  allowed_court_ids := case
    when jsonb_typeof(current_tournament.rules->'allowedCourtIds') = 'array'
      then current_tournament.rules->'allowedCourtIds'
    else '[]'::jsonb
  end;
  if safe_court_id is null or (
    safe_court_id is distinct from current_tournament.court_id
    and not allowed_court_ids ? safe_court_id
  ) then
    raise exception 'tournament_court_not_allowed' using errcode = '23514';
  end if;

  select court_source.name
  into safe_court_name
  from (
    select approved.name, 1 as priority
    from public.approved_courts approved
    where approved.id = safe_court_id
      and coalesce(approved.status, 'active') in ('active', 'approved')
      and approved.hidden_at is null
    union all
    select legacy.name, 2 as priority
    from public.courts legacy
    where legacy.id = safe_court_id
  ) court_source
  order by court_source.priority
  limit 1;
  safe_court_name := coalesce(
    safe_court_name,
    case when safe_court_id = current_tournament.court_id then current_tournament.court_name end
  );
  if safe_court_name is null then
    raise exception 'tournament_court_not_active' using errcode = '23514';
  end if;

  update public.matches match_row
  set scheduled_date = tournament_match_schedule_action.schedule_date,
      scheduled_time = tournament_match_schedule_action.schedule_time,
      scheduled_at = tournament_match_schedule_action.schedule_date::text || ' ' || left(tournament_match_schedule_action.schedule_time::text, 5),
      court_id = tournament_match_schedule_action.safe_court_id,
      court_name = tournament_match_schedule_action.safe_court_name,
      rules = (coalesce(match_row.rules, '{}'::jsonb) - 'lineupDeadlineOutcome') || jsonb_build_object(
        'rosterReady', jsonb_build_object('teamA', false, 'teamB', false),
        'rosterReadyAt', '{}'::jsonb,
        'lineupDeadlineState', 'pending',
        'lineupDeadlineCheckedAt', null,
        'tournamentOrganizerId', coalesce(
          nullif(btrim(match_row.rules->>'tournamentOrganizerId'), ''),
          current_tournament.created_by
        )
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  update public.notifications notification_row
  set read_at = coalesce(notification_row.read_at, now_at),
      payload = coalesce(notification_row.payload, '{}'::jsonb) || jsonb_build_object(
        'actionRequired', false,
        'homeAction', false,
        'cancelled', true,
        'cancelledAt', now_at,
        'cancelReason', 'tournament_rescheduled'
      ),
      updated_at = now_at
  where notification_row.match_id = safe_match_id
    and notification_row.type = 'tournament_lineup_deadline_review';

  update public.discord_notification_deliveries delivery_row
  set status = 'cancelled',
      payload = coalesce(delivery_row.payload, '{}'::jsonb) || jsonb_build_object(
        'status', 'cancelled',
        'cancelledAt', now_at,
        'cancelReason', 'tournament_rescheduled'
      ),
      last_error = 'tournament_rescheduled',
      updated_at = now_at
  where delivery_row.status = 'queued'
    and delivery_row.sent_at is null
    and delivery_row.notification_id in (
      select notification_row.id
      from public.notifications notification_row
      where notification_row.match_id = safe_match_id
        and notification_row.type = 'tournament_lineup_deadline_review'
    );

  for captain_row in
    select member_row.user_id as captain_id, member_row.team_id,
      case when member_row.team_id = current_match.team_a_id then 'teamA' else 'teamB' end as side_name
    from public.team_members member_row
    where member_row.role = 'captain'
      and member_row.team_id in (current_match.team_a_id, current_match.team_b_id)
  loop
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id,
      discord_event, read_at, payload, created_at, updated_at
    ) values (
      'tournament-schedule-' || substr(md5(safe_match_id || ':' || captain_row.captain_id), 1, 24),
      captain_row.captain_id,
      captain_row.captain_id,
      '대회 경기 일정 확정',
      schedule_date::text || ' ' || left(schedule_time::text, 5) || ' · ' || safe_court_name || ' 경기의 출전·후보 명단을 구성하세요.',
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
        'courtId', safe_court_id,
        'courtName', safe_court_name,
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
    'courtId', safe_court_id,
    'courtName', safe_court_name,
    'captainNotificationCount', notified_count,
    'lineupDeadlineState', 'pending',
    'sideAssignmentLocked', coalesce(current_match.rules->>'tournamentSideAssignmentLocked', 'false') = 'true'
      or coalesce(current_match.rules->>'sideAssignmentLocked', 'false') = 'true',
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
  team_a_count integer;
  team_b_count integer;
  team_a_mismatch boolean;
  team_b_mismatch boolean;
  deadline_at timestamptz;
  ready_at_a timestamptz;
  ready_at_b timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(p_match_id, '')));
  select * into current_match
  from public.matches
  where id = nullif(btrim(p_match_id), '')
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  if current_match.tournament_id is not null then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then
      raise exception 'tournament_schedule_required' using errcode = '23514';
    end if;
    capacity := greatest(1, least(5, coalesce(
      (current_match.rules->>'sideCapacity')::integer,
      substring(current_match.mode from '^[0-9]+')::integer,
      5
    )));
    deadline_at := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    ready_at_a := nullif(current_match.rules #>> '{rosterReadyAt,teamA}', '')::timestamptz;
    ready_at_b := nullif(current_match.rules #>> '{rosterReadyAt,teamB}', '')::timestamptz;

    select
      count(*) filter (where player_row.side = 'teamA'),
      count(*) filter (where player_row.side = 'teamB'),
      coalesce(bool_or(player_row.side = 'teamA' and player_row.team_id is distinct from current_match.team_a_id), false),
      coalesce(bool_or(player_row.side = 'teamB' and player_row.team_id is distinct from current_match.team_b_id), false)
    into team_a_count, team_b_count, team_a_mismatch, team_b_mismatch
    from public.match_players player_row
    where player_row.match_id = current_match.id
      and player_row.side in ('teamA', 'teamB');

    if coalesce(current_match.rules #>> '{rosterReady,teamA}', 'false') <> 'true'
       or coalesce(current_match.rules #>> '{rosterReady,teamB}', 'false') <> 'true'
       or team_a_count <> capacity
       or team_b_count <> capacity
       or team_a_mismatch
       or team_b_mismatch
       or ready_at_a is null
       or ready_at_b is null
       or ready_at_a > deadline_at
       or ready_at_b > deadline_at then
      raise exception 'tournament_roster_not_ready' using errcode = '23514';
    end if;
  end if;

  return public.rankball_match_start_action(
    p_actor_profile_id,
    p_match_id,
    p_started_at,
    p_agreed_at,
    p_attendance
  );
end;
$$;

create or replace function public.rankball_tournament_match_lineup_deadline_action(
  p_match_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
<<automatic_lineup_deadline>>
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_now timestamptz := coalesce(p_now, now());
  safe_tournament_id text;
  current_tournament public.tournaments%rowtype;
  current_match public.matches%rowtype;
  deadline_at timestamptz;
  ready_at_a timestamptz;
  ready_at_b timestamptz;
  capacity integer;
  team_a_count integer;
  team_b_count integer;
  team_a_mismatch boolean;
  team_b_mismatch boolean;
  team_a_ready boolean;
  team_b_ready boolean;
  deadline_status text;
  organizer_id text;
  result_submitter_id text;
  losing_side text;
  winning_side text;
  winner_team_id text;
  loser_team_id text;
  winner_team_name text;
  loser_team_name text;
  next_score_a integer;
  next_score_b integer;
  excluded_player_ids jsonb := '[]'::jsonb;
  captain_row record;
  notification_count integer := 0;
  cancelled_notification_count integer := 0;
  cancelled_delivery_count integer := 0;
  changed_count integer := 0;
begin
  if safe_match_id is null then
    raise exception 'tournament_lineup_deadline_target_missing' using errcode = '22023';
  end if;

  select match_row.tournament_id
  into safe_tournament_id
  from public.matches match_row
  where match_row.id = safe_match_id;
  if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_tournament_id is null then raise exception 'tournament_match_required' using errcode = '23514'; end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_tournament
  from public.tournaments
  where id = safe_tournament_id
  for update;
  if current_tournament.id is null then raise exception 'tournament_not_found' using errcode = 'P0002'; end if;
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null or current_match.tournament_id is distinct from safe_tournament_id then
    raise exception 'tournament_match_not_found' using errcode = 'P0002';
  end if;

  deadline_status := coalesce(nullif(current_match.rules->>'lineupDeadlineState', ''), 'pending');
  if deadline_status in ('ready', 'forfeit', 'organizer_review') then
    return jsonb_build_object(
      'ok', true,
      'action', 'processTournamentLineupDeadline',
      'matchId', safe_match_id,
      'tournamentId', safe_tournament_id,
      'status', deadline_status,
      'processed', false,
      'idempotent', true,
      'checkedAt', current_match.rules->'lineupDeadlineCheckedAt'
    );
  end if;

  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null
     or exists (select 1 from public.match_results result_row where result_row.match_id = safe_match_id) then
    return jsonb_build_object(
      'ok', true,
      'action', 'processTournamentLineupDeadline',
      'matchId', safe_match_id,
      'tournamentId', safe_tournament_id,
      'status', 'skipped_terminal',
      'processed', false,
      'idempotent', true
    );
  end if;

  if current_match.scheduled_date is null or current_match.scheduled_time is null then
    raise exception 'tournament_match_schedule_required' using errcode = '23514';
  end if;
  deadline_at := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
  if safe_now < deadline_at then
    return jsonb_build_object(
      'ok', true,
      'action', 'processTournamentLineupDeadline',
      'matchId', safe_match_id,
      'tournamentId', safe_tournament_id,
      'status', 'pending',
      'processed', false,
      'idempotent', false,
      'deadlineAt', deadline_at
    );
  end if;

  capacity := greatest(1, least(5, coalesce(
    (current_match.rules->>'sideCapacity')::integer,
    substring(current_match.mode from '^[0-9]+')::integer,
    5
  )));
  ready_at_a := nullif(current_match.rules #>> '{rosterReadyAt,teamA}', '')::timestamptz;
  ready_at_b := nullif(current_match.rules #>> '{rosterReadyAt,teamB}', '')::timestamptz;
  select
    count(*) filter (where player_row.side = 'teamA'),
    count(*) filter (where player_row.side = 'teamB'),
    coalesce(bool_or(player_row.side = 'teamA' and player_row.team_id is distinct from current_match.team_a_id), false),
    coalesce(bool_or(player_row.side = 'teamB' and player_row.team_id is distinct from current_match.team_b_id), false)
  into team_a_count, team_b_count, team_a_mismatch, team_b_mismatch
  from public.match_players player_row
  where player_row.match_id = safe_match_id
    and player_row.side in ('teamA', 'teamB');

  team_a_ready := coalesce(current_match.rules #>> '{rosterReady,teamA}', 'false') = 'true'
    and team_a_count = capacity
    and not team_a_mismatch
    and ready_at_a is not null
    and ready_at_a <= deadline_at;
  team_b_ready := coalesce(current_match.rules #>> '{rosterReady,teamB}', 'false') = 'true'
    and team_b_count = capacity
    and not team_b_mismatch
    and ready_at_b is not null
    and ready_at_b <= deadline_at;
  organizer_id := coalesce(
    nullif(btrim(current_match.rules->>'tournamentOrganizerId'), ''),
    current_tournament.created_by,
    current_match.created_by
  );

  update public.discord_notification_deliveries delivery_row
  set status = 'cancelled',
      payload = coalesce(delivery_row.payload, '{}'::jsonb) || jsonb_build_object(
        'status', 'cancelled',
        'cancelledAt', safe_now,
        'cancelReason', 'lineup_deadline_processed'
      ),
      last_error = 'lineup_deadline_processed',
      updated_at = safe_now
  where delivery_row.status = 'queued'
    and delivery_row.sent_at is null
    and delivery_row.notification_id in (
      select notification_row.id
      from public.notifications notification_row
      where notification_row.match_id = safe_match_id
        and (
          notification_row.type in (
            'tournament_match_schedule'
          )
          or (
            not (team_a_ready and team_b_ready)
            and (
              notification_row.type in (
                'match_match_reminder_24h',
                'match_match_reminder_2h',
                'match_match_reminder_1h',
                'match_match_manager_checkin_10m',
                'match_match_manager_start_now'
              )
              or notification_row.id like 'notice-match-reminder-%'
              or notification_row.id like 'notice-match-manager-%'
            )
          )
        )
    );
  get diagnostics cancelled_delivery_count = row_count;

  update public.notifications notification_row
  set read_at = coalesce(notification_row.read_at, safe_now),
      payload = coalesce(notification_row.payload, '{}'::jsonb) || jsonb_build_object(
        'actionRequired', false,
        'homeAction', false,
        'cancelled', true,
        'cancelledAt', safe_now,
        'cancelReason', 'lineup_deadline_processed'
      ),
      updated_at = safe_now
  where notification_row.match_id = safe_match_id
    and notification_row.read_at is null
    and (
      notification_row.type in (
        'tournament_match_schedule'
      )
      or (
        not (team_a_ready and team_b_ready)
        and (
          notification_row.type in (
            'match_match_reminder_24h',
            'match_match_reminder_2h',
            'match_match_reminder_1h',
            'match_match_manager_checkin_10m',
            'match_match_manager_start_now'
          )
          or notification_row.id like 'notice-match-reminder-%'
          or notification_row.id like 'notice-match-manager-%'
        )
      )
    );
  get diagnostics cancelled_notification_count = row_count;

  if team_a_ready and team_b_ready then
    update public.matches match_row
    set rules = (coalesce(match_row.rules, '{}'::jsonb) - 'lineupDeadlineOutcome') || jsonb_build_object(
          'tournamentOrganizerId', organizer_id,
          'lineupDeadlineState', 'ready',
          'lineupDeadlineCheckedAt', safe_now,
          'lineupDeadlineOutcome', jsonb_build_object(
            'kind', 'lineup_deadline',
            'status', 'ready',
            'automatic', true,
            'deadlineAt', deadline_at,
            'processedAt', safe_now
          )
        ),
        updated_at = safe_now
    where match_row.id = safe_match_id;

    return jsonb_build_object(
      'ok', true,
      'action', 'processTournamentLineupDeadline',
      'matchId', safe_match_id,
      'tournamentId', safe_tournament_id,
      'status', 'ready',
      'processed', true,
      'deadlineAt', deadline_at,
      'cancelledNotificationCount', cancelled_notification_count,
      'cancelledDeliveryCount', cancelled_delivery_count,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  if not team_a_ready and not team_b_ready then
    if organizer_id is null or not exists (select 1 from public.profiles profile_row where profile_row.id = organizer_id) then
      raise exception 'tournament_organizer_missing' using errcode = '23514';
    end if;

    update public.matches match_row
    set rules = (coalesce(match_row.rules, '{}'::jsonb) - 'lineupDeadlineOutcome') || jsonb_build_object(
          'tournamentOrganizerId', organizer_id,
          'lineupDeadlineState', 'organizer_review',
          'lineupDeadlineCheckedAt', safe_now,
          'lineupDeadlineOutcome', jsonb_build_object(
            'kind', 'lineup_deadline',
            'status', 'organizer_review',
            'automatic', true,
            'deadlineAt', deadline_at,
            'processedAt', safe_now,
            'winnerAssigned', false
          )
        ),
        updated_at = safe_now
    where match_row.id = safe_match_id;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id,
      discord_event, read_at, payload, created_at, updated_at
    ) values (
      'tournament-lineup-review-' || substr(md5(safe_match_id || ':' || organizer_id), 1, 24),
      organizer_id,
      organizer_id,
      '대회 라인업 확인 필요',
      '양 팀 모두 마감 전 출전 명단을 확정하지 않았습니다. 승자를 지정하지 말고 확인하세요.',
      'match',
      'tournament_lineup_deadline_review',
      safe_match_id,
      'match',
      null,
      jsonb_build_object(
        'targetUserId', organizer_id,
        'tournamentId', safe_tournament_id,
        'matchId', safe_match_id,
        'kind', 'lineup_deadline',
        'status', 'organizer_review',
        'automatic', true,
        'winnerAssigned', false,
        'deadlineAt', deadline_at,
        'actionRequired', true,
        'homeAction', true,
        'webPath', '/app/tournaments/' || safe_tournament_id
      ),
      safe_now,
      safe_now
    ) on conflict (id) do update set
      title = excluded.title,
      body = excluded.body,
      target_user_id = excluded.target_user_id,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
    get diagnostics notification_count = row_count;

    return jsonb_build_object(
      'ok', true,
      'action', 'processTournamentLineupDeadline',
      'matchId', safe_match_id,
      'tournamentId', safe_tournament_id,
      'status', 'organizer_review',
      'processed', true,
      'winnerAssigned', false,
      'deadlineAt', deadline_at,
      'organizerNotificationCount', notification_count,
      'cancelledNotificationCount', cancelled_notification_count,
      'cancelledDeliveryCount', cancelled_delivery_count,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  losing_side := case when team_a_ready then 'teamB' else 'teamA' end;
  winning_side := case when losing_side = 'teamA' then 'teamB' else 'teamA' end;
  winner_team_id := case when winning_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
  loser_team_id := case when losing_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
  next_score_a := case when losing_side = 'teamA' then 0 else 1 end;
  next_score_b := case when losing_side = 'teamB' then 0 else 1 end;
  result_submitter_id := case
    when exists (select 1 from public.profiles profile_row where profile_row.id = organizer_id) then organizer_id
    else null
  end;

  select coalesce(jsonb_agg(distinct player_row.user_id), '[]'::jsonb)
  into excluded_player_ids
  from public.match_players player_row
  where player_row.match_id = safe_match_id;
  select team_row.name into winner_team_name from public.teams team_row where team_row.id = winner_team_id;
  select team_row.name into loser_team_name from public.teams team_row where team_row.id = loser_team_id;

  insert into public.match_results (
    match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at
  ) values (
    safe_match_id, result_submitter_id, next_score_a, next_score_b, '{}'::jsonb, safe_now
  );

  update public.matches match_row
  set status = 'confirmed',
      score_a = next_score_a,
      score_b = next_score_b,
      mmr_excluded_player_ids = excluded_player_ids,
      rules = (coalesce(match_row.rules, '{}'::jsonb) - 'lineupDeadlineOutcome') || jsonb_build_object(
        'tournamentOrganizerId', organizer_id,
        'lineupDeadlineState', 'forfeit',
        'lineupDeadlineCheckedAt', safe_now,
        'lineupDeadlineOutcome', jsonb_build_object(
          'kind', 'lineup_deadline',
          'status', 'forfeit',
          'automatic', true,
          'losingSide', losing_side,
          'winningSide', winning_side,
          'deadlineAt', deadline_at,
          'processedAt', safe_now
        ),
        'forfeit', jsonb_build_object(
          'kind', 'lineup_deadline',
          'automatic', true,
          'losingSide', losing_side,
          'reason', 'lineup_deadline',
          'decidedBy', organizer_id,
          'decidedAt', safe_now,
          'deadlineAt', deadline_at,
          'mmrCommitted', false
        )
      ),
      ended_at = safe_now,
      confirmed_at = safe_now,
      rating_result = null,
      team_rating_result = null,
      updated_at = safe_now
  where match_row.id = safe_match_id;

  notification_count := 0;
  for captain_row in
    select member_row.user_id as captain_id, member_row.team_id,
      case when member_row.team_id = current_match.team_a_id then 'teamA' else 'teamB' end as side_name
    from public.team_members member_row
    where member_row.role = 'captain'
      and member_row.team_id in (current_match.team_a_id, current_match.team_b_id)
  loop
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id,
      discord_event, read_at, payload, created_at, updated_at
    ) values (
      'tournament-lineup-deadline-' || substr(md5(safe_match_id || ':' || captain_row.captain_id), 1, 24),
      captain_row.captain_id,
      captain_row.captain_id,
      '대회 라인업 마감 몰수',
      coalesce(winner_team_name, '준비 완료 팀') || ' 1:0 몰수승 · ' || coalesce(loser_team_name, '미확정 팀') || ' 라인업 미확정',
      'match',
      'tournament_match_lineup_deadline',
      safe_match_id,
      'match',
      null,
      jsonb_build_object(
        'targetUserId', captain_row.captain_id,
        'tournamentId', safe_tournament_id,
        'matchId', safe_match_id,
        'teamId', captain_row.team_id,
        'sideName', captain_row.side_name,
        'kind', 'lineup_deadline',
        'automatic', true,
        'losingSide', losing_side,
        'winnerTeamId', winner_team_id,
        'loserTeamId', loser_team_id,
        'deadlineAt', deadline_at,
        'actionRequired', false,
        'homeAction', false,
        'webPath', '/app/tournaments/' || safe_tournament_id
      ),
      safe_now,
      safe_now
    ) on conflict (id) do update set
      title = excluded.title,
      body = excluded.body,
      target_user_id = excluded.target_user_id,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
    notification_count := notification_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'action', 'processTournamentLineupDeadline',
    'matchId', safe_match_id,
    'tournamentId', safe_tournament_id,
    'status', 'forfeit',
    'processed', true,
    'automatic', true,
    'kind', 'lineup_deadline',
    'losingSide', losing_side,
    'winnerTeamId', winner_team_id,
    'scoreA', next_score_a,
    'scoreB', next_score_b,
    'ratingCommitted', false,
    'captainNotificationCount', notification_count,
    'cancelledNotificationCount', cancelled_notification_count,
    'cancelledDeliveryCount', cancelled_delivery_count,
    'deadlineAt', deadline_at,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_tournament_lineup_deadline_batch_action(
  p_now timestamptz default now(),
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_now timestamptz := coalesce(p_now, now());
  safe_limit integer := greatest(1, least(500, coalesce(p_limit, 100)));
  match_row record;
  match_result jsonb;
  results jsonb := '[]'::jsonb;
  checked_count integer := 0;
  ready_count integer := 0;
  forfeit_count integer := 0;
  review_count integer := 0;
  skipped_count integer := 0;
begin
  for match_row in
    select match_source.id
    from public.matches match_source
    where match_source.tournament_id is not null
      and match_source.scheduled_date is not null
      and match_source.scheduled_time is not null
      and ((match_source.scheduled_date + match_source.scheduled_time) at time zone 'Asia/Seoul') <= safe_now
      and match_source.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
      and match_source.started_at is null
      and match_source.ended_at is null
      and match_source.confirmed_at is null
      and match_source.cancelled_at is null
      and match_source.voided_at is null
      and coalesce(nullif(match_source.rules->>'lineupDeadlineState', ''), 'pending') = 'pending'
      and not exists (
        select 1 from public.match_results result_row where result_row.match_id = match_source.id
      )
    order by ((match_source.scheduled_date + match_source.scheduled_time) at time zone 'Asia/Seoul'), match_source.id
    limit safe_limit
  loop
    match_result := public.rankball_tournament_match_lineup_deadline_action(match_row.id, safe_now);
    results := results || jsonb_build_array(match_result);
    checked_count := checked_count + 1;
    case match_result->>'status'
      when 'ready' then ready_count := ready_count + 1;
      when 'forfeit' then forfeit_count := forfeit_count + 1;
      when 'organizer_review' then review_count := review_count + 1;
      else skipped_count := skipped_count + 1;
    end case;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'action', 'processTournamentLineupDeadlineBatch',
    'pNow', safe_now,
    'limit', safe_limit,
    'checkedCount', checked_count,
    'readyCount', ready_count,
    'forfeitCount', forfeit_count,
    'organizerReviewCount', review_count,
    'skippedCount', skipped_count,
    'results', results,
    'sqlReducer', true
  );
end;
$$;

-- Backfill only unfinished tournament matches. Confirmed and otherwise terminal results stay untouched.
do $$
declare
  match_ref record;
  current_match public.matches%rowtype;
  organizer_id text;
  host_player_id text;
  host_team_id text;
  capacity integer;
  team_a_count integer;
  team_b_count integer;
  team_a_mismatch boolean;
  team_b_mismatch boolean;
  team_a_ready boolean;
  team_b_ready boolean;
  assignment_locked boolean;
  deadline_at timestamptz;
  backfill_ready_at timestamptz;
  next_rules jsonb;
  deadline_status text;
begin
  for match_ref in
    select match_row.id
    from public.matches match_row
    where match_row.tournament_id is not null
      and match_row.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
      and match_row.started_at is null
      and match_row.ended_at is null
      and match_row.confirmed_at is null
      and match_row.cancelled_at is null
      and match_row.voided_at is null
      and not exists (
        select 1 from public.match_results result_row where result_row.match_id = match_row.id
      )
    order by match_row.id
  loop
    perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(match_ref.id));
    select * into current_match
    from public.matches
    where id = match_ref.id
    for update;
    if current_match.id is null then continue; end if;

    select tournament_row.created_by
    into organizer_id
    from public.tournaments tournament_row
    where tournament_row.id = current_match.tournament_id;
    organizer_id := coalesce(
      nullif(btrim(current_match.rules->>'tournamentOrganizerId'), ''),
      organizer_id,
      current_match.created_by
    );
    capacity := greatest(1, least(5, coalesce(
      (current_match.rules->>'sideCapacity')::integer,
      substring(current_match.mode from '^[0-9]+')::integer,
      5
    )));
    select
      count(*) filter (where player_row.side = 'teamA'),
      count(*) filter (where player_row.side = 'teamB'),
      coalesce(bool_or(player_row.side = 'teamA' and player_row.team_id is distinct from current_match.team_a_id), false),
      coalesce(bool_or(player_row.side = 'teamB' and player_row.team_id is distinct from current_match.team_b_id), false)
    into team_a_count, team_b_count, team_a_mismatch, team_b_mismatch
    from public.match_players player_row
    where player_row.match_id = current_match.id
      and player_row.side in ('teamA', 'teamB');

    team_a_ready := coalesce(current_match.rules #>> '{rosterReady,teamA}', 'false') = 'true'
      and team_a_count = capacity
      and not team_a_mismatch;
    team_b_ready := coalesce(current_match.rules #>> '{rosterReady,teamB}', 'false') = 'true'
      and team_b_count = capacity
      and not team_b_mismatch;
    assignment_locked := coalesce(current_match.rules->>'tournamentSideAssignmentLocked', 'false') = 'true'
      or coalesce(current_match.rules->>'sideAssignmentLocked', 'false') = 'true';
    deadline_status := coalesce(nullif(current_match.rules->>'lineupDeadlineState', ''), 'pending');
    backfill_ready_at := coalesce(current_match.updated_at, current_match.created_at, now());
    if current_match.scheduled_date is not null and current_match.scheduled_time is not null then
      deadline_at := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
      backfill_ready_at := least(backfill_ready_at, deadline_at);
    end if;

    if not assignment_locked and team_b_ready and not team_a_ready then
      perform public.rankball_tournament_match_swap_pregame_sides(current_match.id, now());
      select * into current_match from public.matches where id = match_ref.id for update;
      team_a_ready := true;
      team_b_ready := false;
    end if;

    host_player_id := null;
    host_team_id := null;
    if assignment_locked then
      host_player_id := nullif(btrim(current_match.rules->>'tournamentHostPlayerId'), '');
      host_team_id := nullif(btrim(current_match.rules->>'tournamentHostTeamId'), '');
      if host_team_id is null then host_team_id := current_match.team_a_id; end if;
      if host_player_id is null and host_team_id is not null then
        select member_row.user_id
        into host_player_id
        from public.team_members member_row
        where member_row.team_id = host_team_id
          and member_row.role = 'captain'
          and public.rankball_profile_representative_team_id(member_row.user_id) = host_team_id
        order by member_row.user_id
        limit 1;
      end if;
    elsif team_a_ready then
      host_team_id := current_match.team_a_id;
      select member_row.user_id
      into host_player_id
      from public.team_members member_row
      where member_row.team_id = host_team_id
        and member_row.role = 'captain'
        and public.rankball_profile_representative_team_id(member_row.user_id) = host_team_id
      order by member_row.user_id
      limit 1;
    end if;

    next_rules := coalesce(current_match.rules, '{}'::jsonb) || jsonb_build_object(
      'tournamentOrganizerId', organizer_id,
      'rosterReady', jsonb_build_object('teamA', team_a_ready, 'teamB', team_b_ready),
      'rosterReadyAt',
        case when team_a_ready then jsonb_build_object('teamA', backfill_ready_at) else '{}'::jsonb end
        || case when team_b_ready then jsonb_build_object('teamB', backfill_ready_at) else '{}'::jsonb end,
      'lineupDeadlineState', deadline_status,
      'lineupDeadlineCheckedAt', current_match.rules->'lineupDeadlineCheckedAt'
    );
    if host_player_id is not null and host_team_id is not null then
      next_rules := next_rules || jsonb_build_object(
        'tournamentHostPlayerId', host_player_id,
        'tournamentHostTeamId', host_team_id,
        'tournamentHostSide', 'teamA',
        'tournamentSideAssignmentLocked', true,
        'sideAssignmentLocked', true
      );
    elsif not assignment_locked then
      next_rules := next_rules || jsonb_build_object(
        'tournamentSideAssignmentLocked', false,
        'sideAssignmentLocked', false
      );
    end if;

    update public.matches match_row
    set created_by = coalesce(host_player_id, match_row.created_by),
        rules = next_rules,
        updated_at = now()
    where match_row.id = current_match.id;
  end loop;
end;
$$;

revoke all on function public.rankball_swap_match_side_json(jsonb) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_swap_pregame_sides(text, timestamptz) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_roster_defaults() from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_roster_action_legacy(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_roster_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_team_roster_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_lineup_deadline_action(text, timestamptz) from public, anon, authenticated;
revoke all on function public.rankball_tournament_lineup_deadline_batch_action(timestamptz, integer) from public, anon, authenticated;

grant execute on function public.rankball_tournament_match_roster_defaults() to service_role;
grant execute on function public.rankball_tournament_match_roster_action_legacy(text, text, jsonb) to service_role;
grant execute on function public.rankball_tournament_match_roster_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_team_roster_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) to service_role;
grant execute on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) to service_role;
grant execute on function public.rankball_tournament_match_lineup_deadline_action(text, timestamptz) to service_role;
grant execute on function public.rankball_tournament_lineup_deadline_batch_action(timestamptz, integer) to service_role;

select pg_notify('pgrst', 'reload schema');
