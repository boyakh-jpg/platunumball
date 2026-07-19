-- Replace fictional built-in court metadata with verified facilities and exact stored pins.
-- Synthetic approval rows are hidden first so verified facilities do not collide with test data.

begin;

with synthetic_courts as (
  select court.id
  from public.approved_courts court
  where court.status = 'active'
    and (
      court.source_request_id like 'sim\_cr\_%' escape '\'
      or court.id in (
        'court_cr_mr5wglyv_wrifj',
        'court_cr_mr5wg77x_l90rv',
        'court_cr_mr5wf74f_n1o3w',
        'court_cr_mr5wgwu7_zg1yx',
        'court_cr_mr5wioc3_dwiwd',
        'court_cr_mr5wh7pa_nkk14',
        'court_cr_mr5whikn_tukt6',
        'court_cr_mr5w99z4_74a7i',
        'court_cr_mr5whtgf_hywvd',
        'court_cr_mr5wi4bn_eg171'
      )
    )
    and not exists (select 1 from public.matches match_row where match_row.court_id = court.id)
    and not exists (
      select 1 from public.recruiting_posts post
      where post.court_id = court.id and post.status = 'open'
    )
    and not exists (select 1 from public.tournaments tournament where tournament.court_id = court.id)
    and not exists (select 1 from public.court_reviews review where review.court_id = court.id)
)
update public.approved_courts court
set status = 'hidden',
    hidden_at = coalesce(court.hidden_at, now()),
    hidden_reason = coalesce(court.hidden_reason, 'synthetic_seed_quarantined'),
    payload = coalesce(court.payload, '{}'::jsonb) || jsonb_build_object(
      'synthetic', true,
      'quarantinedAddressText', court.address_text,
      'quarantinedRoadAddress', court.road_address,
      'quarantinedJibunAddress', court.jibun_address,
      'quarantinedLat', court.lat,
      'quarantinedLng', court.lng,
      'quarantinedAt', now(),
      'quarantineReason', 'synthetic_seed_quarantined'
    ),
    address_text = '격리된 시뮬레이션 구장 ' || court.id,
    road_address = null,
    jibun_address = null,
    zonecode = null,
    lat = null,
    lng = null,
    updated_at = now()
from synthetic_courts synthetic
where court.id = synthetic.id;

update public.court_requests request
set status = 'simulation_closed',
    payload = coalesce(request.payload, '{}'::jsonb) || jsonb_build_object(
      'synthetic', true,
      'quarantinedAt', now(),
      'quarantineReason', 'synthetic_seed_quarantined'
    ),
    updated_at = now()
where exists (
  select 1
  from public.approved_courts court
  where court.source_request_id = request.id
    and court.status = 'hidden'
    and court.hidden_reason = 'synthetic_seed_quarantined'
);

