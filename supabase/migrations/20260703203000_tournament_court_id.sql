alter table public.tournaments
  add column if not exists court_id text;

create index if not exists tournaments_court_id_idx
on public.tournaments (court_id)
where court_id is not null;

create or replace function public.rankball_tournament_court_snapshot_guard()
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

drop trigger if exists rankball_tournaments_court_snapshot_guard on public.tournaments;
create trigger rankball_tournaments_court_snapshot_guard
before insert or update of court_id, court_name, region on public.tournaments
for each row execute function public.rankball_tournament_court_snapshot_guard();

update public.tournaments
set court_name = court_name
where nullif(btrim(court_name), '') is not null
  and court_id is null;
