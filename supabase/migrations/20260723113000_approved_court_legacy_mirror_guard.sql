create or replace function public.rankball_sync_approved_court_legacy_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.status, 'active') <> 'active' then
    return new;
  end if;

  insert into public.courts (
    id,
    name,
    region,
    type,
    region_key,
    created_at
  )
  values (
    new.id,
    new.name,
    coalesce(
      nullif(new.payload->>'region', ''),
      nullif(new.sigungu, ''),
      nullif(new.region_key, ''),
      'unknown'
    ),
    coalesce(nullif(new.payload->>'type', ''), nullif(new.indoor_outdoor, ''), 'outdoor'),
    coalesce(
      nullif(new.region_key, ''),
      public.rankball_court_region_key(
        new.payload->>'region',
        new.address_text,
        new.road_address,
        new.jibun_address,
        new.payload
      ),
      nullif(new.sigungu, '')
    ),
    coalesce(new.created_at, now())
  )
  on conflict (id) do update set
    name = excluded.name,
    region = excluded.region,
    type = excluded.type,
    region_key = excluded.region_key;

  return new;
end;
$$;

drop trigger if exists rankball_approved_court_legacy_mirror on public.approved_courts;
create trigger rankball_approved_court_legacy_mirror
after insert or update of id, name, status, payload, indoor_outdoor, sigungu, region_key, address_text, road_address, jibun_address
on public.approved_courts
for each row execute function public.rankball_sync_approved_court_legacy_mirror();

create or replace function public.rankball_ensure_recruiting_court_legacy_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_court public.approved_courts%rowtype;
begin
  if new.court_id is null
    or exists (select 1 from public.courts court where court.id = new.court_id) then
    return new;
  end if;

  select court.* into approved_court
  from public.approved_courts court
  where court.id = new.court_id
    and coalesce(court.status, 'active') = 'active';

  if approved_court.id is not null then
    insert into public.courts (
      id,
      name,
      region,
      type,
      region_key,
      created_at
    )
    values (
      approved_court.id,
      approved_court.name,
      coalesce(
        nullif(approved_court.payload->>'region', ''),
        nullif(approved_court.sigungu, ''),
        nullif(approved_court.region_key, ''),
        'unknown'
      ),
      coalesce(nullif(approved_court.payload->>'type', ''), nullif(approved_court.indoor_outdoor, ''), 'outdoor'),
      coalesce(
        nullif(approved_court.region_key, ''),
        public.rankball_court_region_key(
          approved_court.payload->>'region',
          approved_court.address_text,
          approved_court.road_address,
          approved_court.jibun_address,
          approved_court.payload
        ),
        nullif(approved_court.sigungu, '')
      ),
      coalesce(approved_court.created_at, now())
    )
    on conflict (id) do update set
      name = excluded.name,
      region = excluded.region,
      type = excluded.type,
      region_key = excluded.region_key;
  end if;

  return new;
end;
$$;

drop trigger if exists rankball_recruiting_court_legacy_mirror on public.recruiting_posts;
create trigger rankball_recruiting_court_legacy_mirror
before insert or update of court_id
on public.recruiting_posts
for each row execute function public.rankball_ensure_recruiting_court_legacy_mirror();

revoke all on function public.rankball_sync_approved_court_legacy_mirror() from public, anon, authenticated;
revoke all on function public.rankball_ensure_recruiting_court_legacy_mirror() from public, anon, authenticated;

notify pgrst, 'reload schema';
