create or replace function public.rankball_cleanup_simulation_artifacts_exact(
  p_match_ids text[] default array[]::text[],
  p_tournament_ids text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_ids text[] := array[]::text[];
  safe_tournament_ids text[] := array[]::text[];
  affected_profile_ids text[] := array[]::text[];
  affected_court_ids text[] := array[]::text[];
  deleted_matches integer := 0;
  deleted_tournaments integer := 0;
  remaining_matches integer := 0;
  remaining_tournaments integer := 0;
begin
  select coalesce(array_agg(value order by value), array[]::text[])
  into safe_match_ids
  from (
    select distinct btrim(raw_value) as value
    from unnest(coalesce(p_match_ids, array[]::text[])) as raw(raw_value)
    where nullif(btrim(raw_value), '') is not null
  ) normalized;

  select coalesce(array_agg(value order by value), array[]::text[])
  into safe_tournament_ids
  from (
    select distinct btrim(raw_value) as value
    from unnest(coalesce(p_tournament_ids, array[]::text[])) as raw(raw_value)
    where nullif(btrim(raw_value), '') is not null
  ) normalized;

  if cardinality(safe_match_ids) > 10 then
    raise exception 'simulation_cleanup_match_batch_too_large' using errcode = '22023';
  end if;
  if cardinality(safe_tournament_ids) > 20 then
    raise exception 'simulation_cleanup_tournament_batch_too_large' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(safe_tournament_ids) as tournament_id
    where tournament_id not like 'sim_trn\_%' escape '\'
  ) then
    raise exception 'simulation_cleanup_tournament_id_required' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.matches match_row
    where match_row.id = any(safe_match_ids)
      and match_row.id not like 'sim_m\_%' escape '\'
      and coalesce(match_row.tournament_id, '') <> all(safe_tournament_ids)
      and coalesce(match_row.rules->>'recruitingPostId', '') not like 'sim_q\_%' escape '\'
  ) then
    raise exception 'simulation_cleanup_match_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:simulation-cleanup-exact'));

  select coalesce(array_agg(distinct player.user_id), array[]::text[])
  into affected_profile_ids
  from public.match_players player
  where player.match_id = any(safe_match_ids)
    and nullif(btrim(player.user_id), '') is not null;

  select coalesce(array_agg(distinct resolved_court_id), array[]::text[])
  into affected_court_ids
  from (
    select public.rankball_resolve_approved_court_id(match_row.court_id, match_row.court_name) as resolved_court_id
    from public.matches match_row
    where match_row.id = any(safe_match_ids)
  ) courts
  where resolved_court_id is not null;

  perform set_config('rankball.skip_derived_refresh', 'on', true);

  delete from public.discord_notification_deliveries delivery
  where delivery.notification_id in (
    select notification.id
    from public.notifications notification
    where notification.match_id = any(safe_match_ids)
       or notification.payload->>'matchId' = any(safe_match_ids)
  )
     or delivery.payload->>'matchId' = any(safe_match_ids);

  delete from public.notifications notification
  where notification.match_id = any(safe_match_ids)
     or notification.payload->>'matchId' = any(safe_match_ids);

  delete from public.user_room_feed
  where entity_type = 'match'
    and entity_id = any(safe_match_ids);
  delete from public.room_feed_cards
  where entity_type = 'match'
    and entity_id = any(safe_match_ids);
  delete from public.court_reviews where match_id = any(safe_match_ids);
  delete from public.match_disputes where match_id = any(safe_match_ids);
  delete from public.match_approvals where match_id = any(safe_match_ids);
  delete from public.match_agreements where match_id = any(safe_match_ids);
  delete from public.player_match_stats where match_id = any(safe_match_ids);
  delete from public.match_results where match_id = any(safe_match_ids);
  delete from public.match_players where match_id = any(safe_match_ids);
  delete from public.match_record_refresh_queue where match_id = any(safe_match_ids);
  delete from public.match_record_archives where match_id = any(safe_match_ids);

  delete from public.matches where id = any(safe_match_ids);
  get diagnostics deleted_matches = row_count;

  delete from public.user_room_feed
  where entity_type = 'match'
    and entity_id = any(safe_match_ids);
  delete from public.room_feed_cards
  where entity_type = 'match'
    and entity_id = any(safe_match_ids);
  delete from public.match_record_refresh_queue where match_id = any(safe_match_ids);
  delete from public.match_record_archives where match_id = any(safe_match_ids);

  delete from public.tournament_teams tournament_team
  where tournament_team.tournament_id = any(safe_tournament_ids)
    and not exists (
      select 1
      from public.matches match_row
      where match_row.tournament_id = tournament_team.tournament_id
    );
  delete from public.tournaments tournament
  where tournament.id = any(safe_tournament_ids)
    and not exists (
      select 1
      from public.matches match_row
      where match_row.tournament_id = tournament.id
    );
  get diagnostics deleted_tournaments = row_count;

  perform set_config('rankball.skip_derived_refresh', 'off', true);

  select count(*)
  into remaining_matches
  from public.matches
  where id = any(safe_match_ids);

  select count(*)
  into remaining_tournaments
  from public.tournaments
  where id = any(safe_tournament_ids);

  return jsonb_build_object(
    'ok', remaining_matches = 0,
    'deletedMatches', deleted_matches,
    'deletedTournaments', deleted_tournaments,
    'remainingMatches', remaining_matches,
    'remainingTournaments', remaining_tournaments,
    'affectedProfileIds', to_jsonb(affected_profile_ids),
    'affectedCourtIds', to_jsonb(affected_court_ids),
    'derivedRefreshSuppressed', true
  );
end;
$$;

revoke all on function public.rankball_cleanup_simulation_artifacts_exact(text[], text[]) from public, anon, authenticated;
grant execute on function public.rankball_cleanup_simulation_artifacts_exact(text[], text[]) to service_role;

select pg_notify('pgrst', 'reload schema');
