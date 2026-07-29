begin;

-- Keep retired contract tombstones after their executable entry points are gone.
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
    'rankball_match_scorekeeper_scope_action_legacy',
    'rankball_match_scorekeeper_scope_action',
    'public.rankball_match_scorekeeper_scope_action(text,text,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_match_recorder_takeover_action_legacy',
    'rankball_match_recorder_takeover_action',
    'public.rankball_match_recorder_takeover_action(text,text,text,text,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_match_substitution_action_legacy',
    'rankball_match_substitution_action',
    'public.rankball_match_substitution_action(text,text,text,text,text,text)',
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
-- any other current public function still names a unique retired entry point.
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
      'rankball_match_late_player_action',
      'rankball_match_roster_move_action',
      'rankball_recruiting_stat_recorder_action',
      'rankball_match_scorekeeper_scope_action',
      'rankball_match_recorder_takeover_action',
      'rankball_match_substitution_action',
      'rankball_match_score_operation_policy_health'
    )
    and (
      position(
        'rankball_match_late_player_action(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_match_roster_move_action(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_recruiting_stat_recorder_action(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_match_scorekeeper_scope_action(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_match_recorder_takeover_action(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_match_substitution_action(' in pg_get_functiondef(proc.oid)
      ) > 0
    );

  if blocking_functions is not null then
    raise exception 'retired_rpc_internal_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

-- Exact signatures only. CASCADE is intentionally forbidden so an unknown
-- catalog dependency aborts and rolls back this migration.
drop function if exists public.rankball_match_late_player_action(
  text, text, text, text, jsonb, jsonb, jsonb, jsonb
);
drop function if exists public.rankball_match_roster_move_action(
  text, text, text, text, text, text, text
);
drop function if exists public.rankball_recruiting_stat_recorder_action(
  text, text, text, text
);
drop function if exists public.rankball_match_resolve_dispute_action(
  text, text, text, text
);
drop function if exists public.rankball_match_terminal_action(
  text, text, text
);
drop function if exists public.rankball_match_list(
  text, integer, text
);
drop function if exists public.rankball_match_scorekeeper_scope_action(
  text, text, text
);
drop function if exists public.rankball_match_recorder_takeover_action(
  text, text, text, text, text
);
drop function if exists public.rankball_match_substitution_action(
  text, text, text, text, text, text
);

-- The request table remains an audit archive. Only the retired mutation RPC
-- is removed; no table or row is deleted.
create or replace function public.rankball_match_score_operation_policy_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with checks as (
    select jsonb_build_object(
      'dualScoreRecorderSide', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'matches'
          and column_name = 'dual_score_recorder_side'
      ),
      'scoreRevisionA', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_revision_a'
      ),
      'scoreRevisionB', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_revision_b'
      ),
      'scoreSubmissions', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_submissions'
      ),
      'statMatchCount', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profile_match_summaries'
          and column_name = 'stat_match_count'
      ),
      'scoreEvents', to_regclass('public.match_score_events') is not null,
      'takeoverRequestArchive', to_regclass('public.match_recorder_takeover_requests') is not null,
      'scoreRpc', to_regprocedure(
        'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)'
      ) is not null,
      'latePlayerRpcRetired', to_regprocedure(
        'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'
      ) is null,
      'legacyRosterMoveRpcRetired', to_regprocedure(
        'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'
      ) is null,
      'recruitingStatRecorderRpcRetired', to_regprocedure(
        'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'
      ) is null,
      'legacyDisputeResolutionRpcRetired', to_regprocedure(
        'public.rankball_match_resolve_dispute_action(text,text,text,text)'
      ) is null,
      'legacyTerminalRpcRetired', to_regprocedure(
        'public.rankball_match_terminal_action(text,text,text)'
      ) is null,
      'legacyMatchListRpcRetired', to_regprocedure(
        'public.rankball_match_list(text,integer,text)'
      ) is null,
      'scorekeeperScopeRpcRetired', to_regprocedure(
        'public.rankball_match_scorekeeper_scope_action(text,text,text)'
      ) is null,
      'takeoverRpcRetired', to_regprocedure(
        'public.rankball_match_recorder_takeover_action(text,text,text,text,text)'
      ) is null,
      'legacySubstitutionRpcRetired', to_regprocedure(
        'public.rankball_match_substitution_action(text,text,text,text,text,text)'
      ) is null,
      'statGuard', exists (
        select 1 from pg_trigger
        where tgname = 'rankball_no_referee_player_match_stats_guard' and not tgisinternal
      ),
      'autoFinalizeLocked', position(
        'match_auto_finalization_locked'
        in pg_get_functiondef(
          'public.rankball_match_auto_finalize_action(text,timestamp with time zone)'::regprocedure
        )
      ) > 0
    ) as value
  )
  select jsonb_build_object(
    'ok', not exists (
      select 1 from checks, jsonb_each(checks.value) item
      where item.value <> 'true'::jsonb
    ),
    'checks', checks.value
  )
  from checks;
$$;

revoke all on function public.rankball_match_score_operation_policy_health()
  from public, anon, authenticated;
grant execute on function public.rankball_match_score_operation_policy_health()
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
