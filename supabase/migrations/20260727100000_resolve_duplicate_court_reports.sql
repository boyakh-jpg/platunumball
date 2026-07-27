begin;

create unique index if not exists reports_court_active_reporter_unique
on public.reports (target_id, user_id)
where type = 'court'
  and coalesce(status, 'open') not in ('dismissed', 'resolved');

create or replace function public.rankball_guard_active_report_duplicate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.type, '') not in (
    'match', 'player', 'court', 'court_review', 'team_emblem', 'team_name', 'affiliation_name'
  ) or coalesce(new.status, 'open') in ('resolved', 'dismissed') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'rankball_report:' || coalesce(new.user_id, '') || ':' || new.type || ':' || coalesce(new.target_id, ''),
    0
  ));

  if exists (
    select 1
    from public.reports
    where user_id = new.user_id
      and type = new.type
      and target_id = new.target_id
      and id <> new.id
      and coalesce(status, 'open') not in ('resolved', 'dismissed')
  ) then
    raise exception 'active_report_duplicate' using errcode = '23505';
  end if;

  return new;
end;
$$;

create or replace function public.rankball_resolve_duplicate_court_report(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_report_id text,
  p_reason text,
  p_feedback text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.reports%rowtype;
  safe_reason text := btrim(coalesce(p_reason, ''));
  safe_feedback text := btrim(coalesce(p_feedback, ''));
  court_result jsonb;
  review_result jsonb;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_discipline_permission_required' using errcode = '42501';
  end if;
  if char_length(safe_reason) < 4 or char_length(safe_reason) > 160
    or char_length(safe_feedback) < 4 or char_length(safe_feedback) > 500 then
    raise exception 'admin_review_detail_invalid' using errcode = '22023';
  end if;

  select *
  into report_row
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if report_row.status <> 'open' then
    raise exception 'report_already_processed' using errcode = '23505';
  end if;
  if report_row.type <> 'court'
    or coalesce(report_row.payload #>> '{courtCorrection,field}', '') <> 'duplicate' then
    raise exception 'duplicate_court_report_required' using errcode = '22023';
  end if;

  court_result := public.rankball_admin_review_court_with_auto_unit(
    p_actor_profile_id,
    p_actor_admin_level,
    report_row.target_id,
    'duplicate',
    '{}'::jsonb,
    safe_reason
  );

  review_result := public.rankball_commit_admin_review_action(
    p_actor_profile_id,
    p_actor_admin_level,
    report_row.id,
    'validReport',
    null,
    3,
    safe_reason,
    safe_feedback
  );

  update public.reports
  set resolution = coalesce(resolution, '{}'::jsonb)
        || jsonb_build_object('actionType', 'markCourtDuplicate'),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'resolution',
        coalesce(resolution, '{}'::jsonb)
          || jsonb_build_object('actionType', 'markCourtDuplicate')
      )
  where id = report_row.id;

  update public.admin_audit_log
  set payload = coalesce(payload, '{}'::jsonb)
        || jsonb_build_object('actionType', 'markCourtDuplicate')
  where report_id = report_row.id
    and type = 'report_action'
    and status = 'committed';

  update public.notifications
  set payload = coalesce(payload, '{}'::jsonb)
        || jsonb_build_object('actionType', 'markCourtDuplicate')
  where payload ->> 'reportId' = report_row.id
    and type = 'report';

  return coalesce(review_result, '{}'::jsonb) || jsonb_build_object(
    'actionType', 'markCourtDuplicate',
    'courtReview', court_result
  );
end;
$$;

revoke all on function public.rankball_guard_active_report_duplicate() from public, anon, authenticated;
revoke all on function public.rankball_resolve_duplicate_court_report(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_resolve_duplicate_court_report(text, integer, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
