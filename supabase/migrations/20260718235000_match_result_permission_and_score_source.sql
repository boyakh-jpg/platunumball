-- Enforce phase/role stat permissions and derive team scores only from player PTS.

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
    if draft_entry or actor_is_referee or actor_records_target_side then
      points_only := false;
    elsif postgame_entry and current_match.referee_id is null and actor_is_host then
      points_only := true;
    elsif actor_is_record_player
       and safe_actor_id = stat_item.player_id
       and nullif(btrim(coalesce(recorder_map->>stat_side, '')), '') is null then
      points_only := true;
    else
      raise exception 'match_stat_player_permission_denied' using errcode = '42501';
    end if;

    if postgame_entry and points_only and (
      (submissions <> '{}'::jsonb and submissions ? stat_item.player_id)
      or (submissions = '{}'::jsonb and exists (
        select 1 from public.player_match_stats existing_stat
        where existing_stat.match_id = safe_match_id
          and existing_stat.user_id = stat_item.player_id
      ))
    ) then
      raise exception 'match_postgame_missing_only' using errcode = '42501';
    end if;

    if points_only and exists (
      select 1 from jsonb_object_keys(stat_item.stat) field_name where field_name <> 'points'
    ) then
      if postgame_entry and actor_is_host then
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

select pg_notify('pgrst', 'reload schema');
