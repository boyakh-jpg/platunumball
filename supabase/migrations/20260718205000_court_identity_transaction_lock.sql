create or replace function public.rankball_lock_court_identity_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and row(
    new.name, new.address_text, new.road_address, new.jibun_address, new.lat, new.lng,
    new.payload->>'canonicalBaseName', new.payload->>'courtUnit'
  ) is not distinct from row(
    old.name, old.address_text, old.road_address, old.jibun_address, old.lat, old.lng,
    old.payload->>'canonicalBaseName', old.payload->>'courtUnit'
  ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball:court-identity-write', 0));
  return new;
end;
$$;

drop trigger if exists court_requests_00_identity_lock on public.court_requests;
create trigger court_requests_00_identity_lock
before insert or update of name, address_text, road_address, jibun_address, lat, lng, payload on public.court_requests
for each row execute function public.rankball_lock_court_identity_write();

drop trigger if exists approved_courts_00_identity_lock on public.approved_courts;
create trigger approved_courts_00_identity_lock
before insert or update of name, address_text, road_address, jibun_address, lat, lng, payload on public.approved_courts
for each row execute function public.rankball_lock_court_identity_write();

drop trigger if exists courts_00_identity_lock on public.courts;
create trigger courts_00_identity_lock
before insert or update of name, address_text, road_address, jibun_address, lat, lng, payload on public.courts
for each row execute function public.rankball_lock_court_identity_write();

