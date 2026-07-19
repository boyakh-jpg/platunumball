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
  feed_active boolean := not (
    (p_entity_type = 'match' and lower(coalesce(p_status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed'))
    or (p_entity_type = 'recruiting' and lower(coalesce(p_status, '')) in ('cancelled', 'canceled', 'closed', 'expired'))
  );
begin
  if feed_active and jsonb_typeof(feed_card) = 'object' and feed_card <> '{}'::jsonb then
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
    feed_active,
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
    is_active = excluded.is_active,
    card_json = '{}'::jsonb,
    updated_at = now();
end;
$$;

update public.user_room_feed feed
set is_active = false,
    updated_at = now()
where feed.is_active = true
  and (
    (feed.entity_type = 'match' and lower(coalesce(feed.status, '')) in ('cancelled', 'canceled', 'void', 'voided', 'closed'))
    or (feed.entity_type = 'recruiting' and lower(coalesce(feed.status, '')) in ('cancelled', 'canceled', 'closed', 'expired'))
  );

revoke all on function public.rankball_upsert_room_feed(text, text, text, text, text, text, text, timestamptz, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_upsert_room_feed(text, text, text, text, text, text, text, timestamptz, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');
