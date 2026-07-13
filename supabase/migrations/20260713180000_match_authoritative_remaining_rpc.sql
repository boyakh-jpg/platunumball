-- Finish operation-only match reducers and calculate final rating changes in the locked DB transaction.

create or replace function public.rankball_match_player_side(
  p_match_id text,
  p_player_id text,
  p_match public.matches default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
  player_side text;
begin
  if p_match is null then
    select * into current_match from public.matches where id = p_match_id;
  else
    current_match := p_match;
  end if;
  select side into player_side
  from public.match_players
  where match_id = p_match_id and user_id = p_player_id
  limit 1;
  if player_side is not null then return player_side; end if;
  if coalesce(current_match.reserve_players->'teamA', '[]'::jsonb) ? p_player_id
     or coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb) ? p_player_id then return 'teamA'; end if;
  if coalesce(current_match.reserve_players->'teamB', '[]'::jsonb) ? p_player_id
     or coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb) ? p_player_id then return 'teamB'; end if;
  return null;
end;
$$;

create or replace function public.rankball_match_is_operator(
  p_match public.matches,
  p_actor_profile_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(p_actor_profile_id), '') is not null
    and p_actor_profile_id in (p_match.created_by, p_match.referee_id, p_match.former_referee_id),
    false
  )
$$;

