-- approved_courts is the only live court source.
-- courts remains a read-only archive and is never backfilled or deleted here.

begin;

do $preflight$
declare
  legacy_only_count bigint;
  missing_reference_count bigint;
  deleted_synthetic_residue bigint;
begin
  select count(*)
    into legacy_only_count
  from public.courts legacy
  where not exists (
    select 1
    from public.approved_courts approved
    where approved.id = legacy.id
  );

  if legacy_only_count > 0 then
    raise exception 'legacy_court_without_approved_row count=%', legacy_only_count
      using errcode = '23514';
  end if;

  select count(*)
    into missing_reference_count
  from (
    select match_row.court_id
    from public.matches match_row
    where match_row.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = match_row.court_id
      )
    union all
    select post.court_id
    from public.recruiting_posts post
    where post.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = post.court_id
      )
    union all
    select tournament.court_id
    from public.tournaments tournament
    where tournament.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = tournament.court_id
      )
    union all
    select review.court_id
    from public.court_reviews review
    where review.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = review.court_id
      )
    union all
    select favorite.target_id
    from public.favorites favorite
    where favorite.target_type = 'court'
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = favorite.target_id
      )
  ) missing_reference;

  if missing_reference_count > 0 then
    raise exception 'court_reference_without_approved_row count=%', missing_reference_count
      using errcode = '23514';
  end if;

  select count(*)
    into deleted_synthetic_residue
  from (
    select id from public.courts
    where id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select id from public.approved_courts
    where id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.matches
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.recruiting_posts
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.tournaments
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.court_reviews
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
  ) residue;

  if deleted_synthetic_residue > 0 then
    raise exception 'deleted_synthetic_court_residue count=%', deleted_synthetic_residue
      using errcode = '23514';
  end if;
end
$preflight$;

do $foreign_keys$
declare
  target_table text;
begin
  select target.relname
    into target_table
  from pg_constraint constraint_row
  join pg_class target on target.oid = constraint_row.confrelid
  where constraint_row.conrelid = 'public.matches'::regclass
    and constraint_row.conname = 'matches_court_id_fkey';

  if target_table = 'courts' then
    alter table public.matches
      add constraint matches_court_id_approved_fkey
      foreign key (court_id) references public.approved_courts(id)
      on delete set null not valid;
    alter table public.matches validate constraint matches_court_id_approved_fkey;
    alter table public.matches drop constraint matches_court_id_fkey;
    alter table public.matches
      rename constraint matches_court_id_approved_fkey to matches_court_id_fkey;
  elsif target_table is distinct from 'approved_courts' then
    raise exception 'unexpected_matches_court_fk_target target=%', target_table
      using errcode = '55000';
  end if;

  select target.relname
    into target_table
  from pg_constraint constraint_row
  join pg_class target on target.oid = constraint_row.confrelid
  where constraint_row.conrelid = 'public.recruiting_posts'::regclass
    and constraint_row.conname = 'recruiting_posts_court_id_fkey';

  if target_table = 'courts' then
    alter table public.recruiting_posts
      add constraint recruiting_posts_court_id_approved_fkey
      foreign key (court_id) references public.approved_courts(id)
      on delete set null not valid;
    alter table public.recruiting_posts
      validate constraint recruiting_posts_court_id_approved_fkey;
    alter table public.recruiting_posts
      drop constraint recruiting_posts_court_id_fkey;
    alter table public.recruiting_posts
      rename constraint recruiting_posts_court_id_approved_fkey
      to recruiting_posts_court_id_fkey;
  elsif target_table is distinct from 'approved_courts' then
    raise exception 'unexpected_recruiting_court_fk_target target=%', target_table
      using errcode = '55000';
  end if;
end
$foreign_keys$;

