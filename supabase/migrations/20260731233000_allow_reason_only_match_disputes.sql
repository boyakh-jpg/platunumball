-- A reason-only player dispute is valid for substitution and participation mistakes.
do $$
declare
  function_definition text;
  function_tail text;
  start_at integer;
  end_at integer;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_dispute_action(text,text,jsonb)'::regprocedure
  );

  if position('match_stat_dispute_no_change' in function_definition) = 0 then
    return;
  end if;

  start_at := position('    if requested_stats = jsonb_build_object(' in function_definition);
  if start_at = 0 then
    raise exception 'match_reason_only_dispute_start_shape_changed' using errcode = '55000';
  end if;

  function_tail := substring(function_definition from start_at);
  end_at := position($marker$    request := request || jsonb_build_object(
      'currentStats'$marker$ in function_tail);
  if end_at = 0 then
    raise exception 'match_reason_only_dispute_end_shape_changed' using errcode = '55000';
  end if;

  function_definition := left(function_definition, start_at - 1)
    || substring(function_tail from end_at);
  execute function_definition;
end;
$$;
