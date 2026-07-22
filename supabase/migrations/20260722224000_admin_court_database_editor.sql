create or replace view public.rankball_admin_court_database
with (security_invoker = true)
as
select
  court.name,
  court.facility_name,
  court.court_unit,
  court.indoor_outdoor,
  court.venue_type,
  court.court_kind,
  court.surface_type,
  court.court_layout,
  court.hoop_count,
  court.access_type,
  court.reservation_required,
  court.paid,
  court.lighting,
  court.public_access,
  court.operational_status,
  court.verification_status,
  court.sido,
  court.sigungu,
  court.emd,
  court.name_modification_count,
  court.registration_origin,
  court.status,
  greatest(court.updated_at, coalesce(facility.updated_at, court.updated_at)) as updated_at,
  court.id,
  court.hashtag,
  court.address_text,
  court.road_address,
  court.jibun_address,
  court.zonecode,
  court.lat,
  court.lng,
  facility.operator_name,
  facility.contact_phone,
  facility.official_url,
  facility.reservation_url,
  facility.opening_hours_text,
  facility.application_method,
  facility.access_note,
  facility.detail_address,
  facility.location_note,
  facility.facility_area_sqm,
  facility.facility_area_scope
from public.approved_courts court
left join public.court_facility_info facility on facility.court_id = court.id;

revoke all on table public.rankball_admin_court_database from public, anon, authenticated;
grant select on table public.rankball_admin_court_database to service_role;

