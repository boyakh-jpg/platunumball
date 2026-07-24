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
begin
  select nullif(btrim(match_row.rules->>'recordType'), '')
  into record_type
  from public.matches match_row
  where match_row.id = nullif(btrim(p_match_id), '');

  if record_type in ('personal_record', 'match_record') then
    return 1;
  end if;

  select * into session_row
  from public.match_clock_sessions
  where match_id = nullif(btrim(p_match_id), '');

  if session_row.match_id is null then
    return 1;
  end if;

  expected_ms := public.rankball_match_clock_period_seconds(session_row.match_id)::bigint
    * public.rankball_match_clock_period_count(session_row.match_id)::bigint
    * 1000;
  fallback_factor := case p_mode
    when '1v1' then 0.5
    when '2v2' then 0.65
    when '3v3' then 0.8
    when '5v5' then 0.9
    else 0.8
  end;

  if session_row.started_within_window
    and session_row.clock_started_at is not null
    and session_row.clock_ended_at is not null
    and session_row.active_elapsed_ms >= ceil(expected_ms * 0.7)::bigint
  then
    return 1;
  end if;

  return fallback_factor;
end;
$$;

create or replace function public.rankball_match_clock_create_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  initial_controller_id text;
  initial_period_ms bigint;
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

  select player.user_id into initial_controller_id
  from public.match_players player
  where player.match_id = new.id
  order by
    case when player.user_id = new.created_by then 0 else 1 end,
    case when player.side = 'teamA' then 0 else 1 end,
    player.slot_order,
    player.user_id
  limit 1;

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
    created_at,
    updated_at
  )
  values (
    new.id,
    initial_controller_id,
    'pending',
    1,
    0,
    initial_period_ms,
    0,
    0,
    0,
    new.started_at + interval '5 minutes',
    now(),
    now()
  )
  on conflict (match_id) do nothing;

  return new;
end;
$$;

revoke all on function public.rankball_match_clock_rating_factor(text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_clock_rating_factor(text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
