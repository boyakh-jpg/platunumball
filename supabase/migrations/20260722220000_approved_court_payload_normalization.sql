create or replace function public.rankball_slim_approved_court_payload(raw_payload jsonb)
returns jsonb
language sql
immutable
parallel safe
as $$
  with source as (
    select case when jsonb_typeof(raw_payload) = 'object' then raw_payload else '{}'::jsonb end as data
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'publicImportKey', case
      when coalesce(data->>'publicImportKey', '') ~ '^[0-9a-f]{64}$' then data->'publicImportKey'
      else null
    end,
    'active', case when data ? 'active' then data->'active' else null end,
    'synthetic', case when data ? 'synthetic' then data->'synthetic' else null end,
    'simulation', case when data ? 'simulation' then data->'simulation' else null end,
    'simulationId', case when data ? 'simulationId' then data->'simulationId' else null end,
    'quarantinedAt', case when data ? 'quarantinedAt' then data->'quarantinedAt' else null end,
    'quarantinedLat', case when data ? 'quarantinedLat' then data->'quarantinedLat' else null end,
    'quarantinedLng', case when data ? 'quarantinedLng' then data->'quarantinedLng' else null end,
    'quarantinedReason', case when data ? 'quarantinedReason' then data->'quarantinedReason' else null end
  ))
  from source;
$$;

create or replace function public.rankball_enforce_standard_court_name()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  safe_payload jsonb := case when jsonb_typeof(new.payload) = 'object' then new.payload else '{}'::jsonb end;
  safe_sigungu text;
  safe_sido text;
  safe_unit text;
  safe_facility text;
  safe_name text;
  safe_region text;
  payload_indoor_outdoor text;
  payload_venue_type text;
  payload_court_kind text;
  payload_surface_type text;
  payload_court_layout text;
  payload_access_type text;
