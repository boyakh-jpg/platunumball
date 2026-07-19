do $$
declare
  function_definition text;
  repaired_definition text;
begin
  select pg_get_functiondef(
    'public.rankball_create_tournament_match_locked(text,text,text,integer,integer,text)'::regprocedure
  )
  into function_definition;

  if position('''dispute_minutes'', 30' in function_definition) > 0 then
    return;
  end if;

  repaired_definition := replace(
    function_definition,
    '''dispute_minutes'', 120',
    '''dispute_minutes'', 30'
  );

  if repaired_definition = function_definition then
    raise exception 'tournament_dispute_window_definition_unrecognized' using errcode = '23514';
  end if;

  execute repaired_definition;
end;
$$;

revoke all on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text)
from public, anon, authenticated;
grant execute on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text)
to service_role;
