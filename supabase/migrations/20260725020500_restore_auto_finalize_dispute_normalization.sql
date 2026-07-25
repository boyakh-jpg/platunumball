begin;

do $migration$
declare
  function_definition text;
  old_text text := 'greatest(1, least(60, coalesce(current_match.dispute_minutes, 30)))';
  new_text text := 'public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)';
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_auto_finalize_action(text,timestamp with time zone)'::regprocedure
  );
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'match_auto_finalize_dispute_window_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_text, new_text);
  end if;
end;
$migration$;

revoke all on function public.rankball_match_auto_finalize_action(text, timestamptz)
from public, anon, authenticated;
grant execute on function public.rankball_match_auto_finalize_action(text, timestamptz)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
