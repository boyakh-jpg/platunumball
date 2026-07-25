begin;

do $$
declare
  target_function regprocedure := to_regprocedure(
    'public.rankball_recruiting_management_action_pre_remake_tracking(text,jsonb)'
  );
  function_definition text;
  old_fragment text := $old$
  elsif safe_action = 'interestRecruitingPost' then
$old$;
  new_fragment text := $new$
  elsif safe_action = 'interestRecruitingPost'
    and lower(coalesce(
      nullif(btrim(normalized_operation #>> '{application,joinMode}'), ''),
      nullif(btrim(normalized_operation->>'joinMode'), ''),
      'player'
    )) <> 'referee'
  then
$new$;
begin
  if target_function is null then
    raise exception 'rankball_recruiting_pickup_guard_missing';
  end if;

  function_definition := pg_get_functiondef(target_function);
  if position(new_fragment in function_definition) > 0 then
    return;
  end if;
  if position(old_fragment in function_definition) = 0 then
    raise exception 'rankball_recruiting_pickup_interest_shape_changed';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$$;

notify pgrst, 'reload schema';

commit;
