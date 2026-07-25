create or replace function public.rankball_match_clock_rating_factor(
  p_match_id text,
  p_mode text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  session_row public.match_clock_sessions%rowtype;
  expected_ms bigint;
  fallback_factor numeric;
  record_type text;
  game_clock_enabled boolean := true;
  explicit_end_recorded boolean := false;
begin
  select
    nullif(btrim(match_row.rules->>'recordType'), ''),
    lower(coalesce(match_row.rules->>'gameClockEnabled', 'true')) <> 'false'
  into record_type, game_clock_enabled
  from public.matches match_row
  where match_row.id = nullif(btrim(p_match_id), '');

  if record_type in ('personal_record', 'match_record') then
    return 1;
  end if;

  fallback_factor := case p_mode
    when '1v1' then 0.5
    when '2v2' then 0.65
    when '3v3' then 0.8
    when '5v5' then 0.9
    else 0.8
  end;

  if not game_clock_enabled then
    return fallback_factor;
  end if;

  select * into session_row
  from public.match_clock_sessions
  where match_id = nullif(btrim(p_match_id), '');

  if session_row.match_id is null then
    return 1;
  end if;

  select exists (
    select 1
    from public.match_clock_events event
    where event.match_id = session_row.match_id
      and event.action = 'endClock'
  ) into explicit_end_recorded;

  expected_ms := public.rankball_match_clock_period_seconds(session_row.match_id)::bigint
    * public.rankball_match_clock_period_count(session_row.match_id)::bigint
    * 1000;

  if session_row.started_within_window
    and session_row.clock_started_at is not null
    and session_row.clock_ended_at is not null
    and explicit_end_recorded
    and session_row.active_elapsed_ms >= ceil(expected_ms * 0.7)::bigint
  then
    return 1;
  end if;

  return fallback_factor;
end;
$$;

do $migration$
declare
  function_definition text;
  old_text text := $old$    can_start_overtime := score_a = score_b;$old$;
  new_text text := $new$    can_start_overtime := score_a = score_b
      or (
        nullif(btrim(current_match.referee_id), '') is null
        and (
          nullif(btrim(current_match.stat_recorders->>'teamA'), '') is null
          or nullif(btrim(current_match.stat_recorders->>'teamB'), '') is null
          or current_match.stat_recorders->>'teamA' = current_match.stat_recorders->>'teamB'
        )
      );$new$;
begin
  if to_regprocedure('public.rankball_match_clock_action_pre_optional_clock(text,text,text,jsonb)') is null then
    raise exception 'match_clock_action_core_missing' using errcode = '55000';
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_match_clock_action_pre_optional_clock(text,text,text,jsonb)'::regprocedure
  );
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'match_clock_overtime_policy_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_text, new_text);
  end if;
end;
$migration$;

create or replace function public.rankball_match_clock_action(
  p_actor_profile_id text,
  p_match_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  force_result jsonb;
  clock_result jsonb;
  effective_action text := p_action;
  explicit_end_recorded boolean := false;
begin
  force_result := public.rankball_match_clock_force_end_if_due(p_match_id, clock_timestamp());
  if nullif(force_result->>'matchEndedAt', '') is not null then
    effective_action := 'read';
  end if;

  clock_result := public.rankball_match_clock_action_pre_force_end(
    p_actor_profile_id,
    p_match_id,
    effective_action,
    p_payload
  );

  select exists (
    select 1
    from public.match_clock_events event
    where event.match_id = nullif(btrim(p_match_id), '')
      and event.action = 'endClock'
  ) into explicit_end_recorded;

  return coalesce(clock_result, '{}'::jsonb) || jsonb_build_object(
    'clockUsed',
    coalesce((clock_result->>'clockUsed')::boolean, false) and explicit_end_recorded,
    'forcedMatchEnd',
    coalesce((force_result->>'forced')::boolean, false),
    'forceEndAt',
    force_result->'forceEndAt',
    'matchEndedAt',
    force_result->'matchEndedAt'
  );
end;
$$;

revoke all on function public.rankball_match_clock_rating_factor(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_clock_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_clock_rating_factor(text, text) to service_role;
grant execute on function public.rankball_match_clock_action(text, text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
