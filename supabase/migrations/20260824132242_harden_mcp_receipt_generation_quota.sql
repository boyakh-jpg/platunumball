create or replace function public.consume_mcp_receipt_generation_quota(p_request_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_count integer;
begin
  if coalesce(p_request_hash, '') !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mcp_receipt_generation:' || p_request_hash, 0)
  );

  select count(*)
  into request_count
  from public.mcp_receipt_generation_events
  where request_hash = p_request_hash
    and created_at > pg_catalog.now() - interval '24 hours';

  if request_count >= 10 then
    return false;
  end if;

  insert into public.mcp_receipt_generation_events (request_hash)
  values (p_request_hash);

  return true;
end;
$$;

revoke all on function public.consume_mcp_receipt_generation_quota(text) from public;
revoke all on function public.consume_mcp_receipt_generation_quota(text) from anon;
revoke all on function public.consume_mcp_receipt_generation_quota(text) from authenticated;
grant execute on function public.consume_mcp_receipt_generation_quota(text) to service_role;
