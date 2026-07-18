create or replace function public.rankball_court_detail_review_rows(
  p_court_id text,
  p_court_name text,
  p_limit integer default 50
)
returns table (
  review_id text,
  court_id text,
  court_name text,
  match_id text,
  reviewer_id text,
  raw_rating double precision,
  adjusted_rating double precision,
  surface_rating integer,
  rim_rating integer,
  lighting_rating integer,
  crowd_rating integer,
  location_accuracy integer,
  fit_modes jsonb,
  tags jsonb,
  memo text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    calibrated.review_id,
    review.court_id,
    review.court_name,
    review.match_id,
    review.reviewer_id,
    calibrated.raw_rating,
    calibrated.adjusted_rating,
    review.surface_rating,
    review.rim_rating,
    review.lighting_rating,
    review.crowd_rating,
    review.location_accuracy,
    coalesce(review.fit_modes, '[]'::jsonb),
    coalesce(review.tags, '[]'::jsonb),
    review.memo,
    review.created_at,
    review.updated_at
  from public.rankball_court_rating_rows() calibrated
  join public.court_reviews review on review.id = calibrated.review_id
  where coalesce(review.status, 'active') = 'active'
    and (
      review.court_id = nullif(btrim(p_court_id), '')
      or (
        nullif(btrim(p_court_name), '') is not null
        and public.rankball_court_name_key(review.court_name) = public.rankball_court_name_key(p_court_name)
      )
    )
  order by coalesce(review.updated_at, review.created_at) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.rankball_court_detail_review_rows(text, text, integer) from public;
revoke all on function public.rankball_court_detail_review_rows(text, text, integer) from anon;
revoke all on function public.rankball_court_detail_review_rows(text, text, integer) from authenticated;
grant execute on function public.rankball_court_detail_review_rows(text, text, integer) to service_role;

create or replace function public.rankball_court_reviewable_matches(
  actor_profile_id text,
  p_court_id text,
  p_court_name text,
  p_limit integer default 50
)
returns table (
  id text,
  title text,
  status text,
  scheduled_at text,
  scheduled_date date,
  scheduled_time time,
  ended_at timestamptz,
  confirmed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    match.id,
    match.title,
    match.status,
    match.scheduled_at,
    match.scheduled_date,
    match.scheduled_time,
    match.ended_at,
    match.confirmed_at
  from public.matches match
  where exists (
      select 1
      from public.match_players player
      where player.match_id = match.id
        and player.user_id = actor_profile_id
    )
    and match.status not in ('void', 'cancelled')
    and (match.ended_at is not null or match.status in ('approval', 'disputed', 'confirmed'))
    and (
      match.court_id = nullif(btrim(p_court_id), '')
      or (
        nullif(btrim(p_court_name), '') is not null
        and public.rankball_court_name_key(match.court_name) = public.rankball_court_name_key(p_court_name)
      )
    )
  order by coalesce(match.ended_at, match.confirmed_at, match.created_at) desc,
    match.scheduled_date desc nulls last,
    match.scheduled_time desc nulls last
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

revoke all on function public.rankball_court_reviewable_matches(text, text, text, integer) from public;
revoke all on function public.rankball_court_reviewable_matches(text, text, text, integer) from anon;
revoke all on function public.rankball_court_reviewable_matches(text, text, text, integer) from authenticated;
grant execute on function public.rankball_court_reviewable_matches(text, text, text, integer) to service_role;
