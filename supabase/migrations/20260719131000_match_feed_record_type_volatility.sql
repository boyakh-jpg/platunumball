alter function public.rankball_room_feed_card_with_region_key(text, jsonb) stable;

select pg_notify('pgrst', 'reload schema');
