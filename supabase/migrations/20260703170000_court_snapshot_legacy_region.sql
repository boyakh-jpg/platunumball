create or replace function public.rankball_court_snapshot(
  p_court_id text,
  p_fallback_name text default null,
  p_fallback_region text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  safe_name text := nullif(btrim(p_fallback_name), '');
  safe_region text := nullif(btrim(p_fallback_region), '');
  legacy_name text;
  legacy_region text;
  approved_name text;
  approved_region text;
begin
  if safe_court_id is not null then
    if to_regclass('public.courts') is not null then
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'courts'
          and column_name = 'region'
      ) then
        execute 'select name, region from public.courts where id = $1 limit 1'
        into legacy_name, legacy_region
        using safe_court_id;
      else
        execute 'select name from public.courts where id = $1 limit 1'
        into legacy_name
        using safe_court_id;
      end if;

      safe_name := coalesce(nullif(btrim(legacy_name), ''), safe_name);
      safe_region := coalesce(nullif(btrim(legacy_region), ''), safe_region);
    end if;

    if safe_name is null or safe_region is null then
      select nullif(btrim(name), ''), nullif(btrim(payload->>'region'), '')
      into approved_name, approved_region
      from public.approved_courts
      where id = safe_court_id
        and coalesce(status, 'active') = 'active'
      limit 1;

      safe_name := coalesce(safe_name, approved_name);
      safe_region := coalesce(safe_region, approved_region);
    end if;
  end if;

  return jsonb_build_object(
    'courtName', coalesce(safe_name, '미정'),
    'region', safe_region
  );
end;
$$;

do $$
declare
  court_row text;
begin
  if to_regclass('public.recruiting_posts') is not null then
    for court_row in
      select distinct court_id
      from public.recruiting_posts
      where nullif(btrim(court_id), '') is not null
    loop
      perform public.rankball_refresh_court_feed_dependency(court_row);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
    for court_row in
      select distinct court_id
      from public.matches
      where nullif(btrim(court_id), '') is not null
    loop
      perform public.rankball_refresh_court_feed_dependency(court_row);
    end loop;
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
