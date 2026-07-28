begin;

create table if not exists public.match_record_mmr_audits (
  match_id text not null references public.matches(id) on delete restrict,
  profile_id text not null references public.profiles(id) on delete restrict,
  fingerprint text not null,
  participant_ids jsonb not null default '[]'::jsonb,
  mode text not null,
  scale numeric not null default 0,
  original_mode_delta numeric not null default 0,
  applied_mode_delta numeric not null default 0,
  original_integrated_delta numeric not null default 0,
  applied_integrated_delta numeric not null default 0,
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (match_id, profile_id)
);

create index if not exists match_record_mmr_audits_profile_created_idx
  on public.match_record_mmr_audits (profile_id, created_at desc);
create index if not exists match_record_mmr_audits_fingerprint_idx
  on public.match_record_mmr_audits (fingerprint, created_at desc);

alter table public.match_record_mmr_audits enable row level security;
revoke all on public.match_record_mmr_audits from public, anon, authenticated;
grant select, insert, update on public.match_record_mmr_audits to service_role;

create or replace function public.rankball_match_record_rating_scale(p_mode text)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case lower(coalesce(p_mode, ''))
    when '1v1' then 0.10
    when '2v2' then 0.20
    when '3v3' then 0.35
    when '5v5' then 0.50
    else 0
  end;
$$;

revoke all on function public.rankball_match_record_rating_scale(text)
  from public, anon, authenticated, service_role;

-- match_record은 10%부터 시작하고, 팀 MMR과 레거시 기록자 보상은 막는다.
do $migration$
declare
  function_definition text;
  old_scale text := $old$greatest(0.2, least(1.5, coalesce((current_match.rules->>'ratingScale')::numeric, 1)))$old$;
  new_scale text := $new$greatest(
      case when lower(coalesce(current_match.rules->>'recordType', '')) = 'match_record' then 0.1 else 0.2 end,
      least(1.5, coalesce((current_match.rules->>'ratingScale')::numeric, 1))
    )$new$;
  old_team_guard text := $old$    where current_match.ranked
      and team.deleted_at is null$old$;
  new_team_guard text := $new$    where current_match.ranked
      and lower(coalesce(current_match.rules->>'recordType', '')) <> 'match_record'
      and team.deleted_at is null$new$;
  old_recorder_reward text := $old$      where value->>'source' = 'candidate_recorder' and nullif(value->>'by', '') is not null$old$;
  new_recorder_reward text := $new$      where false
        and value->>'source' = 'candidate_recorder'
        and nullif(value->>'by', '') is not null$new$;
begin
  select pg_get_functiondef(
    'public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure
  ) into function_definition;

  if position(new_scale in function_definition) = 0 then
    if position(old_scale in function_definition) = 0 then
      raise exception 'match_record_rating_scale_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_scale, new_scale);
  end if;
  if position(new_team_guard in function_definition) = 0 then
    if position(old_team_guard in function_definition) = 0 then
      raise exception 'match_record_team_mmr_guard_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_team_guard, new_team_guard);
  end if;
  if position(new_recorder_reward in function_definition) = 0 then
    if position(old_recorder_reward in function_definition) = 0 then
      raise exception 'legacy_recorder_reward_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_recorder_reward, new_recorder_reward);
  end if;

  execute function_definition;
end;
$migration$;

-- 명시적 수동 확정은 결과 제출 3분 뒤, 열린 이의 없음, 확인 체크가 모두 필요하다.
create or replace function public.rankball_match_finalize_locked(
  p_actor_profile_id text,
  p_match_id text,
  p_action text,
  p_disputes_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  submitted_at timestamptz;
begin
  if p_disputes_acknowledged is distinct from true then
    raise exception 'match_finalize_disputes_acknowledgement_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) in ('match_record', 'personal_record', 'solo') then
    raise exception 'match_live_finalize_record_type_invalid' using errcode = '23514';
  end if;

  select result.submitted_at into submitted_at
  from public.match_results result
  where result.match_id = safe_match_id
  for update;
  if submitted_at is null then
    raise exception 'match_result_submission_required' using errcode = '23514';
  end if;
  if clock_timestamp() < submitted_at + interval '3 minutes' then
    raise exception 'match_manual_finalization_not_due' using errcode = '23514';
  end if;
  if current_match.status = 'disputed'
     or exists (
       select 1 from public.match_disputes dispute
       where dispute.match_id = safe_match_id and dispute.status = 'open'
     ) then
    raise exception 'match_dispute_resolution_required' using errcode = '23514';
  end if;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'manualFinalizationAudit',
        jsonb_build_object(
          'actor', nullif(btrim(p_actor_profile_id), ''),
          'finalizedAt', clock_timestamp(),
          'disputesAcknowledged', true,
          'openDisputeCount', 0
        )
      ),
      updated_at = clock_timestamp()
  where id = safe_match_id;

  return public.rankball_match_finalize_locked(
    p_actor_profile_id,
    safe_match_id,
    coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );
