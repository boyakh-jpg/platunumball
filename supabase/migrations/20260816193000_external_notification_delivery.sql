create table if not exists public.notification_delivery_preferences (
  profile_id text primary key references public.profiles(id) on delete cascade,
  external_mode text not null default 'none' check (external_mode in ('push', 'discord', 'both', 'none')),
  game_recruiting_enabled boolean not null default true,
  team_enabled boolean not null default true,
  record_tier_enabled boolean not null default true,
  service_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  enabled boolean not null default true,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_failure text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists web_push_subscriptions_profile_enabled_idx
  on public.web_push_subscriptions(profile_id, enabled);

create table if not exists public.external_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id text not null references public.notifications(id) on delete cascade,
  profile_id text not null references public.profiles(id) on delete cascade,
  channel text not null default 'push' check (channel = 'push'),
  subscription_id uuid references public.web_push_subscriptions(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (subscription_id is not null)
);

create unique index if not exists external_notification_push_once_idx
  on public.external_notification_deliveries(notification_id, channel, subscription_id)
  where channel = 'push';

create index if not exists external_notification_delivery_queue_idx
  on public.external_notification_deliveries(status, next_attempt_at, created_at);

create table if not exists public.external_contact_preferences (
  profile_id text primary key references public.profiles(id) on delete cascade,
  enabled boolean not null default false,
  kakao_enabled boolean not null default false,
  kakao_open_profile_url text,
  scope text not null default 'active_contexts' check (scope = 'active_contexts'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    kakao_open_profile_url is null
    or (
      length(kakao_open_profile_url) <= 200
      and kakao_open_profile_url ~ '^https://open\.kakao\.com/o/[A-Za-z0-9_-]+/?$'
    )
  )
);

create table if not exists public.external_contact_blocks (
  blocker_profile_id text not null references public.profiles(id) on delete cascade,
  blocked_profile_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_profile_id, blocked_profile_id),
  check (blocker_profile_id <> blocked_profile_id)
);

alter table public.notification_delivery_preferences enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.external_notification_deliveries enable row level security;
alter table public.external_contact_preferences enable row level security;
alter table public.external_contact_blocks enable row level security;

drop policy if exists notification_delivery_preferences_owner_select on public.notification_delivery_preferences;
create policy notification_delivery_preferences_owner_select on public.notification_delivery_preferences
  for select to authenticated using (profile_id = public.current_profile_id());
drop policy if exists notification_delivery_preferences_owner_insert on public.notification_delivery_preferences;
create policy notification_delivery_preferences_owner_insert on public.notification_delivery_preferences
  for insert to authenticated with check (profile_id = public.current_profile_id());
drop policy if exists notification_delivery_preferences_owner_update on public.notification_delivery_preferences;
create policy notification_delivery_preferences_owner_update on public.notification_delivery_preferences
  for update to authenticated using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());

drop policy if exists external_contact_preferences_owner_select on public.external_contact_preferences;
create policy external_contact_preferences_owner_select on public.external_contact_preferences
  for select to authenticated using (profile_id = public.current_profile_id());
drop policy if exists external_contact_preferences_owner_insert on public.external_contact_preferences;
create policy external_contact_preferences_owner_insert on public.external_contact_preferences
  for insert to authenticated with check (profile_id = public.current_profile_id());
drop policy if exists external_contact_preferences_owner_update on public.external_contact_preferences;
create policy external_contact_preferences_owner_update on public.external_contact_preferences
  for update to authenticated using (profile_id = public.current_profile_id())
  with check (profile_id = public.current_profile_id());

drop policy if exists external_contact_blocks_owner_select on public.external_contact_blocks;
create policy external_contact_blocks_owner_select on public.external_contact_blocks
  for select to authenticated using (blocker_profile_id = public.current_profile_id());
drop policy if exists external_contact_blocks_owner_insert on public.external_contact_blocks;
create policy external_contact_blocks_owner_insert on public.external_contact_blocks
  for insert to authenticated with check (blocker_profile_id = public.current_profile_id());
drop policy if exists external_contact_blocks_owner_delete on public.external_contact_blocks;
create policy external_contact_blocks_owner_delete on public.external_contact_blocks
  for delete to authenticated using (blocker_profile_id = public.current_profile_id());

