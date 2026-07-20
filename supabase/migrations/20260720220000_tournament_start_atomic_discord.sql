-- Queue the Discord copy of a tournament-start app notification in the same transaction.

create or replace function public.rankball_prepare_tournament_start_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_id text;
  web_path text;
begin
  if new.type is distinct from 'tournament' or new.title is distinct from '대회 시작' then
    return new;
  end if;

  tournament_id := nullif(btrim(new.payload->>'tournamentId'), '');
  if tournament_id is null or new.target_user_id is null then
    return new;
  end if;

  web_path := coalesce(
    nullif(btrim(new.payload->>'webPath'), ''),
    '/app/tournaments/' || tournament_id
  );
  new.discord_event := 'match';
  new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object(
    'id', new.id,
    'targetUserId', new.target_user_id,
    'tournamentId', tournament_id,
    'actionRequired', false,
    'homeAction', false,
    'skipDiscordSync', true,
    'tournamentStartDeliveryAtomic', true,
    'webPath', web_path
  );
  return new;
end;
$$;

drop trigger if exists notifications_prepare_tournament_start on public.notifications;
create trigger notifications_prepare_tournament_start
before insert on public.notifications
for each row
execute function public.rankball_prepare_tournament_start_notification();

create or replace function public.rankball_queue_tournament_start_discord_delivery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row record;
  delivery_id text;
  tournament_id text;
  web_path text;
  now_at timestamptz := coalesce(new.updated_at, new.created_at, now());
begin
  if new.type is distinct from 'tournament'
    or new.title is distinct from '대회 시작'
    or new.target_user_id is null
    or new.read_at is not null
    or not coalesce((new.payload->>'tournamentStartDeliveryAtomic')::boolean, false) then
    return new;
  end if;

  tournament_id := nullif(btrim(new.payload->>'tournamentId'), '');
  if tournament_id is null then
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
    '/app/tournaments/' || tournament_id
  );
  delivery_id := 'discord-tournament-start-' || substr(md5(new.id || ':' || new.target_user_id), 1, 24);

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
      'tournamentId', tournament_id,
      'title', new.title,
      'body', new.body,
      'webPath', web_path,
      'status', 'queued',
      'queuedAt', now_at,
      'sendAt', now_at,
      'actions', jsonb_build_array(jsonb_build_object(
        'id', 'openTournament',
        'label', '대회 보기',
        'style', 'primary',
        'customId', 'rankball:tournament:' || tournament_id
      ))
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

drop trigger if exists notifications_queue_tournament_start_discord on public.notifications;
create trigger notifications_queue_tournament_start_discord
after insert on public.notifications
for each row
execute function public.rankball_queue_tournament_start_discord_delivery();

create or replace function public.rankball_tournament_start_delivery_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    'tournament_start_prepare_trigger'::text,
    exists (
      select 1 from pg_trigger
      where tgrelid = 'public.notifications'::regclass
        and tgname = 'notifications_prepare_tournament_start'
        and not tgisinternal
        and tgenabled <> 'D'
    ),
    jsonb_build_object('trigger', 'notifications_prepare_tournament_start')
  union all
  select
    'tournament_start_queue_trigger',
    exists (
      select 1 from pg_trigger
      where tgrelid = 'public.notifications'::regclass
        and tgname = 'notifications_queue_tournament_start_discord'
        and not tgisinternal
        and tgenabled <> 'D'
    ),
    jsonb_build_object('trigger', 'notifications_queue_tournament_start_discord')
  union all
  select
    'tournament_start_prepare_function',
    to_regprocedure('public.rankball_prepare_tournament_start_notification()') is not null,
    jsonb_build_object('function', 'rankball_prepare_tournament_start_notification')
  union all
  select
    'tournament_start_queue_function',
    to_regprocedure('public.rankball_queue_tournament_start_discord_delivery()') is not null,
    jsonb_build_object('function', 'rankball_queue_tournament_start_discord_delivery')
  order by 1;
$$;

revoke all on function public.rankball_prepare_tournament_start_notification() from public, anon, authenticated;
revoke all on function public.rankball_queue_tournament_start_discord_delivery() from public, anon, authenticated;
revoke all on function public.rankball_tournament_start_delivery_health() from public, anon, authenticated;
grant execute on function public.rankball_tournament_start_delivery_health() to service_role;

select pg_notify('pgrst', 'reload schema');
