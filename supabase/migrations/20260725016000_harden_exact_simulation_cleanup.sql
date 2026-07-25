do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_cleanup_simulation_artifacts_exact(text[],text[])'::regprocedure
  );

  old_text := $old$  if exists (
    select 1
    from public.matches match_row
    where match_row.id = any(safe_match_ids)
      and match_row.id not like 'sim_m\_%' escape '\'
      and coalesce(match_row.tournament_id, '') <> all(safe_tournament_ids)
      and coalesce(match_row.rules->>'recruitingPostId', '') not like 'sim_q\_%' escape '\'
  ) then$old$;
  new_text := $new$  if exists (
    select 1
    from unnest(safe_match_ids) as candidate(match_id)
    left join public.matches match_row on match_row.id = candidate.match_id
    where candidate.match_id not like 'sim_m\_%' escape '\'
      and (
        match_row.id is null
        or (
          coalesce(match_row.tournament_id, '') <> all(safe_tournament_ids)
          and coalesce(match_row.rules->>'recruitingPostId', '') not like 'sim_q\_%' escape '\'
        )
      )
  ) then$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'simulation_cleanup_match_guard_shape_changed' using errcode = '55000';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$    'ok', remaining_matches = 0,$old$;
  new_text := $new$    'ok', remaining_matches = 0 and remaining_tournaments = 0,$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'simulation_cleanup_result_shape_changed' using errcode = '55000';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  execute function_definition;
end;
$migration$;

revoke all on function public.rankball_cleanup_simulation_artifacts_exact(text[], text[])
from public, anon, authenticated;
grant execute on function public.rankball_cleanup_simulation_artifacts_exact(text[], text[])
to service_role;

select pg_notify('pgrst', 'reload schema');
