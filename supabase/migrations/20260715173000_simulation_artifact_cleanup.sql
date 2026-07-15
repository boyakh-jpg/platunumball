create or replace function public.rankball_cleanup_simulation_artifacts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  simulation_match_ids text[] := array[]::text[];
  simulation_tournament_ids text[] := array[]::text[];
  affected_profile_ids text[] := array[]::text[];
  affected_profile_id text;
  deleted_matches integer := 0;
  deleted_tournaments integer := 0;
  deleted_notifications integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:simulation-cleanup'));

  select coalesce(array_agg(id), array[]::text[])
  into simulation_tournament_ids
  from public.tournaments
  where id like 'sim_trn\_%' escape '\';

  select coalesce(array_agg(id), array[]::text[])
  into simulation_match_ids
  from public.matches
  where id like 'sim_m\_%' escape '\'
     or tournament_id = any(simulation_tournament_ids);

  select coalesce(array_agg(distinct user_id), array[]::text[])
  into affected_profile_ids
  from public.match_players
  where match_id = any(simulation_match_ids)
    and nullif(btrim(user_id), '') is not null;

  delete from public.discord_notification_deliveries
  where notification_id in (
    select id
    from public.notifications
    where match_id = any(simulation_match_ids)
       or payload->>'tournamentId' = any(simulation_tournament_ids)
  );

  delete from public.notifications
  where match_id = any(simulation_match_ids)
     or payload->>'tournamentId' = any(simulation_tournament_ids);
  get diagnostics deleted_notifications = row_count;

  delete from public.court_reviews where match_id = any(simulation_match_ids);
  delete from public.user_room_feed where entity_type = 'match' and entity_id = any(simulation_match_ids);
  delete from public.room_feed_cards where entity_type = 'match' and entity_id = any(simulation_match_ids);
  delete from public.match_disputes where match_id = any(simulation_match_ids);
  delete from public.match_approvals where match_id = any(simulation_match_ids);
  delete from public.match_agreements where match_id = any(simulation_match_ids);
  delete from public.player_match_stats where match_id = any(simulation_match_ids);
  delete from public.match_results where match_id = any(simulation_match_ids);
  delete from public.match_players where match_id = any(simulation_match_ids);

  delete from public.matches where id = any(simulation_match_ids);
  get diagnostics deleted_matches = row_count;

  delete from public.tournament_teams where tournament_id = any(simulation_tournament_ids);
  delete from public.tournaments where id = any(simulation_tournament_ids);
  get diagnostics deleted_tournaments = row_count;

  foreach affected_profile_id in array affected_profile_ids
  loop
    perform public.rankball_rebuild_profile_match_summary(affected_profile_id);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'deletedMatches', deleted_matches,
    'deletedTournaments', deleted_tournaments,
    'deletedNotifications', deleted_notifications,
    'refreshedProfiles', cardinality(affected_profile_ids)
  );
end;
$$;

revoke all on function public.rankball_cleanup_simulation_artifacts() from public;
grant execute on function public.rankball_cleanup_simulation_artifacts() to service_role;
