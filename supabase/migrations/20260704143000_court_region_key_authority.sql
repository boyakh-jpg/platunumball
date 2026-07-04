alter table public.approved_courts
  add column if not exists region_key text;

create index if not exists approved_courts_region_key_idx
on public.approved_courts (region_key, status)
where region_key is not null;

create or replace function public.rankball_court_region_key(
  p_region text,
  p_address_text text default null,
  p_road_address text default null,
  p_jibun_address text default null,
  p_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  candidate text;
  tokens text[];
  token text;
  token_index integer;
  raw_values text[] := array[
    p_payload->>'sigungu',
    p_payload->>'addressSigungu',
    p_payload->>'addressDistrict',
    p_road_address,
    p_jibun_address,
    p_address_text,
    p_payload->>'region',
    p_region,
    p_payload->>'addressDong'
  ];
begin
  foreach candidate in array raw_values loop
    candidate := regexp_replace(btrim(coalesce(candidate, '')), '\s+', ' ', 'g');
    if candidate is null or candidate = '' then
      continue;
    end if;

    tokens := regexp_split_to_array(candidate, '\s+');
    if array_length(tokens, 1) >= 2 then
      for token_index in 2..array_length(tokens, 1) loop
        token := nullif(btrim(tokens[token_index]), '');
        if token is not null and token ~ '(구|군|시)$' then
          return public.rankball_room_feed_region_key(token);
        end if;
      end loop;
    end if;

    if candidate !~ '(특별시|광역시|특별자치시|특별자치도|도)$' then
      return public.rankball_room_feed_region_key(candidate);
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.rankball_approved_courts_region_key_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.region_key := public.rankball_court_region_key(
    new.payload->>'region',
    new.address_text,
    new.road_address,
    new.jibun_address,
    new.payload
  );
  return new;
end;
$$;

drop trigger if exists rankball_approved_courts_region_key_guard on public.approved_courts;
create trigger rankball_approved_courts_region_key_guard
before insert or update of payload, address_text, road_address, jibun_address
on public.approved_courts
for each row execute function public.rankball_approved_courts_region_key_guard();

update public.approved_courts
set region_key = public.rankball_court_region_key(
  payload->>'region',
  address_text,
  road_address,
  jibun_address,
  payload
)
where region_key is distinct from public.rankball_court_region_key(
  payload->>'region',
  address_text,
  road_address,
  jibun_address,
  payload
);

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
  safe_region_key text := public.rankball_court_region_key(safe_region, null, null, null, '{}'::jsonb);
  legacy_name text;
  legacy_region text;
  approved_id text;
  approved_name text;
  approved_region text;
  approved_region_key text;
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
      safe_region_key := coalesce(public.rankball_court_region_key(legacy_region, null, null, null, '{}'::jsonb), safe_region_key);
      safe_region := coalesce(safe_region_key, nullif(btrim(legacy_region), ''), safe_region);
    end if;

    if safe_court_id is not null then
      select
        nullif(btrim(name), ''),
        nullif(btrim(payload->>'region'), ''),
        coalesce(
          nullif(btrim(region_key), ''),
          public.rankball_court_region_key(payload->>'region', address_text, road_address, jibun_address, payload)
        )
      into approved_name, approved_region, approved_region_key
      from public.approved_courts
      where id = safe_court_id
        and coalesce(status, 'active') = 'active'
      limit 1;

      safe_name := coalesce(safe_name, approved_name);
      safe_region_key := coalesce(safe_region_key, approved_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
    end if;
  end if;

  if safe_court_id is null and safe_name is not null and to_regclass('public.approved_courts') is not null then
    select count(*)
    into candidate_count
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
      and (
        safe_region_key is null
        or coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(court.payload->>'region', court.address_text, court.road_address, court.jibun_address, court.payload)
        ) = safe_region_key
      );

    if candidate_count = 1 then
      select
        court.id,
        nullif(btrim(court.name), ''),
        nullif(btrim(court.payload->>'region'), ''),
        coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(court.payload->>'region', court.address_text, court.road_address, court.jibun_address, court.payload)
        )
      into approved_id, approved_name, approved_region, approved_region_key
      from public.approved_courts court
      where coalesce(court.status, 'active') = 'active'
        and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
        and (
          safe_region_key is null
          or coalesce(
            nullif(btrim(court.region_key), ''),
            public.rankball_court_region_key(court.payload->>'region', court.address_text, court.road_address, court.jibun_address, court.payload)
          ) = safe_region_key
        )
      limit 1;

      safe_court_id := approved_id;
      safe_name := coalesce(approved_name, safe_name);
      safe_region_key := coalesce(approved_region_key, safe_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
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
            or public.rankball_court_region_key(court.region, null, null, null, ''{}''::jsonb) = $2
          )'
      into candidate_count
      using safe_name, safe_region_key;

      if candidate_count = 1 then
        execute '
          select court.id, court.name, court.region
          from public.courts court
          where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
            and (
              $2 is null
              or public.rankball_court_region_key(court.region, null, null, null, ''{}''::jsonb) = $2
            )
          limit 1'
        into legacy_id, legacy_name, legacy_region
        using safe_name, safe_region_key;
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
      safe_region_key := coalesce(public.rankball_court_region_key(legacy_region, null, null, null, '{}'::jsonb), safe_region_key);
      safe_region := coalesce(safe_region_key, nullif(btrim(legacy_region), ''), safe_region);
    end if;
  end if;

  return jsonb_build_object(
    'courtId', safe_court_id,
    'courtName', coalesce(safe_name, '미정'),
    'region', coalesce(safe_region_key, safe_region),
    'regionKey', safe_region_key
  );
end;
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.approved_courts') is not null then
    execute 'drop trigger if exists rankball_approved_courts_feed_dependency_refresh on public.approved_courts';
    execute 'create trigger rankball_approved_courts_feed_dependency_refresh after insert or update of id, name, status, payload, address_text, road_address, jibun_address, region_key or delete on public.approved_courts for each row execute function public.rankball_refresh_court_feed_dependency_trigger()';
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

select pg_notify('pgrst', 'reload schema');
