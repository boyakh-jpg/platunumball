begin;

create table if not exists public.court_request_evidence (
  request_id text primary key references public.court_requests(id) on delete cascade,
  requested_by text not null,
  photo_keys jsonb not null default '[]'::jsonb,
  image_hashes jsonb not null default '[]'::jsonb,
  field_lat double precision not null,
  field_lng double precision not null,
  field_accuracy_meters double precision not null,
  field_distance_meters double precision not null,
  field_captured_at timestamptz not null,
  ai_model text,
  prompt_version text,
  ai_status text not null default 'pending',
  ai_confidence double precision,
  ai_result jsonb not null default '{}'::jsonb,
  decision text not null default 'manual_review',
  auto_approved boolean not null default false,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_request_evidence_photo_keys_check check (
    jsonb_typeof(photo_keys) = 'array' and jsonb_array_length(photo_keys) between 1 and 4
  ),
  constraint court_request_evidence_hashes_check check (
    jsonb_typeof(image_hashes) = 'array' and jsonb_array_length(image_hashes) = jsonb_array_length(photo_keys)
  ),
  constraint court_request_evidence_ai_status_check check (ai_status in ('pending', 'complete', 'failed', 'unavailable')),
  constraint court_request_evidence_decision_check check (decision in ('manual_review', 'auto_approve')),
  constraint court_request_evidence_confidence_check check (ai_confidence is null or ai_confidence between 0 and 1)
);

alter table public.court_request_evidence enable row level security;
revoke all on table public.court_request_evidence from public, anon, authenticated;

