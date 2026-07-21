alter table public.approved_courts
  add column if not exists registration_origin text not null default 'user_request',
  add column if not exists facility_name text,
  add column if not exists court_unit text,
  add column if not exists sido text,
  add column if not exists sigungu text,
  add column if not exists emd text,
  add column if not exists indoor_outdoor text,
  add column if not exists venue_type text,
  add column if not exists court_kind text,
  add column if not exists surface_type text,
  add column if not exists surface_type_raw text,
  add column if not exists court_layout text,
  add column if not exists court_layout_raw text,
  add column if not exists hoop_count smallint,
  add column if not exists access_type text,
  add column if not exists reservation_required boolean,
  add column if not exists paid boolean,
  add column if not exists lighting boolean,
  add column if not exists operational_status text not null default 'active',
  add column if not exists verification_status text not null default 'pending',
  add column if not exists name_source text,
  add column if not exists address_source text,
  add column if not exists source_confidence numeric(4, 3),
  add column if not exists verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_courts_registration_origin_check'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_registration_origin_check
      check (registration_origin in ('user_request', 'public_import', 'system')) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_courts_import_attributes_check'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_import_attributes_check
      check (
        (indoor_outdoor is null or indoor_outdoor in ('outdoor', 'indoor', 'mixed', 'unknown'))
        and (venue_type is null or venue_type in ('park', 'sports_facility', 'public_facility', 'school', 'apartment', 'unknown'))
        and (court_kind is null or court_kind in ('official', 'street_hoop', 'unknown'))
        and (surface_type is null or surface_type in ('asphalt', 'urethane', 'dirt', 'indoor_wood', 'indoor_synthetic', 'unknown'))
        and (court_layout is null or court_layout in ('full', 'half', 'single_hoop', 'unknown'))
        and (access_type is null or access_type in ('walk_in', 'reservation', 'restricted', 'unknown'))
        and (operational_status in ('active', 'pending', 'closed', 'unknown'))
        and (verification_status in ('pending', 'source_verified', 'verified', 'review_required'))
        and (name_source is null or name_source in ('source', 'naver_place', 'manual'))
        and (address_source is null or address_source in ('source', 'naver_reverse_geocode', 'manual'))
        and (hoop_count is null or hoop_count between 1 and 100)
        and (source_confidence is null or source_confidence between 0 and 1)
      ) not valid;
  end if;
end;
$$;

create index if not exists approved_courts_import_origin_idx
on public.approved_courts (registration_origin, verification_status, status);

create index if not exists approved_courts_admin_region_idx
on public.approved_courts (sido, sigungu, operational_status, status);

create table if not exists public.court_facility_info (
  court_id text primary key references public.approved_courts(id),
  operator_name text,
  contact_phone text,
  official_url text,
  reservation_url text,
  opening_hours_text text,
  application_method text,
  access_note text,
  detail_address text,
  location_note text,
  facility_area_sqm numeric(14, 2),
  facility_area_scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_facility_info_urls_check check (
    (official_url is null or official_url ~ '^https://')
    and (reservation_url is null or reservation_url ~ '^https://')
  ),
  constraint court_facility_info_area_check check (
    facility_area_sqm is null or facility_area_sqm > 0
  ),
  constraint court_facility_info_area_scope_check check (
    facility_area_scope is null or facility_area_scope in ('court', 'facility', 'unknown')
  )
);

create table if not exists public.court_source_records (
  id text primary key,
  court_id text not null references public.approved_courts(id),
  provider text not null,
  dataset_id text,
  source_record_id text not null,
  source_url text,
  source_license text,
  source_reference_date date,
  source_registered_at timestamptz,
  source_updated_at timestamptz,
  confidence numeric(4, 3),
  external_facility_code text,
  source_metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_source_records_provider_record_unique unique (provider, source_record_id),
  constraint court_source_records_confidence_check check (confidence is null or confidence between 0 and 1),
  constraint court_source_records_url_check check (source_url is null or source_url ~ '^https?://')
);

create index if not exists court_source_records_court_id_idx
on public.court_source_records (court_id, provider);

create table if not exists public.court_import_batches (
  id text primary key,
  source_file text not null,
  source_sha256 text not null,
  status text not null default 'applying',
  row_count integer not null default 0,
  applied_count integer not null default 0,
  blocked_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_import_batches_source_sha256_check check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint court_import_batches_status_check check (status in ('applying', 'applied', 'failed')),
  constraint court_import_batches_counts_check check (
    row_count >= 0 and applied_count >= 0 and blocked_count >= 0
  )
);

create table if not exists public.court_import_rows (
  batch_id text not null references public.court_import_batches(id),
  row_number integer not null,
  court_id text not null,
  import_key text not null,
  disposition text not null,
  issue_codes jsonb not null default '[]'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  source_payload jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (batch_id, row_number),
  constraint court_import_rows_batch_key_unique unique (batch_id, import_key),
  constraint court_import_rows_import_key_check check (import_key ~ '^[0-9a-f]{64}$')
);

create index if not exists court_import_rows_court_id_idx
on public.court_import_rows (court_id, batch_id);

alter table public.court_facility_info enable row level security;
alter table public.court_source_records enable row level security;
alter table public.court_import_batches enable row level security;
alter table public.court_import_rows enable row level security;