drop trigger if exists "00_courts_mirror_payload" on public.courts;
drop trigger if exists courts_00_identity_lock on public.courts;
drop trigger if exists courts_identity_guard on public.courts;
drop trigger if exists courts_sync_approved_identity on public.courts;
drop trigger if exists rankball_courts_feed_dependency_refresh on public.courts;
drop trigger if exists rankball_courts_region_key_guard on public.courts;
drop trigger if exists approved_courts_legacy_identity_guard on public.approved_courts;
drop trigger if exists approved_courts_sync_legacy_identity on public.approved_courts;
drop trigger if exists rankball_approved_court_legacy_mirror on public.approved_courts;
drop trigger if exists court_requests_legacy_identity_guard on public.court_requests;
drop trigger if exists rankball_recruiting_court_legacy_mirror on public.recruiting_posts;

drop function if exists public.rankball_sync_approved_court_legacy_mirror();
drop function if exists public.rankball_sync_court_identity_tables();
drop function if exists public.rankball_enforce_legacy_court_identity();
drop function if exists public.rankball_enforce_legacy_court_row_identity();
drop function if exists public.rankball_ensure_recruiting_court_legacy_mirror();
drop function if exists public.rankball_courts_region_key_guard();
drop function if exists public.rankball_mirror_court_payload_guard();

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
  safe_region_key text := public.rankball_court_region_key(
    safe_region, null, null, null, '{}'::jsonb
  );
  approved_id text;
  approved_name text;
  approved_region text;
  approved_region_key text;
  candidate_count integer := 0;
