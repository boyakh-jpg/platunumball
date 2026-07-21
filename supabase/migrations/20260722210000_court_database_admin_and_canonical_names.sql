alter table public.approved_courts
  add column if not exists name_modified_at timestamptz,
  add column if not exists name_modified_by text;

create index if not exists approved_courts_admin_name_modified_idx
on public.approved_courts (name_modified_at desc, id);

create index if not exists approved_courts_admin_updated_idx
on public.approved_courts (updated_at desc, id);

create table if not exists public.court_name_change_log (
  id text primary key,
  court_id text not null,
  sigungu text,
  previous_name text,
  new_name text not null,
  facility_name text,
  reason text not null,
  changed_by text,
  changed_by_name text not null,
  change_source text not null,
  created_at timestamptz not null default now(),
  constraint court_name_change_log_source_check check (change_source in ('admin', 'system')),
  constraint court_name_change_log_reason_check check (char_length(btrim(reason)) between 4 and 160)
);

create index if not exists court_name_change_log_created_idx
on public.court_name_change_log (created_at desc, id);

create index if not exists court_name_change_log_court_idx
on public.court_name_change_log (court_id, created_at desc);

create index if not exists court_name_change_log_sigungu_idx
on public.court_name_change_log (sigungu, created_at desc);

alter table public.court_name_change_log enable row level security;
revoke all on table public.court_name_change_log from public, anon, authenticated;
grant select, insert on table public.court_name_change_log to service_role;

create or replace function public.rankball_court_sigungu_label(
  raw_sigungu text,
  address_text text default null,
  raw_sido text default null,
  raw_region text default null
)
returns text
language plpgsql
immutable
as $$
declare
  safe_sigungu text := public.rankball_normalize_court_name(raw_sigungu);
  safe_sido text := public.rankball_normalize_court_name(raw_sido);
  safe_address text := public.rankball_normalize_court_name(address_text);
  safe_region text := public.rankball_normalize_court_name(raw_region);
  first_token text;
  second_token text;
  third_token text;
begin
  if safe_sigungu in ('세종특별자치시', '세종시')
    or safe_sido in ('세종특별자치시', '세종시') then
    return '세종시';
  end if;

  if safe_sigungu is not null then
    if safe_sido is not null and safe_sigungu like safe_sido || ' %' then
      safe_sigungu := btrim(substr(safe_sigungu, char_length(safe_sido) + 1));
    end if;
    if safe_sigungu = '세종특별자치시' then return '세종시'; end if;
    return nullif(safe_sigungu, '');
  end if;

  first_token := split_part(coalesce(safe_address, ''), ' ', 1);
  second_token := split_part(coalesce(safe_address, ''), ' ', 2);
  third_token := split_part(coalesce(safe_address, ''), ' ', 3);
  if first_token = '세종특별자치시' then return '세종시'; end if;

  if first_token ~ '(특별자치시|특별시|광역시|도)$' then
    if second_token ~ '(시|군)$' and third_token ~ '구$' then
      return second_token || ' ' || third_token;
    end if;
    if second_token ~ '(시|군|구)$' then return second_token; end if;
  elsif first_token ~ '(시|군)$' and second_token ~ '구$' then
    return first_token || ' ' || second_token;
  elsif first_token ~ '(시|군|구)$' then
    return first_token;
  end if;

  if safe_region in ('세종특별자치시', '세종시') then return '세종시'; end if;
  if safe_region ~ '(시|군|구)$' then return safe_region; end if;
  return null;
end;
$$;

create or replace function public.rankball_court_facility_base(
  raw_facility_name text,
  raw_sigungu text default null,
  raw_court_unit text default null
)
returns text
language plpgsql
immutable
as $$
declare
  safe_name text := public.rankball_normalize_court_name(raw_facility_name);
  safe_sigungu text := public.rankball_normalize_court_name(raw_sigungu);
  safe_unit text := public.rankball_normalize_court_name(raw_court_unit);
begin
  if safe_name is null then return null; end if;
  if safe_sigungu is not null and safe_name like safe_sigungu || ' %' then
    safe_name := btrim(substr(safe_name, char_length(safe_sigungu) + 1));
  end if;
  if safe_unit is not null and right(safe_name, char_length(safe_unit)) = safe_unit then
    safe_name := btrim(left(safe_name, char_length(safe_name) - char_length(safe_unit)));
  end if;
  safe_name := regexp_replace(safe_name, '[[:space:]]*((실내|실외|야외)[[:space:]]*)?농구장[[:space:]]*$', '', 'i');
  safe_name := regexp_replace(safe_name, '[[:space:]]*농구[[:space:]]*코트[[:space:]]*$', '', 'i');
  safe_name := regexp_replace(safe_name, '[[:space:]·,()\-]+$', '', 'g');
  return public.rankball_normalize_court_name(safe_name);
