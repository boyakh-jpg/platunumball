create or replace function public.rankball_normalize_court_name(raw_name text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(btrim(coalesce(raw_name, '')), '[[:space:]]+', ' ', 'g'), '');
$$;

create or replace function public.rankball_court_name_key(raw_name text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(public.rankball_normalize_court_name(raw_name), ''), '[[:space:][:punct:]]+', '', 'g'));
$$;

create or replace function public.rankball_submit_court_request(
  actor_profile_id text,
  request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_id text := nullif(btrim(request_payload->>'id'), '');
  safe_facility_name text := public.rankball_normalize_court_name(coalesce(
    nullif(request_payload->>'buildingName', ''),
    nullif(request_payload->>'facilityName', ''),
    nullif(request_payload->>'baseName', ''),
    request_payload->>'name'
  ));
  safe_court_unit text := public.rankball_normalize_court_name(request_payload->>'courtUnit');
  safe_address_dong text := public.rankball_normalize_court_name(request_payload->>'addressDong');
  safe_name text;
  canonical_base_name text;
  safe_hashtag text := nullif(btrim(request_payload->>'hashtag'), '');
  safe_address_text text := nullif(btrim(request_payload->>'addressText'), '');
  safe_road_address text := nullif(btrim(request_payload->>'roadAddress'), '');
  safe_jibun_address text := nullif(btrim(request_payload->>'jibunAddress'), '');
  safe_zonecode text := nullif(btrim(request_payload->>'zonecode'), '');
  safe_lat double precision := nullif(request_payload->>'lat', '')::double precision;
  safe_lng double precision := nullif(request_payload->>'lng', '')::double precision;
  identity_address text;
  actor_trust integer := 0;
  same_location_count integer := 0;
  has_name_collision boolean := false;
  location_label text;
  safe_payload jsonb;
begin
  if actor_profile_id is null or btrim(actor_profile_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;

  if safe_id is null then
    safe_id := 'cr_' || md5(actor_profile_id || now_ts::text || random()::text);
  end if;

  if safe_address_dong is not null
    and lower(safe_facility_name) like lower(safe_address_dong) || ' %' then
    safe_facility_name := public.rankball_normalize_court_name(substr(safe_facility_name, char_length(safe_address_dong) + 1));
  end if;

  canonical_base_name := safe_facility_name;
  if safe_court_unit is not null
    and right(public.rankball_court_name_key(canonical_base_name), char_length(public.rankball_court_name_key(safe_court_unit)))
      <> public.rankball_court_name_key(safe_court_unit) then
    canonical_base_name := public.rankball_normalize_court_name(canonical_base_name || ' ' || safe_court_unit);
  end if;

  if safe_facility_name is null or canonical_base_name is null or safe_address_text is null then
    raise exception 'missing_court_request_fields' using errcode = '22023';
  end if;

  if safe_lat is null or safe_lng is null then
    raise exception 'court_pin_required' using errcode = '22023';
  end if;
  if safe_lat < -90 or safe_lat > 90 then
    raise exception 'invalid_latitude' using errcode = '22023';
  end if;
  if safe_lng < -180 or safe_lng > 180 then
    raise exception 'invalid_longitude' using errcode = '22023';
  end if;

  select coalesce(trust_score, 80)
  into actor_trust
  from public.profiles
  where id = actor_profile_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if actor_trust < 70 then
    raise exception 'court_request_trust_required' using errcode = '42501';
  end if;

  identity_address := lower(regexp_replace(coalesce(safe_road_address, safe_jibun_address, safe_address_text), '[[:space:]]+', '', 'g'));

  if exists (
    select 1 from public.court_requests
    where id = safe_id
      and (coalesce(requested_by, '') <> actor_profile_id or status <> 'pending')
  ) then
    raise exception 'court_request_locked' using errcode = '42501';
  end if;

  select count(*) into same_location_count
  from (
    select id
    from public.approved_courts
    where lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) = identity_address
      and coalesce(status, 'active') = 'active'
    union all
    select id
    from public.court_requests
    where id <> safe_id
      and status in ('pending', 'reported')
      and lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) = identity_address
  ) same_location;

  if same_location_count > 0 and safe_court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.approved_courts
    where lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) = identity_address
      and coalesce(status, 'active') = 'active'
      and public.rankball_court_name_key(coalesce(payload->>'canonicalBaseName', payload->>'baseName', name)) = public.rankball_court_name_key(canonical_base_name)
  ) then
    raise exception 'duplicate_approved_court' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.court_requests
    where id <> safe_id
      and status in ('pending', 'reported')
      and lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) = identity_address
      and public.rankball_court_name_key(coalesce(payload->>'canonicalBaseName', payload->>'baseName', name)) = public.rankball_court_name_key(canonical_base_name)
  ) then
    raise exception 'duplicate_pending_court_request' using errcode = '23505';
  end if;

  select exists (
    select 1 from public.approved_courts
    where public.rankball_court_name_key(coalesce(payload->>'canonicalBaseName', payload->>'baseName', name)) = public.rankball_court_name_key(canonical_base_name)
      and lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) <> identity_address
    union all
    select 1 from public.court_requests
    where id <> safe_id
      and status in ('pending', 'reported')
      and public.rankball_court_name_key(coalesce(payload->>'canonicalBaseName', payload->>'baseName', name)) = public.rankball_court_name_key(canonical_base_name)
      and lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) <> identity_address
  ) into has_name_collision;

  location_label := public.rankball_normalize_court_name(coalesce(
    safe_address_dong,
    nullif(request_payload->>'region', ''),
    safe_zonecode
  ));
  safe_name := case
    when has_name_collision and location_label is not null then canonical_base_name || ' (' || location_label || ')'
    else canonical_base_name
  end;

  safe_payload := request_payload || jsonb_build_object(
    'id', safe_id,
    'requestedBy', actor_profile_id,
    'requestedByTrustScore', actor_trust,
    'status', 'pending',
    'name', safe_name,
    'baseName', safe_facility_name,
    'facilityName', safe_facility_name,
    'courtUnit', safe_court_unit,
    'canonicalBaseName', canonical_base_name,
    'hashtag', safe_hashtag,
    'addressText', safe_address_text,
    'roadAddress', safe_road_address,
    'jibunAddress', safe_jibun_address,
    'zonecode', safe_zonecode,
    'lat', safe_lat,
    'lng', safe_lng,
    'createdAt', coalesce(request_payload->>'createdAt', now_ts::text),
    'updatedAt', now_ts
  );

  insert into public.court_requests (
    id, requested_by, status, name, hashtag, address_text, road_address,
    jibun_address, zonecode, lat, lng, payload, created_at, updated_at
  ) values (
    safe_id, actor_profile_id, 'pending', safe_name, safe_hashtag, safe_address_text,
    safe_road_address, safe_jibun_address, safe_zonecode, safe_lat, safe_lng,
    safe_payload, coalesce(nullif(request_payload->>'createdAt', '')::timestamptz, now_ts), now_ts
  )
  on conflict (id) do update set
    status = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then 'pending' else public.court_requests.status end,
    name = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.name else public.court_requests.name end,
    hashtag = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.hashtag else public.court_requests.hashtag end,
    address_text = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.address_text else public.court_requests.address_text end,
    road_address = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.road_address else public.court_requests.road_address end,
    jibun_address = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.jibun_address else public.court_requests.jibun_address end,
    zonecode = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.zonecode else public.court_requests.zonecode end,
    lat = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.lat else public.court_requests.lat end,
    lng = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.lng else public.court_requests.lng end,
    payload = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.payload else public.court_requests.payload end,
    updated_at = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then now_ts else public.court_requests.updated_at end;

  return jsonb_build_object('ok', true, 'requestId', safe_id, 'name', safe_name);
