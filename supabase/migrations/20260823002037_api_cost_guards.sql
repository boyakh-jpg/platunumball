begin;

create table if not exists public.api_fixed_window_limits (
  scope text not null,
  identity_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null,
  updated_at timestamptz not null default now(),
  primary key (scope, identity_hash),
  constraint api_fixed_window_limits_request_count_check check (request_count >= 0)
);

alter table public.api_fixed_window_limits enable row level security;
revoke all on table public.api_fixed_window_limits from public, anon, authenticated;
grant select, insert, update on table public.api_fixed_window_limits to service_role;

create or replace function public.rankball_consume_api_fixed_window(
  p_scope text,
  p_identity_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.api_fixed_window_limits%rowtype;
  next_count integer;
  retry_after integer;
begin
  if coalesce(length(trim(p_scope)), 0) = 0
    or p_identity_hash !~ '^[0-9a-f]{64}$'
    or p_limit < 1
    or p_window_seconds < 1 then
    raise exception 'api_fixed_window_invalid';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'api-fixed-window:' || p_scope || ':' || p_identity_hash,
    0
  ));

  select * into current_row
  from public.api_fixed_window_limits
  where scope = p_scope and identity_hash = p_identity_hash
  for update;

  if not found or current_row.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) <= p_now then
    insert into public.api_fixed_window_limits(scope, identity_hash, window_started_at, request_count, updated_at)
    values (p_scope, p_identity_hash, p_now, 1, p_now)
    on conflict (scope, identity_hash) do update
      set window_started_at = excluded.window_started_at,
          request_count = 1,
          updated_at = excluded.updated_at;
    return jsonb_build_object(
      'allowed', true,
      'limit', p_limit,
      'remaining', greatest(0, p_limit - 1),
      'retryAfterSeconds', p_window_seconds
    );
  end if;

  retry_after := greatest(1, ceiling(extract(epoch from (
    current_row.window_started_at + pg_catalog.make_interval(secs => p_window_seconds) - p_now
  )))::integer);
  if current_row.request_count >= p_limit then
    return jsonb_build_object(
      'allowed', false,
      'limit', p_limit,
      'remaining', 0,
      'retryAfterSeconds', retry_after
    );
  end if;

  next_count := current_row.request_count + 1;
  update public.api_fixed_window_limits
  set request_count = next_count, updated_at = p_now
  where scope = p_scope and identity_hash = p_identity_hash;
  return jsonb_build_object(
    'allowed', true,
    'limit', p_limit,
    'remaining', greatest(0, p_limit - next_count),
    'retryAfterSeconds', retry_after
  );
end;
$$;

