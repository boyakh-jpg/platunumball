begin;

create table if not exists public.court_request_submission_events (
  request_id text primary key references public.court_requests(id) on delete cascade,
  requested_by text not null,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists court_request_submission_events_requester_created_idx
  on public.court_request_submission_events (requested_by, created_at desc);

insert into public.court_request_submission_events (request_id, requested_by, created_at)
select id, requested_by, coalesce(created_at, now())
from public.court_requests
where requested_by is not null
on conflict (request_id) do nothing;

alter table public.court_request_submission_events enable row level security;
revoke all on table public.court_request_submission_events from public, anon, authenticated;
grant select on table public.court_request_submission_events to service_role;

create or replace function public.rankball_get_court_request_limit_state(actor_profile_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  check_at timestamptz := clock_timestamp();
  day_starts_at timestamptz;
  resets_at timestamptz;
  daily_count bigint := 0;
  offense_count bigint := 0;
  blocked_until timestamptz;
begin
  if actor_profile_id is null or btrim(actor_profile_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;

  day_starts_at := date_trunc('day', check_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  resets_at := day_starts_at + interval '1 day';

  select count(*) into daily_count
  from public.court_request_submission_events
  where requested_by = actor_profile_id
    and created_at >= day_starts_at
    and created_at < resets_at;

  with confirmed as (
    select
      id,
      coalesce(nullif(payload->>'trustPenaltyAppliedAt', '')::timestamptz, updated_at) as confirmed_at
    from public.court_requests
    where requested_by = actor_profile_id
      and payload @> '{"trustPenaltyApplied": true}'::jsonb
  ), ranked as (
    select
      id,
      confirmed_at,
      row_number() over (order by confirmed_at, id) as offense_number
    from confirmed
  )
  select
    count(*),
    max(confirmed_at + case
      when offense_number = 1 then interval '3 days'
      when offense_number = 2 then interval '7 days'
      else interval '30 days'
    end)
  into offense_count, blocked_until
  from ranked;

  return jsonb_build_object(
    'dailyCount', daily_count,
    'dailyLimit', 3,
    'remaining', greatest(0, 3 - daily_count),
    'dailyBlocked', daily_count >= 3,
    'offenseCount', offense_count,
    'abuseBlocked', blocked_until is not null and blocked_until > check_at,
    'blockedUntil', blocked_until,
    'blocked', (daily_count >= 3) or (blocked_until is not null and blocked_until > check_at),
    'blockedReason', case
      when blocked_until is not null and blocked_until > check_at then 'abuse'
      when daily_count >= 3 then 'daily'
      else null
    end,
    'dayStartsAt', day_starts_at,
    'resetsAt', resets_at
  );
end;
$$;

create or replace function public.rankball_guard_court_request_submission_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limit_state jsonb;
begin
  if new.requested_by is null or btrim(new.requested_by) = '' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('court-request:' || new.requested_by, 0));

  if exists (
    select 1
    from public.court_requests
    where id = new.id
      and requested_by = new.requested_by
      and status = 'pending'
  ) then
    return new;
  end if;

  limit_state := public.rankball_get_court_request_limit_state(new.requested_by);
  if coalesce((limit_state->>'abuseBlocked')::boolean, false) then
    raise exception 'court_request_abuse_blocked'
      using errcode = '42501', detail = limit_state::text;
  end if;
  if coalesce((limit_state->>'dailyBlocked')::boolean, false) then
    raise exception 'court_request_daily_limit_reached'
      using errcode = 'P0001', detail = limit_state::text;
  end if;

  return new;
end;
$$;

create or replace function public.rankball_record_court_request_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requested_by is not null then
    insert into public.court_request_submission_events (request_id, requested_by)
    values (new.id, new.requested_by)
    on conflict (request_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_guard_court_request_submission_limit on public.court_requests;
create trigger rankball_guard_court_request_submission_limit
before insert on public.court_requests
for each row
execute function public.rankball_guard_court_request_submission_limit();

drop trigger if exists rankball_record_court_request_submission on public.court_requests;
create trigger rankball_record_court_request_submission
after insert on public.court_requests
for each row
execute function public.rankball_record_court_request_submission();

revoke all on function public.rankball_get_court_request_limit_state(text) from public, anon, authenticated;
revoke all on function public.rankball_guard_court_request_submission_limit() from public, anon, authenticated, service_role;
revoke all on function public.rankball_record_court_request_submission() from public, anon, authenticated, service_role;
grant execute on function public.rankball_get_court_request_limit_state(text) to service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values
  ('general', 'rankball_get_court_request_limit_state', 'rankball_get_court_request_limit_state', 'public.rankball_get_court_request_limit_state(text)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

select pg_notify('pgrst', 'reload schema');

commit;
