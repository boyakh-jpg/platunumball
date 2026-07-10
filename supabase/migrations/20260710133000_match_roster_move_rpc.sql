create or replace function public.rankball_match_roster_move_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_side text,
  p_active_player_id text default null,
  p_reserve_player_id text default null,
  p_next_recorder_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_active_player_id text := nullif(btrim(p_active_player_id), '');
  safe_reserve_player_id text := nullif(btrim(p_reserve_player_id), '');
  safe_next_recorder_id text := nullif(btrim(p_next_recorder_id), '');
  current_match public.matches%rowtype;
  side_player_ids text[] := array[]::text[];
  side_reserve_ids text[] := array[]::text[];
  side_played_ids text[] := array[]::text[];
  current_recorders jsonb := '{}'::jsonb;
  next_recorders jsonb := '{}'::jsonb;
  current_recorder_id text := '';
  requested_recorder_id text := '';
  first_reserve_id text := '';
  active_in_id text := '';
  benched_id text := '';
  candidate_id text;
  next_side_reserve jsonb := '[]'::jsonb;
  next_reserve_players jsonb := '{}'::jsonb;
  next_side_played jsonb := '[]'::jsonb;
  next_played_player_ids jsonb := '{}'::jsonb;
  next_rules jsonb := '{}'::jsonb;
  active_slot_order integer;
  active_team_id text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_action is null or safe_action not in ('handoffMatchRecorder', 'substituteMatchPlayer') then
    raise exception 'unsupported_match_roster_move_action' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_side' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;

  select coalesce(array_agg(mp.user_id order by mp.slot_order, mp.user_id), array[]::text[])
  into side_player_ids
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.side = safe_side
    and mp.user_id is not null
    and mp.user_id <> '';

  select coalesce(array_agg(value), array[]::text[])
  into side_reserve_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_match.reserve_players->safe_side) = 'array' then current_match.reserve_players->safe_side
      else '[]'::jsonb
    end
  ) as reserve(value);

  select coalesce(array_agg(value), array[]::text[])
  into side_played_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_match.played_player_ids->safe_side) = 'array' then current_match.played_player_ids->safe_side
      else '[]'::jsonb
    end
  ) as played(value);

  current_recorders := case
    when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
    when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
    else '{}'::jsonb
  end;
  first_reserve_id := coalesce(side_reserve_ids[1], '');
  requested_recorder_id := coalesce(current_recorders->>safe_side, '');
  current_recorder_id := case
    when requested_recorder_id <> '' and requested_recorder_id = any(side_reserve_ids) then requested_recorder_id
    when first_reserve_id <> '' then first_reserve_id
    when requested_recorder_id <> '' and requested_recorder_id = any(side_player_ids) then requested_recorder_id
    else ''
  end;

  if safe_action = 'handoffMatchRecorder' then
    if current_match.referee_id is not null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'referee_match_requires_replay', 'matchId', safe_match_id);
    end if;
    if current_match.status not in ('agreed', 'approval') then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_recorder_handoff_locked', 'matchId', safe_match_id);
    end if;
    if current_recorder_id = '' or current_recorder_id <> safe_actor_id then
      raise exception 'match_recorder_handoff_actor_mismatch' using errcode = '42501';
    end if;
    if safe_next_recorder_id is null then
      raise exception 'missing_next_recorder' using errcode = '22023';
    end if;
    if not (safe_next_recorder_id = any(side_player_ids) or safe_next_recorder_id = any(side_reserve_ids)) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recorder_target_not_on_side', 'matchId', safe_match_id);
    end if;

    if current_match.started_at is not null and current_match.ended_at is null and (
      (current_recorder_id = any(side_reserve_ids) and safe_next_recorder_id = any(side_player_ids)) or
      (current_recorder_id = any(side_player_ids) and safe_next_recorder_id = any(side_reserve_ids))
    ) then
      active_in_id := case when current_recorder_id = any(side_reserve_ids) then current_recorder_id else safe_next_recorder_id end;
      benched_id := case when current_recorder_id = any(side_reserve_ids) then safe_next_recorder_id else current_recorder_id end;
    end if;

    next_recorders := jsonb_set(current_recorders, array[safe_side], to_jsonb(safe_next_recorder_id), true);
  else
    if current_match.status <> 'agreed' or current_match.started_at is null or current_match.ended_at is not null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_substitution_not_live', 'matchId', safe_match_id);
    end if;
    if safe_active_player_id is null or safe_reserve_player_id is null then
      raise exception 'missing_substitution_players' using errcode = '22023';
    end if;
    if not (
      safe_actor_id = coalesce(current_match.created_by, '') or
      safe_actor_id = coalesce(current_match.referee_id, '') or
      safe_actor_id = current_recorder_id
    ) then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    if not (safe_active_player_id = any(side_player_ids) and safe_reserve_player_id = any(side_reserve_ids)) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_substitution_roster_mismatch', 'matchId', safe_match_id);
    end if;

    active_in_id := safe_reserve_player_id;
    benched_id := safe_active_player_id;
    next_recorders := current_recorders;
  end if;

  if active_in_id <> '' and benched_id <> '' then
    select mp.slot_order, mp.team_id
    into active_slot_order, active_team_id
    from public.match_players mp
    where mp.match_id = safe_match_id
      and mp.side = safe_side
      and mp.user_id = benched_id
    limit 1;

    if active_slot_order is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_active_player_missing', 'matchId', safe_match_id);
    end if;
    if exists (
      select 1
      from public.match_players mp
      where mp.match_id = safe_match_id
        and mp.user_id = active_in_id
    ) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'active_in_player_already_active', 'matchId', safe_match_id);
    end if;

    update public.match_players
    set user_id = active_in_id,
        team_id = active_team_id
    where match_id = safe_match_id
      and side = safe_side
      and slot_order = active_slot_order
      and user_id = benched_id;

    foreach candidate_id in array side_reserve_ids loop
      if candidate_id <> active_in_id and not (next_side_reserve ? candidate_id) then
        next_side_reserve := next_side_reserve || to_jsonb(candidate_id);
      end if;
    end loop;
    if not (next_side_reserve ? benched_id) then
      next_side_reserve := next_side_reserve || to_jsonb(benched_id);
    end if;

    foreach candidate_id in array side_played_ids loop
      if candidate_id <> '' and not (next_side_played ? candidate_id) then
        next_side_played := next_side_played || to_jsonb(candidate_id);
      end if;
    end loop;
    foreach candidate_id in array side_player_ids loop
      if candidate_id <> '' and not (next_side_played ? candidate_id) then
        next_side_played := next_side_played || to_jsonb(candidate_id);
      end if;
    end loop;
    foreach candidate_id in array array[active_in_id, benched_id] loop
      if candidate_id <> '' and not (next_side_played ? candidate_id) then
        next_side_played := next_side_played || to_jsonb(candidate_id);
      end if;
    end loop;

    next_reserve_players := jsonb_set(
      case when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players else '{}'::jsonb end,
      array[safe_side],
      next_side_reserve,
      true
    );
    next_played_player_ids := jsonb_set(
      case when jsonb_typeof(current_match.played_player_ids) = 'object' then current_match.played_player_ids else '{}'::jsonb end,
      array[safe_side],
      next_side_played,
      true
    );
  else
    next_reserve_players := case when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players else '{}'::jsonb end;
    next_played_player_ids := case when jsonb_typeof(current_match.played_player_ids) = 'object' then current_match.played_player_ids else '{}'::jsonb end;
  end if;

  next_rules := jsonb_set(coalesce(current_match.rules, '{}'::jsonb), '{statRecorders}', next_recorders, true);
  if active_in_id <> '' and benched_id <> '' then
    next_rules := jsonb_set(next_rules, '{playedPlayerIds}', next_played_player_ids, true);
  end if;

  update public.matches
  set stat_recorders = next_recorders,
      reserve_players = next_reserve_players,
      played_player_ids = next_played_player_ids,
      rules = next_rules,
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'sideName', safe_side,
    'sqlReducer', true,
    'swapped', active_in_id <> '' and benched_id <> '',
    'activeInId', nullif(active_in_id, ''),
    'benchedId', nullif(benched_id, '')
  );
