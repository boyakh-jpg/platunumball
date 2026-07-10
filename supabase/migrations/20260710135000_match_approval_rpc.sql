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
  result_row public.match_results%rowtype;
  already_approved boolean := false;
  missing_stat_count integer := 0;
  team_a_player_count integer := 0;
  team_b_player_count integer := 0;
  team_a_approval_count integer := 0;
  team_b_approval_count integer := 0;
  team_a_needed integer := 1;
  team_b_needed integer := 1;
  team_a_stat_points integer := 0;
  team_b_stat_points integer := 0;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') or safe_player_id is null then
    raise exception 'invalid_match_approval_target' using errcode = '22023';
  end if;
  if safe_actor_id <> safe_player_id then
    raise exception 'match_approval_actor_mismatch' using errcode = '42501';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.status <> 'approval' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_locked', 'matchId', safe_match_id);
  end if;

  select *
  into result_row
  from public.match_results
  where match_id = safe_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_result_missing', 'matchId', safe_match_id);
  end if;

  if not exists (
    select 1
    from public.match_players mp
    where mp.match_id = safe_match_id
      and mp.side = safe_side
      and mp.user_id = safe_player_id
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_player_not_found', 'matchId', safe_match_id);
  end if;

  select count(*)
  into missing_stat_count
  from public.match_players mp
  left join public.player_match_stats stat
    on stat.match_id = mp.match_id
   and stat.user_id = mp.user_id
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB')
    and stat.user_id is null;

  if missing_stat_count > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_stats_incomplete', 'matchId', safe_match_id);
  end if;

  select
    coalesce(sum(coalesce(stat.points, 0)) filter (where mp.side = 'teamA'), 0)::integer,
    coalesce(sum(coalesce(stat.points, 0)) filter (where mp.side = 'teamB'), 0)::integer
  into team_a_stat_points, team_b_stat_points
  from public.match_players mp
  left join public.player_match_stats stat
    on stat.match_id = mp.match_id
   and stat.user_id = mp.user_id
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB');

  if team_a_stat_points <> coalesce(result_row.score_a, current_match.score_a, 0)
    or team_b_stat_points <> coalesce(result_row.score_b, current_match.score_b, 0) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_point_mismatch', 'matchId', safe_match_id);
  end if;

  select
    count(*) filter (where mp.side = 'teamA'),
    count(*) filter (where mp.side = 'teamB')
  into team_a_player_count, team_b_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB');

  if team_a_player_count = 0 or team_b_player_count = 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_players_missing', 'matchId', safe_match_id);
  end if;

  select
    count(distinct approval.user_id) filter (where approval.side = 'teamA'),
    count(distinct approval.user_id) filter (where approval.side = 'teamB')
  into team_a_approval_count, team_b_approval_count
  from public.match_approvals approval
  where approval.match_id = safe_match_id;

  select exists (
    select 1
    from public.match_approvals approval
    where approval.match_id = safe_match_id
      and approval.user_id = safe_player_id
  )
  into already_approved;

  if not already_approved then
    if safe_side = 'teamA' then
      team_a_approval_count := team_a_approval_count + 1;
    else
      team_b_approval_count := team_b_approval_count + 1;
    end if;
  end if;

  team_a_needed := floor(team_a_player_count / 2.0)::integer + 1;
  team_b_needed := floor(team_b_player_count / 2.0)::integer + 1;

  if team_a_approval_count >= team_a_needed and team_b_approval_count >= team_b_needed then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_completion_requires_replay', 'matchId', safe_match_id);
  end if;

  if already_approved then
    return jsonb_build_object('ok', true, 'action', 'approveMatch', 'matchId', safe_match_id, 'actorProfileId', safe_actor_id, 'playerId', safe_player_id, 'sideName', safe_side, 'sqlReducer', true, 'alreadyApproved', true);
  end if;

  insert into public.match_approvals (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;

  update public.matches
  set updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'approveMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'playerId', safe_player_id,
    'sideName', safe_side,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_approval_action(text, text, text, text) from public;
revoke all on function public.rankball_match_approval_action(text, text, text, text) from anon;
revoke all on function public.rankball_match_approval_action(text, text, text, text) from authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text) to service_role;

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
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
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
