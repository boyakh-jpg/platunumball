-- Keep the room feed card cache writable only through the minimum service-role path.

do $$
begin
  if to_regclass('public.room_feed_cards') is not null then
    execute 'revoke all privileges on table public.room_feed_cards from service_role';
    execute 'grant select, insert, update on table public.room_feed_cards to service_role';
  end if;
end;
$$;
