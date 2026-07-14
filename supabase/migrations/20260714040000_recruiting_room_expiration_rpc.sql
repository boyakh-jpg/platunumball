-- Expire stale recruiting rooms with the same per-room transaction lock used by recruiting actions.
create or replace function public.rankball_cleanup_room_feed(p_now timestamptz default now())
returns table(scope text, affected_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := coalesce(p_now, now());
  local_now timestamp := timezone('Asia/Seoul', coalesce(p_now, now()));
  changed_count integer := 0;
begin
  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  where feed.is_active = true
    and feed.entity_type = 'recruiting'
    and not exists (
      select 1
      from public.recruiting_posts post
      where post.id = feed.entity_id
    );
  get diagnostics changed_count = row_count;
  scope := 'recruiting_orphan';
  affected_count := changed_count;
  return next;

  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  from public.recruiting_posts post
  where feed.is_active = true
    and feed.entity_type = 'recruiting'
    and feed.entity_id = post.id
    and (
      coalesce(feed.status, '') in ('closed', 'cancelled')
      or coalesce(post.status, '') in ('closed', 'cancelled')
      or (
        coalesce(post.status, '') = 'open'
        and (
          (
            (
              lower(btrim(coalesce(post.scheduled_at, ''))) in ('instant', '즉시')
              or lower(btrim(coalesce(post.room_state->>'timingType', ''))) = 'instant'
            )
            and coalesce(post.created_at, now_ts) <= now_ts - interval '120 minutes'
          )
          or (
            post.scheduled_date is not null
            and (post.scheduled_date::timestamp + coalesce(post.scheduled_time, time '00:00')) < local_now
          )
        )
      )
    );
  get diagnostics changed_count = row_count;
  scope := 'recruiting_expired';
  affected_count := changed_count;
  return next;

  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  where feed.is_active = true
    and feed.entity_type = 'match'
    and not exists (
      select 1
      from public.matches match_row
      where match_row.id = feed.entity_id
    );
  get diagnostics changed_count = row_count;
  scope := 'match_orphan';
  affected_count := changed_count;
  return next;

  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  from public.matches match_row
  where feed.is_active = true
    and feed.entity_type = 'match'
    and feed.entity_id = match_row.id
    and (
      coalesce(feed.status, '') = 'closed'
      or coalesce(match_row.status, '') = 'closed'
    );
  get diagnostics changed_count = row_count;
  scope := 'match_closed';
  affected_count := changed_count;
  return next;
end;
$$;

revoke all on function public.rankball_cleanup_room_feed(timestamptz) from public;
revoke all on function public.rankball_cleanup_room_feed(timestamptz) from anon;
revoke all on function public.rankball_cleanup_room_feed(timestamptz) from authenticated;
grant execute on function public.rankball_cleanup_room_feed(timestamptz) to service_role;

drop function if exists public.rankball_expire_recruiting_rooms();

create or replace function public.rankball_expire_recruiting_rooms(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_at timestamptz := coalesce(p_now, now());
  candidate record;
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_invitations jsonb;
  next_invitations jsonb;
  is_instant boolean;
  scheduled_start_at timestamptz;
  cancellation_reason text;
  side_capacity integer;
  team_a_count integer;
  team_b_count integer;
  pending_invitation_count integer := 0;
  changed_count integer := 0;
  checked_count integer := 0;
  expired_count integer := 0;
  instant_count integer := 0;
  scheduled_count integer := 0;
  full_scheduled_count integer := 0;
  expired_invitation_count integer := 0;
  closed_invitation_notification_count integer := 0;
  cancelled_discord_delivery_count integer := 0;
  notification_count integer := 0;
  feed_count integer := 0;
  feed_card_count integer := 0;
  discord_link_count integer := 0;
  expired_rooms jsonb := '[]'::jsonb;
begin
  for candidate in
    select post.id
    from public.recruiting_posts post
    where post.status = 'open'
      and (
        (
          (
            coalesce(post.room_state->>'timingType', '') = 'instant'
            or lower(btrim(coalesce(post.scheduled_at, ''))) in ('instant', '즉시')
          )
          and post.created_at <= now_at - interval '120 minutes'
        )
        or (
          coalesce(post.room_state->>'timingType', 'scheduled') <> 'instant'
          and lower(btrim(coalesce(post.scheduled_at, ''))) not in ('instant', '즉시')
          and post.scheduled_date is not null
          and (post.scheduled_date + coalesce(post.scheduled_time, time '00:00')) at time zone 'Asia/Seoul' < now_at
        )
      )
    order by post.id
  loop
    checked_count := checked_count + 1;
    perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(candidate.id));

    select *
    into current_post
    from public.recruiting_posts
    where id = candidate.id
    for update;

    if not found or current_post.status <> 'open' then
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
    is_instant := coalesce(current_room_state->>'timingType', '') = 'instant'
      or lower(btrim(coalesce(current_post.scheduled_at, ''))) in ('instant', '즉시');
    cancellation_reason := null;
    scheduled_start_at := null;

    if is_instant then
      if current_post.created_at > now_at - interval '120 minutes' then
        continue;
      end if;
      cancellation_reason := 'instant_expired';
    else
      if current_post.scheduled_date is null then
        continue;
      end if;
      scheduled_start_at := (current_post.scheduled_date + coalesce(current_post.scheduled_time, time '00:00')) at time zone 'Asia/Seoul';
      if scheduled_start_at >= now_at then
        continue;
      end if;

      side_capacity := greatest(1, least(5, coalesce(current_post.side_capacity, 5)));
      team_a_count := public.rankball_recruiting_side_active_count(current_post, 'teamA');
      team_b_count := public.rankball_recruiting_side_active_count(current_post, 'teamB');
      if team_a_count >= side_capacity and team_b_count >= side_capacity then
        full_scheduled_count := full_scheduled_count + 1;
        continue;
      end if;
      cancellation_reason := 'scheduled_underfilled';
    end if;

    select count(*)::integer
    into pending_invitation_count
    from jsonb_array_elements(current_invitations) invitation(value)
    where coalesce(invitation.value->>'status', 'pending') = 'pending';

    select coalesce(
      jsonb_agg(
        case
          when coalesce(invitation.value->>'status', 'pending') = 'pending' then
            invitation.value || jsonb_build_object('status', 'expired', 'updatedAt', now_at)
          else invitation.value
        end
        order by invitation.ordinality
      ),
      '[]'::jsonb
    )
    into next_invitations
    from jsonb_array_elements(current_invitations) with ordinality invitation(value, ordinality);

    update public.discord_notification_deliveries delivery
    set
      status = 'cancelled',
      last_error = 'recruiting_invitation_expired',
      payload = case
        when jsonb_typeof(delivery.payload) = 'object' then delivery.payload
        else '{}'::jsonb
      end || jsonb_build_object(
        'status', 'cancelled',
        'reason', 'recruiting_invitation_expired',
        'cancelledAt', now_at
      ),
      updated_at = now_at
    where delivery.status = 'queued'
      and exists (
        select 1
        from public.notifications notification
        where notification.id = delivery.notification_id
          and notification.recruiting_post_id = current_post.id
          and notification.invitation_id is not null
          and exists (
            select 1
            from jsonb_array_elements(current_invitations) invitation(value)
            where coalesce(invitation.value->>'status', 'pending') = 'pending'
              and invitation.value->>'id' = notification.invitation_id
          )
      );
    get diagnostics changed_count = row_count;
    cancelled_discord_delivery_count := cancelled_discord_delivery_count + changed_count;

    update public.notifications notification
    set
      read_at = coalesce(notification.read_at, now_at),
      payload = case
        when jsonb_typeof(notification.payload) = 'object' then notification.payload
        else '{}'::jsonb
      end || jsonb_build_object('invitationStatus', 'expired', 'expiredAt', now_at),
      updated_at = now_at
    where notification.recruiting_post_id = current_post.id
      and notification.invitation_id is not null
      and exists (
        select 1
        from jsonb_array_elements(current_invitations) invitation(value)
        where coalesce(invitation.value->>'status', 'pending') = 'pending'
          and invitation.value->>'id' = notification.invitation_id
      );
    get diagnostics changed_count = row_count;
    closed_invitation_notification_count := closed_invitation_notification_count + changed_count;

    update public.recruiting_posts
    set
      status = 'cancelled',
      room_state = current_room_state || jsonb_build_object(
        'invitations', next_invitations,
        'cancelledAt', now_at,
        'cancellationReason', cancellation_reason
      ),
      updated_at = now_at
    where id = current_post.id
      and status = 'open';
    get diagnostics changed_count = row_count;
    if changed_count <> 1 then
      continue;
    end if;

    update public.user_room_feed feed
    set status = 'cancelled', is_active = false, updated_at = now_at
    where feed.entity_type = 'recruiting'
      and feed.entity_id = current_post.id
      and (feed.is_active or feed.status is distinct from 'cancelled');
    get diagnostics changed_count = row_count;
    feed_count := feed_count + changed_count;

    update public.room_feed_cards card
    set
      card_json = (
        case when jsonb_typeof(card.card_json) = 'object' then card.card_json else '{}'::jsonb end
      ) || jsonb_build_object(
        'status', 'cancelled',
        'updatedAt', now_at,
        'cancelledAt', now_at,
        'roomState', (
          case when jsonb_typeof(card.card_json->'roomState') = 'object' then card.card_json->'roomState' else '{}'::jsonb end
        ) || jsonb_build_object(
          'invitations', next_invitations,
          'cancelledAt', now_at,
          'cancellationReason', cancellation_reason
        )
      ),
      updated_at = now_at
    where card.entity_type = 'recruiting'
      and card.entity_id = current_post.id;
    get diagnostics changed_count = row_count;
    feed_card_count := feed_card_count + changed_count;

    update public.room_discord_links room_link
    set enabled = false, updated_at = now_at
    where room_link.room_type = 'recruiting'
      and room_link.room_id = current_post.id
      and room_link.enabled = true;
    get diagnostics changed_count = row_count;
    discord_link_count := discord_link_count + changed_count;

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
      select nullif(btrim(participant.profile_id), '')
      from public.rankball_room_state_participant_ids(current_room_state) participant
      union
      select nullif(btrim(current_post.referee_id), '')
      union
      select nullif(btrim(invitation.value->>'targetUserId'), '')
      from jsonb_array_elements(current_invitations) invitation(value)
      where coalesce(invitation.value->>'status', 'pending') = 'pending'
      union
      select nullif(btrim(invitation.value->>'fromUserId'), '')
      from jsonb_array_elements(current_invitations) invitation(value)
      where coalesce(invitation.value->>'status', 'pending') = 'pending'
    )
    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      recruiting_post_id,
      payload,
      created_at,
      updated_at
    )
    select
      'notice-recruiting-expired-' || md5(current_post.id || ':' || recipients.profile_id),
      recipients.profile_id,
      recipients.profile_id,
      '매칭방 자동 취소',
      format(
        '%s %s',
        coalesce(nullif(btrim(current_post.title), ''), '매칭방'),
        case
          when cancellation_reason = 'instant_expired' then '즉시방 운영 시간이 120분 지나 자동 취소됐습니다.'
          else '경기 시작 시각까지 정원이 차지 않아 자동 취소됐습니다.'
        end
      ),
      'match',
      'recruiting_cancelled',
      current_post.id,
      jsonb_build_object(
        'source', 'recruiting_room_expiration',
        'reason', cancellation_reason,
        'status', 'cancelled',
        'cancelledAt', now_at,
        'recruitingPostId', current_post.id,
        'actionRequired', false
      ),
      now_at,
      now_at
    from recipients
    where recipients.profile_id is not null
      and recipients.profile_id <> '*'
    on conflict (id) do nothing;
    get diagnostics changed_count = row_count;
    notification_count := notification_count + changed_count;

    expired_count := expired_count + 1;
    expired_invitation_count := expired_invitation_count + pending_invitation_count;
    if cancellation_reason = 'instant_expired' then
      instant_count := instant_count + 1;
    else
      scheduled_count := scheduled_count + 1;
    end if;
    expired_rooms := expired_rooms || jsonb_build_array(jsonb_build_object(
      'postId', current_post.id,
      'reason', cancellation_reason,
      'pendingInvitationCount', pending_invitation_count,
      'teamACount', case when cancellation_reason = 'scheduled_underfilled' then team_a_count else null end,
      'teamBCount', case when cancellation_reason = 'scheduled_underfilled' then team_b_count else null end,
      'sideCapacity', case when cancellation_reason = 'scheduled_underfilled' then side_capacity else null end
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'checkedCount', checked_count,
    'expiredCount', expired_count,
    'instantCount', instant_count,
    'scheduledCount', scheduled_count,
    'fullScheduledCount', full_scheduled_count,
    'expiredInvitationCount', expired_invitation_count,
    'closedInvitationNotificationCount', closed_invitation_notification_count,
    'cancelledDiscordDeliveryCount', cancelled_discord_delivery_count,
    'notificationCount', notification_count,
    'feedCount', feed_count,
    'feedCardCount', feed_card_count,
    'discordLinkCount', discord_link_count,
    'rooms', expired_rooms
  );
end;
$$;

revoke all on function public.rankball_expire_recruiting_rooms(timestamptz) from public;
revoke all on function public.rankball_expire_recruiting_rooms(timestamptz) from anon;
revoke all on function public.rankball_expire_recruiting_rooms(timestamptz) from authenticated;
grant execute on function public.rankball_expire_recruiting_rooms(timestamptz) to service_role;

create or replace function public.rankball_authoritative_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_create_tournament_match_locked', 'public.rankball_create_tournament_match_locked(text,text,text,integer,integer,text)'),
      ('rankball_expire_recruiting_rooms', 'public.rankball_expire_recruiting_rooms(timestamptz)'),
      ('rankball_match_finalize_locked', 'public.rankball_match_finalize_locked(text,text,text)'),
      ('rankball_match_referee_absence_action', 'public.rankball_match_referee_absence_action(text,text,text)'),
      ('rankball_match_result_action', 'public.rankball_match_result_action(text,text,jsonb)'),
      ('rankball_match_resume_approval_action', 'public.rankball_match_resume_approval_action(text,text,jsonb)'),
      ('rankball_match_resume_approval_action_legacy', 'public.rankball_match_resume_approval_action(text,text)'),
      ('rankball_match_room_action', 'public.rankball_match_room_action(text,text,text,jsonb)'),
      ('rankball_recruiting_management_action', 'public.rankball_recruiting_management_action(text,jsonb)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
      ('rankball_tournament_advance_locked', 'public.rankball_tournament_advance_locked(text)'),
      ('rankball_tournament_match_schedule_action', 'public.rankball_tournament_match_schedule_action(text,text,text,jsonb)'),
      ('rankball_tournament_operation_action', 'public.rankball_tournament_operation_action(text,jsonb)')
  ),
  resolved as (
    select function_name, signature, to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'authoritative_rpc_grant:' || function_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    )
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_authoritative_rpc_grant_health() from public;
revoke all on function public.rankball_authoritative_rpc_grant_health() from anon;
revoke all on function public.rankball_authoritative_rpc_grant_health() from authenticated;
grant execute on function public.rankball_authoritative_rpc_grant_health() to service_role;

select pg_notify('pgrst', 'reload schema');
