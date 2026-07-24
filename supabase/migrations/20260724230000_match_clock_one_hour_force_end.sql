create or replace function public.rankball_match_clock_close_on_match_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.match_clock_sessions%rowtype;
  effective_end_at timestamptz;
  elapsed_ms bigint := 0;
  applied_ms bigint := 0;
begin
  if new.ended_at is null or old.ended_at is not null then
    return new;
  end if;

  select * into session_row
  from public.match_clock_sessions
  where match_id = new.id
  for update;

  if session_row.match_id is null or session_row.clock_ended_at is not null then
    return new;
  end if;

  effective_end_at := least(new.ended_at, clock_timestamp());
  if session_row.status = 'running' and session_row.last_resumed_at is not null then
    elapsed_ms := greatest(
      0,
      floor(extract(epoch from (effective_end_at - session_row.last_resumed_at)) * 1000)::bigint
    );
    applied_ms := least(elapsed_ms, session_row.period_remaining_ms);
  end if;

  update public.match_clock_sessions
  set
    status = 'ended',
    period_remaining_ms = greatest(0, session_row.period_remaining_ms - applied_ms),
    shot_remaining_ms = greatest(0, session_row.shot_remaining_ms - applied_ms),
    active_elapsed_ms = session_row.active_elapsed_ms + applied_ms,
    last_resumed_at = null,
    clock_ended_at = effective_end_at,
    updated_at = clock_timestamp()
  where match_id = new.id;

  insert into public.match_clock_events (match_id, actor_id, action, payload, created_at)
  values (
    new.id,
    null,
    'matchEnd',
    jsonb_build_object(
      'source', 'match_lifecycle',
      'status', 'ended',
      'activeElapsedMs', session_row.active_elapsed_ms + applied_ms
    ),
    effective_end_at
  );

  return new;
end;
$$;

drop trigger if exists rankball_match_clock_close_on_match_end_trigger on public.matches;
create trigger rankball_match_clock_close_on_match_end_trigger
after update of ended_at on public.matches
for each row
execute function public.rankball_match_clock_close_on_match_end();

