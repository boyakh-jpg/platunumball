do $$
declare
  function_definition text;
  patched_definition text;
begin
  select pg_get_functiondef('public.rankball_match_finalize_locked(text,text,text)'::regprocedure)
  into function_definition;

  if position('#variable_conflict use_column' in function_definition) > 0 then
    return;
  end if;

  patched_definition := regexp_replace(
    function_definition,
    E'\nDECLARE\n',
    E'\n#variable_conflict use_column\nDECLARE\n',
    'i'
  );

  if patched_definition = function_definition then
    raise exception 'rankball_match_finalize_declare_marker_missing' using errcode = '42883';
  end if;

  execute patched_definition;
end;
$$;

revoke all on function public.rankball_match_finalize_locked(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
