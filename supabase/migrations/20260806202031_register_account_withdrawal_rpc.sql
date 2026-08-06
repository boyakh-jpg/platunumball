begin;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values ('general', 'rankball_withdraw_account', 'rankball_withdraw_account', 'public.rankball_withdraw_account(text,uuid,text)', 'active', true)
on conflict (contract_scope, contract_name) do update set
  function_name = excluded.function_name,
  signature = excluded.signature,
  lifecycle = excluded.lifecycle,
  service_role_execute = excluded.service_role_execute,
  updated_at = clock_timestamp();

commit;
