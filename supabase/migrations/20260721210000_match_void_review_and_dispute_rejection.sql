-- Separate dispute rejection from match voiding and add audited void restoration.

alter table public.matches
  add column if not exists void_reason text,
  add column if not exists voided_by text,
  add column if not exists void_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists void_review jsonb not null default '{}'::jsonb;

alter table public.match_disputes
  add column if not exists status text not null default 'open',
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by text,
  add column if not exists resolution text;

with ranked_disputes as (
  select
    dispute.id,
    match.status as match_status,
    row_number() over (partition by dispute.match_id order by dispute.created_at desc, dispute.id desc) as row_number
  from public.match_disputes dispute
  join public.matches match on match.id = dispute.match_id
)
update public.match_disputes dispute
set
  status = case
    when ranked_disputes.match_status = 'disputed' and ranked_disputes.row_number = 1 then 'open'
    when ranked_disputes.match_status = 'void' and ranked_disputes.row_number = 1 then 'accepted'
    else 'superseded'
  end,
  resolution = case
    when ranked_disputes.match_status = 'void' and ranked_disputes.row_number = 1 then 'match_voided'
    when not (ranked_disputes.match_status = 'disputed' and ranked_disputes.row_number = 1) then 'legacy_resolved'
    else dispute.resolution
  end,
  resolved_at = case
    when ranked_disputes.match_status = 'disputed' and ranked_disputes.row_number = 1 then null
    else coalesce(dispute.resolved_at, now())
  end
from ranked_disputes
where ranked_disputes.id = dispute.id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'match_disputes_status_check'
      and conrelid = 'public.match_disputes'::regclass
  ) then
    alter table public.match_disputes
      add constraint match_disputes_status_check
      check (status in ('open', 'accepted', 'rejected', 'superseded'));
  end if;
end;
$$;

create unique index if not exists match_disputes_one_open_per_match_idx
  on public.match_disputes (match_id)
  where status = 'open';

-- Preserve the existing terminal reducer as a private implementation.
do $$
begin
  if to_regprocedure('public.rankball_match_terminal_action_legacy_inner(text,text,text)') is null then
    alter function public.rankball_match_terminal_action(text, text, text)
      rename to rankball_match_terminal_action_legacy_inner;
  end if;
end;
$$;

revoke all on function public.rankball_match_terminal_action_legacy_inner(text, text, text)
from public, anon, authenticated, service_role;

create or replace function public.rankball_match_terminal_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_action), '') = 'voidMatch' then
    raise exception 'match_void_reason_required' using errcode = '22023';
  end if;
  return public.rankball_match_terminal_action_legacy_inner(p_actor_profile_id, p_action, p_match_id);
end;
$$;

create or replace function public.rankball_match_terminal_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_reason text := nullif(btrim(p_reason), '');
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  operator_id text;
  host_id text;
  trust_penalty integer := 2;
  player_stats jsonb := '{}'::jsonb;
  result_snapshot jsonb := 'null'::jsonb;
  match_snapshot jsonb := '{}'::jsonb;
  dispute_user_id text;
  now_at timestamptz := now();
