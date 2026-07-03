alter table public.room_chat_messages
  add column if not exists message_seq bigint;

create sequence if not exists public.room_chat_messages_message_seq_seq;

alter sequence public.room_chat_messages_message_seq_seq
  owned by public.room_chat_messages.message_seq;

with numbered as (
  select
    id,
    row_number() over (order by created_at, id) as next_seq
  from public.room_chat_messages
  where message_seq is null
)
update public.room_chat_messages message
set message_seq = numbered.next_seq
from numbered
where message.id = numbered.id;

select setval(
  'public.room_chat_messages_message_seq_seq',
  greatest(coalesce((select max(message_seq) from public.room_chat_messages), 0), 1),
  true
);

alter table public.room_chat_messages
  alter column message_seq set default nextval('public.room_chat_messages_message_seq_seq');

alter table public.room_chat_messages
  alter column message_seq set not null;

alter table public.room_chat_messages
  drop constraint if exists room_chat_messages_body_length_check;

alter table public.room_chat_messages
  add constraint room_chat_messages_body_length_check
  check (char_length(btrim(body)) between 1 and 60);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_chat_messages'::regclass
      and conname = 'room_chat_messages_body_not_empty_check'
  ) then
    alter table public.room_chat_messages
      add constraint room_chat_messages_body_not_empty_check
      check (char_length(btrim(body)) > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.room_chat_messages'::regclass
      and conname = 'room_chat_messages_body_no_newline_check'
  ) then
    alter table public.room_chat_messages
      add constraint room_chat_messages_body_no_newline_check
      check (position(E'\n' in body) = 0 and position(E'\r' in body) = 0);
  end if;
end;
$$;

create index if not exists room_chat_messages_room_seq_idx
  on public.room_chat_messages (room_type, room_id, message_seq);

create index if not exists room_chat_messages_room_user_created_idx
  on public.room_chat_messages (room_type, room_id, user_id, created_at desc);

create or replace function public.rankball_guard_room_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_status text;
  post_confirmed_at timestamptz;
  recent_count integer;
begin
  new.body := btrim(coalesce(new.body, ''));

  if new.room_type <> 'recruiting' then
    raise exception 'chat_not_allowed';
  end if;

  if new.user_id is null or btrim(new.user_id) = '' then
    raise exception 'chat_not_allowed';
  end if;

  if char_length(new.body) = 0
    or char_length(new.body) > 60
    or position(E'\n' in new.body) > 0
    or position(E'\r' in new.body) > 0 then
    raise exception 'chat_message_invalid';
  end if;

  select status, confirmed_at
  into post_status, post_confirmed_at
  from public.recruiting_posts
  where id = new.room_id;

  if not found or coalesce(post_status, '') <> 'open' or post_confirmed_at is not null then
    raise exception 'chat_room_closed';
  end if;

  if exists (
    select 1
    from public.room_chat_messages message
    where message.room_type = new.room_type
      and message.room_id = new.room_id
      and message.user_id = new.user_id
      and message.created_at > now() - interval '3 seconds'
  ) then
    raise exception 'chat_rate_limited';
  end if;

  select count(*)
  into recent_count
  from public.room_chat_messages message
  where message.room_type = new.room_type
    and message.room_id = new.room_id
    and message.user_id = new.user_id
    and message.created_at > now() - interval '1 minute';

  if recent_count >= 6 then
    raise exception 'chat_rate_limited';
  end if;

  if exists (
    select 1
    from public.room_chat_messages message
    where message.room_type = new.room_type
      and message.room_id = new.room_id
      and message.user_id = new.user_id
      and message.body = new.body
      and message.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'chat_rate_limited';
  end if;

  return new;
end;
$$;

revoke all on function public.rankball_guard_room_chat_message() from public;

drop trigger if exists rankball_room_chat_message_guard on public.room_chat_messages;
create trigger rankball_room_chat_message_guard
before insert on public.room_chat_messages
for each row
execute function public.rankball_guard_room_chat_message();

drop policy if exists room_chat_messages_insert_related on public.room_chat_messages;
create policy room_chat_messages_insert_related
on public.room_chat_messages
for insert
to authenticated
with check (
  room_type = 'recruiting'
  and user_id = public.current_profile_id()
  and exists (
    select 1
    from public.recruiting_posts post
    where post.id = room_id
      and post.status = 'open'
      and post.confirmed_at is null
  )
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime drop table public.room_chat_messages;
    exception
      when undefined_object then null;
    end;
  end if;
end;
$$;