end;
$$;

create or replace function public.rankball_standard_court_name(
  raw_sigungu text,
  raw_facility_name text,
  raw_court_unit text default null,
  address_text text default null,
  raw_sido text default null,
  raw_region text default null
)
returns text
language plpgsql
immutable
as $$
declare
  safe_sigungu text := public.rankball_court_sigungu_label(raw_sigungu, address_text, raw_sido, raw_region);
  safe_unit text := public.rankball_normalize_court_name(raw_court_unit);
  safe_facility text;
begin
  safe_facility := public.rankball_court_facility_base(raw_facility_name, safe_sigungu, safe_unit);
  if safe_sigungu is null or safe_facility is null then return null; end if;
  return public.rankball_normalize_court_name(
    safe_sigungu || ' ' || safe_facility || ' 농구장' || case when safe_unit is null then '' else ' ' || safe_unit end
  );
end;
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
begin
  safe_sido := public.rankball_normalize_court_name(coalesce(
    case when tg_table_name = 'approved_courts' then to_jsonb(new)->>'sido' end,
    safe_payload->>'sido'
  ));
  safe_region := public.rankball_normalize_court_name(safe_payload->>'region');
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
      new.name,
      nullif(safe_payload->>'facilityName', ''),
      nullif(safe_payload->>'baseName', '')
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
  safe_payload := safe_payload || jsonb_build_object(
    'name', safe_name,
    'canonicalName', safe_name,
    'canonicalBaseName', safe_name,
    'baseName', safe_facility,
    'facilityName', safe_facility,
    'courtUnit', safe_unit,
    'sido', safe_sido,
    'sigungu', safe_sigungu
  );
  new.payload := safe_payload;

  if tg_table_name = 'approved_courts' then
    new.facility_name := safe_facility;
    new.court_unit := safe_unit;
    new.sido := safe_sido;
    new.sigungu := safe_sigungu;
  end if;
  return new;
end;
$$;

drop trigger if exists "00_court_requests_standard_name" on public.court_requests;
create trigger "00_court_requests_standard_name"
before insert or update of name, address_text, road_address, jibun_address, payload on public.court_requests
for each row execute function public.rankball_enforce_standard_court_name();

drop trigger if exists "00_approved_courts_standard_name" on public.approved_courts;
create trigger "00_approved_courts_standard_name"
before insert or update of name, address_text, road_address, jibun_address, facility_name, court_unit, sido, sigungu, payload on public.approved_courts
for each row execute function public.rankball_enforce_standard_court_name();

