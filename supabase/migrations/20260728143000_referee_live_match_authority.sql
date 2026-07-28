begin;

-- Resolution decisions need an operator reason and an immutable before/after
-- snapshot. Existing rows remain readable without a synthetic backfill.
alter table public.match_disputes
  add column if not exists resolution_reason text,
  add column if not exists resolution_audit jsonb not null default '{}'::jsonb;

alter table public.match_disputes
  drop constraint if exists match_disputes_resolution_reason_length_check;
alter table public.match_disputes
  add constraint match_disputes_resolution_reason_length_check
  check (
    resolution_reason is null
    or char_length(btrim(resolution_reason)) between 1 and 500
  ) not valid;
alter table public.match_disputes
  validate constraint match_disputes_resolution_reason_length_check;

-- The latest score reducer permits the clock controller as a convenience in a
-- referee match. Keep the reducer private and enforce the final authority split
-- before entering it.
do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_score_increment_pre_live_authority(text,text,integer,integer,integer,integer)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)'
    ) is null then
      raise exception 'rankball_match_score_increment_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_score_increment_action(
      text, text, integer, integer, integer, integer
    ) rename to rankball_match_score_increment_pre_live_authority;
  end if;
end;
$migration$;

create or replace function public.rankball_match_score_increment_action(
  p_actor_profile_id text,
  p_match_id text,
  p_delta_a integer default 0,
  p_delta_b integer default 0,
  p_expected_revision_a integer default null,
  p_expected_revision_b integer default null
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
  assigned_referee_id text;
  clock_controller_id text;
  record_type text;
  game_clock_enabled boolean;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
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

  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  record_type := lower(coalesce(current_match.rules->>'recordType', ''));
  game_clock_enabled :=
    record_type not in ('match_record', 'personal_record')
    and lower(coalesce(current_match.rules->>'gameClockEnabled', 'true')) <> 'false';

  if assigned_referee_id is not null then
    if safe_actor_id <> assigned_referee_id
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_score_referee_required' using errcode = '42501';
    end if;
  elsif game_clock_enabled then
    select session.controller_id
    into clock_controller_id
    from public.match_clock_sessions session
    where session.match_id = safe_match_id
    limit 1;

    if safe_actor_id is distinct from nullif(btrim(clock_controller_id), '')
       or not public.rankball_match_clock_controller_eligible(safe_match_id, safe_actor_id) then
      raise exception 'match_score_clock_controller_required' using errcode = '42501';
    end if;
  elsif safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_score_host_required' using errcode = '42501';
  end if;

  return public.rankball_match_score_increment_pre_live_authority(
    safe_actor_id,
    safe_match_id,
    coalesce(p_delta_a, 0),
    coalesce(p_delta_b, 0),
    p_expected_revision_a,
    p_expected_revision_b
  );
end;
$$;

-- Correct the latest host-only live-finalize patch before preserving it as the
-- private shared implementation.
do $migration$
declare
  function_definition text;
  old_authority text := $old$  if lower(coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')) = 'finalizematch' then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_finalize_host_required' using errcode = '42501';
    end if;
  elsif nullif(btrim(current_match.referee_id), '') is null then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_finalize_host_required' using errcode = '42501';
    end if;
  elsif safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_finalize_referee_required' using errcode = '42501';
  end if;$old$;
  new_authority text := $new$  if lower(coalesce(current_match.rules->>'recordType', '')) = 'match_record' then
    raise exception 'match_record_participant_approval_required' using errcode = '42501';
  elsif nullif(btrim(current_match.referee_id), '') is not null then
    if safe_actor_id <> nullif(btrim(current_match.referee_id), '')
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_finalize_referee_required' using errcode = '42501';
    end if;
  elsif safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_finalize_host_required' using errcode = '42501';
  end if;$new$;
begin
  if to_regprocedure(
    'public.rankball_match_finalize_pre_live_authority(text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_finalize_locked(text,text,text)'
    ) is null then
      raise exception 'rankball_match_finalize_locked_missing' using errcode = '42883';
    end if;

    function_definition := pg_get_functiondef(
      'public.rankball_match_finalize_locked(text,text,text)'::regprocedure
    );
    if position(new_authority in function_definition) = 0 then
      if position(old_authority in function_definition) = 0 then
        raise exception 'match_finalize_authority_shape_changed' using errcode = '55000';
      end if;
      execute replace(function_definition, old_authority, new_authority);
    end if;

    alter function public.rankball_match_finalize_locked(text, text, text)
      rename to rankball_match_finalize_pre_live_authority;
  end if;
end;
$migration$;

create or replace function public.rankball_match_live_finalize_action(
  p_actor_profile_id text,
  p_match_id text,
  p_action text default 'finalizeMatch'
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
  assigned_referee_id text;
  record_type text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  record_type := lower(coalesce(current_match.rules->>'recordType', ''));
  if record_type in ('match_record', 'personal_record') then
    raise exception 'match_live_finalize_record_type_invalid' using errcode = '23514';
  end if;

  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  if assigned_referee_id is not null then
    if safe_actor_id <> assigned_referee_id
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_finalize_referee_required' using errcode = '42501';
    end if;
  elsif safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_finalize_host_required' using errcode = '42501';
  end if;

  return public.rankball_match_finalize_pre_live_authority(
    safe_actor_id,
    safe_match_id,
    coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );
end;
$$;

create or replace function public.rankball_match_record_finalize_action(
  p_actor_profile_id text,
  p_match_id text,
  p_action text default 'finalizeMatchRecord'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
begin
  if safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) <> 'match_record' then
    raise exception 'match_record_finalize_type_required' using errcode = '23514';
  end if;
  perform p_actor_profile_id;
  perform p_action;
  raise exception 'match_record_participant_approval_required' using errcode = '42501';
end;
$$;

-- Compatibility router for the existing server endpoint. The two record types
-- enter distinct authority functions before reaching the shared transaction.
create or replace function public.rankball_match_finalize_locked(
  p_actor_profile_id text,
  p_match_id text,
  p_action text default 'finalizeMatch'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
begin
  if safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if lower(coalesce(current_match.rules->>'recordType', '')) = 'match_record' then
    return public.rankball_match_record_finalize_action(
      p_actor_profile_id, safe_match_id, p_action
    );
  end if;
  return public.rankball_match_live_finalize_action(
    p_actor_profile_id, safe_match_id, p_action
  );
end;
$$;

-- Match-record finalization stays private and is reachable only after every
-- required actual participant has approved their own slot.
create or replace function public.rankball_match_record_finalize_after_approvals(
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
  required_count integer := 0;
  approved_count integer := 0;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
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
     or current_match.status <> 'approval'
     or current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null then
    raise exception 'match_record_finalize_locked' using errcode = '23514';
  end if;

  with required_players as (
    select distinct required.value as user_id, 'teamA'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
    ) required(value)
    union
    select distinct required.value as user_id, 'teamB'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
    ) required(value)
  )
  select
    count(*)::integer,
    (count(*) filter (
      where exists (
        select 1
        from public.match_approvals approval
        where approval.match_id = safe_match_id
          and approval.user_id = required_players.user_id
          and approval.side = required_players.side
      )
      and coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb)
        ? required_players.user_id
    ))::integer
  into required_count, approved_count
  from required_players;

  if required_count = 0 or approved_count <> required_count then
    raise exception 'match_record_participant_approval_required' using errcode = '23514';
  end if;

  return public.rankball_match_finalize_locked_pre_score_policy(
    safe_actor_id,
    safe_match_id,
    'approveMatch'
  );
end;
$$;

-- One match_record approval now performs the self-participation confirmation,
-- approval insert, and final all-approved check in one locked transaction.
-- Ordinary live approval stays rejected by the preserved implementation.
do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_approval_pre_participant_accept(text,text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_approval_action(text,text,text,text)'
    ) is null then
      raise exception 'rankball_match_approval_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_approval_action(text, text, text, text)
      rename to rankball_match_approval_pre_participant_accept;
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
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  accepted_ids jsonb;
  approval_result jsonb;
  required_count integer := 0;
  approved_count integer := 0;
begin
  if safe_actor_id is null or safe_actor_id <> safe_player_id then
    raise exception 'match_record_approval_actor_mismatch' using errcode = '42501';
  end if;
  if safe_match_id is null or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_record_approval' using errcode = '22023';
  end if;

  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) <> 'match_record' then
    raise exception 'general_match_participant_approval_retired' using errcode = '42501';
  end if;
  if current_match.rules->>'recordSetupReady' <> 'true'
     or current_match.status not in ('agreed', 'approval')
     or current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null then
    raise exception 'match_record_approval_locked' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.match_players player
    where player.match_id = safe_match_id
      and player.user_id = safe_player_id
      and player.side = safe_side
  ) then
    raise exception 'match_record_approval_player_not_actual' using errcode = '42501';
  end if;
  if not coalesce(
    current_match.rules #> array['recordApproverIds', safe_side],
    '[]'::jsonb
  ) ? safe_player_id then
    raise exception 'match_record_approval_not_required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  into accepted_ids
  from (
    select distinct value
    from jsonb_array_elements_text(
      coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb)
      || jsonb_build_array(safe_player_id)
    ) accepted(value)
    where nullif(btrim(value), '') is not null
  ) unique_ids;

  update public.matches
  set rules = jsonb_set(
        coalesce(rules, '{}'::jsonb),
        '{participantAcceptedIds}',
        accepted_ids,
        true
      ),
      updated_at = clock_timestamp()
  where id = safe_match_id;

  approval_result := public.rankball_match_approval_pre_participant_accept(
    safe_actor_id,
    safe_match_id,
    safe_side,
    safe_player_id
  );

  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  with required_players as (
    select distinct required.value as user_id, 'teamA'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
    ) required(value)
    union
    select distinct required.value as user_id, 'teamB'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
    ) required(value)
  )
  select
    count(*)::integer,
    (count(*) filter (
      where exists (
        select 1
        from public.match_approvals approval
        where approval.match_id = safe_match_id
          and approval.user_id = required_players.user_id
          and approval.side = required_players.side
      )
      and coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb)
        ? required_players.user_id
    ))::integer
  into required_count, approved_count
  from required_players;

  if required_count > 0 and approved_count = required_count then
    return public.rankball_match_record_finalize_after_approvals(
      safe_actor_id,
      safe_match_id
    ) || jsonb_build_object(
      'participationAccepted', true,
      'participantAcceptedIds', accepted_ids
    );
  end if;

  return approval_result || jsonb_build_object(
    'participationAccepted', true,
    'participantAcceptedIds', accepted_ids
  );
