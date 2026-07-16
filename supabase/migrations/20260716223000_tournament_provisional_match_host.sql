-- Unclaimed tournament matches show the first pairing team as the provisional A-side host.
-- The first valid roster save can still swap sides and lock the actual host.

create or replace function public.rankball_assign_tournament_provisional_host()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  organizer_id text;
  provisional_host_id text;
begin
  if new.tournament_id is null
     or new.team_a_id is null
     or coalesce((new.rules->>'tournamentSideAssignmentLocked')::boolean, false) then
    return new;
  end if;

  select member_row.user_id
  into provisional_host_id
  from public.team_members member_row
  where member_row.team_id = new.team_a_id
    and member_row.role = 'captain'
  order by member_row.user_id
  limit 1;

  if provisional_host_id is null then
    return new;
  end if;

  organizer_id := coalesce(
    nullif(btrim(new.rules->>'tournamentOrganizerId'), ''),
    new.created_by
  );
  new.created_by := provisional_host_id;
  new.rules := coalesce(new.rules, '{}'::jsonb) || jsonb_build_object(
    'tournamentOrganizerId', organizer_id,
    'tournamentProvisionalHostTeamId', new.team_a_id,
    'tournamentProvisionalHostPlayerId', provisional_host_id
  );
  return new;
end;
$$;

drop trigger if exists rankball_matches_tournament_provisional_host_insert on public.matches;
create trigger rankball_matches_tournament_provisional_host_insert
before insert on public.matches
for each row execute function public.rankball_assign_tournament_provisional_host();

with provisional_hosts as (
  select
    match_row.id as match_id,
    match_row.team_a_id,
    match_row.created_by as organizer_id,
    captain.user_id as host_player_id
  from public.matches match_row
  join lateral (
    select member_row.user_id
    from public.team_members member_row
    where member_row.team_id = match_row.team_a_id
      and member_row.role = 'captain'
    order by member_row.user_id
    limit 1
  ) captain on true
  where match_row.tournament_id is not null
    and match_row.team_a_id is not null
    and coalesce((match_row.rules->>'tournamentSideAssignmentLocked')::boolean, false) = false
    and coalesce((match_row.rules #>> '{rosterReady,teamA}')::boolean, false) = false
    and coalesce((match_row.rules #>> '{rosterReady,teamB}')::boolean, false) = false
)
update public.matches match_row
set created_by = provisional.host_player_id,
    rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
      'tournamentOrganizerId', coalesce(
        nullif(btrim(match_row.rules->>'tournamentOrganizerId'), ''),
        provisional.organizer_id
      ),
      'tournamentProvisionalHostTeamId', provisional.team_a_id,
      'tournamentProvisionalHostPlayerId', provisional.host_player_id
    ),
    updated_at = now()
from provisional_hosts provisional
where match_row.id = provisional.match_id;

revoke all on function public.rankball_assign_tournament_provisional_host() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
