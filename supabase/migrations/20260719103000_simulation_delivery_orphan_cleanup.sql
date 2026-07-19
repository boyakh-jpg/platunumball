create or replace function public.rankball_cleanup_simulation_notices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  simulation_notification_ids text[] := array[]::text[];
  deleted_notifications integer := 0;
  deleted_discord_deliveries integer := 0;
  remaining_notifications integer := 0;
  remaining_discord_deliveries integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:simulation-notice-cleanup'));

  select coalesce(array_agg(notification.id), array[]::text[])
  into simulation_notification_ids
  from public.notifications notification
  where notification.id like 'sim_notice\_%' escape '\'
     or notification.payload->>'simulation' = 'true'
     or notification.payload->>'simulationId' like 'sim\_%' escape '\'
     or notification.payload->>'tournamentId' like 'sim\_%' escape '\'
     or lower(coalesce(notification.body, '')) like 'backend simulation %';

  delete from public.discord_notification_deliveries delivery
  where delivery.id like 'sim\_%' escape '\'
     or delivery.notification_id = any(simulation_notification_ids)
     or delivery.payload->>'notificationId' = any(simulation_notification_ids)
     or delivery.payload->>'simulation' = 'true'
     or delivery.payload->>'simulationId' like 'sim\_%' escape '\'
     or delivery.payload->>'tournamentId' like 'sim\_%' escape '\';
  get diagnostics deleted_discord_deliveries = row_count;

  delete from public.notifications notification
  where notification.id = any(simulation_notification_ids);
  get diagnostics deleted_notifications = row_count;

  select count(*)
  into remaining_notifications
  from public.notifications notification
  where notification.id like 'sim_notice\_%' escape '\'
     or notification.payload->>'simulation' = 'true'
     or notification.payload->>'simulationId' like 'sim\_%' escape '\'
     or notification.payload->>'tournamentId' like 'sim\_%' escape '\'
     or lower(coalesce(notification.body, '')) like 'backend simulation %';

  select count(*)
  into remaining_discord_deliveries
  from public.discord_notification_deliveries delivery
  where delivery.id like 'sim\_%' escape '\'
     or delivery.notification_id like 'sim\_%' escape '\'
     or delivery.payload->>'notificationId' like 'sim\_%' escape '\'
     or delivery.payload->>'simulation' = 'true'
     or delivery.payload->>'simulationId' like 'sim\_%' escape '\'
     or delivery.payload->>'tournamentId' like 'sim\_%' escape '\';

  return jsonb_build_object(
    'ok', remaining_notifications = 0 and remaining_discord_deliveries = 0,
    'deletedNotifications', deleted_notifications,
    'deletedDiscordDeliveries', deleted_discord_deliveries,
    'remainingNotifications', remaining_notifications,
    'remainingDiscordDeliveries', remaining_discord_deliveries
  );
end;
$$;

revoke all on function public.rankball_cleanup_simulation_notices() from public, anon, authenticated;
grant execute on function public.rankball_cleanup_simulation_notices() to service_role;
