-- Preserve terminal court-request decisions while quarantining abandoned simulation rows.

begin;

do $migration$
declare
  function_oid oid;
  function_definition text;
  patched_definition text;
  old_condition constant text := 'and request.status <> ''simulation_closed'';';
  new_condition constant text := 'and request.status not in (''approved'', ''rejected'', ''simulation_closed'');';
begin
  select procedure.oid
    into function_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'rankball_quarantine_simulation_artifacts'
    and pg_get_function_identity_arguments(procedure.oid) = 'p_now timestamp with time zone';

  if function_oid is null then
    raise exception 'rankball_quarantine_simulation_artifacts_missing' using errcode = '42883';
  end if;

  select pg_get_functiondef(function_oid)
    into function_definition;

  if position(new_condition in function_definition) > 0 then
    return;
  end if;

  if position(old_condition in function_definition) = 0 then
    raise exception 'rankball_quarantine_simulation_artifacts_unexpected_definition'
      using errcode = '55000';
  end if;

  patched_definition := replace(function_definition, old_condition, new_condition);
  execute patched_definition;
end
$migration$;

revoke all on function public.rankball_quarantine_simulation_artifacts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.rankball_quarantine_simulation_artifacts(timestamptz)
  to service_role;

comment on function public.rankball_quarantine_simulation_artifacts(timestamptz) is
  'Quarantines abandoned simulation artifacts without changing approved or rejected court-request decisions.';

commit;
