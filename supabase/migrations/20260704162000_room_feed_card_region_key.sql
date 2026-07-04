create or replace function public.rankball_room_feed_card_with_region_key(
  p_entity_type text,
  p_card_json jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  raw_card jsonb := coalesce(p_card_json, '{}'::jsonb);
  card jsonb := public.rankball_slim_room_feed_card(p_entity_type, raw_card);
  region_key text;
begin
  if p_entity_type <> 'recruiting' or jsonb_typeof(card) <> 'object' then
    return card;
  end if;

  region_key := nullif(card->>'regionKey', '');
  if region_key is null then
    region_key := public.rankball_room_feed_region_key(coalesce(
      nullif(raw_card->>'regionKey', ''),
      nullif(card->>'region', ''),
      nullif(raw_card->>'region', '')
    ));
  end if;

  if region_key is null then
    return card - 'regionKey';
  end if;

  return card || jsonb_build_object('regionKey', region_key);
end;
$$;

create or replace function public.rankball_upsert_room_feed_card(
  p_entity_type text,
  p_entity_id text,
  p_card_json jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.room_feed_cards (
    entity_type,
    entity_id,
    card_json,
    updated_at
  )
  values (
    p_entity_type,
    p_entity_id,
    public.rankball_room_feed_card_with_region_key(p_entity_type, coalesce(p_card_json, '{}'::jsonb)),
    now()
  )
  on conflict (entity_type, entity_id)
  do update set
    card_json = excluded.card_json,
    updated_at = now();
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in select id from public.recruiting_posts loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.room_feed_cards') is not null then
    update public.room_feed_cards
    set card_json = public.rankball_room_feed_card_with_region_key(entity_type, card_json),
        updated_at = now()
    where entity_type = 'recruiting'
      and coalesce(card_json->>'regionKey', '') = '';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
