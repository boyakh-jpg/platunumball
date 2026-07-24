begin;

do $$
begin
  if to_regprocedure('public.rankball_recruiting_close_action_pre_cancel_policy(text,text)') is null then
    alter function public.rankball_recruiting_close_action(text, text)
      rename to rankball_recruiting_close_action_pre_cancel_policy;
  end if;
  if to_regprocedure('public.rankball_match_terminal_action_pre_cancel_policy(text,text,text)') is null then
    alter function public.rankball_match_terminal_action(text, text, text)
      rename to rankball_match_terminal_action_pre_cancel_policy;
  end if;
  if to_regprocedure('public.rankball_match_terminal_action_pre_cancel_policy(text,text,text,text)') is null then
    alter function public.rankball_match_terminal_action(text, text, text, text)
      rename to rankball_match_terminal_action_pre_cancel_policy;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_close_action(
  p_actor_profile_id text,
  p_post_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  current_post public.recruiting_posts%rowtype;
  closed_post public.recruiting_posts%rowtype;
  proposal jsonb;
  proposal_status text;
  proposal_deadline timestamptz;
  rule_deadline timestamptz;
  required_ids text[];
  acknowledged_ids text[];
  scheduled_at timestamptz;
  hours_until numeric;
  waiver_reason text := '';
  desired_penalty integer := 0;
  actual_penalty integer := 0;
  original_penalties jsonb := '[]'::jsonb;
  next_penalties jsonb := '[]'::jsonb;
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_recruiting_expire_room_change(safe_post_id);
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;
  if current_post.status = 'closed' then
    return public.rankball_recruiting_close_action_pre_cancel_policy(
      safe_actor_id,
      safe_post_id
    );
  end if;

  scheduled_at := coalesce(
    nullif(current_post.scheduled_at, '')::timestamptz,
    case
      when current_post.scheduled_date is not null and current_post.scheduled_time is not null
        then (current_post.scheduled_date + current_post.scheduled_time) at time zone 'Asia/Seoul'
      else null
    end
  );
  if scheduled_at is not null then
    hours_until := extract(epoch from (scheduled_at - now_at)) / 3600;
    if hours_until <= 2 then
      raise exception 'room_cancel_locked' using errcode = '23514';
    end if;
  end if;

  proposal := current_post.room_state->'scheduleProposal';
  proposal_status := coalesce(proposal->>'status', '');
  proposal_deadline := nullif(proposal->>'consentDeadlineAt', '')::timestamptz;
  if proposal_status in ('rejected', 'expired') then
    waiver_reason := proposal_status;
  elsif proposal_status = 'pending' and proposal_deadline is not null and proposal_deadline <= now_at then
    waiver_reason := 'schedule_consent_expired';
  end if;

  if waiver_reason = '' then
    rule_deadline := nullif(current_post.room_state->>'ruleAcknowledgementDeadlineAt', '')::timestamptz;
    if rule_deadline is not null and rule_deadline <= now_at then
      required_ids := public.rankball_recruiting_change_required_ids(safe_post_id);
      select coalesce(array_agg(value), array[]::text[]) into acknowledged_ids
      from jsonb_array_elements_text(coalesce(current_post.room_state->'ruleAcknowledgedIds', '[]'::jsonb)) item(value);
      if exists (
        select 1
        from unnest(required_ids) required(profile_id)
        where not required.profile_id = any(acknowledged_ids)
      ) then
        waiver_reason := 'rule_acknowledgement_expired';
      end if;
    end if;
  end if;

  if waiver_reason = '' and scheduled_at is not null then
    desired_penalty := case
      when hours_until <= 6 then public.rankball_rating_policy_number(
        array['trust', 'closeWithin6HoursPenalty'], 5, 0, 15
      )::integer
      when hours_until <= 12 then public.rankball_rating_policy_number(
        array['trust', 'closeWithin24HoursPenalty'], 3, 0, 15
      )::integer
      else 0
    end;
  end if;
  original_penalties := case
    when jsonb_typeof(current_post.room_state->'hostPenalties') = 'array'
      then current_post.room_state->'hostPenalties'
    else '[]'::jsonb
  end;

  result := public.rankball_recruiting_close_action_pre_cancel_policy(
    safe_actor_id,
    safe_post_id
  );
  actual_penalty := case
    when coalesce(result->>'penalty', '') ~ '^[0-9]+$' then (result->>'penalty')::integer
    else 0
  end;
  if actual_penalty <> desired_penalty then
    update public.profiles
    set trust_score = greatest(0, coalesce(trust_score, 80) + actual_penalty - desired_penalty),
        updated_at = now_at
    where id = safe_actor_id;
  end if;

  select post.* into closed_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  next_penalties := original_penalties;
  if desired_penalty > 0 then
    next_penalties := next_penalties || jsonb_build_array(jsonb_build_object(
      'id', 'penalty_' || replace(gen_random_uuid()::text, '-', ''),
      'by', safe_actor_id,
      'penalty', desired_penalty,
      'reason', 'room_cancelled_within_12_hours',
      'createdAt', now_at
    ));
  end if;
  update public.recruiting_posts
  set room_state = coalesce(closed_post.room_state, '{}'::jsonb) || jsonb_build_object(
        'hostPenalties', next_penalties,
        'cancelPenalty', desired_penalty,
        'cancelPenaltyWaived', waiver_reason <> '',
        'cancelWaiverReason', waiver_reason,
        'cancelledAt', now_at
      ),
      updated_at = now_at
  where id = safe_post_id;

  delete from public.notifications
  where recruiting_post_id = safe_post_id
    and target_user_id = safe_actor_id
    and type = 'recruiting_closed'
    and coalesce(payload->>'penalty', '') <> '';
  if desired_penalty > 0 then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      recruiting_post_id, payload, created_at, updated_at
    ) values (
      'notice-recruiting-cancel-penalty-' || substr(md5(safe_post_id || ':' || now_at::text), 1, 24),
      safe_actor_id,
      safe_actor_id,
      '경기 취소 신뢰도 반영',
      '경기 시작 12시간 이내에 취소해 신뢰도 ' || desired_penalty::text || '점이 감소했습니다.',
      'orange',
      'recruiting_cancel_penalty',
      safe_post_id,
      jsonb_build_object(
        'targetUserId', safe_actor_id,
        'recruitingPostId', safe_post_id,
        'penalty', desired_penalty,
        'actionRequired', false,
        'skipDiscordSync', true
      ),
      now_at,
      now_at
    );
  end if;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'penalty', desired_penalty,
    'penaltyWaived', waiver_reason <> '',
    'waiverReason', waiver_reason
  );
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
  current_match public.matches%rowtype;
  proposal jsonb;
  proposal_status text;
  proposal_deadline timestamptz;
  rule_deadline timestamptz;
  required_ids text[];
  acknowledged_ids text[];
  scheduled_at timestamptz;
  hours_until numeric;
  waiver_reason text := '';
  desired_penalty integer := 0;
  record_room boolean := false;
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  if safe_action <> 'cancelMatch' then
    return public.rankball_match_terminal_action_pre_cancel_policy(
      p_actor_profile_id,
      p_action,
      p_match_id,
      p_reason
    );
  end if;

  perform public.rankball_match_expire_room_change(safe_match_id);
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select match.* into current_match
  from public.matches match
  where match.id = safe_match_id
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status not in ('contract', 'agreed') then
    return public.rankball_match_terminal_action_pre_cancel_policy(
      p_actor_profile_id,
      p_action,
      p_match_id,
      p_reason
    );
  end if;
  record_room := coalesce(current_match.rules->>'recordType', 'match') = 'match_record';
  scheduled_at := coalesce(
    nullif(current_match.scheduled_at, '')::timestamptz,
    case
      when current_match.scheduled_date is not null and current_match.scheduled_time is not null
        then (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul'
      else null
    end
  );
  if not record_room and scheduled_at is not null then
    hours_until := extract(epoch from (scheduled_at - now_at)) / 3600;
    if hours_until <= 2 then
      raise exception 'room_cancel_locked' using errcode = '23514';
    end if;
  end if;

  if not record_room then
    proposal := current_match.rules->'scheduleProposal';
    proposal_status := coalesce(proposal->>'status', '');
    proposal_deadline := nullif(proposal->>'consentDeadlineAt', '')::timestamptz;
    if proposal_status in ('rejected', 'expired') then
      waiver_reason := proposal_status;
    elsif proposal_status = 'pending' and proposal_deadline is not null and proposal_deadline <= now_at then
      waiver_reason := 'schedule_consent_expired';
    end if;

    if waiver_reason = '' then
      rule_deadline := nullif(current_match.rules->>'ruleAcknowledgementDeadlineAt', '')::timestamptz;
      if rule_deadline is not null and rule_deadline <= now_at then
        required_ids := public.rankball_match_change_required_ids(safe_match_id);
        select coalesce(array_agg(value), array[]::text[]) into acknowledged_ids
        from jsonb_array_elements_text(coalesce(current_match.rules->'ruleAcknowledgedIds', '[]'::jsonb)) item(value);
        if exists (
          select 1
          from unnest(required_ids) required(profile_id)
          where not required.profile_id = any(acknowledged_ids)
        ) then
          waiver_reason := 'rule_acknowledgement_expired';
        end if;
      end if;
    end if;

    if waiver_reason = '' and scheduled_at is not null then
      desired_penalty := case
        when hours_until <= 6 then public.rankball_rating_policy_number(
          array['trust', 'closeWithin6HoursPenalty'], 5, 0, 15
        )::integer
        when hours_until <= 12 then public.rankball_rating_policy_number(
          array['trust', 'closeWithin24HoursPenalty'], 3, 0, 15
        )::integer
        else 0
      end;
    end if;
  end if;

  result := public.rankball_match_terminal_action_pre_cancel_policy(
    p_actor_profile_id,
    p_action,
    p_match_id,
    p_reason
  );
  if desired_penalty > 0 and nullif(btrim(current_match.created_by), '') is not null then
    update public.profiles
    set trust_score = greatest(0, coalesce(trust_score, 80) - desired_penalty),
        updated_at = now_at
    where id = current_match.created_by;
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      match_id, payload, created_at, updated_at
    ) values (
      'notice-match-cancel-penalty-' || substr(md5(safe_match_id || ':' || now_at::text), 1, 24),
      current_match.created_by,
      current_match.created_by,
      '경기 취소 신뢰도 반영',
      '경기 시작 12시간 이내에 취소해 신뢰도 ' || desired_penalty::text || '점이 감소했습니다.',
      'orange',
      'match_cancel_penalty',
      safe_match_id,
      jsonb_build_object(
        'targetUserId', current_match.created_by,
        'matchId', safe_match_id,
        'penalty', desired_penalty,
        'actionRequired', false,
        'skipDiscordSync', true
      ),
      now_at,
      now_at
    );
  end if;
  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'cancelPenalty', desired_penalty,
        'cancelPenaltyWaived', waiver_reason <> '',
        'cancelWaiverReason', waiver_reason
      ),
      updated_at = now_at
  where id = safe_match_id;
  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'penalty', desired_penalty,
    'penaltyWaived', waiver_reason <> '',
    'waiverReason', waiver_reason
  );
end;
$$;

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
  return public.rankball_match_terminal_action(
    p_actor_profile_id,
    p_action,
    p_match_id,
    null
  );
end;
$$;

revoke all on function public.rankball_recruiting_close_action(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_terminal_action(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_terminal_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_close_action(text, text) to service_role;
grant execute on function public.rankball_match_terminal_action(text, text, text) to service_role;
grant execute on function public.rankball_match_terminal_action(text, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
