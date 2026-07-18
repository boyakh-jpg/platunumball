with built_in_courts(
  id, name, region, type, address_text, location_note, court_kind, hoop_count, lighting, paid
) as (
  values
    ('c1', '한강 노을코트', '마포', '야외', '서울 마포구 망원동 한강공원 망원지구', '망원나들목에서 한강 방향으로 내려와 오른쪽 골대.', 'street_hoop', 2, true, false),
    ('c2', '성수 브릿지파크', '성수', '야외', '서울 성동구 성수동1가 서울숲 인근', '서울숲역에서 강변 방향, 다리 아래 코트.', 'street_hoop', 2, true, false),
    ('c3', '잠실 실내체육관 보조코트', '잠실', '실내', '서울 송파구 올림픽로 25', '실내체육관 보조코트 입구 확인 필요.', 'official', 2, true, true),
    ('c4', '홍대 스트릿돔', '마포', '실내', '서울 마포구 홍익로 인근', '홍대입구역 9번 출구 쪽, 실내 대관 확인.', 'official', 2, true, true),
    ('c5', '뚝섬 리버사이드', '성수', '야외', '서울 광진구 자양동 뚝섬한강공원', '뚝섬유원지역에서 한강공원 진입 후 농구장 표지 확인.', 'street_hoop', 2, true, false),
    ('c6', '양재 플로우코트', '강남', '실내', '서울 강남구 양재천로 인근', '유료 대관 여부는 방 규칙에서 확인.', 'official', 2, true, true),
    ('c7', '반포 선셋파크', '서초', '야외', '서울 서초구 반포동 반포한강공원', '달빛광장 쪽 코트, 주말 대기 가능.', 'street_hoop', 2, true, false),
    ('c8', '노량진 루프코트', '동작', '야외', '서울 동작구 노량진동 인근', '옥상/야외 코트라 입구 안내 확인 필요.', 'street_hoop', 1, true, false),
    ('c9', '연남 레일파크', '마포', '야외', '서울 마포구 연남동 경의선숲길 인근', '공원 길 안쪽 골대 위치 확인.', 'street_hoop', 1, false, false),
    ('c10', '왕십리 언더패스', '성동', '야외', '서울 성동구 왕십리로 인근', '고가 아래 코트, 비 오는 날 바닥 상태 확인.', 'street_hoop', 1, true, false),
    ('c11', '신촌 블루짐', '서대문', '실내', '서울 서대문구 신촌로 인근', '실내 대관형 코트. 예약 내역 확인 필요.', 'official', 2, true, true),
    ('c12', '문래 팩토리코트', '영등포', '실내', '서울 영등포구 문래동 인근', '공장형 실내 코트. 주차/입구 안내 확인.', 'official', 2, true, true)
)
insert into public.courts (
  id, name, region, type, region_key, address_text, payload, created_at
)
select
  court.id,
  court.name,
  court.region,
  court.type,
  public.rankball_court_region_key(court.region, court.address_text),
  court.address_text,
  jsonb_build_object(
    'id', court.id,
    'name', court.name,
    'region', court.region,
    'type', court.type,
    'addressText', court.address_text,
    'locationNote', court.location_note,
    'courtKind', court.court_kind,
    'hoopCount', court.hoop_count,
    'lighting', court.lighting,
    'paid', court.paid,
    'canonicalBaseName', court.name,
    'baseName', court.name
  ),
  now()
from built_in_courts court
on conflict (id) do update set
  name = coalesce(nullif(public.courts.name, ''), excluded.name),
  region = coalesce(nullif(public.courts.region, ''), excluded.region),
  type = coalesce(nullif(public.courts.type, ''), excluded.type),
  region_key = coalesce(nullif(public.courts.region_key, ''), excluded.region_key),
  address_text = coalesce(nullif(public.courts.address_text, ''), excluded.address_text),
  payload = excluded.payload || coalesce(public.courts.payload, '{}'::jsonb);