drop policy if exists court_facility_info_select_active on public.court_facility_info;
create policy court_facility_info_select_active
on public.court_facility_info
for select
to authenticated
using (
  public.current_is_admin(30)
  or exists (
    select 1
    from public.approved_courts court
    where court.id = court_facility_info.court_id
      and coalesce(court.status, 'active') = 'active'
  )
);

revoke all on table public.court_facility_info from public;
revoke all on table public.court_facility_info from anon;
revoke all on table public.court_facility_info from authenticated;
grant select on table public.court_facility_info to authenticated;
grant select, insert, update, delete on table public.court_facility_info to service_role;

revoke all on table public.court_source_records from public;
revoke all on table public.court_source_records from anon;
revoke all on table public.court_source_records from authenticated;
grant select, insert, update, delete on table public.court_source_records to service_role;

revoke all on table public.court_import_batches from public;
revoke all on table public.court_import_batches from anon;
revoke all on table public.court_import_batches from authenticated;
grant select, insert, update, delete on table public.court_import_batches to service_role;

revoke all on table public.court_import_rows from public;
revoke all on table public.court_import_rows from anon;
revoke all on table public.court_import_rows from authenticated;
grant select, insert, update, delete on table public.court_import_rows to service_role;

create or replace function public.rankball_import_safe_double(raw_value text)
returns double precision
language plpgsql
immutable
as $$
begin
  if nullif(btrim(raw_value), '') is null then
    return null;
  end if;
  return btrim(raw_value)::double precision;
exception when others then
  return null;
end;
$$;

create or replace function public.rankball_import_safe_integer(raw_value text)
returns integer
language plpgsql
immutable
as $$
begin
  if nullif(btrim(raw_value), '') is null then
    return null;
  end if;
  return btrim(raw_value)::integer;
exception when others then
  return null;
end;
$$;

create or replace function public.rankball_import_safe_date(raw_value text)
returns date
language plpgsql
immutable
as $$
begin
  if nullif(btrim(raw_value), '') is null then
    return null;
  end if;
  return btrim(raw_value)::date;
exception when others then
  return null;
end;
$$;

create or replace function public.rankball_import_safe_timestamptz(raw_value text)
returns timestamptz
language plpgsql
stable
as $$
begin
  if nullif(btrim(raw_value), '') is null then
    return null;
  end if;
  return btrim(raw_value)::timestamptz;
exception when others then
  return null;
end;
$$;

revoke all on function public.rankball_import_safe_double(text) from public;
revoke all on function public.rankball_import_safe_double(text) from anon;
revoke all on function public.rankball_import_safe_double(text) from authenticated;
grant execute on function public.rankball_import_safe_double(text) to service_role;

revoke all on function public.rankball_import_safe_integer(text) from public;
revoke all on function public.rankball_import_safe_integer(text) from anon;
revoke all on function public.rankball_import_safe_integer(text) from authenticated;
grant execute on function public.rankball_import_safe_integer(text) to service_role;

revoke all on function public.rankball_import_safe_date(text) from public;
revoke all on function public.rankball_import_safe_date(text) from anon;
revoke all on function public.rankball_import_safe_date(text) from authenticated;
grant execute on function public.rankball_import_safe_date(text) to service_role;

revoke all on function public.rankball_import_safe_timestamptz(text) from public;
revoke all on function public.rankball_import_safe_timestamptz(text) from anon;
revoke all on function public.rankball_import_safe_timestamptz(text) from authenticated;
grant execute on function public.rankball_import_safe_timestamptz(text) to service_role;

