begin;

do $migration$
declare
  function_definition text;
  old_fragment constant text := $old$archive.record_date between season_row.starts_at and season_row.ends_at$old$;
  new_fragment constant text := $new$(season_row.starts_at is null or archive.record_date >= season_row.starts_at)
      and (season_row.ends_at is null or archive.record_date <= season_row.ends_at)$new$;
begin
  select pg_get_functiondef(
    'public.rankball_season_rankings(text,text)'::regprocedure
  ) into function_definition;

  if position(old_fragment in function_definition) > 0 then
    execute replace(function_definition, old_fragment, new_fragment);
  elsif position(new_fragment in function_definition) = 0 then
    raise exception 'season_ranking_date_boundary_shape_changed';
  end if;
end;
$migration$;

revoke all on function public.rankball_season_rankings(text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_season_rankings(text, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
