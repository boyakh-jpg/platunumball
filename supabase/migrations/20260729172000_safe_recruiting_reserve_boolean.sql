-- Keep malformed recruiting invite reserve values from aborting management actions.

do $patch$
declare
  function_signature text := 'public.rankball_recruiting_management_action_unguarded(text,jsonb)';
  function_def text;
  patched_def text;
  unsafe_payload_cast text := '(payload->>''reserve'')::' || 'boolean';
  unsafe_invitation_cast text := '(invitation->>''reserve'')::' || 'boolean';
  safe_payload_expression text :=
    'lower(coalesce(payload->>''reserve'', ''false'')) in (''true'', ''t'', ''1'', ''yes'', ''on'')';
  safe_invitation_expression text :=
    'lower(coalesce(invitation->>''reserve'', ''false'')) in (''true'', ''t'', ''1'', ''yes'', ''on'')';
begin
  if to_regprocedure(function_signature) is null then
    raise exception 'rankball_recruiting_management_action_unguarded_missing' using errcode = '42883';
  end if;

  function_def := pg_get_functiondef(to_regprocedure(function_signature));
  patched_def := replace(
    replace(function_def, unsafe_payload_cast, safe_payload_expression),
    unsafe_invitation_cast,
    safe_invitation_expression
  );

  if strpos(patched_def, unsafe_payload_cast) > 0
    or strpos(patched_def, unsafe_invitation_cast) > 0 then
    raise exception 'recruiting_reserve_boolean_cast_remains' using errcode = '23514';
  end if;

  if patched_def is distinct from function_def then
    execute patched_def;
  end if;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');
