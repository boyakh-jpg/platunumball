do $migration$
begin
  if to_regprocedure('public.rankball_create_tournament_match_locked_unguarded(text,text,text,integer,integer,text)') is null then
    alter function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text)
      rename to rankball_create_tournament_match_locked_unguarded;
  end if;
end;
$migration$;

create or replace function public.rankball_create_tournament_match_locked(
  p_tournament_id text,
  p_team_a_id text,
  p_team_b_id text,
  p_round integer,
  p_fixture integer,
  p_preferred_match_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_tournament_id text := nullif(btrim(p_tournament_id), '');
  safe_match_id text;
  existing_match public.matches%rowtype;
begin
  if safe_tournament_id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));
  safe_match_id := public.rankball_tournament_match_id(
    safe_tournament_id,
    p_round,
    p_fixture,
    p_preferred_match_id
  );
  perform pg_advisory_xact_lock(hashtext('rankball:tournament-match-id'), hashtext(safe_match_id));

  select * into existing_match
  from public.matches
  where id = safe_match_id
  for update;

  if found then
    if existing_match.tournament_id is distinct from safe_tournament_id
       or existing_match.tournament_round is distinct from p_round
       or existing_match.tournament_fixture is distinct from p_fixture then
      raise exception 'tournament_preferred_match_id_conflict' using errcode = '23514';
    end if;

    return jsonb_build_object(
      'id', existing_match.id,
      'tournamentId', existing_match.tournament_id,
      'round', existing_match.tournament_round,
      'fixture', existing_match.tournament_fixture,
      'teamAId', existing_match.team_a_id,
      'teamBId', existing_match.team_b_id,
      'rosterPending', true
    );
  end if;

  return public.rankball_create_tournament_match_locked_unguarded(
    safe_tournament_id,
    p_team_a_id,
    p_team_b_id,
    p_round,
    p_fixture,
    p_preferred_match_id
  );
end;
$$;

revoke all on function public.rankball_create_tournament_match_locked_unguarded(text, text, text, integer, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text)
  to service_role;
