alter table public.approved_courts
  add column if not exists raw_rating numeric(4, 2),
  add column if not exists adjusted_rating numeric(4, 2) not null default 3.50,
  add column if not exists review_count integer not null default 0,
  add column if not exists completed_match_count integer not null default 0,
  add column if not exists recommendation_score numeric(6, 3) not null default 3.500,
  add column if not exists recent_reviews jsonb not null default '[]'::jsonb,
  add column if not exists metrics_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_courts_metrics_nonnegative'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_metrics_nonnegative
      check (review_count >= 0 and completed_match_count >= 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'court_reviews_memo_length_check'
      and conrelid = 'public.court_reviews'::regclass
  ) then
    alter table public.court_reviews
      add constraint court_reviews_memo_length_check
      check (memo is null or char_length(memo) <= 240) not valid;
  end if;
end;
$$;

create or replace function public.rankball_court_address_key(raw_address text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(btrim(raw_address), ''), '[[:space:][:punct:]]+', '', 'g'));
$$;

create or replace function public.rankball_same_court_location(
  a_address_text text,
  a_road_address text,
  a_jibun_address text,
  a_lat double precision,
  a_lng double precision,
  b_address_text text,
  b_road_address text,
  b_jibun_address text,
  b_lat double precision,
  b_lng double precision
)
returns boolean
language sql
immutable
as $$
  with address_keys as (
    select
      array_remove(array[
        nullif(public.rankball_court_address_key(a_address_text), ''),
        nullif(public.rankball_court_address_key(a_road_address), ''),
        nullif(public.rankball_court_address_key(a_jibun_address), '')
      ], null) as a_keys,
      array_remove(array[
        nullif(public.rankball_court_address_key(b_address_text), ''),
        nullif(public.rankball_court_address_key(b_road_address), ''),
        nullif(public.rankball_court_address_key(b_jibun_address), '')
      ], null) as b_keys
  )
  select
    coalesce(a_keys && b_keys, false)
    or (
      a_lat is not null and a_lng is not null and b_lat is not null and b_lng is not null
      and 6371000 * 2 * asin(sqrt(least(1.0,
        power(sin(radians(b_lat - a_lat) / 2), 2)
        + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)
      ))) <= 35
    )
  from address_keys;
$$;

create or replace function public.rankball_enforce_court_request_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name);
  court_unit text := nullif(public.rankball_court_name_key(new.payload->>'courtUnit'), '');
  same_location_exists boolean;
begin
  if new.status not in ('pending', 'reported') then
    return new;
  end if;

  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    new.payload->>'canonicalBaseName', new.payload->>'courtUnit'
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    old.payload->>'canonicalBaseName', old.payload->>'courtUnit'
  ) then
    return new;
  end if;

  select exists (
    select 1
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
    union all
    select 1
    from public.court_requests request
    where request.id <> new.id
      and request.status in ('pending', 'reported')
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        request.address_text, request.road_address, request.jibun_address, request.lat, request.lng
      )
  ) into same_location_exists;

  if same_location_exists and court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and public.rankball_court_name_key(coalesce(court.payload->>'canonicalBaseName', court.payload->>'baseName', court.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
  ) then
    raise exception 'duplicate_approved_court' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.court_requests request
    where request.id <> new.id
      and request.status in ('pending', 'reported')
      and public.rankball_court_name_key(coalesce(request.payload->>'canonicalBaseName', request.payload->>'baseName', request.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        request.address_text, request.road_address, request.jibun_address, request.lat, request.lng
      )
  ) then
    raise exception 'duplicate_pending_court_request' using errcode = '23505';
  end if;

  return new;
end;
$$;

create or replace function public.rankball_enforce_approved_court_identity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  canonical_name text := coalesce(new.payload->>'canonicalBaseName', new.payload->>'baseName', new.name);
  court_unit text := nullif(public.rankball_court_name_key(new.payload->>'courtUnit'), '');
  same_location_exists boolean;
begin
  if coalesce(new.status, 'active') <> 'active' then
    return new;
  end if;

  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    new.payload->>'canonicalBaseName', new.payload->>'courtUnit'
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    old.payload->>'canonicalBaseName', old.payload->>'courtUnit'
  ) then
    return new;
  end if;

  select exists (
    select 1
    from public.approved_courts court
    where court.id <> new.id
      and coalesce(court.status, 'active') = 'active'
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
  ) into same_location_exists;

  if same_location_exists and court_unit is null then
    raise exception 'court_unit_required_for_shared_location' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.approved_courts court
    where court.id <> new.id
      and coalesce(court.status, 'active') = 'active'
      and public.rankball_court_name_key(coalesce(court.payload->>'canonicalBaseName', court.payload->>'baseName', court.name))
        = public.rankball_court_name_key(canonical_name)
      and public.rankball_same_court_location(
        new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
        court.address_text, court.road_address, court.jibun_address, court.lat, court.lng
      )
  ) then
    raise exception 'court_duplicate' using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists court_requests_identity_guard on public.court_requests;
