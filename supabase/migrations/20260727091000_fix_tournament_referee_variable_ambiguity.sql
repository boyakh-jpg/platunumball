begin;

do $migration$
declare
  function_definition text;
  body_marker_position integer;
begin
  select pg_get_functiondef(
    'public.rankball_tournament_operation_action(text,jsonb)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'rankball_tournament_operation_action_missing';
  end if;
  if position('#variable_conflict use_variable' in function_definition) = 0 then
    body_marker_position := position('$function$' in function_definition);
    if body_marker_position = 0 then
      raise exception 'rankball_tournament_operation_action_body_marker_missing';
    end if;
    function_definition :=
      left(function_definition, body_marker_position + length('$function$') - 1)
      || E'\n#variable_conflict use_variable'
      || substring(function_definition from body_marker_position + length('$function$'));
    execute function_definition;
  end if;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');

commit;
