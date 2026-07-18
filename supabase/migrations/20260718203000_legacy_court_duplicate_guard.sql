alter table public.courts
  add column if not exists address_text text,
  add column if not exists road_address text,
  add column if not exists jibun_address text,
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists payload jsonb not null default '{}'::jsonb;

with legacy_seed(id, address_text) as (
  values
    ('c1', '서울 마포구 망원동 한강공원 망원지구'),
    ('c2', '서울 성동구 성수동1가 서울숲 인근'),
    ('c3', '서울 송파구 올림픽로 25'),
    ('c4', '서울 마포구 홍익로 인근'),
    ('c5', '서울 광진구 자양동 뚝섬한강공원'),
    ('c6', '서울 강남구 양재천로 인근'),
    ('c7', '서울 서초구 반포동 반포한강공원'),
    ('c8', '서울 동작구 노량진동 인근'),
    ('c9', '서울 마포구 연남동 경의선숲길 인근'),
    ('c10', '서울 성동구 왕십리로 인근'),
    ('c11', '서울 서대문구 신촌로 인근'),
    ('c12', '서울 영등포구 문래동 인근')
)
update public.courts court
set
  address_text = coalesce(nullif(court.address_text, ''), seed.address_text),
  payload = coalesce(court.payload, '{}'::jsonb) || jsonb_build_object(
    'canonicalBaseName', court.name,
    'baseName', court.name,
    'addressText', coalesce(nullif(court.address_text, ''), seed.address_text)
  )
from legacy_seed seed
where court.id = seed.id;

update public.courts legacy
set
  address_text = approved.address_text,
  road_address = approved.road_address,
  jibun_address = approved.jibun_address,
  lat = approved.lat,
  lng = approved.lng,
  payload = coalesce(legacy.payload, '{}'::jsonb) || coalesce(approved.payload, '{}'::jsonb)
from public.approved_courts approved
where legacy.id = approved.id;

create or replace function public.rankball_enforce_legacy_court_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name);
  court_unit text := nullif(public.rankball_court_name_key(new.payload->>'courtUnit'), '');
  same_location_exists boolean;
begin
  if tg_table_name = 'court_requests' and new.status not in ('pending', 'reported') then
    return new;
  end if;
  if tg_table_name = 'approved_courts' and coalesce(new.status, 'active') <> 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    new.payload->>'canonicalBaseName', new.payload->>'courtUnit'
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    old.payload->>'canonicalBaseName', old.payload->>'courtUnit'
  ) then
    return new;
  end if;

  select exists (
    select 1
    from public.courts legacy
    where legacy.id <> new.id
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
      )
  ) into same_location_exists;

  if same_location_exists and court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.courts legacy
    where legacy.id <> new.id
      and public.rankball_court_name_key(coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
      )
  ) then
    raise exception 'duplicate_legacy_court' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists court_requests_legacy_identity_guard on public.court_requests;
create trigger court_requests_legacy_identity_guard
before insert or update on public.court_requests
for each row execute function public.rankball_enforce_legacy_court_identity();

drop trigger if exists approved_courts_legacy_identity_guard on public.approved_courts;
create trigger approved_courts_legacy_identity_guard
before insert or update on public.approved_courts
for each row execute function public.rankball_enforce_legacy_court_identity();

create or replace function public.rankball_enforce_legacy_court_row_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name);
  court_unit text := nullif(public.rankball_court_name_key(new.payload->>'courtUnit'), '');
  same_location_exists boolean;
begin
  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    new.payload->>'canonicalBaseName', new.payload->>'courtUnit'
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    old.payload->>'canonicalBaseName', old.payload->>'courtUnit'
  ) then
    return new;
  end if;

  select exists (
    select 1
    from public.courts legacy
    where legacy.id <> new.id
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
      )
    union all
    select 1
    from public.approved_courts approved
    where approved.id <> new.id
      and coalesce(approved.status, 'active') = 'active'
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        approved.address_text, approved.road_address, approved.jibun_address, approved.lat, approved.lng
      )
  ) into same_location_exists;

  if same_location_exists and court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.courts legacy
    where legacy.id <> new.id
      and public.rankball_court_name_key(coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
      )
    union all
    select 1
    from public.approved_courts approved
    where approved.id <> new.id
      and coalesce(approved.status, 'active') = 'active'
      and public.rankball_court_name_key(coalesce(approved.payload->>'canonicalBaseName', approved.payload->>'baseName', approved.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        approved.address_text, approved.road_address, approved.jibun_address, approved.lat, approved.lng
      )
  ) then
    raise exception 'court_duplicate' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists courts_identity_guard on public.courts;
create trigger courts_identity_guard
before insert or update on public.courts
for each row execute function public.rankball_enforce_legacy_court_row_identity();

create or replace function public.rankball_sync_court_identity_tables()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'approved_courts' then
    update public.courts legacy
    set
      name = new.name,
      address_text = new.address_text,
      road_address = new.road_address,
      jibun_address = new.jibun_address,
      lat = new.lat,
      lng = new.lng,
      payload = coalesce(legacy.payload, '{}'::jsonb) || coalesce(new.payload, '{}'::jsonb)
    where legacy.id = new.id
      and row(
        legacy.name, legacy.address_text, legacy.road_address, legacy.jibun_address,
        legacy.lat, legacy.lng, legacy.payload
      ) is distinct from row(
        new.name, new.address_text, new.road_address, new.jibun_address,
        new.lat, new.lng, coalesce(legacy.payload, '{}'::jsonb) || coalesce(new.payload, '{}'::jsonb)
      );
  else
    update public.courts legacy
    set
      name = approved.name,
      address_text = approved.address_text,
      road_address = approved.road_address,
      jibun_address = approved.jibun_address,
      lat = approved.lat,
      lng = approved.lng,
      payload = coalesce(legacy.payload, '{}'::jsonb) || coalesce(approved.payload, '{}'::jsonb)
    from public.approved_courts approved
    where legacy.id = new.id
      and approved.id = new.id
      and row(
        legacy.name, legacy.address_text, legacy.road_address, legacy.jibun_address,
        legacy.lat, legacy.lng, legacy.payload
      ) is distinct from row(
        approved.name, approved.address_text, approved.road_address, approved.jibun_address,
        approved.lat, approved.lng, coalesce(legacy.payload, '{}'::jsonb) || coalesce(approved.payload, '{}'::jsonb)
      );
  end if;

  return new;
end;
$$;

drop trigger if exists approved_courts_sync_legacy_identity on public.approved_courts;
create trigger approved_courts_sync_legacy_identity
after insert or update of name, address_text, road_address, jibun_address, lat, lng, payload on public.approved_courts
for each row execute function public.rankball_sync_court_identity_tables();

drop trigger if exists courts_sync_approved_identity on public.courts;
create trigger courts_sync_approved_identity
after insert or update of name, address_text, road_address, jibun_address, lat, lng, payload on public.courts
for each row execute function public.rankball_sync_court_identity_tables();