end;
$$;

-- 사후 경기기록방: 전체 실제 참가자의 2/3(올림) 확인, 확인자만 부분 개인 MMR.
create or replace function public.rankball_match_record_finalize_after_threshold(
  p_actor_profile_id text,
  p_match_id text,
  p_finalize_source text default 'participant_threshold'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  now_at timestamptz := clock_timestamp();
  current_match public.matches%rowtype;
  required_ids text[] := array[]::text[];
  verified_ids text[] := array[]::text[];
  unconfirmed_ids text[] := array[]::text[];
  anti_abuse_ids text[] := array[]::text[];
  excluded_ids text[] := array[]::text[];
  required_count integer := 0;
  approved_count integer := 0;
  approval_threshold integer := 0;
  operator_id text;
  record_fingerprint text;
  duplicate_record boolean := false;
  rating_scale numeric := 0;
  finalize_result jsonb;
  rating_changes jsonb := '[]'::jsonb;
  next_rating_changes jsonb := '[]'::jsonb;
  change_row jsonb;
  target_profile_id text;
  original_mode_delta numeric;
  original_integrated_delta numeric;
  applied_mode_delta numeric;
  applied_integrated_delta numeric;
  used_mode_delta numeric;
  used_integrated_delta numeric;
  audit_flags jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) <> 'match_record'
     or current_match.rules->>'recordSetupReady' <> 'true'
     or current_match.status not in ('agreed', 'approval')
     or current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null then
    raise exception 'match_record_finalize_locked' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.match_results result where result.match_id = safe_match_id
  ) then
    raise exception 'match_result_missing' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id and dispute.status = 'open'
  ) or exists (
    select 1 from public.reports report
    where report.type = 'match'
      and report.target_id = safe_match_id
      and report.status not in ('resolved', 'dismissed')
  ) then
    raise exception 'match_record_open_report_required' using errcode = '23514';
  end if;

  select coalesce(array_agg(required_id order by required_id), array[]::text[])
  into required_ids
  from (
    select distinct required.value as required_id
    from (
      select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
          then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
      )
      union
      select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
          then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
      )
    ) required
    where nullif(btrim(required.value), '') is not null
  ) required_players;

  select coalesce(array_agg(approval.user_id order by approval.user_id), array[]::text[])
  into verified_ids
  from public.match_approvals approval
  where approval.match_id = safe_match_id
    and approval.user_id = any(required_ids)
    and coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb) ? approval.user_id;

  required_count := coalesce(array_length(required_ids, 1), 0);
  approved_count := coalesce(array_length(verified_ids, 1), 0);
  approval_threshold := ceil(required_count * 2.0 / 3.0)::integer;
  if required_count = 0 or approved_count < approval_threshold then
    raise exception 'match_record_participant_threshold_required' using errcode = '23514';
  end if;

  select coalesce(array_agg(required_id order by required_id), array[]::text[])
  into unconfirmed_ids
  from unnest(required_ids) required_id
  where not required_id = any(verified_ids);

  rating_scale := public.rankball_match_record_rating_scale(current_match.mode);
  if rating_scale <= 0 then
    raise exception 'match_record_mode_not_supported' using errcode = '23514';
  end if;

  select md5(
    coalesce(current_match.scheduled_date::text, current_match.created_at::date::text)
    || ':' || lower(current_match.mode)
    || ':' || result.score_a::text || ':' || result.score_b::text
    || ':' || array_to_string(required_ids, ',')
  )
  into record_fingerprint
  from public.match_results result
  where result.match_id = safe_match_id;

  select exists (
    select 1 from public.match_record_mmr_audits audit
    where audit.fingerprint = record_fingerprint
      and audit.match_id <> safe_match_id
  ) into duplicate_record;

  if duplicate_record then
    anti_abuse_ids := verified_ids;
  else
    select coalesce(array_agg(candidate.profile_id order by candidate.profile_id), array[]::text[])
    into anti_abuse_ids
    from (
      select verified.profile_id
      from unnest(verified_ids) verified(profile_id)
      where (
        select count(*)
        from public.match_record_mmr_audits audit
        where audit.profile_id = verified.profile_id
          and audit.created_at >= now_at - interval '7 days'
          and audit.participant_ids = to_jsonb(required_ids)
      ) >= 3
    ) candidate;
  end if;

  select coalesce(array_agg(excluded_id order by excluded_id), array[]::text[])
  into excluded_ids
  from (
    select distinct excluded_id
    from (
      select value as excluded_id
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.mmr_excluded_player_ids) = 'array'
          then current_match.mmr_excluded_player_ids else '[]'::jsonb end
      )
      union all select unnest(unconfirmed_ids)
      union all select unnest(anti_abuse_ids)
    ) combined
    where nullif(btrim(excluded_id), '') is not null
  ) unique_exclusions;

  operator_id := nullif(btrim(current_match.created_by), '');
  if operator_id is null then
    raise exception 'match_host_missing_admin_escalation' using errcode = '23514';
  end if;

  update public.matches
  set ranked = true,
      mmr_excluded_player_ids = to_jsonb(excluded_ids),
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'ratingScale', rating_scale,
        'mmrExcludedPlayerIds', to_jsonb(excluded_ids),
        'matchRecordVerificationStatus', 'confirmed',
        'matchRecordApprovalThreshold', approval_threshold,
        'matchRecordApprovedCount', approved_count,
        'matchRecordConfirmedParticipantIds', to_jsonb(verified_ids),
        'matchRecordFingerprint', record_fingerprint,
        'matchRecordFinalizeSource', coalesce(nullif(btrim(p_finalize_source), ''), 'participant_threshold'),
        'matchRecordFinalizationAudit', jsonb_build_object(
          'actor', case
            when p_finalize_source = 'system_24h' then 'system'
            else nullif(btrim(p_actor_profile_id), '')
          end,
          'finalizedAt', now_at,
          'source', coalesce(nullif(btrim(p_finalize_source), ''), 'participant_threshold')
        ),
        'matchRecordAntiAbuseExcludedIds', to_jsonb(anti_abuse_ids),
        'matchRecordDuplicateDetected', duplicate_record
      ),
      updated_at = now_at
  where id = safe_match_id;

  finalize_result := public.rankball_match_finalize_locked_pre_score_policy(
    operator_id,
    safe_match_id,
    'approveMatch'
  );

  select coalesce(match_row.rating_result, '[]'::jsonb)
  into rating_changes
  from public.matches match_row
  where match_row.id = safe_match_id
  for update;

  for change_row in
    select value from jsonb_array_elements(rating_changes)
  loop
    target_profile_id := nullif(btrim(change_row->>'playerId'), '');
    original_mode_delta := coalesce((change_row->>'modeDelta')::numeric, 0);
    original_integrated_delta := coalesce((change_row->>'integratedDelta')::numeric, 0);

    select
      coalesce(sum(abs(audit.applied_mode_delta)), 0),
      coalesce(sum(abs(audit.applied_integrated_delta)), 0)
    into used_mode_delta, used_integrated_delta
    from public.match_record_mmr_audits audit
    where audit.profile_id = target_profile_id
      and audit.created_at >= date_trunc('day', now_at);

    applied_mode_delta := sign(original_mode_delta)
      * least(abs(original_mode_delta), greatest(0, 50 - used_mode_delta));
    applied_integrated_delta := sign(original_integrated_delta)
      * least(abs(original_integrated_delta), greatest(0, 30 - used_integrated_delta));

    if applied_mode_delta is distinct from original_mode_delta
       or applied_integrated_delta is distinct from original_integrated_delta then
      update public.profiles profile
      set ratings = jsonb_set(
            jsonb_set(
              coalesce(profile.ratings, '{}'::jsonb),
              '{integrated}',
              to_jsonb(greatest(
                0,
                round(coalesce((profile.ratings->>'integrated')::numeric, 1200)
                  - original_integrated_delta + applied_integrated_delta)
              )),
              true
            ),
            array['modes', current_match.mode],
            to_jsonb(greatest(
              0,
              round(coalesce(
                (profile.ratings #>> array['modes', current_match.mode])::numeric,
                (profile.ratings->>'integrated')::numeric,
                1200
              ) - original_mode_delta + applied_mode_delta)
            )),
            true
          ),
          updated_at = now_at
      where profile.id = target_profile_id;
    end if;

    audit_flags := case
      when applied_mode_delta is distinct from original_mode_delta
        or applied_integrated_delta is distinct from original_integrated_delta
      then jsonb_build_array('daily_cap')
      else '[]'::jsonb
    end;

    insert into public.match_record_mmr_audits (
      match_id, profile_id, fingerprint, participant_ids, mode, scale,
      original_mode_delta, applied_mode_delta,
      original_integrated_delta, applied_integrated_delta,
      flags, created_at
    ) values (
      safe_match_id, target_profile_id, record_fingerprint, to_jsonb(required_ids),
      current_match.mode, rating_scale,
      original_mode_delta, applied_mode_delta,
      original_integrated_delta, applied_integrated_delta,
      audit_flags, now_at
    ) on conflict (match_id, profile_id) do nothing;

    next_rating_changes := next_rating_changes || (
      change_row || jsonb_build_object(
        'modeDelta', applied_mode_delta,
        'integratedDelta', applied_integrated_delta,
        'matchRecordScale', rating_scale
      )
    );
  end loop;

  insert into public.match_record_mmr_audits (
    match_id, profile_id, fingerprint, participant_ids, mode, scale, flags, created_at
  )
  select
    safe_match_id,
    verified.profile_id,
    record_fingerprint,
    to_jsonb(required_ids),
    current_match.mode,
    rating_scale,
    case
      when duplicate_record then jsonb_build_array('duplicate')
      when verified.profile_id = any(anti_abuse_ids) then jsonb_build_array('repeated_participants')
      else '[]'::jsonb
    end,
    now_at
  from unnest(verified_ids) verified(profile_id)
  on conflict (match_id, profile_id) do nothing;

  update public.matches
  set rating_result = next_rating_changes,
      team_rating_result = jsonb_build_object('teamA', 0, 'teamB', 0, 'teams', '{}'::jsonb),
      updated_at = now_at
  where id = safe_match_id;

  return finalize_result || jsonb_build_object(
    'approvalThreshold', approval_threshold,
    'approvedCount', approved_count,
    'verifiedPlayerIds', to_jsonb(verified_ids),
    'unconfirmedPlayerIds', to_jsonb(unconfirmed_ids),
    'ratingScale', rating_scale,
    'teamMmrApplied', false,
    'duplicateDetected', duplicate_record
  );
end;
$$;

-- 승인 한 번이 참가 확인과 결과 확인을 함께 처리하며, 2/3 도달 시 확정한다.
do $migration$
declare
  function_definition text;
  old_condition text := $old$if required_count > 0 and approved_count = required_count then$old$;
  new_condition text := $new$if required_count > 0
     and approved_count >= ceil(required_count * 2.0 / 3.0)::integer then$new$;
  old_call text := $old$public.rankball_match_record_finalize_after_approvals(
      safe_actor_id,
      safe_match_id
    )$old$;
  new_call text := $new$public.rankball_match_record_finalize_after_threshold(
      safe_actor_id,
      safe_match_id,
      'participant_threshold'
    )$new$;
begin
  select pg_get_functiondef(
    'public.rankball_match_approval_action(text,text,text,text)'::regprocedure
  ) into function_definition;
  if position(new_condition in function_definition) = 0 then
    if position(old_condition in function_definition) = 0 then
      raise exception 'match_record_approval_threshold_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_condition, new_condition);
  end if;
  if position(new_call in function_definition) = 0 then
    if position(old_call in function_definition) = 0 then
      raise exception 'match_record_finalize_call_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_call, new_call);
  end if;
  execute function_definition;
end;
$migration$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_approval_pre_record_deadline(text,text,text,text)'
  ) is null then
    alter function public.rankball_match_approval_action(text, text, text, text)
      rename to rankball_match_approval_pre_record_deadline;
  end if;
