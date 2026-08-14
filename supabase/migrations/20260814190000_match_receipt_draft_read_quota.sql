create table if not exists public.match_receipt_draft_read_quotas (
  request_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.match_receipt_draft_read_quotas enable row level security;
revoke all on table public.match_receipt_draft_read_quotas from anon, authenticated;
grant all on table public.match_receipt_draft_read_quotas to service_role;

create or replace function public.consume_match_receipt_draft_read_quota(p_request_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  window_started_at timestamptz;
  request_count integer;
begin
  if length(coalesce(p_request_hash, '')) <> 64 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_hash, 0));
  select quota.window_started_at, quota.request_count
  into window_started_at, request_count
  from public.match_receipt_draft_read_quotas as quota
  where quota.request_hash = p_request_hash;

  if not found then
    insert into public.match_receipt_draft_read_quotas (request_hash, request_count)
    values (p_request_hash, 1);
    return true;
  end if;

  if window_started_at <= now() - interval '1 hour' then
    update public.match_receipt_draft_read_quotas as quota
    set window_started_at = now(), request_count = 1, updated_at = now()
    where quota.request_hash = p_request_hash;
    return true;
  end if;

  if request_count >= 120 then
    return false;
  end if;

  update public.match_receipt_draft_read_quotas as quota
  set request_count = quota.request_count + 1, updated_at = now()
  where quota.request_hash = p_request_hash;
  return true;
end;
$$;

revoke all on function public.consume_match_receipt_draft_read_quota(text) from public, anon, authenticated;
grant execute on function public.consume_match_receipt_draft_read_quota(text) to service_role;
