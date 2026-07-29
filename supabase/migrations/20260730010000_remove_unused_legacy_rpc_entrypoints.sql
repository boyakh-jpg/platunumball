begin;

-- These three service-only entry points have no current runtime caller.
-- Keep their registry rows as retired tombstones after exact-signature removal.
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
    'rankball_current_recruiting_post_ids',
    'rankball_current_recruiting_post_ids',
    'public.rankball_current_recruiting_post_ids(text,integer)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_recruiting_ready_action',
    'rankball_recruiting_ready_action',
    'public.rankball_recruiting_ready_action(text,text,boolean)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_update_team_emblem_style',
    'rankball_update_team_emblem_style',
    'public.rankball_update_team_emblem_style(text,text,text,boolean,text)',
    'retired',
    false
  )
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

-- PL/pgSQL calls are not always represented by pg_depend. Refuse removal when
-- any other current public function still names one of these entry points.
do $migration$
declare
  blocking_functions text;
begin
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
    and proc.proname not in (
      'rankball_current_recruiting_post_ids',
      'rankball_recruiting_ready_action',
      'rankball_update_team_emblem_style'
    )
    and (
      position(
        'rankball_current_recruiting_post_ids(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_recruiting_ready_action(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_update_team_emblem_style(' in pg_get_functiondef(proc.oid)
      ) > 0
    );

  if blocking_functions is not null then
    raise exception 'unused_legacy_rpc_internal_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

-- Exact signatures only. CASCADE is intentionally forbidden so any catalog
-- dependency aborts and rolls back this migration.
drop function if exists public.rankball_current_recruiting_post_ids(
  text, integer
);
drop function if exists public.rankball_recruiting_ready_action(
  text, text, boolean
);
drop function if exists public.rankball_update_team_emblem_style(
  text, text, text, boolean, text
);

select pg_notify('pgrst', 'reload schema');

commit;
