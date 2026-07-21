-- A court request report pauses approval, but only an accepted report may lower trust.

create or replace function public.rankball_report_court_request(
  actor_profile_id text,
  request_id text,
  reason text default '허위 구장 등록'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  duplicate_report_id text;
  report_id text;
  now_ts timestamptz := now();
  safe_reason text := coalesce(nullif(btrim(reason), ''), '허위 구장 등록');
  notify_requester boolean := false;
begin
  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;

  if request_row.status not in ('pending', 'reported') then
    raise exception 'court_request_not_reportable' using errcode = '23514';
  end if;

  if request_row.requested_by = actor_profile_id then
    raise exception 'cannot_report_own_court_request' using errcode = '42501';
  end if;

  select id into duplicate_report_id
  from public.reports
  where type = 'court_request'
    and target_id = request_row.id
    and user_id = actor_profile_id
    and status <> 'dismissed'
  limit 1;

  if duplicate_report_id is not null then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'reportId', duplicate_report_id,
      'penaltyApplied', false
    );
  end if;

  select not exists (
    select 1
    from public.reports
    where type = 'court_request'
      and target_id = request_row.id
      and status = 'open'
  ) into notify_requester;

  report_id := 'r_' || md5(request_row.id || actor_profile_id || now_ts::text);

  insert into public.reports (
    id,
    type,
    target_id,
    user_id,
    reported_user_ids,
    reason,
    status,
    payload,
    created_at,
    updated_at
  )
  values (
    report_id,
    'court_request',
    request_row.id,
    actor_profile_id,
    to_jsonb(array[request_row.requested_by]),
    safe_reason,
    'open',
    jsonb_build_object(
      'id', report_id,
      'type', 'court_request',
      'targetId', request_row.id,
      'by', actor_profile_id,
      'reportedUserIds', jsonb_build_array(request_row.requested_by),
      'reason', safe_reason,
      'status', 'open',
      'penaltyApplied', false,
      'createdAt', now_ts
    ),
    now_ts,
    now_ts
  );

  update public.court_requests
  set
    status = 'reported',
    payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
      'status', 'reported',
      'reportReviewPending', true,
      'latestReportId', report_id,
      'latestReportedAt', now_ts
    ),
    updated_at = now_ts
  where id = request_row.id;

  if notify_requester and request_row.requested_by is not null then
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
      'n_' || md5('court-report-review' || request_row.id || now_ts::text),
      request_row.requested_by,
      request_row.requested_by,
      '구장 등록요청 검토 중',
      request_row.name || ' 등록요청에 신고가 접수되어 운영자가 확인 중입니다. 판정 전에는 신뢰도에 영향이 없습니다.',
      'orange',
      'court_request',
      jsonb_build_object('courtRequestId', request_row.id, 'reportId', report_id, 'penaltyApplied', false),
      now_ts,
      now_ts
    )
    on conflict (id) do nothing;
  end if;

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
    'n_' || md5('court-report-reporter' || request_row.id || actor_profile_id || now_ts::text),
    actor_profile_id,
    actor_profile_id,
    '구장 등록요청 신고 접수',
    request_row.name || ' 등록요청 신고가 접수되었습니다. 운영자 인정 전에는 요청자 신뢰도가 차감되지 않습니다.',
    'orange',
    'court_request',
    jsonb_build_object('courtRequestId', request_row.id, 'reportId', report_id, 'penaltyApplied', false),
    now_ts,
    now_ts
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'requestId', request_row.id,
    'reportId', report_id,
    'requestStatus', 'reported',
    'penaltyApplied', false
  );
end;
$$;