begin
  safe_sido := public.rankball_normalize_court_name(coalesce(
    case when tg_table_name = 'approved_courts' then to_jsonb(new)->>'sido' end,
    safe_payload->>'sido'
  ));
  safe_region := public.rankball_normalize_court_name(coalesce(
    safe_payload->>'region',
    case when tg_table_name = 'approved_courts' then to_jsonb(new)->>'sigungu' end,
    safe_sido
  ));
  safe_unit := public.rankball_normalize_court_name(coalesce(
    case when tg_table_name = 'approved_courts' then to_jsonb(new)->>'court_unit' end,
    safe_payload->>'courtUnit'
  ));
  safe_sigungu := public.rankball_court_sigungu_label(
    coalesce(
      case when tg_table_name = 'approved_courts' then to_jsonb(new)->>'sigungu' end,
      safe_payload->>'sigungu'
    ),
    coalesce(new.address_text, new.road_address, new.jibun_address),
    safe_sido,
    safe_region
  );
  safe_facility := public.rankball_court_facility_base(
    coalesce(
      case when tg_table_name = 'approved_courts' then to_jsonb(new)->>'facility_name' end,
      nullif(safe_payload->>'facilityName', ''),
      nullif(safe_payload->>'baseName', ''),
      new.name
    ),
    safe_sigungu,
    safe_unit
  );
  safe_name := public.rankball_standard_court_name(
    safe_sigungu,
    safe_facility,
    safe_unit,
    coalesce(new.address_text, new.road_address, new.jibun_address),
    safe_sido,
    safe_region
  );

  if safe_name is null then
    if (tg_table_name = 'court_requests' and new.status in ('pending', 'reported'))
      or (tg_table_name = 'approved_courts' and coalesce(new.status, 'active') = 'active') then
      raise exception 'court_sigungu_and_facility_required' using errcode = '22023';
    end if;
    return new;
  end if;

  new.name := safe_name;
  if tg_table_name = 'court_requests' then
    new.payload := safe_payload || jsonb_build_object(
      'name', safe_name,
      'canonicalName', safe_name,
      'canonicalBaseName', safe_name,
      'baseName', safe_facility,
      'facilityName', safe_facility,
      'courtUnit', safe_unit,
      'sido', safe_sido,
      'sigungu', safe_sigungu
    );
    return new;
  end if;

  payload_indoor_outdoor := case lower(btrim(coalesce(safe_payload->>'indoorOutdoor', '')))
    when 'outdoor' then 'outdoor'
    when 'indoor' then 'indoor'
    when 'mixed' then 'mixed'
    when 'unknown' then 'unknown'
    else case btrim(coalesce(safe_payload->>'type', ''))
      when '야외' then 'outdoor'
      when '실내' then 'indoor'
      else null
    end
  end;
  payload_venue_type := case
    when safe_payload->>'venueType' in ('park', 'sports_facility', 'public_facility', 'school', 'apartment', 'unknown')
      then safe_payload->>'venueType'
    else null
  end;
  payload_court_kind := case
    when safe_payload->>'courtKind' in ('official', 'street_hoop', 'unknown') then safe_payload->>'courtKind'
    else null
  end;
  payload_surface_type := case
    when safe_payload->>'surfaceType' in ('asphalt', 'urethane', 'dirt', 'indoor_wood', 'indoor_synthetic', 'unknown')
      then safe_payload->>'surfaceType'
    else null
  end;
  payload_court_layout := case
    when safe_payload->>'courtLayout' in ('full', 'half', 'single_hoop', 'unknown') then safe_payload->>'courtLayout'
    else null
  end;
  payload_access_type := case
    when safe_payload->>'accessType' in ('walk_in', 'reservation', 'restricted', 'unknown') then safe_payload->>'accessType'
    else null
  end;

  new.facility_name := safe_facility;
  new.court_unit := safe_unit;
  new.sido := safe_sido;
  new.sigungu := safe_sigungu;
  new.emd := coalesce(nullif(new.emd, ''), nullif(safe_payload->>'emd', ''), nullif(safe_payload->>'addressDong', ''));
  new.indoor_outdoor := coalesce(nullif(new.indoor_outdoor, ''), payload_indoor_outdoor, 'unknown');
  new.venue_type := coalesce(nullif(new.venue_type, ''), payload_venue_type, 'unknown');
  new.court_kind := coalesce(nullif(new.court_kind, ''), payload_court_kind, 'unknown');
  new.surface_type := coalesce(nullif(new.surface_type, ''), payload_surface_type, 'unknown');
  new.surface_type_raw := coalesce(nullif(new.surface_type_raw, ''), nullif(safe_payload->>'surfaceTypeRaw', ''));
  new.court_layout := coalesce(nullif(new.court_layout, ''), payload_court_layout, 'unknown');
  new.court_layout_raw := coalesce(nullif(new.court_layout_raw, ''), nullif(safe_payload->>'courtLayoutRaw', ''));
  if new.hoop_count is null and coalesce(safe_payload->>'hoopCount', '') ~ '^[0-9]{1,2}$' then
    new.hoop_count := (safe_payload->>'hoopCount')::smallint;
  end if;
  new.access_type := coalesce(nullif(new.access_type, ''), payload_access_type, 'unknown');
  if new.reservation_required is null then
    if jsonb_typeof(safe_payload->'reservationRequired') = 'boolean' then
      new.reservation_required := (safe_payload->>'reservationRequired')::boolean;
    elsif jsonb_typeof(safe_payload->'reservation') = 'boolean' then
      new.reservation_required := (safe_payload->>'reservation')::boolean;
    end if;
  end if;
  if new.paid is null and jsonb_typeof(safe_payload->'paid') = 'boolean' then
    new.paid := (safe_payload->>'paid')::boolean;
  end if;
  if new.lighting is null and jsonb_typeof(safe_payload->'lighting') = 'boolean' then
    new.lighting := (safe_payload->>'lighting')::boolean;
  end if;
  new.public_access := public.rankball_normalize_court_public_access(case
    when safe_payload ? 'publicAccess' then safe_payload->>'publicAccess'
    else new.public_access
  end);
  new.operational_status := coalesce(nullif(new.operational_status, ''), nullif(safe_payload->>'operationalStatus', ''), 'active');
  new.verification_status := coalesce(nullif(new.verification_status, ''), nullif(safe_payload->>'verificationStatus', ''), 'pending');
  new.name_source := coalesce(
    nullif(new.name_source, ''),
    case when safe_payload->>'nameSource' in ('source', 'naver_place', 'manual') then safe_payload->>'nameSource' end,
    case when new.registration_origin = 'public_import' then 'source' else 'manual' end
  );
  new.address_source := coalesce(
    nullif(new.address_source, ''),
    case when safe_payload->>'addressSource' in ('source', 'naver_reverse_geocode', 'manual') then safe_payload->>'addressSource' end,
    case when new.registration_origin = 'public_import' then 'source' else 'manual' end
  );
  if new.source_confidence is null
    and coalesce(safe_payload->>'sourceConfidence', '') ~ '^(0([.][0-9]+)?|1([.]0+)?)$' then
    new.source_confidence := (safe_payload->>'sourceConfidence')::numeric;
  end if;
  new.verified_at := coalesce(new.verified_at, public.rankball_import_safe_timestamptz(safe_payload->>'verifiedAt'));
  new.name_modified_at := coalesce(new.name_modified_at, public.rankball_import_safe_timestamptz(safe_payload->>'nameModifiedAt'));
  new.name_modified_by := coalesce(nullif(new.name_modified_by, ''), nullif(safe_payload->>'nameModifiedBy', ''));
  new.payload := public.rankball_slim_approved_court_payload(safe_payload);
  return new;
