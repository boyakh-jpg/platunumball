create or replace function public.rankball_compact_recruiting_feed_counts(p_counts jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  counts jsonb := coalesce(p_counts, '{}'::jsonb);
  side_a jsonb := coalesce(counts->'teamA', counts->'a', '{}'::jsonb);
  side_b jsonb := coalesce(counts->'teamB', counts->'b', '{}'::jsonb);
  a_filled integer := 0;
  a_projected integer := 0;
  a_confirm integer := 0;
  a_capacity integer := 5;
  b_filled integer := 0;
  b_projected integer := 0;
  b_confirm integer := 0;
  b_capacity integer := 5;
  total_filled integer := 0;
  total_projected integer := 0;
  total_capacity integer := 10;
  party_count integer := 0;
begin
  if jsonb_typeof(counts) <> 'object' then
    return '{}'::jsonb;
  end if;

  if jsonb_typeof(side_a) = 'array' then
    a_filled := case when coalesce(side_a->>0, '') ~ '^[0-9]+$' then (side_a->>0)::integer else 0 end;
    a_projected := case when coalesce(side_a->>1, '') ~ '^[0-9]+$' then (side_a->>1)::integer else a_filled end;
    a_confirm := case when coalesce(side_a->>2, '') ~ '^[0-9]+$' then (side_a->>2)::integer else a_projected end;
    a_capacity := case when coalesce(side_a->>3, '') ~ '^[0-9]+$' then (side_a->>3)::integer else 5 end;
  else
    a_filled := case when coalesce(side_a->>'filled', side_a->>'f', side_a->>'count', '') ~ '^[0-9]+$' then coalesce(side_a->>'filled', side_a->>'f', side_a->>'count')::integer else 0 end;
    a_projected := case when coalesce(side_a->>'projectedFilled', side_a->>'p', '') ~ '^[0-9]+$' then coalesce(side_a->>'projectedFilled', side_a->>'p')::integer else a_filled end;
    a_confirm := case when coalesce(side_a->>'confirmationProjectedFilled', side_a->>'cf', '') ~ '^[0-9]+$' then coalesce(side_a->>'confirmationProjectedFilled', side_a->>'cf')::integer else a_projected end;
    a_capacity := case when coalesce(side_a->>'capacity', side_a->>'c', '') ~ '^[0-9]+$' then coalesce(side_a->>'capacity', side_a->>'c')::integer else 5 end;
  end if;

  if jsonb_typeof(side_b) = 'array' then
    b_filled := case when coalesce(side_b->>0, '') ~ '^[0-9]+$' then (side_b->>0)::integer else 0 end;
    b_projected := case when coalesce(side_b->>1, '') ~ '^[0-9]+$' then (side_b->>1)::integer else b_filled end;
    b_confirm := case when coalesce(side_b->>2, '') ~ '^[0-9]+$' then (side_b->>2)::integer else b_projected end;
    b_capacity := case when coalesce(side_b->>3, '') ~ '^[0-9]+$' then (side_b->>3)::integer else 5 end;
  else
    b_filled := case when coalesce(side_b->>'filled', side_b->>'f', side_b->>'count', '') ~ '^[0-9]+$' then coalesce(side_b->>'filled', side_b->>'f', side_b->>'count')::integer else 0 end;
    b_projected := case when coalesce(side_b->>'projectedFilled', side_b->>'p', '') ~ '^[0-9]+$' then coalesce(side_b->>'projectedFilled', side_b->>'p')::integer else b_filled end;
    b_confirm := case when coalesce(side_b->>'confirmationProjectedFilled', side_b->>'cf', '') ~ '^[0-9]+$' then coalesce(side_b->>'confirmationProjectedFilled', side_b->>'cf')::integer else b_projected end;
    b_capacity := case when coalesce(side_b->>'capacity', side_b->>'c', '') ~ '^[0-9]+$' then coalesce(side_b->>'capacity', side_b->>'c')::integer else 5 end;
  end if;

  total_filled := case when coalesce(counts->>'filled', counts->>'f', '') ~ '^[0-9]+$' then coalesce(counts->>'filled', counts->>'f')::integer else a_filled + b_filled end;
  total_projected := case when coalesce(counts->>'projectedFilled', counts->>'p', '') ~ '^[0-9]+$' then coalesce(counts->>'projectedFilled', counts->>'p')::integer else a_projected + b_projected end;
  total_capacity := case when coalesce(counts->>'capacity', counts->>'c', '') ~ '^[0-9]+$' then coalesce(counts->>'capacity', counts->>'c')::integer else a_capacity + b_capacity end;
  party_count := case when coalesce(counts->>'partyCount', counts->>'pc', '') ~ '^[0-9]+$' then coalesce(counts->>'partyCount', counts->>'pc')::integer else 0 end;

  return jsonb_build_object(
    'a', jsonb_build_array(a_filled, a_projected, a_confirm, a_capacity),
    'b', jsonb_build_array(b_filled, b_projected, b_confirm, b_capacity),
    'f', total_filled,
    'p', total_projected,
    'c', total_capacity,
    'pc', party_count
  );
end;
$$;

create or replace function public.rankball_compact_saved_room_feed_card(
  p_entity_type text,
  p_card_json jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  card jsonb := coalesce(p_card_json, '{}'::jsonb);
  region_key text;
begin
  if p_entity_type <> 'recruiting' or jsonb_typeof(card) <> 'object' then
    return card;
  end if;

  if card ? 'listCounts' then
    card := jsonb_set(
      card,
      '{listCounts}',
      public.rankball_compact_recruiting_feed_counts(card->'listCounts'),
      true
    );
  end if;

  region_key := nullif(card->>'regionKey', '');
  if region_key is null then
    region_key := public.rankball_room_feed_region_key(nullif(card->>'region', ''));
  end if;

  if region_key is null then
    return card - 'regionKey';
  end if;

  return card || jsonb_build_object('regionKey', region_key);
end;
$$;

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
begin
  return public.rankball_compact_saved_room_feed_card(p_entity_type, card);
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

  if to_regclass('public.matches') is not null
    and to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
    for row_id in select id from public.matches loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;

  if to_regclass('public.room_feed_cards') is not null then
    update public.room_feed_cards
    set card_json = public.rankball_compact_saved_room_feed_card(entity_type, card_json),
        updated_at = now()
    where entity_type = 'recruiting'
      and card_json <> public.rankball_compact_saved_room_feed_card(entity_type, card_json);
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
