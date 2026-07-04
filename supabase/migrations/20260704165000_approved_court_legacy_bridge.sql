do $$
begin
  if to_regclass('public.courts') is not null
    and to_regclass('public.approved_courts') is not null then
    execute $sql$
      insert into public.courts (
        id,
        name,
        region,
        type,
        region_key,
        created_at
      )
      select
        court.id,
        court.name,
        coalesce(
          nullif(court.payload->>'region', ''),
          nullif(court.region_key, ''),
          'unknown'
        ),
        coalesce(nullif(court.payload->>'type', ''), 'outdoor'),
        coalesce(
          nullif(court.region_key, ''),
          public.rankball_court_region_key(court.payload->>'region', court.address_text, court.road_address, court.jibun_address, court.payload),
          nullif(court.payload->>'region', '')
        ),
        coalesce(court.created_at, now())
      from public.approved_courts court
      where coalesce(court.status, 'active') = 'active'
      on conflict (id) do update set
        name = excluded.name,
        region = excluded.region,
        type = excluded.type,
        region_key = excluded.region_key
    $sql$;
  end if;
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
declare
  request_row public.court_requests%rowtype;
  duplicate_id text;
  approved_id text;
  now_ts timestamptz := now();
  approved_payload jsonb;
begin
  if public.rankball_admin_level_for_profile(actor_profile_id, actor_admin_level) < 30 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;

  select id into duplicate_id
  from public.approved_courts
  where lower(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text)) =
    lower(coalesce(nullif(request_row.road_address, ''), nullif(request_row.jibun_address, ''), request_row.address_text))
    and coalesce(zonecode, '') = coalesce(request_row.zonecode, '')
    and source_request_id is distinct from request_row.id
  limit 1;

  if duplicate_id is not null then
    raise exception 'court_duplicate:%', duplicate_id using errcode = '23505';
  end if;

  approved_id := coalesce(
    (
      select id
      from public.approved_courts
      where source_request_id = request_row.id
      limit 1
    ),
    'court_' || request_row.id
  );

  approved_payload := jsonb_build_object(
    'id', approved_id,
    'name', request_row.name,
    'hashtag', request_row.hashtag,
    'addressText', request_row.address_text,
    'roadAddress', request_row.road_address,
    'jibunAddress', request_row.jibun_address,
    'zonecode', request_row.zonecode,
    'lat', request_row.lat,
    'lng', request_row.lng,
    'region', request_row.payload->>'region',
    'type', request_row.payload->>'type',
    'baseName', request_row.payload->>'baseName',
    'addressDong', request_row.payload->>'addressDong',
    'detailAddress', request_row.payload->>'detailAddress',
    'locationNote', request_row.payload->>'locationNote',
    'courtKind', request_row.payload->>'courtKind',
    'surfaceType', request_row.payload->>'surfaceType',
    'courtLayout', request_row.payload->>'courtLayout',
    'paid', coalesce(request_row.payload->'paid', 'false'::jsonb),
    'approvedAt', now_ts,
    'favorite', false
  );

  insert into public.approved_courts (
    id,
    source_request_id,
    approved_by,
    name,
    hashtag,
    address_text,
    road_address,
    jibun_address,
    zonecode,
    lat,
    lng,
    payload,
    approved_at,
    created_at,
    updated_at
  )
  values (
    approved_id,
    request_row.id,
    actor_profile_id,
    request_row.name,
    request_row.hashtag,
    request_row.address_text,
    request_row.road_address,
    request_row.jibun_address,
    request_row.zonecode,
    request_row.lat,
    request_row.lng,
    approved_payload,
    now_ts,
    now_ts,
    now_ts
  )
  on conflict (id) do update set
    approved_by = excluded.approved_by,
    payload = excluded.payload,
    approved_at = excluded.approved_at,
    updated_at = excluded.updated_at;

  if to_regclass('public.courts') is not null then
    execute $sql$
      insert into public.courts (
        id,
        name,
        region,
        type,
        region_key,
        created_at
      )
      values (
        $1,
        $2,
        coalesce(nullif($3, ''), nullif($4, ''), 'unknown'),
        coalesce(nullif($5, ''), 'outdoor'),
        coalesce(nullif($4, ''), public.rankball_court_region_key($3, $6, $7, $8, $9)),
        $10
      )
      on conflict (id) do update set
        name = excluded.name,
        region = excluded.region,
        type = excluded.type,
        region_key = excluded.region_key
    $sql$
    using
      approved_id,
      request_row.name,
      request_row.payload->>'region',
      public.rankball_court_region_key(request_row.payload->>'region', request_row.address_text, request_row.road_address, request_row.jibun_address, request_row.payload),
      request_row.payload->>'type',
      request_row.address_text,
      request_row.road_address,
      request_row.jibun_address,
      request_row.payload,
      now_ts;
  end if;

  update public.court_requests
  set
    status = 'approved',
    payload = payload || jsonb_build_object(
      'status', 'approved',
      'approvedBy', actor_profile_id,
      'approvedAt', now_ts,
      'approvedCourtId', approved_id
    ),
    updated_at = now_ts
  where id = request_row.id;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    request_id,
    target_user_id,
    created_by,
    payload,
    created_at
  )
  values (
    'aa_' || md5(request_row.id || actor_profile_id || now_ts::text),
    'court_approval',
    'committed',
    request_row.id,
    request_row.requested_by,
    actor_profile_id,
    jsonb_build_object('requestId', request_row.id, 'courtId', approved_id),
    now_ts
  )
  on conflict (id) do nothing;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values (
    'n_' || md5('court-approved' || request_row.id || now_ts::text),
    request_row.requested_by,
    request_row.requested_by,
    '구장 등록 승인',
    request_row.name || ' 구장 등록요청이 승인되었습니다.',
    'team',
    'court_request',
    jsonb_build_object('courtRequestId', request_row.id, 'approvedCourtId', approved_id),
    now_ts,
    now_ts
  )
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'requestId', request_row.id, 'approvedCourtId', approved_id);
end;
$$;

select pg_notify('pgrst', 'reload schema');
