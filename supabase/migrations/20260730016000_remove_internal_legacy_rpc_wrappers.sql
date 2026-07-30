begin;

-- The public manual-finalization contract stays four-argument. Its owner-only
-- live dispatch no longer routes through the retired three-argument overload.
do $migration$
declare
  target_function regprocedure := to_regprocedure(
    'public.rankball_match_finalize_locked(text,text,text,boolean)'
  );
  function_definition text;
  old_call constant text := $old$  return public.rankball_match_finalize_locked(
    p_actor_profile_id,
    safe_match_id,
    coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );$old$;
  new_call constant text := $new$  return public.rankball_match_live_finalize_action(
    p_actor_profile_id,
    safe_match_id,
    coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );$new$;
begin
  if target_function is null then
    raise exception 'rankball_match_finalize_locked_4arg_missing'
      using errcode = '42883';
  end if;

  function_definition := pg_get_functiondef(target_function);
  if position(new_call in function_definition) = 0 then
    if position(old_call in function_definition) = 0 then
      raise exception 'rankball_match_finalize_locked_4arg_dispatch_shape_changed'
        using errcode = '55000';
    end if;
    execute replace(function_definition, old_call, new_call);
  end if;
end;
$migration$;

-- Convert every remaining internal three-argument finalizer caller before the
-- compatibility router is removed. These callers already resolve a valid
-- host/referee operator and therefore use the owner-only live finalizer.
do $migration$
declare
  target_signature text;
  target_function regprocedure;
  function_definition text;
  legacy_call constant text := 'rankball_match_finalize_locked(';
  live_call constant text := 'rankball_match_live_finalize_action(';
begin
  foreach target_signature in array array[
    'public.rankball_match_auto_finalize_action_pre_record_window(text,timestamptz)',
    'public.rankball_match_resolve_dispute_action_pre_score_policy(text,text,text,text)',
    'public.rankball_review_void_match_report(text,integer,text,text,text,text,integer,text,text)'
  ] loop
    target_function := to_regprocedure(target_signature);
    if target_function is null then
      raise exception 'internal_finalizer_caller_missing: %', target_signature
        using errcode = '42883';
    end if;

    function_definition := pg_get_functiondef(target_function);
    if position(live_call in function_definition) = 0 then
      if position(legacy_call in function_definition) = 0 then
        raise exception 'internal_finalizer_call_shape_changed: %', target_signature
          using errcode = '55000';
      end if;
      execute replace(function_definition, legacy_call, live_call);
    end if;

    if position(
      legacy_call in pg_get_functiondef(target_function)
    ) > 0 then
      raise exception 'internal_finalizer_legacy_call_remains: %', target_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$migration$;

