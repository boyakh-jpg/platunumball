alter table public.teams
  add column if not exists emblem_violation_count integer not null default 0,
  add column if not exists emblem_upload_blocked_until timestamptz,
  add column if not exists emblem_moderated_at timestamptz,
  add column if not exists emblem_moderation_reason text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_violation_count_check') then
    alter table public.teams
      add constraint teams_emblem_violation_count_check
      check (emblem_violation_count >= 0);
  end if;
end $$;

create unique index if not exists reports_team_emblem_active_reporter_unique
on public.reports (target_id, user_id)
where type = 'team_emblem'
  and coalesce(status, 'open') not in ('resolved', 'dismissed');

create or replace function public.rankball_update_team_emblem(
  p_actor_profile_id text,
  p_team_id text,
  p_emblem_key text,
  p_expected_emblem_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_team public.teams%rowtype;
  safe_team_id text := btrim(coalesce(p_team_id, ''));
  safe_emblem_key text := nullif(btrim(p_emblem_key), '');
  safe_expected_key text := nullif(btrim(p_expected_emblem_key), '');
  previous_emblem_key text;
  expected_prefix text;
  now_at timestamptz := clock_timestamp();
  next_allowed_at timestamptz;
  new_upload boolean := false;
begin
  select * into current_team
  from public.teams
  where id = safe_team_id
    and deleted_at is null
  for update;

  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = safe_team_id and user_id = p_actor_profile_id and role = 'captain'
  ) then
    raise exception 'team_emblem_permission_denied' using errcode = '42501';
  end if;
  if current_team.emblem_key is distinct from safe_expected_key then
    raise exception 'team_emblem_conflict' using errcode = '40001';
  end if;

  if safe_emblem_key is not null then
    expected_prefix := 'team-emblems/' || safe_team_id || '/';
    if position(expected_prefix in safe_emblem_key) <> 1
      or substring(safe_emblem_key from char_length(expected_prefix) + 1) !~ '^[a-f0-9]{24}[.]webp$' then
      raise exception 'invalid_team_emblem_key' using errcode = '22023';
    end if;
  end if;

  previous_emblem_key := current_team.emblem_key;
  new_upload := safe_emblem_key is not null and safe_emblem_key is distinct from previous_emblem_key;
  if new_upload and current_team.emblem_upload_blocked_until > now_at then
    raise exception 'team_emblem_moderation_blocked' using errcode = 'P0001', detail = current_team.emblem_upload_blocked_until::text;
  end if;
  if new_upload and current_team.emblem_upload_count >= 2 and current_team.emblem_uploaded_at > now_at - interval '30 days' then
    next_allowed_at := current_team.emblem_uploaded_at + interval '30 days';
    raise exception 'team_emblem_cooldown' using errcode = 'P0001', detail = next_allowed_at::text;
  end if;

  update public.teams
  set
    emblem_key = safe_emblem_key,
    emblem_source = case when safe_emblem_key is null then 'initial' else 'upload' end,
    emblem_updated_at = now_at,
    emblem_uploaded_at = case when new_upload then now_at else emblem_uploaded_at end,
    emblem_upload_count = emblem_upload_count + case when new_upload then 1 else 0 end,
    updated_at = now_at
  where id = safe_team_id
  returning * into current_team;

  next_allowed_at := case
    when current_team.emblem_upload_count >= 2 and current_team.emblem_uploaded_at is not null
      then current_team.emblem_uploaded_at + interval '30 days'
    else null
  end;
  if current_team.emblem_upload_blocked_until > now_at
    and (next_allowed_at is null or current_team.emblem_upload_blocked_until > next_allowed_at) then
    next_allowed_at := current_team.emblem_upload_blocked_until;
  end if;

  return jsonb_build_object(
    'ok', true,
    'teamId', safe_team_id,
    'emblemKey', current_team.emblem_key,
    'emblemSource', current_team.emblem_source,
    'emblemUpdatedAt', current_team.emblem_updated_at,
    'emblemUploadedAt', current_team.emblem_uploaded_at,
    'emblemUploadCount', current_team.emblem_upload_count,
    'emblemViolationCount', current_team.emblem_violation_count,
    'emblemUploadBlockedUntil', current_team.emblem_upload_blocked_until,
    'nextUploadAt', next_allowed_at,
    'previousEmblemKey', previous_emblem_key
  );