revoke all on function public.rankball_consume_api_fixed_window(text, text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.rankball_consume_api_fixed_window(text, text, integer, integer, timestamptz) to service_role;

create table if not exists public.court_ai_budget_reservations (
  request_id text primary key,
  usage_date date not null,
  reserved_neurons numeric(12, 6) not null,
  actual_neurons numeric(12, 6),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_ai_budget_reservations_reserved_check check (reserved_neurons > 0),
  constraint court_ai_budget_reservations_actual_check check (actual_neurons is null or actual_neurons >= 0),
  constraint court_ai_budget_reservations_status_check check (status in ('active', 'settled', 'released'))
);

create index if not exists court_ai_budget_reservations_usage_date_status_idx
  on public.court_ai_budget_reservations (usage_date, status);

alter table public.court_ai_budget_reservations enable row level security;
revoke all on table public.court_ai_budget_reservations from public, anon, authenticated;
grant select, insert, update on table public.court_ai_budget_reservations to service_role;

create or replace function public.rankball_get_court_ai_budget_state(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_day date := (p_now at time zone 'UTC')::date;
  day_start timestamptz := usage_day::timestamp at time zone 'UTC';
  committed numeric := 0;
  reserved numeric := 0;
begin
  select coalesce(sum(neurons), 0) into committed
  from public.court_ai_usage_events
  where created_at >= day_start and created_at < day_start + interval '1 day';

  select coalesce(sum(reserved_neurons), 0) into reserved
  from public.court_ai_budget_reservations
  where usage_date = usage_day and status = 'active';

  return jsonb_build_object(
    'committedNeurons', committed,
    'reservedNeurons', reserved,
    'usedNeurons', committed + reserved,
    'resetsAt', day_start + interval '1 day'
  );
end;
$$;

create or replace function public.rankball_reserve_court_ai_budget(
  p_request_id text,
  p_reserved_neurons numeric,
  p_limit_neurons numeric,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_day date := (p_now at time zone 'UTC')::date;
  state jsonb;
  used numeric;
begin
  if p_request_id !~ '^cr_[A-Za-z0-9_-]{6,80}$' or p_reserved_neurons <= 0 or p_limit_neurons <= 0 then
    raise exception 'court_ai_reservation_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('court-ai-budget:' || usage_day::text, 0));

  if exists (select 1 from public.court_ai_budget_reservations where request_id = p_request_id) then
    return jsonb_build_object('allowed', false, 'reason', 'duplicate_request');
  end if;

  state := public.rankball_get_court_ai_budget_state(p_now);
  used := coalesce((state->>'usedNeurons')::numeric, 0);
  if used + p_reserved_neurons > p_limit_neurons then
    return state || jsonb_build_object('allowed', false, 'reason', 'quota');
  end if;

  insert into public.court_ai_budget_reservations(request_id, usage_date, reserved_neurons, created_at, updated_at)
  values (p_request_id, usage_day, p_reserved_neurons, p_now, p_now);
  return public.rankball_get_court_ai_budget_state(p_now) || jsonb_build_object('allowed', true);
end;
$$;

create or replace function public.rankball_settle_court_ai_budget(
  p_request_id text,
  p_model text,
  p_calls integer,
  p_input_tokens integer,
  p_output_tokens integer,
  p_neurons numeric,
  p_estimated boolean,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.court_ai_budget_reservations%rowtype;
begin
  if p_calls < 0 or p_input_tokens < 0 or p_output_tokens < 0 or p_neurons < 0 then
    raise exception 'court_ai_usage_invalid';
  end if;
  select * into reservation
  from public.court_ai_budget_reservations
  where request_id = p_request_id
  for update;
  if not found then raise exception 'court_ai_reservation_missing'; end if;
  if reservation.status <> 'active' then return public.rankball_get_court_ai_budget_state(p_now); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('court-ai-budget:' || reservation.usage_date::text, 0));
  if p_calls > 0 then
    insert into public.court_ai_usage_events(request_id, model, calls, input_tokens, output_tokens, neurons, estimated, created_at)
    values (p_request_id, p_model, p_calls, p_input_tokens, p_output_tokens, p_neurons, p_estimated, p_now);
  end if;
  update public.court_ai_budget_reservations
  set status = case when p_calls > 0 then 'settled' else 'released' end,
      actual_neurons = p_neurons,
      updated_at = p_now
  where request_id = p_request_id;
  return public.rankball_get_court_ai_budget_state(p_now);
end;
$$;

revoke all on function public.rankball_get_court_ai_budget_state(timestamptz) from public, anon, authenticated;
revoke all on function public.rankball_reserve_court_ai_budget(text, numeric, numeric, timestamptz) from public, anon, authenticated;
revoke all on function public.rankball_settle_court_ai_budget(text, text, integer, integer, integer, numeric, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.rankball_get_court_ai_budget_state(timestamptz) to service_role;
grant execute on function public.rankball_reserve_court_ai_budget(text, numeric, numeric, timestamptz) to service_role;
grant execute on function public.rankball_settle_court_ai_budget(text, text, integer, integer, integer, numeric, boolean, timestamptz) to service_role;

commit;
