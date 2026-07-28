begin;

-- New stat rows use only the active authority model. Existing legacy rows stay readable.
create or replace function public.rankball_guard_new_player_match_stat_source()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
  record_type text;
begin
  select * into current_match
  from public.matches
  where id = new.match_id;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  record_type := lower(coalesce(current_match.rules->>'recordType', 'match'));
  if record_type = 'match_record' then
    raise exception 'match_record_personal_stats_forbidden' using errcode = '42501';
  elsif record_type in ('solo', 'personal_record') then
    if new.record_source <> 'player'
       or new.user_id is distinct from current_match.created_by
       or coalesce(nullif(btrim(new.recorded_by), ''), new.user_id)
          is distinct from current_match.created_by then
      raise exception 'personal_record_owner_source_required' using errcode = '42501';
    end if;
  elsif nullif(btrim(current_match.referee_id), '') is not null then
    if new.record_source not in ('referee', 'dispute_operator')
       or coalesce(nullif(btrim(new.recorded_by), ''), new.user_id)
          is distinct from current_match.referee_id then
      raise exception 'referee_record_source_required' using errcode = '42501';
    end if;
  else
    raise exception 'no_referee_personal_stats_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_new_player_match_stat_source_guard
  on public.player_match_stats;
create trigger rankball_new_player_match_stat_source_guard
before insert on public.player_match_stats
for each row execute function public.rankball_guard_new_player_match_stat_source();

revoke all on function public.rankball_guard_new_player_match_stat_source()
from public, anon, authenticated, service_role;

-- Stop new recorder rewards and team MMR for match_record while preserving legacy metrics.
do $migration$
declare
  function_definition text;
  old_reward text := $old$      select value->>'by' as recorder_id, public.rankball_rating_policy_number(array['trust', 'candidateRecorderReward'], 2, 0, 5)::integer as delta
      from jsonb_each(coalesce(result_row.stat_submissions, '{}'::jsonb))
      where value->>'source' = 'candidate_recorder' and nullif(value->>'by', '') is not null
      union all select current_match.referee_id, public.rankball_rating_policy_number(array['trust', 'refereeReward'], 1, 0, 5)::integer where current_match.referee_id is not null$old$;
  new_reward text := $new$      select current_match.referee_id as recorder_id,
        public.rankball_rating_policy_number(array['trust', 'refereeReward'], 1, 0, 5)::integer as delta
      where current_match.referee_id is not null$new$;
  old_team_guard text := $old$    where current_match.ranked
      and team.deleted_at is null$old$;
  new_team_guard text := $new$    where current_match.ranked
      and lower(coalesce(current_match.rules->>'recordType', 'match')) <> 'match_record'
      and team.deleted_at is null$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_finalize_locked_pre_score_policy(text,text,text)'::regprocedure
  );
  if position(new_reward in function_definition) = 0 then
    if position(old_reward in function_definition) = 0 then
      raise exception 'match_finalize_recorder_reward_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_reward, new_reward);
  end if;
  if position(new_team_guard in function_definition) = 0 then
    if position(old_team_guard in function_definition) = 0 then
      raise exception 'match_finalize_team_rating_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_team_guard, new_team_guard);
  end if;
  execute function_definition;
end;
$migration$;

-- The legacy recorderCount metric remains, but new community service excludes it.
do $migration$
declare
  function_definition text;
  old_metric text := $old$  community_service_count :=
    coalesce((base_metrics->>'refereeCount')::integer, 0)
    + coalesce((base_metrics->>'recorderCount')::integer, 0);$old$;
  new_metric text := $new$  community_service_count :=
    coalesce((base_metrics->>'refereeCount')::integer, 0)
    + coalesce((base_metrics->>'courtContributionCount')::integer, 0);$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_profile_icon_verified_metrics(text)'::regprocedure
  );
  if position(new_metric in function_definition) = 0 then
    if position(old_metric in function_definition) = 0 then
      raise exception 'profile_community_service_metric_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_metric, new_metric);
  end if;
end;
$migration$;

-- One self-confirmation records both participation and the entered score.
-- It never finalizes early; the 24-hour service action owns finalization.
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
  accepted_ids jsonb := '[]'::jsonb;
  required_count integer := 0;
  confirmed_count integer := 0;
  confirmation_threshold integer := 0;
  submitted_at timestamptz;