create or replace function public.rankball_submit_court_request_with_evidence(
  actor_profile_id text,
  request_payload jsonb,
  evidence_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  submit_result jsonb;
  safe_request_id text;
  safe_photo_keys jsonb := coalesce(evidence_payload->'photoKeys', '[]'::jsonb);
  safe_image_hashes jsonb := coalesce(evidence_payload->'imageHashes', '[]'::jsonb);
  object_key jsonb;
begin
  submit_result := public.rankball_submit_court_request(actor_profile_id, request_payload);
  safe_request_id := nullif(submit_result->>'requestId', '');
  if safe_request_id is null then
    raise exception 'court_request_id_missing' using errcode = '22023';
  end if;
  if jsonb_typeof(safe_photo_keys) <> 'array'
    or jsonb_array_length(safe_photo_keys) not between 1 and 4
    or jsonb_typeof(safe_image_hashes) <> 'array'
    or jsonb_array_length(safe_image_hashes) <> jsonb_array_length(safe_photo_keys)
    or (select count(distinct value) from jsonb_array_elements_text(safe_image_hashes)) <> jsonb_array_length(safe_image_hashes) then
    raise exception 'court_evidence_photo_count_invalid' using errcode = '22023';
  end if;
  for object_key in select value from jsonb_array_elements(safe_photo_keys)
  loop
    if trim(both '"' from object_key::text) !~ ('^court-requests/' || replace(safe_request_id, '-', '\-') || '/[a-f0-9]{64}\.webp$') then
      raise exception 'court_evidence_object_key_invalid' using errcode = '22023';
    end if;
  end loop;

  insert into public.court_request_evidence (
    request_id, requested_by, photo_keys, image_hashes, field_lat, field_lng,
    field_accuracy_meters, field_distance_meters, field_captured_at, ai_model, prompt_version,
    ai_status, ai_confidence, ai_result, decision, analyzed_at, updated_at
  ) values (
    safe_request_id,
    actor_profile_id,
    safe_photo_keys,
    safe_image_hashes,
    nullif(evidence_payload->>'fieldLat', '')::double precision,
    nullif(evidence_payload->>'fieldLng', '')::double precision,
    nullif(evidence_payload->>'fieldAccuracyMeters', '')::double precision,
    nullif(evidence_payload->>'fieldDistanceMeters', '')::double precision,
    nullif(evidence_payload->>'fieldCapturedAt', '')::timestamptz,
    nullif(evidence_payload->>'aiModel', ''),
    nullif(evidence_payload->>'promptVersion', ''),
    coalesce(nullif(evidence_payload->>'aiStatus', ''), 'unavailable'),
    nullif(evidence_payload->>'aiConfidence', '')::double precision,
    coalesce(evidence_payload->'aiResult', '{}'::jsonb),
    case when evidence_payload->>'decision' = 'auto_approve' then 'auto_approve' else 'manual_review' end,
    now(),
    now()
  )
  on conflict (request_id) do update set
    photo_keys = excluded.photo_keys,
    image_hashes = excluded.image_hashes,
    field_lat = excluded.field_lat,
    field_lng = excluded.field_lng,
    field_accuracy_meters = excluded.field_accuracy_meters,
    field_distance_meters = excluded.field_distance_meters,
    field_captured_at = excluded.field_captured_at,
    ai_model = excluded.ai_model,
    prompt_version = excluded.prompt_version,
    ai_status = excluded.ai_status,
    ai_confidence = excluded.ai_confidence,
    ai_result = excluded.ai_result,
    decision = excluded.decision,
    analyzed_at = excluded.analyzed_at,
    updated_at = now();

  return submit_result;
end;
$$;

create or replace function public.rankball_auto_approve_court_request(request_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  evidence_row public.court_request_evidence%rowtype;
  requester_trust integer := 0;
  prior_approved_count integer := 0;
  automation_admin_id text;
  automation_admin_level integer := 0;
  approval_result jsonb;
  approved_court_id text;
begin
  select * into request_row from public.court_requests where id = request_id for update;
  if not found then raise exception 'court_request_not_found' using errcode = 'P0002'; end if;
  if request_row.status <> 'pending' then raise exception 'court_request_not_pending' using errcode = '23505'; end if;

  select * into evidence_row from public.court_request_evidence where request_id = request_row.id for update;
  if not found or evidence_row.decision <> 'auto_approve' then
    raise exception 'court_auto_approval_not_eligible' using errcode = '42501';
  end if;

  select coalesce(trust_score, 0) into requester_trust from public.profiles where id = request_row.requested_by;
  select count(*) into prior_approved_count
  from public.court_requests
  where requested_by = request_row.requested_by and status = 'approved' and id <> request_row.id;

  if requester_trust < 90 and prior_approved_count < 2 then raise exception 'court_auto_approval_trust_required' using errcode = '42501'; end if;
  if request_row.payload->>'type' <> '야외' or request_row.payload->>'publicAccess' <> 'public' then raise exception 'court_auto_approval_scope_required' using errcode = '42501'; end if;
  if jsonb_array_length(evidence_row.photo_keys) < 2
    or evidence_row.field_accuracy_meters is null or evidence_row.field_accuracy_meters > 20
    or evidence_row.field_distance_meters is null or evidence_row.field_distance_meters > 30
    or evidence_row.field_captured_at < now() - interval '10 minutes'
    or evidence_row.field_captured_at > now() + interval '1 minute'
    or evidence_row.ai_status <> 'complete'
    or evidence_row.ai_confidence is null or evidence_row.ai_confidence < 0.97 then
    raise exception 'court_auto_approval_evidence_required' using errcode = '42501';
  end if;
  if not coalesce((evidence_row.ai_result->'checks'->>'courtVisible')::boolean, false)
    or not coalesce((evidence_row.ai_result->'checks'->>'hoopVisible')::boolean, false)
    or not coalesce((evidence_row.ai_result->'checks'->>'overviewVisible')::boolean, false)
    or not coalesce((evidence_row.ai_result->'checks'->>'layoutMatches')::boolean, false)
    or not coalesce((evidence_row.ai_result->'checks'->>'authenticImages')::boolean, false) then
    raise exception 'court_auto_approval_ai_checks_required' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.approved_courts approved
    where coalesce(approved.status, 'active') = 'active'
      and public.rankball_court_distance_m(request_row.lat, request_row.lng, approved.lat, approved.lng) <= 30
  ) or exists (
    select 1 from public.court_requests pending
    where pending.id <> request_row.id and pending.status in ('pending', 'reported')
      and public.rankball_court_distance_m(request_row.lat, request_row.lng, pending.lat, pending.lng) <= 30
  ) then
    raise exception 'court_auto_approval_nearby_duplicate' using errcode = '23505';
  end if;

  select appointment.user_id,
    case appointment.grade when 'owner' then 100 when 'senior' then 80 when 'regionManager' then 60 when 'matchManager' then 50 else 30 end
  into automation_admin_id, automation_admin_level
  from public.admin_appointments appointment
  where appointment.role = 'admin' and appointment.status = 'active'
    and appointment.grade in ('owner', 'senior', 'regionManager', 'matchManager', 'support')
    and (appointment.starts_at is null or appointment.starts_at <= now())
    and (appointment.ends_at is null or appointment.ends_at >= now())
  order by case appointment.grade when 'owner' then 100 when 'senior' then 80 when 'regionManager' then 60 when 'matchManager' then 50 else 30 end desc
  limit 1;
  if automation_admin_id is null then raise exception 'court_auto_approval_admin_unavailable' using errcode = '55000'; end if;

  approval_result := public.rankball_approve_court_request(
    automation_admin_id,
    automation_admin_level,
    request_row.id,
    jsonb_build_object('approvedName', request_row.name, 'addressVerified', true, 'multipleCourtsVerified', false, 'source', 'ai')
  );
  approved_court_id := approval_result->>'approvedCourtId';

  update public.approved_courts
  set approved_by = 'system:court-ai',
      payload = payload || jsonb_build_object('approvedBy', 'system:court-ai', 'approvalSource', 'ai'),
      updated_at = now()
  where id = approved_court_id;
  update public.court_requests
  set payload = payload || jsonb_build_object('approvedBy', 'system:court-ai', 'approvalSource', 'ai'), updated_at = now()
  where id = request_row.id;
  update public.court_request_evidence
  set auto_approved = true, updated_at = now()
  where request_id = request_row.id;
  update public.admin_audit_log
  set type = 'court_auto_approval', created_by = 'system:court-ai',
      payload = payload || jsonb_build_object('source', 'ai', 'model', evidence_row.ai_model, 'promptVersion', evidence_row.prompt_version, 'confidence', evidence_row.ai_confidence)
  where request_id = request_row.id and type = 'court_approval' and created_by = automation_admin_id;

  return approval_result || jsonb_build_object('autoApproved', true);
end;
$$;

revoke all on function public.rankball_submit_court_request_with_evidence(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_auto_approve_court_request(text) from public, anon, authenticated;
grant execute on function public.rankball_submit_court_request_with_evidence(text, jsonb, jsonb) to service_role;
grant execute on function public.rankball_auto_approve_court_request(text) to service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values
  ('general', 'rankball_submit_court_request_with_evidence', 'rankball_submit_court_request_with_evidence', 'public.rankball_submit_court_request_with_evidence(text,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_auto_approve_court_request', 'rankball_auto_approve_court_request', 'public.rankball_auto_approve_court_request(text)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

select pg_notify('pgrst', 'reload schema');

commit;
