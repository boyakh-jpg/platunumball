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

revoke all on function public.rankball_deactivate_terminal_room_feed() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