end;
$$;

create or replace function public.rankball_sync_court_public_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_payload jsonb := case when jsonb_typeof(new.payload) = 'object' then new.payload else '{}'::jsonb end;
  safe_public_access text;
begin
  if tg_table_name = 'approved_courts' then
    new.public_access := public.rankball_normalize_court_public_access(new.public_access);
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.public_access is distinct from old.public_access
    and safe_payload->>'publicAccess' is not distinct from old.payload->>'publicAccess' then
    safe_public_access := public.rankball_normalize_court_public_access(new.public_access);
  else
    safe_public_access := public.rankball_normalize_court_public_access(
      coalesce(nullif(safe_payload->>'publicAccess', ''), new.public_access)
    );
  end if;
  new.public_access := safe_public_access;
  new.payload := safe_payload || jsonb_build_object('publicAccess', safe_public_access);
  return new;
end;
$$;

create or replace function public.rankball_lock_court_identity_write()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  new_payload jsonb := case when jsonb_typeof(new.payload) = 'object' then new.payload else '{}'::jsonb end;
  old_payload jsonb := '{}'::jsonb;
  new_canonical_name text;
  old_canonical_name text;
  new_court_unit text;
  old_court_unit text;
begin
  if tg_op = 'UPDATE' and jsonb_typeof(old.payload) = 'object' then
    old_payload := old.payload;
  end if;
  if tg_table_name = 'approved_courts' then
    new_canonical_name := new.name;
    old_canonical_name := case when tg_op = 'UPDATE' then old.name else null end;
    new_court_unit := to_jsonb(new)->>'court_unit';
    old_court_unit := case when tg_op = 'UPDATE' then to_jsonb(old)->>'court_unit' else null end;
  else
    new_canonical_name := coalesce(new_payload->>'canonicalBaseName', new_payload->>'baseName', new.name);
    old_canonical_name := case when tg_op = 'UPDATE'
      then coalesce(old_payload->>'canonicalBaseName', old_payload->>'baseName', old.name)
      else null
    end;
    new_court_unit := new_payload->>'courtUnit';
    old_court_unit := case when tg_op = 'UPDATE' then old_payload->>'courtUnit' else null end;
  end if;

  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    new_canonical_name, new_court_unit
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    old_canonical_name, old_court_unit
  ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball:court-identity-write', 0));
  return new;
end;
$$;

create or replace function public.rankball_enforce_court_request_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name);
  court_unit text := nullif(public.rankball_court_name_key(new.payload->>'courtUnit'), '');
  same_location_exists boolean;
begin
  if new.status not in ('pending', 'reported') then return new; end if;
  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    new.payload->>'canonicalBaseName', new.payload->>'courtUnit'
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    old.payload->>'canonicalBaseName', old.payload->>'courtUnit'
  ) then return new; end if;

  select exists (
    select 1 from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
    union all
    select 1 from public.court_requests request
    where request.id <> new.id and request.status in ('pending', 'reported')
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        request.address_text, request.road_address, request.jibun_address, request.lat, request.lng
      )
  ) into same_location_exists;

  if same_location_exists and court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and public.rankball_court_name_key(court.name) = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
  ) then raise exception 'duplicate_approved_court' using errcode = '23505'; end if;
  if exists (
    select 1 from public.court_requests request
    where request.id <> new.id and request.status in ('pending', 'reported')
      and public.rankball_court_name_key(coalesce(request.payload->>'canonicalBaseName', request.payload->>'baseName', request.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        request.address_text, request.road_address, request.jibun_address, request.lat, request.lng
      )
  ) then raise exception 'duplicate_pending_court_request' using errcode = '23505'; end if;
  return new;
end;
$$;

create or replace function public.rankball_enforce_approved_court_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := new.name;
  court_unit text := nullif(public.rankball_court_name_key(new.court_unit), '');
  same_location_exists boolean;
begin
  if coalesce(new.status, 'active') <> 'active' then return new; end if;
  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng, new.court_unit
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng, old.court_unit
  ) then return new; end if;

  select exists (
    select 1 from public.approved_courts court
    where court.id <> new.id and coalesce(court.status, 'active') = 'active'
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
  ) into same_location_exists;
  if same_location_exists and court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.approved_courts court
    where court.id <> new.id and coalesce(court.status, 'active') = 'active'
      and public.rankball_court_name_key(court.name) = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
  ) then raise exception 'court_duplicate' using errcode = '23505'; end if;
  return new;
