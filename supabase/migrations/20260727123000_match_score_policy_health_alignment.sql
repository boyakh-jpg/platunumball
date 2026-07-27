begin;

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
      'takeoverRequests', to_regclass('public.match_recorder_takeover_requests') is not null,
      'scoreRpc', to_regprocedure(
        'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)'
      ) is not null,
      'takeoverRpc', to_regprocedure(
        'public.rankball_match_recorder_takeover_action(text,text,text,text,text)'
      ) is not null,
      'statGuard', exists (
        select 1 from pg_trigger
        where tgname = 'rankball_no_referee_player_match_stats_guard' and not tgisinternal
      ),
      'legacyRosterMoveServiceRevoked', not coalesce(has_function_privilege(
        'service_role',
        to_regprocedure('public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
        'execute'
      ), false),
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
