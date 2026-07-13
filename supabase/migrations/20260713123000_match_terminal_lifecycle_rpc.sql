-- Commit terminal match lifecycle actions under a per-match transaction lock.

create or replace function public.rankball_match_terminal_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text
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
  current_match public.matches%rowtype;
  operator_id text;
  after_start boolean := false;
  notification_title text;
  notification_body text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_action not in ('cancelMatch', 'deleteSoloRecord', 'voidMatch') then
    raise exception 'invalid_match_terminal_action' using errcode = '22023';
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

  if safe_action = 'cancelMatch' then
    if current_match.status not in ('contract', 'agreed') then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_cancellable', 'matchId', safe_match_id);
    end if;

    after_start := current_match.started_at is not null
      or current_match.ended_at is not null
      or exists (select 1 from public.match_results result where result.match_id = safe_match_id);
    operator_id := case
      when after_start and nullif(current_match.referee_id, '') is not null then current_match.referee_id
      else current_match.created_by
    end;
    if safe_actor_id <> coalesce(operator_id, '') then
      raise exception 'match_cancel_permission_denied' using errcode = '42501';
    end if;

    update public.matches
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
    where id = safe_match_id;
    notification_title := '경기 취소';
    notification_body := format('%s 경기방이 취소됐습니다.', current_match.title);
  elsif safe_action = 'voidMatch' then
    if current_match.status <> 'disputed' then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_voidable', 'matchId', safe_match_id);
    end if;

    operator_id := coalesce(nullif(current_match.referee_id, ''), current_match.created_by);
    if safe_actor_id <> coalesce(operator_id, '') then
      raise exception 'match_void_permission_denied' using errcode = '42501';
    end if;

    update public.matches
    set status = 'void', ranked = false, voided_at = coalesce(voided_at, now()), updated_at = now()
    where id = safe_match_id;
    notification_title := '결과 무효';
    notification_body := format('%s 결과가 랭킹 반영에서 제외됐습니다.', current_match.title);
  else
    if current_match.created_by <> safe_actor_id
      or coalesce(current_match.rules->>'recordType', '') <> 'solo'
      or current_match.status = 'cancelled'
    then
      raise exception 'solo_record_delete_permission_denied' using errcode = '42501';
    end if;

    update public.matches
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
    where id = safe_match_id;
    notification_title := '개인 기록 삭제';
    notification_body := format('%s 기록을 삭제했습니다.', current_match.title);
  end if;

  insert into public.notifications (
    id, user_id, title, body, tone, match_id, payload, created_at, updated_at
  ) values (
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    safe_actor_id,
    notification_title,
    notification_body,
    'match',
    safe_match_id,
    jsonb_build_object('source', 'match_terminal_action', 'action', safe_action),
    now(),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_terminal_action(text, text, text) from public;
revoke all on function public.rankball_match_terminal_action(text, text, text) from anon;
revoke all on function public.rankball_match_terminal_action(text, text, text) from authenticated;
grant execute on function public.rankball_match_terminal_action(text, text, text) to service_role;

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
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)'),
      ('rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'),
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