create or replace function public.rankball_admin_update_court(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_court_id text,
  p_patch jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row public.approved_courts%rowtype;
  facility_row public.court_facility_info%rowtype;
  actor_name text;
  safe_reason text := btrim(coalesce(p_reason, ''));
  now_ts timestamptz := clock_timestamp();
  before_snapshot jsonb;
  after_snapshot jsonb;
  changes jsonb := '{}'::jsonb;
  invalid_keys text[];
  field_name text;
  max_length integer;
  previous_name text;
  previous_name_modified_at timestamptz;
  previous_name_modified_by text;
  desired_lat double precision;
  desired_lng double precision;
  desired_hoop_count integer;
  desired_area numeric;
  desired_number numeric;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_court_id, '')), '') is null then
    raise exception 'court_id_required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb or pg_column_size(p_patch) > 32768 then
    raise exception 'court_patch_invalid' using errcode = '22023';
  end if;
  if char_length(safe_reason) < 4 or char_length(safe_reason) > 160 then
    raise exception 'court_update_reason_required' using errcode = '22023';
  end if;

  select array_agg(key order by key)
  into invalid_keys
  from jsonb_object_keys(p_patch) key
  where key <> all (array[
    'facilityName', 'courtUnit', 'indoorOutdoor', 'venueType', 'courtKind',
    'surfaceType', 'courtLayout', 'hoopCount', 'accessType',
    'reservationRequired', 'paid', 'lighting', 'publicAccess',
    'operationalStatus', 'verificationStatus', 'sido', 'sigungu', 'emd',
    'status', 'hashtag', 'addressText', 'roadAddress', 'jibunAddress',
    'zonecode', 'lat', 'lng', 'operatorName', 'contactPhone', 'officialUrl',
    'reservationUrl', 'openingHoursText', 'applicationMethod', 'accessNote',
    'detailAddress', 'locationNote', 'facilityAreaSqm', 'facilityAreaScope'
  ]);
  if invalid_keys is not null then
    raise exception 'court_patch_key_invalid:%', array_to_string(invalid_keys, ',') using errcode = '22023';
  end if;

  for field_name, max_length in
    select * from (values
      ('facilityName', 120), ('courtUnit', 80), ('sido', 80), ('sigungu', 80),
      ('emd', 80), ('hashtag', 80), ('addressText', 300), ('roadAddress', 300),
      ('jibunAddress', 300), ('zonecode', 20), ('operatorName', 160),
      ('contactPhone', 80), ('officialUrl', 2048), ('reservationUrl', 2048),
      ('openingHoursText', 500), ('applicationMethod', 500), ('accessNote', 500),
      ('detailAddress', 300), ('locationNote', 500)
    ) fields(name, limit_value)
  loop
    if p_patch ? field_name then
      if p_patch -> field_name <> 'null'::jsonb and jsonb_typeof(p_patch -> field_name) <> 'string' then
        raise exception 'court_patch_text_invalid:%', field_name using errcode = '22023';
      end if;
      if char_length(btrim(coalesce(p_patch ->> field_name, ''))) > max_length then
        raise exception 'court_patch_text_too_long:%', field_name using errcode = '22023';
      end if;
    end if;
  end loop;

  if p_patch ? 'facilityName' and nullif(btrim(coalesce(p_patch ->> 'facilityName', '')), '') is null then
    raise exception 'court_facility_name_required' using errcode = '22023';
  end if;
  if p_patch ? 'addressText' and nullif(btrim(coalesce(p_patch ->> 'addressText', '')), '') is null then
    raise exception 'court_address_required' using errcode = '22023';
  end if;
  if p_patch ? 'officialUrl'
    and nullif(btrim(coalesce(p_patch ->> 'officialUrl', '')), '') is not null
    and btrim(p_patch ->> 'officialUrl') !~ '^https://' then
    raise exception 'court_official_url_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'reservationUrl'
    and nullif(btrim(coalesce(p_patch ->> 'reservationUrl', '')), '') is not null
    and btrim(p_patch ->> 'reservationUrl') !~ '^https://' then
    raise exception 'court_reservation_url_invalid' using errcode = '22023';
  end if;

  if p_patch ? 'indoorOutdoor'
    and coalesce(p_patch ->> 'indoorOutdoor', '') not in ('', 'outdoor', 'indoor', 'mixed', 'unknown') then
    raise exception 'court_indoor_outdoor_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'venueType'
    and coalesce(p_patch ->> 'venueType', '') not in ('', 'park', 'sports_facility', 'public_facility', 'school', 'apartment', 'unknown') then
    raise exception 'court_venue_type_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'courtKind'
    and coalesce(p_patch ->> 'courtKind', '') not in ('', 'official', 'street_hoop', 'unknown') then
    raise exception 'court_kind_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'surfaceType'
    and coalesce(p_patch ->> 'surfaceType', '') not in ('', 'asphalt', 'urethane', 'dirt', 'indoor_wood', 'indoor_synthetic', 'unknown') then
    raise exception 'court_surface_type_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'courtLayout'
    and coalesce(p_patch ->> 'courtLayout', '') not in ('', 'full', 'half', 'single_hoop', 'unknown') then
    raise exception 'court_layout_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'accessType'
    and coalesce(p_patch ->> 'accessType', '') not in ('', 'walk_in', 'reservation', 'restricted', 'unknown') then
    raise exception 'court_access_type_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'publicAccess' and coalesce(p_patch ->> 'publicAccess', '') not in ('public', 'private', 'unknown') then
    raise exception 'court_public_access_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'operationalStatus' and coalesce(p_patch ->> 'operationalStatus', '') not in ('active', 'pending', 'closed', 'unknown') then
    raise exception 'court_operational_status_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'verificationStatus' and coalesce(p_patch ->> 'verificationStatus', '') not in ('pending', 'source_verified', 'verified', 'review_required') then
    raise exception 'court_verification_status_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'status' and coalesce(p_patch ->> 'status', '') not in ('active', 'hidden', 'disabled') then
    raise exception 'court_status_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'facilityAreaScope'
    and coalesce(p_patch ->> 'facilityAreaScope', '') not in ('', 'court', 'facility', 'unknown') then
    raise exception 'court_facility_area_scope_invalid' using errcode = '22023';
  end if;

  foreach field_name in array array['reservationRequired', 'paid', 'lighting']
  loop
    if p_patch ? field_name
      and p_patch -> field_name <> 'null'::jsonb
      and jsonb_typeof(p_patch -> field_name) <> 'boolean' then
      raise exception 'court_patch_boolean_invalid:%', field_name using errcode = '22023';
    end if;
  end loop;

  foreach field_name in array array['hoopCount', 'lat', 'lng', 'facilityAreaSqm']
  loop
    if p_patch ? field_name
      and p_patch -> field_name <> 'null'::jsonb
      and jsonb_typeof(p_patch -> field_name) <> 'number' then
      raise exception 'court_patch_number_invalid:%', field_name using errcode = '22023';
    end if;
  end loop;

  if p_patch ? 'hoopCount' and p_patch -> 'hoopCount' <> 'null'::jsonb then
    desired_number := (p_patch ->> 'hoopCount')::numeric;
    if desired_number < 1 or desired_number > 100 or trunc(desired_number) <> desired_number then
      raise exception 'court_hoop_count_invalid' using errcode = '22023';
    end if;
    desired_hoop_count := desired_number::integer;
  end if;
  if p_patch ? 'facilityAreaSqm' and p_patch -> 'facilityAreaSqm' <> 'null'::jsonb then
    desired_area := (p_patch ->> 'facilityAreaSqm')::numeric;
    if desired_area <= 0 then
      raise exception 'court_facility_area_invalid' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball:court-admin-update:' || p_court_id, 0));
  select * into court_row
  from public.approved_courts
  where id = p_court_id
  for update;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;
  select * into facility_row
  from public.court_facility_info
  where court_id = p_court_id
  for update;

  previous_name := court_row.name;
  previous_name_modified_at := court_row.name_modified_at;
  previous_name_modified_by := court_row.name_modified_by;
  desired_lat := case
    when p_patch ? 'lat' then case when p_patch -> 'lat' = 'null'::jsonb then null else (p_patch ->> 'lat')::double precision end
    else court_row.lat
  end;
  desired_lng := case
    when p_patch ? 'lng' then case when p_patch -> 'lng' = 'null'::jsonb then null else (p_patch ->> 'lng')::double precision end
    else court_row.lng
  end;
  if (desired_lat is null) <> (desired_lng is null)
    or (desired_lat is not null and (desired_lat < -90 or desired_lat > 90))
    or (desired_lng is not null and (desired_lng < -180 or desired_lng > 180)) then
    raise exception 'court_coordinates_invalid' using errcode = '22023';
  end if;

  before_snapshot := jsonb_build_object(
    'name', court_row.name,
    'facilityName', court_row.facility_name,
    'courtUnit', court_row.court_unit,
    'indoorOutdoor', court_row.indoor_outdoor,
    'venueType', court_row.venue_type,
    'courtKind', court_row.court_kind,
    'surfaceType', court_row.surface_type,
    'courtLayout', court_row.court_layout,
    'hoopCount', court_row.hoop_count,
    'accessType', court_row.access_type,
    'reservationRequired', court_row.reservation_required,
    'paid', court_row.paid,
    'lighting', court_row.lighting,
    'publicAccess', court_row.public_access,
    'operationalStatus', court_row.operational_status,
    'verificationStatus', court_row.verification_status,
    'sido', court_row.sido,
    'sigungu', court_row.sigungu,
    'emd', court_row.emd,
    'status', court_row.status,
    'hashtag', court_row.hashtag,
    'addressText', court_row.address_text,
    'roadAddress', court_row.road_address,
    'jibunAddress', court_row.jibun_address,
    'zonecode', court_row.zonecode,
    'lat', court_row.lat,
    'lng', court_row.lng,
    'operatorName', facility_row.operator_name,
    'contactPhone', facility_row.contact_phone,
    'officialUrl', facility_row.official_url,
    'reservationUrl', facility_row.reservation_url,
    'openingHoursText', facility_row.opening_hours_text,
    'applicationMethod', facility_row.application_method,
    'accessNote', facility_row.access_note,
    'detailAddress', facility_row.detail_address,
    'locationNote', facility_row.location_note,
    'facilityAreaSqm', facility_row.facility_area_sqm,
    'facilityAreaScope', facility_row.facility_area_scope
  );

  if p_patch ?| array[
    'facilityName', 'courtUnit', 'indoorOutdoor', 'venueType', 'courtKind',
    'surfaceType', 'courtLayout', 'hoopCount', 'accessType',
    'reservationRequired', 'paid', 'lighting', 'publicAccess',
    'operationalStatus', 'verificationStatus', 'sido', 'sigungu', 'emd',
    'status', 'hashtag', 'addressText', 'roadAddress', 'jibunAddress',
    'zonecode', 'lat', 'lng'
  ] then
    update public.approved_courts
    set facility_name = case when p_patch ? 'facilityName' then nullif(btrim(p_patch ->> 'facilityName'), '') else facility_name end,
      court_unit = case when p_patch ? 'courtUnit' then nullif(btrim(p_patch ->> 'courtUnit'), '') else court_unit end,
      indoor_outdoor = case when p_patch ? 'indoorOutdoor' then nullif(p_patch ->> 'indoorOutdoor', '') else indoor_outdoor end,
      venue_type = case when p_patch ? 'venueType' then nullif(p_patch ->> 'venueType', '') else venue_type end,
      court_kind = case when p_patch ? 'courtKind' then nullif(p_patch ->> 'courtKind', '') else court_kind end,
      surface_type = case when p_patch ? 'surfaceType' then nullif(p_patch ->> 'surfaceType', '') else surface_type end,
      court_layout = case when p_patch ? 'courtLayout' then nullif(p_patch ->> 'courtLayout', '') else court_layout end,
      hoop_count = case when p_patch ? 'hoopCount' then desired_hoop_count else hoop_count end,
      access_type = case when p_patch ? 'accessType' then nullif(p_patch ->> 'accessType', '') else access_type end,
      reservation_required = case when p_patch ? 'reservationRequired' then case when p_patch -> 'reservationRequired' = 'null'::jsonb then null else (p_patch ->> 'reservationRequired')::boolean end else reservation_required end,
      paid = case when p_patch ? 'paid' then case when p_patch -> 'paid' = 'null'::jsonb then null else (p_patch ->> 'paid')::boolean end else paid end,
      lighting = case when p_patch ? 'lighting' then case when p_patch -> 'lighting' = 'null'::jsonb then null else (p_patch ->> 'lighting')::boolean end else lighting end,
      public_access = case when p_patch ? 'publicAccess' then p_patch ->> 'publicAccess' else public_access end,
      operational_status = case when p_patch ? 'operationalStatus' then p_patch ->> 'operationalStatus' else operational_status end,
      verification_status = case when p_patch ? 'verificationStatus' then p_patch ->> 'verificationStatus' else verification_status end,
      verified_at = case when p_patch ->> 'verificationStatus' = 'verified' then now_ts else verified_at end,
      sido = case when p_patch ? 'sido' then nullif(btrim(p_patch ->> 'sido'), '') else sido end,
      sigungu = case when p_patch ? 'sigungu' then nullif(btrim(p_patch ->> 'sigungu'), '') else sigungu end,
      emd = case when p_patch ? 'emd' then nullif(btrim(p_patch ->> 'emd'), '') else emd end,
      status = case when p_patch ? 'status' then p_patch ->> 'status' else status end,
      hidden_at = case when p_patch ? 'status' then case when p_patch ->> 'status' = 'active' then null else now_ts end else hidden_at end,
      hidden_by = case when p_patch ? 'status' then case when p_patch ->> 'status' = 'active' then null else p_actor_profile_id end else hidden_by end,
      hidden_reason = case when p_patch ? 'status' then case when p_patch ->> 'status' = 'active' then null else safe_reason end else hidden_reason end,
      hashtag = case when p_patch ? 'hashtag' then nullif(btrim(p_patch ->> 'hashtag'), '') else hashtag end,
      address_text = case when p_patch ? 'addressText' then btrim(p_patch ->> 'addressText') else address_text end,
      road_address = case when p_patch ? 'roadAddress' then nullif(btrim(p_patch ->> 'roadAddress'), '') else road_address end,
      jibun_address = case when p_patch ? 'jibunAddress' then nullif(btrim(p_patch ->> 'jibunAddress'), '') else jibun_address end,
      zonecode = case when p_patch ? 'zonecode' then nullif(btrim(p_patch ->> 'zonecode'), '') else zonecode end,
      lat = desired_lat,
      lng = desired_lng,
      name_source = case when p_patch ?| array['facilityName', 'courtUnit', 'sido', 'sigungu', 'emd'] then 'manual' else name_source end,
      address_source = case when p_patch ?| array['addressText', 'roadAddress', 'jibunAddress', 'zonecode', 'lat', 'lng'] then 'manual' else address_source end,
        updated_at = now_ts
    where id = p_court_id
    returning * into court_row;
  end if;

  if court_row.name is distinct from previous_name then
    update public.approved_courts
    set name_modified_at = now_ts,
        name_modified_by = p_actor_profile_id,
        name_modification_count = name_modification_count + 1,
        name_source = 'manual'
    where id = p_court_id
    returning * into court_row;
  else
    court_row.name_modified_at := previous_name_modified_at;
    court_row.name_modified_by := previous_name_modified_by;
  end if;

  if p_patch ?| array[
    'operatorName', 'contactPhone', 'officialUrl', 'reservationUrl',
    'openingHoursText', 'applicationMethod', 'accessNote', 'detailAddress',
    'locationNote', 'facilityAreaSqm', 'facilityAreaScope'
  ] then
    insert into public.court_facility_info (
      court_id, operator_name, contact_phone, official_url, reservation_url,
      opening_hours_text, application_method, access_note, detail_address,
      location_note, facility_area_sqm, facility_area_scope, created_at, updated_at
    ) values (
      p_court_id,
      case when p_patch ? 'operatorName' then nullif(btrim(p_patch ->> 'operatorName'), '') else facility_row.operator_name end,
      case when p_patch ? 'contactPhone' then nullif(btrim(p_patch ->> 'contactPhone'), '') else facility_row.contact_phone end,
      case when p_patch ? 'officialUrl' then nullif(btrim(p_patch ->> 'officialUrl'), '') else facility_row.official_url end,
      case when p_patch ? 'reservationUrl' then nullif(btrim(p_patch ->> 'reservationUrl'), '') else facility_row.reservation_url end,
      case when p_patch ? 'openingHoursText' then nullif(btrim(p_patch ->> 'openingHoursText'), '') else facility_row.opening_hours_text end,
      case when p_patch ? 'applicationMethod' then nullif(btrim(p_patch ->> 'applicationMethod'), '') else facility_row.application_method end,
      case when p_patch ? 'accessNote' then nullif(btrim(p_patch ->> 'accessNote'), '') else facility_row.access_note end,
      case when p_patch ? 'detailAddress' then nullif(btrim(p_patch ->> 'detailAddress'), '') else facility_row.detail_address end,
      case when p_patch ? 'locationNote' then nullif(btrim(p_patch ->> 'locationNote'), '') else facility_row.location_note end,
      case when p_patch ? 'facilityAreaSqm' then desired_area else facility_row.facility_area_sqm end,
      case when p_patch ? 'facilityAreaScope' then nullif(p_patch ->> 'facilityAreaScope', '') else facility_row.facility_area_scope end,
      now_ts,
      now_ts
    )
    on conflict (court_id) do update
    set operator_name = excluded.operator_name,
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
        updated_at = now_ts;
  end if;

  select * into facility_row from public.court_facility_info where court_id = p_court_id;
  after_snapshot := jsonb_build_object(
    'name', court_row.name,
    'facilityName', court_row.facility_name,
    'courtUnit', court_row.court_unit,
    'indoorOutdoor', court_row.indoor_outdoor,
    'venueType', court_row.venue_type,
    'courtKind', court_row.court_kind,
    'surfaceType', court_row.surface_type,
    'courtLayout', court_row.court_layout,
    'hoopCount', court_row.hoop_count,
    'accessType', court_row.access_type,
    'reservationRequired', court_row.reservation_required,
    'paid', court_row.paid,
    'lighting', court_row.lighting,
    'publicAccess', court_row.public_access,
    'operationalStatus', court_row.operational_status,
    'verificationStatus', court_row.verification_status,
    'sido', court_row.sido,
    'sigungu', court_row.sigungu,
    'emd', court_row.emd,
    'status', court_row.status,
    'hashtag', court_row.hashtag,
    'addressText', court_row.address_text,
    'roadAddress', court_row.road_address,
    'jibunAddress', court_row.jibun_address,
    'zonecode', court_row.zonecode,
    'lat', court_row.lat,
    'lng', court_row.lng,
    'operatorName', facility_row.operator_name,
    'contactPhone', facility_row.contact_phone,
    'officialUrl', facility_row.official_url,
    'reservationUrl', facility_row.reservation_url,
    'openingHoursText', facility_row.opening_hours_text,
    'applicationMethod', facility_row.application_method,
    'accessNote', facility_row.access_note,
    'detailAddress', facility_row.detail_address,
    'locationNote', facility_row.location_note,
    'facilityAreaSqm', facility_row.facility_area_sqm,
    'facilityAreaScope', facility_row.facility_area_scope
  );

  for field_name in
    select key from jsonb_object_keys(after_snapshot) key order by key
  loop
    if before_snapshot -> field_name is distinct from after_snapshot -> field_name then
      changes := changes || jsonb_build_object(
        field_name,
        jsonb_build_object('before', before_snapshot -> field_name, 'after', after_snapshot -> field_name)
      );
    end if;
  end loop;
  if changes = '{}'::jsonb then
    raise exception 'court_patch_unchanged' using errcode = '22023';
  end if;

  select coalesce(nullif(name, ''), p_actor_profile_id)
  into actor_name
  from public.profiles
  where id = p_actor_profile_id;
  actor_name := coalesce(actor_name, p_actor_profile_id, '관리자');

  if court_row.name is distinct from previous_name then
    update public.matches set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;
    update public.recruiting_posts set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;
    update public.tournaments set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;
    update public.court_reviews set court_name = court_row.name where court_id = court_row.id and court_name is distinct from court_row.name;

    insert into public.court_name_change_log (
      id, court_id, sigungu, previous_name, new_name, facility_name, reason,
      changed_by, changed_by_name, change_source, created_at
    ) values (
      'court_name_' || md5(court_row.id || now_ts::text || p_actor_profile_id),
      court_row.id, court_row.sigungu, previous_name, court_row.name,
      court_row.facility_name, safe_reason, p_actor_profile_id, actor_name, 'admin', now_ts
    );
  end if;

  insert into public.admin_audit_log (
    id, type, status, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5('court-database-update:' || court_row.id || now_ts::text || p_actor_profile_id),
    'court_database_update', 'committed', null, p_actor_profile_id,
    jsonb_build_object(
      'courtId', court_row.id,
      'sigungu', court_row.sigungu,
      'actorName', actor_name,
      'reason', safe_reason,
      'changes', changes
    ),
    now_ts
  );

  return jsonb_build_object(
    'ok', true,
    'court', after_snapshot || jsonb_build_object(
      'id', court_row.id,
      'nameModificationCount', court_row.name_modification_count,
      'updatedAt', court_row.updated_at
    ),
    'changedFields', (select jsonb_agg(key order by key) from jsonb_object_keys(changes) key)
  );
