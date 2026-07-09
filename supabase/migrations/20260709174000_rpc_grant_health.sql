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
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
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
