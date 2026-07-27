-- A live score row is not a submitted postgame result.

begin;

do $migration$
declare
  function_oid oid;
  function_definition text;
  patched_definition text;
  score_row_lock constant text :=
    'or exists (select 1 from public.match_results result where result.match_id = safe_match_id)';
begin
  select procedure.oid
    into function_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'rankball_match_postgame_roster_action'
    and pg_get_function_identity_arguments(procedure.oid) =
      'p_actor_profile_id text, p_action text, p_match_id text, p_player_id text, p_side text, p_anonymous_name text';

  if function_oid is null then
    raise exception 'rankball_match_postgame_roster_action_missing' using errcode = '42883';
  end if;

  select pg_get_functiondef(function_oid)
    into function_definition;

  if position(score_row_lock in function_definition) = 0 then
    return;
  end if;

  patched_definition := replace(function_definition, score_row_lock, '');
  execute patched_definition;
end
$migration$;

revoke all on function public.rankball_match_postgame_roster_action(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_postgame_roster_action(text, text, text, text, text, text)
  to service_role;

comment on function public.rankball_match_postgame_roster_action(text, text, text, text, text, text) is
  'Allows bounded postgame roster correction before approval even when live team scores already created match_results.';

commit;
