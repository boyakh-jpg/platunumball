create or replace function public.rankball_admin_update_court_name_evidence(
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
  evidence_row public.court_name_evidence%rowtype;
  actor_name text;
  safe_reason text := btrim(coalesce(p_reason, ''));
  now_ts timestamptz := clock_timestamp();
  before_snapshot jsonb;
  after_snapshot jsonb;
  changes jsonb := '{}'::jsonb;
  invalid_keys text[];
  field_name text;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_court_id, '')), '') is null then
    raise exception 'court_id_required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb or pg_column_size(p_patch) > 32768 then
    raise exception 'court_name_evidence_patch_invalid' using errcode = '22023';
  end if;
  if char_length(safe_reason) < 4 or char_length(safe_reason) > 160 then
    raise exception 'court_update_reason_required' using errcode = '22023';
  end if;

  select array_agg(key order by key)
  into invalid_keys
  from jsonb_object_keys(p_patch) key
  where key <> all (array[
    'nameEvidenceDecision',
    'nameEvidenceApplicationStatus',
    'nameEvidenceProposedFacility',
    'nameEvidenceAppliedFacility'
  ]);
  if invalid_keys is not null then
    raise exception 'court_name_evidence_patch_key_invalid:%', array_to_string(invalid_keys, ',') using errcode = '22023';
  end if;

  if p_patch ? 'nameEvidenceDecision' and (
    p_patch -> 'nameEvidenceDecision' = 'null'::jsonb
    or jsonb_typeof(p_patch -> 'nameEvidenceDecision') <> 'string'
    or p_patch ->> 'nameEvidenceDecision' not in ('auto_apply', 'review_required', 'administrative_fallback', 'unresolved')
  ) then
    raise exception 'court_name_evidence_decision_invalid' using errcode = '22023';
  end if;
  if p_patch ? 'nameEvidenceApplicationStatus' and (
    p_patch -> 'nameEvidenceApplicationStatus' = 'null'::jsonb
    or jsonb_typeof(p_patch -> 'nameEvidenceApplicationStatus') <> 'string'
    or p_patch ->> 'nameEvidenceApplicationStatus' not in ('pending', 'applied', 'unchanged', 'skipped_manual', 'skipped_duplicate', 'not_applicable')
  ) then
    raise exception 'court_name_evidence_application_status_invalid' using errcode = '22023';
  end if;

  foreach field_name in array array['nameEvidenceProposedFacility', 'nameEvidenceAppliedFacility']
  loop
    if p_patch ? field_name then
      if p_patch -> field_name <> 'null'::jsonb and jsonb_typeof(p_patch -> field_name) <> 'string' then
        raise exception 'court_name_evidence_text_invalid:%', field_name using errcode = '22023';
      end if;
      if char_length(btrim(coalesce(p_patch ->> field_name, ''))) > 160 then
        raise exception 'court_name_evidence_text_too_long:%', field_name using errcode = '22023';
      end if;
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('rankball:court-admin-update:' || p_court_id, 0));
  select * into court_row
  from public.approved_courts
  where id = p_court_id
  for update;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;

  select * into evidence_row
  from public.court_name_evidence
  where court_id = p_court_id
  for update;
  if not found then
    raise exception 'court_name_evidence_not_found' using errcode = 'P0002';
  end if;

  before_snapshot := jsonb_build_object(
    'nameEvidenceDecision', evidence_row.decision,
    'nameEvidenceApplicationStatus', evidence_row.application_status,
    'nameEvidenceProposedFacility', evidence_row.proposed_facility_name,
    'nameEvidenceAppliedFacility', evidence_row.applied_facility_name
  );

  update public.court_name_evidence
  set decision = case
        when p_patch ? 'nameEvidenceDecision' then p_patch ->> 'nameEvidenceDecision'
        else decision
      end,
      application_status = case
        when p_patch ? 'nameEvidenceApplicationStatus' then p_patch ->> 'nameEvidenceApplicationStatus'
        else application_status
      end,
      proposed_facility_name = case
        when p_patch ? 'nameEvidenceProposedFacility' then nullif(btrim(p_patch ->> 'nameEvidenceProposedFacility'), '')
        else proposed_facility_name
      end,
      applied_facility_name = case
        when p_patch ? 'nameEvidenceAppliedFacility' then nullif(btrim(p_patch ->> 'nameEvidenceAppliedFacility'), '')
        else applied_facility_name
      end,
      applied_at = case
        when p_patch ->> 'nameEvidenceApplicationStatus' = 'applied' then now_ts
        when p_patch ? 'nameEvidenceApplicationStatus' then null
        else applied_at
      end,
      updated_at = now_ts
  where court_id = p_court_id
  returning * into evidence_row;

  after_snapshot := jsonb_build_object(
    'nameEvidenceDecision', evidence_row.decision,
    'nameEvidenceApplicationStatus', evidence_row.application_status,
    'nameEvidenceProposedFacility', evidence_row.proposed_facility_name,
    'nameEvidenceAppliedFacility', evidence_row.applied_facility_name
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

  insert into public.admin_audit_log (
    id, type, status, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5('court-name-evidence-update:' || court_row.id || now_ts::text || p_actor_profile_id),
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
    'courtId', court_row.id,
    'evidence', after_snapshot,
    'changedFields', (select jsonb_agg(key order by key) from jsonb_object_keys(changes) key)
  );
end;
$$;

revoke all on function public.rankball_admin_update_court_name_evidence(text, integer, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.rankball_admin_update_court_name_evidence(text, integer, text, jsonb, text) to service_role;

create or replace function public.rankball_admin_update_courts_batch(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_updates jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  update_item jsonb;
  core_patch jsonb;
  evidence_patch jsonb;
  core_result jsonb;
  evidence_result jsonb;
  update_result jsonb;
  results jsonb := '[]'::jsonb;
  update_count integer := 0;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_updates) is distinct from 'array'
    or jsonb_array_length(p_updates) < 1
    or jsonb_array_length(p_updates) > 100
    or pg_column_size(p_updates) > 524288 then
    raise exception 'court_batch_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_updates) as items(item)
    where jsonb_typeof(item) is distinct from 'object'
      or nullif(btrim(coalesce(item->>'courtId', '')), '') is null
      or jsonb_typeof(item->'patch') is distinct from 'object'
      or item->'patch' = '{}'::jsonb
      or pg_column_size(item->'patch') > 32768
  ) then
    raise exception 'court_batch_item_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_updates) as items(item)
    group by item->>'courtId'
    having count(*) > 1
  ) then
    raise exception 'court_batch_duplicate_court' using errcode = '22023';
  end if;

  for update_item in select item from jsonb_array_elements(p_updates) as items(item)
  loop
    select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    into evidence_patch
    from jsonb_each(update_item->'patch') entry
    where entry.key = any (array[
      'nameEvidenceDecision',
      'nameEvidenceApplicationStatus',
      'nameEvidenceProposedFacility',
      'nameEvidenceAppliedFacility'
    ]);

    select coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
    into core_patch
    from jsonb_each(update_item->'patch') entry
    where entry.key <> all (array[
      'nameEvidenceDecision',
      'nameEvidenceApplicationStatus',
      'nameEvidenceProposedFacility',
      'nameEvidenceAppliedFacility'
    ]);

    update_result := jsonb_build_object('courtId', update_item->>'courtId');
    if core_patch <> '{}'::jsonb then
      core_result := public.rankball_admin_update_court(
        p_actor_profile_id,
        p_actor_admin_level,
        update_item->>'courtId',
        core_patch,
        p_reason
      );
      update_result := update_result || jsonb_build_object('core', core_result);
    end if;
    if evidence_patch <> '{}'::jsonb then
      evidence_result := public.rankball_admin_update_court_name_evidence(
        p_actor_profile_id,
        p_actor_admin_level,
        update_item->>'courtId',
        evidence_patch,
        p_reason
      );
      update_result := update_result || jsonb_build_object('evidence', evidence_result);
    end if;

    results := results || jsonb_build_array(update_result);
    update_count := update_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'updatedCount', update_count,
    'results', results
  );
end;
$$;

revoke all on function public.rankball_admin_update_courts_batch(text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.rankball_admin_update_courts_batch(text, integer, jsonb, text) to service_role;

select pg_notify('pgrst', 'reload schema');