revoke all on function public.rankball_report_court_request(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_report_court_request(text, text, text) to service_role;

create or replace function public.rankball_apply_court_request_report_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  action_type text := coalesce(new.resolution->>'actionType', '');
  trust_penalty integer := public.rankball_rating_policy_number(
    array['trust', 'falseCourtReportPenalty'],
    8,
    0,
    20
  )::integer;
  next_trust integer;
  penalty_already_applied boolean := false;
  has_accepted_report boolean := false;
  has_open_report boolean := false;
  now_ts timestamptz := coalesce(new.resolved_at, now());
begin
  if old.type <> 'court_request'
    or old.status <> 'open'
    or new.status not in ('resolved', 'dismissed') then
    return new;
  end if;

  select * into request_row
  from public.court_requests
  where id = new.target_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;

  penalty_already_applied := coalesce((request_row.payload->>'trustPenaltyApplied')::boolean, false);

  if new.status = 'resolved' then
    if not penalty_already_applied then
      update public.profiles
      set
        trust_score = greatest(0, least(100, coalesce(trust_score, 80) - trust_penalty)),
        updated_at = now_ts
      where id = request_row.requested_by
      returning trust_score into next_trust;

      if not found then
        raise exception 'court_request_profile_not_found' using errcode = 'P0002';
      end if;
    else
      select trust_score into next_trust
      from public.profiles
      where id = request_row.requested_by;
    end if;

    update public.court_requests
    set
      status = 'rejected',
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'status', 'rejected',
        'reportReviewPending', false,
        'trustPenaltyApplied', true,
        'trustPenalty', trust_penalty,
        'trustPenaltyAppliedAt', coalesce(payload->'trustPenaltyAppliedAt', to_jsonb(now_ts)),
        'trustPenaltyReportId', coalesce(payload->'trustPenaltyReportId', to_jsonb(new.id)),
        'trustPenaltyActionType', coalesce(payload->'trustPenaltyActionType', to_jsonb(action_type)),
        'requesterTrustAfterReview', next_trust,
        'reviewedAt', now_ts,
        'reviewedBy', new.resolved_by
      ),
      updated_at = now_ts
    where id = request_row.id;

    if not penalty_already_applied and request_row.requested_by is not null then
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
        'n_' || md5('court-report-accepted' || request_row.id || new.id || now_ts::text),
        request_row.requested_by,
        request_row.requested_by,
        '구장 등록요청 신고 인정',
        case
          when trust_penalty > 0 then request_row.name || ' 등록요청 신고가 인정되어 신뢰도 ' || trust_penalty::text || '점이 차감되었습니다. 현재 ' || coalesce(next_trust, 80)::text || '점입니다.'
          else request_row.name || ' 등록요청 신고가 인정되었습니다. 현재 정책상 신뢰도 차감은 없습니다.'
        end,
        'orange',
        'court_request',
        jsonb_build_object(
          'courtRequestId', request_row.id,
          'reportId', new.id,
          'penaltyApplied', trust_penalty > 0,
          'trustPenalty', trust_penalty,
          'requesterTrustAfterReview', next_trust
        ),
        now_ts,
        now_ts
      )
      on conflict (id) do nothing;
    end if;

    return new;
  end if;

  if new.status = 'dismissed' then
    select exists (
      select 1
      from public.reports report
      where report.type = 'court_request'
        and report.target_id = request_row.id
        and report.status = 'resolved'
    ) into has_accepted_report;

    select exists (
      select 1
      from public.reports report
      where report.type = 'court_request'
        and report.target_id = request_row.id
        and report.status = 'open'
        and report.id <> new.id
    ) into has_open_report;

    update public.court_requests
    set
      status = case
        when penalty_already_applied or has_accepted_report then 'rejected'
        when has_open_report then 'reported'
        else 'pending'
      end,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'status', case
          when penalty_already_applied or has_accepted_report then 'rejected'
          when has_open_report then 'reported'
          else 'pending'
        end,
        'reportReviewPending', has_open_report,
        'lastDismissedReportId', new.id,
        'lastReviewedAt', now_ts,
        'lastReviewedBy', new.resolved_by
      ),
      updated_at = now_ts
    where id = request_row.id;
  end if;

  return new;
end;
$$;

drop trigger if exists rankball_apply_court_request_report_resolution on public.reports;
create trigger rankball_apply_court_request_report_resolution
after update of status on public.reports
for each row
execute function public.rankball_apply_court_request_report_resolution();

revoke all on function public.rankball_apply_court_request_report_resolution() from public, anon, authenticated, service_role;

create or replace function public.rankball_guard_approved_court_request_report()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'approved' and old.status <> 'pending' then
    raise exception 'court_request_not_pending' using errcode = '23514';
  end if;
  if old.status = 'approved' and new.status <> 'approved' then
    raise exception 'approved_court_request_cannot_be_changed' using errcode = '23514';
  end if;
  if old.status = 'rejected' and new.status <> 'rejected' then
    raise exception 'rejected_court_request_cannot_be_changed' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_guard_approved_court_request_report on public.court_requests;
create trigger rankball_guard_approved_court_request_report
before update of status on public.court_requests
for each row
execute function public.rankball_guard_approved_court_request_report();

revoke all on function public.rankball_guard_approved_court_request_report() from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