create or replace function public.rankball_match_clock_force_end_if_due(
  p_match_id text,
  p_reference timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  server_now timestamptz := coalesce(p_reference, clock_timestamp());
  current_match public.matches%rowtype;
  session_row public.match_clock_sessions%rowtype;
  force_end_at timestamptz;
  elapsed_ms bigint := 0;
  applied_ms bigint := 0;
  has_result boolean := false;
  next_rules jsonb;
begin
  if safe_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match-clock'), hashtext(safe_match_id));

  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  select * into session_row
  from public.match_clock_sessions
  where match_id = safe_match_id
  for update;

  if current_match.id is null or session_row.match_id is null then
    return jsonb_build_object(
      'forced', false,
      'matchEndedAt', current_match.ended_at
    );
  end if;

  force_end_at := case
    when session_row.clock_started_at is not null
      then session_row.clock_started_at + interval '1 hour'
    else null
  end;

  if current_match.ended_at is not null
    or current_match.status <> 'agreed'
    or force_end_at is null
    or server_now < force_end_at
  then
    return jsonb_build_object(
      'forced', false,
      'forceEndAt', force_end_at,
      'matchEndedAt', current_match.ended_at
    );
  end if;

  if session_row.status = 'running' and session_row.last_resumed_at is not null then
    elapsed_ms := greatest(
      0,
      floor(extract(epoch from (force_end_at - session_row.last_resumed_at)) * 1000)::bigint
    );
    applied_ms := least(elapsed_ms, session_row.period_remaining_ms);
  end if;

  update public.match_clock_sessions
  set
    status = 'ended',
    period_remaining_ms = greatest(0, session_row.period_remaining_ms - applied_ms),
    shot_remaining_ms = greatest(0, session_row.shot_remaining_ms - applied_ms),
    active_elapsed_ms = session_row.active_elapsed_ms + applied_ms,
    last_resumed_at = null,
    clock_ended_at = coalesce(session_row.clock_ended_at, force_end_at),
    updated_at = server_now
  where match_id = safe_match_id;

  insert into public.match_clock_events (match_id, actor_id, action, payload, created_at)
  values (
    safe_match_id,
    null,
    'forceEnd',
    jsonb_build_object(
      'source', 'one_hour_limit',
      'status', 'ended',
      'forceEndAt', force_end_at,
      'activeElapsedMs', session_row.active_elapsed_ms + applied_ms
    ),
    force_end_at
  );

  select exists (
    select 1 from public.match_results result where result.match_id = safe_match_id
  ) into has_result;

  next_rules := jsonb_set(
    coalesce(current_match.rules, '{}'::jsonb),
    '{startedAt}',
    to_jsonb(coalesce(current_match.rules->>'startedAt', current_match.started_at::text)),
    true
  );

  update public.matches
  set
    status = case when has_result then 'approval' else status end,
    ended_at = force_end_at,
    rules = next_rules,
    updated_at = server_now
  where id = safe_match_id;

  if has_result then
    delete from public.match_approvals where match_id = safe_match_id;
  end if;

  return jsonb_build_object(
    'forced', true,
    'forceEndAt', force_end_at,
    'matchEndedAt', force_end_at
  );
end;
$$;

create or replace function public.rankball_match_clock_force_end_due_batch(
  p_reference timestamptz default clock_timestamp(),
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  server_now timestamptz := coalesce(p_reference, clock_timestamp());
  safe_limit integer := greatest(1, least(500, coalesce(p_limit, 100)));
  candidate record;
  force_result jsonb;
  forced_ids jsonb := '[]'::jsonb;
begin
  for candidate in
    select session.match_id
    from public.match_clock_sessions session
    join public.matches match_row on match_row.id = session.match_id
    where session.clock_started_at is not null
      and session.clock_started_at + interval '1 hour' <= server_now
      and match_row.started_at is not null
      and match_row.ended_at is null
      and match_row.status = 'agreed'
    order by session.clock_started_at, session.match_id
    limit safe_limit
  loop
    force_result := public.rankball_match_clock_force_end_if_due(candidate.match_id, server_now);
    if coalesce((force_result->>'forced')::boolean, false) then
      forced_ids := forced_ids || jsonb_build_array(candidate.match_id);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'forcedCount', jsonb_array_length(forced_ids),
    'forcedMatchIds', forced_ids,
    'serverNow', server_now
  );
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_match_clock_action_pre_force_end(text,text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_clock_action(text,text,text,jsonb)') is null then
      raise exception 'match_clock_action_missing' using errcode = '55000';
    end if;
    execute 'alter function public.rankball_match_clock_action(text,text,text,jsonb) rename to rankball_match_clock_action_pre_force_end';
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

  return coalesce(clock_result, '{}'::jsonb) || jsonb_build_object(
    'forcedMatchEnd',
    coalesce((force_result->>'forced')::boolean, false),
    'forceEndAt',
    force_result->'forceEndAt',
    'matchEndedAt',
    force_result->'matchEndedAt'
  );
end;
$$;

revoke all on function public.rankball_match_clock_close_on_match_end() from public, anon, authenticated;
revoke all on function public.rankball_match_clock_force_end_if_due(text, timestamptz) from public, anon, authenticated;
revoke all on function public.rankball_match_clock_force_end_due_batch(timestamptz, integer) from public, anon, authenticated;
revoke all on function public.rankball_match_clock_action_pre_force_end(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_clock_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_clock_force_end_if_due(text, timestamptz) to service_role;
grant execute on function public.rankball_match_clock_force_end_due_batch(timestamptz, integer) to service_role;
grant execute on function public.rankball_match_clock_action(text, text, text, jsonb) to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $cron$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'rankball-match-clock-force-end'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'rankball-match-clock-force-end',
    '* * * * *',
    'select public.rankball_match_clock_force_end_due_batch();'
  );
end;
$cron$;

select pg_notify('pgrst', 'reload schema');