end;
$$;

create or replace function public.rankball_enforce_legacy_court_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text;
  court_unit text;
  same_location_exists boolean;
begin
  if tg_table_name = 'court_requests' and new.status not in ('pending', 'reported') then return new; end if;
  if tg_table_name = 'approved_courts' and coalesce(new.status, 'active') <> 'active' then return new; end if;
  canonical_name := case when tg_table_name = 'approved_courts'
    then new.name
    else coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name)
  end;
  court_unit := nullif(public.rankball_court_name_key(case when tg_table_name = 'approved_courts'
    then to_jsonb(new)->>'court_unit'
    else new.payload->>'courtUnit'
  end), '');

  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng, canonical_name, court_unit
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    case when tg_table_name = 'approved_courts' then old.name else coalesce(old.payload->>'canonicalBaseName', old.payload->>'baseName', old.name) end,
    nullif(public.rankball_court_name_key(case when tg_table_name = 'approved_courts' then to_jsonb(old)->>'court_unit' else old.payload->>'courtUnit' end), '')
  ) then return new; end if;

  select exists (
    select 1 from public.courts legacy
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
    select 1 from public.courts legacy
    where legacy.id <> new.id
      and public.rankball_court_name_key(coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
      )
  ) then raise exception 'duplicate_legacy_court' using errcode = '23505'; end if;
  return new;
end;
$$;

create or replace function public.rankball_enforce_legacy_court_row_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name);
  court_unit text := nullif(public.rankball_court_name_key(new.payload->>'courtUnit'), '');
  approved_name text;
  approved_court_unit text;
  same_location_exists boolean;
begin
  select name, court_unit into approved_name, approved_court_unit
  from public.approved_courts where id = new.id;
  canonical_name := coalesce(approved_name, canonical_name);
  court_unit := coalesce(nullif(public.rankball_court_name_key(approved_court_unit), ''), court_unit);

  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng, canonical_name, court_unit
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    coalesce(approved_name, old.payload->>'canonicalBaseName', old.payload->>'baseName', old.name),
    coalesce(nullif(public.rankball_court_name_key(approved_court_unit), ''), nullif(public.rankball_court_name_key(old.payload->>'courtUnit'), ''))
  ) then return new; end if;

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
  if same_location_exists and court_unit is null then
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
  ) then raise exception 'court_duplicate' using errcode = '23505'; end if;
  return new;
end;
$$;

create or replace function public.rankball_approved_courts_region_key_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_region text := coalesce(nullif(new.sigungu, ''), nullif(new.sido, ''), nullif(new.emd, ''));
begin
  new.region_key := public.rankball_court_region_key(
    safe_region,
    new.address_text,
    new.road_address,
    new.jibun_address,
    jsonb_strip_nulls(jsonb_build_object('sido', new.sido, 'sigungu', new.sigungu, 'addressDong', new.emd))
  );
  return new;
end;
$$;

