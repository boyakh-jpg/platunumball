-- Keep one explicit dispute queue action.
-- Applied migrations remain immutable; only disconnected runtime functions are removed.

create or replace function public.rankball_authoritative_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_create_tournament_match_locked', 'public.rankball_create_tournament_match_locked(text,text,text,integer,integer,text)'),
      ('rankball_expire_recruiting_rooms', 'public.rankball_expire_recruiting_rooms(timestamptz)'),
      ('rankball_match_finalize_locked', 'public.rankball_match_finalize_locked(text,text,text)'),
      ('rankball_match_referee_absence_action', 'public.rankball_match_referee_absence_action(text,text,text)'),
      ('rankball_match_result_action', 'public.rankball_match_result_action(text,text,jsonb)'),
      ('rankball_match_resolve_dispute_action', 'public.rankball_match_resolve_dispute_action(text,text,text,text)'),
      ('rankball_match_room_action', 'public.rankball_match_room_action(text,text,text,jsonb)'),
      ('rankball_recruiting_management_action', 'public.rankball_recruiting_management_action(text,jsonb)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
      ('rankball_tournament_advance_locked', 'public.rankball_tournament_advance_locked(text)'),
      ('rankball_tournament_match_schedule_action', 'public.rankball_tournament_match_schedule_action(text,text,text,jsonb)'),
      ('rankball_tournament_operation_action', 'public.rankball_tournament_operation_action(text,jsonb)')
  ),
  resolved as (
    select function_name, signature, to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'authoritative_rpc_grant:' || function_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    )
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_authoritative_rpc_grant_health()
from public, anon, authenticated;
grant execute on function public.rankball_authoritative_rpc_grant_health()
to service_role;

drop function if exists public.rankball_match_resume_approval_action(text, text);
drop function if exists public.rankball_match_resume_approval_action(text, text, jsonb);
drop function if exists public.rankball_match_resume_approval_action_void_review_inner(text, text, jsonb);
drop function if exists public.rankball_match_resume_approval_action_referee_guard_inner(text, text, jsonb);
drop function if exists public.rankball_match_resume_approval_action_concurrency_inner(text, text, jsonb);
drop function if exists public.rankball_match_reject_dispute_action(text, text);

select pg_notify('pgrst', 'reload schema');
