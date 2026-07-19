-- Keep production-visible rows aligned with current action/RPC contracts.
-- This migration only normalizes deterministic values and soft-quarantines synthetic rows.

begin;

create or replace function public.rankball_quarantine_simulation_artifacts(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  closed_teams integer := 0;
  quarantined_sample_matches integer := 0;
  closed_team_invitations integer := 0;
  closed_rooms integer := 0;
  hidden_courts integer := 0;
  closed_court_requests integer := 0;
  closed_exam_attempts integer := 0;
  closed_referee_requests integer := 0;
  closed_referee_appointments integer := 0;
  closed_admin_appointments integer := 0;
  closed_disciplinary_actions integer := 0;
  disconnected_profiles integer := 0;
  read_notifications integer := 0;
  inactive_feed_rows integer := 0;
  quarantined_cards integer := 0;
  affected_profile_id text;
  affected_court_id text;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:simulation-quarantine'));

  update public.teams team
  set deleted_at = coalesce(team.deleted_at, p_now),
      updated_at = p_now
  where team.deleted_at is null
    and team.id like 'sim\_team\_%' escape '\';
  get diagnostics closed_teams = row_count;

  update public.matches match_row
  set status = 'cancelled',
      cancelled_at = coalesce(match_row.cancelled_at, p_now),
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'quarantinedAt', p_now,
        'quarantineReason', 'legacy_sample'
      ),
      updated_at = p_now
  where match_row.id like 'm\_seed\_%' escape '\'
    and match_row.status not in ('cancelled', 'canceled', 'void', 'voided', 'closed');
  get diagnostics quarantined_sample_matches = row_count;

  update public.team_invitations invitation
  set status = 'expired',
      updated_at = p_now
  where invitation.status = 'pending'
    and invitation.id like 'sim\_ti\_%' escape '\';
  get diagnostics closed_team_invitations = row_count;

  update public.recruiting_posts post
  set status = 'closed',
      room_state = coalesce(post.room_state, '{}'::jsonb) || jsonb_build_object(
        'simulationClosedAt', p_now,
        'simulationQuarantined', true
      ),
      updated_at = p_now
  where post.status not in ('closed', 'cancelled', 'expired')
    and (
      post.id like 'sim\_q\_%' escape '\'
      or lower(coalesce(post.title, '')) like 'backend simulation%'
      or lower(coalesce(post.memo, '')) like '%backend simulation%'
    );
  get diagnostics closed_rooms = row_count;

  update public.approved_courts court
  set status = 'hidden',
      hidden_at = coalesce(court.hidden_at, p_now),
      hidden_reason = coalesce(court.hidden_reason, 'simulation_artifact'),
      payload = coalesce(court.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'quarantinedAddressText', court.address_text,
        'quarantinedRoadAddress', court.road_address,
        'quarantinedJibunAddress', court.jibun_address,
        'quarantinedLat', court.lat,
        'quarantinedLng', court.lng,
        'quarantinedAt', p_now,
        'quarantineReason', 'simulation_artifact'
      ),
      address_text = '격리된 시뮬레이션 구장 ' || court.id,
      road_address = null,
      jibun_address = null,
      zonecode = null,
      lat = null,
      lng = null,
      updated_at = p_now
  where court.status = 'active'
    and (
      court.source_request_id like 'sim\_cr\_%' escape '\'
      or court.id like 'court\_sim\_%' escape '\'
      or lower(court.name) like 'backend simulation%'
      or court.name like '코덱스 테스트 %'
    )
    and not exists (select 1 from public.matches match_row where match_row.court_id = court.id)
    and not exists (
      select 1 from public.recruiting_posts post
      where post.court_id = court.id and post.status = 'open'
    )
    and not exists (select 1 from public.tournaments tournament where tournament.court_id = court.id)
    and not exists (select 1 from public.court_reviews review where review.court_id = court.id);
  get diagnostics hidden_courts = row_count;

  update public.court_requests request
  set status = 'simulation_closed',
      payload = coalesce(request.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'quarantinedAt', p_now,
        'quarantineReason', 'simulation_artifact'
      ),
      updated_at = p_now
  where request.id like 'sim\_cr\_%' escape '\'
    and request.status <> 'simulation_closed';
  get diagnostics closed_court_requests = row_count;

  update public.courts court
  set payload = coalesce(court.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'active', false,
        'quarantinedAt', p_now,
        'quarantineReason', 'simulation_artifact'
      )
  where court.id like 'court\_sim\_%' escape '\'
    and coalesce(court.payload->>'active', 'true') <> 'false';

  update public.referee_exam_attempts attempt
  set status = 'simulation_closed',
      available_after = least(coalesce(attempt.available_after, p_now), p_now),
      payload = coalesce(attempt.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'simulationClosedAt', p_now
      ),
      updated_at = p_now
  where attempt.id like 'sim\_rea\_%' escape '\'
    and attempt.status <> 'simulation_closed';
  get diagnostics closed_exam_attempts = row_count;

  update public.referee_requests request
  set status = 'simulation_closed',
      payload = coalesce(request.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'simulationClosedAt', p_now
      ),
      updated_at = p_now
  where request.id like 'sim\_rr\_%' escape '\'
    and request.status <> 'simulation_closed';
  get diagnostics closed_referee_requests = row_count;

  update public.referee_appointments appointment
  set status = 'revoked',
      ends_at = least(coalesce(appointment.ends_at, p_now), p_now),
      payload = coalesce(appointment.payload, '{}'::jsonb) || jsonb_build_object(
        'simulationClosedAt', p_now
      ),
      updated_at = p_now
  where appointment.status = 'active'
    and (
      appointment.id like 'sim\_referee\_appt\_%' escape '\'
      or appointment.payload->>'source' = 'rankball-sim'
    );
  get diagnostics closed_referee_appointments = row_count;

  update public.admin_appointments appointment
  set status = 'revoked',
      ends_at = least(coalesce(appointment.ends_at, p_now), p_now),
      payload = coalesce(appointment.payload, '{}'::jsonb) || jsonb_build_object(
        'simulationClosedAt', p_now
      ),
      updated_at = p_now
  where appointment.status = 'active'
    and (
      appointment.id like 'sim\_%' escape '\'
      or appointment.payload->>'source' = 'rankball-sim'
    );
  get diagnostics closed_admin_appointments = row_count;

  update public.admin_disciplinary_actions action
  set status = case
        when lower(coalesce(action.payload->>'reason', '')) like 'simulation:%' then 'simulation_closed'
        else 'expired'
      end,
      ends_at = least(coalesce(action.ends_at, p_now), p_now),
      payload = coalesce(action.payload, '{}'::jsonb) || jsonb_build_object(
        'simulationClosedAt', p_now
      ),
      updated_at = p_now
  where action.status = 'active'
    and (
      action.ends_at <= p_now
      or lower(coalesce(action.payload->>'reason', '')) like 'simulation:%'
    );
  get diagnostics closed_disciplinary_actions = row_count;

  update public.profiles profile
  set discord_connection = null,
      discord_user_id = null,
      updated_at = p_now
  where profile.test_login_id like 'rankball-%'
    and lower(coalesce(profile.discord_connection->>'username', '')) like 'rankball-sim-%';
  get diagnostics disconnected_profiles = row_count;

  update public.notifications notification
  set read_at = coalesce(notification.read_at, p_now),
      payload = coalesce(notification.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'quarantinedAt', p_now
      ),
      updated_at = p_now
  where notification.read_at is null
    and (
      notification.id like 'n\_sim\_%' escape '\'
      or notification.match_id like 'm\_seed\_%' escape '\'
      or notification.invitation_id like 'sim\_ti\_%' escape '\'
      or notification.payload->>'simulation' = 'true'
      or notification.payload->>'simulationId' like 'sim\_%' escape '\'
      or lower(coalesce(notification.body, '')) like 'backend simulation%'
    );
  get diagnostics read_notifications = row_count;

  update public.user_room_feed feed
  set is_active = false,
      updated_at = p_now
  where feed.is_active
    and (
      feed.entity_id like 'sim\_%' escape '\'
      or feed.entity_id like 'm\_seed\_%' escape '\'
      or (feed.entity_type = 'match' and not exists (
        select 1 from public.matches match_row where match_row.id = feed.entity_id
      ))
      or (feed.entity_type = 'recruiting' and not exists (
        select 1 from public.recruiting_posts post where post.id = feed.entity_id
      ))
    );
  get diagnostics inactive_feed_rows = row_count;

  update public.room_feed_cards card
  set card_json = coalesce(card.card_json, '{}'::jsonb) || jsonb_build_object(
        'status', 'closed',
        'active', false,
        'dataState', 'quarantined',
        'quarantinedAt', p_now
      ),
      updated_at = p_now
  where (
    card.entity_id like 'sim\_%' escape '\'
    or card.entity_id like 'm\_seed\_%' escape '\'
    or (card.entity_type = 'match' and not exists (
      select 1 from public.matches match_row where match_row.id = card.entity_id
    ))
    or (card.entity_type = 'recruiting' and not exists (
      select 1 from public.recruiting_posts post where post.id = card.entity_id
    ))
  )
    and coalesce(card.card_json->>'dataState', '') <> 'quarantined';
  get diagnostics quarantined_cards = row_count;

  if quarantined_sample_matches > 0 then
    for affected_profile_id in
      select distinct player.user_id
      from public.match_players player
      where player.match_id like 'm\_seed\_%' escape '\'
        and exists (select 1 from public.profiles profile where profile.id = player.user_id)
    loop
      perform public.rankball_rebuild_profile_match_summary(affected_profile_id);
    end loop;

    if to_regprocedure('public.rankball_refresh_court_metrics(text)') is not null then
      for affected_court_id in
        select distinct match_row.court_id
        from public.matches match_row
        where match_row.id like 'm\_seed\_%' escape '\'
          and nullif(btrim(match_row.court_id), '') is not null
      loop
        perform public.rankball_refresh_court_metrics(affected_court_id);
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'closedTeams', closed_teams,
    'quarantinedSampleMatches', quarantined_sample_matches,
    'closedTeamInvitations', closed_team_invitations,
    'closedRooms', closed_rooms,
    'hiddenCourts', hidden_courts,
    'closedCourtRequests', closed_court_requests,
    'closedExamAttempts', closed_exam_attempts,
    'closedRefereeRequests', closed_referee_requests,
    'closedRefereeAppointments', closed_referee_appointments,
    'closedAdminAppointments', closed_admin_appointments,
    'closedDisciplinaryActions', closed_disciplinary_actions,
    'disconnectedProfiles', disconnected_profiles,
    'readNotifications', read_notifications,
    'inactiveFeedRows', inactive_feed_rows,
    'quarantinedCards', quarantined_cards
  );