end;
$$;

revoke all on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) from public;
revoke all on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) from anon;
revoke all on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) from authenticated;
grant execute on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) to service_role;

create or replace function public.rankball_match_action(
  p_actor_profile_id text,
  p_action text,
  p_match_row jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := coalesce(nullif(btrim(p_action), ''), 'sync');
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  expected_updated_at timestamptz := nullif(p_match_row->>'__expectedUpdatedAt', '')::timestamptz;
  current_updated_at timestamptz;
  persist_result jsonb;
  branch_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  if safe_action = 'agreeMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_agree_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'checkInMatchPlayer' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_checkin_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action in ('handoffMatchRecorder', 'substituteMatchPlayer') and p_match_row ? '__operation' then
    branch_result := public.rankball_match_roster_move_action(
      safe_actor_id,
      safe_action,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,activePlayerId}',
      p_match_row #>> '{__operation,reservePlayerId}',
      p_match_row #>> '{__operation,nextRecorderId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'startMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_start_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{agreed_at}',
      coalesce(p_match_row->'attendance', '{}'::jsonb)
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'endMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_end_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{ended_at}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  select updated_at
  into current_updated_at
  from public.matches
  where id = safe_match_id
  for update;

  if expected_updated_at is not null and current_updated_at is not null and current_updated_at <> expected_updated_at then
    raise exception 'match_stale_snapshot' using errcode = '40001';
  end if;

  persist_result := public.rankball_persist_match_snapshot(
    p_match_row - '__expectedUpdatedAt',
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    public.rankball_normalize_match_dispute_rows(p_dispute_rows, safe_match_id),
    p_notification_rows,
    p_replace_result
  );

  return persist_result || jsonb_build_object(
    'action', safe_action,
    'actorProfileId', safe_actor_id,
    'advisoryLocked', true,
    'branchFallback', coalesce((branch_result->>'fallback')::boolean, false),
    'branchFallbackReason', branch_result->>'reason'
  );
end;
$$;

revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from anon;
revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from authenticated;
grant execute on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