create or replace function public.rankball_import_public_courts(
  p_batch_id text,
  p_source_file text,
  p_source_sha256 text,
  p_rows jsonb,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_batch_id text := nullif(btrim(p_batch_id), '');
  safe_source_file text := nullif(btrim(p_source_file), '');
  safe_source_sha256 text := lower(nullif(btrim(p_source_sha256), ''));
  row_count integer;
  ready_count integer := 0;
  blocked_count integer := 0;
  safe_applied_count integer := 0;
  item jsonb;
  court jsonb;
  facility_info jsonb;
  source_item jsonb;
  row_errors jsonb;
  duplicate_matches jsonb;
  result_rows jsonb := '[]'::jsonb;
  safe_row_number integer;
  safe_import_key text;
  safe_id text;
  safe_name text;
  safe_hashtag text;
  safe_address_text text;
  safe_road_address text;
  safe_jibun_address text;
  safe_zonecode text;
  safe_lat double precision;
  safe_lng double precision;
  safe_facility_name text;
  safe_court_unit text;
  safe_sido text;
  safe_sigungu text;
  safe_emd text;
  safe_indoor_outdoor text;
  safe_venue_type text;
  safe_court_kind text;
  safe_surface_type text;
  safe_surface_type_raw text;
  safe_court_layout text;
  safe_court_layout_raw text;
  safe_hoop_count integer;
  safe_access_type text;
  safe_reservation_required boolean;
  safe_paid boolean;
  safe_lighting boolean;
  safe_operational_status text;
  safe_verification_status text;
  safe_name_source text;
  safe_address_source text;
  safe_source_confidence double precision;
  safe_verified_at timestamptz;
  safe_geocode_verified boolean;
  safe_multiple_courts_verified boolean;
  safe_payload jsonb;
  safe_region_key text;
  safe_region text;
  safe_type text;
  safe_source_id text;
  safe_source_provider text;
  safe_source_record_id text;
begin
  if safe_batch_id is null or char_length(safe_batch_id) > 160 then
    raise exception 'invalid_public_court_import_batch_id' using errcode = '22023';
  end if;
  if safe_source_file is null or char_length(safe_source_file) > 500 then
    raise exception 'invalid_public_court_import_source_file' using errcode = '22023';
  end if;
  if safe_source_sha256 is null or safe_source_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_public_court_import_source_sha256' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'public_court_import_rows_must_be_array' using errcode = '22023';
  end if;

  row_count := jsonb_array_length(p_rows);
  if row_count < 1 or row_count > 50 then
    raise exception 'public_court_import_batch_size_out_of_range' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_item
    group by nullif(btrim(row_item->'court'->>'id'), '')
    having nullif(btrim(row_item->'court'->>'id'), '') is not null and count(*) > 1
  ) then
    raise exception 'duplicate_court_id_in_import_batch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) row_item
    group by nullif(btrim(row_item->>'importKey'), '')
    having nullif(btrim(row_item->>'importKey'), '') is not null and count(*) > 1
  ) then
    raise exception 'duplicate_import_key_in_import_batch' using errcode = '22023';
  end if;

  if coalesce(p_apply, false) then
    perform pg_advisory_xact_lock(hashtextextended('rankball:court-identity-write', 0));
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    court := coalesce(item->'court', '{}'::jsonb);
    facility_info := coalesce(item->'facilityInfo', '{}'::jsonb);
    row_errors := '[]'::jsonb;
    duplicate_matches := '[]'::jsonb;
    safe_row_number := public.rankball_import_safe_integer(item->>'rowNumber');
    safe_import_key := lower(nullif(btrim(item->>'importKey'), ''));
    safe_id := nullif(btrim(court->>'id'), '');
    safe_name := public.rankball_normalize_court_name(court->>'name');
    safe_hashtag := nullif(btrim(court->>'hashtag'), '');
    safe_address_text := nullif(btrim(court->>'addressText'), '');
    safe_road_address := nullif(btrim(court->>'roadAddress'), '');
    safe_jibun_address := nullif(btrim(court->>'jibunAddress'), '');
    safe_zonecode := nullif(btrim(court->>'zonecode'), '');
    safe_lat := public.rankball_import_safe_double(court->>'lat');
    safe_lng := public.rankball_import_safe_double(court->>'lng');
    safe_facility_name := public.rankball_normalize_court_name(coalesce(court->>'facilityName', safe_name));
    safe_court_unit := public.rankball_normalize_court_name(court->>'courtUnit');
    safe_sido := nullif(btrim(court->>'sido'), '');
    safe_sigungu := nullif(btrim(court->>'sigungu'), '');
    safe_emd := nullif(btrim(court->>'emd'), '');
    safe_indoor_outdoor := coalesce(nullif(btrim(court->>'indoorOutdoor'), ''), 'unknown');
    safe_venue_type := coalesce(nullif(btrim(court->>'venueType'), ''), 'unknown');
    safe_court_kind := coalesce(nullif(btrim(court->>'courtKind'), ''), 'unknown');
    safe_surface_type := coalesce(nullif(btrim(court->>'surfaceType'), ''), 'unknown');
    safe_surface_type_raw := nullif(btrim(court->>'surfaceTypeRaw'), '');
    safe_court_layout := coalesce(nullif(btrim(court->>'courtLayout'), ''), 'unknown');
    safe_court_layout_raw := nullif(btrim(court->>'courtLayoutRaw'), '');
    safe_hoop_count := public.rankball_import_safe_integer(court->>'hoopCount');
    safe_access_type := coalesce(nullif(btrim(court->>'accessType'), ''), 'unknown');
    safe_reservation_required := case when jsonb_typeof(court->'reservationRequired') = 'boolean' then (court->>'reservationRequired')::boolean else null end;
    safe_paid := case when jsonb_typeof(court->'paid') = 'boolean' then (court->>'paid')::boolean else null end;
    safe_lighting := case when jsonb_typeof(court->'lighting') = 'boolean' then (court->>'lighting')::boolean else null end;
    safe_operational_status := coalesce(nullif(btrim(court->>'operationalStatus'), ''), 'unknown');
    safe_verification_status := coalesce(nullif(btrim(court->>'verificationStatus'), ''), 'pending');
    safe_name_source := nullif(btrim(court->>'nameSource'), '');
    safe_address_source := nullif(btrim(court->>'addressSource'), '');
    safe_source_confidence := public.rankball_import_safe_double(court->>'sourceConfidence');
    safe_verified_at := public.rankball_import_safe_timestamptz(court->>'verifiedAt');
    safe_geocode_verified := case when jsonb_typeof(court->'geocodeVerified') = 'boolean' then (court->>'geocodeVerified')::boolean else false end;
    safe_multiple_courts_verified := case when jsonb_typeof(court->'multipleCourtsVerified') = 'boolean' then (court->>'multipleCourtsVerified')::boolean else false end;

    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(court) is distinct from 'object' then
      row_errors := row_errors || jsonb_build_array('invalid_row_shape');
    end if;
    if coalesce(item->>'disposition', '') <> 'ready' then
      row_errors := row_errors || jsonb_build_array('row_not_ready');
    end if;
    if safe_row_number is null or safe_row_number < 2 then
      row_errors := row_errors || jsonb_build_array('invalid_row_number');
    end if;
    if safe_import_key is null or safe_import_key !~ '^[0-9a-f]{64}$' then
      row_errors := row_errors || jsonb_build_array('invalid_import_key');
    end if;
    if safe_id is null or char_length(safe_id) > 160 or safe_id !~ '^court_[a-zA-Z0-9_-]+$' then
      row_errors := row_errors || jsonb_build_array('invalid_court_id');
    end if;
    if safe_name is null or char_length(safe_name) > 200 then
      row_errors := row_errors || jsonb_build_array('invalid_court_name');
    elsif public.rankball_court_name_key(safe_name) in ('농구장', '농구코트')
      or safe_name ~ '^이름[[:space:]]*없는[[:space:]]*농구장' then
      row_errors := row_errors || jsonb_build_array('unresolved_court_name');
    end if;
    if safe_hashtag is null or safe_hashtag !~ '^#[0-9]{5}$' then
      row_errors := row_errors || jsonb_build_array('invalid_court_hashtag');
    end if;
    if safe_address_text is null or char_length(safe_address_text) > 500 then
      row_errors := row_errors || jsonb_build_array('invalid_court_address');
    end if;
    if safe_lat is null or safe_lng is null or safe_lat < 33 or safe_lat > 39.5 or safe_lng < 124 or safe_lng > 132 then
      row_errors := row_errors || jsonb_build_array('invalid_korea_coordinate');
    end if;
    if safe_sido is null then
      row_errors := row_errors || jsonb_build_array('missing_reverse_geocoded_sido');
    end if;
    if safe_address_source <> 'naver_reverse_geocode' or safe_geocode_verified is not true then
      row_errors := row_errors || jsonb_build_array('reverse_geocode_required');
    end if;
    if safe_verification_status not in ('source_verified', 'verified') or safe_verified_at is null then
      row_errors := row_errors || jsonb_build_array('source_verification_required');
    end if;
    if safe_name_source is null or safe_name_source not in ('source', 'naver_place', 'manual') then
      row_errors := row_errors || jsonb_build_array('invalid_name_source');
    end if;
    if safe_operational_status <> 'active' then
      row_errors := row_errors || jsonb_build_array('inactive_source_row');
    end if;
    if safe_indoor_outdoor not in ('outdoor', 'indoor', 'mixed', 'unknown')
      or safe_venue_type not in ('park', 'sports_facility', 'public_facility', 'school', 'apartment', 'unknown')
      or safe_court_kind not in ('official', 'street_hoop', 'unknown')
      or safe_surface_type not in ('asphalt', 'urethane', 'dirt', 'indoor_wood', 'indoor_synthetic', 'unknown')
      or safe_court_layout not in ('full', 'half', 'single_hoop', 'unknown')
      or safe_access_type not in ('walk_in', 'reservation', 'restricted', 'unknown') then
      row_errors := row_errors || jsonb_build_array('invalid_court_attribute');
    end if;
    if safe_hoop_count is not null and (safe_hoop_count < 1 or safe_hoop_count > 100) then
      row_errors := row_errors || jsonb_build_array('invalid_hoop_count');
    end if;
    if safe_source_confidence is not null and (safe_source_confidence < 0 or safe_source_confidence > 1) then
      row_errors := row_errors || jsonb_build_array('invalid_source_confidence');
    end if;
    if jsonb_typeof(facility_info) is distinct from 'object' then
      row_errors := row_errors || jsonb_build_array('invalid_facility_info');
    end if;
    if nullif(btrim(facility_info->>'officialUrl'), '') is not null
      and (facility_info->>'officialUrl') !~ '^https://' then
      row_errors := row_errors || jsonb_build_array('invalid_official_url');
    end if;
    if nullif(btrim(facility_info->>'reservationUrl'), '') is not null
      and (facility_info->>'reservationUrl') !~ '^https://' then
      row_errors := row_errors || jsonb_build_array('invalid_reservation_url');
    end if;
    if public.rankball_import_safe_double(facility_info->>'facilityAreaSqm') is not null
      and public.rankball_import_safe_double(facility_info->>'facilityAreaSqm') <= 0 then
      row_errors := row_errors || jsonb_build_array('invalid_facility_area');
    end if;
    if nullif(btrim(facility_info->>'facilityAreaScope'), '') is not null
      and (facility_info->>'facilityAreaScope') not in ('court', 'facility', 'unknown') then
      row_errors := row_errors || jsonb_build_array('invalid_facility_area_scope');
    end if;
    if jsonb_typeof(item->'sources') is distinct from 'array' then
      row_errors := row_errors || jsonb_build_array('source_record_required');
    elsif jsonb_array_length(item->'sources') < 1 then
      row_errors := row_errors || jsonb_build_array('source_record_required');
    else
      for source_item in select value from jsonb_array_elements(item->'sources')
      loop
        safe_source_id := nullif(btrim(source_item->>'id'), '');
        safe_source_provider := nullif(btrim(source_item->>'provider'), '');
        safe_source_record_id := nullif(btrim(source_item->>'sourceRecordId'), '');
        if jsonb_typeof(source_item) is distinct from 'object'
          or safe_source_id is null
          or safe_source_provider is null
          or safe_source_record_id is null then
          row_errors := row_errors || jsonb_build_array('invalid_source_record');
        end if;
        if nullif(btrim(source_item->>'sourceUrl'), '') is not null
          and (source_item->>'sourceUrl') !~ '^https?://' then
          row_errors := row_errors || jsonb_build_array('invalid_source_url');
        end if;
        if exists (
          select 1
          from public.court_source_records existing_source
          where existing_source.provider = safe_source_provider
            and existing_source.source_record_id = safe_source_record_id
            and existing_source.court_id <> safe_id
        ) then
          row_errors := row_errors || jsonb_build_array('source_record_owned_by_other_court');
        end if;
      end loop;
    end if;

    if safe_id is not null and exists (
      select 1
      from public.approved_courts existing
      where existing.id = safe_id
        and (
          coalesce(existing.registration_origin, 'user_request') <> 'public_import'
          or coalesce(existing.payload->>'publicImportKey', '') <> safe_import_key
        )
    ) then
      row_errors := row_errors || jsonb_build_array('court_id_owned_by_other_record');
    end if;

    if safe_hashtag is not null and exists (
      select 1
      from public.approved_courts existing
      where existing.id <> safe_id
        and lower(coalesce(existing.hashtag, '')) = lower(safe_hashtag)
    ) then
      row_errors := row_errors || jsonb_build_array('court_hashtag_conflict');
    end if;

    if safe_id is not null and safe_name is not null and safe_lat is not null and safe_lng is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'kind', match_row.kind,
        'id', match_row.id,
        'name', match_row.name
      )), '[]'::jsonb)
      into duplicate_matches
      from (
        select
          'approved'::text as kind,
          existing.id,
          existing.name,
          coalesce(existing.payload->>'canonicalBaseName', existing.payload->>'baseName', existing.name) as canonical_name,
          existing.address_text,
          existing.road_address,
          existing.jibun_address,
          existing.lat,
          existing.lng
        from public.approved_courts existing
        where existing.id <> safe_id
          and coalesce(existing.status, 'active') = 'active'
        union all
        select
          'request'::text,
          request.id,
          request.name,
          coalesce(request.payload->>'canonicalBaseName', request.payload->>'baseName', request.name),
          request.address_text,
          request.road_address,
          request.jibun_address,
          request.lat,
          request.lng
        from public.court_requests request
        where request.id <> safe_id
          and request.status in ('pending', 'reported')
        union all
        select
          'legacy'::text,
          legacy.id,
          legacy.name,
          coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name),
          legacy.address_text,
          legacy.road_address,
          legacy.jibun_address,
          legacy.lat,
          legacy.lng
        from public.courts legacy
        where legacy.id <> safe_id
          and not exists (
            select 1 from public.approved_courts mirrored where mirrored.id = legacy.id
          )
      ) match_row
      where public.rankball_same_court_location(
        safe_address_text, safe_road_address, safe_jibun_address, safe_lat, safe_lng,
        match_row.address_text, match_row.road_address, match_row.jibun_address, match_row.lat, match_row.lng
      );

      if exists (
        select 1
        from (
          select coalesce(existing.payload->>'canonicalBaseName', existing.payload->>'baseName', existing.name) canonical_name
          from public.approved_courts existing
          where existing.id <> safe_id
            and coalesce(existing.status, 'active') = 'active'
            and public.rankball_same_court_location(
              safe_address_text, safe_road_address, safe_jibun_address, safe_lat, safe_lng,
              existing.address_text, existing.road_address, existing.jibun_address, existing.lat, existing.lng
            )
          union all
          select coalesce(request.payload->>'canonicalBaseName', request.payload->>'baseName', request.name)
          from public.court_requests request
          where request.id <> safe_id
            and request.status in ('pending', 'reported')
            and public.rankball_same_court_location(
              safe_address_text, safe_road_address, safe_jibun_address, safe_lat, safe_lng,
              request.address_text, request.road_address, request.jibun_address, request.lat, request.lng
            )
          union all
          select coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name)
          from public.courts legacy
          where legacy.id <> safe_id
            and not exists (
              select 1 from public.approved_courts mirrored where mirrored.id = legacy.id
            )
            and public.rankball_same_court_location(
              safe_address_text, safe_road_address, safe_jibun_address, safe_lat, safe_lng,
              legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
            )
        ) same_name
        where public.rankball_court_name_key(same_name.canonical_name) = public.rankball_court_name_key(safe_name)
      ) then
        row_errors := row_errors || jsonb_build_array('duplicate_existing_court');
      elsif jsonb_array_length(duplicate_matches) > 0
        and (
          safe_court_unit is null
          or safe_multiple_courts_verified is not true
        ) then
        row_errors := row_errors || jsonb_build_array('shared_location_review_required');
      end if;
    end if;

    if jsonb_array_length(row_errors) = 0 then
      ready_count := ready_count + 1;
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'rowNumber', safe_row_number,
        'courtId', safe_id,
        'status', 'ready',
        'errors', '[]'::jsonb,
        'matches', duplicate_matches
      ));
    else
      blocked_count := blocked_count + 1;
      result_rows := result_rows || jsonb_build_array(jsonb_build_object(
        'rowNumber', safe_row_number,
        'courtId', safe_id,
        'status', 'blocked',
        'errors', row_errors,
        'matches', duplicate_matches
      ));
    end if;
  end loop;

  if not coalesce(p_apply, false) then
    return jsonb_build_object(
      'ok', blocked_count = 0,
      'mode', 'preview',
      'batchId', safe_batch_id,
      'rowCount', row_count,
      'readyCount', ready_count,
      'blockedCount', blocked_count,
      'rows', result_rows
    );
  end if;

  if blocked_count > 0 then
    raise exception 'public_court_import_validation_failed:%', result_rows using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.court_import_batches batch
    where batch.id = safe_batch_id
      and batch.source_sha256 <> safe_source_sha256
  ) then
    raise exception 'public_court_import_batch_source_conflict' using errcode = '23505';
  end if;

  insert into public.court_import_batches (
    id, source_file, source_sha256, status, row_count, applied_count,
    blocked_count, summary, started_at, completed_at, created_at, updated_at
  ) values (
    safe_batch_id, safe_source_file, safe_source_sha256, 'applying', row_count, 0,
    0, jsonb_build_object('requestedRows', row_count), now_ts, null, now_ts, now_ts
  )
  on conflict (id) do update set
    source_file = excluded.source_file,
    status = 'applying',
    row_count = excluded.row_count,
    applied_count = 0,
    blocked_count = 0,
    summary = excluded.summary,
    started_at = now_ts,
    completed_at = null,
    updated_at = now_ts;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    court := item->'court';
    facility_info := coalesce(item->'facilityInfo', '{}'::jsonb);
    safe_row_number := public.rankball_import_safe_integer(item->>'rowNumber');
    safe_import_key := lower(btrim(item->>'importKey'));
    safe_id := btrim(court->>'id');
    safe_name := public.rankball_normalize_court_name(court->>'name');
    safe_hashtag := btrim(court->>'hashtag');
    safe_address_text := btrim(court->>'addressText');
    safe_road_address := nullif(btrim(court->>'roadAddress'), '');
    safe_jibun_address := nullif(btrim(court->>'jibunAddress'), '');
    safe_zonecode := nullif(btrim(court->>'zonecode'), '');
    safe_lat := public.rankball_import_safe_double(court->>'lat');
    safe_lng := public.rankball_import_safe_double(court->>'lng');
    safe_facility_name := public.rankball_normalize_court_name(coalesce(court->>'facilityName', safe_name));
    safe_court_unit := public.rankball_normalize_court_name(court->>'courtUnit');
    safe_sido := nullif(btrim(court->>'sido'), '');
    safe_sigungu := nullif(btrim(court->>'sigungu'), '');
    safe_emd := nullif(btrim(court->>'emd'), '');
    safe_indoor_outdoor := coalesce(nullif(btrim(court->>'indoorOutdoor'), ''), 'unknown');
    safe_venue_type := coalesce(nullif(btrim(court->>'venueType'), ''), 'unknown');
    safe_court_kind := coalesce(nullif(btrim(court->>'courtKind'), ''), 'unknown');
    safe_surface_type := coalesce(nullif(btrim(court->>'surfaceType'), ''), 'unknown');
    safe_surface_type_raw := nullif(btrim(court->>'surfaceTypeRaw'), '');
    safe_court_layout := coalesce(nullif(btrim(court->>'courtLayout'), ''), 'unknown');
    safe_court_layout_raw := nullif(btrim(court->>'courtLayoutRaw'), '');
    safe_hoop_count := public.rankball_import_safe_integer(court->>'hoopCount');
    safe_access_type := coalesce(nullif(btrim(court->>'accessType'), ''), 'unknown');
    safe_reservation_required := case when jsonb_typeof(court->'reservationRequired') = 'boolean' then (court->>'reservationRequired')::boolean else null end;
    safe_paid := case when jsonb_typeof(court->'paid') = 'boolean' then (court->>'paid')::boolean else null end;
    safe_lighting := case when jsonb_typeof(court->'lighting') = 'boolean' then (court->>'lighting')::boolean else null end;
    safe_operational_status := btrim(court->>'operationalStatus');
    safe_verification_status := btrim(court->>'verificationStatus');
    safe_name_source := btrim(court->>'nameSource');
    safe_address_source := btrim(court->>'addressSource');
    safe_source_confidence := public.rankball_import_safe_double(court->>'sourceConfidence');
    safe_verified_at := public.rankball_import_safe_timestamptz(court->>'verifiedAt');
    safe_type := case
      when safe_indoor_outdoor = 'outdoor' then '야외'
      when safe_indoor_outdoor = 'indoor' then '실내'
      else '확인 필요'
    end;
    safe_region := coalesce(safe_sigungu, safe_sido, 'unknown');
    safe_payload := coalesce(court->'payload', '{}'::jsonb) || jsonb_build_object(
      'id', safe_id,
      'name', safe_name,
      'baseName', safe_facility_name,
      'facilityName', safe_facility_name,
      'courtUnit', safe_court_unit,
      'canonicalBaseName', safe_name,
      'hashtag', safe_hashtag,
      'region', safe_region,
      'addressDong', safe_emd,
      'addressText', safe_address_text,
      'roadAddress', safe_road_address,
      'jibunAddress', safe_jibun_address,
      'zonecode', safe_zonecode,
      'lat', safe_lat,
      'lng', safe_lng,
      'type', safe_type,
      'courtKind', safe_court_kind,
      'surfaceType', safe_surface_type,
      'courtLayout', safe_court_layout,
      'accessType', safe_access_type,
      'reservation', safe_reservation_required,
      'paid', safe_paid,
      'lighting', safe_lighting,
      'registrationOrigin', 'public_import',
      'verificationStatus', safe_verification_status,
      'nameSource', safe_name_source,
      'addressSource', safe_address_source,
      'publicImportBatchId', safe_batch_id,
      'publicImportKey', safe_import_key,
      'publicImportSourceFile', safe_source_file,
      'publicImportSourceSha256', safe_source_sha256,
      'updatedAt', now_ts
    );
    safe_region_key := coalesce(
      nullif(btrim(court->>'regionKey'), ''),
      public.rankball_court_region_key(safe_region, safe_address_text, safe_road_address, safe_jibun_address, safe_payload)
    );

    insert into public.approved_courts (
      id, source_request_id, approved_by, status, name, hashtag, address_text,
      road_address, jibun_address, zonecode, lat, lng, region_key, payload,
      approved_at, created_at, updated_at, registration_origin, facility_name,
      court_unit, sido, sigungu, emd, indoor_outdoor, venue_type, court_kind,
      surface_type, surface_type_raw, court_layout, court_layout_raw, hoop_count,
      access_type, reservation_required, paid, lighting, operational_status,
      verification_status, name_source, address_source, source_confidence, verified_at
    ) values (
      safe_id, null, null, 'active', safe_name, safe_hashtag, safe_address_text,
      safe_road_address, safe_jibun_address, safe_zonecode, safe_lat, safe_lng,
      safe_region_key, safe_payload, now_ts, now_ts, now_ts, 'public_import',
      safe_facility_name, safe_court_unit, safe_sido, safe_sigungu, safe_emd,
      safe_indoor_outdoor, safe_venue_type, safe_court_kind, safe_surface_type,
      safe_surface_type_raw, safe_court_layout, safe_court_layout_raw,
      safe_hoop_count, safe_access_type, safe_reservation_required, safe_paid,
      safe_lighting, safe_operational_status, safe_verification_status,
      safe_name_source, safe_address_source, safe_source_confidence, safe_verified_at
    )
    on conflict (id) do update set
      status = 'active',
      name = excluded.name,
      hashtag = excluded.hashtag,
      address_text = excluded.address_text,
      road_address = excluded.road_address,
      jibun_address = excluded.jibun_address,
      zonecode = excluded.zonecode,
      lat = excluded.lat,
      lng = excluded.lng,
      region_key = excluded.region_key,
      payload = excluded.payload,
      approved_at = excluded.approved_at,
      updated_at = excluded.updated_at,
      registration_origin = excluded.registration_origin,
      facility_name = excluded.facility_name,
      court_unit = excluded.court_unit,
      sido = excluded.sido,
      sigungu = excluded.sigungu,
      emd = excluded.emd,
      indoor_outdoor = excluded.indoor_outdoor,
      venue_type = excluded.venue_type,
      court_kind = excluded.court_kind,
      surface_type = excluded.surface_type,
      surface_type_raw = excluded.surface_type_raw,
      court_layout = excluded.court_layout,
      court_layout_raw = excluded.court_layout_raw,
      hoop_count = excluded.hoop_count,
      access_type = excluded.access_type,
      reservation_required = excluded.reservation_required,
      paid = excluded.paid,
      lighting = excluded.lighting,
      operational_status = excluded.operational_status,
      verification_status = excluded.verification_status,
      name_source = excluded.name_source,
      address_source = excluded.address_source,
      source_confidence = excluded.source_confidence,
      verified_at = excluded.verified_at;

    if to_regclass('public.courts') is not null then
      execute $legacy$
        insert into public.courts (
          id, name, region, type, region_key, address_text, road_address,
          jibun_address, lat, lng, payload, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        on conflict (id) do update set
          name = excluded.name,
          region = excluded.region,
          type = excluded.type,
          region_key = excluded.region_key,
          address_text = excluded.address_text,
          road_address = excluded.road_address,
          jibun_address = excluded.jibun_address,
          lat = excluded.lat,
          lng = excluded.lng,
          payload = excluded.payload
      $legacy$
      using safe_id, safe_name, safe_region, safe_type, safe_region_key,
        safe_address_text, safe_road_address, safe_jibun_address, safe_lat,
        safe_lng, safe_payload, now_ts;
    end if;

    insert into public.court_facility_info (
      court_id, operator_name, contact_phone, official_url, reservation_url,
      opening_hours_text, application_method, access_note, detail_address,
      location_note, facility_area_sqm, facility_area_scope, created_at, updated_at
    ) values (
      safe_id,
      nullif(btrim(facility_info->>'operatorName'), ''),
      nullif(btrim(facility_info->>'contactPhone'), ''),
      nullif(btrim(facility_info->>'officialUrl'), ''),
      nullif(btrim(facility_info->>'reservationUrl'), ''),
      nullif(btrim(facility_info->>'openingHoursText'), ''),
      nullif(btrim(facility_info->>'applicationMethod'), ''),
      nullif(btrim(facility_info->>'accessNote'), ''),
      nullif(btrim(facility_info->>'detailAddress'), ''),
      nullif(btrim(facility_info->>'locationNote'), ''),
      public.rankball_import_safe_double(facility_info->>'facilityAreaSqm'),
      nullif(btrim(facility_info->>'facilityAreaScope'), ''),
      now_ts,
      now_ts
    )
    on conflict (court_id) do update set
      operator_name = excluded.operator_name,
      contact_phone = excluded.contact_phone,
      official_url = excluded.official_url,
      reservation_url = excluded.reservation_url,
      opening_hours_text = excluded.opening_hours_text,
      application_method = excluded.application_method,
      access_note = excluded.access_note,
      detail_address = excluded.detail_address,
      location_note = excluded.location_note,
      facility_area_sqm = excluded.facility_area_sqm,
      facility_area_scope = excluded.facility_area_scope,
      updated_at = excluded.updated_at;

    for source_item in select value from jsonb_array_elements(item->'sources')
    loop
      insert into public.court_source_records (
        id, court_id, provider, dataset_id, source_record_id, source_url,
        source_license, source_reference_date, source_registered_at,
        source_updated_at, confidence, external_facility_code, source_metadata,
        raw_payload, imported_at, updated_at
      ) values (
        btrim(source_item->>'id'),
        safe_id,
        btrim(source_item->>'provider'),
        nullif(btrim(source_item->>'datasetId'), ''),
        btrim(source_item->>'sourceRecordId'),
        nullif(btrim(source_item->>'sourceUrl'), ''),
        nullif(btrim(source_item->>'sourceLicense'), ''),
        public.rankball_import_safe_date(source_item->>'sourceReferenceDate'),
        public.rankball_import_safe_timestamptz(source_item->>'sourceRegisteredAt'),
        public.rankball_import_safe_timestamptz(source_item->>'sourceUpdatedAt'),
        public.rankball_import_safe_double(source_item->>'confidence'),
        nullif(btrim(source_item->>'externalFacilityCode'), ''),
        coalesce(source_item->'sourceMetadata', '{}'::jsonb),
        coalesce(source_item->'rawPayload', '{}'::jsonb),
        now_ts,
        now_ts
      )
      on conflict (provider, source_record_id) do update set
        court_id = excluded.court_id,
        dataset_id = excluded.dataset_id,
        source_url = excluded.source_url,
        source_license = excluded.source_license,
        source_reference_date = excluded.source_reference_date,
        source_registered_at = excluded.source_registered_at,
        source_updated_at = excluded.source_updated_at,
        confidence = excluded.confidence,
        external_facility_code = excluded.external_facility_code,
        source_metadata = excluded.source_metadata,
        raw_payload = excluded.raw_payload,
        updated_at = excluded.updated_at;
    end loop;

    insert into public.court_import_rows (
      batch_id, row_number, court_id, import_key, disposition, issue_codes,
      normalized_payload, source_payload, applied_at, created_at, updated_at
    ) values (
      safe_batch_id, safe_row_number, safe_id, safe_import_key, 'ready',
      coalesce(item->'issues', '[]'::jsonb), item - 'rawPayload',
      coalesce(item->'rawPayload', '{}'::jsonb), now_ts, now_ts, now_ts
    )
    on conflict (batch_id, row_number) do update set
      court_id = excluded.court_id,
      import_key = excluded.import_key,
      disposition = excluded.disposition,
      issue_codes = excluded.issue_codes,
      normalized_payload = excluded.normalized_payload,
      source_payload = excluded.source_payload,
      applied_at = excluded.applied_at,
      updated_at = excluded.updated_at;

    safe_applied_count := safe_applied_count + 1;
  end loop;

  update public.court_import_batches
  set
    status = 'applied',
    applied_count = safe_applied_count,
    blocked_count = 0,
    summary = jsonb_build_object('requestedRows', row_count, 'appliedRows', safe_applied_count),
    completed_at = now_ts,
    updated_at = now_ts
  where id = safe_batch_id;

  return jsonb_build_object(
    'ok', true,
    'mode', 'apply',
    'batchId', safe_batch_id,
    'rowCount', row_count,
    'readyCount', row_count,
    'blockedCount', 0,
    'appliedCount', safe_applied_count,
    'rows', result_rows
  );
end;
$$;

revoke all on function public.rankball_import_public_courts(text, text, text, jsonb, boolean) from public;
revoke all on function public.rankball_import_public_courts(text, text, text, jsonb, boolean) from anon;
revoke all on function public.rankball_import_public_courts(text, text, text, jsonb, boolean) from authenticated;
grant execute on function public.rankball_import_public_courts(text, text, text, jsonb, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