create or replace function public.rankball_court_snapshot(
  p_court_id text,
  p_fallback_name text default null,
  p_fallback_region text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  safe_name text := nullif(btrim(p_fallback_name), '');
  safe_region text := nullif(btrim(p_fallback_region), '');
  safe_region_key text := public.rankball_court_region_key(safe_region, null, null, null, '{}'::jsonb);
  legacy_name text;
  legacy_region text;
  approved_id text;
  approved_name text;
  approved_region text;
  approved_region_key text;
  legacy_id text;
  candidate_count integer := 0;
  has_legacy_region boolean := false;
begin
  if safe_court_id is not null then
    if to_regclass('public.courts') is not null then
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'courts' and column_name = 'region'
      ) into has_legacy_region;
      if has_legacy_region then
        execute 'select name, region from public.courts where id = $1 limit 1'
        into legacy_name, legacy_region using safe_court_id;
      else
        execute 'select name from public.courts where id = $1 limit 1'
        into legacy_name using safe_court_id;
      end if;
      safe_name := coalesce(nullif(btrim(legacy_name), ''), safe_name);
      safe_region_key := coalesce(public.rankball_court_region_key(legacy_region, null, null, null, '{}'::jsonb), safe_region_key);
      safe_region := coalesce(safe_region_key, nullif(btrim(legacy_region), ''), safe_region);
    end if;

    select
      nullif(btrim(name), ''),
      coalesce(nullif(btrim(sigungu), ''), nullif(btrim(sido), ''), nullif(btrim(emd), '')),
      coalesce(
        nullif(btrim(region_key), ''),
        public.rankball_court_region_key(
          coalesce(sigungu, sido, emd), address_text, road_address, jibun_address,
          jsonb_strip_nulls(jsonb_build_object('sido', sido, 'sigungu', sigungu, 'addressDong', emd))
        )
      )
    into approved_name, approved_region, approved_region_key
    from public.approved_courts
    where id = safe_court_id and coalesce(status, 'active') = 'active'
    limit 1;
    safe_name := coalesce(safe_name, approved_name);
    safe_region_key := coalesce(safe_region_key, approved_region_key);
    safe_region := coalesce(safe_region_key, approved_region, safe_region);
  end if;

  if safe_court_id is null and safe_name is not null and to_regclass('public.approved_courts') is not null then
    select count(*) into candidate_count
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
      and (safe_region_key is null or coalesce(
        nullif(btrim(court.region_key), ''),
        public.rankball_court_region_key(
          coalesce(court.sigungu, court.sido, court.emd), court.address_text, court.road_address, court.jibun_address,
          jsonb_strip_nulls(jsonb_build_object('sido', court.sido, 'sigungu', court.sigungu, 'addressDong', court.emd))
        )
      ) = safe_region_key);

    if candidate_count = 1 then
      select
        court.id,
        nullif(btrim(court.name), ''),
        coalesce(nullif(btrim(court.sigungu), ''), nullif(btrim(court.sido), ''), nullif(btrim(court.emd), '')),
        coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(
            coalesce(court.sigungu, court.sido, court.emd), court.address_text, court.road_address, court.jibun_address,
            jsonb_strip_nulls(jsonb_build_object('sido', court.sido, 'sigungu', court.sigungu, 'addressDong', court.emd))
          )
        )
      into approved_id, approved_name, approved_region, approved_region_key
      from public.approved_courts court
      where coalesce(court.status, 'active') = 'active'
        and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
        and (safe_region_key is null or coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(
            coalesce(court.sigungu, court.sido, court.emd), court.address_text, court.road_address, court.jibun_address,
            jsonb_strip_nulls(jsonb_build_object('sido', court.sido, 'sigungu', court.sigungu, 'addressDong', court.emd))
          )
        ) = safe_region_key)
      limit 1;
      safe_court_id := approved_id;
      safe_name := coalesce(approved_name, safe_name);
      safe_region_key := coalesce(approved_region_key, safe_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
    end if;
  end if;

  if safe_court_id is null and safe_name is not null and to_regclass('public.courts') is not null then
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'courts' and column_name = 'region'
    ) into has_legacy_region;
    if has_legacy_region then
      execute '
        select count(*) from public.courts court
        where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
          and ($2 is null or public.rankball_court_region_key(court.region, null, null, null, ''{}''::jsonb) = $2)'
      into candidate_count using safe_name, safe_region_key;
      if candidate_count = 1 then
        execute '
          select court.id, court.name, court.region from public.courts court
          where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
            and ($2 is null or public.rankball_court_region_key(court.region, null, null, null, ''{}''::jsonb) = $2)
          limit 1'
        into legacy_id, legacy_name, legacy_region using safe_name, safe_region_key;
      end if;
    else
      execute '
        select count(*) from public.courts court
        where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')'
      into candidate_count using safe_name;
      if candidate_count = 1 then
        execute '
          select court.id, court.name from public.courts court
          where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
          limit 1'
        into legacy_id, legacy_name using safe_name;
      end if;
    end if;
    if legacy_id is not null then
      safe_court_id := legacy_id;
      safe_name := coalesce(nullif(btrim(legacy_name), ''), safe_name);
      safe_region_key := coalesce(public.rankball_court_region_key(legacy_region, null, null, null, '{}'::jsonb), safe_region_key);
      safe_region := coalesce(safe_region_key, nullif(btrim(legacy_region), ''), safe_region);
    end if;
  end if;

  return jsonb_build_object(
    'courtId', safe_court_id,
    'courtName', coalesce(safe_name, '미정'),
    'region', coalesce(safe_region_key, safe_region),
    'regionKey', safe_region_key
  );
