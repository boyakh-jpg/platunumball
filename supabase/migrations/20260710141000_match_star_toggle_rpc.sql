create or replace function public.rankball_match_star_toggle_action(
  p_actor_profile_id text,
  p_match_id text,
  p_target_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_target_id text := nullif(btrim(p_target_user_id), '');
  current_match public.matches%rowtype;
  current_recorders jsonb := '{}'::jsonb;
  current_feedback jsonb := '{}'::jsonb;
  current_stars jsonb := '{}'::jsonb;
  feedback_ids text[] := array[]::text[];
  operation_ids text[] := array[]::text[];
  previous_ids text[] := array[]::text[];
  next_ids text[] := array[]::text[];
  active_player_count integer := 0;
  max_stars integer := 1;
  already_starred boolean := false;
  result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_target_id is null then
    raise exception 'missing_match_star_target' using errcode = '22023';
  end if;
  if safe_actor_id = safe_target_id then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_self_target', 'matchId', safe_match_id);
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_closed', 'matchId', safe_match_id);
  end if;
  if coalesce(current_match.confirmed_at, current_match.updated_at, current_match.created_at) + interval '24 hours' < now() then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_window_closed', 'matchId', safe_match_id);
  end if;

  current_recorders := case
    when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
    when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
    else '{}'::jsonb
  end;

  select count(distinct mp.user_id)
  into active_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> '';

  with raw(id) as (
    select mp.user_id
    from public.match_players mp
    where mp.match_id = safe_match_id
    union all
    select reserve.value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.reserve_players->'teamA') = 'array' then current_match.reserve_players->'teamA'
        else '[]'::jsonb
      end
    ) as reserve(value)
    union all
    select reserve.value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.reserve_players->'teamB') = 'array' then current_match.reserve_players->'teamB'
        else '[]'::jsonb
      end
    ) as reserve(value)
    union all
    select current_match.created_by
    union all
    select current_match.referee_id
    union all
    select current_match.former_referee_id
    union all
    select current_recorders->>'teamA'
    union all
    select current_recorders->>'teamB'
  )
  select coalesce(array_agg(distinct id), array[]::text[])
  into feedback_ids
  from raw
  where nullif(btrim(coalesce(id, '')), '') is not null;

  if not (safe_actor_id = any(feedback_ids)) or not (safe_target_id = any(feedback_ids)) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_target_not_allowed', 'matchId', safe_match_id);
  end if;
  if not exists (select 1 from public.profiles profile where profile.id = safe_target_id) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_target_profile_missing', 'matchId', safe_match_id);
  end if;

  with raw(id) as (
    values
      (current_match.created_by),
      (current_match.referee_id),
      (current_recorders->>'teamA'),
      (current_recorders->>'teamB')
  )
  select coalesce(array_agg(distinct id), array[]::text[])
  into operation_ids
  from raw
  where nullif(btrim(coalesce(id, '')), '') is not null;

  max_stars := greatest(1, floor(active_player_count / 2.0)::integer)
    + case when coalesce(array_length(operation_ids, 1), 0) > 0 then 1 else 0 end;

  current_feedback := case
    when jsonb_typeof(current_match.trust_feedback) = 'object' then current_match.trust_feedback
    else '{}'::jsonb
  end;
  current_stars := case
    when jsonb_typeof(current_feedback->'stars') = 'object' then current_feedback->'stars'
    else '{}'::jsonb
  end;

  select coalesce(array_agg(previous.value order by previous.ordinality), array[]::text[])
  into previous_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_stars->safe_actor_id) = 'array' then current_stars->safe_actor_id
      else '[]'::jsonb
    end
  ) with ordinality as previous(value, ordinality)
  where nullif(btrim(coalesce(previous.value, '')), '') is not null;

  already_starred := safe_target_id = any(previous_ids);
  if not already_starred and coalesce(array_length(previous_ids, 1), 0) >= max_stars then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_limit_reached', 'matchId', safe_match_id);
  end if;

  if already_starred then
    select coalesce(array_agg(item.value order by item.ordinality), array[]::text[])
    into next_ids
    from unnest(previous_ids) with ordinality as item(value, ordinality)
    where item.value <> safe_target_id;
  else
    next_ids := previous_ids || safe_target_id;
  end if;

  result := public.rankball_match_thumbs_action(
    safe_actor_id,
    safe_match_id,
    to_jsonb(next_ids)
  );

  return result || jsonb_build_object(
    'action', 'toggleMatchStar',
    'targetUserId', safe_target_id,
    'starred', not already_starred
  );
