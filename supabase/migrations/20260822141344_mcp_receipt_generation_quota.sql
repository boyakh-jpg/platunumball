create table if not exists public.mcp_receipt_generation_events (
  id bigint generated always as identity primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create index if not exists mcp_receipt_generation_events_lookup_idx
  on public.mcp_receipt_generation_events (request_hash, created_at desc);

alter table public.mcp_receipt_generation_events enable row level security;
revoke all on table public.mcp_receipt_generation_events from anon, authenticated;
grant all on table public.mcp_receipt_generation_events to service_role;

create or replace function public.consume_mcp_receipt_generation_quota(p_request_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_count integer;
begin
  if coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mcp_receipt_generation:' || p_request_hash, 0));
  select count(*) into request_count
  from public.mcp_receipt_generation_events
  where request_hash = p_request_hash
    and created_at > now() - interval '24 hours';
  if request_count >= 10 then
    return false;
  end if;
  insert into public.mcp_receipt_generation_events (request_hash) values (p_request_hash);
  return true;
end;
$$;

revoke all on function public.consume_mcp_receipt_generation_quota(text) from public, anon, authenticated;
grant execute on function public.consume_mcp_receipt_generation_quota(text) to service_role;
