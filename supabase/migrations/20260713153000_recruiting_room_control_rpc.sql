create or replace function public.rankball_recruiting_stat_recorder_action(
  p_actor_profile_id text,
  p_post_id text,
  p_side text,
  p_player_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_side text := nullif(btrim(p_side), '');
  requested_player_id text := nullif(btrim(p_player_id), '');
  next_player_id text := requested_player_id;
  other_side text;
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_recorders jsonb;
  next_recorders jsonb;
  owner_id text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_recruiting_side' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  owner_id := coalesce(nullif(current_room_state->>'ownerId', ''), nullif(current_post.player_id, ''));
  if owner_id is distinct from safe_actor_id then
    raise exception 'recruiting_room_owner_required' using errcode = '42501';
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;
  if nullif(current_post.referee_id, '') is not null then
    raise exception 'recruiting_recorder_disabled_with_referee' using errcode = '42501';
  end if;

  current_recorders := case
    when jsonb_typeof(current_room_state->'statRecorders') = 'object' then current_room_state->'statRecorders'
    else '{}'::jsonb
  end;

  if requested_player_id is not null and current_recorders->>safe_side = requested_player_id then
    next_player_id := null;
  elsif requested_player_id is not null and not exists (
    select 1
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.kind = 'player'
      and application.player_id = requested_player_id
      and application.side = safe_side
      and application.reserve = true
      and application.status = 'ready'
      and not exists (
        select 1
        from public.recruiting_applications active_application
        where active_application.post_id = safe_post_id
          and active_application.reserve = false
          and (
            active_application.player_id = requested_player_id
            or coalesce(active_application.player_ids, '[]'::jsonb) ? requested_player_id
          )
      )
      and not (coalesce(current_post.player_ids, '[]'::jsonb) ? requested_player_id)
  ) then
    return jsonb_build_object(
      'ok', false,
      'fallback', true,
      'reason', 'recruiting_complex_recorder_requires_replay',
      'postId', safe_post_id
    );
  end if;

  next_recorders := jsonb_set(
    current_recorders,
    array[safe_side],
    to_jsonb(coalesce(next_player_id, '')),
    true
  );
  other_side := case when safe_side = 'teamA' then 'teamB' else 'teamA' end;
  if next_player_id is not null and next_recorders->>other_side = next_player_id then
    next_recorders := jsonb_set(next_recorders, array[other_side], to_jsonb(''::text), true);
  end if;

  update public.recruiting_posts
  set
    room_state = jsonb_set(current_room_state, '{statRecorders}', next_recorders, true),
    updated_at = now()
  where id = safe_post_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setRecruitingStatRecorder',
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'side', safe_side,
    'playerId', coalesce(next_player_id, ''),
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) from public;
revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) from anon;
revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) from authenticated;
grant execute on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) to service_role;

create or replace function public.rankball_recruiting_close_action(
  p_actor_profile_id text,
  p_post_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  next_room_state jsonb;
  host_penalties jsonb;
  owner_id text;
  application_count integer := 0;
  penalty integer := 0;
  hours_until numeric := 1000000;
  scheduled_time_at timestamptz;
  is_short_notice boolean := false;
  notification_id text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  owner_id := coalesce(nullif(current_room_state->>'ownerId', ''), nullif(current_post.player_id, ''));
  if owner_id is distinct from safe_actor_id then
    raise exception 'recruiting_room_owner_required' using errcode = '42501';
  end if;
  if current_post.status = 'closed' then
    return jsonb_build_object(
      'ok', true,
      'action', 'closeRecruitingPost',
      'postId', safe_post_id,
      'alreadyClosed', true,
      'penalty', 0,
      'sqlReducer', true
    );
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;

  select count(*)::integer
  into application_count
  from public.recruiting_applications
  where post_id = safe_post_id;

  if current_post.scheduled_date is not null and current_post.scheduled_time is not null then
    scheduled_time_at := (current_post.scheduled_date + current_post.scheduled_time) at time zone 'Asia/Seoul';
    hours_until := extract(epoch from (scheduled_time_at - now())) / 3600;
    is_short_notice := extract(epoch from (scheduled_time_at - current_post.created_at)) / 3600 <= 24;
  end if;

  if application_count > 0 or hours_until <= 24 then
    penalty := case when application_count > 0 then 2 else 0 end;
    if not coalesce(current_post.host_ready, false) then
      penalty := penalty + 2;
    end if;
    penalty := penalty + case
      when hours_until < 0 then 8
      when hours_until <= 6 then 5
      when hours_until <= 24 then 3
      when hours_until <= 72 then 1
      else 0
    end;
    if is_short_notice then
      penalty := greatest(0, penalty - 2);
    end if;
    penalty := least(12, penalty);
  end if;

  host_penalties := case
    when jsonb_typeof(current_room_state->'hostPenalties') = 'array' then current_room_state->'hostPenalties'
    else '[]'::jsonb
  end;
  if penalty > 0 then
    host_penalties := host_penalties || jsonb_build_array(jsonb_build_object(
      'id', 'penalty_' || replace(gen_random_uuid()::text, '-', ''),
      'by', safe_actor_id,
      'penalty', penalty,
      'reason', 'room_closed',
      'createdAt', now()
    ));
  end if;

  next_room_state := jsonb_set(current_room_state, '{hostPenalties}', host_penalties, true);
  next_room_state := jsonb_set(next_room_state, '{invitations}', '[]'::jsonb, true);

  update public.recruiting_posts
  set
    status = 'closed',
    room_state = next_room_state,
    updated_at = now()
  where id = safe_post_id;

  if penalty > 0 then
    update public.profiles
    set
      trust_score = greatest(0, coalesce(trust_score, 80) - penalty),
      updated_at = now()
    where id = safe_actor_id;
    if not found then
      raise exception 'profile_not_found' using errcode = '22023';
    end if;

    notification_id := 'n_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      recruiting_post_id,
      discord_event,
      payload,
      created_at,
      updated_at
    ) values (
      notification_id,
      safe_actor_id,
      safe_actor_id,
      '방 닫기 페널티',
      '대기 인원 또는 임박한 일정이 있는 방을 닫아 신뢰 점수가 감소했습니다.',
      'orange',
      'recruiting_closed',
      safe_post_id,
      'recruiting',
      jsonb_build_object(
        'id', notification_id,
        'targetUserId', safe_actor_id,
        'recruitingPostId', safe_post_id,
        'penalty', penalty,
        'skipDiscordSync', true
      ),
      now(),
      now()
    );
  end if;

  update public.room_discord_links
  set enabled = false, updated_at = now()
  where room_type = 'recruiting'
    and room_id = safe_post_id
    and enabled = true;

  return jsonb_build_object(
    'ok', true,
    'action', 'closeRecruitingPost',
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'penalty', penalty,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_close_action(text, text) from public;
revoke all on function public.rankball_recruiting_close_action(text, text) from anon;
revoke all on function public.rankball_recruiting_close_action(text, text) from authenticated;
grant execute on function public.rankball_recruiting_close_action(text, text) to service_role;

revoke all on function public.rankball_recruiting_ready_action(text, text, boolean) from public;
revoke all on function public.rankball_recruiting_ready_action(text, text, boolean) from anon;
revoke all on function public.rankball_recruiting_ready_action(text, text, boolean) from authenticated;
grant execute on function public.rankball_recruiting_ready_action(text, text, boolean) to service_role;

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
