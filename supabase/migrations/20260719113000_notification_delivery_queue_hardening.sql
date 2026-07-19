alter table public.discord_notification_deliveries
  add column if not exists attempt_count integer not null default 0;

alter table public.discord_notification_deliveries
  drop constraint if exists discord_notification_deliveries_attempt_count_check;
alter table public.discord_notification_deliveries
  add constraint discord_notification_deliveries_attempt_count_check
  check (attempt_count between 0 and 5)
  not valid;
alter table public.discord_notification_deliveries
  validate constraint discord_notification_deliveries_attempt_count_check;

create unique index if not exists discord_notification_deliveries_notification_target_idx
  on public.discord_notification_deliveries (notification_id, target_user_id)
  where notification_id is not null and target_user_id is not null;

create or replace function public.rankball_delete_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.discord_notification_deliveries delivery
  where delivery.notification_id = old.id
     or delivery.payload->>'notificationId' = old.id;
  return old;
end;
$$;

drop trigger if exists notifications_delete_discord_deliveries on public.notifications;
create trigger notifications_delete_discord_deliveries
after delete on public.notifications
for each row
execute function public.rankball_delete_notification_deliveries();

revoke all on function public.rankball_delete_notification_deliveries() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