begin
  if safe_actor_id is null
     or safe_actor_id <> safe_player_id
     or safe_side not in ('teamA', 'teamB') then
    raise exception 'match_record_approval_actor_mismatch' using errcode = '42501';
  end if;
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));

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
  select result.submitted_at into submitted_at
  from public.match_results result
  where result.match_id = safe_match_id;
  if submitted_at is null then
    raise exception 'match_result_missing' using errcode = '23514';
  end if;

  insert into public.match_approvals (match_id, user_id, side, approved_at)
  values (safe_match_id, safe_player_id, safe_side, clock_timestamp())
  on conflict (match_id, user_id) do update set
    side = excluded.side,
    approved_at = excluded.approved_at;

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
  set status = 'approval',
      rules = jsonb_set(
        coalesce(rules, '{}'::jsonb),
        '{participantAcceptedIds}',
        accepted_ids,
        true
      ),
      updated_at = clock_timestamp()
  where id = safe_match_id;

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
    count(*) filter (
      where exists (
        select 1
        from public.match_approvals approval
        where approval.match_id = safe_match_id
          and approval.user_id = required_players.user_id
          and approval.side = required_players.side
      )
      and accepted_ids ? required_players.user_id
    )::integer
  into required_count, confirmed_count
  from required_players;

  confirmation_threshold := ceil(required_count * 2.0 / 3.0)::integer;
  return jsonb_build_object(
    'ok', true,
    'action', 'approveMatch',
    'matchId', safe_match_id,
    'participationAccepted', true,
    'participantAcceptedIds', accepted_ids,
    'requiredCount', required_count,
    'confirmedCount', confirmed_count,
    'confirmationThreshold', confirmation_threshold,
    'thresholdMet', confirmation_threshold > 0 and confirmed_count >= confirmation_threshold,
    'deadlineAt', submitted_at + interval '24 hours',
    'finalized', false,
    'sqlReducer', true
  );
end;
$$;

-- Private 24-hour match_record finalizer.
create or replace function public.rankball_match_record_finalize_after_approvals(
  p_actor_profile_id text,
  p_match_id text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  result_submitted_at timestamptz;
  required_count integer := 0;
  confirmed_count integer := 0;
  confirmation_threshold integer := 0;
  confirmed_ids jsonb := '[]'::jsonb;
  excluded_ids jsonb := '[]'::jsonb;
  operator_id text;
  now_at timestamptz := coalesce(p_now, now());
begin
  perform p_actor_profile_id;
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
     or current_match.confirmed_at is not null then
    raise exception 'match_record_finalize_locked' using errcode = '23514';
  end if;
  select result.submitted_at into result_submitted_at
  from public.match_results result
  where result.match_id = safe_match_id;
  if result_submitted_at is null
     or now_at < result_submitted_at + interval '24 hours' then
    raise exception 'match_record_confirmation_window_open' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id and dispute.status = 'open'
  ) or exists (
    select 1 from public.reports report
    where report.type = 'match'
      and report.target_id = safe_match_id
      and report.status = 'open'
  ) then
    raise exception 'match_record_open_issue_required' using errcode = '23514';
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
  ), confirmation as (
    select required.user_id, required.side
    from required_players required
    where exists (
      select 1 from public.match_approvals approval
      where approval.match_id = safe_match_id
        and approval.user_id = required.user_id
        and approval.side = required.side
    )
      and coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb)
        ? required.user_id
  )
  select
    (select count(*)::integer from required_players),
    (select count(*)::integer from confirmation),
    coalesce((select jsonb_agg(to_jsonb(user_id) order by user_id) from confirmation), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(user_id) order by user_id)
      from required_players
      where not exists (
        select 1 from confirmation where confirmation.user_id = required_players.user_id
      )
    ), '[]'::jsonb)
  into required_count, confirmed_count, confirmed_ids, excluded_ids;

  confirmation_threshold := ceil(required_count * 2.0 / 3.0)::integer;
  if confirmation_threshold = 0 or confirmed_count < confirmation_threshold then
    raise exception 'match_record_two_thirds_confirmation_required' using errcode = '23514';
  end if;

  operator_id := nullif(btrim(current_match.created_by), '');
  update public.matches
  set status = 'approval',
      ranked = true,
      official = false,
      mmr_excluded_player_ids = excluded_ids,
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'ratingScale', 0.2,
        'teamRatingDisabled', true,
        'mmrExcludedPlayerIds', excluded_ids,
        'participantAcceptedIds', confirmed_ids
      ),
      updated_at = clock_timestamp()
  where id = safe_match_id;

  return public.rankball_match_finalize_locked_pre_score_policy(
    operator_id,
    safe_match_id,
    'autoConfirmMatchRecord'
  ) || jsonb_build_object(
    'requiredCount', required_count,
    'confirmedCount', confirmed_count,
    'confirmationThreshold', confirmation_threshold,
    'mmrEligiblePlayerIds', confirmed_ids,
    'mmrExcludedPlayerIds', excluded_ids
  );
