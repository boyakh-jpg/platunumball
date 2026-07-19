create or replace function public.rankball_deactivate_terminal_room_feed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  terminal boolean := false;
  target_entity_type text;
begin
  if tg_table_name = 'matches' then
    target_entity_type := 'match';
    terminal := lower(coalesce(new.status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed');
  elsif tg_table_name = 'recruiting_posts' then
    target_entity_type := 'recruiting';
    terminal := lower(coalesce(new.status, '')) in ('cancelled', 'canceled', 'closed', 'expired');
  end if;

  if terminal then
    update public.user_room_feed feed
    set is_active = false,
        status = new.status,
        updated_at = now()
    where feed.entity_type = target_entity_type
      and feed.entity_id = new.id
      and feed.is_active = true;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_matches_terminal_feed_deactivation on public.matches;
create trigger zz_matches_terminal_feed_deactivation
after insert or update on public.matches
for each row execute function public.rankball_deactivate_terminal_room_feed();

drop trigger if exists zz_recruiting_terminal_feed_deactivation on public.recruiting_posts;
create trigger zz_recruiting_terminal_feed_deactivation
after insert or update on public.recruiting_posts
for each row execute function public.rankball_deactivate_terminal_room_feed();

update public.user_room_feed feed
set is_active = false,
    status = match_row.status,
    updated_at = now()
from public.matches match_row
where feed.entity_type = 'match'
  and feed.entity_id = match_row.id
  and feed.is_active = true
  and lower(coalesce(match_row.status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed');

update public.user_room_feed feed
set is_active = false,
    status = post.status,
    updated_at = now()
from public.recruiting_posts post
where feed.entity_type = 'recruiting'
  and feed.entity_id = post.id
  and feed.is_active = true
  and lower(coalesce(post.status, '')) in ('cancelled', 'canceled', 'closed', 'expired');

revoke all on function public.rankball_deactivate_terminal_room_feed() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
