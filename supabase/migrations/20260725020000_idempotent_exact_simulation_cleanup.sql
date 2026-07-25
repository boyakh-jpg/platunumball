begin;

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
  ) then$old$;
  new_text := $new$  if exists (
    select 1
    from unnest(safe_match_ids) as candidate(match_id)
    left join public.matches match_row on match_row.id = candidate.match_id
    where candidate.match_id not like 'sim_m\_%' escape '\'
      and match_row.id is not null
      and coalesce(match_row.tournament_id, '') <> all(safe_tournament_ids)
      and coalesce(match_row.rules->>'recruitingPostId', '') not like 'sim_q\_%' escape '\'
  ) then$new$;
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'simulation_cleanup_idempotent_guard_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  old_text := $old$  perform set_config('rankball.skip_derived_refresh', 'off', true);$old$;
  new_text := $new$  perform set_config('rankball.skip_derived_refresh', 'off', true);

  perform public.rankball_rebuild_profile_match_summary(affected.profile_id)
  from unnest(affected_profile_ids) as affected(profile_id);

  perform public.rankball_refresh_court_metrics(affected.court_id)
  from unnest(affected_court_ids) as affected(court_id);$new$;
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'simulation_cleanup_derived_refresh_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  old_text := $old$    'derivedRefreshSuppressed', true$old$;
  new_text := $new$    'derivedRefreshSuppressed', true,
    'derivedRefreshCompleted', true$new$;
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'simulation_cleanup_refresh_result_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  execute function_definition;
end;
$migration$;

revoke all on function public.rankball_cleanup_simulation_artifacts_exact(text[], text[])
from public, anon, authenticated;
grant execute on function public.rankball_cleanup_simulation_artifacts_exact(text[], text[])
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
