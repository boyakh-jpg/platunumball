begin;

-- Grant health is registry-backed so new RPC migrations add one contract row
-- instead of copying and replacing the complete health function.
create table if not exists public.rankball_rpc_contract_registry (
  contract_scope text not null,
  contract_name text not null,
  function_name text not null,
  signature text not null,
  lifecycle text not null default 'active',
  service_role_execute boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (contract_scope, contract_name),
  constraint rankball_rpc_contract_registry_scope_check
    check (contract_scope in ('general', 'authoritative')),
  constraint rankball_rpc_contract_registry_lifecycle_check
    check (lifecycle in ('active', 'retired')),
  constraint rankball_rpc_contract_registry_execute_check
    check (
      (lifecycle = 'active' and service_role_execute = true)
      or (lifecycle = 'retired' and service_role_execute = false)
    )
);

comment on table public.rankball_rpc_contract_registry is
  'Current and retired server RPC execute contracts used by schema health.';

alter table public.rankball_rpc_contract_registry enable row level security;
revoke all on table public.rankball_rpc_contract_registry
  from public, anon, authenticated, service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  ('general', 'rankball_admin_auto_group_nearby_courts', 'rankball_admin_auto_group_nearby_courts', 'public.rankball_admin_auto_group_nearby_courts(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_admin_level_for_profile', 'rankball_admin_level_for_profile', 'public.rankball_admin_level_for_profile(text,integer)', 'active', true),
  ('general', 'rankball_admin_review_court_with_auto_unit', 'rankball_admin_review_court_with_auto_unit', 'public.rankball_admin_review_court_with_auto_unit(text,integer,text,text,jsonb,text)', 'active', true),
  ('general', 'rankball_admin_room_remake_stats', 'rankball_admin_room_remake_stats', 'public.rankball_admin_room_remake_stats(text,integer,text,integer)', 'active', true),
  ('general', 'rankball_admin_update_court_with_auto_unit', 'rankball_admin_update_court_with_auto_unit', 'public.rankball_admin_update_court_with_auto_unit(text,integer,text,jsonb,text)', 'active', true),
  ('general', 'rankball_admin_update_courts_batch_with_auto_unit', 'rankball_admin_update_courts_batch_with_auto_unit', 'public.rankball_admin_update_courts_batch_with_auto_unit(text,integer,jsonb,text)', 'active', true),
  ('general', 'rankball_admin_user_operations', 'rankball_admin_user_operations', 'public.rankball_admin_user_operations(text,integer,integer,integer,text,boolean)', 'active', true),
  ('general', 'rankball_admin_verify_nearby_court_count', 'rankball_admin_verify_nearby_court_count', 'public.rankball_admin_verify_nearby_court_count(text,integer,text,integer,text,jsonb,text)', 'active', true),
  ('general', 'rankball_approve_court_request', 'rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)', 'active', true),
  ('general', 'rankball_apply_court_correction_report', 'rankball_apply_court_correction_report', 'public.rankball_apply_court_correction_report(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_apply_profile_trust_deltas', 'rankball_apply_profile_trust_deltas', 'public.rankball_apply_profile_trust_deltas(text,text,jsonb)', 'active', true),
  ('general', 'rankball_archive_and_cleanup_completed_records', 'rankball_archive_and_cleanup_completed_records', 'public.rankball_archive_and_cleanup_completed_records(integer,timestamptz)', 'active', true),
  ('general', 'rankball_assert_match_actor_active', 'rankball_assert_match_actor_active', 'public.rankball_assert_match_actor_active(text)', 'active', true),
  ('general', 'rankball_assert_tournament_team_snapshot_eligible', 'rankball_assert_tournament_team_snapshot_eligible', 'public.rankball_assert_tournament_team_snapshot_eligible(text,integer,boolean,text,text,jsonb)', 'active', true),
  ('general', 'rankball_cleanup_read_notifications', 'rankball_cleanup_read_notifications', 'public.rankball_cleanup_read_notifications(timestamptz)', 'active', true),
  ('general', 'rankball_cleanup_room_feed', 'rankball_cleanup_room_feed', 'public.rankball_cleanup_room_feed(timestamptz)', 'active', true),
  ('general', 'rankball_cleanup_simulation_artifacts', 'rankball_cleanup_simulation_artifacts', 'public.rankball_cleanup_simulation_artifacts()', 'active', true),
  ('general', 'rankball_cleanup_simulation_artifacts_exact', 'rankball_cleanup_simulation_artifacts_exact', 'public.rankball_cleanup_simulation_artifacts_exact(text[],text[])', 'active', true),
  ('general', 'rankball_cleanup_simulation_notices', 'rankball_cleanup_simulation_notices', 'public.rankball_cleanup_simulation_notices()', 'active', true),
  ('general', 'rankball_cleanup_simulation_recruiting_artifacts', 'rankball_cleanup_simulation_recruiting_artifacts', 'public.rankball_cleanup_simulation_recruiting_artifacts(integer)', 'active', true),
  ('general', 'rankball_confirm_recruiting_match_action', 'rankball_confirm_recruiting_match_action', 'public.rankball_confirm_recruiting_match_action(text,text,jsonb,jsonb,jsonb,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'active', true),
  ('general', 'rankball_commit_admin_appointment_action', 'rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)', 'active', true),
  ('general', 'rankball_commit_admin_disciplinary_action', 'rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)', 'active', true),
  ('general', 'rankball_commit_admin_manual_user_action', 'rankball_commit_admin_manual_user_action', 'public.rankball_commit_admin_manual_user_action(text,integer,text,text,integer,text,text)', 'active', true),
  ('general', 'rankball_commit_admin_review_action', 'rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)', 'active', true),
  ('general', 'rankball_commit_match_rating', 'rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)', 'active', true),
  ('general', 'rankball_court_detail_review_rows', 'rankball_court_detail_review_rows', 'public.rankball_court_detail_review_rows(text,text,integer)', 'active', true),
  ('general', 'rankball_court_reviewable_matches', 'rankball_court_reviewable_matches', 'public.rankball_court_reviewable_matches(text,text,text,integer)', 'active', true),
  ('general', 'rankball_current_recruiting_post_ids', 'rankball_current_recruiting_post_ids', 'public.rankball_current_recruiting_post_ids(text,integer)', 'active', true),
  ('general', 'rankball_delete_team', 'rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)', 'active', true),
  ('general', 'rankball_dispute_window_health', 'rankball_dispute_window_health', 'public.rankball_dispute_window_health()', 'active', true),
  ('general', 'rankball_event_profile_eligible', 'rankball_event_profile_eligible', 'public.rankball_event_profile_eligible(text,boolean,text,numeric,text,jsonb)', 'active', true),
  ('general', 'rankball_event_profile_mmr', 'rankball_event_profile_mmr', 'public.rankball_event_profile_mmr(text)', 'active', true),
  ('general', 'rankball_expire_unconfirmed_recruiting_rooms', 'rankball_expire_unconfirmed_recruiting_rooms', 'public.rankball_expire_unconfirmed_recruiting_rooms(timestamptz)', 'active', true),
  ('general', 'rankball_extend_admin_appointment_action', 'rankball_extend_admin_appointment_action', 'public.rankball_extend_admin_appointment_action(text,integer,text,integer,text)', 'active', true),
  ('general', 'rankball_feed_trigger_health', 'rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()', 'active', true),
  ('general', 'rankball_get_rating_policy', 'rankball_get_rating_policy', 'public.rankball_get_rating_policy(text,integer)', 'active', true),
  ('general', 'rankball_invite_team_member_4', 'rankball_invite_team_member', 'public.rankball_invite_team_member(text,text,text,text)', 'active', true),
  ('general', 'rankball_invite_team_member_5', 'rankball_invite_team_member', 'public.rankball_invite_team_member(text,text,text,text,text)', 'active', true),
  ('general', 'rankball_mark_notifications_read_action', 'rankball_mark_notifications_read_action', 'public.rankball_mark_notifications_read_action(text,text,boolean,timestamptz)', 'active', true),
  ('general', 'rankball_match_action', 'rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'active', true),
  ('general', 'rankball_match_action_with_rating', 'rankball_match_action_with_rating', 'public.rankball_match_action_with_rating(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,jsonb,jsonb,timestamptz)', 'active', true),
  ('general', 'rankball_match_agree_action', 'rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_approval_action', 'rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_attendance_qr_action', 'rankball_match_attendance_qr_action', 'public.rankball_match_attendance_qr_action(text,text)', 'active', true),
  ('general', 'rankball_match_attendance_resize_action', 'rankball_match_attendance_resize_action', 'public.rankball_match_attendance_resize_action(text,text)', 'active', true),
  ('general', 'rankball_match_auto_finalize_action', 'rankball_match_auto_finalize_action', 'public.rankball_match_auto_finalize_action(text,timestamptz)', 'active', true),
  ('general', 'rankball_match_checkin_action', 'rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_clock_action', 'rankball_match_clock_action', 'public.rankball_match_clock_action(text,text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_confirm_pickup_assignment', 'rankball_match_confirm_pickup_assignment', 'public.rankball_match_confirm_pickup_assignment(text,text,text,integer)', 'active', true),
  ('general', 'rankball_match_dispute_action', 'rankball_match_dispute_action', 'public.rankball_match_dispute_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_end_action', 'rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_generate_pickup_assignment', 'rankball_match_generate_pickup_assignment', 'public.rankball_match_generate_pickup_assignment(text,text,text)', 'active', true),
  ('general', 'rankball_match_late_player_action_legacy', 'rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)', 'retired', false),
  ('general', 'rankball_match_list', 'rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)', 'active', true),
  ('general', 'rankball_match_list_legacy_3arg', 'rankball_match_list', 'public.rankball_match_list(text,integer,text)', 'retired', false),
  ('general', 'rankball_match_overlap_policy_health', 'rankball_match_overlap_policy_health', 'public.rankball_match_overlap_policy_health()', 'active', true),
  ('general', 'rankball_match_room_update_action', 'rankball_match_room_update_action', 'public.rankball_match_room_update_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_roster_move_action_legacy', 'rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)', 'retired', false),
  ('general', 'rankball_match_roster_transition_action', 'rankball_match_roster_transition_action', 'public.rankball_match_roster_transition_action(text,text,text,text,text,text,text,text)', 'active', true),
  ('general', 'rankball_match_rule_ack_action', 'rankball_match_rule_ack_action', 'public.rankball_match_rule_ack_action(text,text,integer)', 'active', true),
  ('general', 'rankball_match_schedule_response_action', 'rankball_match_schedule_response_action', 'public.rankball_match_schedule_response_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_score_increment_action', 'rankball_match_score_increment_action', 'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)', 'active', true),
  ('general', 'rankball_match_score_operation_policy_health', 'rankball_match_score_operation_policy_health', 'public.rankball_match_score_operation_policy_health()', 'active', true),
  ('general', 'rankball_match_star_toggle_action', 'rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)', 'active', true),
  ('general', 'rankball_match_start_action', 'rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_start_action_guarded', 'rankball_match_start_action_guarded', 'public.rankball_match_start_action_guarded(text,text,text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_substitute_action', 'rankball_match_substitute_action', 'public.rankball_match_substitute_action(text,text,text,text,text,text)', 'active', true),
  ('general', 'rankball_match_swap_pickup_players', 'rankball_match_swap_pickup_players', 'public.rankball_match_swap_pickup_players(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_team_roster_action', 'rankball_match_team_roster_action', 'public.rankball_match_team_roster_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_terminal_action', 'rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_terminal_action_legacy_3arg', 'rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text)', 'retired', false),
  ('general', 'rankball_match_thumbs_action', 'rankball_match_thumbs_action', 'public.rankball_match_thumbs_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_moderate_reported_name', 'rankball_moderate_reported_name', 'public.rankball_moderate_reported_name(text,integer,text,text,text,text,text,text)', 'active', true),
  ('general', 'rankball_moderate_team_emblem', 'rankball_moderate_team_emblem', 'public.rankball_moderate_team_emblem(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_moderate_team_emblem_guarded', 'rankball_moderate_team_emblem_guarded', 'public.rankball_moderate_team_emblem_guarded(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_normalize_match_dispute_rows', 'rankball_normalize_match_dispute_rows', 'public.rankball_normalize_match_dispute_rows(jsonb,text)', 'active', true),
  ('general', 'rankball_persist_match_snapshot', 'rankball_persist_match_snapshot', 'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'active', true),
  ('general', 'rankball_persist_recruiting_snapshot', 'rankball_persist_recruiting_snapshot', 'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_persist_tournament_snapshot', 'rankball_persist_tournament_snapshot', 'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_persist_tournament_snapshot_locked', 'rankball_persist_tournament_snapshot_locked', 'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_profile_icon_metrics', 'rankball_profile_icon_metrics', 'public.rankball_profile_icon_metrics(text)', 'active', true),
  ('general', 'rankball_profile_icon_verified_metrics', 'rankball_profile_icon_verified_metrics', 'public.rankball_profile_icon_verified_metrics(text)', 'active', true),
  ('general', 'rankball_profile_identity_health', 'rankball_profile_identity_health', 'public.rankball_profile_identity_health()', 'active', true),
  ('general', 'rankball_profile_representative_team_id', 'rankball_profile_representative_team_id', 'public.rankball_profile_representative_team_id(text)', 'active', true),
  ('general', 'rankball_quarantine_simulation_artifacts', 'rankball_quarantine_simulation_artifacts', 'public.rankball_quarantine_simulation_artifacts(timestamptz)', 'active', true),
  ('general', 'rankball_rebuild_profile_match_summary', 'rankball_rebuild_profile_match_summary', 'public.rankball_rebuild_profile_match_summary(text)', 'active', true),
  ('general', 'rankball_recruiting_action', 'rankball_recruiting_action', 'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)', 'active', true),
  ('general', 'rankball_recruiting_applicant_placement_action', 'rankball_recruiting_applicant_placement_action', 'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)', 'active', true),
  ('general', 'rankball_recruiting_cancel_participation_action', 'rankball_recruiting_cancel_participation_action', 'public.rankball_recruiting_cancel_participation_action(text,text)', 'active', true),
  ('general', 'rankball_recruiting_close_action', 'rankball_recruiting_close_action', 'public.rankball_recruiting_close_action(text,text)', 'active', true),
  ('general', 'rankball_recruiting_close_with_reason_action', 'rankball_recruiting_close_with_reason_action', 'public.rankball_recruiting_close_with_reason_action(text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_expire_room_change', 'rankball_recruiting_expire_room_change', 'public.rankball_recruiting_expire_room_change(text)', 'active', true),
  ('general', 'rankball_recruiting_feed_counts', 'rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)', 'active', true),
  ('general', 'rankball_recruiting_interest_player_action', 'rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)', 'active', true),
  ('general', 'rankball_recruiting_invitation_decision_action', 'rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_invite_players_action', 'rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)', 'active', true),
  ('general', 'rankball_recruiting_ready_action', 'rankball_recruiting_ready_action', 'public.rankball_recruiting_ready_action(text,text,boolean)', 'active', true),
  ('general', 'rankball_recruiting_room_update_action', 'rankball_recruiting_room_update_action', 'public.rankball_recruiting_room_update_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_recruiting_rule_ack_action', 'rankball_recruiting_rule_ack_action', 'public.rankball_recruiting_rule_ack_action(text,text,integer)', 'active', true),
  ('general', 'rankball_recruiting_schedule_response_action', 'rankball_recruiting_schedule_response_action', 'public.rankball_recruiting_schedule_response_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_set_room_team_action', 'rankball_recruiting_set_room_team_action', 'public.rankball_recruiting_set_room_team_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_side_party_join_action', 'rankball_recruiting_side_party_join_action', 'public.rankball_recruiting_side_party_join_action(text,text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_slot_position_action', 'rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_stat_recorder_action_legacy', 'rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)', 'retired', false),
  ('general', 'rankball_referee_rls_policy_health', 'rankball_referee_rls_policy_health', 'public.rankball_referee_rls_policy_health()', 'active', true),
  ('general', 'rankball_refresh_all_profile_match_summaries', 'rankball_refresh_all_profile_match_summaries', 'public.rankball_refresh_all_profile_match_summaries()', 'active', true),
  ('general', 'rankball_refresh_match_feed_for_match', 'rankball_refresh_match_feed_for_match', 'public.rankball_refresh_match_feed_for_match(text)', 'active', true),
  ('general', 'rankball_refresh_profile_match_summaries_for_match', 'rankball_refresh_profile_match_summaries_for_match', 'public.rankball_refresh_profile_match_summaries_for_match(text)', 'active', true),
  ('general', 'rankball_refresh_recruiting_feed_for_post', 'rankball_refresh_recruiting_feed_for_post', 'public.rankball_refresh_recruiting_feed_for_post(text)', 'active', true),
  ('general', 'rankball_related_active_match_list', 'rankball_related_active_match_list', 'public.rankball_related_active_match_list(text,integer,boolean)', 'active', true),
  ('general', 'rankball_report_court_request', 'rankball_report_court_request', 'public.rankball_report_court_request(text,text,text)', 'active', true),
  ('general', 'rankball_resolve_duplicate_court_report', 'rankball_resolve_duplicate_court_report', 'public.rankball_resolve_duplicate_court_report(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_respond_team_invitation', 'rankball_respond_team_invitation', 'public.rankball_respond_team_invitation(text,text,text)', 'active', true),
  ('general', 'rankball_restore_team_emblem', 'rankball_restore_team_emblem', 'public.rankball_restore_team_emblem(text,text,text,text)', 'active', true),
  ('general', 'rankball_review_void_match_report', 'rankball_review_void_match_report', 'public.rankball_review_void_match_report(text,integer,text,text,text,text,integer,text,text)', 'active', true),
  ('general', 'rankball_rls_policy_health', 'rankball_rls_policy_health', 'public.rankball_rls_policy_health()', 'active', true),
  ('general', 'rankball_rpc_grant_health', 'rankball_rpc_grant_health', 'public.rankball_rpc_grant_health()', 'active', true),
  ('general', 'rankball_save_profile_icon_settings_6', 'rankball_save_profile_icon_settings', 'public.rankball_save_profile_icon_settings(text,text,text,text,boolean,text)', 'active', true),
  ('general', 'rankball_save_profile_icon_settings_7', 'rankball_save_profile_icon_settings', 'public.rankball_save_profile_icon_settings(text,text,text,text,boolean,boolean,text)', 'active', true),
  ('general', 'rankball_select_profile_icon', 'rankball_select_profile_icon', 'public.rankball_select_profile_icon(text,text)', 'active', true),
  ('general', 'rankball_set_profile_affiliation', 'rankball_set_profile_affiliation', 'public.rankball_set_profile_affiliation(text,text,text)', 'active', true),
  ('general', 'rankball_submit_court_request', 'rankball_submit_court_request', 'public.rankball_submit_court_request(text,jsonb)', 'active', true),
  ('general', 'rankball_submit_court_review', 'rankball_submit_court_review', 'public.rankball_submit_court_review(text,jsonb)', 'active', true),
  ('general', 'rankball_sync_team_membership', 'rankball_sync_team_membership', 'public.rankball_sync_team_membership(text,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_tournament_invitation_health', 'rankball_tournament_invitation_health', 'public.rankball_tournament_invitation_health()', 'active', true),
  ('general', 'rankball_tournament_lineup_deadline_batch_action', 'rankball_tournament_lineup_deadline_batch_action', 'public.rankball_tournament_lineup_deadline_batch_action(timestamptz,integer)', 'active', true),
  ('general', 'rankball_tournament_match_forfeit_action', 'rankball_tournament_match_forfeit_action', 'public.rankball_tournament_match_forfeit_action(text,text,text,text,text)', 'active', true),
  ('general', 'rankball_tournament_start_delivery_health', 'rankball_tournament_start_delivery_health', 'public.rankball_tournament_start_delivery_health()', 'active', true),
  ('general', 'rankball_tournament_team_roster_snapshot', 'rankball_tournament_team_roster_snapshot', 'public.rankball_tournament_team_roster_snapshot(text,integer,boolean,text,text,jsonb)', 'active', true),
  ('general', 'rankball_update_profile_emblem', 'rankball_update_profile_emblem', 'public.rankball_update_profile_emblem(text,text,text,text,text,boolean,text,text)', 'active', true),
  ('general', 'rankball_update_rating_policy', 'rankball_update_rating_policy', 'public.rankball_update_rating_policy(text,integer,integer,jsonb,text)', 'active', true),
  ('general', 'rankball_update_team_emblem', 'rankball_update_team_emblem', 'public.rankball_update_team_emblem(text,text,text,text)', 'active', true),
  ('general', 'rankball_update_team_emblem_design', 'rankball_update_team_emblem_design', 'public.rankball_update_team_emblem_design(text,text,text,boolean,text,text,text,text)', 'active', true),
  ('general', 'rankball_update_team_emblem_source', 'rankball_update_team_emblem_source', 'public.rankball_update_team_emblem_source(text,text,text)', 'active', true),
  ('general', 'rankball_update_team_emblem_style', 'rankball_update_team_emblem_style', 'public.rankball_update_team_emblem_style(text,text,text,boolean,text)', 'active', true),
  ('authoritative', 'rankball_authoritative_rpc_grant_health', 'rankball_authoritative_rpc_grant_health', 'public.rankball_authoritative_rpc_grant_health()', 'active', true),
  ('authoritative', 'rankball_create_tournament_match_locked', 'rankball_create_tournament_match_locked', 'public.rankball_create_tournament_match_locked(text,text,text,integer,integer,text)', 'active', true),
  ('authoritative', 'rankball_expire_recruiting_rooms', 'rankball_expire_recruiting_rooms', 'public.rankball_expire_recruiting_rooms(timestamptz)', 'active', true),
  ('authoritative', 'rankball_match_finalize_locked', 'rankball_match_finalize_locked', 'public.rankball_match_finalize_locked(text,text,text,boolean)', 'active', true),
  ('authoritative', 'rankball_match_finalize_locked_legacy_3arg', 'rankball_match_finalize_locked', 'public.rankball_match_finalize_locked(text,text,text)', 'retired', false),
  ('authoritative', 'rankball_match_referee_absence_action', 'rankball_match_referee_absence_action', 'public.rankball_match_referee_absence_action(text,text,text)', 'active', true),
  ('authoritative', 'rankball_match_result_action', 'rankball_match_result_action', 'public.rankball_match_result_action(text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_match_resolve_dispute_action', 'rankball_match_resolve_dispute_action', 'public.rankball_match_resolve_dispute_action(text,text,text,text,text)', 'active', true),
  ('authoritative', 'rankball_match_resolve_dispute_action_legacy_4arg', 'rankball_match_resolve_dispute_action', 'public.rankball_match_resolve_dispute_action(text,text,text,text)', 'retired', false),
  ('authoritative', 'rankball_match_room_action', 'rankball_match_room_action', 'public.rankball_match_room_action(text,text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_recruiting_management_action', 'rankball_recruiting_management_action', 'public.rankball_recruiting_management_action(text,jsonb)', 'active', true),
  ('authoritative', 'rankball_recruiting_stat_recorder_action_legacy', 'rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)', 'retired', false),
  ('authoritative', 'rankball_tournament_advance_locked', 'rankball_tournament_advance_locked', 'public.rankball_tournament_advance_locked(text)', 'active', true),
  ('authoritative', 'rankball_league_finalize_locked', 'rankball_league_finalize_locked', 'public.rankball_league_finalize_locked(text)', 'active', true),
  ('authoritative', 'rankball_tournament_match_lineup_deadline_action', 'rankball_tournament_match_lineup_deadline_action', 'public.rankball_tournament_match_lineup_deadline_action(text,timestamptz)', 'active', true),
  ('authoritative', 'rankball_tournament_match_roster_action', 'rankball_tournament_match_roster_action', 'public.rankball_tournament_match_roster_action(text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_tournament_match_schedule_action', 'rankball_tournament_match_schedule_action', 'public.rankball_tournament_match_schedule_action(text,text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_tournament_operation_action', 'rankball_tournament_operation_action', 'public.rankball_tournament_operation_action(text,jsonb)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

create or replace function public.rankball_rpc_contract_health(
  p_contract_scope text
)
returns table(contract_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with resolved as (
    select
      registry.contract_name,
      registry.function_name,
      registry.signature,
      registry.lifecycle,
      registry.service_role_execute,
      to_regprocedure(registry.signature) as proc_oid
    from public.rankball_rpc_contract_registry registry
    where registry.contract_scope = p_contract_scope
  )
  select
    resolved.contract_name,
    case
      when resolved.lifecycle = 'retired' then
        resolved.proc_oid is null
        or (
          not coalesce(has_function_privilege('service_role', resolved.proc_oid, 'execute'), false)
          and not coalesce(has_function_privilege('anon', resolved.proc_oid, 'execute'), false)
          and not coalesce(has_function_privilege('authenticated', resolved.proc_oid, 'execute'), false)
        )
      else
        resolved.proc_oid is not null
        and coalesce(has_function_privilege('service_role', resolved.proc_oid, 'execute'), false)
          = resolved.service_role_execute
        and not coalesce(has_function_privilege('anon', resolved.proc_oid, 'execute'), false)
        and not coalesce(has_function_privilege('authenticated', resolved.proc_oid, 'execute'), false)
    end,
    jsonb_build_object(
      'function', resolved.function_name,
      'signature', resolved.signature,
      'lifecycle', resolved.lifecycle,
      'exists', resolved.proc_oid is not null,
      'expectedServiceRoleExecute', resolved.service_role_execute,
      'anonExecute', coalesce(has_function_privilege('anon', resolved.proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', resolved.proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', resolved.proc_oid, 'execute'), false)
    )
  from resolved
  order by resolved.contract_name;
$$;

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    'rpc_grant:' || contract.contract_name,
    contract.ok,
    contract.detail
  from public.rankball_rpc_contract_health('general') contract

  union all

  select
    'rpc_grant:rankball_rpc_contract_registry_acl',
    catalog.relrowsecurity
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
    jsonb_build_object(
      'table', 'rankball_rpc_contract_registry',
      'rowLevelSecurity', catalog.relrowsecurity,
      'anonSelect', has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select'),
      'authenticatedSelect', has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleSelect', has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleRpcOnly', true
    )
  from pg_catalog.pg_class catalog
  join pg_catalog.pg_namespace namespace
    on namespace.oid = catalog.relnamespace
  where namespace.nspname = 'public'
    and catalog.relname = 'rankball_rpc_contract_registry'
  order by 1;
$$;

create or replace function public.rankball_authoritative_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    'authoritative_rpc_grant:' || contract.contract_name,
    contract.ok,
    contract.detail
  from public.rankball_rpc_contract_health('authoritative') contract
  order by contract.contract_name;
$$;

-- Current runtime entry points.
revoke all on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) to service_role;

revoke all on function public.rankball_match_substitute_action(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_substitute_action(
  text, text, text, text, text, text
) to service_role;

revoke all on function public.rankball_match_finalize_locked(
  text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(
  text, text, text, boolean
) to service_role;

revoke all on function public.rankball_match_resolve_dispute_action(
  text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_resolve_dispute_action(
  text, text, text, text, text
) to service_role;

revoke all on function public.rankball_match_terminal_action(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_terminal_action(
  text, text, text, text
) to service_role;

revoke all on function public.rankball_match_list(
  text, integer, text, boolean
) from public, anon, authenticated;
grant execute on function public.rankball_match_list(
  text, integer, text, boolean
) to service_role;

-- Legacy reject-only signatures. Their definitions may remain for old rows and
-- audit history, but no service path can execute them.
do $migration$
declare
  legacy_signature text;
begin
  foreach legacy_signature in array array[
    'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)',
    'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)',
    'public.rankball_recruiting_stat_recorder_action(text,text,text,text)',
    'public.rankball_match_finalize_locked(text,text,text)',
    'public.rankball_match_resolve_dispute_action(text,text,text,text)',
    'public.rankball_match_terminal_action(text,text,text)',
    'public.rankball_match_list(text,integer,text)'
  ]
  loop
    if to_regprocedure(legacy_signature) is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated, service_role',
        legacy_signature
      );
    end if;
  end loop;
end;
$migration$;

revoke all on function public.rankball_rpc_contract_health(text)
  from public, anon, authenticated, service_role;

revoke all on function public.rankball_rpc_grant_health()
  from public, anon, authenticated;
grant execute on function public.rankball_rpc_grant_health()
  to service_role;

revoke all on function public.rankball_authoritative_rpc_grant_health()
  from public, anon, authenticated;
grant execute on function public.rankball_authoritative_rpc_grant_health()
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