create or replace function public.rankball_match_result_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result jsonb default '{}'::jsonb
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
  existing_result public.match_results%rowtype;
  actor_side text;
  actor_is_operator boolean;
  actor_is_referee boolean;
  actor_recorder_side text;
  draft_entry boolean;
  live_entry boolean;
  stat_item record;
  stat_side text;
  current_stat public.player_match_stats%rowtype;
  source_name text;
  submissions jsonb := '{}'::jsonb;
  draft_result jsonb;
  draft_stats jsonb;
  merged_stat jsonb;
  result_score_a integer;
  result_score_b integer;
  now_at timestamptz := now();
  touched_count integer := 0;
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_result_actor_or_match' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status in ('confirmed', 'void', 'cancelled', 'contract') then
    raise exception 'match_result_locked' using errcode = '23514';
  end if;

  actor_side := public.rankball_match_player_side(safe_match_id, safe_actor_id, current_match);
  actor_is_operator := public.rankball_match_is_operator(current_match, safe_actor_id);
  actor_is_referee := current_match.referee_id = safe_actor_id;
  if current_match.stat_recorders->>'teamA' = safe_actor_id then actor_recorder_side := 'teamA'; end if;
  if current_match.stat_recorders->>'teamB' = safe_actor_id then actor_recorder_side := 'teamB'; end if;
  draft_entry := current_match.status = 'disputed';
  live_entry := not draft_entry and current_match.started_at is not null and current_match.ended_at is null;

  if current_match.referee_id is not null and not actor_is_referee then
    raise exception 'match_result_referee_required' using errcode = '42501';
  end if;
  if current_match.referee_id is null and actor_side is null and actor_recorder_side is null and not actor_is_operator then
    raise exception 'match_result_permission_denied' using errcode = '42501';
  end if;
  if draft_entry and not actor_is_operator then
    raise exception 'match_dispute_operator_required' using errcode = '42501';
  end if;
  if draft_entry and current_match.ended_at is not null
     and now_at > current_match.ended_at + make_interval(mins => greatest(1, coalesce(current_match.dispute_minutes, 30))) then
    raise exception 'match_dispute_window_closed' using errcode = '23514';
  end if;
  if not live_entry and not draft_entry and current_match.ended_at is not null
     and now_at > current_match.ended_at + make_interval(mins => greatest(1, coalesce(current_match.stat_entry_minutes, 60)))
     and not actor_is_operator then
    raise exception 'match_stat_window_closed' using errcode = '23514';
  end if;

  select * into existing_result from public.match_results where match_id = safe_match_id;
  submissions := coalesce(existing_result.stat_submissions, '{}'::jsonb);
  draft_result := coalesce(current_match.dispute_draft_result, jsonb_build_object(
    'scoreA', coalesce(existing_result.score_a, current_match.score_a, 0),
    'scoreB', coalesce(existing_result.score_b, current_match.score_b, 0),
    'playerStats', '{}'::jsonb,
    'statSubmissions', submissions,
    'submittedBy', safe_actor_id,
    'submittedAt', now_at
  ));
  draft_stats := coalesce(draft_result->'playerStats', '{}'::jsonb);

  for stat_item in
    select key as player_id, value as stat
    from jsonb_each(coalesce(p_result->'playerStats', '{}'::jsonb))
  loop
    stat_side := public.rankball_match_player_side(safe_match_id, stat_item.player_id, current_match);
    if stat_side is null then raise exception 'stat_player_not_in_match' using errcode = '23514'; end if;
    if not (actor_is_referee or actor_is_operator or actor_recorder_side = stat_side or safe_actor_id = stat_item.player_id) then
      raise exception 'match_stat_player_permission_denied' using errcode = '42501';
    end if;
    if safe_actor_id = stat_item.player_id and not (actor_is_referee or actor_is_operator or actor_recorder_side = stat_side)
       and exists (
         select 1 from jsonb_object_keys(stat_item.stat) field_name
         where field_name <> 'points'
       ) then
      raise exception 'match_self_stat_points_only' using errcode = '42501';
    end if;
    if exists (
      select 1
      from jsonb_each_text(stat_item.stat) field(field_name, field_value)
      where field_name not in ('points', 'rebounds', 'assists', 'steals', 'blocks', 'fouls')
         or field_value !~ '^[0-9]+$'
         or field_value::integer > 999
    ) then
      raise exception 'invalid_player_stat' using errcode = '22023';
    end if;

    source_name := case
      when actor_is_referee then 'referee'
      when draft_entry then 'dispute_operator'
      when actor_recorder_side = stat_side then 'candidate_recorder'
      when actor_is_operator and safe_actor_id <> stat_item.player_id then 'host_postgame'
      else 'player'
    end;

    if draft_entry then
      merged_stat := coalesce(draft_stats->stat_item.player_id, '{}'::jsonb) || stat_item.stat;
      draft_stats := jsonb_set(draft_stats, array[stat_item.player_id], merged_stat, true);
    else
      select * into current_stat
      from public.player_match_stats
      where match_id = safe_match_id and user_id = stat_item.player_id;
      insert into public.player_match_stats (
        match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at
      ) values (
        safe_match_id,
        stat_item.player_id,
        safe_actor_id,
        source_name,
        case when stat_item.stat ? 'points' then (stat_item.stat->>'points')::integer else coalesce(current_stat.points, 0) end,
        case when stat_item.stat ? 'rebounds' then (stat_item.stat->>'rebounds')::integer else coalesce(current_stat.rebounds, 0) end,
        case when stat_item.stat ? 'assists' then (stat_item.stat->>'assists')::integer else coalesce(current_stat.assists, 0) end,
        case when stat_item.stat ? 'steals' then (stat_item.stat->>'steals')::integer else coalesce(current_stat.steals, 0) end,
        case when stat_item.stat ? 'blocks' then (stat_item.stat->>'blocks')::integer else coalesce(current_stat.blocks, 0) end,
        case when stat_item.stat ? 'fouls' then (stat_item.stat->>'fouls')::integer else coalesce(current_stat.fouls, 0) end,
        now_at
      ) on conflict (match_id, user_id) do update set
        recorded_by = excluded.recorded_by,
        record_source = excluded.record_source,
        points = excluded.points,
        rebounds = excluded.rebounds,
        assists = excluded.assists,
        steals = excluded.steals,
        blocks = excluded.blocks,
        fouls = excluded.fouls,
        updated_at = excluded.updated_at;
    end if;
    submissions := jsonb_set(submissions, array[stat_item.player_id], jsonb_build_object(
      'by', safe_actor_id, 'side', stat_side, 'source', source_name, 'submittedAt', now_at
    ), true);
    touched_count := touched_count + 1;
  end loop;

  result_score_a := greatest(0, least(999, coalesce(nullif(p_result->>'scoreA', '')::integer, existing_result.score_a, current_match.score_a, 0)));
  result_score_b := greatest(0, least(999, coalesce(nullif(p_result->>'scoreB', '')::integer, existing_result.score_b, current_match.score_b, 0)));

  if draft_entry then
    draft_result := draft_result || jsonb_build_object(
      'scoreA', result_score_a,
      'scoreB', result_score_b,
      'playerStats', draft_stats,
      'statSubmissions', submissions,
      'submittedBy', safe_actor_id,
      'updatedAt', now_at
    );
    update public.matches
    set dispute_draft_result = draft_result,
        dispute_draft_updated_at = now_at,
        updated_at = now_at
    where id = safe_match_id;
  else
    insert into public.match_results (match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at)
    values (safe_match_id, safe_actor_id, result_score_a, result_score_b, submissions, coalesce(existing_result.submitted_at, now_at))
    on conflict (match_id) do update set
      submitted_by = excluded.submitted_by,
      score_a = excluded.score_a,
      score_b = excluded.score_b,
      stat_submissions = excluded.stat_submissions,
      submitted_at = coalesce(public.match_results.submitted_at, excluded.submitted_at);
    if not live_entry then delete from public.match_approvals where match_id = safe_match_id; end if;
    update public.matches
    set score_a = result_score_a,
        score_b = result_score_b,
        status = case when live_entry then status else 'approval' end,
        ended_at = case when live_entry then ended_at else coalesce(ended_at, now_at) end,
        updated_at = now_at
    where id = safe_match_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'submitMatchResult',
    'matchId', safe_match_id,
    'statCount', touched_count,
    'draft', draft_entry,
    'live', live_entry,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_match_referee_absence_action(
  p_actor_profile_id text,
  p_match_id text,
  p_action text
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
  opponent_side text;
  opponent_team_id text;
  opponent_leader_id text;
  now_at timestamptz := now();
begin
  if p_action not in ('requestMatchRefereeAbsence', 'confirmMatchRefereeAbsence') then
    raise exception 'unsupported_referee_absence_action' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.referee_id is null or current_match.started_at is not null or current_match.ended_at is not null
     or current_match.status not in ('contract', 'agreed') then
    raise exception 'match_referee_absence_locked' using errcode = '23514';
  end if;

  if p_action = 'requestMatchRefereeAbsence' then
    if current_match.created_by <> safe_actor_id then raise exception 'match_host_required' using errcode = '42501'; end if;
    if current_match.referee_absence_request->>'status' = 'confirmed' then
      raise exception 'match_referee_absence_already_confirmed' using errcode = '23514';
    end if;
    if current_match.referee_absence_request is null then
      update public.profiles
      set trust_score = greatest(0, least(100, coalesce(trust_score, 80) - 4)), updated_at = now_at
      where id = current_match.referee_id;
    end if;
    update public.matches
    set referee_absence_request = jsonb_build_object(
          'by', safe_actor_id,
          'createdAt', coalesce(referee_absence_request->'createdAt', to_jsonb(now_at)),
          'status', 'pending'
        ),
        updated_at = now_at
    where id = safe_match_id;
  else
    if current_match.referee_absence_request->>'status' <> 'pending' then
      raise exception 'match_referee_absence_request_missing' using errcode = '23514';
    end if;
    opponent_side := case when public.rankball_match_player_side(safe_match_id, current_match.created_by, current_match) = 'teamB' then 'teamA' else 'teamB' end;
    opponent_team_id := case when opponent_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
    if opponent_team_id is not null then
      select user_id into opponent_leader_id
      from public.team_members
      where team_id = opponent_team_id and role = 'captain'
      order by user_id
      limit 1;
    end if;
    if opponent_leader_id is null then
      select user_id into opponent_leader_id
      from public.match_players
      where match_id = safe_match_id and side = opponent_side
      order by slot_order, user_id
      limit 1;
    end if;
    if opponent_leader_id is null or opponent_leader_id <> safe_actor_id then
      raise exception 'match_opponent_leader_required' using errcode = '42501';
    end if;
    update public.matches
    set former_referee_id = coalesce(former_referee_id, referee_id),
        referee_id = null,
        referee_absence_request = referee_absence_request || jsonb_build_object(
          'status', 'confirmed', 'confirmedBy', safe_actor_id, 'confirmedAt', now_at
        ),
        updated_at = now_at
    where id = safe_match_id;
  end if;

  return jsonb_build_object('ok', true, 'action', p_action, 'matchId', safe_match_id, 'sqlReducer', true, 'advisoryLocked', true);
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
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  safe_side text;
  safe_player_id text;
  target_side text;
  target_reserve boolean;
  side_capacity integer;
  active_a jsonb;
  active_b jsonb;
  reserves jsonb;
  allowed_ids jsonb;
  requested_active jsonb;
  requested_reserve jsonb;
  leader_id text;
  now_at timestamptz := now();
  patch jsonb;
begin
  if p_action not in ('updateMatchRoomRules', 'setMatchRoomPlayerPlacement', 'setMatchRecordTeamRoster', 'removeMatchRoomPlayer') then
    raise exception 'unsupported_match_room_action' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if p_action = 'setMatchRecordTeamRoster' then
    if current_match.status in ('confirmed', 'cancelled', 'voided')
       or exists (select 1 from public.match_results where match_id = safe_match_id) then
      raise exception 'match_room_edit_locked' using errcode = '23514';
    end if;
  elsif current_match.status not in ('contract', 'agreed') or current_match.started_at is not null or current_match.ended_at is not null
     or exists (select 1 from public.match_results where match_id = safe_match_id) then
    raise exception 'match_room_edit_locked' using errcode = '23514';
  end if;

  active_a := coalesce((select jsonb_agg(user_id order by slot_order) from public.match_players where match_id = safe_match_id and side = 'teamA'), '[]'::jsonb);
  active_b := coalesce((select jsonb_agg(user_id order by slot_order) from public.match_players where match_id = safe_match_id and side = 'teamB'), '[]'::jsonb);
  reserves := coalesce(current_match.reserve_players, jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb));
  side_capacity := greatest(1, least(5, coalesce((current_match.rules->>'sideCapacity')::integer, substring(current_match.mode from '^[0-9]+')::integer, 5)));

  if p_action = 'updateMatchRoomRules' then
    if safe_actor_id not in (current_match.created_by, current_match.referee_id) then
      raise exception 'match_room_operator_required' using errcode = '42501';
    end if;
    patch := coalesce(p_payload->'patch', p_payload, '{}'::jsonb);
    side_capacity := greatest(1, least(5, coalesce((patch->>'sideCapacity')::integer, side_capacity)));
    if jsonb_array_length(active_a) > side_capacity or jsonb_array_length(active_b) > side_capacity then
      raise exception 'match_side_capacity_below_roster' using errcode = '23514';
    end if;
    update public.matches
    set mode = side_capacity::text || 'v' || side_capacity::text,
        status = 'agreed',
        court_id = case when patch ? 'courtId' then nullif(btrim(patch->>'courtId'), '') else court_id end,
        court_name = case when patch ? 'court' then left(coalesce(nullif(btrim(patch->>'court'), ''), court_name), 80) else court_name end,
        memo = case when patch ? 'memo' then left(coalesce(patch->>'memo', ''), 500) else memo end,
        stakes = case when patch ? 'stakes' then left(coalesce(patch->>'stakes', ''), 500) else stakes end,
        rules = (coalesce(rules, '{}'::jsonb) - 'startedAt') || jsonb_build_object(
          'sideCapacity', side_capacity,
          'targetScore', greatest(7, least(31, coalesce((patch->>'targetScore')::integer, (rules->>'targetScore')::integer, 21))),
          'timeLimit', greatest(5, least(60, coalesce((patch->>'timeLimit')::integer, (rules->>'timeLimit')::integer, 12))),
          'winByTwo', coalesce((patch->>'winByTwo')::boolean, (rules->>'winByTwo')::boolean, true),
          'ball', coalesce(nullif(patch->>'ball', ''), rules->>'ball', '7호 공'),
          'attackRule', left(coalesce(nullif(patch->>'attackRule', ''), rules->>'attackRule', '득점 후 공격권 교대'), 120),
          'foulRule', left(coalesce(nullif(patch->>'foulRule', ''), rules->>'foulRule', '파울 콜 즉시 중단, 공격권 유지'), 120)
        ),
        team_a_id = case when patch->>'matchJoinMode' = 'player' then null else team_a_id end,
        team_b_id = case when patch->>'matchJoinMode' = 'player' then null else team_b_id end,
        attendance = jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
        agreed_at = null,
        updated_at = now_at
    where id = safe_match_id;
    delete from public.match_agreements where match_id = safe_match_id;
  elsif p_action = 'setMatchRecordTeamRoster' then
    safe_side := case when p_payload->>'sideName' = 'teamB' then 'teamB' else 'teamA' end;
    if coalesce(current_match.rules->>'recordType', '') <> 'match_record' then
      raise exception 'match_record_room_required' using errcode = '23514';
    end if;
    select user_id into leader_id
    from public.team_members
    where team_id = case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end
      and role = 'captain'
    order by user_id limit 1;
    if leader_id is null or leader_id <> safe_actor_id then
      raise exception 'match_side_captain_required' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(user_id), '[]'::jsonb) into allowed_ids
    from public.team_members
    where team_id = case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
    select coalesce(jsonb_agg(player_id order by ordinality), '[]'::jsonb) into requested_active
    from (
      select player_id, ordinality
      from jsonb_array_elements_text(coalesce(p_payload #> '{roster,playerIds}', '[]'::jsonb)) with ordinality player(player_id, ordinality)
      where allowed_ids ? player_id
        and not (case when safe_side = 'teamA' then active_b || coalesce(reserves->'teamB', '[]'::jsonb) else active_a || coalesce(reserves->'teamA', '[]'::jsonb) end) ? player_id
      order by ordinality
      limit side_capacity
    ) selected;
    select coalesce(jsonb_agg(player_id order by ordinality), '[]'::jsonb) into requested_reserve
    from (
      select player_id, ordinality
      from jsonb_array_elements_text(coalesce(p_payload #> '{roster,reservePlayerIds}', '[]'::jsonb)) with ordinality player(player_id, ordinality)
      where allowed_ids ? player_id and not requested_active ? player_id
        and not (case when safe_side = 'teamA' then active_b || coalesce(reserves->'teamB', '[]'::jsonb) else active_a || coalesce(reserves->'teamA', '[]'::jsonb) end) ? player_id
      order by ordinality
      limit 2
    ) selected;
    if not (requested_active || requested_reserve) ? leader_id then
      raise exception 'match_side_leader_required' using errcode = '23514';
    end if;
    delete from public.match_players where match_id = safe_match_id and side = safe_side;
    insert into public.match_players (match_id, team_id, user_id, side, slot_order)
    select safe_match_id,
      case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end,
      player_id, safe_side, ordinality::integer - 1
    from jsonb_array_elements_text(requested_active) with ordinality player(player_id, ordinality);
    reserves := jsonb_set(reserves, array[safe_side], requested_reserve, true);
    update public.matches set reserve_players = reserves, updated_at = now_at where id = safe_match_id;
    delete from public.match_agreements where match_id = safe_match_id and side = safe_side;
    delete from public.match_approvals where match_id = safe_match_id and side = safe_side;
  else
    if safe_actor_id not in (current_match.created_by, current_match.referee_id) then
      raise exception 'match_room_operator_required' using errcode = '42501';
    end if;
    safe_player_id := nullif(btrim(p_payload->>'playerId'), '');
    safe_side := public.rankball_match_player_side(safe_match_id, safe_player_id, current_match);
    if safe_player_id is null or safe_side is null then raise exception 'match_player_not_found' using errcode = 'P0002'; end if;
    if p_action = 'removeMatchRoomPlayer' and safe_player_id = safe_actor_id then
      raise exception 'match_operator_cannot_remove_self' using errcode = '42501';
    end if;
    target_side := case when p_payload #>> '{placement,side}' = 'teamB' then 'teamB' when p_payload #>> '{placement,side}' = 'teamA' then 'teamA' else safe_side end;
    target_reserve := coalesce((p_payload #>> '{placement,reserve}')::boolean, false);
    delete from public.match_players where match_id = safe_match_id and user_id = safe_player_id;
    reserves := jsonb_set(
      jsonb_set(
        reserves,
        '{teamA}',
        coalesce((select jsonb_agg(item.value) from jsonb_array_elements_text(coalesce(reserves->'teamA', '[]'::jsonb)) item(value) where item.value <> safe_player_id), '[]'::jsonb),
        true
      ),
      '{teamB}',
      coalesce((select jsonb_agg(item.value) from jsonb_array_elements_text(coalesce(reserves->'teamB', '[]'::jsonb)) item(value) where item.value <> safe_player_id), '[]'::jsonb),
      true
    );
    if p_action = 'setMatchRoomPlayerPlacement' then
      if target_reserve then
        if jsonb_array_length(coalesce(reserves->target_side, '[]'::jsonb)) >= 2 then raise exception 'match_reserve_full' using errcode = '23514'; end if;
        reserves := jsonb_set(reserves, array[target_side], coalesce(reserves->target_side, '[]'::jsonb) || to_jsonb(safe_player_id), true);
      else
        if (select count(*) from public.match_players where match_id = safe_match_id and side = target_side) >= side_capacity then
          raise exception 'match_side_full' using errcode = '23514';
        end if;
        insert into public.match_players (match_id, team_id, user_id, side, slot_order)
        values (safe_match_id, case when target_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end, safe_player_id, target_side,
          (select count(*) from public.match_players where match_id = safe_match_id and side = target_side));
      end if;
    end if;
    update public.matches set reserve_players = reserves, status = 'agreed', agreed_at = null, updated_at = now_at where id = safe_match_id;
    delete from public.match_agreements where match_id = safe_match_id and user_id = safe_player_id;
    delete from public.match_approvals where match_id = safe_match_id and user_id = safe_player_id;
  end if;

  return jsonb_build_object('ok', true, 'action', p_action, 'matchId', safe_match_id, 'sqlReducer', true, 'advisoryLocked', true);
end;
$$;

create or replace function public.rankball_match_finalize_locked(
  p_actor_profile_id text,
  p_match_id text,
  p_action text default 'approveMatch'
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
  result_row public.match_results%rowtype;
  final_score_a integer;
  final_score_b integer;
  actual_a numeric;
  actual_b numeric;
  side_a_avg numeric := 1200;
  side_b_avg numeric := 1200;
  quality numeric;
  mode_weight numeric;
  integrated_weight numeric;
  mode_cap numeric;
  integrated_cap numeric;
  rating_changes jsonb := '[]'::jsonb;
  team_changes jsonb := '{}'::jsonb;
  profile_ids jsonb := '[]'::jsonb;
  team_ids jsonb := '[]'::jsonb;
  player record;
  current_rating numeric;
  current_integrated numeric;
  expected numeric;
  k_factor numeric;
  mode_delta numeric;
  stat_boost numeric;
  source_factor numeric;
  result_factor numeric;
  mercenary_factor numeric;
  integrated_delta numeric;
  next_ratings jsonb;
  player_actual numeric;
  player_opponent numeric;
  player_team_mmr numeric;
  player_role text;
  player_result text;
  trust_delta integer;
  team_row record;
  opponent_team_avg numeric;
  team_delta numeric;
  team_actual numeric;
  now_at timestamptz := now();
  missing_stats integer;
  points_a integer;
  points_b integer;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'matchId', safe_match_id, 'alreadyConfirmed', true, 'ratingAtomic', true, 'sqlReducer', true);
  end if;
  if current_match.status not in ('approval', 'disputed') then raise exception 'match_finalization_locked' using errcode = '23514'; end if;
  if current_match.status = 'disputed' and not public.rankball_match_is_operator(current_match, safe_actor_id) then
    raise exception 'match_dispute_operator_required' using errcode = '42501';
  end if;

  if current_match.status = 'disputed' then
    if current_match.dispute_draft_result is null then raise exception 'match_dispute_draft_missing' using errcode = '23514'; end if;
    delete from public.player_match_stats where match_id = safe_match_id;
    insert into public.player_match_stats (match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at)
    select safe_match_id, item.key, safe_actor_id, 'dispute_operator',
      coalesce((item.value->>'points')::integer, 0), coalesce((item.value->>'rebounds')::integer, 0),
      coalesce((item.value->>'assists')::integer, 0), coalesce((item.value->>'steals')::integer, 0),
      coalesce((item.value->>'blocks')::integer, 0), coalesce((item.value->>'fouls')::integer, 0), now_at
    from jsonb_each(coalesce(current_match.dispute_draft_result->'playerStats', '{}'::jsonb)) item;
    insert into public.match_results (match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at)
    values (
      safe_match_id, safe_actor_id,
      coalesce((current_match.dispute_draft_result->>'scoreA')::integer, 0),
      coalesce((current_match.dispute_draft_result->>'scoreB')::integer, 0),
      coalesce(current_match.dispute_draft_result->'statSubmissions', '{}'::jsonb), now_at
    ) on conflict (match_id) do update set
      submitted_by = excluded.submitted_by, score_a = excluded.score_a, score_b = excluded.score_b,
      stat_submissions = excluded.stat_submissions, submitted_at = excluded.submitted_at;
  end if;

  select * into result_row from public.match_results where match_id = safe_match_id for update;
  if result_row.match_id is null then raise exception 'match_result_missing' using errcode = '23514'; end if;

  select count(*) into missing_stats
  from (
    select distinct player_id
    from (
      select user_id as player_id from public.match_players where match_id = safe_match_id
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb))
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb))
    ) players
  ) expected_players
  where not exists (select 1 from public.player_match_stats stat where stat.match_id = safe_match_id and stat.user_id = expected_players.player_id);
  if missing_stats > 0 then raise exception 'match_approval_stats_incomplete' using errcode = '23514'; end if;

  select
    coalesce(sum(stat.points) filter (where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamA'), 0),
    coalesce(sum(stat.points) filter (where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamB'), 0)
  into points_a, points_b
  from public.player_match_stats stat where stat.match_id = safe_match_id;
  if points_a <> result_row.score_a or points_b <> result_row.score_b then
    raise exception 'match_approval_point_mismatch' using errcode = '23514';
  end if;

  final_score_a := result_row.score_a;
  final_score_b := result_row.score_b;
  actual_a := case when final_score_a = final_score_b then 0.5 when final_score_a > final_score_b then 1 else 0 end;
  actual_b := 1 - actual_a;
  mode_weight := case current_match.mode when '1v1' then 0.78 when '2v2' then 0.9 when '3v3' then 1 else 1.12 end;
  integrated_weight := case current_match.mode when '1v1' then 0.25 when '2v2' then 0.45 when '3v3' then 0.85 else 1.35 end;
  mode_cap := case current_match.mode when '1v1' then 25 when '2v2' then 28 when '3v3' then 32 else case when current_match.official then 50 else 40 end end;
  integrated_cap := case current_match.mode when '1v1' then 8 when '2v2' then 14 when '3v3' then 25 else case when current_match.official then 55 else 45 end end;
  quality := least(2.05, greatest(0,
    (case when not current_match.ranked then 0.18 when current_match.official and coalesce(current_match.evidence, '[]'::jsonb) <> '[]'::jsonb then 1.5 when current_match.official then 1.35 when coalesce(current_match.evidence, '[]'::jsonb) <> '[]'::jsonb then 1.15 when current_match.pre_registered then 1 else 0.7 end)
    * (case when not current_match.pre_registered then 0.7 when current_match.scheduled_date is null then 1 when current_match.scheduled_date::timestamp - current_match.created_at >= interval '3 days' then 1.15 when current_match.scheduled_date::timestamp - current_match.created_at >= interval '1 day' then 1.1 when current_match.scheduled_date::timestamp - current_match.created_at >= interval '30 minutes' then 1 else 0.7 end)
    * (case when coalesce(current_match.evidence, '[]'::jsonb) <> '[]'::jsonb then 1.2 else 1 end)
    * (case when current_match.tournament_id is null then 1 when current_match.tournament_format = 'tournament' then 1.18 else 1.12 end)
    * greatest(0.2, least(1.15, coalesce((current_match.rules->>'ratingScale')::numeric, 1)))
  ));

  select coalesce(avg(coalesce((profile.ratings #>> array['modes', current_match.mode])::numeric, (profile.ratings->>'integrated')::numeric, 1200)), 1200)
  into side_a_avg
  from public.profiles profile
  where profile.id in (
    select distinct player_id from (
      select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamA'
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb))
    ) players
  ) and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;
  select coalesce(avg(coalesce((profile.ratings #>> array['modes', current_match.mode])::numeric, (profile.ratings->>'integrated')::numeric, 1200)), 1200)
  into side_b_avg
  from public.profiles profile
  where profile.id in (
    select distinct player_id from (
      select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamB'
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb))
    ) players
  ) and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;

  for player in
    select profile.*, public.rankball_match_player_side(safe_match_id, profile.id, current_match) as side,
      stat.points, stat.rebounds, stat.assists, stat.steals, stat.blocks, stat.fouls, stat.record_source,
      mp.team_id
    from public.profiles profile
    join public.player_match_stats stat on stat.match_id = safe_match_id and stat.user_id = profile.id
    left join public.match_players mp on mp.match_id = safe_match_id and mp.user_id = profile.id
    where not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id
    for update of profile
  loop
    current_integrated := coalesce((player.ratings->>'integrated')::numeric, 1200);
    current_rating := coalesce((player.ratings #>> array['modes', current_match.mode])::numeric, current_integrated);
    player_actual := case when player.side = 'teamA' then actual_a else actual_b end;
    player_opponent := case when player.side = 'teamA' then side_b_avg else side_a_avg end;
    player_team_mmr := case when player.side = 'teamA' then side_a_avg else side_b_avg end;
    expected := 1 / (1 + power(10::numeric, (player_opponent - player_team_mmr) / 400));
    k_factor := case when current_rating < 1000 then 34 when current_rating < 1400 then 30 when current_rating < 1700 then 26 when current_rating < 1900 then 22 else 18 end;
    mode_delta := greatest(-mode_cap, least(mode_cap,
      k_factor * (player_actual - expected) * mode_weight * quality * greatest(0.86, least(1.1, 0.82 + coalesce(player.trust_score, 80) / 400.0))
    ));
    source_factor := case player.record_source when 'referee' then 1 when 'candidate_recorder' then 0.72 when 'player' then 0.5 else 1 end;
    result_factor := case when player_actual = 1 then 1 when player_actual = 0 then 0.55 else 0.75 end;
    stat_boost := round(greatest(-0.8, least(2.2,
      coalesce(player.points, 0) * 0.035 + coalesce(player.rebounds, 0) * 0.055 + coalesce(player.assists, 0) * 0.055 + coalesce(player.steals, 0) * 0.08 + coalesce(player.blocks, 0) * 0.08
    )) * result_factor * source_factor, 1);
    player_role := coalesce((select role from public.team_members where team_id = player.team_id and user_id = player.id limit 1), 'regular');
    mercenary_factor := case when player_role <> 'mercenary' then 1 when current_integrated >= coalesce((select mmr from public.teams where id = player.team_id), player_team_mmr) + 140 then 0.62 when current_integrated <= coalesce((select mmr from public.teams where id = player.team_id), player_team_mmr) - 140 then 0.96 else 0.82 end;
    mode_delta := round(greatest(-48, least(48, (mode_delta + stat_boost) * mercenary_factor)), 1);
    integrated_delta := round(greatest(-integrated_cap, least(integrated_cap, mode_delta * integrated_weight)), 1);
    player_result := case when player_actual = 1 then 'win' when player_actual = 0 then 'loss' else 'draw' end;
    trust_delta := 1 - least(4, greatest(0, coalesce(player.fouls, 0) - 2));
    next_ratings := jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(player.ratings, '{}'::jsonb), '{modes}', coalesce(player.ratings->'modes', '{}'::jsonb), true),
        '{integrated}',
        to_jsonb(greatest(0, round(current_integrated + integrated_delta))),
        true
      ),
      array['modes', current_match.mode],
      to_jsonb(greatest(0, round(current_rating + mode_delta))),
      true
    );
    update public.profiles
    set ratings = next_ratings,
        trust_score = greatest(0, least(100, coalesce(trust_score, 80) + trust_delta)),
        streak = case when player_result = 'win' then greatest(1, coalesce(streak, 0) + 1) when player_result = 'loss' then least(-1, coalesce(streak, 0) - 1) else coalesce(streak, 0) end,
        updated_at = now_at
    where id = player.id;
    rating_changes := rating_changes || jsonb_build_object(
      'playerId', player.id, 'side', player.side, 'modeDelta', mode_delta, 'integratedDelta', integrated_delta,
      'statBoost', stat_boost, 'mercenaryFactor', mercenary_factor, 'result', player_result
    );
    profile_ids := profile_ids || to_jsonb(player.id);
  end loop;

  update public.profiles profile
  set trust_score = greatest(0, least(100, coalesce(profile.trust_score, 80) + reward.delta)), updated_at = now_at
  from (
    select recorder_id, sum(delta)::integer as delta
    from (
      select value->>'by' as recorder_id, 2 as delta
      from jsonb_each(coalesce(result_row.stat_submissions, '{}'::jsonb))
      where value->>'source' = 'candidate_recorder' and nullif(value->>'by', '') is not null
      union all select current_match.referee_id, 1 where current_match.referee_id is not null
    ) rewards
    group by recorder_id
  ) reward
  where profile.id = reward.recorder_id;

  for team_row in
    select team.*, side
    from public.teams team
    join (
      select distinct team_id, side from public.match_players where match_id = safe_match_id and team_id is not null
    ) groups on groups.team_id = team.id
    where team.deleted_at is null
    for update of team
  loop
    team_actual := case when team_row.side = 'teamA' then actual_a else actual_b end;
    select coalesce(avg(mmr), 1200) into opponent_team_avg
    from public.teams
    where id in (select distinct team_id from public.match_players where match_id = safe_match_id and side <> team_row.side and team_id is not null);
    team_delta := round(greatest(-34, least(34, 24 * (team_actual - (1 / (1 + power(10::numeric, (opponent_team_avg - team_row.mmr) / 400)))) * quality)), 1);
    update public.teams
    set mmr = round(coalesce(mmr, 1200) + team_delta),
        wins = coalesce(wins, 0) + case when team_actual = 1 then 1 else 0 end,
        losses = coalesce(losses, 0) + case when team_actual = 0 then 1 else 0 end,
        updated_at = now_at
    where id = team_row.id;
    team_changes := jsonb_set(team_changes, array[team_row.id], to_jsonb(team_delta), true);
    team_ids := team_ids || to_jsonb(team_row.id);
  end loop;

  update public.matches
  set status = 'confirmed',
      score_a = final_score_a,
      score_b = final_score_b,
      rating_result = rating_changes,
      team_rating_result = jsonb_build_object(
        'teamA', coalesce((select sum((value #>> '{}')::numeric) from jsonb_each(team_changes) entry(key, value) where key in (select distinct team_id from public.match_players where match_id = safe_match_id and side = 'teamA' and team_id is not null)), 0),
        'teamB', coalesce((select sum((value #>> '{}')::numeric) from jsonb_each(team_changes) entry(key, value) where key in (select distinct team_id from public.match_players where match_id = safe_match_id and side = 'teamB' and team_id is not null)), 0),
        'teams', team_changes
      ),
      confirmed_at = now_at,
      dispute_draft_result = null,
      dispute_draft_updated_at = null,
      dispute_resolved_at = case when current_match.status = 'disputed' then now_at else dispute_resolved_at end,
      updated_at = now_at
  where id = safe_match_id;

  delete from public.match_approvals where match_id = safe_match_id;
  insert into public.notifications (id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at)
  values (
    'match-confirmed-' || substr(md5(safe_match_id || ':' || now_at::text), 1, 24),
    safe_actor_id, safe_actor_id, '경기 확정', current_match.title || ' 결과가 티어와 랭킹에 반영됐습니다.',
    'tier', 'match', safe_match_id, jsonb_build_object('matchId', safe_match_id), now_at, now_at
  ) on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true, 'action', p_action, 'matchId', safe_match_id, 'ratingResult', rating_changes,
    'teamRatingResult', team_changes, 'profileIds', profile_ids, 'teamIds', team_ids,
    'ratingAtomic', true, 'sqlReducer', true, 'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_match_resume_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_result_draft is not null and p_result_draft <> 'null'::jsonb then
    perform public.rankball_match_result_action(p_actor_profile_id, p_match_id, p_result_draft);
  end if;
  return public.rankball_match_finalize_locked(p_actor_profile_id, p_match_id, 'resumeMatchApproval');
end;
$$;

create or replace function public.rankball_match_resume_approval_action(
  p_actor_profile_id text,
  p_match_id text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.rankball_match_resume_approval_action(p_actor_profile_id, p_match_id, null::jsonb)
$$;

create or replace function public.rankball_match_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  team_a_count integer;
  team_b_count integer;
  team_a_approvals integer;
  team_b_approvals integer;
  team_a_required integer;
  team_b_required integer;
  captain_a text;
  captain_b text;
begin
  if safe_actor_id is null or safe_actor_id <> safe_player_id or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_approval_target' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null or current_match.status <> 'approval' then raise exception 'match_approval_locked' using errcode = '23514'; end if;
  if public.rankball_match_player_side(safe_match_id, safe_player_id, current_match) <> safe_side then
    raise exception 'match_approval_player_not_found' using errcode = '42501';
  end if;
  insert into public.match_approvals (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;

  select count(*) filter (where side = 'teamA'), count(*) filter (where side = 'teamB')
  into team_a_count, team_b_count from public.match_players where match_id = safe_match_id;
  select count(*) filter (where side = 'teamA'), count(*) filter (where side = 'teamB')
  into team_a_approvals, team_b_approvals from public.match_approvals where match_id = safe_match_id;
  if current_match.team_a_id is not null then
    select user_id into captain_a from public.team_members where team_id = current_match.team_a_id and role = 'captain' limit 1;
  end if;
  if current_match.team_b_id is not null then
    select user_id into captain_b from public.team_members where team_id = current_match.team_b_id and role = 'captain' limit 1;
  end if;
  team_a_required := floor(team_a_count / 2.0)::integer + 1;
  team_b_required := floor(team_b_count / 2.0)::integer + 1;
  if (captain_a is null and team_a_approvals < team_a_required) or (captain_a is not null and not exists (select 1 from public.match_approvals where match_id = safe_match_id and user_id = captain_a and side = 'teamA'))
     or (captain_b is null and team_b_approvals < team_b_required) or (captain_b is not null and not exists (select 1 from public.match_approvals where match_id = safe_match_id and user_id = captain_b and side = 'teamB')) then
    update public.matches set updated_at = now() where id = safe_match_id;
    return jsonb_build_object('ok', true, 'action', 'approveMatch', 'matchId', safe_match_id, 'sqlReducer', true, 'finalized', false);
  end if;
  return public.rankball_match_finalize_locked(safe_actor_id, safe_match_id, 'approveMatch');
end;
$$;

create or replace function public.rankball_match_agree_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  side_team_id text;
  side_captain_id text;
  team_a_count integer;
  team_b_count integer;
  team_a_agreements integer;
  team_b_agreements integer;
  team_a_required integer;
  team_b_required integer;
  captain_a text;
  captain_b text;
  completed boolean := false;
begin
  if safe_actor_id is null or safe_actor_id <> safe_player_id or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_agreement_target' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status not in ('contract', 'agreed') or current_match.started_at is not null or current_match.ended_at is not null then
    raise exception 'match_agreement_locked' using errcode = '23514';
  end if;

  side_team_id := case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
  if side_team_id is not null then
    select user_id into side_captain_id
    from public.team_members where team_id = side_team_id and role = 'captain' limit 1;
    if side_captain_id is not null and side_captain_id <> safe_actor_id then
      raise exception 'match_side_captain_required' using errcode = '42501';
    end if;
  elsif not exists (
    select 1 from public.match_players
    where match_id = safe_match_id and side = safe_side and user_id = safe_actor_id
  ) then
    raise exception 'match_agreement_player_not_found' using errcode = '42501';
  end if;

  insert into public.match_agreements (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;

  select count(*) filter (where side = 'teamA'), count(*) filter (where side = 'teamB')
  into team_a_count, team_b_count from public.match_players where match_id = safe_match_id;
  if team_a_count = 0 or team_b_count = 0 then raise exception 'match_agreement_players_missing' using errcode = '23514'; end if;
  select count(*) filter (where side = 'teamA'), count(*) filter (where side = 'teamB')
  into team_a_agreements, team_b_agreements from public.match_agreements where match_id = safe_match_id;
  if current_match.team_a_id is not null then
    select user_id into captain_a from public.team_members where team_id = current_match.team_a_id and role = 'captain' limit 1;
  end if;
  if current_match.team_b_id is not null then
    select user_id into captain_b from public.team_members where team_id = current_match.team_b_id and role = 'captain' limit 1;
  end if;
  team_a_required := floor(team_a_count / 2.0)::integer + 1;
  team_b_required := floor(team_b_count / 2.0)::integer + 1;
  completed :=
    (case when captain_a is null then team_a_agreements >= team_a_required else exists (
      select 1 from public.match_agreements where match_id = safe_match_id and side = 'teamA' and user_id = captain_a
    ) end)
    and
    (case when captain_b is null then team_b_agreements >= team_b_required else exists (
      select 1 from public.match_agreements where match_id = safe_match_id and side = 'teamB' and user_id = captain_b
    ) end);

  if completed then
    update public.matches set status = 'agreed', agreed_at = coalesce(agreed_at, now()), updated_at = now() where id = safe_match_id;
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
    )
    select
      'notice-match-agreed-' || safe_match_id || '-' || target.user_id,
      target.user_id,
      target.user_id,
      '경기 전 동의 완료',
      current_match.title || ' 경기 결과를 입력할 수 있습니다.',
      'match',
      'match_agreed',
      safe_match_id,
      jsonb_build_object('matchId', safe_match_id, 'targetUserId', target.user_id),
      now(),
      now()
    from (
      select user_id from public.match_players where match_id = safe_match_id
      union select current_match.created_by
      union select current_match.referee_id where current_match.referee_id is not null and current_match.referee_id <> ''
    ) target
    where target.user_id is not null and target.user_id <> ''
    on conflict (id) do update set body = excluded.body, payload = excluded.payload, updated_at = excluded.updated_at;
  else
    update public.matches set updated_at = now() where id = safe_match_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'agreeMatch',
    'matchId', safe_match_id,
    'sideName', safe_side,
    'playerId', safe_player_id,
    'agreementCompleted', completed,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_match_checkin_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  current_attendance jsonb;
  side_attendance jsonb;
  next_side_attendance jsonb;
  scheduled_at_kst timestamptz;
  is_active boolean;
  is_reserve boolean;
begin
  if safe_actor_id is null or safe_match_id is null or safe_side not in ('teamA', 'teamB') or safe_player_id is null then
    raise exception 'invalid_match_checkin_target' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if coalesce(nullif(current_match.referee_id, ''), current_match.created_by) <> safe_actor_id then
    raise exception 'match_checkin_permission_denied' using errcode = '42501';
  end if;
  if current_match.status not in ('contract', 'agreed') or current_match.started_at is not null or current_match.ended_at is not null
     or exists (select 1 from public.match_results where match_id = safe_match_id) then
    raise exception 'match_checkin_locked' using errcode = '23514';
  end if;
  if coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then raise exception 'match_schedule_missing' using errcode = '23514'; end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if now() < scheduled_at_kst then raise exception 'match_not_checkin_time' using errcode = '23514'; end if;
  end if;
  select exists (
    select 1 from public.match_players where match_id = safe_match_id and side = safe_side and user_id = safe_player_id
  ) into is_active;
  is_reserve := case
    when jsonb_typeof(current_match.reserve_players->safe_side) = 'array' then (current_match.reserve_players->safe_side) ? safe_player_id
    when jsonb_typeof(current_match.rules #> array['reservePlayers', safe_side]) = 'array' then (current_match.rules #> array['reservePlayers', safe_side]) ? safe_player_id
    else false
  end;
  if not is_active and not is_reserve then raise exception 'match_checkin_player_not_found' using errcode = '42501'; end if;

  current_attendance := case when jsonb_typeof(current_match.attendance) = 'object' then current_match.attendance else '{}'::jsonb end;
  side_attendance := case when jsonb_typeof(current_attendance->safe_side) = 'array' then current_attendance->safe_side else '[]'::jsonb end;
  select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb) into next_side_attendance
  from (
    select distinct value from (
      select value from jsonb_array_elements_text(side_attendance) attendee(value)
      union all select safe_player_id
    ) values_to_attend where value is not null and value <> ''
  ) unique_attendees;
  update public.matches
  set attendance = jsonb_set(current_attendance, array[safe_side], next_side_attendance, true), updated_at = now()
  where id = safe_match_id;
  return jsonb_build_object('ok', true, 'action', 'checkInMatchPlayer', 'matchId', safe_match_id, 'sideName', safe_side, 'playerId', safe_player_id, 'sqlReducer', true, 'advisoryLocked', true);
end;
$$;

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
  current_match public.matches%rowtype;
  next_attendance jsonb;
  actor_side text;
  actor_side_attendance jsonb;
  next_started_at timestamptz;
  next_agreed_at timestamptz;
  next_rules jsonb;
  scheduled_at_kst timestamptz;
  missing_count integer;
begin
  if safe_actor_id is null or safe_match_id is null then raise exception 'missing_match_actor' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if coalesce(nullif(current_match.referee_id, ''), current_match.created_by) <> safe_actor_id then
    raise exception 'match_start_permission_denied' using errcode = '42501';
  end if;
  if current_match.status not in ('contract', 'agreed') or current_match.started_at is not null or current_match.ended_at is not null
     or exists (select 1 from public.match_results where match_id = safe_match_id) then
    raise exception 'match_not_startable' using errcode = '23514';
  end if;
  if coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then raise exception 'match_schedule_missing' using errcode = '23514'; end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if now() < scheduled_at_kst then raise exception 'match_not_checkin_time' using errcode = '23514'; end if;
  end if;
  next_attendance := jsonb_build_object(
    'teamA', case when jsonb_typeof(current_match.attendance->'teamA') = 'array' then current_match.attendance->'teamA' else '[]'::jsonb end,
    'teamB', case when jsonb_typeof(current_match.attendance->'teamB') = 'array' then current_match.attendance->'teamB' else '[]'::jsonb end
  );
  select side into actor_side from (
    select side from public.match_players where match_id = safe_match_id and user_id = safe_actor_id
    union all
    select side_name from (values ('teamA'), ('teamB')) side(side_name)
    where jsonb_typeof(current_match.reserve_players->side.side_name) = 'array'
      and (current_match.reserve_players->side.side_name) ? safe_actor_id
  ) actor_roster limit 1;
  if actor_side in ('teamA', 'teamB') then
    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb) into actor_side_attendance
    from (
      select distinct value from (
        select value from jsonb_array_elements_text(next_attendance->actor_side) attendee(value)
        union all select safe_actor_id
      ) values_to_attend where value is not null and value <> ''
    ) unique_attendees;
    next_attendance := jsonb_set(next_attendance, array[actor_side], actor_side_attendance, true);
  end if;
  with roster as (
    select side, user_id from public.match_players where match_id = safe_match_id and side in ('teamA', 'teamB')
    union
    select side.side_name, reserve.value
    from (values ('teamA'), ('teamB')) side(side_name)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(current_match.reserve_players->side.side_name) = 'array' then current_match.reserve_players->side.side_name else '[]'::jsonb end
    ) reserve(value)
  )
  select count(*) into missing_count from roster
  where user_id is not null and user_id <> '' and not ((next_attendance->side) ? user_id);
  if missing_count > 0 then raise exception 'match_attendance_missing' using errcode = '23514'; end if;

  next_started_at := coalesce(nullif(btrim(coalesce(p_started_at, '')), '')::timestamptz, now());
  next_agreed_at := coalesce(current_match.agreed_at, nullif(btrim(coalesce(p_agreed_at, '')), '')::timestamptz, next_started_at);
  next_rules := jsonb_set(coalesce(current_match.rules, '{}'::jsonb), '{startedAt}', to_jsonb(next_started_at::text), true);
  update public.matches
  set status = 'agreed', agreed_at = next_agreed_at, started_at = next_started_at,
      attendance = next_attendance, rules = next_rules, updated_at = now()
  where id = safe_match_id;
  return jsonb_build_object('ok', true, 'action', 'startMatch', 'matchId', safe_match_id, 'startedAt', next_started_at, 'agreedAt', next_agreed_at, 'sqlReducer', true, 'advisoryLocked', true);
end;
$$;

create or replace function public.rankball_match_end_action(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_ended_at text default null
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
  next_started_at timestamptz;
  next_ended_at timestamptz;
  next_rules jsonb;
  has_result boolean;
begin
  if safe_actor_id is null or safe_match_id is null then raise exception 'missing_match_actor' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if coalesce(nullif(current_match.referee_id, ''), current_match.created_by) <> safe_actor_id then
    raise exception 'match_end_permission_denied' using errcode = '42501';
  end if;
  if current_match.status <> 'agreed' or current_match.ended_at is not null then raise exception 'match_not_endable' using errcode = '23514'; end if;
  select exists (select 1 from public.match_results where match_id = safe_match_id) into has_result;
  next_started_at := coalesce(current_match.started_at, nullif(btrim(coalesce(p_started_at, '')), '')::timestamptz, now());
  next_ended_at := coalesce(nullif(btrim(coalesce(p_ended_at, '')), '')::timestamptz, now());
  next_rules := jsonb_set(coalesce(current_match.rules, '{}'::jsonb), '{startedAt}', to_jsonb(coalesce(current_match.rules->>'startedAt', next_started_at::text)), true);
  update public.matches
  set status = case when has_result then 'approval' else status end,
      started_at = next_started_at, ended_at = next_ended_at, rules = next_rules, updated_at = now()
  where id = safe_match_id;
  if has_result then delete from public.match_approvals where match_id = safe_match_id; end if;
  return jsonb_build_object('ok', true, 'action', 'endMatch', 'matchId', safe_match_id, 'startedAt', next_started_at, 'endedAt', next_ended_at, 'sqlReducer', true, 'advisoryLocked', true);
end;
$$;

revoke all on function public.rankball_match_player_side(text, text, public.matches) from public, anon, authenticated;
revoke all on function public.rankball_match_is_operator(public.matches, text) from public, anon, authenticated;
revoke all on function public.rankball_match_result_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_referee_absence_action(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_room_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_finalize_locked(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_resume_approval_action(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_resume_approval_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_approval_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_agree_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_checkin_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_start_action(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_end_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_player_side(text, text, public.matches) to service_role;
grant execute on function public.rankball_match_is_operator(public.matches, text) to service_role;
grant execute on function public.rankball_match_result_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_referee_absence_action(text, text, text) to service_role;
grant execute on function public.rankball_match_room_action(text, text, text, jsonb) to service_role;
grant execute on function public.rankball_match_finalize_locked(text, text, text) to service_role;
grant execute on function public.rankball_match_resume_approval_action(text, text) to service_role;
grant execute on function public.rankball_match_resume_approval_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_approval_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_agree_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_checkin_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_start_action(text, text, text, text, jsonb) to service_role;
grant execute on function public.rankball_match_end_action(text, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