-- Inline the current tournament roster reducer. This preserves the host-side
-- wrapper, representative roster snapshot, and the latest 0..3 bench policy.
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
  safe_side text;
  current_match public.matches%rowtype;
  tournament_row public.tournaments%rowtype;
  actor_team_id text;
  actor_side text;
  organizer_id text;
  assignment_locked boolean;
  deadline_status text;
  side_team_id text;
  team_mmr numeric;
  capacity integer;
  bench_capacity integer;
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
  ready_at jsonb;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'match_roster_target_missing' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.tournament_id is null then
    raise exception 'tournament_match_required' using errcode = '23514';
  end if;

  deadline_status := coalesce(
    nullif(current_match.rules->>'lineupDeadlineState', ''),
    'pending'
  );
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

  actor_side := case
    when actor_team_id = current_match.team_a_id then 'teamA'
    else 'teamB'
  end;
  assignment_locked :=
    coalesce(current_match.rules->>'tournamentSideAssignmentLocked', 'false') = 'true'
    or coalesce(current_match.rules->>'sideAssignmentLocked', 'false') = 'true';

  if not assignment_locked and actor_side = 'teamB' then
    perform public.rankball_tournament_match_swap_pregame_sides(
      safe_match_id,
      now_at
    );
    select * into current_match
    from public.matches
    where id = safe_match_id
    for update;
    actor_side := 'teamA';
  end if;
  safe_side := actor_side;

  if current_match.scheduled_date is null or current_match.scheduled_time is null then
    raise exception 'tournament_schedule_required' using errcode = '23514';
  end if;
  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or exists (
       select 1
       from public.match_results result
       where result.match_id = safe_match_id
     ) then
    raise exception 'match_roster_locked' using errcode = '23514';
  end if;

  select * into tournament_row
  from public.tournaments
  where id = current_match.tournament_id;
  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;

  side_team_id := case
    when safe_side = 'teamA' then current_match.team_a_id
    else current_match.team_b_id
  end;
  select member_row.user_id
  into captain_id
  from public.team_members member_row
  where member_row.team_id = side_team_id
    and member_row.role = 'captain'
  order by member_row.user_id
  limit 1;
  if captain_id is null or captain_id <> safe_actor_id then
    raise exception 'match_side_captain_required' using errcode = '42501';
  end if;
  if public.rankball_profile_representative_team_id(safe_actor_id)
     is distinct from side_team_id then
    raise exception 'tournament_team_representative_required' using errcode = '23514';
  end if;

  capacity := greatest(1, least(5, coalesce(
    (current_match.rules->>'sideCapacity')::integer,
    substring(current_match.mode from '^[0-9]+')::integer,
    5
  )));
  bench_capacity := case
    when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-3]$'
      then (current_match.rules->>'benchCapacity')::integer
    else 2
  end;

  team_snapshot := tournament_row.rules
    #> array['teamRosterSnapshot', 'teams', side_team_id];
  if jsonb_typeof(tournament_row.rules->'teamRosterSnapshot') = 'object'
     and coalesce(jsonb_typeof(team_snapshot), '') <> 'object' then
    raise exception 'tournament_team_snapshot_missing' using errcode = '23514';
  end if;
  if jsonb_typeof(team_snapshot) = 'object' then
    eligibility := jsonb_build_object(
      'eligiblePlayerIds',
      coalesce(team_snapshot->'eligiblePlayerIds', '[]'::jsonb),
      'eligibleCount',
      coalesce((team_snapshot->>'eligibleCount')::integer, 0)
    );
  else
    select coalesce(team_row.mmr, 1200)
    into team_mmr
    from public.teams team_row
    where team_row.id = side_team_id;
    eligibility := public.rankball_assert_team_event_eligible(
      side_team_id,
      capacity,
      current_match.ranked,
      coalesce(
        nullif(current_match.rules->>'mmrLimitMode', ''),
        current_match.mmr_limit_mode
      ),
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
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_payload #> '{roster,playerIds}') = 'array'
          then p_payload #> '{roster,playerIds}'
        else '[]'::jsonb
      end
    ) with ordinality player(player_id, ordinality)
    group by player_id
    order by min(ordinality)
  ) selected;

  select coalesce(jsonb_agg(player_id order by first_order), '[]'::jsonb)
  into requested_reserve
  from (
    select player_id, min(ordinality)::integer as first_order
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_payload #> '{roster,reservePlayerIds}') = 'array'
          then p_payload #> '{roster,reservePlayerIds}'
        else '[]'::jsonb
      end
    ) with ordinality player(player_id, ordinality)
    group by player_id
    order by min(ordinality)
  ) selected;

  if jsonb_array_length(requested_active) <> capacity then
    raise exception 'team_eligible_roster_insufficient' using errcode = '23514';
  end if;
  if jsonb_array_length(requested_reserve) > bench_capacity then
    raise exception 'match_reserve_full' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(requested_active || requested_reserve)
      player(player_id)
    where not coalesce(eligibility->'eligiblePlayerIds', '[]'::jsonb)
      ? player.player_id
  ) then
    raise exception 'team_roster_player_ineligible' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(requested_reserve) reserve(player_id)
    where requested_active ? reserve.player_id
  ) then
    raise exception 'match_roster_duplicate_player' using errcode = '23514';
  end if;

  reserves := coalesce(
    current_match.reserve_players,
    jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb)
  );
  select coalesce(jsonb_agg(player_row.user_id), '[]'::jsonb)
  into other_side_ids
  from public.match_players player_row
  where player_row.match_id = safe_match_id
    and player_row.side <> safe_side;
  other_side_ids := other_side_ids || coalesce(
    reserves->(
      case when safe_side = 'teamA' then 'teamB' else 'teamA' end
    ),
    '[]'::jsonb
  );
  if exists (
    select 1
    from jsonb_array_elements_text(requested_active || requested_reserve)
      player(player_id)
    where other_side_ids ? player.player_id
  ) then
    raise exception 'match_roster_cross_side_duplicate' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      player_row.user_id
      order by player_row.slot_order, player_row.user_id
    ),
    '[]'::jsonb
  )
  into existing_active
  from public.match_players player_row
  where player_row.match_id = safe_match_id
    and player_row.side = safe_side;
  if jsonb_array_length(existing_active) > capacity then
    raise exception 'match_roster_slot_overflow' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(player_id), '[]'::jsonb)
  into stale_active
  from jsonb_array_elements_text(existing_active) player(player_id)
  where not requested_active ? player.player_id;

  select coalesce(jsonb_agg(player_id), '[]'::jsonb)
  into new_active
  from jsonb_array_elements_text(requested_active) player(player_id)
  where not existing_active ? player.player_id;

  if jsonb_array_length(new_active) > 0 then
    for slot_index in 0..jsonb_array_length(new_active) - 1 loop
      if slot_index < jsonb_array_length(stale_active) then
        update public.match_players
        set user_id = new_active->>slot_index,
            team_id = side_team_id
        where match_id = safe_match_id
          and side = safe_side
          and user_id = stale_active->>slot_index;
      else
        insert into public.match_players (
          match_id,
          team_id,
          user_id,
          side,
          slot_order
        )
        values (
          safe_match_id,
          side_team_id,
          new_active->>slot_index,
          safe_side,
          jsonb_array_length(existing_active) + slot_index
        )
        on conflict (match_id, user_id) do update
        set team_id = excluded.team_id,
            side = excluded.side,
            slot_order = excluded.slot_order;
      end if;
    end loop;
  end if;

  update public.match_players player_row
  set slot_order = requested.ordinality::integer - 1,
      team_id = side_team_id
  from jsonb_array_elements_text(requested_active)
    with ordinality requested(player_id, ordinality)
  where player_row.match_id = safe_match_id
    and player_row.user_id = requested.player_id;

  reserves := jsonb_set(reserves, array[safe_side], requested_reserve, true);
  update public.matches match_row
  set reserve_players = reserves,
      played_player_ids = jsonb_set(
        coalesce(match_row.played_player_ids, '{}'::jsonb),
        array[safe_side],
        requested_active,
        true
      ),
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'rosterReady',
        coalesce(match_row.rules->'rosterReady', '{}'::jsonb)
          || jsonb_build_object(safe_side, true)
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  insert into public.match_agreements (match_id, user_id, side)
  select safe_match_id, player_id, safe_side
  from jsonb_array_elements_text(requested_active) player(player_id)
  on conflict (match_id, user_id) do nothing;

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = payload || jsonb_build_object(
        'actionRequired', false,
        'homeAction', false,
        'resolvedAt', now_at
      ),
      updated_at = now_at
  where target_user_id = safe_actor_id
    and match_id = safe_match_id
    and type = 'tournament_match_schedule';

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = payload || jsonb_build_object(
        'stale', true,
        'actionRequired', false
      ),
      updated_at = now_at
  where match_id = safe_match_id
    and type = 'tournament_roster_assignment'
    and payload->>'sideName' = safe_side
    and not (requested_active || requested_reserve) ? target_user_id;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    match_id,
    discord_event,
    read_at,
    payload,
    created_at,
    updated_at
  )
  select
    'tournament-roster-' || substr(
      md5(safe_match_id || ':' || safe_side || ':' || assignment.player_id),
      1,
      24
    ),
    assignment.player_id,
    assignment.player_id,
    '대회 출전 명단',
    case
      when assignment.role_name = 'active'
        then '대회 경기 출전 선수로 배정됐습니다.'
      else '대회 경기 후보 선수로 배정됐습니다.'
    end,
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
    select player_id, 'active'::text as role_name
    from jsonb_array_elements_text(requested_active) player(player_id)
    union all
    select player_id, 'reserve'::text
    from jsonb_array_elements_text(requested_reserve) player(player_id)
  ) assignment
  on conflict (id) do update
  set body = excluded.body,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

  select tournament.created_by
  into organizer_id
  from public.tournaments tournament
  where tournament.id = current_match.tournament_id;
  organizer_id := coalesce(
    nullif(btrim(current_match.rules->>'tournamentOrganizerId'), ''),
    organizer_id,
    current_match.created_by
  );
  ready_at := coalesce(current_match.rules->'rosterReadyAt', '{}'::jsonb)
    || jsonb_build_object(actor_side, now_at);

  update public.matches match_row
  set created_by = case
        when assignment_locked then match_row.created_by
        else safe_actor_id
      end,
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'tournamentOrganizerId', organizer_id,
        'tournamentHostPlayerId', case
          when assignment_locked then coalesce(
            nullif(match_row.rules->>'tournamentHostPlayerId', ''),
            match_row.created_by
          )
          else safe_actor_id
        end,
        'tournamentHostTeamId', case
          when assignment_locked then coalesce(
            nullif(match_row.rules->>'tournamentHostTeamId', ''),
            match_row.team_a_id
          )
          else actor_team_id
        end,
        'tournamentHostSide', case
          when assignment_locked then coalesce(
            nullif(match_row.rules->>'tournamentHostSide', ''),
            'teamA'
          )
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

  return jsonb_build_object(
    'ok', true,
    'action', 'setMatchRecordTeamRoster',
    'matchId', safe_match_id,
    'sideName', actor_side,
    'teamId', actor_team_id,
    'activeCount', jsonb_array_length(requested_active),
    'reserveCount', jsonb_array_length(requested_reserve),
    'rosterReady', true,
    'representativeRosterSnapshot', jsonb_typeof(team_snapshot) = 'object',
    'tournamentHostPlayerId', case
      when assignment_locked then current_match.rules->>'tournamentHostPlayerId'
      else safe_actor_id
    end,
    'tournamentHostTeamId', case
      when assignment_locked then current_match.rules->>'tournamentHostTeamId'
      else actor_team_id
    end,
    'tournamentHostSide', 'teamA',
    'sideAssignmentLocked', true,
    'rosterReadyAt', now_at,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

do $migration$
declare
  blocking_functions text;
begin
  if to_regprocedure(
    'public.rankball_match_finalize_locked(text,text,text)'
  ) is null then
    raise exception 'rankball_match_finalize_locked_3arg_missing'
      using errcode = '42883';
  end if;
  if to_regprocedure(
    'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'
  ) is null then
    raise exception 'rankball_tournament_match_roster_action_legacy_missing'
      using errcode = '42883';
  end if;

  select string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ),
    ', '
    order by proc.proname, proc.oid
  )
  into blocking_functions
  from pg_depend dependency
  join pg_proc proc
    on dependency.classid = 'pg_proc'::regclass
   and dependency.objid = proc.oid
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where dependency.refclassid = 'pg_proc'::regclass
    and dependency.refobjid in (
      'public.rankball_match_finalize_locked(text,text,text)'::regprocedure,
      'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure
    );

  if blocking_functions is not null then
    raise exception 'internal_legacy_rpc_catalog_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;

  select string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ),
    ', '
    order by proc.proname, proc.oid
  )
  into blocking_functions
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.prokind in ('f', 'p')
    and (
      (
        proc.oid not in (
          'public.rankball_match_finalize_locked(text,text,text)'::regprocedure,
          'public.rankball_match_finalize_locked(text,text,text,boolean)'::regprocedure
        )
        and position(
          'rankball_match_finalize_locked(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname <> 'rankball_tournament_match_roster_action_legacy'
        and position(
          'rankball_tournament_match_roster_action_legacy('
          in pg_get_functiondef(proc.oid)
        ) > 0
      )
    );

  if blocking_functions is not null then
    raise exception 'internal_legacy_rpc_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

revoke all on function public.rankball_match_finalize_locked(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_tournament_match_roster_action_legacy(
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;

drop function if exists public.rankball_match_finalize_locked(text, text, text);
drop function if exists public.rankball_tournament_match_roster_action_legacy(
  text,
  text,
  jsonb
);

revoke all on function public.rankball_match_finalize_locked(
  text,
  text,
  text,
  boolean
) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(
  text,
  text,
  text,
  boolean
) to service_role;

revoke all on function public.rankball_tournament_match_roster_action(
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.rankball_tournament_match_roster_action(
  text,
  text,
  jsonb
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