begin
  if safe_court_id is not null then
    select
      court.id,
      nullif(btrim(court.name), ''),
      coalesce(
        nullif(btrim(court.sigungu), ''),
        nullif(btrim(court.sido), ''),
        nullif(btrim(court.emd), '')
      ),
      coalesce(
        nullif(btrim(court.region_key), ''),
        public.rankball_court_region_key(
          coalesce(court.sigungu, court.sido, court.emd),
          court.address_text,
          court.road_address,
          court.jibun_address,
          jsonb_strip_nulls(jsonb_build_object(
            'sido', court.sido,
            'sigungu', court.sigungu,
            'addressDong', court.emd
          ))
        )
      )
    into approved_id, approved_name, approved_region, approved_region_key
    from public.approved_courts court
    where court.id = safe_court_id
      and coalesce(court.status, 'active') = 'active'
      and court.hidden_at is null
    limit 1;

    if approved_id is null then
      safe_court_id := null;
    else
      safe_name := coalesce(safe_name, approved_name);
      safe_region_key := coalesce(safe_region_key, approved_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
    end if;
  end if;

  if safe_court_id is null and safe_name is not null then
    select count(*)
      into candidate_count
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and court.hidden_at is null
      and public.rankball_court_name_key(court.name)
        = public.rankball_court_name_key(safe_name)
      and (
        safe_region_key is null
        or coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(
            coalesce(court.sigungu, court.sido, court.emd),
            court.address_text,
            court.road_address,
            court.jibun_address,
            jsonb_strip_nulls(jsonb_build_object(
              'sido', court.sido,
              'sigungu', court.sigungu,
              'addressDong', court.emd
            ))
          )
        ) = safe_region_key
      );

    if candidate_count = 1 then
      select
        court.id,
        nullif(btrim(court.name), ''),
        coalesce(
          nullif(btrim(court.sigungu), ''),
          nullif(btrim(court.sido), ''),
          nullif(btrim(court.emd), '')
        ),
        coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(
            coalesce(court.sigungu, court.sido, court.emd),
            court.address_text,
            court.road_address,
            court.jibun_address,
            jsonb_strip_nulls(jsonb_build_object(
              'sido', court.sido,
              'sigungu', court.sigungu,
              'addressDong', court.emd
            ))
          )
        )
      into approved_id, approved_name, approved_region, approved_region_key
      from public.approved_courts court
      where coalesce(court.status, 'active') = 'active'
        and court.hidden_at is null
        and public.rankball_court_name_key(court.name)
          = public.rankball_court_name_key(safe_name)
        and (
          safe_region_key is null
          or coalesce(
            nullif(btrim(court.region_key), ''),
            public.rankball_court_region_key(
              coalesce(court.sigungu, court.sido, court.emd),
              court.address_text,
              court.road_address,
              court.jibun_address,
              jsonb_strip_nulls(jsonb_build_object(
                'sido', court.sido,
                'sigungu', court.sigungu,
                'addressDong', court.emd
              ))
            )
          ) = safe_region_key
        )
      limit 1;
      safe_court_id := approved_id;
      safe_name := coalesce(approved_name, safe_name);
      safe_region_key := coalesce(approved_region_key, safe_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
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

create or replace function public.rankball_resolve_approved_court_id(
  p_court_id text,
  p_court_name text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select court.id
  from public.approved_courts court
  where coalesce(court.status, 'active') = 'active'
    and court.hidden_at is null
    and (
      court.id = nullif(btrim(p_court_id), '')
      or (
        nullif(btrim(p_court_name), '') is not null
        and public.rankball_court_name_key(court.name)
          = public.rankball_court_name_key(p_court_name)
      )
    )
  order by
    (court.id = nullif(btrim(p_court_id), '')) desc,
    court.created_at asc
  limit 1;
$$;

create or replace function public.rankball_refresh_court_metrics(p_court_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  safe_court_name text;
  global_mean double precision := 3.5;
  raw_average double precision;
  adjusted_average double precision := 3.5;
  safe_review_count integer := 0;
  safe_completed_match_count integer := 0;
  safe_recent_reviews jsonb := '[]'::jsonb;
  safe_recommendation_score double precision := 3.5;
begin
  if safe_court_id is null then return; end if;

  select court.name
    into safe_court_name
  from public.approved_courts court
  where court.id = safe_court_id
    and coalesce(court.status, 'active') = 'active'
    and court.hidden_at is null;
  if safe_court_name is null then return; end if;

  select coalesce(avg(rating::double precision), 3.5)
    into global_mean
  from public.court_reviews
  where coalesce(status, 'active') = 'active';

  select
    count(*)::integer,
    avg(raw_rating),
    (coalesce(sum(adjusted_rating), 0) + (5 * global_mean)) / (count(*) + 5)
  into safe_review_count, raw_average, adjusted_average
  from public.rankball_court_rating_rows()
  where court_id = safe_court_id
    or public.rankball_court_name_key(court_name)
      = public.rankball_court_name_key(safe_court_name);

  select count(*)::integer
    into safe_completed_match_count
  from public.matches
  where (
      court_id = safe_court_id
      or public.rankball_court_name_key(court_name)
        = public.rankball_court_name_key(safe_court_name)
    )
    and status = 'confirmed'
    and coalesce(ended_at, confirmed_at) is not null;

  select coalesce(jsonb_agg(review_item order by sort_at desc), '[]'::jsonb)
    into safe_recent_reviews
  from (
    select
      jsonb_build_object(
        'id', review.review_id,
        'rating', review.raw_rating,
        'adjustedRating', round(review.adjusted_rating::numeric, 1),
        'memo', left(btrim(review.memo), 240),
        'createdAt', review.created_at
      ) as review_item,
      coalesce(review.updated_at, review.created_at) as sort_at
    from public.rankball_court_rating_rows() review
    where (
        review.court_id = safe_court_id
        or public.rankball_court_name_key(review.court_name)
          = public.rankball_court_name_key(safe_court_name)
      )
      and nullif(btrim(review.memo), '') is not null
    order by coalesce(review.updated_at, review.created_at) desc
    limit 3
  ) recent;

  adjusted_average := greatest(
    1.0,
    least(5.0, coalesce(adjusted_average, global_mean))
  );
  safe_recommendation_score := adjusted_average
    + least(0.8, ln(1 + safe_completed_match_count) * 0.2);

  update public.approved_courts
  set
    raw_rating = case
      when safe_review_count > 0 then round(raw_average::numeric, 2)
      else null
    end,
    adjusted_rating = round(adjusted_average::numeric, 2),
    review_count = safe_review_count,
    completed_match_count = safe_completed_match_count,
    recommendation_score = round(safe_recommendation_score::numeric, 3),
    recent_reviews = safe_recent_reviews,
    metrics_updated_at = now()
  where coalesce(status, 'active') = 'active'
    and hidden_at is null
    and (
      id = safe_court_id
      or public.rankball_court_name_key(name)
        = public.rankball_court_name_key(safe_court_name)
    );
end;
$$;

create or replace function public.rankball_refresh_all_court_metrics()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row record;
  refreshed_count integer := 0;
begin
  for court_row in
    select court.id
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and court.hidden_at is null
  loop
    perform public.rankball_refresh_court_metrics(court_row.id);
    refreshed_count := refreshed_count + 1;
  end loop;
  return refreshed_count;
end;
$$;

create function pg_temp.rankball_patch_court_function(
  p_target regprocedure,
  p_replacements jsonb
)
returns void
language plpgsql
as $patch_function$
declare
  function_definition text;
  replacement jsonb;
  old_fragment text;
  new_fragment text;
begin
  select replace(pg_get_functiondef(p_target), E'\r\n', E'\n')
    into function_definition;

  if position('public.courts' in function_definition) = 0 then
    return;
  end if;

  for replacement in
    select value from jsonb_array_elements(p_replacements)
  loop
    old_fragment := replace(replacement->>'old', E'\r\n', E'\n');
    new_fragment := replace(coalesce(replacement->>'new', ''), E'\r\n', E'\n');
    if position(old_fragment in function_definition) = 0 then
      raise exception 'legacy_court_function_fragment_changed function=%',
        p_target::text using errcode = '55000';
    end if;
    function_definition := replace(
      function_definition,
      old_fragment,
      new_fragment
    );
  end loop;

  if position('public.courts' in function_definition) > 0 then
    raise exception 'legacy_court_function_reference_remains function=%',
      p_target::text using errcode = '55000';
  end if;

  execute function_definition;
end;
$patch_function$;

select pg_temp.rankball_patch_court_function(
  'public.rankball_apply_osm_court_name_evidence(jsonb,boolean,text)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
      update public.courts
      set name = court_row.name,
          payload = payload || jsonb_build_object(
            'name', court_row.name,
            'canonicalName', court_row.name,
            'canonicalBaseName', court_row.name,
            'baseName', court_row.facility_name,
            'facilityName', court_row.facility_name
          )
      where id = safe_court_id;
$old$,
    'new', ''
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_approve_court_request(text,integer,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  if to_regclass('public.courts') is not null then
    execute $sql$
      insert into public.courts (id, name, region, type, region_key, created_at)
      values (
        $1, $2, coalesce(nullif($3, ''), nullif($4, ''), 'unknown'),
        coalesce(nullif($5, ''), 'outdoor'),
        coalesce(nullif($4, ''), public.rankball_court_region_key($3, $6, $7, $8, $9)), $10
      )
      on conflict (id) do update set
        name = excluded.name,
        region = excluded.region,
        type = excluded.type,
        region_key = excluded.region_key
    $sql$
    using approved_id, approved_name, request_row.payload->>'region',
      public.rankball_court_region_key(request_row.payload->>'region', request_row.address_text, request_row.road_address, request_row.jibun_address, request_row.payload),
      request_row.payload->>'type', request_row.address_text, request_row.road_address,
      request_row.jibun_address, request_row.payload, now_ts;
  end if;
$old$,
    'new', ''
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_import_public_courts(text,text,text,jsonb,boolean)'::regprocedure,
  jsonb_build_array(
    jsonb_build_object(
      'old', $old$
        union all
        select
          'legacy'::text,
          legacy.id,
          legacy.name,
          coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name),
          legacy.address_text,
          legacy.road_address,
          legacy.jibun_address,
          legacy.lat,
          legacy.lng
        from public.courts legacy
        where legacy.id <> safe_id
          and not exists (
            select 1 from public.approved_courts mirrored where mirrored.id = legacy.id
          )
$old$,
      'new', ''
    ),
    jsonb_build_object(
      'old', $old$
          union all
          select coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name)
          from public.courts legacy
          where legacy.id <> safe_id
            and not exists (
              select 1 from public.approved_courts mirrored where mirrored.id = legacy.id
            )
            and public.rankball_same_court_location(
              safe_address_text, safe_road_address, safe_jibun_address, safe_lat, safe_lng,
              legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
            )
$old$,
      'new', ''
    ),
    jsonb_build_object(
      'old', $old$
    if to_regclass('public.courts') is not null then
      execute $legacy$
        insert into public.courts (
          id, name, region, type, region_key, address_text, road_address,
          jibun_address, lat, lng, payload, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        on conflict (id) do update set
          name = excluded.name,
          region = excluded.region,
          type = excluded.type,
          region_key = excluded.region_key,
          address_text = excluded.address_text,
          road_address = excluded.road_address,
          jibun_address = excluded.jibun_address,
          lat = excluded.lat,
          lng = excluded.lng,
          payload = excluded.payload
      $legacy$
      using safe_id, safe_name, safe_region, safe_type, safe_region_key,
        safe_address_text, safe_road_address, safe_jibun_address, safe_lat,
        safe_lng, safe_payload, now_ts;
    end if;
$old$,
      'new', ''
    )
  )
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_quarantine_simulation_artifacts(timestamptz)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  update public.courts court
  set payload = coalesce(court.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'active', false,
        'quarantinedAt', p_now,
        'quarantineReason', 'simulation_artifact'
      )
  where court.id like 'court\_sim\_%' escape '\'
    and coalesce(court.payload->>'active', 'true') <> 'false';
$old$,
    'new', ''
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_match_room_update_action_pre_change_approval(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  select court.id, court.name, coalesce(court.region_key, court.region)
  into next_court_id, next_court_name, next_court_region
  from public.courts court
  join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
  where court.id = next_court_id;
$old$,
    'new', $new$
  select
    approved.id,
    approved.name,
    coalesce(
      nullif(approved.region_key, ''),
      nullif(approved.sigungu, ''),
      nullif(approved.sido, ''),
      nullif(approved.emd, '')
    )
  into next_court_id, next_court_name, next_court_region
  from public.approved_courts approved
  where approved.id = next_court_id
    and coalesce(approved.status, 'active') = 'active'
    and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_match_room_update_action_pre_edit_once(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
    select court.id, court.name, coalesce(nullif(court.region_key, ''), court.region)
    into target_court_id, target_court_name, target_region
    from public.courts court
    join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
    where court.id = target_court_id;
$old$,
    'new', $new$
    select
      approved.id,
      approved.name,
      coalesce(
        nullif(approved.region_key, ''),
        nullif(approved.sigungu, ''),
        nullif(approved.sido, ''),
        nullif(approved.emd, '')
      )
    into target_court_id, target_court_name, target_region
    from public.approved_courts approved
    where approved.id = target_court_id
      and coalesce(approved.status, 'active') = 'active'
      and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_recruiting_room_update_action_pre_edit_once(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
    select court.id, court.name, coalesce(nullif(court.region_key, ''), court.region)
    into target_court_id, target_court_name, target_region
    from public.courts court
    join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
    where court.id = target_court_id;
$old$,
    'new', $new$
    select
      approved.id,
      approved.name,
      coalesce(
        nullif(approved.region_key, ''),
        nullif(approved.sigungu, ''),
        nullif(approved.sido, ''),
        nullif(approved.emd, '')
      )
    into target_court_id, target_court_name, target_region
    from public.approved_courts approved
    where approved.id = target_court_id
      and coalesce(approved.status, 'active') = 'active'
      and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_recruiting_room_update_action_pre_pickup_resize(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  select court.id, court.name, coalesce(court.region_key, court.region)
  into next_court_id, next_court_name, next_court_region
  from public.courts court
  join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
  where court.id = next_court_id;
$old$,
    'new', $new$
  select
    approved.id,
    approved.name,
    coalesce(
      nullif(approved.region_key, ''),
      nullif(approved.sigungu, ''),
      nullif(approved.sido, ''),
      nullif(approved.emd, '')
    )
  into next_court_id, next_court_name, next_court_region
  from public.approved_courts approved
  where approved.id = next_court_id
    and coalesce(approved.status, 'active') = 'active'
    and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_tournament_match_schedule_action_unrestricted(text,text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  select court_source.name
  into safe_court_name
  from (
    select approved.name, 1 as priority
    from public.approved_courts approved
    where approved.id = safe_court_id
      and coalesce(approved.status, 'active') in ('active', 'approved')
      and approved.hidden_at is null
    union all
    select legacy.name, 2 as priority
    from public.courts legacy
    where legacy.id = safe_court_id
  ) court_source
  order by court_source.priority
  limit 1;
$old$,
    'new', $new$
  select approved.name
  into safe_court_name
  from public.approved_courts approved
  where approved.id = safe_court_id
    and coalesce(approved.status, 'active') in ('active', 'approved')
    and approved.hidden_at is null
  limit 1;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_operational_data_health()'::regprocedure,
  jsonb_build_array(
    jsonb_build_object(
      'old', $old$
      union all
      select 'legacy:' || court.id
      from public.courts court
      where court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
$old$,
      'new', ''
    ),
    jsonb_build_object(
      'old', $old$
    left join public.courts court on court.id = match_row.court_id
$old$,
      'new', $new$
    left join public.approved_courts court on court.id = match_row.court_id
$new$
    ),
    jsonb_build_object(
      'old', $old$
    left join public.courts court on court.id = post.court_id
$old$,
      'new', $new$
    left join public.approved_courts court on court.id = post.court_id
$new$
    ),
    jsonb_build_object(
      'old', $old$
    left join public.courts court on court.id = tournament.court_id
$old$,
      'new', $new$
    left join public.approved_courts court on court.id = tournament.court_id
$new$
    ),
    jsonb_build_object(
      'old', $old$
    select 'inactiveFeedSourceMissing' check_name, count(*)::bigint affected_count
    from public.user_room_feed feed
    where not feed.is_active
      and (
        (feed.entity_type = 'match' and not exists (
          select 1 from public.matches match_row where match_row.id = feed.entity_id
        ))
        or (feed.entity_type = 'recruiting' and not exists (
          select 1 from public.recruiting_posts post where post.id = feed.entity_id
        ))
      )
$old$,
      'new', $new$
    select 'inactiveFeedSourceMissing' check_name, count(*)::bigint affected_count
    from public.user_room_feed feed
    where not feed.is_active
      and feed.updated_at < now() - interval '7 days'
      and (
        (feed.entity_type = 'match' and not exists (
          select 1 from public.matches match_row where match_row.id = feed.entity_id
        ))
        or (feed.entity_type = 'recruiting' and not exists (
          select 1 from public.recruiting_posts post where post.id = feed.entity_id
        ))
      )
$new$
    ),
    jsonb_build_object(
      'old', $old$
    select 'quarantinedCardAwaitingRetention', count(*)
    from public.room_feed_cards card
    where card.card_json->>'dataState' = 'quarantined'
$old$,
      'new', $new$
    select 'quarantinedCardAwaitingRetention', count(*)
    from public.room_feed_cards card
    where card.card_json->>'dataState' = 'quarantined'
      and card.updated_at < now() - interval '7 days'
      and not exists (
        select 1
        from public.user_room_feed feed
        where feed.entity_type = card.entity_type
          and feed.entity_id = card.entity_id
          and feed.is_active = true
      )
      and coalesce((
        select max(feed.updated_at)
        from public.user_room_feed feed
        where feed.entity_type = card.entity_type
          and feed.entity_id = card.entity_id
      ), card.updated_at) < now() - interval '7 days'
$new$
    )
  )
);

create or replace function public.rankball_feed_trigger_health()
returns table(trigger_name text, event_object_table text)
language sql
security definer
set search_path = public
as $$
  select
    trigger_row.trigger_name::text,
    trigger_row.event_object_table::text
  from information_schema.triggers as trigger_row
  where trigger_row.trigger_schema = 'public'
    and trigger_row.trigger_name = any(array[
      'rankball_recruiting_posts_feed_refresh',
      'rankball_recruiting_applications_feed_refresh',
      'rankball_matches_feed_refresh',
      'rankball_match_players_feed_refresh',
      'rankball_match_agreements_feed_refresh',
      'rankball_match_approvals_feed_refresh',
      'rankball_match_disputes_feed_refresh',
      'rankball_team_members_feed_dependency_refresh',
      'rankball_match_results_feed_refresh',
      'rankball_player_match_stats_feed_refresh',
      'rankball_profiles_feed_dependency_refresh',
      'rankball_teams_feed_dependency_refresh',
      'rankball_approved_courts_feed_dependency_refresh'
    ])
  order by trigger_row.trigger_name;
$$;

revoke all on function public.rankball_court_snapshot(text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_resolve_approved_court_id(text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_refresh_court_metrics(text)
  from public, anon, authenticated;
revoke all on function public.rankball_refresh_all_court_metrics()
  from public, anon, authenticated;
revoke all on function public.rankball_feed_trigger_health()
  from public, anon, authenticated;
grant execute on function public.rankball_court_snapshot(text, text, text)
  to service_role;
grant execute on function public.rankball_resolve_approved_court_id(text, text)
  to service_role;
grant execute on function public.rankball_refresh_court_metrics(text)
  to service_role;
grant execute on function public.rankball_refresh_all_court_metrics()
  to service_role;
grant execute on function public.rankball_feed_trigger_health()
  to service_role;

revoke all on table public.courts from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.courts from service_role;
grant select on table public.courts to service_role;

comment on table public.courts is
  'Read-only legacy court archive. approved_courts is the only live court source.';
comment on function public.rankball_operational_data_health() is
  'Checks live canonical sources; retention warnings count only rows already eligible for seven-day cleanup.';

select public.rankball_cleanup_room_feed(now());

do $postflight$
declare
  legacy_function_count bigint;
  legacy_trigger_count bigint;
  legacy_fk_count bigint;
begin
  select count(*)
    into legacy_function_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and position('public.courts' in pg_get_functiondef(procedure.oid)) > 0;

  if legacy_function_count > 0 then
    raise exception 'live_function_still_reads_legacy_courts count=%',
      legacy_function_count using errcode = '55000';
  end if;

  select count(*)
    into legacy_trigger_count
  from pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.courts'::regclass
    and not trigger_row.tgisinternal;

  if legacy_trigger_count > 0 then
    raise exception 'legacy_courts_trigger_remains count=%',
      legacy_trigger_count using errcode = '55000';
  end if;

  select count(*)
    into legacy_fk_count
  from pg_constraint constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid = 'public.courts'::regclass;

  if legacy_fk_count > 0 then
    raise exception 'legacy_courts_foreign_key_remains count=%',
      legacy_fk_count using errcode = '55000';
  end if;
end
$postflight$;

commit;

select pg_notify('pgrst', 'reload schema');
