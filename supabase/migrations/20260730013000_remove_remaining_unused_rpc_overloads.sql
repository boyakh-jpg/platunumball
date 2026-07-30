begin;

-- Keep only the parameter shapes used by the current server runtime.
-- The removed overloads are compatibility/reject-only entry points.
insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  (
    'general',
    'rankball_approve_court_request',
    'rankball_approve_court_request',
    'public.rankball_approve_court_request(text,integer,text,jsonb)',
    'active',
    true
  ),
  (
    'general',
    'rankball_approve_court_request_legacy_3arg',
    'rankball_approve_court_request',
    'public.rankball_approve_court_request(text,integer,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_invite_team_member_4',
    'rankball_invite_team_member',
    'public.rankball_invite_team_member(text,text,text,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_save_profile_icon_settings_6',
    'rankball_save_profile_icon_settings',
    'public.rankball_save_profile_icon_settings(text,text,text,text,boolean,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_match_terminal_action_pre_cancel_policy_legacy_3arg',
    'rankball_match_terminal_action_pre_cancel_policy',
    'public.rankball_match_terminal_action_pre_cancel_policy(text,text,text)',
    'retired',
    false
  )
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

-- Refuse removal when catalog dependencies still point at an old overload.
do $migration$
declare
  target_oids oid[] := array_remove(array[
    to_regprocedure('public.rankball_approve_court_request(text,integer,text)'),
    to_regprocedure('public.rankball_invite_team_member(text,text,text,text)'),
    to_regprocedure('public.rankball_save_profile_icon_settings(text,text,text,text,boolean,text)'),
    to_regprocedure('public.rankball_match_terminal_action_pre_cancel_policy(text,text,text)')
  ], null);
  blocking_functions text;
begin
  select string_agg(
    format(
      '%I.%I(%s)',
      caller_namespace.nspname,
      caller.proname,
      pg_get_function_identity_arguments(caller.oid)
    ),
    ', '
    order by caller.proname, caller.oid
  )
  into blocking_functions
  from pg_depend dependency
  join pg_proc caller on caller.oid = dependency.objid
  join pg_namespace caller_namespace on caller_namespace.oid = caller.pronamespace
  where dependency.refobjid = any(target_oids)
    and caller_namespace.nspname = 'public'
    and caller.oid <> all(target_oids);

  if blocking_functions is not null then
    raise exception 'remaining_legacy_rpc_catalog_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

-- PL/pgSQL calls do not always create pg_depend rows. Reject unexpected
-- function-body references and verify the two known callers use current shapes.
do $migration$
declare
  blocking_functions text;
  select_icon_definition text;
  terminal_reason_definition text;
begin
  select pg_get_functiondef(
    'public.rankball_select_profile_icon(text,text)'::regprocedure
  )
  into select_icon_definition;
  if position(
    'current_profile.avatar_background_enabled' in select_icon_definition
  ) = 0 then
    raise exception 'current_profile_icon_settings_call_shape_changed'
      using errcode = '2BP01';
  end if;

  select pg_get_functiondef(
    'public.rankball_match_terminal_action_pre_cancel_reason(text,text,text,text)'::regprocedure
  )
  into terminal_reason_definition;
  if position(
    'rankball_match_terminal_action_pre_cancel_policy(' in terminal_reason_definition
  ) = 0
     or position('p_reason' in terminal_reason_definition) = 0
  then
    raise exception 'current_terminal_cancel_policy_call_shape_changed'
      using errcode = '2BP01';
  end if;

  select string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ),
    ', '
    order by proc.proname, proc.oid
  )
  into blocking_functions
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.prokind in ('f', 'p')
    and (
      (
        proc.proname <> 'rankball_approve_court_request'
        and position(
          'rankball_approve_court_request(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname <> 'rankball_invite_team_member'
        and position(
          'rankball_invite_team_member(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname not in (
          'rankball_save_profile_icon_settings',
          'rankball_select_profile_icon'
        )
        and position(
          'rankball_save_profile_icon_settings(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname not in (
          'rankball_match_terminal_action_pre_cancel_policy',
          'rankball_match_terminal_action_pre_cancel_reason'
        )
        and position(
          'rankball_match_terminal_action_pre_cancel_policy('
          in pg_get_functiondef(proc.oid)
        ) > 0
      )
    );

  if blocking_functions is not null then
    raise exception 'remaining_legacy_rpc_internal_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

drop function if exists public.rankball_approve_court_request(
  text, integer, text
);
drop function if exists public.rankball_invite_team_member(
  text, text, text, text
);
drop function if exists public.rankball_save_profile_icon_settings(
  text, text, text, text, boolean, text
);
drop function if exists public.rankball_match_terminal_action_pre_cancel_policy(
  text, text, text
);

revoke all on function public.rankball_approve_court_request(
  text, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.rankball_approve_court_request(
  text, integer, text, jsonb
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
