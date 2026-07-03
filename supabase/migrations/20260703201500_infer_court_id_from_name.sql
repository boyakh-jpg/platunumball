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
  approved_id text;
  approved_name text;
  approved_region text;
  legacy_id text;
  candidate_count integer := 0;
  has_legacy_region boolean := false;
begin
  if safe_court_id is not null then
    if to_regclass('public.courts') is not null then
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'courts'
          and column_name = 'region'
      )
      into has_legacy_region;

      if has_legacy_region then
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

  if safe_court_id is null and safe_name is not null and to_regclass('public.approved_courts') is not null then
    select count(*)
    into candidate_count
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
      and (
        safe_region is null
        or public.rankball_room_feed_region_key(court.payload->>'region') = public.rankball_room_feed_region_key(safe_region)
      );

    if candidate_count = 1 then
      select court.id, nullif(btrim(court.name), ''), nullif(btrim(court.payload->>'region'), '')
      into approved_id, approved_name, approved_region
      from public.approved_courts court
      where coalesce(court.status, 'active') = 'active'
        and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
        and (
          safe_region is null
          or public.rankball_room_feed_region_key(court.payload->>'region') = public.rankball_room_feed_region_key(safe_region)
        )
      limit 1;

      safe_court_id := approved_id;
      safe_name := coalesce(approved_name, safe_name);
      safe_region := coalesce(approved_region, safe_region);
    end if;
  end if;

  if safe_court_id is null and safe_name is not null and to_regclass('public.courts') is not null then
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'courts'
        and column_name = 'region'
    )
    into has_legacy_region;

    if has_legacy_region then
      execute '
        select count(*)
        from public.courts court
        where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
          and (
            $2 is null
            or public.rankball_room_feed_region_key(court.region) = public.rankball_room_feed_region_key($2)
          )'
      into candidate_count
      using safe_name, safe_region;

      if candidate_count = 1 then
        execute '
          select court.id, court.name, court.region
          from public.courts court
          where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
            and (
              $2 is null
              or public.rankball_room_feed_region_key(court.region) = public.rankball_room_feed_region_key($2)
            )
          limit 1'
        into legacy_id, legacy_name, legacy_region
        using safe_name, safe_region;
      end if;
    else
      execute '
        select count(*)
        from public.courts court
        where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')'
      into candidate_count
      using safe_name;

      if candidate_count = 1 then
        execute '
          select court.id, court.name
          from public.courts court
          where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
          limit 1'
        into legacy_id, legacy_name
        using safe_name;
      end if;
    end if;

    if legacy_id is not null then
      safe_court_id := legacy_id;
      safe_name := coalesce(nullif(btrim(legacy_name), ''), safe_name);
      safe_region := coalesce(nullif(btrim(legacy_region), ''), safe_region);
    end if;
  end if;

  return jsonb_build_object(
    'courtId', safe_court_id,
    'courtName', coalesce(safe_name, '미정'),
    'region', safe_region
  );
end;
$$;

create or replace function public.rankball_match_court_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_rules jsonb := coalesce(new.rules, '{}'::jsonb);
  snapshot jsonb;
  snapshot_court_id text;
  snapshot_region text;
begin
  snapshot := public.rankball_court_snapshot(new.court_id, new.court_name, safe_rules->>'region');
  snapshot_court_id := nullif(btrim(snapshot->>'courtId'), '');
  snapshot_region := nullif(btrim(snapshot->>'region'), '');

  new.court_id := coalesce(snapshot_court_id, nullif(btrim(new.court_id), ''));
  new.court_name := coalesce(nullif(btrim(snapshot->>'courtName'), ''), '미정');
  new.rules := safe_rules;

  if snapshot_region is not null then
    new.rules := new.rules || jsonb_build_object('region', snapshot_region);
  end if;

  return new;
end;
$$;

create or replace function public.rankball_recruiting_court_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot jsonb;
  snapshot_court_id text;
  snapshot_region text;
begin
  snapshot := public.rankball_court_snapshot(new.court_id, new.court_name, new.region);
  snapshot_court_id := nullif(btrim(snapshot->>'courtId'), '');
  snapshot_region := nullif(btrim(snapshot->>'region'), '');

  new.court_id := coalesce(snapshot_court_id, nullif(btrim(new.court_id), ''));
  new.court_name := coalesce(nullif(btrim(snapshot->>'courtName'), ''), '미정');
  new.region := coalesce(snapshot_region, nullif(btrim(new.region), ''));

  return new;
end;
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null then
    update public.recruiting_posts
    set court_name = court_name
    where nullif(btrim(court_id), '') is null
      and nullif(btrim(court_name), '') is not null;

    for row_id in
      select id
      from public.recruiting_posts
      where nullif(btrim(court_id), '') is not null
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
    update public.matches
    set court_name = court_name
    where nullif(btrim(court_id), '') is null
      and nullif(btrim(court_name), '') is not null;

    for row_id in
      select id
      from public.matches
      where nullif(btrim(court_id), '') is not null
    loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