end;
$$;

-- Require a real filing reason for both referee and no-referee disputes.
do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_dispute_pre_reason_required(text,text,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_dispute_action(text,text,jsonb)'
    ) is null then
      raise exception 'rankball_match_dispute_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_dispute_action(text, text, jsonb)
      rename to rankball_match_dispute_pre_reason_required;
  end if;
end;
$migration$;

create or replace function public.rankball_match_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_request jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  dispute_request jsonb := coalesce(p_dispute_request, '{}'::jsonb);
  dispute_reason text;
begin
  dispute_reason := case jsonb_typeof(dispute_request)
    when 'object' then nullif(btrim(dispute_request->>'reason'), '')
    when 'string' then nullif(btrim(dispute_request #>> '{}'), '')
    else null
  end;
  if dispute_reason is null or char_length(dispute_reason) > 500 then
    raise exception 'match_dispute_reason_required' using errcode = '22023';
  end if;

  return public.rankball_match_dispute_pre_reason_required(
    p_actor_profile_id,
    p_match_id,
    dispute_request
  );
end;
$$;

-- Restore the referee/no-referee decision split that the latest host-only patch
-- replaced, then make the four-argument RPC a reason-required compatibility
-- blocker.
do $migration$
declare
  function_definition text;
  old_authority text := $old$  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_dispute_host_required' using errcode = '42501';
  end if;$old$;
  new_authority text := $new$  if nullif(btrim(current_match.referee_id), '') is not null then
    if safe_actor_id <> nullif(btrim(current_match.referee_id), '')
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_dispute_referee_required' using errcode = '42501';
    end if;
  elsif safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_dispute_host_required' using errcode = '42501';
  end if;$new$;
begin
  if to_regprocedure(
    'public.rankball_match_resolve_dispute_pre_reason(text,text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_resolve_dispute_action(text,text,text,text)'
    ) is null then
      raise exception 'rankball_match_resolve_dispute_action_missing' using errcode = '42883';
    end if;

    function_definition := pg_get_functiondef(
      'public.rankball_match_resolve_dispute_action(text,text,text,text)'::regprocedure
    );
    if position(new_authority in function_definition) = 0 then
      if position(old_authority in function_definition) = 0 then
        raise exception 'match_dispute_authority_shape_changed' using errcode = '55000';
      end if;
      execute replace(function_definition, old_authority, new_authority);
    end if;

    alter function public.rankball_match_resolve_dispute_action(text, text, text, text)
      rename to rankball_match_resolve_dispute_pre_reason;
  end if;
end;
$migration$;

create or replace function public.rankball_match_resolve_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_id text,
  p_decision text,
  p_resolution_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_dispute_id text := nullif(btrim(p_dispute_id), '');
  safe_decision text := lower(nullif(btrim(p_decision), ''));
  safe_resolution_reason text := nullif(btrim(p_resolution_reason), '');
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  current_dispute public.match_disputes%rowtype;
  authority_scope text;
  before_result jsonb;
  after_result jsonb;
  resolved_result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null
     or safe_dispute_id is null
     or safe_decision not in ('accepted', 'rejected') then
    raise exception 'invalid_match_dispute_resolution_input' using errcode = '22023';
  end if;
  if safe_resolution_reason is null
     or char_length(safe_resolution_reason) > 500 then
    raise exception 'match_dispute_resolution_reason_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if nullif(btrim(current_match.referee_id), '') is not null then
    if safe_actor_id <> nullif(btrim(current_match.referee_id), '')
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_dispute_referee_required' using errcode = '42501';
    end if;
    authority_scope := 'referee';
  elsif safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_dispute_host_required' using errcode = '42501';
  else
    authority_scope := 'host';
  end if;

  select * into current_dispute
  from public.match_disputes dispute
  where dispute.match_id = safe_match_id
    and dispute.id::text = safe_dispute_id
    and dispute.status = 'open'
  for update;
  if current_dispute.id is null then
    raise exception 'match_dispute_item_not_open' using errcode = 'P0002';
  end if;

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;
  before_result := case when current_result.match_id is null then null else
    jsonb_build_object(
      'scoreA', current_result.score_a,
      'scoreB', current_result.score_b,
      'scoreRevisionA', current_result.score_revision_a,
      'scoreRevisionB', current_result.score_revision_b,
      'statSubmissions', coalesce(current_result.stat_submissions, '{}'::jsonb)
    )
  end;

  resolved_result := public.rankball_match_resolve_dispute_pre_reason(
    safe_actor_id,
    safe_match_id,
    safe_dispute_id,
    safe_decision
  );

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;
  after_result := case when current_result.match_id is null then null else
    jsonb_build_object(
      'scoreA', current_result.score_a,
      'scoreB', current_result.score_b,
      'scoreRevisionA', current_result.score_revision_a,
      'scoreRevisionB', current_result.score_revision_b,
      'statSubmissions', coalesce(current_result.stat_submissions, '{}'::jsonb)
    )
  end;

  update public.match_disputes
  set resolution_reason = safe_resolution_reason,
      resolution_audit = jsonb_build_object(
        'handledBy', safe_actor_id,
        'handledAt', now_at,
        'decision', safe_decision,
        'authority', authority_scope,
        'previousResult', before_result,
        'nextResult', after_result
      )
  where id = current_dispute.id;

  return resolved_result || jsonb_build_object(
    'resolutionReason', safe_resolution_reason,
    'resolutionAudit', jsonb_build_object(
      'handledBy', safe_actor_id,
      'handledAt', now_at,
      'decision', safe_decision,
      'authority', authority_scope,
      'previousResult', before_result,
      'nextResult', after_result
    )
  );
end;
$$;

create or replace function public.rankball_match_resolve_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_id text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform p_actor_profile_id;
  perform p_match_id;
  perform p_dispute_id;
  perform p_decision;
  raise exception 'match_dispute_resolution_reason_required' using errcode = '22023';
end;
$$;

-- Preserve the unified transition reducer while removing the action and
-- recorder parameters from the supported live substitution contract.
do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_roster_transition_pre_reason_guard(text,text,text,text,text,text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_roster_transition_action(text,text,text,text,text,text,text,text)'
    ) is null then
      raise exception 'rankball_match_roster_transition_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_roster_transition_action(
      text, text, text, text, text, text, text, text
    ) rename to rankball_match_roster_transition_pre_reason_guard;
  end if;
end;
$migration$;

create or replace function public.rankball_match_roster_transition_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_side text,
  p_active_player_id text default null,
  p_reserve_player_id text default null,
  p_next_recorder_id text default null,
  p_reason text default 'operator'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_action text := nullif(btrim(p_action), '');
  safe_next_recorder_id text := nullif(btrim(p_next_recorder_id), '');
  safe_reason text := lower(coalesce(nullif(btrim(p_reason), ''), 'operator'));
begin
  if safe_action <> 'substituteMatchPlayer' or safe_next_recorder_id is not null then
    raise exception 'match_recorder_flow_retired' using errcode = '42501';
  end if;
  if safe_reason = 'injury' then
    raise exception 'match_substitution_injury_retired' using errcode = '22023';
  end if;
  if safe_reason not in ('self', 'late', 'ejection', 'operator') then
    raise exception 'invalid_match_substitution_reason' using errcode = '22023';
  end if;

  return public.rankball_match_roster_transition_pre_reason_guard(
    p_actor_profile_id,
    'substituteMatchPlayer',
    p_match_id,
    p_side,
    p_active_player_id,
    p_reserve_player_id,
    null,
    safe_reason
  );
end;
$$;

create or replace function public.rankball_match_substitute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_active_player_id text,
  p_reserve_player_id text,
  p_reason text default 'operator'
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.rankball_match_roster_transition_action(
    p_actor_profile_id,
    'substituteMatchPlayer',
    p_match_id,
    p_side,
    p_active_player_id,
    p_reserve_player_id,
    null,
    p_reason
  );
$$;

-- Historical recorder objects remain readable, but no service path may create
-- a new assignment, takeover, handoff, or recorder-coupled substitution.
revoke all on function public.rankball_match_scorekeeper_scope_action(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_recorder_takeover_action(text, text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_substitution_action(text, text, text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text)
from public, anon, authenticated, service_role;

revoke all on function public.rankball_match_score_increment_pre_live_authority(
  text, text, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_finalize_pre_live_authority(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_approval_pre_participant_accept(text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_record_finalize_after_approvals(text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_dispute_pre_reason_required(text, text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_resolve_dispute_pre_reason(text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_roster_transition_pre_reason_guard(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;

revoke all on function public.rankball_match_score_increment_action(
  text, text, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.rankball_match_score_increment_action(
  text, text, integer, integer, integer, integer
) to service_role;

revoke all on function public.rankball_match_live_finalize_action(text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_live_finalize_action(text, text, text)
to service_role;
revoke all on function public.rankball_match_record_finalize_action(text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_record_finalize_action(text, text, text)
to service_role;
revoke all on function public.rankball_match_finalize_locked(text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text)
to service_role;

revoke all on function public.rankball_match_approval_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text)
to service_role;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb)
to service_role;

revoke all on function public.rankball_match_resolve_dispute_action(text, text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_resolve_dispute_action(text, text, text, text, text)
to service_role;
revoke all on function public.rankball_match_resolve_dispute_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_resolve_dispute_action(text, text, text, text)
to service_role;

revoke all on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) to service_role;
revoke all on function public.rankball_match_substitute_action(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_substitute_action(
  text, text, text, text, text, text
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