create or replace function public.rankball_is_match_review_participant(
  p_match_id text,
  p_actor_profile_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with target_match as (
    select
      case when jsonb_typeof(match.played_player_ids->'teamA') = 'array'
        then match.played_player_ids->'teamA' else '[]'::jsonb end as played_a,
      case when jsonb_typeof(match.played_player_ids->'teamB') = 'array'
        then match.played_player_ids->'teamB' else '[]'::jsonb end as played_b
    from public.matches match
    where match.id = nullif(btrim(p_match_id), '')
  )
  select coalesce(
    target.played_a ? nullif(btrim(p_actor_profile_id), '')
    or target.played_b ? nullif(btrim(p_actor_profile_id), '')
    or (
      jsonb_array_length(target.played_a) + jsonb_array_length(target.played_b) = 0
      and exists (
        select 1
        from public.match_players player
        where player.match_id = nullif(btrim(p_match_id), '')
          and player.user_id = nullif(btrim(p_actor_profile_id), '')
      )
    ),
    false
  )
  from target_match target;
$$;

create or replace function public.rankball_court_reviewable_matches(
  actor_profile_id text,
  p_court_id text,
  p_court_name text,
  p_limit integer default 50
)
returns table (
  id text,
  title text,
  status text,
  scheduled_at text,
  scheduled_date date,
  scheduled_time time,
  ended_at timestamptz,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    match.id,
    match.title,
    match.status,
    match.scheduled_at,
    match.scheduled_date,
    match.scheduled_time,
    match.ended_at,
    match.confirmed_at
  from public.matches match
  where public.rankball_is_match_review_participant(match.id, actor_profile_id)
    and match.status not in ('void', 'cancelled')
    and (match.ended_at is not null or match.status in ('approval', 'disputed', 'confirmed'))
    and (
      match.court_id = nullif(btrim(p_court_id), '')
      or (
        nullif(btrim(p_court_name), '') is not null
        and public.rankball_court_name_key(match.court_name) = public.rankball_court_name_key(p_court_name)
      )
    )
  order by coalesce(match.ended_at, match.confirmed_at, match.created_at) desc,
    match.scheduled_date desc nulls last,
    match.scheduled_time desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.rankball_submit_court_review(
  actor_profile_id text,
  review_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_match_id text := nullif(btrim(review_payload->>'matchId'), '');
  safe_rating integer := nullif(review_payload->>'rating', '')::integer;
  safe_court_id text;
  safe_court_name text;
  review_id text := nullif(btrim(review_payload->>'id'), '');
  match_row record;
  safe_payload jsonb;
begin
  if actor_profile_id is null or btrim(actor_profile_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;

  if safe_match_id is null then
    raise exception 'missing_match_id' using errcode = '22023';
  end if;

  if safe_rating is null or safe_rating < 1 or safe_rating > 5 then
    raise exception 'invalid_court_rating' using errcode = '22023';
  end if;

  select id, court_id, court_name, status, ended_at
  into match_row
  from public.matches
  where id = safe_match_id
  for share;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if match_row.status in ('void', 'cancelled') then
    raise exception 'court_review_match_closed' using errcode = '42501';
  end if;

  if match_row.ended_at is null and match_row.status not in ('approval', 'disputed', 'confirmed') then
    raise exception 'court_review_match_not_finished' using errcode = '42501';
  end if;

  if not public.rankball_is_match_review_participant(safe_match_id, actor_profile_id) then
    raise exception 'court_review_participant_required' using errcode = '42501';
  end if;

  safe_court_name := coalesce(nullif(match_row.court_name, ''), nullif(btrim(review_payload->>'courtName'), ''), '구장 미정');
  safe_court_id := coalesce(
    public.rankball_resolve_approved_court_id(match_row.court_id, safe_court_name),
    nullif(match_row.court_id, ''),
    nullif(btrim(review_payload->>'courtId'), ''),
    'court_' || md5(safe_court_name)
  );

  if review_id is null then
    review_id := 'cvr_' || md5(safe_match_id || actor_profile_id);
  end if;

  safe_payload := review_payload || jsonb_build_object(
    'id', review_id,
    'courtId', safe_court_id,
    'courtName', safe_court_name,
    'matchId', safe_match_id,
    'reviewerId', actor_profile_id,
    'rating', safe_rating,
    'createdAt', coalesce(review_payload->>'createdAt', now_ts::text),
    'updatedAt', now_ts
  );

  insert into public.court_reviews (
    id,
    court_id,
    court_name,
    match_id,
    reviewer_id,
    rating,
    surface_rating,
    rim_rating,
    lighting_rating,
    crowd_rating,
    location_accuracy,
    fit_modes,
    tags,
    memo,
    payload,
    created_at,
    updated_at
  )
  values (
    review_id,
    safe_court_id,
    safe_court_name,
    safe_match_id,
    actor_profile_id,
    safe_rating,
    nullif(review_payload->>'surfaceRating', '')::integer,
    nullif(review_payload->>'rimRating', '')::integer,
    nullif(review_payload->>'lightingRating', '')::integer,
    nullif(review_payload->>'crowdRating', '')::integer,
    nullif(review_payload->>'locationAccuracy', '')::integer,
    coalesce(review_payload->'fitModes', '[]'::jsonb),
    coalesce(review_payload->'tags', '[]'::jsonb),
    nullif(btrim(review_payload->>'memo'), ''),
    safe_payload,
    coalesce(nullif(review_payload->>'createdAt', '')::timestamptz, now_ts),
    now_ts
  )
  on conflict (match_id, reviewer_id) do update set
    court_id = excluded.court_id,
    court_name = excluded.court_name,
    rating = excluded.rating,
    surface_rating = excluded.surface_rating,
    rim_rating = excluded.rim_rating,
    lighting_rating = excluded.lighting_rating,
    crowd_rating = excluded.crowd_rating,
    location_accuracy = excluded.location_accuracy,
    fit_modes = excluded.fit_modes,
    tags = excluded.tags,
    memo = excluded.memo,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  returning id into review_id;

  return jsonb_build_object(
    'ok', true,
    'reviewId', review_id,
    'courtId', safe_court_id,
    'matchId', safe_match_id
  );
end;
$$;

revoke all on function public.rankball_is_match_review_participant(text, text) from public, anon, authenticated;
revoke all on function public.rankball_court_reviewable_matches(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.rankball_submit_court_review(text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_is_match_review_participant(text, text) to service_role;
grant execute on function public.rankball_court_reviewable_matches(text, text, text, integer) to service_role;
grant execute on function public.rankball_submit_court_review(text, jsonb) to service_role;

select public.rankball_refresh_all_court_metrics();
select pg_notify('pgrst', 'reload schema');
