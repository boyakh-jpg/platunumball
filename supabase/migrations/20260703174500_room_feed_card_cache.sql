alter table public.user_room_feed
  add column if not exists timing_type text,
  add column if not exists scheduled_date date;

create table if not exists public.room_feed_cards (
  entity_type text not null,
  entity_id text not null,
  card_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (entity_type, entity_id),
  constraint room_feed_cards_entity_type_check check (entity_type in ('recruiting', 'match'))
);

alter table public.room_feed_cards enable row level security;
grant select, insert, update on public.room_feed_cards to service_role;

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
    coalesce(p_card_json, '{}'::jsonb),
    now()
  )
  on conflict (entity_type, entity_id)
  do update set
    card_json = excluded.card_json,
    updated_at = now();
$$;

create or replace function public.rankball_upsert_room_feed(
  p_profile_id text,
  p_entity_type text,
  p_entity_id text,
  p_relation text,
  p_region_key text,
  p_status text,
  p_visibility text,
  p_sort_at timestamptz,
  p_card_json jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  feed_card jsonb := coalesce(p_card_json, '{}'::jsonb);
  feed_timing_type text := nullif(feed_card->>'timingType', '');
  feed_scheduled_date date := case
    when coalesce(feed_card->>'scheduledDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (feed_card->>'scheduledDate')::date
    else null
  end;
begin
  if jsonb_typeof(feed_card) = 'object' and feed_card <> '{}'::jsonb then
    perform public.rankball_upsert_room_feed_card(p_entity_type, p_entity_id, feed_card);
  end if;

  insert into public.user_room_feed (
    profile_id,
    entity_type,
    entity_id,
    relation,
    feed_scope,
    region_key,
    status,
    visibility,
    timing_type,
    scheduled_date,
    sort_at,
    is_active,
    card_json,
    updated_at
  )
  values (
    nullif(btrim(p_profile_id), ''),
    p_entity_type,
    p_entity_id,
    p_relation,
    case when p_relation = 'region_public' then 'public' else 'profile' end,
    p_region_key,
    p_status,
    p_visibility,
    feed_timing_type,
    feed_scheduled_date,
    coalesce(p_sort_at, now()),
    true,
    '{}'::jsonb,
    now()
  )
  on conflict (profile_id, entity_type, entity_id, relation)
  do update set
    feed_scope = excluded.feed_scope,
    region_key = excluded.region_key,
    status = excluded.status,
    visibility = excluded.visibility,
    timing_type = excluded.timing_type,
    scheduled_date = excluded.scheduled_date,
    sort_at = excluded.sort_at,
    is_active = true,
    card_json = '{}'::jsonb,
    updated_at = now();
end;
$$;

create or replace function public.rankball_match_list(
  p_profile_id text,
  p_limit integer default 5,
  p_cursor text default '',
  p_active_only boolean default false
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_profile_id), '') as profile_id,
      greatest(1, least(200, coalesce(p_limit, 5))) as row_limit,
      case
        when coalesce(p_cursor, '') like 'feed:%' and substring(coalesce(p_cursor, '') from 6) ~ '^[0-9]+$'
          then greatest(0, substring(coalesce(p_cursor, '') from 6)::integer)
        else 0
      end as row_offset
  ),
  grouped as (
    select
      feed.entity_id,
      max(feed.sort_at) as sort_at,
      max(feed.status) as status,
      coalesce(
        (
          select card.card_json
          from public.room_feed_cards card
          where card.entity_type = 'match'
            and card.entity_id = feed.entity_id
          limit 1
        ),
        (array_agg(feed.card_json order by feed.sort_at desc, feed.relation))[1],
        '{}'::jsonb
      ) as card_json,
      jsonb_agg(distinct feed.relation) as relations
    from public.user_room_feed feed, params
    where feed.entity_type = 'match'
      and feed.feed_scope = 'profile'
      and feed.profile_id = params.profile_id
      and feed.is_active = true
      and coalesce(feed.status, '') <> 'closed'
      and (
        not coalesce(p_active_only, false)
        or coalesce(feed.status, '') not in ('confirmed', 'cancelled', 'void', 'closed')
      )
      and feed.relation in ('owner', 'participant', 'referee')
    group by feed.entity_id
  ),
  paged as (
    select grouped.*
    from grouped, params
    order by grouped.sort_at desc nulls last, grouped.entity_id desc
    offset (select row_offset from params)
    limit (select row_limit + 1 from params)
  ),
  numbered as (
    select
      paged.*,
      row_number() over (order by paged.sort_at desc nulls last, paged.entity_id desc) as rn
    from paged
  )
  select jsonb_build_object(
    'rows',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entity_id', numbered.entity_id,
          'sort_at', numbered.sort_at,
          'status', numbered.status,
          'relations', numbered.relations,
          'card_json', numbered.card_json
        )
        order by numbered.sort_at desc nulls last, numbered.entity_id desc
      ) filter (where numbered.rn <= (select row_limit from params)),
      '[]'::jsonb
    ),
    'cursor',
    case
      when count(*) > (select row_limit from params) then 'feed:' || ((select row_offset from params) + (select row_limit from params))::text
      else ''
    end,
    'exhausted',
    count(*) <= (select row_limit from params)
  )
  from numbered, params;
$$;

revoke all on function public.rankball_match_list(text, integer, text, boolean) from public;
grant execute on function public.rankball_match_list(text, integer, text, boolean) to service_role;

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null then
    for row_id in select id from public.recruiting_posts loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
    for row_id in select id from public.matches loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;

  update public.user_room_feed
  set card_json = '{}'::jsonb
  where card_json <> '{}'::jsonb;
end;
$$;

select pg_notify('pgrst', 'reload schema');
