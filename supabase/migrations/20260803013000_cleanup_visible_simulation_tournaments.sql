-- Remove two interrupted backend-simulation tournaments still visible in production.

do $migration$
declare
  target_tournament_ids constant text[] := array[
    'sim_trn_tournament_bye_round_ms3bjpw4_2xio3d',
    'sim_trn_tournament_followup_round_ms3bjpw4_2xio3d'
  ];
  target_match_ids text[] := array[]::text[];
  cleanup_result jsonb;
begin
  select coalesce(array_agg(match_row.id order by match_row.id), array[]::text[])
  into target_match_ids
  from public.matches match_row
  where match_row.tournament_id = any(target_tournament_ids);

  if cardinality(target_match_ids) > 10 then
    raise exception 'visible_simulation_cleanup_match_batch_too_large' using errcode = '22023';
  end if;

  cleanup_result := public.rankball_cleanup_simulation_artifacts_exact(
    target_match_ids,
    target_tournament_ids
  );

  if not coalesce((cleanup_result->>'ok')::boolean, false)
    or coalesce((cleanup_result->>'remainingMatches')::integer, 0) <> 0
    or coalesce((cleanup_result->>'remainingTournaments')::integer, 0) <> 0 then
    raise exception 'visible_simulation_cleanup_incomplete' using errcode = '55000';
  end if;
end
$migration$;