end;
$$;

revoke all on function public.rankball_match_star_toggle_action(text, text, text) from public;
revoke all on function public.rankball_match_star_toggle_action(text, text, text) from anon;
revoke all on function public.rankball_match_star_toggle_action(text, text, text) from authenticated;
grant execute on function public.rankball_match_star_toggle_action(text, text, text) to service_role;

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

  if safe_action = 'approveMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_approval_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'submitMatchThumbs' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_thumbs_action(
      safe_actor_id,
      safe_match_id,
      coalesce(p_match_row->'__operation'->'targetUserIds', '[]'::jsonb)
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'toggleMatchStar' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_star_toggle_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,targetUserId}'
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

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)'),
      ('rankball_apply_profile_trust_deltas', 'public.rankball_apply_profile_trust_deltas(text,text,jsonb)'),
      ('rankball_cleanup_room_feed', 'public.rankball_cleanup_room_feed(timestamptz)'),
      ('rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)'),
      ('rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)'),
      ('rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()'),
      ('rankball_invite_team_member_4', 'public.rankball_invite_team_member(text,text,text,text)'),
      ('rankball_invite_team_member_5', 'public.rankball_invite_team_member(text,text,text,text,text)'),
      ('rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)'),
      ('rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)'),
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
      ('rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
      ('rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)'),
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
      ('rankball_match_thumbs_action', 'public.rankball_match_thumbs_action(text,text,jsonb)'),
      ('rankball_normalize_match_dispute_rows', 'public.rankball_normalize_match_dispute_rows(jsonb,text)'),
      ('rankball_persist_match_snapshot', 'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_persist_recruiting_snapshot', 'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot', 'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot_locked', 'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)'),
      ('rankball_rebuild_profile_match_summary', 'public.rankball_rebuild_profile_match_summary(text)'),
      ('rankball_recruiting_action', 'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_recruiting_applicant_placement_action', 'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)'),
      ('rankball_recruiting_cancel_participation_action', 'public.rankball_recruiting_cancel_participation_action(text,text)'),
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)'),
      ('rankball_referee_rls_policy_health', 'public.rankball_referee_rls_policy_health()'),
      ('rankball_refresh_all_profile_match_summaries', 'public.rankball_refresh_all_profile_match_summaries()'),
      ('rankball_refresh_profile_match_summaries_for_match', 'public.rankball_refresh_profile_match_summaries_for_match(text)'),
      ('rankball_report_court_request', 'public.rankball_report_court_request(text,text,text)'),
      ('rankball_respond_team_invitation', 'public.rankball_respond_team_invitation(text,text,text)'),
      ('rankball_rls_policy_health', 'public.rankball_rls_policy_health()'),
      ('rankball_submit_court_request', 'public.rankball_submit_court_request(text,jsonb)'),
      ('rankball_submit_court_review', 'public.rankball_submit_court_review(text,jsonb)'),
      ('rankball_sync_team_membership', 'public.rankball_sync_team_membership(text,jsonb,jsonb)')
  ),
  resolved as (
    select
      function_name,
      signature,
      to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'rpc_grant:' || function_name as check_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false) as ok,
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    ) as detail
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_rpc_grant_health() from public;
revoke all on function public.rankball_rpc_grant_health() from anon;
revoke all on function public.rankball_rpc_grant_health() from authenticated;
grant execute on function public.rankball_rpc_grant_health() to service_role;

select pg_notify('pgrst', 'reload schema');
