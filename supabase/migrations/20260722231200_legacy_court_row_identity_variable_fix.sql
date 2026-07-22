create or replace function public.rankball_enforce_legacy_court_row_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name);
  safe_court_unit text := nullif(public.rankball_court_name_key(new.payload->>'courtUnit'), '');
  approved_name text;
  approved_court_unit text;
  same_location_exists boolean;
begin
  select approved.name, approved.court_unit
  into approved_name, approved_court_unit
  from public.approved_courts approved
  where approved.id = new.id;
  canonical_name := coalesce(approved_name, canonical_name);
  safe_court_unit := coalesce(
    nullif(public.rankball_court_name_key(approved_court_unit), ''),
    safe_court_unit
  );

  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    canonical_name, safe_court_unit
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    coalesce(approved_name, old.payload->>'canonicalBaseName', old.payload->>'baseName', old.name),
    coalesce(
      nullif(public.rankball_court_name_key(approved_court_unit), ''),
      nullif(public.rankball_court_name_key(old.payload->>'courtUnit'), '')
    )
  ) then
    return new;
  end if;

  select exists (
    select 1 from public.courts legacy
    where legacy.id <> new.id
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
      )
    union all
    select 1 from public.approved_courts approved
    where approved.id <> new.id and coalesce(approved.status, 'active') = 'active'
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        approved.address_text, approved.road_address, approved.jibun_address, approved.lat, approved.lng
      )
  ) into same_location_exists;
  if same_location_exists and safe_court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.courts legacy
    where legacy.id <> new.id
      and public.rankball_court_name_key(coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
      )
    union all
    select 1 from public.approved_courts approved
    where approved.id <> new.id and coalesce(approved.status, 'active') = 'active'
      and public.rankball_court_name_key(approved.name) = public.rankball_court_name_key(canonical_name)
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

select pg_notify('pgrst', 'reload schema');
