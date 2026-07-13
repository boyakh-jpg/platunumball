create index if not exists matches_rules_recruiting_post_id_idx
  on public.matches ((rules->>'recruitingPostId'))
  where nullif(rules->>'recruitingPostId', '') is not null;

create or replace function public.rankball_recruiting_room_chat_is_open(p_post_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.recruiting_posts post
    where post.id = p_post_id
      and (
        (post.status = 'open' and post.confirmed_at is null)
        or exists (
          select 1
          from public.matches match_row
          where match_row.rules->>'recruitingPostId' = post.id
            and match_row.status in ('contract', 'agreed')
            and match_row.confirmed_at is null
            and match_row.cancelled_at is null
            and match_row.voided_at is null
            and not (
              match_row.ended_at is not null
              and exists (
                select 1
                from public.match_results result
                where result.match_id = match_row.id
              )
            )
        )
      )
  );
$$;

revoke all on function public.rankball_recruiting_room_chat_is_open(text) from public;
grant execute on function public.rankball_recruiting_room_chat_is_open(text) to authenticated, service_role;

create or replace function public.rankball_guard_room_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
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

  if not public.rankball_recruiting_room_chat_is_open(new.room_id) then
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

drop policy if exists room_chat_messages_insert_related on public.room_chat_messages;
create policy room_chat_messages_insert_related
on public.room_chat_messages
for insert
to authenticated
with check (
  room_type = 'recruiting'
  and user_id = public.current_profile_id()
  and public.rankball_recruiting_room_chat_is_open(room_id)
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);
