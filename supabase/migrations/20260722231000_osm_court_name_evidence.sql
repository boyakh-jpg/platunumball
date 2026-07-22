create table if not exists public.court_name_evidence (
  court_id text primary key references public.approved_courts(id) on delete cascade,
  provider text not null default 'openstreetmap',
  decision text not null,
  application_status text not null default 'pending',
  spatial_relation text not null,
  reference_name text,
  reference_kind text,
  distance_m numeric(8, 1),
  confidence numeric(4, 3),
  evidence_url text,
  fallback_reference_name text,
  fallback_evidence_url text,
  proposed_facility_name text,
  applied_facility_name text,
  source_court_url text,
  source_snapshot_date date not null,
  inference_version text not null,
  run_id text not null,
  generated_at timestamptz not null default now(),
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint court_name_evidence_provider_check check (provider = 'openstreetmap'),
  constraint court_name_evidence_decision_check check (
    decision in ('auto_apply', 'review_required', 'administrative_fallback', 'unresolved')
  ),
  constraint court_name_evidence_application_status_check check (
    application_status in ('pending', 'applied', 'unchanged', 'skipped_manual', 'skipped_duplicate', 'not_applicable')
  ),
  constraint court_name_evidence_relation_check check (
    spatial_relation in ('self', 'inside', 'site_member', 'nearby', 'administrative', 'none')
  ),
  constraint court_name_evidence_distance_check check (
    distance_m is null or (distance_m >= 0 and distance_m <= 80)
  ),
  constraint court_name_evidence_confidence_check check (
    confidence is null or confidence between 0 and 1
  ),
  constraint court_name_evidence_urls_check check (
    (evidence_url is null or evidence_url ~ '^https://www\.openstreetmap\.org/(node|way|relation)/[0-9]+$')
    and (fallback_evidence_url is null or fallback_evidence_url ~ '^https://www\.openstreetmap\.org/(node|way|relation)/[0-9]+$')
    and (source_court_url is null or source_court_url ~ '^https://www\.openstreetmap\.org/(node|way|relation)/[0-9]+$')
  )
);

alter table public.court_name_evidence
  drop constraint if exists court_name_evidence_application_status_check;
alter table public.court_name_evidence
  add constraint court_name_evidence_application_status_check check (
    application_status in ('pending', 'applied', 'unchanged', 'skipped_manual', 'skipped_duplicate', 'not_applicable')
  );

create index if not exists court_name_evidence_review_idx
on public.court_name_evidence (decision, application_status, distance_m, court_id);

create index if not exists court_name_evidence_run_idx
on public.court_name_evidence (run_id, updated_at desc, court_id);

alter table public.court_name_evidence enable row level security;
revoke all on table public.court_name_evidence from public, anon, authenticated;
grant select, insert, update on table public.court_name_evidence to service_role;

