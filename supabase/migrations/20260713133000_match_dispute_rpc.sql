-- Commit match dispute intake and draft creation under a per-match lock.

create or replace function public.rankball_match_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_request jsonb default '""'::jsonb
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
  current_result public.match_results%rowtype;
  dispute_reason text;
  requested_player_id text;
  requested_points integer;
  player_stats jsonb := '{}'::jsonb;
  stat_submissions jsonb := '{}'::jsonb;
  dispute_draft jsonb;
  actor_stats jsonb;
  actor_side text;
  score_a integer;
  score_b integer;
  actor_allowed boolean := false;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
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

  select *
  into current_result
  from public.match_results
  where match_id = safe_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_missing', 'matchId', safe_match_id);
  end if;
  if not (
    current_match.status = 'approval'
    or (current_match.status = 'agreed' and current_match.ended_at is not null)
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_disputable', 'matchId', safe_match_id);
  end if;
  if current_match.ended_at is null
    or current_match.ended_at + make_interval(mins => greatest(1, coalesce(current_match.dispute_minutes, 30))) < now()
  then
    raise exception 'match_dispute_window_closed' using errcode = '42501';
  end if;

  select (
    safe_actor_id = coalesce(current_match.created_by, '')
    or safe_actor_id = coalesce(current_match.referee_id, '')
    or exists (
      select 1 from public.match_players player
      where player.match_id = safe_match_id and player.user_id = safe_actor_id
    )
    or (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamA}') ? safe_actor_id
    or (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamB}') ? safe_actor_id
    or (coalesce(current_match.reserve_players, '{}'::jsonb) #> '{teamA}') ? safe_actor_id
    or (coalesce(current_match.reserve_players, '{}'::jsonb) #> '{teamB}') ? safe_actor_id
    or exists (
      select 1
      from jsonb_each_text(case when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders else '{}'::jsonb end) recorder(side, profile_id)
      where recorder.profile_id = safe_actor_id
    )
  ) into actor_allowed;

  if not actor_allowed then
    raise exception 'match_dispute_permission_denied' using errcode = '42501';
  end if;

  dispute_reason := case
    when jsonb_typeof(coalesce(p_dispute_request, '""'::jsonb)) = 'object' then nullif(btrim(p_dispute_request->>'reason'), '')
    when jsonb_typeof(coalesce(p_dispute_request, '""'::jsonb)) = 'string' then nullif(btrim(p_dispute_request #>> '{}'), '')
    else null
  end;
  dispute_reason := left(coalesce(dispute_reason, '스코어 또는 개인 기록 확인이 필요합니다.'), 500);
  requested_player_id := case when jsonb_typeof(coalesce(p_dispute_request, '{}'::jsonb)) = 'object' then nullif(btrim(p_dispute_request->>'playerId'), '') else null end;
  if requested_player_id = safe_actor_id and coalesce(p_dispute_request->>'requestedPoints', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    requested_points := least(9999::numeric, greatest(0::numeric, round((p_dispute_request->>'requestedPoints')::numeric)))::integer;
  else
    requested_points := null;
  end if;

  select coalesce(jsonb_object_agg(stat.user_id, jsonb_build_object(
    'points', greatest(0, coalesce(stat.points, 0)),
    'rebounds', greatest(0, coalesce(stat.rebounds, 0)),
    'assists', greatest(0, coalesce(stat.assists, 0)),
    'steals', greatest(0, coalesce(stat.steals, 0)),
    'blocks', greatest(0, coalesce(stat.blocks, 0)),
    'fouls', greatest(0, coalesce(stat.fouls, 0))
  )), '{}'::jsonb)
  into player_stats
  from public.player_match_stats stat
  where stat.match_id = safe_match_id;

  stat_submissions := coalesce(current_result.stat_submissions, '{}'::jsonb);
  score_a := greatest(0, coalesce(current_result.score_a, 0));
  score_b := greatest(0, coalesce(current_result.score_b, 0));

  if requested_points is not null and player_stats ? safe_actor_id then
    actor_stats := coalesce(player_stats->safe_actor_id, '{}'::jsonb);
    player_stats := jsonb_set(
      player_stats,
      array[safe_actor_id],
      jsonb_set(actor_stats, '{points}', to_jsonb(requested_points), true),
      true
    );

    select coalesce(
      (select player.side from public.match_players player where player.match_id = safe_match_id and player.user_id = safe_actor_id limit 1),
      case when (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamA}') ? safe_actor_id then 'teamA' end,
      case when (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamB}') ? safe_actor_id then 'teamB' end
    ) into actor_side;

    if actor_side = 'teamA' then
      select coalesce(sum(greatest(0, coalesce((player_stats->player_id->>'points')::integer, 0))), 0)::integer
      into score_a
      from (
        select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamA'
        union
        select value from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end) ids(value)
      ) side_players;
    elsif actor_side = 'teamB' then
      select coalesce(sum(greatest(0, coalesce((player_stats->player_id->>'points')::integer, 0))), 0)::integer
      into score_b
      from (
        select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamB'
        union
        select value from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end) ids(value)
      ) side_players;
    end if;
  end if;

  dispute_draft := jsonb_build_object(
    'scoreA', score_a,
    'scoreB', score_b,
    'playerStats', player_stats,
    'statSubmissions', stat_submissions,
    'submittedBy', current_result.submitted_by,
    'submittedAt', current_result.submitted_at,
    'updatedAt', now()
  );

  insert into public.match_disputes (id, match_id, user_id, reason, created_at)
  values (gen_random_uuid(), safe_match_id, safe_actor_id, dispute_reason, now());

  update public.matches
  set
    status = 'disputed',
    dispute_draft_result = dispute_draft,
    dispute_draft_updated_at = now(),
    updated_at = now()
  where id = safe_match_id;

  insert into public.notifications (
    id, user_id, title, body, tone, match_id, payload, created_at, updated_at
  ) values (
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    safe_actor_id,
    '이의제기 접수',
    format('%s 결과가 보류됐습니다.', current_match.title),
    'match',
    safe_match_id,
    jsonb_build_object('source', 'match_dispute_action'),
    now(),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'disputeMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from public;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from anon;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from authenticated;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb) to service_role;

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
