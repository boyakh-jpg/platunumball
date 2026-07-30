begin;

-- These renamed functions are implementation layers of the current room-update
-- RPCs. They must remain present, but no API role may call them directly.
do $migration$
declare
  recruiting_helper regprocedure := to_regprocedure(
    'public.rankball_recruiting_room_update_action_pre_change_deadline(text,text,jsonb)'
  );
  match_helper regprocedure := to_regprocedure(
    'public.rankball_match_room_update_action_pre_change_deadline(text,text,jsonb)'
  );
  recruiting_wrapper regprocedure := to_regprocedure(
    'public.rankball_recruiting_room_update_action(text,text,jsonb)'
  );
  match_wrapper regprocedure := to_regprocedure(
    'public.rankball_match_room_update_action(text,text,jsonb)'
  );
begin
  if recruiting_helper is null or match_helper is null then
    raise exception 'room_update_internal_helper_missing'
      using errcode = '42883';
  end if;
  if recruiting_wrapper is null
     or position(
       'rankball_recruiting_room_update_action_pre_change_deadline('
       in pg_get_functiondef(recruiting_wrapper)
     ) = 0
  then
    raise exception 'recruiting_room_update_internal_dependency_missing'
      using errcode = '2BP01';
  end if;
  if match_wrapper is null
     or position(
       'rankball_match_room_update_action_pre_change_deadline('
       in pg_get_functiondef(match_wrapper)
     ) = 0
  then
    raise exception 'match_room_update_internal_dependency_missing'
      using errcode = '2BP01';
  end if;
end;
$migration$;

revoke all on function public.rankball_recruiting_room_update_action_pre_change_deadline(
  text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_room_update_action_pre_change_deadline(
  text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    'rpc_grant:' || contract.contract_name,
    contract.ok,
    contract.detail
  from public.rankball_rpc_contract_health('general') contract

  union all

  select
    'rpc_grant:rankball_rpc_contract_registry_acl',
    catalog.relrowsecurity
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
    jsonb_build_object(
      'table', 'rankball_rpc_contract_registry',
      'rowLevelSecurity', catalog.relrowsecurity,
      'anonSelect', has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select'),
      'authenticatedSelect', has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleSelect', has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleRpcOnly', true
    )
  from pg_catalog.pg_class catalog
  join pg_catalog.pg_namespace namespace
    on namespace.oid = catalog.relnamespace
  where namespace.nspname = 'public'
    and catalog.relname = 'rankball_rpc_contract_registry'

  union all

  select
    'rpc_grant:internal_helper:' || helper.name,
    helper.proc_oid is not null
      and not coalesce(has_function_privilege('service_role', helper.proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', helper.proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', helper.proc_oid, 'execute'), false),
    jsonb_build_object(
      'signature', helper.signature,
      'exists', helper.proc_oid is not null,
      'ownerOnly', true,
      'anonExecute', coalesce(has_function_privilege('anon', helper.proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', helper.proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', helper.proc_oid, 'execute'), false)
    )
  from (
    values
      (
        'rankball_match_room_update_action_pre_change_deadline',
        'public.rankball_match_room_update_action_pre_change_deadline(text,text,jsonb)',
        to_regprocedure(
          'public.rankball_match_room_update_action_pre_change_deadline(text,text,jsonb)'
        )
      ),
      (
        'rankball_recruiting_room_update_action_pre_change_deadline',
        'public.rankball_recruiting_room_update_action_pre_change_deadline(text,text,jsonb)',
        to_regprocedure(
          'public.rankball_recruiting_room_update_action_pre_change_deadline(text,text,jsonb)'
        )
      )
  ) helper(name, signature, proc_oid)
  order by 1;
$$;

revoke all on function public.rankball_rpc_grant_health()
  from public, anon, authenticated;
grant execute on function public.rankball_rpc_grant_health()
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