begin
  if safe_action <> 'voidMatch' then
    return public.rankball_match_terminal_action_legacy_inner(safe_actor_id, safe_action, safe_match_id);
  end if;
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then raise exception 'missing_match' using errcode = '22023'; end if;
  if safe_reason is null or char_length(safe_reason) < 10 or char_length(safe_reason) > 500 then
    raise exception 'match_void_reason_length_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  trust_penalty := public.rankball_rating_policy_number(array['trust', 'matchVoidHostPenalty'], 2, 0, 10)::integer;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status <> 'disputed' then
    raise exception 'match_not_voidable' using errcode = '23514';
  end if;
  operator_id := coalesce(nullif(btrim(current_match.referee_id), ''), nullif(btrim(current_match.created_by), ''));
  if safe_actor_id is distinct from operator_id then
    raise exception 'match_void_permission_denied' using errcode = '42501';
  end if;
  if safe_actor_id = nullif(btrim(current_match.referee_id), '')
     and not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'referee_not_eligible' using errcode = '42501';
  end if;
  host_id := nullif(btrim(current_match.created_by), '');

  select * into current_result from public.match_results where match_id = safe_match_id;
  if current_result.match_id is not null then
    select coalesce(jsonb_object_agg(stat.user_id, jsonb_build_object(
      'points', coalesce(stat.points, 0),
      'rebounds', coalesce(stat.rebounds, 0),
      'assists', coalesce(stat.assists, 0),
      'steals', coalesce(stat.steals, 0),
      'blocks', coalesce(stat.blocks, 0),
      'fouls', coalesce(stat.fouls, 0)
    )), '{}'::jsonb)
    into player_stats
    from public.player_match_stats stat
    where stat.match_id = safe_match_id;
    result_snapshot := jsonb_build_object(
      'scoreA', coalesce(current_result.score_a, 0),
      'scoreB', coalesce(current_result.score_b, 0),
      'playerStats', player_stats,
      'statSubmissions', coalesce(current_result.stat_submissions, '{}'::jsonb),
      'submittedBy', current_result.submitted_by,
      'submittedAt', current_result.submitted_at
    );
  end if;
  match_snapshot := jsonb_build_object(
    'ranked', current_match.ranked,
    'ratingScale', case
      when coalesce(current_match.rules->>'ratingScale', '') ~ '^[0-9]+(\.[0-9]+)?$' then (current_match.rules->>'ratingScale')::numeric
      else 1
    end,
    'result', result_snapshot,
    'status', current_match.status,
    'capturedAt', now_at
  );

  select user_id into dispute_user_id
  from public.match_disputes
  where match_id = safe_match_id and status = 'open'
  order by created_at desc, id desc
  limit 1;

  update public.match_disputes
  set status = 'accepted', resolved_at = now_at, resolved_by = safe_actor_id, resolution = 'match_voided'
  where match_id = safe_match_id and status = 'open';

  update public.matches
  set
    status = 'void',
    ranked = false,
    voided_at = now_at,
    void_reason = safe_reason,
    voided_by = safe_actor_id,
    void_snapshot = match_snapshot,
    void_review = '{}'::jsonb,
    dispute_draft_result = null,
    dispute_draft_updated_at = null,
    dispute_resolved_at = now_at,
    updated_at = now_at
  where id = safe_match_id;

  if host_id is not null and trust_penalty > 0 then
    update public.profiles
    set trust_score = greatest(0, coalesce(trust_score, 80) - trust_penalty), updated_at = now_at
    where id = host_id;
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
  )
  select
    'n_' || md5('match-void' || safe_match_id || participant_id || now_at::text),
    participant_id,
    participant_id,
    '경기 무효 처리',
    current_match.title || ' 경기가 무효 처리됐습니다. 사유: ' || safe_reason,
    'orange',
    'match',
    safe_match_id,
    jsonb_build_object('matchId', safe_match_id, 'action', 'voidMatch', 'reason', safe_reason, 'trustPenalty', trust_penalty),
    now_at,
    now_at
  from (
    select distinct participant_id from (
      select current_match.created_by as participant_id
      union all select current_match.referee_id
      union all select player.user_id from public.match_players player where player.match_id = safe_match_id
    ) participants where nullif(btrim(participant_id), '') is not null
  ) recipients
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'action', 'voidMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'voidReason', safe_reason,
    'hostProfileId', host_id,
    'trustPenalty', trust_penalty,
    'disputeUserId', dispute_user_id,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_terminal_action(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_terminal_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_terminal_action(text, text, text) to service_role;
grant execute on function public.rankball_match_terminal_action(text, text, text, text) to service_role;

-- Resolve a dispute against the unchanged stored result.
create or replace function public.rankball_match_reject_dispute_action(
  p_actor_profile_id text,
  p_match_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  operator_id text;
  dispute_user_id text;
  player_stats jsonb := '{}'::jsonb;
  original_result jsonb;
  finalize_result jsonb;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then raise exception 'missing_match' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status <> 'disputed' then raise exception 'match_dispute_not_open' using errcode = '23514'; end if;
  operator_id := coalesce(nullif(btrim(current_match.referee_id), ''), nullif(btrim(current_match.created_by), ''));
  if safe_actor_id is distinct from operator_id then raise exception 'match_dispute_operator_required' using errcode = '42501'; end if;
  if safe_actor_id = nullif(btrim(current_match.referee_id), '')
     and not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'referee_not_eligible' using errcode = '42501';
  end if;

  select * into current_result from public.match_results where match_id = safe_match_id for update;
  if current_result.match_id is null then raise exception 'match_result_missing' using errcode = '23514'; end if;
  select coalesce(jsonb_object_agg(stat.user_id, jsonb_build_object(
    'points', coalesce(stat.points, 0), 'rebounds', coalesce(stat.rebounds, 0),
    'assists', coalesce(stat.assists, 0), 'steals', coalesce(stat.steals, 0),
    'blocks', coalesce(stat.blocks, 0), 'fouls', coalesce(stat.fouls, 0)
  )), '{}'::jsonb)
  into player_stats
  from public.player_match_stats stat where stat.match_id = safe_match_id;
  original_result := jsonb_build_object(
    'scoreA', coalesce(current_result.score_a, 0), 'scoreB', coalesce(current_result.score_b, 0),
    'playerStats', player_stats, 'statSubmissions', coalesce(current_result.stat_submissions, '{}'::jsonb),
    'submittedBy', current_result.submitted_by, 'submittedAt', current_result.submitted_at
  );

  select user_id into dispute_user_id
  from public.match_disputes
  where match_id = safe_match_id and status = 'open'
  order by created_at desc, id desc limit 1;

  update public.match_disputes
  set status = 'rejected', resolved_at = now_at, resolved_by = safe_actor_id, resolution = 'original_result_confirmed'
  where match_id = safe_match_id and status = 'open';
  update public.matches
  set dispute_draft_result = original_result, dispute_draft_updated_at = now_at, updated_at = now_at
  where id = safe_match_id;

  finalize_result := public.rankball_match_finalize_locked(safe_actor_id, safe_match_id, 'rejectMatchDispute');

  if dispute_user_id is not null then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
    ) values (
      'n_' || md5('dispute-rejected' || safe_match_id || dispute_user_id || now_at::text),
      dispute_user_id, dispute_user_id, '이의신청 반려',
      current_match.title || ' 이의신청이 반려되어 기존 결과로 확정됐습니다.',
      'match', 'match', safe_match_id,
      jsonb_build_object('matchId', safe_match_id, 'action', 'rejectMatchDispute'), now_at, now_at
    ) on conflict (id) do nothing;
  end if;

  return finalize_result || jsonb_build_object(
    'action', 'rejectMatchDispute', 'matchId', safe_match_id, 'disputeUserId', dispute_user_id
  );
end;
$$;

revoke all on function public.rankball_match_reject_dispute_action(text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_reject_dispute_action(text, text) to service_role;

-- Keep dispute rows auditable when the operator accepts a draft.
do $$
begin
  if to_regprocedure('public.rankball_match_resume_approval_action_void_review_inner(text,text,jsonb)') is null then
    alter function public.rankball_match_resume_approval_action(text, text, jsonb)
      rename to rankball_match_resume_approval_action_void_review_inner;
  end if;
end;
$$;

revoke all on function public.rankball_match_resume_approval_action_void_review_inner(text, text, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.rankball_match_resume_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reducer_result jsonb;
begin
  reducer_result := public.rankball_match_resume_approval_action_void_review_inner(
    p_actor_profile_id, p_match_id, p_result_draft
  );
  if coalesce((reducer_result->>'ok')::boolean, false) then
    update public.match_disputes
    set status = 'accepted', resolved_at = now(), resolved_by = nullif(btrim(p_actor_profile_id), ''), resolution = 'draft_accepted'
    where match_id = nullif(btrim(p_match_id), '') and status = 'open';
  end if;
  return reducer_result;
end;
$$;

revoke all on function public.rankball_match_resume_approval_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_resume_approval_action(text, text, jsonb) to service_role;

-- Scoped public-room discipline must not block unrelated match completion or private rooms.
create or replace function public.rankball_assert_match_actor_active(
  p_actor_profile_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  now_at timestamptz := now();
begin
  if safe_actor_id is null or not exists (select 1 from public.profiles profile where profile.id = safe_actor_id) then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.admin_disciplinary_actions action
    where action.user_id = safe_actor_id
      and action.type <> 'public_room_suspension'
      and action.status = 'active'
      and coalesce(action.starts_at, now_at) <= now_at
      and (action.ends_at is null or action.ends_at > now_at)
  ) then
    raise exception 'profile_discipline_blocked' using errcode = '42501';
  end if;
  return true;
end;
$$;

revoke all on function public.rankball_assert_match_actor_active(text) from public, anon, authenticated;
grant execute on function public.rankball_assert_match_actor_active(text) to service_role;

-- Preserve the new trust coefficient through owner edits without replacing the existing policy schema.
do $$
begin
  if to_regprocedure('public.rankball_normalize_rating_policy_void_review_inner(jsonb)') is null then
    alter function public.rankball_normalize_rating_policy(jsonb)
      rename to rankball_normalize_rating_policy_void_review_inner;
  end if;
end;
$$;

create or replace function public.rankball_normalize_rating_policy(p_policy jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_set(
    public.rankball_normalize_rating_policy_void_review_inner(p_policy),
    '{trust,matchVoidHostPenalty}',
    to_jsonb(public.rankball_policy_value(p_policy, array['trust', 'matchVoidHostPenalty'], 2, 0, 10)),
    true
  );
$$;

update public.rating_policy
set policy = jsonb_set(
  policy,
  '{trust,matchVoidHostPenalty}',
  to_jsonb(public.rankball_policy_value(policy, array['trust', 'matchVoidHostPenalty'], 2, 0, 10)),
  true
), updated_at = now()
where id = 'active';

-- Admin-only, fixed resolution choices for a void restoration report.
create or replace function public.rankball_review_void_match_report(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_report_id text,
  p_action_type text,
  p_penalty_type text default '',
  p_target_user_id text default null,
  p_duration_days integer default 3,
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
  current_match public.matches%rowtype;
  safe_admin_level integer;
  safe_action text := nullif(btrim(p_action_type), '');
  safe_penalty text := lower(coalesce(nullif(btrim(p_penalty_type), ''), ''));
  safe_target_id text := nullif(btrim(p_target_user_id), '');
  safe_duration integer;
  safe_reason text;
  safe_feedback text;
  action_label text;
  operator_id text;
  original_ranked boolean;
  original_scale numeric := 1;
  rating_factor numeric := 1;
  snapshot_result jsonb;
  resolution_payload jsonb;
  finalize_result jsonb := '{}'::jsonb;
  audit_id text;
  disciplinary_id text;
  tournament_lock_id text;
  now_at timestamptz := now();
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then raise exception 'match_manager_permission_required' using errcode = '42501'; end if;
  if safe_action not in ('keepMatchVoid', 'restoreMatchHalf', 'restoreMatchFull') then
    raise exception 'invalid_void_match_review_action' using errcode = '22023';
  end if;
  if safe_penalty not in ('', 'public_room_suspension', 'suspension') then
    raise exception 'invalid_void_match_penalty' using errcode = '22023';
  end if;
  safe_duration := case when p_duration_days in (3, 7, 14, 28, 42, 56, 168, 280) then p_duration_days else 3 end;

  select * into report_row from public.reports where id = p_report_id for update;
  if report_row.id is null then raise exception 'report_not_found' using errcode = 'P0002'; end if;
  if report_row.status <> 'open' or exists (
    select 1 from public.admin_audit_log audit
    where audit.report_id = report_row.id and audit.type = 'void_match_review' and audit.status = 'committed'
  ) then raise exception 'report_already_processed' using errcode = '23505'; end if;
  if report_row.type <> 'match' or report_row.payload->>'matchReviewType' <> 'void_restore' then
    raise exception 'void_restore_report_required' using errcode = '22023';
  end if;

  select nullif(btrim(match.tournament_id), '') into tournament_lock_id
  from public.matches match where match.id = report_row.target_id;
  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(tournament_lock_id));
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(report_row.target_id));
  select * into current_match from public.matches where id = report_row.target_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status <> 'void' then raise exception 'void_match_already_changed' using errcode = '23505'; end if;

  operator_id := coalesce(nullif(btrim(current_match.referee_id), ''), nullif(btrim(current_match.created_by), ''));
  safe_target_id := coalesce(safe_target_id, nullif(btrim(current_match.voided_by), ''), nullif(btrim(current_match.created_by), ''));
  if safe_penalty <> '' then
    if safe_target_id is null or not (
      safe_target_id = current_match.created_by
      or safe_target_id = current_match.referee_id
      or exists (select 1 from public.match_players player where player.match_id = current_match.id and player.user_id = safe_target_id)
    ) then raise exception 'void_match_penalty_target_invalid' using errcode = '42501'; end if;
  end if;

  action_label := case safe_action
    when 'restoreMatchHalf' then '경기 복구 · MMR 50% 반영'
    when 'restoreMatchFull' then '경기 복구 · MMR 100% 반영'
    else '경기 무효 유지'
  end;
  safe_reason := coalesce(nullif(btrim(p_reason), ''), action_label);
  safe_feedback := coalesce(nullif(btrim(p_feedback), ''), case safe_action
    when 'restoreMatchHalf' then '경기를 복구하고 MMR을 50% 반영했습니다.'
    when 'restoreMatchFull' then '경기를 복구하고 MMR을 정상 반영했습니다.'
    else '검토 결과 경기 무효 처리를 유지했습니다.'
  end);
  resolution_payload := jsonb_build_object(
    'actionType', safe_action, 'actionLabel', action_label, 'reason', safe_reason,
    'feedback', safe_feedback, 'penaltyType', nullif(safe_penalty, ''),
    'targetUserId', safe_target_id, 'durationDays', safe_duration,
    'resolvedBy', p_actor_profile_id, 'resolvedAt', now_at
  );

  if safe_action in ('restoreMatchHalf', 'restoreMatchFull') then
    snapshot_result := current_match.void_snapshot->'result';
    if snapshot_result is null or snapshot_result = 'null'::jsonb then
      raise exception 'void_match_snapshot_missing' using errcode = '23514';
    end if;
    original_ranked := case
      when current_match.void_snapshot->>'ranked' in ('true', 'false') then (current_match.void_snapshot->>'ranked')::boolean
      else true
    end;
    if coalesce(current_match.void_snapshot->>'ratingScale', '') ~ '^[0-9]+(\.[0-9]+)?$' then
      original_scale := (current_match.void_snapshot->>'ratingScale')::numeric;
    end if;
    rating_factor := case when safe_action = 'restoreMatchHalf' then 0.5 else 1 end;
    update public.matches
    set
      status = 'disputed', ranked = original_ranked,
      rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{ratingScale}', to_jsonb(original_scale * rating_factor), true),
      dispute_draft_result = snapshot_result, dispute_draft_updated_at = now_at,
      void_review = resolution_payload, updated_at = now_at
    where id = current_match.id;
    finalize_result := public.rankball_match_finalize_locked(operator_id, current_match.id, safe_action);
    update public.matches set void_review = resolution_payload, updated_at = now_at where id = current_match.id;
  else
    update public.matches set void_review = resolution_payload, updated_at = now_at where id = current_match.id;
  end if;

  update public.reports
  set
    status = 'resolved', resolved_at = now_at, resolved_by = p_actor_profile_id, resolution = resolution_payload,
    payload = payload || jsonb_build_object('status', 'resolved', 'resolvedAt', now_at, 'resolvedBy', p_actor_profile_id, 'resolution', resolution_payload),
    updated_at = now_at
  where id = report_row.id;

  audit_id := 'aa_' || md5('void-review' || report_row.id || safe_action || now_at::text);
  insert into public.admin_audit_log (id, type, status, report_id, target_user_id, created_by, payload, created_at)
  values (
    audit_id, 'void_match_review', 'committed', report_row.id, safe_target_id, p_actor_profile_id,
    resolution_payload || jsonb_build_object('id', audit_id, 'reportId', report_row.id, 'matchId', current_match.id), now_at
  );

  if safe_penalty <> '' then
    disciplinary_id := 'ad_' || md5(report_row.id || safe_target_id || safe_penalty || now_at::text);
    insert into public.admin_disciplinary_actions (
      id, user_id, type, action_type, status, source_report_id, created_by,
      starts_at, ends_at, payload, created_at, updated_at
    ) values (
      disciplinary_id, safe_target_id, safe_penalty,
      case when safe_penalty = 'public_room_suspension' then 'publicRoomSuspend' else 'suspendTarget' end,
      'active', report_row.id, p_actor_profile_id, now_at, now_at + make_interval(days => safe_duration),
      jsonb_build_object(
        'id', disciplinary_id, 'userId', safe_target_id, 'type', safe_penalty,
        'actionType', case when safe_penalty = 'public_room_suspension' then 'publicRoomSuspend' else 'suspendTarget' end,
        'sourceReportId', report_row.id, 'reason', safe_reason, 'startsAt', now_at,
        'endsAt', now_at + make_interval(days => safe_duration), 'durationDays', safe_duration,
        'createdAt', now_at, 'createdBy', p_actor_profile_id, 'status', 'active'
      ), now_at, now_at
    );
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
  ) values (
    'n_' || md5('void-report-result' || report_row.id || report_row.user_id || now_at::text),
    report_row.user_id, report_row.user_id, '신고 처리 결과',
    '처리: ' || action_label || '. 답변: ' || safe_feedback,
    'team', 'report', current_match.id,
    jsonb_build_object('reportId', report_row.id, 'matchId', current_match.id, 'actionType', safe_action, 'resolution', resolution_payload),
    now_at, now_at
  ) on conflict (id) do nothing;

  if safe_penalty <> '' then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
    ) values (
      'n_' || md5('void-review-discipline' || report_row.id || safe_target_id || now_at::text),
      safe_target_id, safe_target_id, '운영 제재 안내',
      case when safe_penalty = 'public_room_suspension' then '공개방 참가' else '서비스 활동' end
        || '이 ' || safe_duration::text || '일간 제한됩니다. 사유: ' || safe_reason,
      'orange', 'disciplinary', current_match.id,
      jsonb_build_object('reportId', report_row.id, 'disciplinaryActionId', disciplinary_id, 'durationDays', safe_duration),
      now_at, now_at
    ) on conflict (id) do nothing;
  end if;

  return finalize_result || jsonb_build_object(
    'ok', true, 'reportId', report_row.id, 'matchId', current_match.id,
    'actionType', safe_action, 'actionLabel', action_label,
    'auditId', audit_id, 'disciplinaryActionId', disciplinary_id,
    'ratingAtomic', coalesce((finalize_result->>'ratingAtomic')::boolean, false)
  );
end;
$$;

revoke all on function public.rankball_review_void_match_report(text, integer, text, text, text, text, integer, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_review_void_match_report(text, integer, text, text, text, text, integer, text, text)
to service_role;

select pg_notify('pgrst', 'reload schema');
