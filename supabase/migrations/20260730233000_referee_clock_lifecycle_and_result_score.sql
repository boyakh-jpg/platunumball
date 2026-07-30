begin;

create or replace function public.rankball_match_clock_create_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  initial_controller_id text;
  initial_period_ms bigint;
  initial_shot_seconds integer := 0;
  auto_start boolean := false;
  inserted_count integer := 0;
begin
  if new.started_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.started_at is not null then
    return new;
  end if;
  if nullif(btrim(new.rules->>'recordType'), '') in ('personal_record', 'match_record') then
    return new;
  end if;
  if lower(coalesce(new.rules->>'gameClockEnabled', 'true')) = 'false' then
    return new;
  end if;

  auto_start := nullif(btrim(new.referee_id), '') is not null
    and public.rankball_is_match_referee_eligible(new.referee_id, new.id);
  if auto_start then
    initial_controller_id := nullif(btrim(new.referee_id), '');
  else
    select player.user_id into initial_controller_id
    from public.match_players player
    where player.match_id = new.id
    order by
      case when player.user_id = new.created_by then 0 else 1 end,
      case when player.side = 'teamA' then 0 else 1 end,
      player.slot_order,
      player.user_id
    limit 1;
  end if;

  if coalesce(new.rules->>'shotClockSeconds', '') ~ '^[0-9]+$' then
    initial_shot_seconds := (new.rules->>'shotClockSeconds')::integer;
  end if;
  if initial_shot_seconds not in (0, 24, 30, 60) then
    initial_shot_seconds := 0;
  end if;
  initial_period_ms := public.rankball_match_clock_period_seconds(new.id)::bigint * 1000;

  insert into public.match_clock_sessions (
    match_id,
    controller_id,
    status,
    current_period,
    overtime_count,
    period_remaining_ms,
    shot_clock_seconds,
    shot_remaining_ms,
    active_elapsed_ms,
    start_deadline_at,
    last_resumed_at,
    clock_started_at,
    started_within_window,
    created_at,
    updated_at
  )
  values (
    new.id,
    initial_controller_id,
    case when auto_start then 'running' else 'pending' end,
    1,
    0,
    initial_period_ms,
    initial_shot_seconds,
    initial_shot_seconds::bigint * 1000,
    0,
    new.started_at + interval '5 minutes',
    case when auto_start then new.started_at end,
    case when auto_start then new.started_at end,
    auto_start,
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (match_id) do nothing;
  get diagnostics inserted_count = row_count;

  if auto_start and inserted_count = 1 then
    insert into public.match_clock_events (match_id, actor_id, action, payload, created_at)
    values (
      new.id,
      initial_controller_id,
      'start',
      jsonb_build_object(
        'source', 'referee_match_start',
        'status', 'running',
        'currentPeriod', 1,
        'overtimeCount', 0,
        'activeElapsedMs', 0
      ),
      new.started_at
    );
  end if;

  return new;
end;
$$;

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
  lifecycle_actor_id text;
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

  lifecycle_actor_id := coalesce(
    nullif(btrim(new.referee_id), ''),
    nullif(btrim(new.created_by), '')
  );
  insert into public.match_clock_events (match_id, actor_id, action, payload, created_at)
  values (
    new.id,
    lifecycle_actor_id,
    case when nullif(btrim(new.referee_id), '') is not null then 'endClock' else 'matchEnd' end,
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

do $migration$
begin
  if to_regprocedure('public.rankball_match_result_action_pre_referee_score_sync(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_result_action(text,text,jsonb)') is null then
      raise exception 'rankball_match_result_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_result_action(text, text, jsonb)
      rename to rankball_match_result_action_pre_referee_score_sync;
  end if;
end;
$migration$;

create or replace function public.rankball_match_result_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_result jsonb := coalesce(p_result, '{}'::jsonb);
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  core_result jsonb;
  requested_score_a integer;
  requested_score_b integer;
  before_score_a integer;
  before_score_b integer;
  next_revision_a integer;
  next_revision_b integer;
  now_at timestamptz := clock_timestamp();
begin
  if safe_match_id is null or jsonb_typeof(safe_result) <> 'object' then
    raise exception 'invalid_match_result' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  core_result := public.rankball_match_result_action_pre_referee_score_sync(
    safe_actor_id,
    safe_match_id,
    safe_result
  );

  if coalesce(current_match.rules->>'recordType', '') in ('match_record', 'personal_record')
     or safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    return core_result;
  end if;
  if coalesce(safe_result->>'scoreA', '') !~ '^[0-9]{1,3}$'
     or coalesce(safe_result->>'scoreB', '') !~ '^[0-9]{1,3}$' then
    raise exception 'invalid_match_result_score' using errcode = '22023';
  end if;

  requested_score_a := (safe_result->>'scoreA')::integer;
  requested_score_b := (safe_result->>'scoreB')::integer;

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;
  if current_result.match_id is null then
    raise exception 'match_result_not_found' using errcode = 'P0002';
  end if;

  before_score_a := greatest(0, coalesce(current_result.score_a, 0));
  before_score_b := greatest(0, coalesce(current_result.score_b, 0));
  next_revision_a := coalesce(current_result.score_revision_a, 0)
    + case when requested_score_a <> before_score_a then 1 else 0 end;
  next_revision_b := coalesce(current_result.score_revision_b, 0)
    + case when requested_score_b <> before_score_b then 1 else 0 end;

  update public.match_results
  set
    submitted_by = safe_actor_id,
    score_a = requested_score_a,
    score_b = requested_score_b,
    score_revision_a = next_revision_a,
    score_revision_b = next_revision_b,
    score_submissions = coalesce(score_submissions, '{}'::jsonb)
      || case when requested_score_a <> before_score_a then jsonb_build_object(
        'teamA', jsonb_build_object(
          'by', safe_actor_id,
          'score', requested_score_a,
          'revision', next_revision_a,
          'scope', 'referee',
          'submittedAt', now_at
        )
      ) else '{}'::jsonb end
      || case when requested_score_b <> before_score_b then jsonb_build_object(
        'teamB', jsonb_build_object(
          'by', safe_actor_id,
          'score', requested_score_b,
          'revision', next_revision_b,
          'scope', 'referee',
          'submittedAt', now_at
        )
      ) else '{}'::jsonb end,
    submitted_at = now_at
  where match_id = safe_match_id;

  update public.matches
  set score_a = requested_score_a,
      score_b = requested_score_b,
      updated_at = now_at
  where id = safe_match_id;

  if requested_score_a <> before_score_a then
    insert into public.match_score_events (
      match_id, side, actor_profile_id, event_type, requested_delta,
      score_before, score_after, score_revision, authority_scope, created_at
    ) values (
      safe_match_id, 'teamA', safe_actor_id, 'increment',
      requested_score_a - before_score_a, before_score_a, requested_score_a,
      next_revision_a, 'referee', now_at
    );
  end if;
  if requested_score_b <> before_score_b then
    insert into public.match_score_events (
      match_id, side, actor_profile_id, event_type, requested_delta,
      score_before, score_after, score_revision, authority_scope, created_at
    ) values (
      safe_match_id, 'teamB', safe_actor_id, 'increment',
      requested_score_b - before_score_b, before_score_b, requested_score_b,
      next_revision_b, 'referee', now_at
    );
  end if;

  return coalesce(core_result, '{}'::jsonb) || jsonb_build_object(
    'scoreA', requested_score_a,
    'scoreB', requested_score_b,
    'scoreRevisionA', next_revision_a,
    'scoreRevisionB', next_revision_b,
    'scoreSynced', true
  );
end;
$$;

revoke all on function public.rankball_match_clock_create_session()
from public, anon, authenticated;
revoke all on function public.rankball_match_clock_close_on_match_end()
from public, anon, authenticated;
revoke all on function public.rankball_match_result_action(text, text, jsonb)
from public, anon, authenticated;
revoke all on function public.rankball_match_result_action_pre_referee_score_sync(text, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.rankball_match_result_action(text, text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
