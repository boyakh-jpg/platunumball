create table if not exists public.room_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_type text not null default 'recruiting',
  room_id text not null,
  user_id text not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint room_chat_messages_room_type_check check (room_type in ('recruiting')),
  constraint room_chat_messages_body_length_check check (char_length(btrim(body)) between 1 and 500),
  constraint room_chat_messages_body_plain_text_check check (body !~ '[[:cntrl:]]')
);

create index if not exists room_chat_messages_room_created_idx
  on public.room_chat_messages (room_type, room_id, created_at desc, id desc);

create index if not exists room_chat_messages_user_created_idx
  on public.room_chat_messages (user_id, created_at desc);

alter table public.room_chat_messages enable row level security;

create or replace function public.rankball_can_access_recruiting_room_chat(p_post_id text, p_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_post_id), '') as post_id,
      nullif(btrim(p_profile_id), '') as profile_id
  )
  select exists (
    select 1
    from params
    join public.recruiting_posts post on post.id = params.post_id
    where params.post_id is not null
      and params.profile_id is not null
      and (
        post.player_id = params.profile_id
        or coalesce(post.player_ids, '[]'::jsonb) ? params.profile_id
        or post.room_state->>'ownerId' = params.profile_id
        or post.referee_id = params.profile_id
        or exists (
          select 1
          from public.recruiting_applications application
          where application.post_id = post.id
            and (
              application.player_id = params.profile_id
              or coalesce(application.player_ids, '[]'::jsonb) ? params.profile_id
            )
        )
        or exists (
          select 1
          from public.rankball_room_state_participant_ids(post.room_state) room_profile
          where room_profile.profile_id = params.profile_id
        )
      )
  );
$$;

revoke all on function public.rankball_can_access_recruiting_room_chat(text, text) from public;
grant execute on function public.rankball_can_access_recruiting_room_chat(text, text) to authenticated, service_role;

drop policy if exists room_chat_messages_select_related on public.room_chat_messages;
create policy room_chat_messages_select_related
on public.room_chat_messages
for select
to authenticated
using (
  room_type = 'recruiting'
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);

drop policy if exists room_chat_messages_insert_related on public.room_chat_messages;
create policy room_chat_messages_insert_related
on public.room_chat_messages
for insert
to authenticated
with check (
  room_type = 'recruiting'
  and user_id = public.current_profile_id()
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);

grant select, insert on public.room_chat_messages to authenticated;
grant all on public.room_chat_messages to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.room_chat_messages;
    exception
      when duplicate_object then null;
    end;
  end if;
end;
$$;
