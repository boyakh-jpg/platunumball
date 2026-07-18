drop index if exists public.approved_courts_address_identity_unique;

create unique index if not exists approved_courts_location_name_unique
on public.approved_courts (
  lower(regexp_replace(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text), '[[:space:]]+', '', 'g')),
  public.rankball_court_name_key(name)
)
where coalesce(status, 'active') = 'active';