end;
$$;

revoke all on function public.rankball_quarantine_simulation_artifacts(timestamptz) from public, anon, authenticated;
grant execute on function public.rankball_quarantine_simulation_artifacts(timestamptz) to service_role;

create or replace function public.rankball_expire_unconfirmed_recruiting_rooms(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate record;
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_invitations jsonb;
  next_invitations jsonb;
  changed_count integer := 0;
  expired_count integer := 0;
  notification_count integer := 0;
  expired_rooms jsonb := '[]'::jsonb;
begin
  for candidate in
    select post.id
    from public.recruiting_posts post
    where post.status = 'open'
      and post.scheduled_date is not null
      and (post.scheduled_date + coalesce(post.scheduled_time, time '00:00')) at time zone 'Asia/Seoul' < p_now
      and not exists (
        select 1 from public.matches match_row
        where match_row.rules->>'recruitingPostId' = post.id
      )
    order by post.id
  loop
    perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(candidate.id));

    select *
    into current_post
    from public.recruiting_posts
    where id = candidate.id
    for update;

    if not found or current_post.status <> 'open' then
      continue;
    end if;
    if (current_post.scheduled_date + coalesce(current_post.scheduled_time, time '00:00')) at time zone 'Asia/Seoul' >= p_now then
      continue;
    end if;
    if exists (
      select 1 from public.matches match_row
      where match_row.rules->>'recruitingPostId' = current_post.id
    ) then
      continue;
    end if;

    current_room_state := case
      when jsonb_typeof(current_post.room_state) = 'object' then current_post.room_state
      else '{}'::jsonb
    end;
    current_invitations := case
      when jsonb_typeof(current_room_state->'invitations') = 'array' then current_room_state->'invitations'
      else '[]'::jsonb
    end;

    select coalesce(
      jsonb_agg(
        case
          when coalesce(invitation.value->>'status', 'pending') = 'pending' then
            invitation.value || jsonb_build_object('status', 'expired', 'updatedAt', p_now)
          else invitation.value
        end
        order by invitation.ordinality
      ),
      '[]'::jsonb
    )
    into next_invitations
    from jsonb_array_elements(current_invitations) with ordinality invitation(value, ordinality);

    update public.discord_notification_deliveries delivery
    set status = 'cancelled',
        last_error = 'recruiting_schedule_unconfirmed',
        payload = coalesce(delivery.payload, '{}'::jsonb) || jsonb_build_object(
          'status', 'cancelled',
          'reason', 'recruiting_schedule_unconfirmed',
          'cancelledAt', p_now
        ),
        updated_at = p_now
    where delivery.status = 'queued'
      and exists (
        select 1 from public.notifications notification
        where notification.id = delivery.notification_id
          and notification.recruiting_post_id = current_post.id
      );

    update public.notifications notification
    set read_at = coalesce(notification.read_at, p_now),
        payload = coalesce(notification.payload, '{}'::jsonb) || jsonb_build_object(
          'status', 'cancelled',
          'actionRequired', false,
          'cancelledAt', p_now
        ),
        updated_at = p_now
    where notification.recruiting_post_id = current_post.id;

    update public.recruiting_posts
    set status = 'cancelled',
        room_state = current_room_state || jsonb_build_object(
          'invitations', next_invitations,
          'cancelledAt', p_now,
          'cancellationReason', 'scheduled_unconfirmed'
        ),
        updated_at = p_now
    where id = current_post.id and status = 'open';
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      continue;
    end if;

    update public.room_discord_links room_link
    set enabled = false, updated_at = p_now
    where room_link.room_type = 'recruiting'
      and room_link.room_id = current_post.id
      and room_link.enabled;

    with recipients(profile_id) as (
      select nullif(btrim(coalesce(current_room_state->>'ownerId', current_post.player_id)), '')
      union
      select nullif(btrim(current_post.player_id), '')
      union
      select nullif(btrim(player.value), '')
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_post.player_ids) = 'array' then current_post.player_ids else '[]'::jsonb end
      ) player(value)
      union
      select nullif(btrim(application.player_id), '')
      from public.recruiting_applications application
      where application.post_id = current_post.id
      union
      select nullif(btrim(application_player.value), '')
      from public.recruiting_applications application
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end
      ) application_player(value)
      where application.post_id = current_post.id
      union
      select nullif(btrim(current_post.referee_id), '')
    )
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      recruiting_post_id, payload, created_at, updated_at
    )
    select
      'notice-recruiting-unconfirmed-' || md5(current_post.id || ':' || recipients.profile_id),
      recipients.profile_id,
      recipients.profile_id,
      '매칭방 자동 취소',
      coalesce(nullif(btrim(current_post.title), ''), '매칭방') || ' 시작 시각까지 경기로 확정되지 않아 자동 취소됐습니다.',
      'match',
      'recruiting_cancelled',
      current_post.id,
      jsonb_build_object(
        'source', 'recruiting_room_expiration',
        'reason', 'scheduled_unconfirmed',
        'status', 'cancelled',
        'cancelledAt', p_now,
        'recruitingPostId', current_post.id,
        'actionRequired', false
      ),
      p_now,
      p_now
    from recipients
    where recipients.profile_id is not null
      and exists (select 1 from public.profiles profile where profile.id = recipients.profile_id)
    on conflict (id) do nothing;
    get diagnostics changed_count = row_count;
    notification_count := notification_count + changed_count;

    expired_count := expired_count + 1;
    expired_rooms := expired_rooms || jsonb_build_array(current_post.id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'expiredCount', expired_count,
    'notificationCount', notification_count,
    'rooms', expired_rooms
  );