create or replace function public.rankball_refresh_court_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('rankball.court_bulk_standardization', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT'
    and tg_table_name = 'approved_courts'
    and coalesce(to_jsonb(new)->>'registration_origin', '') = 'public_import'
    and coalesce(to_jsonb(new)->'payload'->>'publicImportKey', '') ~ '^[0-9a-f]{64}$' then
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.rankball_refresh_court_feed_dependency(old.id);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    perform public.rankball_refresh_court_feed_dependency(old.id);
  end if;
  perform public.rankball_refresh_court_feed_dependency(new.id);
  return new;
end;
$$;

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
  select * into court_row
  from public.approved_courts
  where id = p_court_id
  for update;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;
  previous_name := court_row.name;

  safe_facility := public.rankball_court_facility_base(p_facility_name, court_row.sigungu, court_row.court_unit);
  if safe_facility is null or char_length(safe_facility) > 120 then
    raise exception 'court_facility_name_invalid' using errcode = '22023';
  end if;
  next_name := public.rankball_standard_court_name(
    court_row.sigungu,
    safe_facility,
    court_row.court_unit,
    court_row.address_text,
    court_row.sido,
    court_row.payload->>'region'
  );
  if next_name is null then
    raise exception 'court_sigungu_and_facility_required' using errcode = '22023';
  end if;
  if next_name = court_row.name then
    raise exception 'court_name_unchanged' using errcode = '22023';
  end if;

  select coalesce(nullif(name, ''), p_actor_profile_id)
  into actor_name
  from public.profiles
  where id = p_actor_profile_id;
  actor_name := coalesce(actor_name, p_actor_profile_id, '관리자');

  update public.approved_courts
  set facility_name = safe_facility,
      name = next_name,
      name_source = 'manual',
      name_modified_at = now_ts,
      name_modified_by = p_actor_profile_id,
      payload = payload || jsonb_build_object(
        'name', next_name,
        'canonicalName', next_name,
        'canonicalBaseName', next_name,
        'baseName', safe_facility,
        'facilityName', safe_facility,
        'nameModifiedAt', now_ts,
        'nameModifiedBy', p_actor_profile_id
      ),
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
    log_id, court_row.id, court_row.sigungu, previous_name,
    court_row.name, safe_facility, safe_reason, p_actor_profile_id, actor_name, 'admin', now_ts
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

-- Remove approved demo/simulation rows. Referenced legacy court shells remain for historical records.
select set_config('rankball.court_bulk_standardization', 'on', true);
select set_config('rankball.public_import_validated', 'on', true);

create temporary table rankball_removed_demo_courts on commit drop as
select id
from public.approved_courts
where id in ('c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12')
   or (
     status = 'hidden'
     and (
       hidden_reason = 'synthetic_seed_quarantined'
       or payload->>'synthetic' = 'true'
     )
   );

delete from public.favorites
where target_type = 'court'
  and target_id in (select id from rankball_removed_demo_courts);

delete from public.court_facility_info
where court_id in (select id from rankball_removed_demo_courts);

delete from public.court_source_records
where court_id in (select id from rankball_removed_demo_courts);

delete from public.approved_courts
where id in (select id from rankball_removed_demo_courts);

delete from public.courts legacy
where legacy.id in (select id from rankball_removed_demo_courts)
  and legacy.id not in ('c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12')
  and not exists (select 1 from public.matches item where item.court_id = legacy.id)
  and not exists (select 1 from public.recruiting_posts item where item.court_id = legacy.id)
  and not exists (select 1 from public.tournaments item where item.court_id = legacy.id)
  and not exists (select 1 from public.court_reviews item where item.court_id = legacy.id);

create temporary table rankball_court_standardization on commit drop as
with normalized as (
  select
    court.id,
    court.name as previous_name,
    public.rankball_court_sigungu_label(
      court.sigungu,
      coalesce(court.address_text, court.road_address, court.jibun_address),
      court.sido,
      court.payload->>'region'
    ) as safe_sigungu,
    public.rankball_normalize_court_name(coalesce(court.court_unit, court.payload->>'courtUnit')) as original_court_unit,
    coalesce(court.facility_name, nullif(court.payload->>'facilityName', ''), nullif(court.payload->>'baseName', ''), court.name) as raw_facility,
    court.sido,
    court.address_text,
    lower(regexp_replace(
      coalesce(nullif(court.road_address, ''), nullif(court.jibun_address, ''), court.address_text),
      '[[:space:]]+', '', 'g'
    )) as location_key,
    court.payload->>'region' as region
  from public.approved_courts court
), facilities as (
  select
    normalized.*,
    public.rankball_court_facility_base(raw_facility, safe_sigungu, original_court_unit) as safe_facility
  from normalized
), group_stats as (
  select
    location_key,
    public.rankball_court_name_key(safe_facility) as facility_key,
    count(*) as row_count,
    count(distinct public.rankball_court_name_key(original_court_unit)) filter (where original_court_unit is not null) as distinct_unit_count
  from facilities
  group by location_key, public.rankball_court_name_key(safe_facility)
), ranked as (
  select
    facilities.*,
    stats.row_count,
    stats.distinct_unit_count,
    row_number() over (
      partition by facilities.location_key, public.rankball_court_name_key(facilities.safe_facility)
      order by public.rankball_court_name_key(facilities.original_court_unit), facilities.id
    ) as court_sequence
  from facilities
  join group_stats stats
    on stats.location_key = facilities.location_key
   and stats.facility_key = public.rankball_court_name_key(facilities.safe_facility)
), disambiguated as (
  select
    ranked.*,
    case
      when row_count > 1 and distinct_unit_count < row_count then court_sequence::text || '코트'
      else original_court_unit
    end as safe_court_unit
  from ranked
), names as (
  select
    disambiguated.*,
    public.rankball_standard_court_name(
      safe_sigungu, safe_facility, safe_court_unit, address_text, sido, region
    ) as next_name
  from disambiguated
)
select *, previous_name is distinct from next_name as name_changed
from names
where next_name is not null;

update public.approved_courts court
set name = standard.next_name,
    sigungu = standard.safe_sigungu,
    facility_name = standard.safe_facility,
    court_unit = standard.safe_court_unit,
    name_source = case when court.registration_origin = 'public_import' then 'source' else 'manual' end,
    name_modified_at = case when standard.name_changed then now() else court.name_modified_at end,
    name_modified_by = case when standard.name_changed then 'system' else court.name_modified_by end,
    payload = court.payload || jsonb_build_object(
      'name', standard.next_name,
      'canonicalName', standard.next_name,
      'canonicalBaseName', standard.next_name,
      'baseName', standard.safe_facility,
      'facilityName', standard.safe_facility,
      'courtUnit', standard.safe_court_unit,
      'sigungu', standard.safe_sigungu,
      'nameModifiedAt', case when standard.name_changed then now() else court.name_modified_at end,
      'nameModifiedBy', case when standard.name_changed then 'system' else court.name_modified_by end
    ),
    updated_at = case when standard.name_changed then now() else court.updated_at end
from rankball_court_standardization standard
where court.id = standard.id;

insert into public.court_name_change_log (
  id, court_id, sigungu, previous_name, new_name, facility_name, reason,
  changed_by, changed_by_name, change_source, created_at
)
select
  'court_name_system_' || md5(standard.id || standard.previous_name || standard.next_name),
  standard.id,
  standard.safe_sigungu,
  standard.previous_name,
  standard.next_name,
  standard.safe_facility,
  '시군구 + 시설명 + 농구장 표준화',
  null,
  '시스템',
  'system',
  now()
from rankball_court_standardization standard
where standard.name_changed
on conflict (id) do nothing;

update public.courts legacy
set name = approved.name,
    address_text = approved.address_text,
    road_address = approved.road_address,
    jibun_address = approved.jibun_address,
    lat = approved.lat,
    lng = approved.lng,
    payload = legacy.payload || approved.payload || jsonb_build_object(
      'name', approved.name,
      'canonicalName', approved.name,
      'canonicalBaseName', approved.name
    )
from public.approved_courts approved
where legacy.id = approved.id;

update public.matches item
set court_name = approved.name
from public.approved_courts approved
where item.court_id = approved.id and item.court_name is distinct from approved.name;

update public.recruiting_posts item
set court_name = approved.name
from public.approved_courts approved
where item.court_id = approved.id and item.court_name is distinct from approved.name;

update public.tournaments item
set court_name = approved.name
from public.approved_courts approved
where item.court_id = approved.id and item.court_name is distinct from approved.name;

update public.court_reviews item
set court_name = approved.name
from public.approved_courts approved
where item.court_id = approved.id and item.court_name is distinct from approved.name;

update public.court_requests request
set name = approved.name,
    payload = request.payload || jsonb_build_object(
      'name', approved.name,
      'canonicalName', approved.name,
      'canonicalBaseName', approved.name,
      'baseName', approved.facility_name,
      'facilityName', approved.facility_name,
      'courtUnit', approved.court_unit,
      'sido', approved.sido,
      'sigungu', approved.sigungu
    ),
    updated_at = now()
from public.approved_courts approved
where approved.source_request_id = request.id
  and request.name is distinct from approved.name;

insert into public.admin_audit_log (
  id, type, status, created_by, payload, created_at
)
select
  'aa_' || md5('court-name-system-standardization:20260722210000'),
  'court_name_bulk_standardization',
  'committed',
  null,
  jsonb_build_object(
    'changedCount', count(*) filter (where name_changed),
    'removedDemoCount', (select count(*) from rankball_removed_demo_courts),
    'rule', '시군구 + 시설명 + 농구장'
  ),
  now()
from rankball_court_standardization
on conflict (id) do nothing;

revoke all on function public.rankball_court_sigungu_label(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_court_facility_base(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_standard_court_name(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_enforce_standard_court_name() from public, anon, authenticated;
revoke all on function public.rankball_admin_rename_court(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_court_sigungu_label(text, text, text, text) to service_role;
grant execute on function public.rankball_court_facility_base(text, text, text) to service_role;
grant execute on function public.rankball_standard_court_name(text, text, text, text, text, text) to service_role;
grant execute on function public.rankball_admin_rename_court(text, integer, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
