begin;

do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.rankball_tournament_operation_action(text,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'rankball_tournament_operation_action_missing';
  end if;

  function_definition := replace(function_definition, '#variable_conflict use_variable', '');
  function_definition := replace(function_definition, 'referee_ids jsonb :=', 'safe_referee_ids jsonb :=');
  function_definition := replace(function_definition, 'referee_statuses jsonb :=', 'safe_referee_statuses jsonb :=');
  function_definition := replace(function_definition, 'referee_approvals jsonb :=', 'safe_referee_approvals jsonb :=');
  function_definition := replace(function_definition, 'into referee_ids, referee_count', 'into safe_referee_ids, referee_count');
  function_definition := replace(function_definition, 'jsonb_array_elements_text(referee_ids)', 'jsonb_array_elements_text(safe_referee_ids)');
  function_definition := replace(function_definition, 'into referee_statuses', 'into safe_referee_statuses');
  function_definition := replace(function_definition, 'if referee_ids ? safe_actor_id', 'if safe_referee_ids ? safe_actor_id');
  function_definition := replace(function_definition, 'referee_approvals :=', 'safe_referee_approvals :=');
  function_definition := replace(function_definition, 'referee_ids = referee_ids,', 'referee_ids = safe_referee_ids,');
  function_definition := replace(function_definition, 'referee_statuses = referee_statuses,', 'referee_statuses = safe_referee_statuses,');
  function_definition := replace(function_definition, 'referee_approvals = referee_approvals,', 'referee_approvals = safe_referee_approvals,');

  if position(E'\n  referee_ids jsonb :=' in function_definition) > 0
     or position(E'\n  referee_statuses jsonb :=' in function_definition) > 0
     or position(E'\n  referee_approvals jsonb :=' in function_definition) > 0 then
    raise exception 'rankball_tournament_operation_action_variable_scope_fix_incomplete';
  end if;

  execute function_definition;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');

commit;
