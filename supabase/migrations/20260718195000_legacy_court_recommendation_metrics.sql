alter table public.courts
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
    where conname = 'courts_metrics_nonnegative'
      and conrelid = 'public.courts'::regclass
  ) then
    alter table public.courts
      add constraint courts_metrics_nonnegative
      check (review_count >= 0 and completed_match_count >= 0) not valid;
  end if;
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
  with candidates as (
    select court.id, court.name, 0 as source_order, court.created_at
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
    union all
    select court.id, court.name, 1 as source_order, court.created_at
    from public.courts court
  )
  select court.id
  from candidates court
  where court.id = nullif(btrim(p_court_id), '')
    or (
      nullif(btrim(p_court_name), '') is not null
      and public.rankball_court_name_key(court.name) = public.rankball_court_name_key(p_court_name)
    )
  order by (court.id = nullif(btrim(p_court_id), '')) desc, court.source_order asc, court.created_at asc
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
  if safe_court_id is null then
    return;
  end if;

  select source.name
  into safe_court_name
  from (
    select court.name, 0 as source_order
    from public.approved_courts court
    where court.id = safe_court_id and coalesce(court.status, 'active') = 'active'
    union all
    select court.name, 1 as source_order
    from public.courts court
    where court.id = safe_court_id
  ) source
  order by source.source_order
  limit 1;

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
  where id = safe_court_id
    or public.rankball_court_name_key(name) = public.rankball_court_name_key(safe_court_name);

  update public.courts
  set
    raw_rating = case when safe_review_count > 0 then round(raw_average::numeric, 2) else null end,
    adjusted_rating = round(adjusted_average::numeric, 2),
    review_count = safe_review_count,
    completed_match_count = safe_completed_match_count,
    recommendation_score = round(safe_recommendation_score::numeric, 3),
    recent_reviews = safe_recent_reviews,
    metrics_updated_at = now()
  where id = safe_court_id
    or public.rankball_court_name_key(name) = public.rankball_court_name_key(safe_court_name);
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
    from (
      select id from public.approved_courts where coalesce(status, 'active') = 'active'
      union
      select id from public.courts
    ) court
  loop
    perform public.rankball_refresh_court_metrics(court_row.id);
    refreshed_count := refreshed_count + 1;
  end loop;
  return refreshed_count;
end;
$$;

revoke all on function public.rankball_resolve_approved_court_id(text, text) from public, anon, authenticated;
revoke all on function public.rankball_refresh_court_metrics(text) from public, anon, authenticated;
revoke all on function public.rankball_refresh_all_court_metrics() from public, anon, authenticated;
grant execute on function public.rankball_resolve_approved_court_id(text, text) to service_role;
grant execute on function public.rankball_refresh_court_metrics(text) to service_role;
grant execute on function public.rankball_refresh_all_court_metrics() to service_role;

select public.rankball_refresh_all_court_metrics();

select pg_notify('pgrst', 'reload schema');