end;
$$;

-- Compatibility wrapper for the already-private two-argument signature.
create or replace function public.rankball_match_record_finalize_after_approvals(
  p_actor_profile_id text,
  p_match_id text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.rankball_match_record_finalize_after_approvals(
    p_actor_profile_id,
    p_match_id,
    clock_timestamp()
  );
$$;

-- Explicit live approval always leaves at least three minutes for objections.
do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_live_finalize_pre_minimum_dispute(text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_live_finalize_action(text,text,text)'
    ) is null then
      raise exception 'rankball_match_live_finalize_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_live_finalize_action(text, text, text)
      rename to rankball_match_live_finalize_pre_minimum_dispute;
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
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  result_submitted_at timestamptz;
begin
  select * into current_match
  from public.matches
  where id = safe_match_id;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  select result.submitted_at into result_submitted_at
  from public.match_results result
  where result.match_id = safe_match_id;
  if result_submitted_at is null
     or clock_timestamp() < greatest(
       coalesce(current_match.ended_at, result_submitted_at),
       result_submitted_at
     ) + interval '3 minutes' then
    raise exception 'match_dispute_minimum_window_open' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.reports report
    where report.type = 'match'
      and report.target_id = safe_match_id
      and report.status = 'open'
  ) then
    raise exception 'match_open_report_required' using errcode = '23514';
  end if;
  return public.rankball_match_live_finalize_pre_minimum_dispute(
    p_actor_profile_id,
    safe_match_id,
    p_action
  );
end;
$$;

-- Insurance finalization: live matches use disputeMinutes; match_record uses 24 hours.
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
  result_submitted_at timestamptz;
  operator_id text;
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
    return public.rankball_match_record_finalize_after_approvals(
      current_match.created_by,
      safe_match_id,
      now_at
    );
  end if;
  if lower(coalesce(current_match.rules->>'recordType', 'match')) = 'personal_record'
     or current_match.status not in ('agreed', 'approval')
     or current_match.confirmed_at is not null
     or current_match.ended_at is null then
    raise exception 'match_auto_finalization_locked' using errcode = '23514';
  end if;

  select result.submitted_at into result_submitted_at
  from public.match_results result
  where result.match_id = safe_match_id;
  if result_submitted_at is null
     or now_at < greatest(current_match.ended_at, result_submitted_at)
       + make_interval(mins => public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)) then
    raise exception 'match_auto_finalization_not_due' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id and dispute.status = 'open'
  ) or exists (
    select 1 from public.reports report
    where report.type = 'match'
      and report.target_id = safe_match_id
      and report.status = 'open'
  ) then
    raise exception 'match_auto_finalization_issue_open' using errcode = '23514';
  end if;

  operator_id := coalesce(
    nullif(btrim(current_match.referee_id), ''),
    nullif(btrim(current_match.created_by), '')
  );
  return public.rankball_match_live_finalize_pre_minimum_dispute(
    operator_id,
    safe_match_id,
    'autoConfirmMatch'
  ) || jsonb_build_object('autoFinalized', true);
end;
$$;

revoke all on function public.rankball_match_finalize_locked_pre_score_policy(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_live_finalize_pre_minimum_dispute(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_record_finalize_after_approvals(text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_record_finalize_after_approvals(text, text, timestamptz)
from public, anon, authenticated, service_role;

revoke all on function public.rankball_match_approval_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text)
to service_role;
revoke all on function public.rankball_match_live_finalize_action(text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_live_finalize_action(text, text, text)
to service_role;
revoke all on function public.rankball_match_auto_finalize_action(text, timestamptz)
from public, anon, authenticated;
grant execute on function public.rankball_match_auto_finalize_action(text, timestamptz)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
