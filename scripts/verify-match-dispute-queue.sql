begin;

do $$
declare
  host_id text;
  guest_id text;
  verify_match_id text := 'verify_dispute_' || replace(gen_random_uuid()::text, '-', '');
  host_dispute_id text;
  guest_dispute_id text;
  action_result jsonb;
  open_count integer;
  saved_status text;
  saved_guest_points integer;
  saved_approval_count integer;
begin
  select profile.id into host_id
  from public.profiles profile
  where not exists (
    select 1 from public.admin_disciplinary_actions action
    where action.user_id = profile.id
      and action.type <> 'public_room_suspension'
      and action.status = 'active'
      and coalesce(action.starts_at, now()) <= now()
      and (action.ends_at is null or action.ends_at > now())
  )
  order by profile.id
  limit 1;

  select profile.id into guest_id
  from public.profiles profile
  where profile.id <> host_id
    and not exists (
      select 1 from public.admin_disciplinary_actions action
      where action.user_id = profile.id
        and action.type <> 'public_room_suspension'
        and action.status = 'active'
        and coalesce(action.starts_at, now()) <= now()
        and (action.ends_at is null or action.ends_at > now())
    )
  order by profile.id
  limit 1;

  if host_id is null or guest_id is null then
    raise exception 'parallel_dispute_verification_profiles_missing';
  end if;

  insert into public.matches (
    id, title, mode, status, visibility, created_by, ended_at,
    dispute_minutes, rules, score_a, score_b, created_at, updated_at
  ) values (
    verify_match_id, '병렬 이의제기 롤백 검증', '1v1', 'approval', 'private', host_id,
    clock_timestamp() - interval '1 minute', 10,
    jsonb_build_object('recordType', 'match', 'visibility', 'private'),
    5, 7, clock_timestamp(), clock_timestamp()
  );

  insert into public.match_players (match_id, user_id, side, slot_order)
  values (verify_match_id, host_id, 'teamA', 0), (verify_match_id, guest_id, 'teamB', 0);

  insert into public.match_results (match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at)
  values (verify_match_id, host_id, 5, 7, '{}'::jsonb, clock_timestamp());

  insert into public.player_match_stats (match_id, user_id, recorded_by, record_source, points, fouls)
  values
    (verify_match_id, host_id, host_id, 'player', 5, 0),
    (verify_match_id, guest_id, guest_id, 'player', 7, 0);

  insert into public.match_approvals (match_id, user_id, side, approved_at)
  values
    (verify_match_id, host_id, 'teamA', clock_timestamp()),
    (verify_match_id, guest_id, 'teamB', clock_timestamp());

  action_result := public.rankball_match_dispute_action(
    host_id,
    verify_match_id,
    jsonb_build_object('reason', '방장 득점 확인', 'playerId', host_id, 'requestedPoints', 6)
  );
  if coalesce((action_result->>'ok')::boolean, false) is not true then
    raise exception 'parallel_dispute_host_submit_failed';
  end if;

  action_result := public.rankball_match_dispute_action(
    guest_id,
    verify_match_id,
    jsonb_build_object('reason', '참가자 득점 확인', 'playerId', guest_id, 'requestedPoints', 9)
  );
  if coalesce((action_result->>'ok')::boolean, false) is not true then
    raise exception 'parallel_dispute_guest_submit_failed';
  end if;

  select count(*)::integer into open_count
  from public.match_disputes
  where match_id = verify_match_id and status = 'open';
  if open_count <> 2 then
    raise exception 'parallel_dispute_open_count_expected_2_got_%', open_count;
  end if;

  select dispute.id::text into host_dispute_id
  from public.match_disputes dispute
  where dispute.match_id = verify_match_id and dispute.user_id = host_id and dispute.status = 'open';
  select dispute.id::text into guest_dispute_id
  from public.match_disputes dispute
  where dispute.match_id = verify_match_id and dispute.user_id = guest_id and dispute.status = 'open';

  action_result := public.rankball_match_resolve_dispute_action(host_id, verify_match_id, guest_dispute_id, 'accepted');
  if coalesce((action_result->>'openCount')::integer, -1) <> 1 then
    raise exception 'parallel_dispute_first_resolution_failed';
  end if;

  select status into saved_status from public.matches where id = verify_match_id;
  if saved_status <> 'disputed' then
    raise exception 'parallel_dispute_closed_too_early';
  end if;

  action_result := public.rankball_match_resolve_dispute_action(host_id, verify_match_id, host_dispute_id, 'rejected');
  if coalesce((action_result->>'openCount')::integer, -1) <> 0 then
    raise exception 'parallel_dispute_final_resolution_failed';
  end if;

  select status into saved_status from public.matches where id = verify_match_id;
  select points into saved_guest_points
  from public.player_match_stats where match_id = verify_match_id and user_id = guest_id;
  select count(*)::integer into saved_approval_count
  from public.match_approvals where match_id = verify_match_id;

  if saved_status <> 'approval' then
    raise exception 'parallel_dispute_reapproval_expected';
  end if;
  if saved_guest_points <> 9 then
    raise exception 'parallel_dispute_accepted_points_not_saved';
  end if;
  if saved_approval_count <> 0 then
    raise exception 'parallel_dispute_old_approvals_not_cleared';
  end if;
end;
$$;

rollback;

select 'parallel_dispute_queue_verified' as result;
