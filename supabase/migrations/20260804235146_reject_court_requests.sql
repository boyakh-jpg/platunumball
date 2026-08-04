begin;

create or replace function public.rankball_reject_court_request(
  actor_profile_id text,
  actor_admin_level integer,
  request_id text,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  safe_reason text := btrim(coalesce(reason, ''));
  now_ts timestamptz := now();
begin
  if public.rankball_admin_level_for_profile(actor_profile_id, actor_admin_level) < 30 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if char_length(safe_reason) < 4 or char_length(safe_reason) > 500 then
    raise exception 'court_rejection_reason_invalid' using errcode = '22023';
  end if;

  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;
  if request_row.status = 'rejected' then
    return jsonb_build_object('ok', true, 'requestId', request_row.id, 'status', 'rejected', 'duplicate', true);
  end if;
  if request_row.status <> 'pending' or exists (
    select 1 from public.reports
    where type = 'court_request' and target_id = request_row.id and status = 'open'
  ) then
    raise exception 'court_request_not_pending' using errcode = '23505';
  end if;

  update public.court_requests
  set status = 'rejected',
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'status', 'rejected',
        'rejectedAt', now_ts,
        'rejectedBy', actor_profile_id,
        'rejectionReason', safe_reason,
        'rejectionSource', 'admin_review',
        'reportReviewPending', false
      ),
      updated_at = now_ts
  where id = request_row.id;

  insert into public.admin_audit_log (
    id, type, status, request_id, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5('court-rejection' || request_row.id || actor_profile_id || now_ts::text),
    'court_rejection', 'committed', request_row.id, request_row.requested_by, actor_profile_id,
    jsonb_build_object('requestId', request_row.id, 'reason', safe_reason), now_ts
  ) on conflict (id) do nothing;

  if request_row.requested_by is not null then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
    ) values (
      'n_' || md5('court-rejected' || request_row.id || now_ts::text),
      request_row.requested_by, request_row.requested_by,
      '구장 등록 반려', request_row.name || ' 구장 등록요청이 반려되었습니다. 사유: ' || safe_reason,
      'orange', 'court_request',
      jsonb_build_object('courtRequestId', request_row.id, 'reason', safe_reason), now_ts, now_ts
    ) on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'requestId', request_row.id,
    'status', 'rejected',
    'reason', safe_reason
  );
end;
$$;

revoke all on function public.rankball_reject_court_request(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.rankball_reject_court_request(text, integer, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