end;
$migration$;

create or replace function public.rankball_match_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  submitted_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) = 'match_record' then
    select result.submitted_at into submitted_at
    from public.match_results result
    where result.match_id = safe_match_id;
    if submitted_at is null then
      raise exception 'match_result_missing' using errcode = '23514';
    end if;
    if clock_timestamp() >= current_match.created_at + interval '24 hours' then
      raise exception 'match_record_confirmation_closed' using errcode = '23514';
    end if;
  end if;

  return public.rankball_match_approval_pre_record_deadline(
    p_actor_profile_id,
    safe_match_id,
    p_side,
    p_player_id
  );
end;
$$;

-- 자동 확정: 일반 경기는 전체 이의시간, 사후 기록은 24시간과 2/3 확인 기준.
create or replace function public.rankball_match_auto_finalize_action(
  p_match_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  now_at timestamptz := coalesce(p_now, now());
  current_match public.matches%rowtype;
  result_row public.match_results%rowtype;
  record_type text;
  operator_id text;
  required_count integer := 0;
  approved_count integer := 0;
  approval_threshold integer := 0;
  missing_stats integer := 0;
begin
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.status = 'confirmed' and current_match.rating_result is not null then
    return jsonb_build_object('ok', true, 'matchId', safe_match_id, 'alreadyConfirmed', true, 'ratingAtomic', true);
  end if;

  select * into result_row
  from public.match_results result
  where result.match_id = safe_match_id
  for update;
  if result_row.match_id is null then
    raise exception 'match_result_missing' using errcode = '23514';
  end if;
  if result_row.score_a not between 0 and 999 or result_row.score_b not between 0 and 999 then
    raise exception 'match_result_invalid' using errcode = '23514';
  end if;
  if current_match.dispute_draft_result is not null
     or exists (
       select 1 from public.match_disputes dispute
       where dispute.match_id = safe_match_id and dispute.status = 'open'
     ) then
    raise exception 'match_auto_finalization_locked' using errcode = '23514';
  end if;

  record_type := lower(coalesce(current_match.rules->>'recordType', ''));
  if record_type = 'match_record' then
    if current_match.status not in ('agreed', 'approval')
       or now_at < current_match.created_at + interval '24 hours' then
      raise exception 'match_auto_finalization_not_due' using errcode = '23514';
    end if;
    if exists (
      select 1 from public.reports report
      where report.type = 'match'
        and report.target_id = safe_match_id
        and report.status not in ('resolved', 'dismissed')
    ) then
      raise exception 'match_auto_finalization_locked' using errcode = '23514';
    end if;

    with required_players as (
      select distinct value as user_id
      from (
        select value from jsonb_array_elements_text(
          case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
            then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
        )
        union
        select value from jsonb_array_elements_text(
          case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
            then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
        )
      ) required
    )
    select
      count(*)::integer,
      count(*) filter (
        where exists (
          select 1 from public.match_approvals approval
          where approval.match_id = safe_match_id
            and approval.user_id = required_players.user_id
        )
        and coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb)
          ? required_players.user_id
      )::integer
    into required_count, approved_count
    from required_players;

    approval_threshold := ceil(required_count * 2.0 / 3.0)::integer;
    if required_count = 0 or approved_count < approval_threshold then
      update public.matches
      set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
            'matchRecordVerificationStatus', 'insufficient',
            'matchRecordApprovalThreshold', approval_threshold,
            'matchRecordApprovedCount', approved_count,
            'matchRecordConfirmationClosedAt', now_at
          ),
          updated_at = now_at
      where id = safe_match_id;
      return jsonb_build_object(
        'ok', false,
        'matchId', safe_match_id,
        'confirmationInsufficient', true,
        'approvalThreshold', approval_threshold,
        'approvedCount', approved_count
      );
    end if;

    return public.rankball_match_record_finalize_after_threshold(
      current_match.created_by,
      safe_match_id,
      'system_24h'
    );
  end if;

  if record_type in ('personal_record', 'solo')
     or current_match.status <> 'approval'
     or current_match.ended_at is null
     or current_match.confirmed_at is not null
     or current_match.rating_result is not null then
    raise exception 'match_auto_finalization_locked' using errcode = '23514';
  end if;
  if now_at < result_row.submitted_at + make_interval(
    mins => public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)
  ) then
    raise exception 'match_auto_finalization_not_due' using errcode = '23514';
  end if;

  if nullif(btrim(current_match.referee_id), '') is not null then
    if not public.rankball_is_match_referee_eligible(current_match.referee_id, safe_match_id) then
      raise exception 'match_referee_qualification_admin_escalation' using errcode = '23514';
    end if;
    with actual_players as (
      select distinct player.user_id
      from public.match_players player
      where player.match_id = safe_match_id
        and player.side in ('teamA', 'teamB')
        and nullif(btrim(player.user_id), '') is not null
        and not (
          case when jsonb_typeof(current_match.reserve_players->player.side) = 'array'
            then current_match.reserve_players->player.side else '[]'::jsonb end
        ) ? player.user_id
      union
      select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      )
      union
      select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      )
    )
    select count(*)::integer into missing_stats
    from actual_players player
    where not exists (
      select 1 from public.player_match_stats stat
      where stat.match_id = safe_match_id
        and stat.user_id = player.user_id
        and stat.record_source in ('referee', 'dispute_operator')
    );
    if missing_stats > 0 then
      raise exception 'match_approval_stats_incomplete' using errcode = '23514';
    end if;
    operator_id := current_match.referee_id;
  else
    operator_id := nullif(btrim(current_match.created_by), '');
  end if;
  if operator_id is null then
    raise exception 'match_host_missing_admin_escalation' using errcode = '23514';
  end if;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'autoFinalizationAudit',
        jsonb_build_object(
          'actor', 'system',
          'operatorId', operator_id,
          'finalizedAt', now_at,
          'policy', 'dispute_window_elapsed'
        )
      ),
      updated_at = now_at
  where id = safe_match_id;

  return public.rankball_match_finalize_locked_pre_score_policy(
    operator_id,
    safe_match_id,
    'autoConfirmMatch'
  );
