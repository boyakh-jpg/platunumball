begin;

create or replace function public.rankball_prepare_room_change_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  web_path text;
begin
  if new.type not in (
    'recruiting_rules_changed',
    'match_rules_changed',
    'recruiting_schedule_change_requested',
    'match_schedule_change_requested',
    'recruiting_schedule_change_applied',
    'recruiting_schedule_change_rejected',
    'match_schedule_change_applied',
    'match_schedule_change_rejected'
  ) then
    return new;
  end if;

  web_path := coalesce(
    nullif(btrim(new.payload->>'webPath'), ''),
    case
      when new.recruiting_post_id is not null then '/app/recruiting?post=' || new.recruiting_post_id
      when new.match_id is not null then '/app/matches/' || new.match_id
      else '/app/notifications'
    end
  );
  new.discord_event := 'match';
  new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
    'targetUserId', new.target_user_id,
    'skipDiscordSync', true,
    'webPath', web_path
  );
  return new;
end;
$$;

drop trigger if exists notifications_prepare_room_change on public.notifications;
create trigger notifications_prepare_room_change
before insert on public.notifications
for each row
execute function public.rankball_prepare_room_change_notification();

create or replace function public.rankball_queue_room_change_discord_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row record;
  delivery_id text;
  now_at timestamptz := coalesce(new.updated_at, new.created_at, now());
  web_path text;
begin
  if new.type not in (
    'recruiting_rules_changed',
    'match_rules_changed',
    'recruiting_schedule_change_requested',
    'match_schedule_change_requested',
    'recruiting_schedule_change_applied',
    'recruiting_schedule_change_rejected',
    'match_schedule_change_applied',
    'match_schedule_change_rejected'
  )
    or new.target_user_id is null
    or new.read_at is not null then
    return new;
  end if;

  select
    nullif(btrim(profile.discord_user_id), '') as discord_user_id,
    coalesce(profile.app_settings, '{}'::jsonb) as app_settings
  into profile_row
  from public.profiles profile
  where profile.id = new.target_user_id;

  if profile_row.discord_user_id is null
    or not coalesce((profile_row.app_settings #>> '{notificationChannels,discord,enabled}')::boolean, false)
    or not coalesce((profile_row.app_settings #>> '{notificationChannels,discord,events,match}')::boolean, true) then
    return new;
  end if;

  web_path := coalesce(
    nullif(btrim(new.payload->>'webPath'), ''),
    case
      when new.recruiting_post_id is not null then '/app/recruiting?post=' || new.recruiting_post_id
      when new.match_id is not null then '/app/matches/' || new.match_id
      else '/app/notifications'
    end
  );
  delivery_id := case when new.id like 'discord-%' then new.id else 'discord-' || new.id end;

  insert into public.discord_notification_deliveries (
    id, notification_id, target_user_id, discord_user_id, event, status,
    payload, queued_at, send_at, sent_at, failed_at, last_error, created_at, updated_at
  ) values (
    delivery_id,
    new.id,
    new.target_user_id,
    profile_row.discord_user_id,
    'match',
    'queued',
    coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
      'id', delivery_id,
      'notificationId', new.id,
      'targetUserId', new.target_user_id,
      'discordUserId', profile_row.discord_user_id,
      'event', 'match',
      'matchId', new.match_id,
      'recruitingPostId', new.recruiting_post_id,
      'title', new.title,
      'body', new.body,
      'webPath', web_path,
      'status', 'queued',
      'queuedAt', now_at,
      'sendAt', now_at,
      'actions', '[]'::jsonb
    ),
    now_at,
    now_at,
    null,
    null,
    null,
    now_at,
    now_at
  )
  on conflict (id) do update set
    notification_id = excluded.notification_id,
    target_user_id = excluded.target_user_id,
    discord_user_id = excluded.discord_user_id,
    event = excluded.event,
    status = 'queued',
    payload = excluded.payload,
    send_at = excluded.send_at,
    failed_at = null,
    last_error = null,
    updated_at = excluded.updated_at
  where public.discord_notification_deliveries.sent_at is null;

  return new;
end;
$$;

drop trigger if exists notifications_queue_room_change_discord on public.notifications;
create trigger notifications_queue_room_change_discord
after insert on public.notifications
for each row
execute function public.rankball_queue_room_change_discord_delivery();

revoke all on function public.rankball_prepare_room_change_notification() from public, anon, authenticated;
revoke all on function public.rankball_queue_room_change_discord_delivery() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
