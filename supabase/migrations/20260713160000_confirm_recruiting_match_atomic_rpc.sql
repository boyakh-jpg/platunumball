create or replace function public.rankball_confirm_recruiting_match_action(
  p_actor_profile_id text,
  p_post_action text,
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_recruiting_notification_rows jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_match_action text default 'confirmRecruitingMatch',
  p_match_row jsonb default '{}'::jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_match_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  current_post public.recruiting_posts%rowtype;
  current_owner_id text;
  recruiting_result jsonb;
  match_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null or safe_match_id is null then
    raise exception 'missing_recruiting_confirmation_ids' using errcode = '22023';
  end if;
  if p_post_action <> 'confirmRecruitingMatch' or p_match_action <> 'confirmRecruitingMatch' then
    raise exception 'invalid_recruiting_confirmation_action' using errcode = '22023';
  end if;
  if p_post_row->>'status' <> 'closed' or p_match_row->>'status' <> 'agreed' then
    raise exception 'invalid_recruiting_confirmation_state' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  current_owner_id := coalesce(nullif(current_post.room_state->>'ownerId', ''), nullif(current_post.player_id, ''));
  if current_owner_id is distinct from safe_actor_id then
    raise exception 'recruiting_room_owner_required' using errcode = '42501';
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;
  if exists (select 1 from public.matches where id = safe_match_id) then
    raise exception 'match_already_exists' using errcode = '23505';
  end if;

  recruiting_result := public.rankball_recruiting_action(
    safe_actor_id,
    p_post_action,
    p_post_row,
    p_application_rows,
    p_recruiting_notification_rows,
    p_expected_updated_at
  );

  match_result := public.rankball_match_action(
    safe_actor_id,
    p_match_action,
    p_match_row,
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    p_dispute_rows,
    p_match_notification_rows,
    p_replace_result
  );

  return jsonb_build_object(
    'ok', true,
    'postId', safe_post_id,
    'matchId', safe_match_id,
    'recruiting', recruiting_result,
    'match', match_result,
    'confirmationAtomic', true
  );
end;
$$;

revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from anon;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from authenticated;
grant execute on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

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
      ('rankball_confirm_recruiting_match_action', 'public.rankball_confirm_recruiting_match_action(text,text,jsonb,jsonb,jsonb,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)'),
      ('rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)'),
      ('rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()'),
      ('rankball_invite_team_member_4', 'public.rankball_invite_team_member(text,text,text,text)'),
      ('rankball_invite_team_member_5', 'public.rankball_invite_team_member(text,text,text,text,text)'),
      ('rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_match_action_with_rating', 'public.rankball_match_action_with_rating(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)'),
      ('rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)'),
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_dispute_action', 'public.rankball_match_dispute_action(text,text,jsonb)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
      ('rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
      ('rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)'),
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
      ('rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text)'),
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
      ('rankball_recruiting_close_action', 'public.rankball_recruiting_close_action(text,text)'),
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)'),
      ('rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'),
      ('rankball_recruiting_ready_action', 'public.rankball_recruiting_ready_action(text,text,boolean)'),
      ('rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
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
    select function_name, signature, to_regprocedure(signature) as proc_oid
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