with verified_courts(
  id, name, region, type, address_text, road_address, jibun_address, zonecode,
  lat, lng, location_note, court_kind, hoop_count, lighting, paid, reservation, source_url
) as (
  values
    (
      'c1', '망원한강공원 농구장', '마포', '야외',
      '서울특별시 마포구 마포나루길 467 한강공원 망원안내센터',
      '서울특별시 마포구 마포나루길 467 한강공원 망원안내센터',
      '서울특별시 마포구 망원동 205-4 한강공원 망원안내센터',
      '04005', 37.5523461, 126.8998896,
      '망원한강공원 농구시설. 핀은 시설 주소 기준이다.',
      'street_hoop', 2, null::boolean, false, false,
      'https://hangang.seoul.go.kr/www/contents/666.do?mid=468'
    ),
    (
      'c2', '서울숲복합문화체육센터 체육관', '성수', '실내',
      '서울특별시 성동구 왕십리로11길 19 서울숲 복합문화체육센터',
      '서울특별시 성동구 왕십리로11길 19 서울숲 복합문화체육센터',
      '서울특별시 성동구 성수동1가 685-61 서울숲 복합문화체육센터',
      '04767', 37.5490719, 127.0415013,
      '서울숲복합문화체육센터 실내 체육관. 대관 가능 여부를 확인한다.',
      'official', 2, true, true, true,
      'https://www.sd.go.kr/main/contents.do?key=1449'
    ),
    (
      'c3', '잠실실내체육관 보조농구장', '잠실', '실내',
      '서울특별시 송파구 올림픽로 25 서울종합운동장',
      '서울특별시 송파구 올림픽로 25 서울종합운동장',
      '서울특별시 송파구 잠실동 10 서울종합운동장',
      '05500', 37.5148022, 127.0736261,
      '잠실실내체육관 보조농구장. 대관 일정과 출입구를 확인한다.',
      'official', 2, true, true, true,
      'https://stadium.seoul.go.kr/reserve/jamsil/inside-stadium'
    ),
    (
      'c4', '마포구민체육센터 체육관', '마포', '실내',
      '서울특별시 마포구 월드컵로25길 190 마포구민체육센터',
      '서울특별시 마포구 월드컵로25길 190 마포구민체육센터',
      '서울특별시 마포구 망원동 450-3 마포구민체육센터',
      '03954', 37.5567653, 126.8969649,
      '마포구민체육센터 실내 체육관. 대관 일정을 확인한다.',
      'official', 2, true, true, true,
      'https://yeyak.maposc.or.kr/'
    ),
    (
      'c5', '뚝섬한강공원 농구장', '성수', '야외',
      '서울특별시 광진구 강변북로 2273 한강공원뚝섬안내센터',
      '서울특별시 광진구 강변북로 2273 한강공원뚝섬안내센터',
      '서울특별시 광진구 자양동 427-1 한강공원뚝섬안내센터',
      '05097', 37.5293646, 127.0739782,
      '뚝섬한강공원 농구시설. 핀은 시설 주소 기준이다.',
      'street_hoop', 2, null::boolean, false, false,
      'https://hangang.seoul.go.kr/www/contents/654.do?mid=622'
    ),
    (
      'c6', '강남구민체육관', '강남', '실내',
      '서울특별시 강남구 개포로28길 47 구민체육관',
      '서울특별시 강남구 개포로28길 47 구민체육관',
      '서울특별시 강남구 개포동 1271 구민체육관',
      '06311', 37.4771366, 127.0519105,
      '강남구민체육관 실내 체육관. 대관 일정을 확인한다.',
      'official', 2, true, true, true,
      'https://life.gangnam.go.kr/fmcs/105'
    ),
    (
      'c7', '반포한강공원 농구장', '서초', '야외',
      '서울특별시 서초구 신반포로11길 40 한강공원 반포 안내센터',
      '서울특별시 서초구 신반포로11길 40 한강공원 반포 안내센터',
      '서울특별시 서초구 반포동 115-5 한강공원 반포 안내센터',
      '06500', 37.5077215, 126.9927291,
      '반포한강공원 농구시설. 핀은 시설 주소 기준이다.',
      'street_hoop', 2, null::boolean, false, false,
      'https://hangang.seoul.go.kr/www/contents/663.do?mid=463'
    ),
    (
      'c8', '흑석체육센터 체육관', '동작', '실내',
      '서울특별시 동작구 현충로 73 흑석체육센터',
      '서울특별시 동작구 현충로 73 흑석체육센터',
      '서울특별시 동작구 흑석동 116-1 흑석체육센터',
      '06904', 37.5100566, 126.963469,
      '흑석체육센터 실내 체육관. 대관 일정을 확인한다.',
      'official', 2, true, true, true,
      'https://www.idongjak.or.kr/html/facility/facility01_01_04.php'
    ),
    (
      'c9', '마포아트센터 종합체육관', '마포', '실내',
      '서울특별시 마포구 대흥로20길 28 마포아트센터',
      '서울특별시 마포구 대흥로20길 28 마포아트센터',
      '서울특별시 마포구 대흥동 30-3 마포아트센터',
      '04136', 37.5499061, 126.9455338,
      '마포아트센터 종합체육관. 대관 일정을 확인한다.',
      'official', 2, true, true, true,
      'https://www.mfac.or.kr/rental/rental_info_gym.jsp'
    ),
    (
      'c10', '성동구민종합체육센터 체육관', '성동', '실내',
      '서울특별시 성동구 왕십리로 89 성동구민종합체육센터',
      '서울특별시 성동구 왕십리로 89 성동구민종합체육센터',
      '서울특별시 성동구 성수동1가 685-697 성동구민종합체육센터',
      '04769', 37.5458701, 127.0440144,
      '성동구민종합체육센터 실내 체육관. 대관 일정을 확인한다.',
      'official', 2, true, true, true,
      'https://www.sd.go.kr/main/contents.do?key=1449'
    ),
    (
      'c11', '서대문문화체육회관 대체육관', '서대문', '실내',
      '서울특별시 서대문구 백련사길 39 서대문문화체육회관',
      '서울특별시 서대문구 백련사길 39 서대문문화체육회관',
      '서울특별시 서대문구 홍은동 산26-155 서대문문화체육회관',
      '03657', 37.5806749, 126.9314526,
      '서대문문화체육회관 대체육관. 대관 일정을 확인한다.',
      'official', 2, true, true, true,
      'https://cs.sscmc.or.kr/sdmcs/21'
    ),
    (
      'c12', '영등포제1스포츠센터 체육관', '영등포', '실내',
      '서울특별시 영등포구 신풍로 1 영등포제1스포츠센터',
      '서울특별시 영등포구 신풍로 1 영등포제1스포츠센터',
      '서울특별시 영등포구 신길동 426-3 영등포제1스포츠센터',
      '07398', 37.5005379, 126.9062946,
      '영등포제1스포츠센터 실내 체육관. 대관 일정을 확인한다.',
      'official', 2, true, true, true,
      'https://spc.y-sisul.or.kr/'
    )
)
insert into public.approved_courts (
  id, source_request_id, approved_by, status, name, hashtag,
  address_text, road_address, jibun_address, zonecode, lat, lng,
  payload, approved_at, created_at, updated_at
)
select
  court.id,
  null,
  null,
  'active',
  court.name,
  '#' || (10000 + substring(court.id from 2)::integer)::text,
  court.address_text,
  court.road_address,
  court.jibun_address,
  court.zonecode,
  court.lat,
  court.lng,
  jsonb_build_object(
    'id', court.id,
    'name', court.name,
    'region', court.region,
    'type', court.type,
    'addressText', court.address_text,
    'roadAddress', court.road_address,
    'jibunAddress', court.jibun_address,
    'zonecode', court.zonecode,
    'lat', court.lat,
    'lng', court.lng,
    'locationNote', court.location_note,
    'courtKind', court.court_kind,
    'hoopCount', court.hoop_count,
    'lighting', court.lighting,
    'paid', court.paid,
    'reservation', court.reservation,
    'canonicalBaseName', court.name,
    'baseName', court.name,
    'source', 'verified_builtin',
    'verificationStatus', 'address_verified',
    'pinPrecision', 'facility_address',
    'verificationSource', court.source_url,
    'verifiedAt', '2026-07-19T00:00:00+09:00'
  ),
  now(),
  now(),
  now()