end;
$$;

-- 공식 전적 집계에서도 미확인 match_record 참가자는 제외한다.
do $migration$
declare
  function_definition text;
  target_function regprocedure;
  old_filter text := $old$and lower(coalesce(nullif(btrim(m.rules->>'recordType'), ''), 'match')) not in ('solo', 'personal_record')$old$;
  new_filter text := $new$and lower(coalesce(nullif(btrim(m.rules->>'recordType'), ''), 'match')) not in ('solo', 'personal_record')
      and not (
        lower(coalesce(m.rules->>'recordType', '')) = 'match_record'
        and coalesce(m.mmr_excluded_player_ids, '[]'::jsonb) ? mp.user_id
      )$new$;
begin
  foreach target_function in array array[
    'public.rankball_rebuild_profile_match_summary(text)'::regprocedure,
    'public.rankball_refresh_all_profile_match_summaries()'::regprocedure
  ] loop
    select pg_get_functiondef(target_function) into function_definition;
    if position(new_filter in function_definition) = 0 then
      if position(old_filter in function_definition) = 0 then
        raise exception 'match_record_summary_exclusion_shape_changed: %', target_function using errcode = '55000';
      end if;
      execute replace(function_definition, old_filter, new_filter);
    end if;
  end loop;
end;
$migration$;

-- LEGACY REJECT-ONLY: 기존 데이터/감사 이벤트는 읽되 신규 서비스 호출권은 없다.
revoke all on function public.rankball_match_finalize_locked(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_live_finalize_action(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_record_finalize_after_threshold(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_record_finalize_after_approvals(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_approval_pre_record_deadline(text, text, text, text)
  from public, anon, authenticated, service_role;
drop function if exists public.rankball_match_record_finalize_after_approvals(text, text);

revoke all on function public.rankball_match_finalize_locked(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text, boolean)
  to service_role;
revoke all on function public.rankball_match_approval_action(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text)
  to service_role;
revoke all on function public.rankball_match_auto_finalize_action(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rankball_match_auto_finalize_action(text, timestamptz)
  to service_role;

select public.rankball_refresh_all_profile_match_summaries();
select pg_notify('pgrst', 'reload schema');

commit;