create or replace function public.rankball_apply_osm_court_name_evidence(
  p_rows jsonb,
  p_apply boolean,
  p_run_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
declare
  item jsonb;
  court_row public.approved_courts%rowtype;
  previous_name text;
  safe_court_id text;
  safe_decision text;
  safe_relation text;
  safe_reference_name text;
  safe_reference_kind text;
  safe_proposed_name text;
  safe_applied_name text;
  safe_evidence_url text;
  safe_fallback_name text;
  safe_fallback_url text;
  safe_source_url text;
  safe_inference_version text;
  safe_distance numeric;
  safe_confidence numeric;
  safe_snapshot_date date;
  now_ts timestamptz := clock_timestamp();
  evidence_count integer := 0;
  applied_count integer := 0;
  unchanged_count integer := 0;
  skipped_count integer := 0;
  duplicate_count integer := 0;
  next_application_status text;
  facility_changed boolean;
  verification_changed boolean;
begin
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) < 1
    or jsonb_array_length(p_rows) > 100
    or pg_column_size(p_rows) > 1048576 then
    raise exception 'osm_court_name_rows_invalid' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_run_id, '')), '') is null or char_length(p_run_id) > 80 then
    raise exception 'osm_court_name_run_id_invalid' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(item) is distinct from 'object' then
      raise exception 'osm_court_name_row_invalid' using errcode = '22023';
    end if;
    safe_court_id := nullif(btrim(item->>'courtId'), '');
    safe_decision := btrim(coalesce(item->>'decision', ''));
    safe_relation := btrim(coalesce(item->>'relation', ''));
    safe_reference_name := nullif(btrim(item->>'referenceName'), '');
    safe_reference_kind := nullif(btrim(item->>'referenceKind'), '');
    safe_proposed_name := nullif(btrim(item->>'proposedFacilityName'), '');
    safe_applied_name := nullif(btrim(item->>'appliedFacilityName'), '');
    safe_evidence_url := nullif(btrim(item->>'evidenceUrl'), '');
    safe_fallback_name := nullif(btrim(item->>'fallbackReferenceName'), '');
    safe_fallback_url := nullif(btrim(item->>'fallbackEvidenceUrl'), '');
    safe_source_url := nullif(btrim(item->>'sourceCourtUrl'), '');
    safe_inference_version := nullif(btrim(item->>'inferenceVersion'), '');
    safe_distance := case when item->'distanceMeters' is null or item->'distanceMeters' = 'null'::jsonb then null else (item->>'distanceMeters')::numeric end;
    safe_confidence := case when item->'confidence' is null or item->'confidence' = 'null'::jsonb then null else (item->>'confidence')::numeric end;
    safe_snapshot_date := (item->>'sourceSnapshotDate')::date;

    if safe_court_id is null
      or safe_decision not in ('auto_apply', 'review_required', 'administrative_fallback', 'unresolved')
      or safe_relation not in ('self', 'inside', 'site_member', 'nearby', 'administrative', 'none')
      or safe_inference_version is null
      or char_length(safe_inference_version) > 80
      or safe_distance < 0
      or safe_distance > 80
      or safe_confidence < 0
      or safe_confidence > 1
      or char_length(coalesce(safe_reference_name, '')) > 200
      or char_length(coalesce(safe_reference_kind, '')) > 80
      or char_length(coalesce(safe_proposed_name, '')) > 120
      or char_length(coalesce(safe_applied_name, '')) > 120
      or char_length(coalesce(safe_fallback_name, '')) > 200 then
      raise exception 'osm_court_name_row_invalid:%', coalesce(safe_court_id, '') using errcode = '22023';
    end if;
    if safe_decision <> 'unresolved' and (safe_reference_name is null or safe_reference_kind is null) then
      raise exception 'osm_court_name_reference_required:%', safe_court_id using errcode = '22023';
    end if;
    if safe_decision = 'auto_apply' and not (
      (safe_relation in ('self', 'inside', 'site_member') and coalesce(safe_distance, 0) = 0)
      or (safe_relation = 'nearby' and safe_distance between 0 and 30)
    ) then
      raise exception 'osm_court_name_auto_threshold_invalid:%', safe_court_id using errcode = '22023';
    end if;
    if safe_decision = 'review_required'
      and not (safe_relation = 'nearby' and safe_distance > 30 and safe_distance <= 80) then
      raise exception 'osm_court_name_review_threshold_invalid:%', safe_court_id using errcode = '22023';
    end if;
    if safe_decision = 'review_required'
      and safe_applied_name is not null
      and safe_fallback_name is null then
      raise exception 'osm_court_name_review_fallback_required:%', safe_court_id using errcode = '22023';
    end if;
    if safe_decision = 'administrative_fallback' and safe_relation <> 'administrative' then
      raise exception 'osm_court_name_fallback_relation_invalid:%', safe_court_id using errcode = '22023';
    end if;
    if safe_decision = 'unresolved' and safe_applied_name is not null then
      raise exception 'osm_court_name_unresolved_apply_invalid:%', safe_court_id using errcode = '22023';
    end if;

    select * into court_row
    from public.approved_courts
    where id = safe_court_id
    for update;
    if not found then
      raise exception 'court_not_found:%', safe_court_id using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.court_source_records source
      where source.court_id = safe_court_id and source.provider = 'openstreetmap'
    ) then
      raise exception 'osm_court_source_required:%', safe_court_id using errcode = '22023';
    end if;
    if safe_applied_name is not null then
      safe_applied_name := public.rankball_court_facility_base(
        safe_applied_name,
        court_row.sigungu,
        court_row.court_unit
      );
      if safe_applied_name is null then
        raise exception 'osm_court_name_applied_facility_invalid:%', safe_court_id using errcode = '22023';
      end if;
    end if;
    if safe_decision = 'review_required'
      and safe_applied_name is not null
      and safe_applied_name is distinct from public.rankball_court_facility_base(
        safe_fallback_name,
        court_row.sigungu,
        court_row.court_unit
      ) then
      raise exception 'osm_court_name_review_candidate_not_applicable:%', safe_court_id using errcode = '22023';
    end if;

    next_application_status := case when safe_applied_name is null then 'not_applicable' else 'pending' end;
    insert into public.court_name_evidence (
      court_id, provider, decision, application_status, spatial_relation,
      reference_name, reference_kind, distance_m, confidence, evidence_url,
      fallback_reference_name, fallback_evidence_url, proposed_facility_name,
      applied_facility_name, source_court_url, source_snapshot_date,
      inference_version, run_id, generated_at, applied_at, updated_at
    ) values (
      safe_court_id, 'openstreetmap', safe_decision, next_application_status, safe_relation,
      safe_reference_name, safe_reference_kind, safe_distance, safe_confidence, safe_evidence_url,
      safe_fallback_name, safe_fallback_url, safe_proposed_name,
      safe_applied_name, safe_source_url, safe_snapshot_date,
      safe_inference_version, p_run_id, now_ts, null, now_ts
    )
    on conflict (court_id) do update set
      provider = excluded.provider,
      decision = excluded.decision,
      application_status = excluded.application_status,
      spatial_relation = excluded.spatial_relation,
      reference_name = excluded.reference_name,
      reference_kind = excluded.reference_kind,
      distance_m = excluded.distance_m,
      confidence = excluded.confidence,
      evidence_url = excluded.evidence_url,
      fallback_reference_name = excluded.fallback_reference_name,
      fallback_evidence_url = excluded.fallback_evidence_url,
      proposed_facility_name = excluded.proposed_facility_name,
      applied_facility_name = excluded.applied_facility_name,
      source_court_url = excluded.source_court_url,
      source_snapshot_date = excluded.source_snapshot_date,
      inference_version = excluded.inference_version,
      run_id = excluded.run_id,
      generated_at = excluded.generated_at,
      applied_at = null,
      updated_at = excluded.updated_at;
    evidence_count := evidence_count + 1;

    if not p_apply or safe_applied_name is null then
      continue;
    end if;
    if court_row.name_modification_count > 0 or court_row.name_source = 'manual' then
      update public.court_name_evidence
      set application_status = 'skipped_manual', updated_at = now_ts
      where court_id = safe_court_id;
      skipped_count := skipped_count + 1;
      continue;
    end if;

    begin
    previous_name := court_row.name;
    facility_changed := court_row.facility_name is distinct from safe_applied_name;
    verification_changed := safe_decision in ('review_required', 'administrative_fallback')
      and court_row.verification_status <> 'review_required';
    if not facility_changed and not verification_changed then
      update public.court_name_evidence
      set application_status = 'applied', applied_at = now_ts, updated_at = now_ts
      where court_id = safe_court_id;
      unchanged_count := unchanged_count + 1;
      continue;
    end if;

    if facility_changed then
      update public.approved_courts
      set facility_name = safe_applied_name,
          name_source = 'source',
          source_confidence = safe_confidence,
          verification_status = case when verification_changed then 'review_required' else verification_status end,
          name_modified_at = now_ts,
          name_modified_by = 'system',
          updated_at = now_ts
      where id = safe_court_id
      returning * into court_row;
    else
      update public.approved_courts
      set verification_status = 'review_required',
          updated_at = now_ts
      where id = safe_court_id
      returning * into court_row;
    end if;

    next_application_status := 'applied';
    update public.court_name_evidence
    set application_status = next_application_status,
        applied_at = now_ts,
        updated_at = now_ts
    where court_id = safe_court_id;

    if court_row.name is distinct from previous_name then
      applied_count := applied_count + 1;
      insert into public.court_name_change_log (
        id, court_id, sigungu, previous_name, new_name, facility_name, reason,
        changed_by, changed_by_name, change_source, created_at
      ) values (
        'court_name_osm_' || md5(p_run_id || safe_court_id || court_row.name),
        safe_court_id, court_row.sigungu, previous_name, court_row.name,
        court_row.facility_name, 'OSM 공간결합 명칭 보정', null, 'OSM 공간결합', 'system', now_ts
      ) on conflict (id) do nothing;

      update public.courts
      set name = court_row.name,
          payload = payload || jsonb_build_object(
            'name', court_row.name,
            'canonicalName', court_row.name,
            'canonicalBaseName', court_row.name,
            'baseName', court_row.facility_name,
            'facilityName', court_row.facility_name
          )
      where id = safe_court_id;
      update public.matches set court_name = court_row.name where court_id = safe_court_id and court_name is distinct from court_row.name;
      update public.recruiting_posts set court_name = court_row.name where court_id = safe_court_id and court_name is distinct from court_row.name;
      update public.tournaments set court_name = court_row.name where court_id = safe_court_id and court_name is distinct from court_row.name;
      update public.court_reviews set court_name = court_row.name where court_id = safe_court_id and court_name is distinct from court_row.name;
      update public.court_requests
      set name = court_row.name,
          payload = payload || jsonb_build_object(
            'name', court_row.name,
            'canonicalName', court_row.name,
            'canonicalBaseName', court_row.name,
            'baseName', court_row.facility_name,
            'facilityName', court_row.facility_name
          ),
          updated_at = now_ts
      where id = court_row.source_request_id and name is distinct from court_row.name;
    else
      unchanged_count := unchanged_count + 1;
    end if;
    exception
      when unique_violation then
        update public.approved_courts
        set verification_status = 'review_required', updated_at = now_ts
        where id = safe_court_id;
        update public.court_name_evidence
        set application_status = 'skipped_duplicate', applied_at = null, updated_at = now_ts
        where court_id = safe_court_id;
        duplicate_count := duplicate_count + 1;
    end;
  end loop;

  if p_apply and applied_count > 0 then
    insert into public.admin_audit_log (
      id, type, status, target_user_id, created_by, payload, created_at
    ) values (
      'aa_' || md5('osm-court-name:' || p_run_id || ':' || p_rows::text),
      'court_name_osm_spatial_batch', 'committed', null, null,
      jsonb_build_object(
        'runId', p_run_id,
        'evidenceCount', evidence_count,
        'appliedCount', applied_count,
        'unchangedCount', unchanged_count,
        'skippedCount', skipped_count,
        'duplicateCount', duplicate_count,
        'rule', 'self > inside > site_member > nearby_30m > review_80m > administrative'
      ),
      now_ts
    ) on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'evidenceCount', evidence_count,
    'appliedCount', applied_count,
    'unchangedCount', unchanged_count,
    'skippedCount', skipped_count,
    'duplicateCount', duplicate_count
  );
end;
$$;

revoke all on function public.rankball_apply_osm_court_name_evidence(jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.rankball_apply_osm_court_name_evidence(jsonb, boolean, text) to service_role;

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
  evidence.source_snapshot_date as name_evidence_snapshot_date
from public.approved_courts court
left join public.court_facility_info facility on facility.court_id = court.id
left join public.court_name_evidence evidence on evidence.court_id = court.id;

revoke all on table public.rankball_admin_court_database from public, anon, authenticated;
grant select on table public.rankball_admin_court_database to service_role;

select pg_notify('pgrst', 'reload schema');
