alter table public.room_chat_messages
  add column if not exists source text not null default 'web';

alter table public.room_chat_messages
  add column if not exists external_message_id text;

alter table public.room_chat_messages
  add column if not exists external_channel_id text;

alter table public.room_chat_messages
  add column if not exists external_thread_id text;

alter table public.room_chat_messages
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_chat_messages'::regclass
      and conname = 'room_chat_messages_source_check'
  ) then
    alter table public.room_chat_messages
      add constraint room_chat_messages_source_check
      check (source in ('web', 'discord'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_chat_messages'::regclass
      and conname = 'room_chat_messages_external_message_check'
  ) then
    alter table public.room_chat_messages
      add constraint room_chat_messages_external_message_check
      check (
        source <> 'discord'
        or (
          external_message_id ~ '^[0-9]{17,20}$'
          and external_channel_id ~ '^[0-9]{17,20}$'
          and (external_thread_id is null or external_thread_id ~ '^[0-9]{17,20}$')
        )
      );
  end if;
end;
$$;

create unique index if not exists room_chat_messages_discord_message_unique_idx
  on public.room_chat_messages (external_channel_id, coalesce(external_thread_id, ''), external_message_id)
  where source = 'discord' and external_message_id is not null;

create table if not exists public.room_discord_links (
  id uuid primary key default gen_random_uuid(),
  room_type text not null default 'recruiting',
  room_id text not null,
  discord_channel_id text not null,
  discord_thread_id text,
  enabled boolean not null default true,
  created_by text references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_discord_links_room_type_check check (room_type in ('recruiting')),
  constraint room_discord_links_channel_check check (discord_channel_id ~ '^[0-9]{17,20}$'),
  constraint room_discord_links_thread_check check (discord_thread_id is null or discord_thread_id ~ '^[0-9]{17,20}$')
);

create unique index if not exists room_discord_links_room_enabled_unique_idx
  on public.room_discord_links (room_type, room_id)
  where enabled;

create unique index if not exists room_discord_links_discord_target_enabled_unique_idx
  on public.room_discord_links (discord_channel_id, coalesce(discord_thread_id, ''))
  where enabled;

create index if not exists room_discord_links_room_idx
  on public.room_discord_links (room_type, room_id);

alter table public.room_discord_links enable row level security;

drop policy if exists room_discord_links_select_related on public.room_discord_links;
create policy room_discord_links_select_related
on public.room_discord_links
for select
to authenticated
using (
  room_type = 'recruiting'
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);

grant select on public.room_discord_links to authenticated;
grant all on public.room_discord_links to service_role;

select pg_notify('pgrst', 'reload schema');
