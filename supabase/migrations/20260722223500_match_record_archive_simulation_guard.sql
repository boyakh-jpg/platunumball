create or replace function public.rankball_delete_simulation_match_record_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.id like 'sim_m\_%' escape '\'
    or old.tournament_id like 'sim_trn\_%' escape '\'
  then
    delete from public.match_record_archives
    where match_id = old.id;
  end if;

  return old;
end;
$$;

revoke all on function public.rankball_delete_simulation_match_record_archive()
  from public, anon, authenticated;
grant execute on function public.rankball_delete_simulation_match_record_archive()
  to service_role;

drop trigger if exists rankball_match_record_archive_simulation_delete on public.matches;
create trigger rankball_match_record_archive_simulation_delete
after delete on public.matches
for each row execute function public.rankball_delete_simulation_match_record_archive();

delete from public.match_record_archives archive_row
where (
    archive_row.match_id like 'sim_m\_%' escape '\'
    or archive_row.payload #>> '{match,tournament_id}' like 'sim_trn\_%' escape '\'
  )
  and not exists (
    select 1
    from public.matches match_row
    where match_row.id = archive_row.match_id
  );

select pg_notify('pgrst', 'reload schema');
