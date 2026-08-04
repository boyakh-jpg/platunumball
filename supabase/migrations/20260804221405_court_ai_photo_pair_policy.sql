begin;

alter table public.court_request_evidence
  drop constraint if exists court_request_evidence_photo_keys_check;

alter table public.court_request_evidence
  add constraint court_request_evidence_photo_keys_check check (
    jsonb_typeof(photo_keys) = 'array' and jsonb_array_length(photo_keys) between 1 and 2
  ) not valid;

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
  live_location_verified boolean := false;
  photo_location_status text := 'unavailable';
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
  if coalesce(request_row.payload->>'type', '') not in ('실내', '야외')
    or coalesce(request_row.payload->>'publicAccess', '') <> 'public' then
    raise exception 'court_auto_approval_scope_required' using errcode = '42501';
  end if;

  live_location_verified := coalesce(
    evidence_row.field_accuracy_meters <= 20
      and evidence_row.field_distance_meters <= 150
      and evidence_row.field_captured_at >= now() - interval '10 minutes'
      and evidence_row.field_captured_at <= now() + interval '1 minute',
    false
  );
  photo_location_status := coalesce(evidence_row.ai_result->'photoLocation'->>'status', 'unavailable');

  if jsonb_array_length(evidence_row.photo_keys) <> 2
    or photo_location_status = 'mismatch'
    or (not live_location_verified and photo_location_status <> 'matched')
    or evidence_row.ai_status <> 'complete'
    or evidence_row.ai_confidence is null or evidence_row.ai_confidence < 0.97 then
    raise exception 'court_auto_approval_evidence_required' using errcode = '42501';
  end if;
  if not coalesce((evidence_row.ai_result->'checks'->>'courtEvidence')::boolean, false)
    or not coalesce((evidence_row.ai_result->'checks'->>'evidenceCoverage')::boolean, false)
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

revoke all on function public.rankball_auto_approve_court_request(text) from public, anon, authenticated;
grant execute on function public.rankball_auto_approve_court_request(text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
