do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.rankball_approve_court_request(text,integer,text)',
    'public.rankball_apply_profile_trust_deltas(text,text,jsonb)',
    'public.rankball_cleanup_room_feed(timestamptz)',
    'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)',
    'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)',
    'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)',
    'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)',
    'public.rankball_delete_team(text,text,jsonb)',
    'public.rankball_feed_trigger_health()',
    'public.rankball_invite_team_member(text,text,text,text)',
    'public.rankball_invite_team_member(text,text,text,text,text)',
    'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)',
    'public.rankball_match_agree_action(text,text,text,text)',
    'public.rankball_match_checkin_action(text,text,text,text)',
    'public.rankball_match_end_action(text,text,text,text)',
    'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)',
    'public.rankball_match_list(text,integer,text,boolean)',
    'public.rankball_match_start_action(text,text,text,text,jsonb)',
    'public.rankball_normalize_match_dispute_rows(jsonb,text)',
    'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)',
    'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)',
    'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)',
    'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)',
    'public.rankball_rebuild_profile_match_summary(text)',
    'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)',
    'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)',
    'public.rankball_recruiting_cancel_participation_action(text,text)',
    'public.rankball_recruiting_feed_counts(text)',
    'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)',
    'public.rankball_recruiting_slot_position_action(text,text,text,text)',
    'public.rankball_referee_rls_policy_health()',
    'public.rankball_refresh_all_profile_match_summaries()',
    'public.rankball_refresh_profile_match_summaries_for_match(text)',
    'public.rankball_report_court_request(text,text,text)',
    'public.rankball_respond_team_invitation(text,text,text)',
    'public.rankball_rls_policy_health()',
    'public.rankball_submit_court_request(text,jsonb)',
    'public.rankball_submit_court_review(text,jsonb)',
    'public.rankball_sync_team_membership(text,jsonb,jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public', signature);
    execute format('revoke all on function %s from anon', signature);
    execute format('revoke all on function %s from authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');
