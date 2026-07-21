alter table public.approved_courts
  add column if not exists name_modification_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'approved_courts_name_modification_count_nonnegative'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_name_modification_count_nonnegative
      check (name_modification_count >= 0) not valid;
  end if;
end;
$$;

update public.approved_courts court
set name_modification_count = greatest(court.name_modification_count, history.change_count)
from (
  select court_id, count(*)::integer as change_count
  from public.court_name_change_log
  where change_source = 'admin'
  group by court_id
) history
where history.court_id = court.id
  and court.name_modification_count < history.change_count;

create index if not exists approved_courts_name_modification_count_idx
on public.approved_courts (name_modification_count, id);

create or replace function public.rankball_increment_court_name_modification_count()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.name is distinct from old.name
    and nullif(btrim(coalesce(new.name_modified_by, '')), '') is not null
    and new.name_modified_by <> 'system'
    and new.name_modification_count is not distinct from old.name_modification_count then
    new.name_modification_count := old.name_modification_count + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists approved_courts_05_name_modification_count on public.approved_courts;
create trigger approved_courts_05_name_modification_count
before update of name, name_modified_by
on public.approved_courts
for each row execute function public.rankball_increment_court_name_modification_count();

revoke all on function public.rankball_increment_court_name_modification_count() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
