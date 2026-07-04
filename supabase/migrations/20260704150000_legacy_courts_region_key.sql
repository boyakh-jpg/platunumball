create or replace function public.rankball_courts_region_key_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.region_key := public.rankball_court_region_key(new.region, null, null, null, '{}'::jsonb);
  return new;
end;
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.courts') is not null then
    execute 'alter table public.courts add column if not exists region_key text';
    execute 'create index if not exists courts_region_key_idx on public.courts (region_key) where region_key is not null';

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'courts'
        and column_name = 'region'
    ) then
      execute '
        update public.courts
        set region_key = public.rankball_court_region_key(region, null, null, null, ''{}''::jsonb)
        where region_key is distinct from public.rankball_court_region_key(region, null, null, null, ''{}''::jsonb)';

      execute 'drop trigger if exists rankball_courts_region_key_guard on public.courts';
      execute '
        create trigger rankball_courts_region_key_guard
        before insert or update of region
        on public.courts
        for each row execute function public.rankball_courts_region_key_guard()';
    end if;

    execute 'drop trigger if exists rankball_courts_feed_dependency_refresh on public.courts';
    execute 'create trigger rankball_courts_feed_dependency_refresh after insert or update or delete on public.courts for each row execute function public.rankball_refresh_court_feed_dependency_trigger()';
  end if;

  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in select id from public.recruiting_posts where nullif(btrim(court_id), '') is not null loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null
    and to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
    for row_id in select id from public.matches where nullif(btrim(court_id), '') is not null loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.courts') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'courts'
        and column_name = 'region'
    ) then
    execute 'drop trigger if exists rankball_courts_region_key_guard on public.courts';
    execute '
      create trigger rankball_courts_region_key_guard
      before insert or update of region
      on public.courts
      for each row execute function public.rankball_courts_region_key_guard()';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