end;
$$;

create or replace function public.rankball_mirror_court_payload_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_payload jsonb;
begin
  select payload into approved_payload from public.approved_courts where id = new.id;
  if found then
    new.payload := public.rankball_slim_approved_court_payload(
      coalesce(new.payload, '{}'::jsonb) || coalesce(approved_payload, '{}'::jsonb)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists "00_courts_mirror_payload" on public.courts;
create trigger "00_courts_mirror_payload"
before insert or update of payload on public.courts
for each row execute function public.rankball_mirror_court_payload_guard();

create or replace function public.rankball_sync_approved_court_facility_info()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request_payload jsonb;
  safe_official_url text;
  safe_reservation_url text;
  safe_area numeric;
  safe_area_scope text;
begin
  if nullif(btrim(coalesce(new.source_request_id, '')), '') is null then return new; end if;
  select payload into request_payload from public.court_requests where id = new.source_request_id;
  if not found or jsonb_typeof(request_payload) <> 'object' then return new; end if;

  safe_official_url := coalesce(nullif(btrim(request_payload->>'officialUrl'), ''), nullif(btrim(request_payload->>'sourceUrl'), ''));
  if safe_official_url !~ '^https://' then safe_official_url := null; end if;
  safe_reservation_url := nullif(btrim(request_payload->>'reservationUrl'), '');
  if safe_reservation_url !~ '^https://' then safe_reservation_url := null; end if;
  safe_area := public.rankball_import_safe_double(request_payload->>'facilityAreaSqm');
  if safe_area is not null and safe_area <= 0 then safe_area := null; end if;
  safe_area_scope := case when request_payload->>'facilityAreaScope' in ('court', 'facility', 'unknown')
    then request_payload->>'facilityAreaScope' else null end;

  insert into public.court_facility_info (
    court_id, operator_name, contact_phone, official_url, reservation_url,
    opening_hours_text, application_method, access_note, detail_address,
    location_note, facility_area_sqm, facility_area_scope, created_at, updated_at
  ) values (
    new.id,
    coalesce(nullif(btrim(request_payload->>'operatorName'), ''), nullif(btrim(request_payload->>'operator'), '')),
    coalesce(nullif(btrim(request_payload->>'contactPhone'), ''), nullif(btrim(request_payload->>'phone'), '')),
    safe_official_url,
    safe_reservation_url,
    nullif(btrim(request_payload->>'openingHoursText'), ''),
    nullif(btrim(request_payload->>'applicationMethod'), ''),
    nullif(btrim(request_payload->>'accessNote'), ''),
    nullif(btrim(request_payload->>'detailAddress'), ''),
    nullif(btrim(request_payload->>'locationNote'), ''),
    safe_area,
    safe_area_scope,
    now(),
    now()
  )
  on conflict (court_id) do update set
    operator_name = coalesce(excluded.operator_name, court_facility_info.operator_name),
    contact_phone = coalesce(excluded.contact_phone, court_facility_info.contact_phone),
    official_url = coalesce(excluded.official_url, court_facility_info.official_url),
    reservation_url = coalesce(excluded.reservation_url, court_facility_info.reservation_url),
    opening_hours_text = coalesce(excluded.opening_hours_text, court_facility_info.opening_hours_text),
    application_method = coalesce(excluded.application_method, court_facility_info.application_method),
    access_note = coalesce(excluded.access_note, court_facility_info.access_note),
    detail_address = coalesce(excluded.detail_address, court_facility_info.detail_address),
    location_note = coalesce(excluded.location_note, court_facility_info.location_note),
    facility_area_sqm = coalesce(excluded.facility_area_sqm, court_facility_info.facility_area_sqm),
    facility_area_scope = coalesce(excluded.facility_area_scope, court_facility_info.facility_area_scope),
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists approved_courts_sync_facility_info on public.approved_courts;
create trigger approved_courts_sync_facility_info
after insert or update of source_request_id on public.approved_courts
for each row execute function public.rankball_sync_approved_court_facility_info();

create or replace function public.rankball_admin_rename_court(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_court_id text,
  p_facility_name text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row public.approved_courts%rowtype;
  actor_name text;
  safe_facility text;
  safe_reason text := btrim(coalesce(p_reason, ''));
  previous_name text;
  next_name text;
  now_ts timestamptz := clock_timestamp();
  log_id text;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_court_id, '')), '') is null then
    raise exception 'court_id_required' using errcode = '22023';
  end if;
  if char_length(safe_reason) < 4 or char_length(safe_reason) > 160 then
    raise exception 'court_rename_reason_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball:court-rename:' || p_court_id, 0));
  select * into court_row from public.approved_courts where id = p_court_id for update;
  if not found then raise exception 'court_not_found' using errcode = 'P0002'; end if;
  previous_name := court_row.name;
  safe_facility := public.rankball_court_facility_base(p_facility_name, court_row.sigungu, court_row.court_unit);
  if safe_facility is null or char_length(safe_facility) > 120 then
    raise exception 'court_facility_name_invalid' using errcode = '22023';
  end if;
  next_name := public.rankball_standard_court_name(
    court_row.sigungu, safe_facility, court_row.court_unit, court_row.address_text,
    court_row.sido, coalesce(court_row.sigungu, court_row.sido, court_row.emd)
  );
  if next_name is null then raise exception 'court_sigungu_and_facility_required' using errcode = '22023'; end if;
  if next_name = court_row.name then raise exception 'court_name_unchanged' using errcode = '22023'; end if;

  select coalesce(nullif(name, ''), p_actor_profile_id) into actor_name
  from public.profiles where id = p_actor_profile_id;
  actor_name := coalesce(actor_name, p_actor_profile_id, '관리자');

  update public.approved_courts
  set facility_name = safe_facility,
      name = next_name,
      name_source = 'manual',
      name_modified_at = now_ts,
      name_modified_by = p_actor_profile_id,
      updated_at = now_ts
  where id = court_row.id
  returning * into court_row;

  update public.matches set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;
  update public.recruiting_posts set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;
  update public.tournaments set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;
  update public.court_reviews set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;

  log_id := 'court_name_' || md5(court_row.id || now_ts::text || p_actor_profile_id);
  insert into public.court_name_change_log (
    id, court_id, sigungu, previous_name, new_name, facility_name, reason,
    changed_by, changed_by_name, change_source, created_at
  ) values (
    log_id, court_row.id, court_row.sigungu, previous_name, court_row.name,
    safe_facility, safe_reason, p_actor_profile_id, actor_name, 'admin', now_ts
  );
  insert into public.admin_audit_log (
    id, type, status, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5('court-name-change:' || court_row.id || now_ts::text),
    'court_name_change', 'committed', null, p_actor_profile_id,
    jsonb_build_object(
      'courtId', court_row.id,
      'previousName', previous_name,
      'newName', court_row.name,
      'facilityName', safe_facility,
      'reason', safe_reason
    ),
    now_ts
  );
  return jsonb_build_object(
    'ok', true,
    'court', jsonb_build_object(
      'id', court_row.id,
      'name', court_row.name,
      'facilityName', court_row.facility_name,
      'courtUnit', court_row.court_unit,
      'sido', court_row.sido,
      'sigungu', court_row.sigungu,
      'nameModifiedAt', court_row.name_modified_at,
      'nameModifiedBy', court_row.name_modified_by,
      'updatedAt', court_row.updated_at
    )
  );
end;
$$;

select set_config('rankball.court_bulk_standardization', 'on', true);
select set_config('rankball.public_import_validated', 'on', true);

update public.approved_courts
set payload = payload;

update public.courts legacy
set payload = legacy.payload
where exists (select 1 from public.approved_courts approved where approved.id = legacy.id);

update public.approved_courts
set source_request_id = source_request_id
where source_request_id is not null;

revoke all on function public.rankball_slim_approved_court_payload(jsonb) from public, anon, authenticated;
revoke all on function public.rankball_mirror_court_payload_guard() from public, anon, authenticated;
revoke all on function public.rankball_sync_approved_court_facility_info() from public, anon, authenticated;
grant execute on function public.rankball_slim_approved_court_payload(jsonb) to service_role;
grant execute on function public.rankball_admin_rename_court(text, integer, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
