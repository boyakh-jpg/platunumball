create or replace function public.rankball_room_feed_card_with_region_key(
  p_entity_type text,
  p_card_json jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  raw_card jsonb := coalesce(p_card_json, '{}'::jsonb);
  card jsonb := public.rankball_slim_room_feed_card(p_entity_type, raw_card);
  record_type text;
begin
  if p_entity_type = 'match' then
    record_type := nullif(coalesce(raw_card->>'recordType', raw_card->'rules'->>'recordType'), '');
    if record_type is not null then
      card := card || jsonb_build_object('recordType', record_type);
    end if;
  end if;

  return public.rankball_compact_saved_room_feed_card(p_entity_type, card);
end;
$$;

create or replace function public.rankball_upsert_room_feed_card(
  p_entity_type text,
  p_entity_id text,
  p_card_json jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  feed_card jsonb := coalesce(p_card_json, '{}'::jsonb);
  match_record_type text;
begin
  if p_entity_type = 'match' then
    select coalesce(nullif(match_row.rules->>'recordType', ''), 'match')
    into match_record_type
    from public.matches match_row
    where match_row.id = p_entity_id;

    match_record_type := coalesce(
      match_record_type,
      nullif(feed_card->>'recordType', ''),
      nullif(feed_card->'rules'->>'recordType', ''),
      'match'
    );
    feed_card := feed_card || jsonb_build_object('recordType', match_record_type);
  end if;

  insert into public.room_feed_cards (
    entity_type,
    entity_id,
    card_json,
    updated_at
  )
  values (
    p_entity_type,
    p_entity_id,
    public.rankball_room_feed_card_with_region_key(p_entity_type, feed_card),
    now()
  )
  on conflict (entity_type, entity_id)
  do update set
    card_json = excluded.card_json,
    updated_at = now();
end;
$$;

update public.room_feed_cards card
set
  card_json = public.rankball_room_feed_card_with_region_key(
    'match',
    coalesce(card.card_json, '{}'::jsonb) || jsonb_build_object(
      'recordType',
      coalesce(nullif(match_row.rules->>'recordType', ''), 'match')
    )
  ),
  updated_at = now()
from public.matches match_row
where card.entity_type = 'match'
  and card.entity_id = match_row.id
  and coalesce(card.card_json->>'recordType', '')
    is distinct from coalesce(nullif(match_row.rules->>'recordType', ''), 'match');

select pg_notify('pgrst', 'reload schema');