end;
$$;

create or replace function public.rankball_approve_court_request(
  actor_profile_id text,
  actor_admin_level integer,
  request_id text,
  approval_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  approved_id text;
  approved_name text;
  identity_address text;
  same_location_count integer := 0;
  now_ts timestamptz := now();
  approved_payload jsonb;
begin
  if public.rankball_admin_level_for_profile(actor_profile_id, actor_admin_level) < 30 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if not coalesce((approval_payload->>'addressVerified')::boolean, false) then
    raise exception 'court_address_verification_required' using errcode = '22023';
  end if;

  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;
  if request_row.status = 'approved' then
    raise exception 'court_request_already_approved' using errcode = '23505';
  end if;

  approved_name := public.rankball_normalize_court_name(coalesce(
    nullif(approval_payload->>'approvedName', ''),
    request_row.name
  ));
  if approved_name is null then
    raise exception 'approved_court_name_required' using errcode = '22023';
  end if;

  identity_address := lower(regexp_replace(coalesce(nullif(request_row.road_address, ''), nullif(request_row.jibun_address, ''), request_row.address_text), '[[:space:]]+', '', 'g'));
  select count(*) into same_location_count
  from public.approved_courts
  where lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) = identity_address
    and coalesce(status, 'active') = 'active'
    and source_request_id is distinct from request_row.id;

  if same_location_count > 0 then
    if nullif(request_row.payload->>'courtUnit', '') is null then
      raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
    end if;
    if not coalesce((approval_payload->>'multipleCourtsVerified')::boolean, false) then
      raise exception 'multiple_courts_verification_required' using errcode = '22023';
    end if;
  end if;

  if exists (
    select 1
    from public.approved_courts
    where lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')) = identity_address
      and coalesce(status, 'active') = 'active'
      and public.rankball_court_name_key(name) = public.rankball_court_name_key(approved_name)
      and source_request_id is distinct from request_row.id
  ) then
    raise exception 'court_duplicate' using errcode = '23505';
  end if;

  approved_id := coalesce(
    (select id from public.approved_courts where source_request_id = request_row.id limit 1),
    'court_' || request_row.id
  );
  approved_payload := request_row.payload || jsonb_build_object(
    'id', approved_id,
    'name', approved_name,
    'canonicalName', approved_name,
    'approvedAt', now_ts,
    'approvedBy', actor_profile_id,
    'addressVerified', true,
    'multipleCourtsVerified', same_location_count = 0 or coalesce((approval_payload->>'multipleCourtsVerified')::boolean, false),
    'favorite', false,
    'status', 'active'
  );

  insert into public.approved_courts (
    id, source_request_id, approved_by, name, hashtag, address_text, road_address,
    jibun_address, zonecode, lat, lng, status, payload, approved_at, created_at, updated_at
  ) values (
    approved_id, request_row.id, actor_profile_id, approved_name, request_row.hashtag,
    request_row.address_text, request_row.road_address, request_row.jibun_address,
    request_row.zonecode, request_row.lat, request_row.lng, 'active', approved_payload,
    now_ts, now_ts, now_ts
  )
  on conflict (id) do update set
    source_request_id = excluded.source_request_id,
    approved_by = excluded.approved_by,
    name = excluded.name,
    hashtag = excluded.hashtag,
    address_text = excluded.address_text,
    road_address = excluded.road_address,
    jibun_address = excluded.jibun_address,
    zonecode = excluded.zonecode,
    lat = excluded.lat,
    lng = excluded.lng,
    status = 'active',
    payload = excluded.payload,
    approved_at = excluded.approved_at,
    updated_at = excluded.updated_at;

  if to_regclass('public.courts') is not null then
    execute $sql$
      insert into public.courts (id, name, region, type, region_key, created_at)
      values (
        $1, $2, coalesce(nullif($3, ''), nullif($4, ''), 'unknown'),
        coalesce(nullif($5, ''), 'outdoor'),
        coalesce(nullif($4, ''), public.rankball_court_region_key($3, $6, $7, $8, $9)), $10
      )
      on conflict (id) do update set
        name = excluded.name,
        region = excluded.region,
        type = excluded.type,
        region_key = excluded.region_key
    $sql$
    using approved_id, approved_name, request_row.payload->>'region',
      public.rankball_court_region_key(request_row.payload->>'region', request_row.address_text, request_row.road_address, request_row.jibun_address, request_row.payload),
      request_row.payload->>'type', request_row.address_text, request_row.road_address,
      request_row.jibun_address, request_row.payload, now_ts;
  end if;

  update public.court_requests
  set name = approved_name,
      status = 'approved',
      payload = payload || jsonb_build_object(
        'name', approved_name,
        'status', 'approved',
        'approvedBy', actor_profile_id,
        'approvedAt', now_ts,
        'approvedCourtId', approved_id,
        'addressVerified', true,
        'multipleCourtsVerified', same_location_count = 0 or coalesce((approval_payload->>'multipleCourtsVerified')::boolean, false)
      ),
      updated_at = now_ts
  where id = request_row.id;

  insert into public.admin_audit_log (
    id, type, status, request_id, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5(request_row.id || actor_profile_id || now_ts::text),
    'court_approval', 'committed', request_row.id, request_row.requested_by,
    actor_profile_id,
    jsonb_build_object(
      'requestId', request_row.id,
      'courtId', approved_id,
      'approvedName', approved_name,
      'addressVerified', true,
      'multipleCourtsVerified', same_location_count = 0 or coalesce((approval_payload->>'multipleCourtsVerified')::boolean, false)
    ),
    now_ts
  ) on conflict (id) do nothing;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
  ) values (
    'n_' || md5('court-approved' || request_row.id || now_ts::text),
    request_row.requested_by, request_row.requested_by,
    '구장 등록 승인', approved_name || ' 구장 등록요청이 승인되었습니다.',
    'team', 'court_request',
    jsonb_build_object('courtRequestId', request_row.id, 'approvedCourtId', approved_id),
    now_ts, now_ts
  ) on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'requestId', request_row.id,
    'approvedCourtId', approved_id,
    'approvedName', approved_name
  );
end;
$$;

create or replace function public.rankball_approve_court_request(
  actor_profile_id text,
  actor_admin_level integer,
  request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'court_approval_verification_required' using errcode = '22023';
end;
$$;

revoke all on function public.rankball_normalize_court_name(text) from public;
revoke all on function public.rankball_court_name_key(text) from public;
revoke all on function public.rankball_submit_court_request(text, jsonb) from public;
revoke all on function public.rankball_approve_court_request(text, integer, text) from public;
revoke all on function public.rankball_approve_court_request(text, integer, text, jsonb) from public;
grant execute on function public.rankball_submit_court_request(text, jsonb) to service_role;
grant execute on function public.rankball_approve_court_request(text, integer, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
