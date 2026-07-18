-- Read notifications are user-visible history, then disposable after seven days.
create index if not exists notifications_read_retention_idx
  on public.notifications (read_at)
  where read_at is not null;

create or replace function public.rankball_cleanup_read_notifications(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff_at timestamptz := coalesce(p_now, now()) - interval '7 days';
  deleted_deliveries integer := 0;
  deleted_notifications integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:notification-cleanup'));

  delete from public.discord_notification_deliveries delivery
  using public.notifications notification
  where notification.read_at is not null
    and notification.read_at < cutoff_at
    and (
      delivery.notification_id = notification.id
      or delivery.payload->>'notificationId' = notification.id
    );
  get diagnostics deleted_deliveries = row_count;

  delete from public.notifications notification
  where notification.read_at is not null
    and notification.read_at < cutoff_at;
  get diagnostics deleted_notifications = row_count;

  return jsonb_build_object(
    'ok', true,
    'retentionDays', 7,
    'deletedNotifications', deleted_notifications,
    'deletedDiscordDeliveries', deleted_deliveries
  );
end;
$$;

revoke all on function public.rankball_cleanup_read_notifications(timestamptz) from public;
revoke all on function public.rankball_cleanup_read_notifications(timestamptz) from anon;
revoke all on function public.rankball_cleanup_read_notifications(timestamptz) from authenticated;
grant execute on function public.rankball_cleanup_read_notifications(timestamptz) to service_role;

select pg_notify('pgrst', 'reload schema');