end;
$$;

create or replace function public.rankball_update_team_emblem_source(
  p_actor_profile_id text,
  p_team_id text,
  p_emblem_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_team public.teams%rowtype;
  safe_team_id text := btrim(coalesce(p_team_id, ''));
  safe_source text := lower(btrim(coalesce(p_emblem_source, 'initial')));
  now_at timestamptz := clock_timestamp();
begin
  select * into current_team
  from public.teams
  where id = safe_team_id
    and deleted_at is null
  for update;

  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = safe_team_id and user_id = p_actor_profile_id and role = 'captain'
  ) then
    raise exception 'team_emblem_permission_denied' using errcode = '42501';
  end if;
  if safe_source not in ('initial', 'upload') then
    raise exception 'invalid_team_emblem_source' using errcode = '22023';
  end if;
  if safe_source = 'upload' and current_team.emblem_key is null then
    raise exception 'team_emblem_upload_unavailable' using errcode = '22023';
  end if;
  if safe_source = 'upload' and current_team.emblem_upload_blocked_until > now_at then
    raise exception 'team_emblem_moderation_blocked' using errcode = 'P0001', detail = current_team.emblem_upload_blocked_until::text;
  end if;

  update public.teams
  set
    emblem_source = safe_source,
    emblem_updated_at = now_at,
    updated_at = now_at
  where id = safe_team_id
  returning * into current_team;

  return jsonb_build_object(
    'ok', true,
    'teamId', current_team.id,
    'emblemKey', current_team.emblem_key,
    'emblemSource', current_team.emblem_source,
    'emblemUpdatedAt', current_team.emblem_updated_at,
    'emblemViolationCount', current_team.emblem_violation_count,
    'emblemUploadBlockedUntil', current_team.emblem_upload_blocked_until
  );
end;
$$;

