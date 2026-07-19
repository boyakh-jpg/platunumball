-- Harden match result writes, final approval, lifecycle authorization, and rating role resolution.

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
  current_stat public.player_match_stats%rowtype;
  recorder_map jsonb := '{}'::jsonb;
  reserve_a jsonb := '[]'::jsonb;
  reserve_b jsonb := '[]'::jsonb;
  stored_recorder_a text;
  stored_recorder_b text;
  actor_is_host boolean := false;
  actor_is_referee boolean := false;
  actor_is_record_player boolean := false;
  actor_side text;
  actor_records_target_side boolean := false;
  draft_entry boolean := false;
  live_entry boolean := false;
  postgame_entry boolean := false;
  stat_item record;
  stat_side text;
  target_is_record_player boolean;
  points_only boolean;
  source_name text;
  submissions jsonb := '{}'::jsonb;
  draft_result jsonb;
  draft_stats jsonb;
  merged_stat jsonb;
  result_score_a integer := 0;
  result_score_b integer := 0;
  now_at timestamptz := now();
  touched_count integer := 0;
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_result_actor_or_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status in ('confirmed', 'void', 'cancelled', 'contract') or current_match.confirmed_at is not null then
    raise exception 'match_result_locked' using errcode = '23514';
  end if;

  select * into existing_result from public.match_results where match_id = safe_match_id for update;
  recorder_map := coalesce(current_match.rules->'statRecorders', '{}'::jsonb)
    || coalesce(current_match.stat_recorders, '{}'::jsonb);
  reserve_a := case when jsonb_typeof(current_match.reserve_players->'teamA') = 'array'
    then current_match.reserve_players->'teamA' else '[]'::jsonb end;
  reserve_b := case when jsonb_typeof(current_match.reserve_players->'teamB') = 'array'
    then current_match.reserve_players->'teamB' else '[]'::jsonb end;
  stored_recorder_a := nullif(btrim(coalesce(recorder_map->>'teamA', '')), '');
  stored_recorder_b := nullif(btrim(coalesce(recorder_map->>'teamB', '')), '');
  if current_match.referee_id is null then
    recorder_map := jsonb_build_object(
      'teamA', case
        when stored_recorder_a is not null and reserve_a ? stored_recorder_a then stored_recorder_a
        when jsonb_array_length(reserve_a) > 0 then reserve_a->>0
        when stored_recorder_a is not null
          and public.rankball_match_player_side(safe_match_id, stored_recorder_a, current_match) = 'teamA' then stored_recorder_a
        else ''
      end,
      'teamB', case
        when stored_recorder_b is not null and reserve_b ? stored_recorder_b then stored_recorder_b
        when jsonb_array_length(reserve_b) > 0 then reserve_b->>0
        when stored_recorder_b is not null
          and public.rankball_match_player_side(safe_match_id, stored_recorder_b, current_match) = 'teamB' then stored_recorder_b
        else ''
      end
    );
  else
    recorder_map := jsonb_build_object('teamA', '', 'teamB', '');
  end if;
  actor_is_host := current_match.created_by = safe_actor_id;
  actor_is_referee := current_match.referee_id = safe_actor_id;
  if actor_is_referee and not exists (
    select 1
    from public.referee_appointments appointment
    join public.profiles profile on profile.id = appointment.user_id
    where appointment.user_id = safe_actor_id
      and appointment.status = 'active'
      and coalesce(appointment.starts_at, now_at) <= now_at
      and (appointment.ends_at is null or appointment.ends_at > now_at)
      and coalesce(profile.trust_score, 80) >= coalesce(current_match.referee_trust_min, 90)
  ) then
    raise exception 'referee_not_eligible' using errcode = '42501';
  end if;
  select exists (
    select 1 from public.match_players player
    where player.match_id = safe_match_id and player.user_id = safe_actor_id
    union all
    select 1 where coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb) ? safe_actor_id
    union all
    select 1 where coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb) ? safe_actor_id
  ) into actor_is_record_player;
  actor_side := public.rankball_match_player_side(safe_match_id, safe_actor_id, current_match);

  draft_entry := current_match.status = 'disputed';
  live_entry := current_match.status = 'agreed'
    and current_match.started_at is not null
    and current_match.ended_at is null;
  postgame_entry := current_match.status in ('agreed', 'approval')
    and current_match.ended_at is not null;

  if not draft_entry and not live_entry and not postgame_entry then
    raise exception 'match_result_phase_locked' using errcode = '23514';
  end if;
  if draft_entry and current_match.ended_at is null then
    raise exception 'match_result_phase_locked' using errcode = '23514';
  end if;

  if draft_entry then
    if current_match.referee_id is not null and not actor_is_referee then
      raise exception 'match_dispute_referee_required' using errcode = '42501';
    end if;
    if current_match.referee_id is null and not actor_is_host then
      raise exception 'match_dispute_operator_required' using errcode = '42501';
    end if;
    if now_at > current_match.ended_at + make_interval(mins => greatest(1, coalesce(current_match.dispute_minutes, 30))) then
      raise exception 'match_dispute_window_closed' using errcode = '23514';
    end if;
  elsif current_match.referee_id is not null then
    if not actor_is_referee then
      raise exception 'match_result_referee_required' using errcode = '42501';
    end if;
  elsif live_entry then
    if recorder_map->>'teamA' <> safe_actor_id
       and recorder_map->>'teamB' <> safe_actor_id
       and not (
         actor_is_record_player
         and actor_side in ('teamA', 'teamB')
         and nullif(btrim(coalesce(recorder_map->>actor_side, '')), '') is null
       ) then
      raise exception 'match_result_permission_denied' using errcode = '42501';
    end if;
  elsif postgame_entry then
    if not actor_is_host
       and recorder_map->>'teamA' <> safe_actor_id
       and recorder_map->>'teamB' <> safe_actor_id
       and not (
         actor_is_record_player
         and actor_side in ('teamA', 'teamB')
         and nullif(btrim(coalesce(recorder_map->>actor_side, '')), '') is null
       ) then
      raise exception 'match_result_permission_denied' using errcode = '42501';
    end if;
    if now_at > current_match.ended_at + make_interval(mins => greatest(1, coalesce(current_match.stat_entry_minutes, 60)))
       and not (existing_result.match_id is null and (actor_is_referee or (current_match.referee_id is null and actor_is_host))) then
      raise exception 'match_stat_window_closed' using errcode = '23514';
    end if;
  end if;

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
    if jsonb_typeof(stat_item.stat) <> 'object' or stat_item.stat = '{}'::jsonb then
      raise exception 'invalid_player_stat' using errcode = '22023';
    end if;

    stat_side := public.rankball_match_player_side(safe_match_id, stat_item.player_id, current_match);
    select exists (
      select 1 from public.match_players player
      where player.match_id = safe_match_id and player.user_id = stat_item.player_id
      union all
      select 1 where coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb) ? stat_item.player_id
      union all
      select 1 where coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb) ? stat_item.player_id
    ) into target_is_record_player;
    if stat_side is null or not target_is_record_player then
      raise exception 'stat_player_not_in_match' using errcode = '23514';
    end if;

    actor_records_target_side := recorder_map->>stat_side = safe_actor_id;
    points_only := false;
    -- Non-referee postgame writers may only fill a player whose PTS row is still absent.
    if draft_entry or actor_is_referee then
      points_only := false;
    elsif postgame_entry and (
      actor_is_host
      or actor_records_target_side
      or (
        actor_is_record_player
        and safe_actor_id = stat_item.player_id
        and nullif(btrim(coalesce(recorder_map->>stat_side, '')), '') is null
      )
    ) then
      points_only := true;
    elsif actor_records_target_side then
      points_only := false;
    elsif actor_is_record_player
       and safe_actor_id = stat_item.player_id
       and nullif(btrim(coalesce(recorder_map->>stat_side, '')), '') is null then
      points_only := true;
    else
      raise exception 'match_stat_player_permission_denied' using errcode = '42501';
    end if;

    if postgame_entry and points_only and (
      submissions ? stat_item.player_id
      or exists (
        select 1 from public.player_match_stats existing_stat
        where existing_stat.match_id = safe_match_id
          and existing_stat.user_id = stat_item.player_id
      )
    ) then
      raise exception 'match_postgame_missing_only' using errcode = '42501';
    end if;

    if points_only and exists (
      select 1 from jsonb_object_keys(stat_item.stat) field_name where field_name <> 'points'
    ) then
      if postgame_entry then
        raise exception 'match_postgame_points_only' using errcode = '42501';
      end if;
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
      when actor_records_target_side then 'candidate_recorder'
      when postgame_entry and actor_is_host then 'host_postgame'
      else 'player'
    end;

    if draft_entry then
      merged_stat := coalesce(draft_stats->stat_item.player_id, '{}'::jsonb) || stat_item.stat;
      draft_stats := jsonb_set(draft_stats, array[stat_item.player_id], merged_stat, true);
    else
      current_stat := null;
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
      'by', safe_actor_id,
      'side', stat_side,
      'source', source_name,
      'submittedAt', now_at
    ), true);
    touched_count := touched_count + 1;
  end loop;

  if touched_count = 0 then
    raise exception 'match_result_stats_required' using errcode = '22023';
  end if;

  if draft_entry then
    with expected_players as (
      select side, user_id as player_id from public.match_players where match_id = safe_match_id and side in ('teamA', 'teamB')
      union
      select 'teamA', value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      union
      select 'teamB', value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
    )
    select
      coalesce(sum(coalesce((draft_stats->player_id->>'points')::integer, 0)) filter (where side = 'teamA'), 0)::integer,
      coalesce(sum(coalesce((draft_stats->player_id->>'points')::integer, 0)) filter (where side = 'teamB'), 0)::integer
    into result_score_a, result_score_b
    from expected_players;

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
    with expected_players as (
      select side, user_id as player_id from public.match_players where match_id = safe_match_id and side in ('teamA', 'teamB')
      union
      select 'teamA', value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      union
      select 'teamB', value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
    )
    select
      coalesce(sum(coalesce(stat.points, 0)) filter (where player.side = 'teamA'), 0)::integer,
      coalesce(sum(coalesce(stat.points, 0)) filter (where player.side = 'teamB'), 0)::integer
    into result_score_a, result_score_b
    from expected_players player
    left join public.player_match_stats stat
      on stat.match_id = safe_match_id and stat.user_id = player.player_id;

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
    'scoreA', result_score_a,
    'scoreB', result_score_b,
    'scoreDerived', true,
    'statCount', touched_count,
    'draft', draft_entry,
    'live', live_entry,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_result_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_result_action(text, text, jsonb) to service_role;

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
  actor_is_actual_player boolean := false;
  actor_is_operator boolean := false;
  ambiguous_actual_players boolean := false;
  team_a_count integer := 0;
  team_b_count integer := 0;
  team_a_approvals integer := 0;
  team_b_approvals integer := 0;
  team_a_required integer := 0;
  team_b_required integer := 0;
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  actor_is_operator := coalesce(
    safe_actor_id = coalesce(
      nullif(btrim(current_match.referee_id), ''),
      nullif(btrim(current_match.created_by), '')
    ),
    false
  );
  -- Active rows plus played history are the authoritative approval roster.
  with actual_players as (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  )
  select
    exists (select 1 from actual_players where user_id = safe_actor_id),
    exists (
      select 1
      from actual_players
      group by user_id
      having count(distinct side) > 1
    )
  into actor_is_actual_player, ambiguous_actual_players;

  if ambiguous_actual_players then
    raise exception 'match_actual_roster_ambiguous' using errcode = '23514';
  end if;
  if current_match.status = 'confirmed' then
    if not actor_is_operator and not actor_is_actual_player then
      raise exception 'match_finalization_permission_denied' using errcode = '42501';
    end if;
    return jsonb_build_object('ok', true, 'matchId', safe_match_id, 'alreadyConfirmed', true, 'ratingAtomic', true, 'sqlReducer', true);
  end if;
  if current_match.status not in ('approval', 'disputed') then
    raise exception 'match_finalization_locked' using errcode = '23514';
  end if;
  -- Dispute resolution remains the documented current-referee-or-host exception to reapproval.
  if current_match.status = 'disputed' then
    if not actor_is_operator then
      raise exception 'match_dispute_operator_required' using errcode = '42501';
    end if;
  else
    if not actor_is_operator and not actor_is_actual_player then
      raise exception 'match_finalization_permission_denied' using errcode = '42501';
    end if;

    with actual_players as (
      select player.user_id, player.side
      from public.match_players player
      where player.match_id = safe_match_id
        and player.side in ('teamA', 'teamB')
        and nullif(btrim(player.user_id), '') is not null
      union
      select played.value, 'teamA'
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
      union
      select played.value, 'teamB'
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
    )
    select
      count(distinct user_id) filter (where side = 'teamA'),
      count(distinct user_id) filter (where side = 'teamB')
    into team_a_count, team_b_count
    from actual_players;

    with actual_players as (
      select player.user_id, player.side
      from public.match_players player
      where player.match_id = safe_match_id
        and player.side in ('teamA', 'teamB')
        and nullif(btrim(player.user_id), '') is not null
      union
      select played.value, 'teamA'
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
      union
      select played.value, 'teamB'
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
    )
    select
      count(distinct approval.user_id) filter (where approval.side = 'teamA'),
      count(distinct approval.user_id) filter (where approval.side = 'teamB')
    into team_a_approvals, team_b_approvals
    from public.match_approvals approval
    join actual_players actual_player
      on actual_player.user_id = approval.user_id
     and actual_player.side = approval.side
    where approval.match_id = safe_match_id;

    team_a_required := floor(team_a_count / 2.0)::integer + 1;
    team_b_required := floor(team_b_count / 2.0)::integer + 1;
    if team_a_count = 0 or team_b_count = 0
       or team_a_approvals < team_a_required
       or team_b_approvals < team_b_required then
      raise exception 'match_approval_majority_required' using errcode = '23514';
    end if;
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

  with actual_players as (
    select player.user_id as player_id
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    union
    select played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  )
  select count(*) into missing_stats
  from actual_players expected_player
  where not exists (
    select 1
    from public.player_match_stats stat
    where stat.match_id = safe_match_id
      and stat.user_id = expected_player.player_id
  );
  if missing_stats > 0 then raise exception 'match_approval_stats_incomplete' using errcode = '23514'; end if;

  with actual_players as (
    select player.user_id as player_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  )
  select
    coalesce(sum(stat.points) filter (where actual_player.side = 'teamA'), 0),
    coalesce(sum(stat.points) filter (where actual_player.side = 'teamB'), 0)
  into points_a, points_b
  from actual_players actual_player
  join public.player_match_stats stat
    on stat.match_id = safe_match_id
   and stat.user_id = actual_player.player_id;
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
      union all select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      )
    ) players
  ) and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;
  select coalesce(avg(coalesce((profile.ratings #>> array['modes', current_match.mode])::numeric, (profile.ratings->>'integrated')::numeric, 1200)), 1200)
  into side_b_avg
  from public.profiles profile
  where profile.id in (
    select distinct player_id from (
      select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamB'
      union all select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      )
    ) players
  ) and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;

  if not current_match.ranked then
    update public.profiles profile
    set
      trust_score = greatest(0, least(
        100,
        coalesce(profile.trust_score, 80) + 1 - least(4, greatest(0, coalesce(stat.fouls, 0) - 2))
      )),
      updated_at = now_at
    from public.player_match_stats stat
    where stat.match_id = safe_match_id
      and stat.user_id = profile.id
      and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;
  end if;

  for player in
    with actual_candidates as (
      select
        match_player.user_id,
        match_player.side,
        coalesce(
          match_player.team_id,
          case match_player.side when 'teamA' then current_match.team_a_id when 'teamB' then current_match.team_b_id end
        ) as team_id,
        0 as source_priority
      from public.match_players match_player
      where match_player.match_id = safe_match_id
        and match_player.side in ('teamA', 'teamB')
        and nullif(btrim(match_player.user_id), '') is not null
      union all
      select played.value, 'teamA', current_match.team_a_id, 1
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
      union all
      select played.value, 'teamB', current_match.team_b_id, 1
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
    ),
    actual_players as (
      select distinct on (user_id) user_id, side, team_id
      from actual_candidates
      order by user_id, source_priority
    )
    select
      profile.*,
      actual_player.side,
      stat.points,
      stat.rebounds,
      stat.assists,
      stat.steals,
      stat.blocks,
      stat.fouls,
      stat.record_source,
      actual_player.team_id
    from actual_players actual_player
    join public.profiles profile on profile.id = actual_player.user_id
    join public.player_match_stats stat
      on stat.match_id = safe_match_id
     and stat.user_id = profile.id
    where current_match.ranked
      and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id
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

    -- Resolve the match snapshot first, then durable membership history; never assume a team role.
    player_role := null;
    if player.team_id is not null then
      select case
        when snapshot_member.value->>'role' in ('mercenary', 'guest') then 'mercenary'
        when snapshot_member.value->>'role' in ('captain', 'regular') then snapshot_member.value->>'role'
        else null
      end
      into player_role
      from jsonb_array_elements(
        case
          when jsonb_typeof(current_match.rules #> array['teamRosterSnapshot', 'teams', player.team_id, 'members']) = 'array'
            then current_match.rules #> array['teamRosterSnapshot', 'teams', player.team_id, 'members']
          else '[]'::jsonb
        end
      ) snapshot_member(value)
      where snapshot_member.value->>'userId' = player.id
      limit 1;

      if player_role is null then
        select case
          when member.role in ('mercenary', 'guest') then 'mercenary'
          when member.role in ('captain', 'regular') then member.role
          else null
        end
        into player_role
        from public.team_members member
        where member.team_id = player.team_id
          and member.user_id = player.id
        limit 1;
      end if;

      if player_role is null then
        select case
          when invitation.role in ('mercenary', 'guest') then 'mercenary'
          when invitation.role = 'regular' then 'regular'
          else null
        end
        into player_role
        from public.team_invitations invitation
        where invitation.team_id = player.team_id
          and invitation.target_user_id = player.id
          and invitation.status = 'accepted'
        order by invitation.updated_at desc, invitation.id desc
        limit 1;
      end if;

      if player_role is null then
        raise exception 'match_player_team_role_unresolved' using errcode = '23514';
      end if;
    else
      player_role := 'regular';
    end if;

    mercenary_factor := case
      when player_role <> 'mercenary' then 1
      when current_integrated >= coalesce((select mmr from public.teams where id = player.team_id), player_team_mmr) + 140 then 0.62
      when current_integrated <= coalesce((select mmr from public.teams where id = player.team_id), player_team_mmr) - 140 then 0.96
      else 0.82
    end;
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
    where current_match.ranked
      and team.deleted_at is null
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
    safe_actor_id, safe_actor_id, '경기 확정',
    current_match.title || case when current_match.ranked then ' 결과가 티어와 랭킹에 반영됐습니다.' else ' 결과가 공식 기록으로 확정됐습니다.' end,
    case when current_match.ranked then 'tier' else 'match' end,
    'match', safe_match_id, jsonb_build_object('matchId', safe_match_id), now_at, now_at
  ) on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true, 'action', p_action, 'matchId', safe_match_id, 'ratingResult', rating_changes,
    'teamRatingResult', team_changes, 'profileIds', profile_ids, 'teamIds', team_ids,
    'ratingAtomic', true, 'sqlReducer', true, 'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_finalize_locked(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text) to service_role;

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
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status <> 'disputed' then
    raise exception 'match_resume_approval_locked' using errcode = '23514';
  end if;
  if safe_actor_id is distinct from coalesce(
    nullif(btrim(current_match.referee_id), ''),
    nullif(btrim(current_match.created_by), '')
  ) then
    raise exception 'match_dispute_operator_required' using errcode = '42501';
  end if;

  if p_result_draft is not null and p_result_draft <> 'null'::jsonb then
    perform public.rankball_match_result_action(safe_actor_id, safe_match_id, p_result_draft);
  end if;
  return public.rankball_match_finalize_locked(safe_actor_id, safe_match_id, 'resumeMatchApproval');
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

revoke all on function public.rankball_match_resume_approval_action(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_resume_approval_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_resume_approval_action(text, text) to service_role;
grant execute on function public.rankball_match_resume_approval_action(text, text, jsonb) to service_role;

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
  actor_is_actual_player boolean := false;
  ambiguous_actual_players boolean := false;
  team_a_count integer := 0;
  team_b_count integer := 0;
  team_a_approvals integer := 0;
  team_b_approvals integer := 0;
  team_a_required integer := 0;
  team_b_required integer := 0;
begin
  if safe_actor_id is null or safe_actor_id <> safe_player_id or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_approval_target' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null or current_match.status <> 'approval' then
    raise exception 'match_approval_locked' using errcode = '23514';
  end if;

  with actual_players as (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  )
  select
    exists (
      select 1
      from actual_players
      where user_id = safe_player_id
        and side = safe_side
    ),
    exists (
      select 1
      from actual_players
      group by user_id
      having count(distinct side) > 1
    )
  into actor_is_actual_player, ambiguous_actual_players;

  if ambiguous_actual_players then
    raise exception 'match_actual_roster_ambiguous' using errcode = '23514';
  end if;
  if not actor_is_actual_player then
    raise exception 'match_approval_player_not_found' using errcode = '42501';
  end if;

  insert into public.match_approvals (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;

  with actual_players as (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  )
  select
    count(distinct user_id) filter (where side = 'teamA'),
    count(distinct user_id) filter (where side = 'teamB')
  into team_a_count, team_b_count
  from actual_players;

  with actual_players as (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  )
  select
    count(distinct approval.user_id) filter (where approval.side = 'teamA'),
    count(distinct approval.user_id) filter (where approval.side = 'teamB')
  into team_a_approvals, team_b_approvals
  from public.match_approvals approval
  join actual_players actual_player
    on actual_player.user_id = approval.user_id
   and actual_player.side = approval.side
  where approval.match_id = safe_match_id;

  team_a_required := floor(team_a_count / 2.0)::integer + 1;
  team_b_required := floor(team_b_count / 2.0)::integer + 1;
  if team_a_count = 0 or team_b_count = 0
     or team_a_approvals < team_a_required
     or team_b_approvals < team_b_required then
    update public.matches set updated_at = now() where id = safe_match_id;
    return jsonb_build_object(
      'ok', true,
      'action', 'approveMatch',
      'matchId', safe_match_id,
      'sqlReducer', true,
      'finalized', false,
      'teamARequired', team_a_required,
      'teamBRequired', team_b_required
    );
  end if;

  return public.rankball_match_finalize_locked(safe_actor_id, safe_match_id, 'approveMatch');
end;
$$;

revoke all on function public.rankball_match_approval_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text) to service_role;

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
  if safe_actor_id is distinct from coalesce(nullif(current_match.referee_id, ''), current_match.created_by) then
    raise exception 'match_end_permission_denied' using errcode = '42501';
  end if;
  if current_match.status <> 'agreed' or current_match.ended_at is not null then
    raise exception 'match_not_endable' using errcode = '23514';
  end if;
  if current_match.started_at is null then
    raise exception 'match_not_started' using errcode = '23514';
  end if;

  select exists (select 1 from public.match_results where match_id = safe_match_id) into has_result;
  next_started_at := current_match.started_at;
  next_ended_at := coalesce(nullif(btrim(coalesce(p_ended_at, '')), '')::timestamptz, now());
  next_rules := jsonb_set(
    coalesce(current_match.rules, '{}'::jsonb),
    '{startedAt}',
    to_jsonb(coalesce(current_match.rules->>'startedAt', next_started_at::text)),
    true
  );
  update public.matches
  set status = case when has_result then 'approval' else status end,
      started_at = next_started_at,
      ended_at = next_ended_at,
      rules = next_rules,
      updated_at = now()
  where id = safe_match_id;
  if has_result then delete from public.match_approvals where match_id = safe_match_id; end if;
  return jsonb_build_object(
    'ok', true,
    'action', 'endMatch',
    'matchId', safe_match_id,
    'startedAt', next_started_at,
    'endedAt', next_ended_at,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_end_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_end_action(text, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
