begin;

alter table public.approved_courts
  add column if not exists regional_alias_no integer,
  add column if not exists regional_alias_region_key text,
  add column if not exists admin_review_count integer not null default 0,
  add column if not exists admin_reviewed_at timestamptz,
  add column if not exists admin_reviewed_by text,
  add column if not exists admin_review_scenario text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_courts_regional_alias_no_check'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_regional_alias_no_check
      check (regional_alias_no is null or regional_alias_no > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_courts_admin_review_count_check'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_admin_review_count_check
      check (admin_review_count >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_courts_admin_review_scenario_check'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_admin_review_scenario_check
      check (
        admin_review_scenario is null
        or admin_review_scenario in (
          'manual', 'public', 'private', 'regional_alias', 'review_required', 'closed', 'duplicate'
        )
      );
  end if;
end;
$$;

create index if not exists approved_courts_regional_alias_idx
on public.approved_courts (regional_alias_region_key, regional_alias_no)
where regional_alias_no is not null;

create index if not exists approved_courts_admin_review_queue_idx
on public.approved_courts (admin_review_count, name_modification_count, id);

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
  greatest(
    court.updated_at,
    coalesce(facility.updated_at, court.updated_at),
    coalesce(evidence.updated_at, court.updated_at)
  ) as updated_at,
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
  facility.facility_area_scope,
  evidence.decision as name_evidence_decision,
  evidence.application_status as name_evidence_application_status,
  evidence.reference_name as name_evidence_reference,
  evidence.reference_kind as name_evidence_kind,
  evidence.spatial_relation as name_evidence_relation,
  evidence.distance_m as name_evidence_distance_m,
  evidence.proposed_facility_name as name_evidence_proposed_facility,
  evidence.applied_facility_name as name_evidence_applied_facility,
  evidence.evidence_url as name_evidence_url,
  evidence.source_snapshot_date as name_evidence_snapshot_date,
  court.regional_alias_no,
  court.regional_alias_region_key,
  court.admin_review_count,
  court.admin_reviewed_at,
  court.admin_reviewed_by,
  court.admin_review_scenario,
  case
    when court.verification_status = 'review_required'
      or court.status = 'hidden'
      or court.operational_status = 'pending'
      or evidence.decision in ('review_required', 'unresolved')
      or evidence.application_status = 'pending' then 0
    when court.verification_status = 'pending' then 1
    when court.verification_status = 'source_verified'
      or evidence.decision = 'administrative_fallback'
      or coalesce(nullif(court.public_access, ''), 'unknown') = 'unknown'
      or coalesce(nullif(court.indoor_outdoor, ''), 'unknown') = 'unknown'
      or coalesce(nullif(court.venue_type, ''), 'unknown') = 'unknown'
      or coalesce(nullif(court.court_kind, ''), 'unknown') = 'unknown'
      or coalesce(nullif(court.court_layout, ''), 'unknown') = 'unknown' then 2
    else 3
  end as admin_review_priority
from public.approved_courts court
left join public.court_facility_info facility on facility.court_id = court.id
left join public.court_name_evidence evidence on evidence.court_id = court.id;

revoke all on table public.rankball_admin_court_database from public, anon, authenticated;
grant select on table public.rankball_admin_court_database to service_role;

create or replace function public.rankball_admin_review_court(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_court_id text,
  p_scenario text,
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
  safe_scenario text := btrim(coalesce(p_scenario, ''));
  safe_patch jsonb := case when jsonb_typeof(p_patch) = 'object' then p_patch else '{}'::jsonb end;
  safe_reason text := btrim(coalesce(p_reason, ''));
  scenario_patch jsonb := '{}'::jsonb;
  effective_patch jsonb := '{}'::jsonb;
  update_result jsonb := jsonb_build_object('ok', true, 'unchanged', true);
  actor_name text;
  now_ts timestamptz := clock_timestamp();
  before_review_count integer;
  before_review_scenario text;
  before_reviewed_at timestamptz;
  before_alias_no integer;
  before_alias_region_key text;
  alias_no integer;
  alias_region_key text;
  alias_facility_name text;
  review_changes jsonb;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_court_id, '')), '') is null then
    raise exception 'court_id_required' using errcode = '22023';
  end if;
  if safe_scenario not in (
    'manual', 'public', 'private', 'regional_alias', 'review_required', 'closed', 'duplicate'
  ) then
    raise exception 'court_review_scenario_invalid' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or pg_column_size(safe_patch) > 32768 then
    raise exception 'court_patch_invalid' using errcode = '22023';
  end if;
  if char_length(safe_reason) < 4 or char_length(safe_reason) > 160 then
    raise exception 'court_update_reason_required' using errcode = '22023';
  end if;

  select * into court_row
  from public.approved_courts
  where id = p_court_id
  for update;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;

  before_review_count := coalesce(court_row.admin_review_count, 0);
  before_review_scenario := court_row.admin_review_scenario;
  before_reviewed_at := court_row.admin_reviewed_at;
  before_alias_no := court_row.regional_alias_no;
  before_alias_region_key := court_row.regional_alias_region_key;

  scenario_patch := case safe_scenario
    when 'public' then jsonb_build_object(
      'operationalStatus', 'active', 'verificationStatus', 'verified', 'status', 'active', 'publicAccess', 'public'
    )
    when 'private' then jsonb_build_object(
      'operationalStatus', 'active', 'verificationStatus', 'verified', 'status', 'active', 'publicAccess', 'private'
    )
    when 'review_required' then jsonb_build_object(
      'operationalStatus', 'pending', 'verificationStatus', 'review_required', 'status', 'hidden'
    )
    when 'closed' then jsonb_build_object(
      'operationalStatus', 'closed', 'verificationStatus', 'verified', 'status', 'disabled'
    )
    when 'duplicate' then jsonb_build_object(
      'verificationStatus', 'verified', 'status', 'disabled'
    )
    else '{}'::jsonb
  end;

  if safe_scenario = 'regional_alias' then
    if safe_patch ?| array['sido', 'sigungu', 'emd', 'addressText', 'roadAddress', 'jibunAddress', 'lat', 'lng'] then
      raise exception 'court_regional_alias_location_patch_invalid' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(court_row.sigungu, '')), '') is null
      or nullif(btrim(coalesce(court_row.emd, '')), '') is null then
      raise exception 'court_regional_alias_emd_required' using errcode = '22023';
    end if;

    alias_region_key := lower(regexp_replace(
      concat_ws('|', coalesce(court_row.sido, ''), court_row.sigungu, court_row.emd),
      '[[:space:]]+', '', 'g'
    ));
    perform pg_advisory_xact_lock(hashtextextended('rankball:court-regional-alias:' || alias_region_key, 0));

    if court_row.regional_alias_region_key = alias_region_key and court_row.regional_alias_no is not null then
      alias_no := court_row.regional_alias_no;
    else
      select other.regional_alias_no
      into alias_no
      from public.approved_courts other
      where other.id <> court_row.id
        and other.regional_alias_region_key = alias_region_key
        and other.regional_alias_no is not null
        and public.rankball_same_court_location(
          court_row.address_text, court_row.road_address, court_row.jibun_address, court_row.lat, court_row.lng,
          other.address_text, other.road_address, other.jibun_address, other.lat, other.lng
        )
      order by other.regional_alias_no, other.id
      limit 1;
    end if;

    if alias_no is null then
      select coalesce(max(other.regional_alias_no), 0) + 1
      into alias_no
      from public.approved_courts other
      where other.regional_alias_region_key = alias_region_key;
    end if;

    alias_facility_name := public.rankball_normalize_court_name(court_row.emd || ' ' || alias_no::text || '번');
    scenario_patch := jsonb_build_object(
      'facilityName', alias_facility_name,
      'operationalStatus', 'active',
      'verificationStatus', 'verified',
      'status', 'active',
      'accessType', 'restricted',
      'publicAccess', 'private'
    );
  end if;

  effective_patch := safe_patch || scenario_patch;
  if effective_patch <> '{}'::jsonb then
    begin
      update_result := public.rankball_admin_update_court(
        p_actor_profile_id,
        p_actor_admin_level,
        p_court_id,
        effective_patch,
        safe_reason
      );
    exception
      when sqlstate '22023' then
        if position('court_patch_unchanged' in sqlerrm) = 0 then
          raise;
        end if;
    end;
  end if;

  update public.approved_courts
  set regional_alias_no = case when safe_scenario = 'regional_alias' then alias_no else regional_alias_no end,
      regional_alias_region_key = case when safe_scenario = 'regional_alias' then alias_region_key else regional_alias_region_key end,
      admin_review_count = coalesce(admin_review_count, 0) + 1,
      admin_reviewed_at = now_ts,
      admin_reviewed_by = p_actor_profile_id,
      admin_review_scenario = safe_scenario,
      updated_at = now_ts
  where id = p_court_id
  returning * into court_row;

  select coalesce(nullif(name, ''), p_actor_profile_id)
  into actor_name
  from public.profiles
  where id = p_actor_profile_id;
  actor_name := coalesce(actor_name, p_actor_profile_id, '관리자');

  review_changes := jsonb_build_object(
    'adminReviewCount', jsonb_build_object('before', before_review_count, 'after', court_row.admin_review_count),
    'adminReviewScenario', jsonb_build_object('before', before_review_scenario, 'after', court_row.admin_review_scenario),
    'adminReviewedAt', jsonb_build_object('before', before_reviewed_at, 'after', court_row.admin_reviewed_at)
  );
  if before_alias_no is distinct from court_row.regional_alias_no then
    review_changes := review_changes || jsonb_build_object(
      'regionalAliasNo', jsonb_build_object('before', before_alias_no, 'after', court_row.regional_alias_no),
      'regionalAliasRegionKey', jsonb_build_object('before', before_alias_region_key, 'after', court_row.regional_alias_region_key)
    );
  end if;

  insert into public.admin_audit_log (
    id, type, status, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5('court-database-review:' || court_row.id || now_ts::text || p_actor_profile_id),
    'court_database_review', 'committed', null, p_actor_profile_id,
    jsonb_build_object(
      'courtId', court_row.id,
      'sigungu', court_row.sigungu,
      'actorName', actor_name,
      'scenario', safe_scenario,
      'reason', safe_reason,
      'changes', review_changes
    ),
    now_ts
  );

  return jsonb_build_object(
    'ok', true,
    'scenario', safe_scenario,
    'regionalAliasNo', court_row.regional_alias_no,
    'reviewCount', court_row.admin_review_count,
    'court', jsonb_build_object(
      'id', court_row.id,
      'name', court_row.name,
      'facilityName', court_row.facility_name,
      'courtUnit', court_row.court_unit,
      'status', court_row.status,
      'publicAccess', court_row.public_access
    ),
    'update', update_result
  );
end;
$$;

revoke all on function public.rankball_admin_review_court(text, integer, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.rankball_admin_review_court(text, integer, text, text, jsonb, text) to service_role;

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
where audit.type in ('court_database_update', 'court_database_review');

revoke all on table public.rankball_admin_court_change_history from public, anon, authenticated;
grant select on table public.rankball_admin_court_change_history to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