create or replace function public.rankball_moderate_team_emblem(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_report_id text,
  p_reason text default null,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.reports%rowtype;
  team_row public.teams%rowtype;
  captain_id text;
  previous_emblem_key text;
  now_ts timestamptz := clock_timestamp();
  safe_admin_level integer;
  safe_reason text;
  safe_feedback text;
  next_violation_count integer;
  block_days integer;
  blocked_until timestamptz;
  audit_id text;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then
    raise exception 'team_emblem_moderation_permission_required' using errcode = '42501';
  end if;

  select * into report_row
  from public.reports
  where id = btrim(coalesce(p_report_id, ''))
  for update;

  if report_row.id is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if report_row.type <> 'team_emblem' then
    raise exception 'team_emblem_report_required' using errcode = '22023';
  end if;
  if report_row.status <> 'open' or exists (
    select 1 from public.admin_audit_log
    where report_id = report_row.id
      and type = 'report_action'
      and status = 'committed'
  ) then
    raise exception 'report_already_processed' using errcode = '23505';
  end if;

  select * into team_row
  from public.teams
  where id = report_row.target_id
    and deleted_at is null
  for update;

  if team_row.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;

  select user_id into captain_id
  from public.team_members
  where team_id = team_row.id
    and role = 'captain'
  order by user_id
  limit 1;

  if captain_id is null then
    raise exception 'team_captain_not_found' using errcode = 'P0002';
  end if;

  previous_emblem_key := team_row.emblem_key;
  next_violation_count := coalesce(team_row.emblem_violation_count, 0) + 1;
  block_days := case
    when next_violation_count = 1 then 30
    when next_violation_count = 2 then 90
    else 365
  end;
  blocked_until := now_ts + make_interval(days => block_days);
  safe_reason := left(coalesce(nullif(btrim(p_reason), ''), '부적절한 팀 엠블럼'), 500);
  safe_feedback := left(coalesce(nullif(btrim(p_feedback), ''), '신고된 팀 엠블럼을 기본값으로 전환했습니다.'), 500);

  update public.teams
  set
    emblem_key = null,
    emblem_source = 'initial',
    emblem_updated_at = now_ts,
    emblem_violation_count = next_violation_count,
    emblem_upload_blocked_until = case
      when emblem_upload_blocked_until > blocked_until then emblem_upload_blocked_until
      else blocked_until
    end,
    emblem_moderated_at = now_ts,
    emblem_moderation_reason = safe_reason,
    updated_at = now_ts
  where id = team_row.id
  returning * into team_row;

  blocked_until := team_row.emblem_upload_blocked_until;

  update public.reports
  set
    status = 'resolved',
    resolved_at = now_ts,
    resolved_by = p_actor_profile_id,
    resolution = jsonb_build_object(
      'actionType', 'resetTeamEmblem',
      'feedback', safe_feedback,
      'reason', safe_reason,
      'targetUserId', captain_id,
      'violationCount', next_violation_count,
      'blockedUntil', blocked_until
    ),
    payload = payload || jsonb_build_object(
      'status', 'resolved',
      'resolvedAt', now_ts,
      'resolvedBy', p_actor_profile_id,
      'resolution', jsonb_build_object(
        'actionType', 'resetTeamEmblem',
        'feedback', safe_feedback,
        'reason', safe_reason,
        'targetUserId', captain_id,
        'violationCount', next_violation_count,
        'blockedUntil', blocked_until
      )
    ),
    updated_at = now_ts
  where id = report_row.id;

  audit_id := 'aa_' || md5(report_row.id || p_actor_profile_id || 'resetTeamEmblem' || now_ts::text);
  insert into public.admin_audit_log (
    id, type, status, report_id, target_user_id, created_by, payload, created_at
  ) values (
    audit_id,
    'report_action',
    'committed',
    report_row.id,
    captain_id,
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', 'report_action',
      'status', 'committed',
      'reportId', report_row.id,
      'actionType', 'resetTeamEmblem',
      'reason', safe_reason,
      'feedback', safe_feedback,
      'targetUserId', captain_id,
      'teamId', team_row.id,
      'violationCount', next_violation_count,
      'blockedUntil', blocked_until,
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id
    ),
    now_ts
  );

  if report_row.user_id is not null then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
    ) values (
      'n_' || md5('team-emblem-report-result' || report_row.id || report_row.user_id || now_ts::text),
      report_row.user_id,
      report_row.user_id,
      '팀 엠블럼 신고 처리',
      safe_feedback,
      'team',
      'report',
      jsonb_build_object('reportId', report_row.id, 'teamId', team_row.id, 'actionType', 'resetTeamEmblem'),
      now_ts,
      now_ts
    ) on conflict (id) do nothing;
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
  ) values (
    'n_' || md5('team-emblem-moderation' || report_row.id || captain_id || now_ts::text),
    captain_id,
    captain_id,
    '팀 엠블럼 운영 조치',
    '신고가 인정되어 팀 엠블럼을 기본값으로 전환했습니다. ' || block_days::text || '일 동안 사진을 업로드할 수 없습니다.',
    'orange',
    'team_emblem_moderation',
    jsonb_build_object(
      'reportId', report_row.id,
      'teamId', team_row.id,
      'violationCount', next_violation_count,
      'blockedUntil', blocked_until
    ),
    now_ts,
    now_ts
  ) on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'reportId', report_row.id,
    'actionType', 'resetTeamEmblem',
    'status', 'resolved',
    'auditId', audit_id,
    'teamId', team_row.id,
    'captainId', captain_id,
    'previousEmblemKey', previous_emblem_key,
    'emblemKey', team_row.emblem_key,
    'emblemSource', team_row.emblem_source,
    'emblemUpdatedAt', team_row.emblem_updated_at,
    'emblemViolationCount', next_violation_count,
    'emblemUploadBlockedUntil', blocked_until,
    'blockDays', block_days
  );
end;
$$;

revoke all on function public.rankball_update_team_emblem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_emblem(text, text, text, text) to service_role;
revoke all on function public.rankball_update_team_emblem_source(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_emblem_source(text, text, text) to service_role;
revoke all on function public.rankball_moderate_team_emblem(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_moderate_team_emblem(text, integer, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