create trigger court_requests_identity_guard
before insert or update on public.court_requests
for each row execute function public.rankball_enforce_court_request_identity();

drop trigger if exists approved_courts_identity_guard on public.approved_courts;
create trigger approved_courts_identity_guard
before insert or update on public.approved_courts
for each row execute function public.rankball_enforce_approved_court_identity();

create or replace function public.rankball_court_rating_rows()
returns table (
  review_id text,
  court_id text,
  court_name text,
  raw_rating double precision,
  adjusted_rating double precision,
  memo text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with active_reviews as (
    select id, court_id, court_name, reviewer_id, rating::double precision as rating, memo, created_at, updated_at
    from public.court_reviews
    where coalesce(status, 'active') = 'active'
  ),
  global_stats as (
    select
      coalesce(avg(rating), 3.5)::double precision as global_mean,
      greatest(coalesce(stddev_pop(rating), 1.0), 0.75)::double precision as global_deviation
    from active_reviews
  ),
  reviewer_stats as (
    select
      reviewer_id,
      count(*)::double precision as sample_count,
      avg(rating)::double precision as reviewer_mean,
      coalesce(stddev_pop(rating), 0)::double precision as reviewer_deviation
    from active_reviews
    group by reviewer_id
  ),
  calibrated as (
    select
      review.id,
      review.court_id,
      review.court_name,
      review.rating,
      review.memo,
      review.created_at,
      review.updated_at,
      global.global_mean,
      global.global_deviation,
      ((stats.sample_count * stats.reviewer_mean) + (5 * global.global_mean)) / (stats.sample_count + 5) as shrunk_mean,
      greatest(
        sqrt(
          ((stats.sample_count * power(stats.reviewer_deviation, 2)) + (5 * power(global.global_deviation, 2)))
          / (stats.sample_count + 5)
        ),
        0.65
      ) as shrunk_deviation
    from active_reviews review
    join reviewer_stats stats on stats.reviewer_id = review.reviewer_id
    cross join global_stats global
  )
  select
    id,
    calibrated.court_id,
    calibrated.court_name,
    rating,
    greatest(
      1.0,
      least(5.0, global_mean + (((rating - shrunk_mean) / shrunk_deviation) * global_deviation))
    )::double precision,
    calibrated.memo,
    calibrated.created_at,
    calibrated.updated_at
  from calibrated;
$$;

revoke all on function public.rankball_court_rating_rows() from public;
revoke all on function public.rankball_court_rating_rows() from anon;
revoke all on function public.rankball_court_rating_rows() from authenticated;
grant execute on function public.rankball_court_rating_rows() to service_role;

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
  if safe_court_id is null then
    return;
  end if;

  select name
  into safe_court_name
  from public.approved_courts
  where id = safe_court_id
    and coalesce(status, 'active') = 'active';

  if safe_court_name is null then
    return;
  end if;

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
    or public.rankball_court_name_key(court_name) = public.rankball_court_name_key(safe_court_name);

  select count(*)::integer
  into safe_completed_match_count
  from public.matches
  where (
      court_id = safe_court_id
      or public.rankball_court_name_key(court_name) = public.rankball_court_name_key(safe_court_name)
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
        or public.rankball_court_name_key(review.court_name) = public.rankball_court_name_key(safe_court_name)
      )
      and nullif(btrim(review.memo), '') is not null
    order by coalesce(review.updated_at, review.created_at) desc
    limit 3
  ) recent;

  adjusted_average := greatest(1.0, least(5.0, coalesce(adjusted_average, global_mean)));
  safe_recommendation_score := adjusted_average + least(0.8, ln(1 + safe_completed_match_count) * 0.2);

  update public.approved_courts
  set
    raw_rating = case when safe_review_count > 0 then round(raw_average::numeric, 2) else null end,
    adjusted_rating = round(adjusted_average::numeric, 2),
    review_count = safe_review_count,
    completed_match_count = safe_completed_match_count,
    recommendation_score = round(safe_recommendation_score::numeric, 3),
    recent_reviews = safe_recent_reviews,
    metrics_updated_at = now()
  where id = safe_court_id;
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
    select id from public.approved_courts where coalesce(status, 'active') = 'active'
  loop
    perform public.rankball_refresh_court_metrics(court_row.id);
    refreshed_count := refreshed_count + 1;
  end loop;
  return refreshed_count;
