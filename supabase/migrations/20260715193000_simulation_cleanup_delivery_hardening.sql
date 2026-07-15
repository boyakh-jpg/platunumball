create index if not exists notifications_match_cleanup_idx
  on public.notifications (match_id)
  where match_id is not null;

create index if not exists notifications_recruiting_cleanup_idx
  on public.notifications (recruiting_post_id)
  where recruiting_post_id is not null;

create index if not exists discord_notification_deliveries_notification_idx
  on public.discord_notification_deliveries (notification_id)
  where notification_id is not null;

create or replace function public.rankball_cleanup_simulation_artifacts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  simulation_match_ids text[] := array[]::text[];
  simulation_tournament_ids text[] := array[]::text[];
  removable_tournament_ids text[] := array[]::text[];
  affected_profile_ids text[] := array[]::text[];
  affected_profile_id text;
  affected_rows integer := 0;
  deleted_matches integer := 0;
  deleted_tournaments integer := 0;
  deleted_notifications integer := 0;
  deleted_discord_deliveries integer := 0;
  remaining_matches integer := 0;
  remaining_tournaments integer := 0;
  remaining_notifications integer := 0;
  remaining_discord_deliveries integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:simulation-cleanup'));

  select coalesce(array_agg(id), array[]::text[])
  into simulation_tournament_ids
  from public.tournaments
  where id like 'sim_trn\_%' escape '\';

  select coalesce(array_agg(id), array[]::text[])
  into simulation_match_ids
  from (
    select id
    from public.matches
    where id like 'sim_m\_%' escape '\'
       or tournament_id = any(simulation_tournament_ids)
    order by created_at nulls first, id
    limit 100
  ) batch;

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
       or match_id like 'sim_m\_%' escape '\'
       or recruiting_post_id like 'sim_q\_%' escape '\'
       or payload->>'recruitingPostId' like 'sim_q\_%' escape '\'
       or payload->>'tournamentId' = any(simulation_tournament_ids)
       or payload->>'tournamentId' like 'sim_trn\_%' escape '\'
  );
  get diagnostics deleted_discord_deliveries = row_count;

  delete from public.discord_notification_deliveries
  where notification_id like '%sim_m\_%' escape '\'
     or notification_id like '%sim_q\_%' escape '\'
     or payload->>'notificationId' like '%sim_m\_%' escape '\'
     or payload->>'notificationId' like '%sim_q\_%' escape '\'
     or payload->>'matchId' like 'sim_m\_%' escape '\'
     or payload->>'recruitingPostId' like 'sim_q\_%' escape '\'
     or payload->>'tournamentId' like 'sim_trn\_%' escape '\';
  get diagnostics affected_rows = row_count;
  deleted_discord_deliveries := deleted_discord_deliveries + affected_rows;

  delete from public.notifications
  where match_id = any(simulation_match_ids)
     or match_id like 'sim_m\_%' escape '\'
     or recruiting_post_id like 'sim_q\_%' escape '\'
     or payload->>'recruitingPostId' like 'sim_q\_%' escape '\'
     or payload->>'tournamentId' = any(simulation_tournament_ids)
     or payload->>'tournamentId' like 'sim_trn\_%' escape '\';
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

  select coalesce(array_agg(tournament.id), array[]::text[])
  into removable_tournament_ids
  from public.tournaments tournament
  where tournament.id = any(simulation_tournament_ids)
    and not exists (
      select 1
      from public.matches match_row
      where match_row.tournament_id = tournament.id
    );

  delete from public.tournament_teams where tournament_id = any(removable_tournament_ids);
  delete from public.tournaments where id = any(removable_tournament_ids);
  get diagnostics deleted_tournaments = row_count;

  foreach affected_profile_id in array affected_profile_ids
  loop
    perform public.rankball_rebuild_profile_match_summary(affected_profile_id);
  end loop;

  select count(*)
  into remaining_matches
  from public.matches
  where id like 'sim_m\_%' escape '\'
     or tournament_id like 'sim_trn\_%' escape '\';

  select count(*)
  into remaining_tournaments
  from public.tournaments
  where id like 'sim_trn\_%' escape '\';

  select count(*)
  into remaining_notifications
  from public.notifications
  where match_id like 'sim_m\_%' escape '\'
     or recruiting_post_id like 'sim_q\_%' escape '\'
     or payload->>'recruitingPostId' like 'sim_q\_%' escape '\'
     or payload->>'tournamentId' like 'sim_trn\_%' escape '\';

  select count(*)
  into remaining_discord_deliveries
  from public.discord_notification_deliveries
  where notification_id like '%sim_m\_%' escape '\'
     or notification_id like '%sim_q\_%' escape '\'
     or payload->>'notificationId' like '%sim_m\_%' escape '\'
     or payload->>'notificationId' like '%sim_q\_%' escape '\'
     or payload->>'matchId' like 'sim_m\_%' escape '\'
     or payload->>'recruitingPostId' like 'sim_q\_%' escape '\'
     or payload->>'tournamentId' like 'sim_trn\_%' escape '\';

  return jsonb_build_object(
    'ok', true,
    'deletedMatches', deleted_matches,
    'deletedTournaments', deleted_tournaments,
    'deletedNotifications', deleted_notifications,
    'deletedDiscordDeliveries', deleted_discord_deliveries,
    'refreshedProfiles', cardinality(affected_profile_ids),
    'remainingMatches', remaining_matches,
    'remainingTournaments', remaining_tournaments,
    'remainingNotifications', remaining_notifications,
    'remainingDiscordDeliveries', remaining_discord_deliveries
  );
end;
$$;

revoke all on function public.rankball_cleanup_simulation_artifacts() from public;
grant execute on function public.rankball_cleanup_simulation_artifacts() to service_role;
