-- A no-referee dispute may report participation or substitution errors without changing the team score.
do $$
declare
  function_definition text;
  old_guard text := $old$if requested_score_a not between 0 and 999
       or requested_score_b not between 0 and 999
       or (requested_score_a = current_result.score_a and requested_score_b = current_result.score_b) then$old$;
  new_guard text := $new$if requested_score_a not between 0 and 999
       or requested_score_b not between 0 and 999 then$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_dispute_action(text,text,jsonb)'::regprocedure
  );

  if position(old_guard in function_definition) > 0 then
    execute replace(function_definition, old_guard, new_guard);
  elsif position(new_guard in function_definition) = 0 then
    raise exception 'match_reason_only_team_dispute_shape_changed' using errcode = '55000';
  end if;
end;
$$;
