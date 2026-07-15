-- Tournament room ownership is an operational permission, not automatic participation.

update public.matches match_row
set rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
  'tournamentHostRosterSelected', exists (
    select 1
    from public.match_players player_row
    where player_row.match_id = match_row.id
      and player_row.user_id = nullif(btrim(match_row.rules->>'tournamentHostPlayerId'), '')
  )
),
updated_at = now()
where match_row.tournament_id is not null
  and nullif(btrim(match_row.rules->>'tournamentHostPlayerId'), '') is not null
  and not (coalesce(match_row.rules, '{}'::jsonb) ? 'tournamentHostRosterSelected');

create or replace function public.rankball_sync_tournament_host_roster_selected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  host_player_id text;
  host_selected boolean;
begin
  if new.tournament_id is null then
    return new;
  end if;

  host_player_id := nullif(btrim(new.rules->>'tournamentHostPlayerId'), '');
  if host_player_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.rules, '{}'::jsonb) ? 'tournamentHostRosterSelected'
       and new.reserve_players is not distinct from old.reserve_players
       and new.played_player_ids is not distinct from old.played_player_ids then
      new.rules := coalesce(new.rules, '{}'::jsonb) || jsonb_build_object(
        'tournamentHostRosterSelected', coalesce((old.rules->>'tournamentHostRosterSelected')::boolean, false)
      );
      return new;
    end if;
  end if;

  host_selected := coalesce(new.reserve_players->'teamA', '[]'::jsonb) ? host_player_id
    or coalesce(new.reserve_players->'teamB', '[]'::jsonb) ? host_player_id
    or exists (
      select 1
      from public.match_players player_row
      where player_row.match_id = new.id
        and player_row.user_id = host_player_id
    );
  new.rules := coalesce(new.rules, '{}'::jsonb) || jsonb_build_object(
    'tournamentHostRosterSelected', host_selected
  );
  return new;
end;
$$;

drop trigger if exists rankball_matches_tournament_host_roster_selected_insert on public.matches;
create trigger rankball_matches_tournament_host_roster_selected_insert
before insert on public.matches
for each row execute function public.rankball_sync_tournament_host_roster_selected();

drop trigger if exists rankball_matches_tournament_host_roster_selected_update on public.matches;
create trigger rankball_matches_tournament_host_roster_selected_update
before update of reserve_players, played_player_ids, rules on public.matches
for each row execute function public.rankball_sync_tournament_host_roster_selected();

revoke all on function public.rankball_sync_tournament_host_roster_selected() from public, anon, authenticated;
