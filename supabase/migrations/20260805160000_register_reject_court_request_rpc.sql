begin;

revoke all on function public.rankball_reject_court_request(text, integer, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_reject_court_request(text, integer, text, text)
to service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values ('general', 'rankball_reject_court_request', 'rankball_reject_court_request', 'public.rankball_reject_court_request(text,integer,text,text)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

select pg_notify('pgrst', 'reload schema');

commit;
