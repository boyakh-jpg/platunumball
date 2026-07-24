begin;

do $$
begin
  if to_regprocedure('public.rankball_recruiting_room_update_action_pre_change_deadline(text,text,jsonb)') is null then
    alter function public.rankball_recruiting_room_update_action(text, text, jsonb)
      rename to rankball_recruiting_room_update_action_pre_change_deadline;
  end if;
  if to_regprocedure('public.rankball_match_room_update_action_pre_change_deadline(text,text,jsonb)') is null then
    alter function public.rankball_match_room_update_action(text, text, jsonb)
      rename to rankball_match_room_update_action_pre_change_deadline;
  end if;
  if to_regprocedure('public.rankball_recruiting_schedule_response_action_pre_deadline(text,text,text,text)') is null then
    alter function public.rankball_recruiting_schedule_response_action(text, text, text, text)
      rename to rankball_recruiting_schedule_response_action_pre_deadline;
  end if;
  if to_regprocedure('public.rankball_match_schedule_response_action_pre_deadline(text,text,text,text)') is null then
    alter function public.rankball_match_schedule_response_action(text, text, text, text)
      rename to rankball_match_schedule_response_action_pre_deadline;
  end if;
  if to_regprocedure('public.rankball_match_start_action_guarded_pre_change_deadline(text,text,text,text,jsonb)') is null then
    alter function public.rankball_match_start_action_guarded(text, text, text, text, jsonb)
      rename to rankball_match_start_action_guarded_pre_change_deadline;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_room_update_action(
  p_actor_profile_id text,
  p_post_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_post_id text := nullif(btrim(p_post_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  current_post public.recruiting_posts%rowtype;
  updated_post public.recruiting_posts%rowtype;
  current_start timestamptz;
  target_start timestamptz;
  target_timing_type text;
  target_date date;
  target_time time;
  proposal jsonb;
  consent_deadline timestamptz;
  next_room_state jsonb;
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;

  current_start := coalesce(
    nullif(current_post.scheduled_at, '')::timestamptz,
    case
      when current_post.scheduled_date is not null and current_post.scheduled_time is not null
        then (current_post.scheduled_date + current_post.scheduled_time) at time zone 'Asia/Seoul'
      else null
    end
  );
  if current_start is null or current_start < now_at + interval '12 hours' then
    raise exception 'room_edit_window_closed' using errcode = '23514';
  end if;

  if patch ?| array['timingType', 'scheduledDate', 'scheduledTime', 'courtId', 'court'] then
    target_timing_type := case
      when patch->>'timingType' in ('instant', 'scheduled') then patch->>'timingType'
      when coalesce(current_post.room_state->>'timingType', '') in ('instant', 'scheduled')
        then current_post.room_state->>'timingType'
      else 'scheduled'
    end;
    if target_timing_type = 'instant' then
      raise exception 'room_schedule_target_too_soon' using errcode = '23514';
    end if;
    target_date := coalesce(nullif(patch->>'scheduledDate', '')::date, current_post.scheduled_date);
    target_time := coalesce(nullif(left(patch->>'scheduledTime', 5), '')::time, current_post.scheduled_time);
    if target_date is null or target_time is null then
      raise exception 'invalid_room_schedule' using errcode = '22023';
    end if;
    target_start := (target_date + target_time) at time zone 'Asia/Seoul';
    if target_start < now_at + interval '12 hours' then
      raise exception 'room_schedule_target_too_soon' using errcode = '23514';
    end if;
  end if;

  result := public.rankball_recruiting_room_update_action_pre_change_deadline(
    p_actor_profile_id,
    safe_post_id,
    patch
  );

  select post.* into updated_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  next_room_state := coalesce(updated_post.room_state, '{}'::jsonb);
  proposal := next_room_state->'scheduleProposal';
  if coalesce(proposal->>'status', '') = 'pending' then
    target_start := case
      when proposal->>'timingType' = 'scheduled'
        then ((proposal->>'scheduledDate')::date + (proposal->>'scheduledTime')::time) at time zone 'Asia/Seoul'
      else current_start
    end;
    consent_deadline := least(current_start, target_start) - interval '6 hours';
    proposal := proposal || jsonb_build_object('consentDeadlineAt', consent_deadline);
    next_room_state := jsonb_set(next_room_state, '{scheduleProposal}', proposal, true);
  else
    consent_deadline := current_start - interval '6 hours';
  end if;
  if jsonb_typeof(next_room_state->'ruleAcknowledgementRequiredIds') = 'array'
     and jsonb_array_length(next_room_state->'ruleAcknowledgementRequiredIds') > 1 then
    next_room_state := next_room_state || jsonb_build_object(
      'ruleAcknowledgementDeadlineAt',
      current_start - interval '6 hours'
    );
  end if;
  update public.recruiting_posts
  set room_state = next_room_state,
      updated_at = now_at
  where id = safe_post_id;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'consentDeadlineAt',
    consent_deadline
  );
end;
$$;

create or replace function public.rankball_match_room_update_action(
  p_actor_profile_id text,
  p_match_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  current_match public.matches%rowtype;
  updated_match public.matches%rowtype;
  current_start timestamptz;
  target_start timestamptz;
  target_timing_type text;
  target_date date;
  target_time time;
  proposal jsonb;
  consent_deadline timestamptz;
  next_rules jsonb;
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select match.* into current_match
  from public.matches match
  where match.id = safe_match_id
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  current_start := coalesce(
    nullif(current_match.scheduled_at, '')::timestamptz,
    case
      when current_match.scheduled_date is not null and current_match.scheduled_time is not null
        then (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul'
      else null
    end
  );
  if current_start is null or current_start < now_at + interval '12 hours' then
    raise exception 'room_edit_window_closed' using errcode = '23514';
  end if;

  if patch ?| array['timingType', 'scheduledDate', 'scheduledTime', 'courtId', 'court'] then
    target_timing_type := case
      when patch->>'timingType' in ('instant', 'scheduled') then patch->>'timingType'
      when coalesce(current_match.rules->>'timingType', '') in ('instant', 'scheduled')
        then current_match.rules->>'timingType'
      else 'scheduled'
    end;
    if target_timing_type = 'instant' then
      raise exception 'room_schedule_target_too_soon' using errcode = '23514';
    end if;
    target_date := coalesce(nullif(patch->>'scheduledDate', '')::date, current_match.scheduled_date);
    target_time := coalesce(nullif(left(patch->>'scheduledTime', 5), '')::time, current_match.scheduled_time);
    if target_date is null or target_time is null then
      raise exception 'invalid_room_schedule' using errcode = '22023';
    end if;
    target_start := (target_date + target_time) at time zone 'Asia/Seoul';
    if target_start < now_at + interval '12 hours' then
      raise exception 'room_schedule_target_too_soon' using errcode = '23514';
    end if;
  end if;

  result := public.rankball_match_room_update_action_pre_change_deadline(
    p_actor_profile_id,
    safe_match_id,
    patch
  );

  select match.* into updated_match
  from public.matches match
  where match.id = safe_match_id
  for update;
  next_rules := coalesce(updated_match.rules, '{}'::jsonb);
  proposal := next_rules->'scheduleProposal';
  if coalesce(proposal->>'status', '') = 'pending' then
    target_start := case
      when proposal->>'timingType' = 'scheduled'
        then ((proposal->>'scheduledDate')::date + (proposal->>'scheduledTime')::time) at time zone 'Asia/Seoul'
      else current_start
    end;
    consent_deadline := least(current_start, target_start) - interval '6 hours';
    proposal := proposal || jsonb_build_object('consentDeadlineAt', consent_deadline);
    next_rules := jsonb_set(next_rules, '{scheduleProposal}', proposal, true);
  else
    consent_deadline := current_start - interval '6 hours';
  end if;
  if jsonb_typeof(next_rules->'ruleAcknowledgementRequiredIds') = 'array'
     and jsonb_array_length(next_rules->'ruleAcknowledgementRequiredIds') > 1 then
    next_rules := next_rules || jsonb_build_object(
      'ruleAcknowledgementDeadlineAt',
      current_start - interval '6 hours'
    );
  end if;
  update public.matches
  set rules = next_rules,
      updated_at = now_at
  where id = safe_match_id;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'consentDeadlineAt',
    consent_deadline
  );
end;
$$;

create or replace function public.rankball_recruiting_expire_room_change(
  p_post_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_post_id text := nullif(btrim(p_post_id), '');
  current_post public.recruiting_posts%rowtype;
  proposal jsonb;
  proposal_id text;
  required_ids text[];
  deadline_at timestamptz;
  now_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;
  proposal := current_post.room_state->'scheduleProposal';
  proposal_id := proposal->>'id';
  deadline_at := nullif(proposal->>'consentDeadlineAt', '')::timestamptz;
  if coalesce(proposal->>'status', '') <> 'pending'
     or deadline_at is null
     or deadline_at > now_at then
    return jsonb_build_object(
      'ok', true,
      'postId', safe_post_id,
      'proposalId', proposal_id,
      'status', coalesce(proposal->>'status', 'none')
    );
  end if;

  select coalesce(array_agg(value), array[]::text[]) into required_ids
  from jsonb_array_elements_text(coalesce(proposal->'requiredIds', '[]'::jsonb)) item(value);
  proposal := proposal || jsonb_build_object(
    'status', 'expired',
    'expiredAt', now_at
  );
  update public.recruiting_posts
  set room_state = coalesce(room_state, '{}'::jsonb) || jsonb_build_object('scheduleProposal', proposal),
      updated_at = now_at
  where id = safe_post_id;
  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
      updated_at = now_at
  where recruiting_post_id = safe_post_id
    and type = 'recruiting_schedule_change_requested'
    and payload->>'proposalId' = proposal_id;
  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type,
    recruiting_post_id, discord_event, payload, created_at, updated_at
  )
  select
    'notice-recruiting-schedule-expired-' || substr(md5(proposal_id || ':' || target.profile_id), 1, 24),
    target.profile_id,
    target.profile_id,
    '일정 변경 기한 만료',
    current_post.title || '의 일정 변경 동의 기한이 지나 기존 일정이 유지됩니다.',
    'match',
    'recruiting_schedule_change_expired',
    safe_post_id,
    'match',
    jsonb_build_object(
      'targetUserId', target.profile_id,
      'recruitingPostId', safe_post_id,
      'proposalId', proposal_id,
      'actionRequired', false,
      'webPath', '/app/recruiting?post=' || safe_post_id
    ),
    now_at,
    now_at
  from unnest(required_ids) target(profile_id)
  on conflict (id) do nothing;
  return jsonb_build_object(
    'ok', true,
    'postId', safe_post_id,
    'proposalId', proposal_id,
    'status', 'expired'
  );
end;
$$;

create or replace function public.rankball_match_expire_room_change(
  p_match_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  proposal jsonb;
  proposal_id text;
  required_ids text[];
  deadline_at timestamptz;
  now_at timestamptz := clock_timestamp();
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select match.* into current_match
  from public.matches match
  where match.id = safe_match_id
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  proposal := current_match.rules->'scheduleProposal';
  proposal_id := proposal->>'id';
  deadline_at := nullif(proposal->>'consentDeadlineAt', '')::timestamptz;
  if coalesce(proposal->>'status', '') <> 'pending'
     or deadline_at is null
     or deadline_at > now_at then
    return jsonb_build_object(
      'ok', true,
      'matchId', safe_match_id,
      'proposalId', proposal_id,
      'status', coalesce(proposal->>'status', 'none')
    );
  end if;

  select coalesce(array_agg(value), array[]::text[]) into required_ids
  from jsonb_array_elements_text(coalesce(proposal->'requiredIds', '[]'::jsonb)) item(value);
  proposal := proposal || jsonb_build_object(
    'status', 'expired',
    'expiredAt', now_at
  );
  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('scheduleProposal', proposal),
      updated_at = now_at
  where id = safe_match_id;
  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
      updated_at = now_at
  where match_id = safe_match_id
    and type = 'match_schedule_change_requested'
    and payload->>'proposalId' = proposal_id;
  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type,
    match_id, discord_event, payload, created_at, updated_at
  )
  select
    'notice-match-schedule-expired-' || substr(md5(proposal_id || ':' || target.profile_id), 1, 24),
    target.profile_id,
    target.profile_id,
    '일정 변경 기한 만료',
    current_match.title || '의 일정 변경 동의 기한이 지나 기존 일정이 유지됩니다.',
    'match',
    'match_schedule_change_expired',
    safe_match_id,
    'match',
    jsonb_build_object(
      'targetUserId', target.profile_id,
      'matchId', safe_match_id,
      'proposalId', proposal_id,
      'actionRequired', false,
      'webPath', '/app/matches?match=' || safe_match_id
    ),
    now_at,
    now_at
  from unnest(required_ids) target(profile_id)
  on conflict (id) do nothing;
  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'proposalId', proposal_id,
    'status', 'expired'
  );
end;
$$;

create or replace function public.rankball_recruiting_schedule_response_action(
  p_actor_profile_id text,
  p_post_id text,
  p_proposal_id text,
  p_decision text default 'approve'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expiration jsonb;
begin
  expiration := public.rankball_recruiting_expire_room_change(p_post_id);
  if expiration->>'status' = 'expired'
     and expiration->>'proposalId' = nullif(btrim(p_proposal_id), '') then
    return expiration;
  end if;
  return public.rankball_recruiting_schedule_response_action_pre_deadline(
    p_actor_profile_id,
    p_post_id,
    p_proposal_id,
    p_decision
  );
end;
$$;

create or replace function public.rankball_match_schedule_response_action(
  p_actor_profile_id text,
  p_match_id text,
  p_proposal_id text,
  p_decision text default 'approve'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expiration jsonb;
begin
  expiration := public.rankball_match_expire_room_change(p_match_id);
  if expiration->>'status' = 'expired'
     and expiration->>'proposalId' = nullif(btrim(p_proposal_id), '') then
    return expiration;
  end if;
  return public.rankball_match_schedule_response_action_pre_deadline(
    p_actor_profile_id,
    p_match_id,
    p_proposal_id,
    p_decision
  );
end;
$$;

create or replace function public.rankball_match_start_action_guarded(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rankball_match_expire_room_change(p_match_id);
  return public.rankball_match_start_action_guarded_pre_change_deadline(
    p_actor_profile_id,
    p_match_id,
    p_started_at,
    p_agreed_at,
    p_attendance
  );
end;
$$;

revoke all on function public.rankball_recruiting_room_update_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_room_update_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_expire_room_change(text) from public, anon, authenticated;
revoke all on function public.rankball_match_expire_room_change(text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_schedule_response_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_schedule_response_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_room_update_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_room_update_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_recruiting_expire_room_change(text) to service_role;
grant execute on function public.rankball_match_expire_room_change(text) to service_role;
grant execute on function public.rankball_recruiting_schedule_response_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_schedule_response_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