end;
$$;

revoke all on function public.rankball_expire_unconfirmed_recruiting_rooms(timestamptz) from public, anon, authenticated;
grant execute on function public.rankball_expire_unconfirmed_recruiting_rooms(timestamptz) to service_role;

create or replace function public.rankball_operational_data_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  critical_checks jsonb;
  warning_checks jsonb;
  is_healthy boolean;
begin
  select jsonb_object_agg(check_name, affected_count order by check_name)
  into critical_checks
  from (
    select 'activeMatchMissingFeed' check_name, count(*)::bigint affected_count
    from public.matches match_row
    where match_row.status in ('agreed', 'live', 'approval', 'disputed')
      and not exists (
        select 1 from public.user_room_feed feed
        where feed.entity_type = 'match' and feed.entity_id = match_row.id and feed.is_active
      )
    union all
    select 'activeSyntheticCourts', count(*)
    from public.approved_courts court
    where court.status = 'active'
      and (
        court.source_request_id like 'sim\_cr\_%' escape '\'
        or court.id like 'court\_sim\_%' escape '\'
        or lower(court.name) like 'backend simulation%'
        or court.name like '코덱스 테스트 %'
      )
    union all
    select 'activeSyntheticTeams', count(*)
    from public.teams team
    where team.deleted_at is null and team.id like 'sim\_team\_%' escape '\'
    union all
    select 'activeLegacySampleMatch', count(*)
    from public.matches match_row
    where match_row.id like 'm\_seed\_%' escape '\'
      and match_row.status not in ('cancelled', 'canceled', 'void', 'voided', 'closed')
    union all
    select 'activeTeamMultipleCaptains', count(*)
    from (
      select team.id
      from public.teams team
      join public.team_members member on member.team_id = team.id and member.role = 'captain'
      where team.deleted_at is null
      group by team.id
      having count(*) > 1
    ) duplicate_captain
    union all
    select 'activeTeamOverCapacity', count(*)
    from (
      select team.id
      from public.teams team
      join public.team_members member on member.team_id = team.id
      where team.deleted_at is null
      group by team.id
      having count(*) > 10
    ) oversized_team
    union all
    select 'activeTeamMissingCaptain', count(*)
    from public.teams team
    where team.deleted_at is null
      and not exists (
        select 1 from public.team_members member
        where member.team_id = team.id and member.role = 'captain'
      )
    union all
    select 'activeTeamMissingMember', count(*)
    from public.teams team
    where team.deleted_at is null
      and not exists (select 1 from public.team_members member where member.team_id = team.id)
    union all
    select 'approvedCourtMissingPin', count(*)
    from public.approved_courts court
    where court.status = 'active' and (court.lat is null or court.lng is null)
    union all
    select 'courtRequestRequesterOrphan', count(*)
    from public.court_requests request
    left join public.profiles profile on profile.id = request.requested_by
    where request.requested_by is not null and profile.id is null
    union all
    select 'builtInCourtMissingApprovedRow', greatest(0, 12 - count(*))
    from public.approved_courts court
    where court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
      and court.status = 'active' and court.lat is not null and court.lng is not null
    union all
    select 'emptyMatchTournamentReference', count(*)
    from public.matches match_row where match_row.tournament_id = ''
    union all
    select 'matchCreatorOrphan', count(*)
    from public.matches match_row
    left join public.profiles profile on profile.id = match_row.created_by
    where match_row.created_by is not null and profile.id is null
    union all
    select 'matchCourtOrphan', count(*)
    from public.matches match_row
    left join public.courts court on court.id = match_row.court_id
    where match_row.court_id is not null and court.id is null
    union all
    select 'matchTeamOrphan', count(*)
    from public.matches match_row
    left join public.teams team_a on team_a.id = match_row.team_a_id
    left join public.teams team_b on team_b.id = match_row.team_b_id
    where (match_row.team_a_id is not null and team_a.id is null)
       or (match_row.team_b_id is not null and team_b.id is null)
    union all
    select 'matchPlayerOrphan', count(*)
    from public.match_players player
    left join public.matches match_row on match_row.id = player.match_id
    left join public.profiles profile on profile.id = player.user_id
    where match_row.id is null or profile.id is null
    union all
    select 'matchResultOrphan', count(*)
    from public.match_results result
    left join public.matches match_row on match_row.id = result.match_id
    left join public.profiles profile on profile.id = result.submitted_by
    where match_row.id is null or (result.submitted_by is not null and profile.id is null)
    union all
    select 'playerMatchStatOrphan', count(*)
    from public.player_match_stats stat
    left join public.matches match_row on match_row.id = stat.match_id
    left join public.profiles profile on profile.id = stat.user_id
    where match_row.id is null or profile.id is null
    union all
    select 'openPastRecruitingRoom', count(*)
    from public.recruiting_posts post
    where post.status = 'open'
      and post.scheduled_date is not null
      and post.scheduled_time is not null
      and (post.scheduled_date + post.scheduled_time) at time zone 'Asia/Seoul' < now()
    union all
    select 'openRecruitingRoomMissingFeed', count(*)
    from public.recruiting_posts post
    where post.status = 'open'
      and not exists (
        select 1 from public.user_room_feed feed
        where feed.entity_type = 'recruiting' and feed.entity_id = post.id and feed.is_active
      )
    union all
    select 'recruitingRoomReferenceOrphan', count(*)
    from public.recruiting_posts post
    left join public.profiles owner_profile on owner_profile.id = post.player_id
    left join public.teams host_team on host_team.id = post.team_id
    left join public.teams target_team on target_team.id = post.target_team_id
    left join public.courts court on court.id = post.court_id
    where (post.player_id is not null and owner_profile.id is null)
       or (post.team_id is not null and host_team.id is null)
       or (post.target_team_id is not null and target_team.id is null)
       or (post.court_id is not null and court.id is null)
    union all
    select 'recruitingApplicationOrphan', count(*)
    from public.recruiting_applications application
    left join public.recruiting_posts post on post.id = application.post_id
    left join public.profiles profile on profile.id = application.player_id
    left join public.teams team on team.id = application.team_id
    where post.id is null
       or (application.player_id is not null and profile.id is null)
       or (application.team_id is not null and team.id is null)
    union all
    select 'passedSyntheticExamAttempt', count(*)
    from public.referee_exam_attempts attempt
    where attempt.status = 'passed' and attempt.id like 'sim\_rea\_%' escape '\'
    union all
    select 'pendingSyntheticRefereeRequest', count(*)
    from public.referee_requests request
    where request.status = 'pending' and request.id like 'sim\_rr\_%' escape '\'
    union all
    select 'profileAuthDuplicate', coalesce(sum(duplicate_count - 1), 0)::bigint
    from (
      select count(*) duplicate_count
      from public.profiles profile
      where profile.auth_user_id is not null
      group by profile.auth_user_id
      having count(*) > 1
    ) duplicate
    union all
    select 'profileAuthMissing', count(*)
    from public.profiles profile where profile.auth_user_id is null
    union all
    select 'profileAuthOrphan', count(*)
    from public.profiles profile
    left join auth.users auth_user on auth_user.id = profile.auth_user_id
    where profile.auth_user_id is not null and auth_user.id is null
    union all
    select 'profileSyntheticDiscordLink', count(*)
    from public.profiles profile
    where lower(coalesce(profile.discord_connection->>'username', '')) like 'rankball-sim-%'
    union all
    select 'teamMemberOrphan', count(*)
    from public.team_members member
    left join public.teams team on team.id = member.team_id
    left join public.profiles profile on profile.id = member.user_id
    where team.id is null or profile.id is null
    union all
    select 'teamInvitationOrphan', count(*)
    from public.team_invitations invitation
    left join public.teams team on team.id = invitation.team_id
    left join public.profiles sender on sender.id = invitation.from_user_id
    left join public.profiles target on target.id = invitation.target_user_id
    where team.id is null or sender.id is null or target.id is null
    union all
    select 'userActiveTeamLimitExceeded', count(*)
    from (
      select member.user_id
      from public.team_members member
      join public.teams team on team.id = member.team_id and team.deleted_at is null
      group by member.user_id
      having count(*) > 3
    ) excessive_membership
    union all
    select 'tournamentMatchOrphan', count(*)
    from public.matches match_row
    left join public.tournaments tournament on tournament.id = nullif(match_row.tournament_id, '')
    where nullif(match_row.tournament_id, '') is not null and tournament.id is null
    union all
    select 'tournamentTeamOrphan', count(*)
    from public.tournament_teams entry
    left join public.tournaments tournament on tournament.id = entry.tournament_id
    left join public.teams team on team.id = entry.team_id
    where tournament.id is null or team.id is null
    union all
    select 'tournamentReferenceOrphan', count(*)
    from public.tournaments tournament
    left join public.profiles creator on creator.id = tournament.created_by
    left join public.courts court on court.id = tournament.court_id
    where (tournament.created_by is not null and creator.id is null)
       or (tournament.court_id is not null and court.id is null)
    union all
    select 'notificationTargetOrphan', count(*)
    from public.notifications notification
    where coalesce(notification.target_user_id, notification.user_id) is not null
      and not exists (
        select 1 from public.profiles profile
        where profile.id = coalesce(notification.target_user_id, notification.user_id)
      )
    union all
    select 'notificationSourceOrphan', count(*)
    from public.notifications notification
    where (notification.match_id is not null and not exists (
        select 1 from public.matches match_row where match_row.id = notification.match_id
      ))
       or (notification.recruiting_post_id is not null and not exists (
        select 1 from public.recruiting_posts post where post.id = notification.recruiting_post_id
      ))
    union all
    select 'unreadSyntheticNotification', count(*)
    from public.notifications notification
    where notification.read_at is null
      and (
        notification.id like 'n\_sim\_%' escape '\'
        or notification.invitation_id like 'sim\_ti\_%' escape '\'
        or notification.payload->>'simulation' = 'true'
        or notification.payload->>'simulationId' like 'sim\_%' escape '\'
        or lower(coalesce(notification.body, '')) like 'backend simulation%'
      )
  ) checks;

  select not exists (
    select 1 from jsonb_each_text(coalesce(critical_checks, '{}'::jsonb)) check_row
    where check_row.value::bigint > 0
  ) into is_healthy;

  select jsonb_object_agg(check_name, affected_count order by check_name)
  into warning_checks
  from (
    select 'inactiveFeedSourceMissing' check_name, count(*)::bigint affected_count
    from public.user_room_feed feed
    where not feed.is_active
      and (
        (feed.entity_type = 'match' and not exists (
          select 1 from public.matches match_row where match_row.id = feed.entity_id
        ))
        or (feed.entity_type = 'recruiting' and not exists (
          select 1 from public.recruiting_posts post where post.id = feed.entity_id
        ))
      )
    union all
    select 'quarantinedCardAwaitingRetention', count(*)
    from public.room_feed_cards card
    where card.card_json->>'dataState' = 'quarantined'
  ) warnings;

  return jsonb_build_object(
    'ok', is_healthy,
    'checkedAt', now(),
    'critical', coalesce(critical_checks, '{}'::jsonb),
    'warnings', coalesce(warning_checks, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.rankball_operational_data_health() from public, anon, authenticated;
grant execute on function public.rankball_operational_data_health() to service_role;

update public.matches
set tournament_id = null,
    updated_at = now()
where tournament_id = '';

select public.rankball_quarantine_simulation_artifacts(now());

do $$
begin
  if to_regprocedure('public.rankball_expire_recruiting_rooms(timestamptz)') is not null then
    perform public.rankball_expire_recruiting_rooms(now());
  end if;
  perform public.rankball_expire_unconfirmed_recruiting_rooms(now());
end;
$$;

commit;

select pg_notify('pgrst', 'reload schema');
