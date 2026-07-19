create or replace function public.rankball_cleanup_simulation_feed_orphans()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  simulation_entity_ids text[] := array[]::text[];
  deleted_feed_rows integer := 0;
  deleted_cards integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:simulation-feed-orphan-cleanup'));

  select coalesce(array_agg(distinct card.entity_id), array[]::text[])
  into simulation_entity_ids
  from public.room_feed_cards card
  where card.entity_id like 'sim\_%' escape '\'
     or card.card_json->>'tournamentId' like 'sim\_trn\_%' escape '\'
     or card.card_json->>'recruitingPostId' like 'sim\_q\_%' escape '\'
     or card.card_json->>'simulationId' like 'sim\_%' escape '\'
     or card.card_json->>'simulation' = 'true'
     or lower(coalesce(card.card_json->>'title', '')) like 'backend simulation%';

  delete from public.user_room_feed feed
  where feed.entity_id = any(simulation_entity_ids)
     or feed.entity_id like 'sim\_%' escape '\';
  get diagnostics deleted_feed_rows = row_count;

  delete from public.room_feed_cards card
  where card.entity_id = any(simulation_entity_ids)
     or card.entity_id like 'sim\_%' escape '\';
  get diagnostics deleted_cards = row_count;

  return jsonb_build_object(
    'ok', true,
    'deletedFeedRows', deleted_feed_rows,
    'deletedCards', deleted_cards
  );
end
$$;

revoke all on function public.rankball_cleanup_simulation_feed_orphans() from public, anon, authenticated;
grant execute on function public.rankball_cleanup_simulation_feed_orphans() to service_role;

select public.rankball_cleanup_simulation_feed_orphans();
