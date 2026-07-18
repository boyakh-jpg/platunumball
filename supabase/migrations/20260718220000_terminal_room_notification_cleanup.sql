-- Terminal rooms keep one short-lived notice, not stale room actions.
create or replace function public.rankball_is_terminal_room_notice(
  p_type text,
  p_title text,
  p_discord_event text,
  p_payload jsonb
)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    lower(coalesce(p_type, '')) ~ '(cancel|close|expire|void)'
    or lower(coalesce(p_discord_event, '')) ~ '(cancel|close|expire|void)'
    or coalesce(p_title, '') ~ '(취소|무효|만료|종료)'
    or lower(coalesce(p_payload->>'status', '')) in ('cancelled', 'canceled', 'closed', 'expired', 'void', 'voided');
$$;

create or replace function public.rankball_prune_terminal_room_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_terminal boolean := false;
begin
  if tg_table_name = 'matches' then
    is_terminal := lower(coalesce(new.status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed');
  elsif tg_table_name = 'recruiting_posts' then
    is_terminal := lower(coalesce(new.status, '')) in ('cancelled', 'canceled', 'closed', 'expired');
  end if;

  if not is_terminal or lower(coalesce(old.status, '')) = lower(coalesce(new.status, '')) then
    return new;
  end if;

  delete from public.discord_notification_deliveries delivery
  using public.notifications notification
  where (
      (tg_table_name = 'matches' and notification.match_id = new.id)
      or (tg_table_name = 'recruiting_posts' and notification.recruiting_post_id = new.id)
    )
    and not public.rankball_is_terminal_room_notice(
      notification.type,
      notification.title,
      notification.discord_event,
      notification.payload
    )
    and (
      delivery.notification_id = notification.id
      or delivery.payload->>'notificationId' = notification.id
    );

  delete from public.notifications notification
  where (
      (tg_table_name = 'matches' and notification.match_id = new.id)
      or (tg_table_name = 'recruiting_posts' and notification.recruiting_post_id = new.id)
    )
    and not public.rankball_is_terminal_room_notice(
      notification.type,
      notification.title,
      notification.discord_event,
      notification.payload
    );

  return new;
end;
$$;

drop trigger if exists matches_prune_terminal_notifications on public.matches;
create trigger matches_prune_terminal_notifications
after update of status on public.matches
for each row
execute function public.rankball_prune_terminal_room_notifications();

drop trigger if exists recruiting_prune_terminal_notifications on public.recruiting_posts;
create trigger recruiting_prune_terminal_notifications
after update of status on public.recruiting_posts
for each row
execute function public.rankball_prune_terminal_room_notifications();

create or replace function public.rankball_cleanup_read_notifications(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff_at timestamptz := coalesce(p_now, now()) - interval '7 days';
  stale_room_notifications integer := 0;
  deleted_deliveries integer := 0;
  deleted_notifications integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:notification-cleanup'));

  select count(*)::integer
  into stale_room_notifications
  from public.notifications notification
  where (
      notification.match_id is not null
      and (
        not exists (select 1 from public.matches match where match.id = notification.match_id)
        or exists (
          select 1
          from public.matches match
          where match.id = notification.match_id
            and lower(coalesce(match.status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed')
        )
      )
    )
    or (
      notification.recruiting_post_id is not null
      and (
        not exists (select 1 from public.recruiting_posts post where post.id = notification.recruiting_post_id)
        or exists (
          select 1
          from public.recruiting_posts post
          where post.id = notification.recruiting_post_id
            and lower(coalesce(post.status, '')) in ('cancelled', 'canceled', 'closed', 'expired')
        )
      )
    );

  delete from public.discord_notification_deliveries delivery
  using public.notifications notification
  where (
      notification.read_at < cutoff_at
      or (
        (
          notification.match_id is not null
          and (
            not exists (select 1 from public.matches match where match.id = notification.match_id)
            or exists (
              select 1 from public.matches match
              where match.id = notification.match_id
                and lower(coalesce(match.status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed')
            )
          )
        )
        or (
          notification.recruiting_post_id is not null
          and (
            not exists (select 1 from public.recruiting_posts post where post.id = notification.recruiting_post_id)
            or exists (
              select 1 from public.recruiting_posts post
              where post.id = notification.recruiting_post_id
                and lower(coalesce(post.status, '')) in ('cancelled', 'canceled', 'closed', 'expired')
            )
          )
        )
      )
      and (
        not public.rankball_is_terminal_room_notice(
          notification.type,
          notification.title,
          notification.discord_event,
          notification.payload
        )
        or notification.created_at < cutoff_at
      )
    )
    and (
      delivery.notification_id = notification.id
      or delivery.payload->>'notificationId' = notification.id
    );
  get diagnostics deleted_deliveries = row_count;

  delete from public.notifications notification
  where notification.read_at < cutoff_at
    or (
      (
        (
          notification.match_id is not null
          and (
            not exists (select 1 from public.matches match where match.id = notification.match_id)
            or exists (
              select 1 from public.matches match
              where match.id = notification.match_id
                and lower(coalesce(match.status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed')
            )
          )
        )
        or (
          notification.recruiting_post_id is not null
          and (
            not exists (select 1 from public.recruiting_posts post where post.id = notification.recruiting_post_id)
            or exists (
              select 1 from public.recruiting_posts post
              where post.id = notification.recruiting_post_id
                and lower(coalesce(post.status, '')) in ('cancelled', 'canceled', 'closed', 'expired')
            )
          )
        )
      )
      and (
        not public.rankball_is_terminal_room_notice(
          notification.type,
          notification.title,
          notification.discord_event,
          notification.payload
        )
        or notification.created_at < cutoff_at
      )
    );
  get diagnostics deleted_notifications = row_count;

  return jsonb_build_object(
    'ok', true,
    'retentionDays', 7,
    'staleRoomNotifications', stale_room_notifications,
    'deletedNotifications', deleted_notifications,
    'deletedDiscordDeliveries', deleted_deliveries
  );
end;
$$;

revoke all on function public.rankball_is_terminal_room_notice(text, text, text, jsonb) from public;
revoke all on function public.rankball_prune_terminal_room_notifications() from public;
revoke all on function public.rankball_cleanup_read_notifications(timestamptz) from public;
grant execute on function public.rankball_cleanup_read_notifications(timestamptz) to service_role;

select pg_notify('pgrst', 'reload schema');