revoke all on public.notification_delivery_preferences from anon;
revoke all on public.web_push_subscriptions from anon, authenticated;
revoke all on public.external_notification_deliveries from anon, authenticated;
revoke all on public.external_contact_preferences from anon;
revoke all on public.external_contact_blocks from anon;

grant select, insert, update on public.notification_delivery_preferences to authenticated;
grant select, insert, update on public.external_contact_preferences to authenticated;
grant select, insert, delete on public.external_contact_blocks to authenticated;

create or replace function public.enqueue_external_notification_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_profile_id text;
  delivery_mode text;
  delivery_category text;
  category_enabled boolean;
  notification_path text;
  minimal_payload jsonb;
begin
  target_profile_id := coalesce(
    nullif(btrim(new.target_user_id), ''),
    nullif(btrim(new.user_id), '')
  );
  if target_profile_id is null or btrim(target_profile_id) = '' then
    return new;
  end if;

  delivery_category := case
    when lower(coalesce(new.type, '')) ~ '(team|tournament|member|roster)' then 'team'
    when lower(coalesce(new.type, '')) ~ '(record|tier|mmr|rank|stat|dispute|objection)' then 'record_tier'
    when new.match_id is not null
      or new.recruiting_post_id is not null
      or lower(coalesce(new.type, '')) ~ '(match|game|score|referee|attendance|confirm|recruit|application|invite|candidate|reserve)'
      then 'game_recruiting'
    else 'service'
  end;

  select
    preferences.external_mode,
    case delivery_category
      when 'game_recruiting' then preferences.game_recruiting_enabled
      when 'team' then preferences.team_enabled
      when 'record_tier' then preferences.record_tier_enabled
      else preferences.service_enabled
    end
  into delivery_mode, category_enabled
  from public.notification_delivery_preferences as preferences
  where preferences.profile_id = target_profile_id;

  delivery_mode := coalesce(delivery_mode, 'none');
  category_enabled := coalesce(category_enabled, false);
  if delivery_mode = 'none' or not category_enabled then
    return new;
  end if;

  notification_path := coalesce(new.payload ->> 'path', '/app/notifications');
  if notification_path !~ '^/app(?:/|$)'
    or notification_path ~ '[\\\r\n]'
    or notification_path ~ '^/app/(auth|login)(/|[?#]|$)'
  then
    notification_path := '/app/notifications';
  end if;

  minimal_payload := jsonb_build_object(
    'id', new.id,
    'type', left(coalesce(new.type, 'notification'), 80),
    'title', left(coalesce(nullif(btrim(new.title), ''), 'BOXTIER 알림'), 80),
    'body', left(coalesce(nullif(btrim(new.body), ''), '새 알림이 있습니다.'), 160),
    'path', notification_path,
    'tag', left('boxtier-' || new.id, 120),
    'timestamp', coalesce(new.created_at, now())
  );

  if delivery_mode in ('push', 'both') then
    insert into public.external_notification_deliveries (
      notification_id,
      profile_id,
      channel,
      subscription_id,
      payload
    )
    select
      new.id,
      target_profile_id,
      'push',
      subscriptions.id,
      minimal_payload
    from public.web_push_subscriptions as subscriptions
    where subscriptions.profile_id = target_profile_id
      and subscriptions.enabled = true
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.enqueue_external_notification_deliveries() from public, anon, authenticated;

drop trigger if exists enqueue_external_notification_deliveries on public.notifications;
create trigger enqueue_external_notification_deliveries
after insert on public.notifications
for each row
execute function public.enqueue_external_notification_deliveries();

create or replace function public.claim_external_notification_deliveries(batch_size integer default 20)
returns setof public.external_notification_deliveries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.external_notification_deliveries as deliveries
  set
    status = 'sending',
    attempt_count = deliveries.attempt_count + 1,
    updated_at = now()
  where deliveries.id in (
    select queued.id
    from public.external_notification_deliveries as queued
    where (
        (queued.status = 'queued' and queued.next_attempt_at <= now())
        or (queued.status = 'sending' and queued.updated_at <= now() - interval '10 minutes')
      )
      and queued.attempt_count < 5
    order by queued.next_attempt_at, queued.created_at
    for update skip locked
    limit greatest(1, least(coalesce(batch_size, 20), 100))
  )
  returning deliveries.*;
end;
$$;

revoke all on function public.claim_external_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_external_notification_deliveries(integer) to service_role;