end;
$$;

revoke all on function public.rankball_refresh_court_metrics(text) from public;
revoke all on function public.rankball_refresh_court_metrics(text) from anon;
revoke all on function public.rankball_refresh_court_metrics(text) from authenticated;
grant execute on function public.rankball_refresh_court_metrics(text) to service_role;
revoke all on function public.rankball_refresh_all_court_metrics() from public;
revoke all on function public.rankball_refresh_all_court_metrics() from anon;
revoke all on function public.rankball_refresh_all_court_metrics() from authenticated;
grant execute on function public.rankball_refresh_all_court_metrics() to service_role;

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
    and (
      court.id = nullif(btrim(p_court_id), '')
      or (
        nullif(btrim(p_court_name), '') is not null
        and public.rankball_court_name_key(court.name) = public.rankball_court_name_key(p_court_name)
      )
    )
  order by (court.id = nullif(btrim(p_court_id), '')) desc, court.created_at asc
  limit 1;
$$;

revoke all on function public.rankball_resolve_approved_court_id(text, text) from public;
revoke all on function public.rankball_resolve_approved_court_id(text, text) from anon;
revoke all on function public.rankball_resolve_approved_court_id(text, text) from authenticated;
grant execute on function public.rankball_resolve_approved_court_id(text, text) to service_role;

create or replace function public.rankball_refresh_court_metrics_after_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.rankball_refresh_all_court_metrics();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.rankball_refresh_court_metrics_after_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved_court_id text;
begin
  if tg_op = 'UPDATE'
    and row(new.court_id, new.court_name, new.status, new.ended_at, new.confirmed_at)
      is not distinct from row(old.court_id, old.court_name, old.status, old.ended_at, old.confirmed_at) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    resolved_court_id := public.rankball_resolve_approved_court_id(old.court_id, old.court_name);
    perform public.rankball_refresh_court_metrics(resolved_court_id);
    return old;
  end if;
  if tg_op = 'INSERT' then
    resolved_court_id := public.rankball_resolve_approved_court_id(new.court_id, new.court_name);
    perform public.rankball_refresh_court_metrics(resolved_court_id);
    return new;
  end if;
  if row(new.court_id, new.court_name) is distinct from row(old.court_id, old.court_name) then
    resolved_court_id := public.rankball_resolve_approved_court_id(old.court_id, old.court_name);
    perform public.rankball_refresh_court_metrics(resolved_court_id);
  end if;
  resolved_court_id := public.rankball_resolve_approved_court_id(new.court_id, new.court_name);
  perform public.rankball_refresh_court_metrics(resolved_court_id);
  return new;
end;
$$;

drop trigger if exists court_reviews_metrics_refresh on public.court_reviews;
create trigger court_reviews_metrics_refresh
after insert or update or delete on public.court_reviews
for each row execute function public.rankball_refresh_court_metrics_after_review();

drop trigger if exists matches_court_metrics_refresh on public.matches;
create trigger matches_court_metrics_refresh
after insert or update of court_id, court_name, status, ended_at, confirmed_at or delete on public.matches
for each row execute function public.rankball_refresh_court_metrics_after_match();

select public.rankball_refresh_all_court_metrics();

select pg_notify('pgrst', 'reload schema');