from verified_courts court
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
  payload = coalesce(public.approved_courts.payload, '{}'::jsonb) || excluded.payload,
  approved_at = coalesce(public.approved_courts.approved_at, excluded.approved_at),
  hidden_at = null,
  hidden_by = null,
  hidden_reason = null,
  updated_at = now();

update public.courts legacy
set name = approved.name,
    region = approved.payload->>'region',
    type = approved.payload->>'type',
    region_key = approved.region_key,
    address_text = approved.address_text,
    road_address = approved.road_address,
    jibun_address = approved.jibun_address,
    lat = approved.lat,
    lng = approved.lng,
    payload = coalesce(legacy.payload, '{}'::jsonb) || approved.payload,
    metrics_updated_at = coalesce(legacy.metrics_updated_at, approved.metrics_updated_at)
from public.approved_courts approved
where approved.id = legacy.id
  and approved.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12']);

update public.matches match_row
set court_name = court.name,
    updated_at = now()
from public.courts court
where match_row.court_id = court.id
  and court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
  and match_row.court_name is distinct from court.name;

update public.recruiting_posts post
set court_name = court.name,
    updated_at = now()
from public.courts court
where post.court_id = court.id
  and court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
  and post.court_name is distinct from court.name;

update public.tournaments tournament
set court_name = court.name,
    updated_at = now()
from public.courts court
where tournament.court_id = court.id
  and court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
  and tournament.court_name is distinct from court.name;

with court_names(old_name, new_name) as (
  values
    ('한강 노을코트', '망원한강공원 농구장'),
    ('성수 브릿지파크', '서울숲복합문화체육센터 체육관'),
    ('잠실 실내체육관 보조코트', '잠실실내체육관 보조농구장'),
    ('홍대 스트릿돔', '마포구민체육센터 체육관'),
    ('뚝섬 리버사이드', '뚝섬한강공원 농구장'),
    ('양재 플로우코트', '강남구민체육관'),
    ('반포 선셋파크', '반포한강공원 농구장'),
    ('노량진 루프코트', '흑석체육센터 체육관'),
    ('연남 레일파크', '마포아트센터 종합체육관'),
    ('왕십리 언더패스', '성동구민종합체육센터 체육관'),
    ('신촌 블루짐', '서대문문화체육회관 대체육관'),
    ('문래 팩토리코트', '영등포제1스포츠센터 체육관')
)
update public.teams team
set home_court = names.new_name,
    updated_at = now()
from court_names names
where team.home_court = names.old_name;

commit;

select pg_notify('pgrst', 'reload schema');