end;
$$;

revoke all on function public.rankball_admin_update_court(text, integer, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.rankball_admin_update_court(text, integer, text, jsonb, text) to service_role;

create or replace view public.rankball_admin_court_change_history
with (security_invoker = true)
as
select
  history.id,
  history.court_id,
  history.sigungu,
  history.changed_by,
  history.changed_by_name,
  history.change_source,
  'name'::text as changed_fields,
  jsonb_build_object(
    'name', jsonb_build_object('before', to_jsonb(history.previous_name), 'after', to_jsonb(history.new_name))
  ) as changes,
  concat_ws(' ', history.previous_name, history.new_name) as changes_text,
  history.reason,
  history.created_at
from public.court_name_change_log history
where not exists (
  select 1
  from public.admin_audit_log audit
  where audit.type = 'court_database_update'
    and audit.created_at = history.created_at
    and audit.payload ->> 'courtId' = history.court_id
)
union all
select
  audit.id,
  audit.payload ->> 'courtId' as court_id,
  audit.payload ->> 'sigungu' as sigungu,
  audit.created_by as changed_by,
  coalesce(audit.payload ->> 'actorName', audit.created_by) as changed_by_name,
  'admin'::text as change_source,
  coalesce((
    select string_agg(key, ', ' order by key)
    from jsonb_object_keys(coalesce(audit.payload -> 'changes', '{}'::jsonb)) key
  ), '') as changed_fields,
  coalesce(audit.payload -> 'changes', '{}'::jsonb) as changes,
  coalesce(audit.payload -> 'changes', '{}'::jsonb)::text as changes_text,
  audit.payload ->> 'reason' as reason,
  audit.created_at
from public.admin_audit_log audit
where audit.type = 'court_database_update';

revoke all on table public.rankball_admin_court_change_history from public, anon, authenticated;
grant select on table public.rankball_admin_court_change_history to service_role;

select pg_notify('pgrst', 'reload schema');
