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
  approved_name text;
  approved_region text;
  legacy_name text;
begin
  if safe_court_id is not null then
    select nullif(btrim(name), ''), nullif(btrim(payload->>'region'), '')
    into approved_name, approved_region
    from public.approved_courts
    where id = safe_court_id
      and coalesce(status, 'active') = 'active'
    limit 1;

    safe_name := coalesce(approved_name, safe_name);
    safe_region := coalesce(approved_region, safe_region);

    if safe_name is null and to_regclass('public.courts') is not null then
      execute 'select name from public.courts where id = $1 limit 1'
      into legacy_name
      using safe_court_id;
      safe_name := nullif(btrim(legacy_name), '');
    end if;
  end if;

  return jsonb_build_object(
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
  snapshot_region text;
begin
  snapshot := public.rankball_court_snapshot(new.court_id, new.court_name, safe_rules->>'region');
  snapshot_region := nullif(btrim(snapshot->>'region'), '');

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
  snapshot_region text;
begin
  snapshot := public.rankball_court_snapshot(new.court_id, new.court_name, new.region);
  snapshot_region := nullif(btrim(snapshot->>'region'), '');

  new.court_name := coalesce(nullif(btrim(snapshot->>'courtName'), ''), '미정');
  new.region := coalesce(snapshot_region, nullif(btrim(new.region), ''));

  return new;
end;
$$;

create or replace function public.rankball_refresh_court_feed_dependency(p_court_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  row_id text;
begin
  if safe_court_id is null then
    return;
  end if;

  if to_regclass('public.recruiting_posts') is not null then
    with snapshots as (
      select
        post.id,
        snapshot.data->>'courtName' as court_name,
        nullif(btrim(snapshot.data->>'region'), '') as region
      from public.recruiting_posts post
      cross join lateral public.rankball_court_snapshot(post.court_id, post.court_name, post.region) as snapshot(data)
      where post.court_id = safe_court_id
    )
    update public.recruiting_posts post
    set
      court_name = snapshots.court_name,
      region = coalesce(snapshots.region, post.region)
    from snapshots
    where post.id = snapshots.id
      and (
        post.court_name is distinct from snapshots.court_name
        or (snapshots.region is not null and post.region is distinct from snapshots.region)
      );

    for row_id in
      select id
      from public.recruiting_posts
      where court_id = safe_court_id
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
    with snapshots as (
      select
        match_row.id,
        snapshot.data->>'courtName' as court_name,
        nullif(btrim(snapshot.data->>'region'), '') as region
      from public.matches match_row
      cross join lateral public.rankball_court_snapshot(match_row.court_id, match_row.court_name, match_row.rules->>'region') as snapshot(data)
      where match_row.court_id = safe_court_id
    )
    update public.matches match_row
    set
      court_name = snapshots.court_name,
      rules = case
        when snapshots.region is null then coalesce(match_row.rules, '{}'::jsonb)
        else coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object('region', snapshots.region)
      end
    from snapshots
    where match_row.id = snapshots.id
      and (
        match_row.court_name is distinct from snapshots.court_name
        or (snapshots.region is not null and match_row.rules->>'region' is distinct from snapshots.region)
      );

    for row_id in
      select id
      from public.matches
      where court_id = safe_court_id
    loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;
end;
$$;

do $$
declare
  court_row text;
begin
  if to_regclass('public.matches') is not null then
    execute 'drop trigger if exists rankball_matches_court_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_court_snapshot_guard before insert or update of court_id, court_name, rules on public.matches for each row execute function public.rankball_match_court_snapshot_guard()';
  end if;

  if to_regclass('public.recruiting_posts') is not null then
    execute 'drop trigger if exists rankball_recruiting_court_snapshot_guard on public.recruiting_posts';
    execute 'create trigger rankball_recruiting_court_snapshot_guard before insert or update of court_id, court_name, region on public.recruiting_posts for each row execute function public.rankball_recruiting_court_snapshot_guard()';
  end if;

  if to_regclass('public.approved_courts') is not null then
    execute 'drop trigger if exists rankball_approved_courts_feed_dependency_refresh on public.approved_courts';
    execute 'create trigger rankball_approved_courts_feed_dependency_refresh after insert or update of id, name, status, payload or delete on public.approved_courts for each row execute function public.rankball_refresh_court_feed_dependency_trigger()';
  end if;

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
