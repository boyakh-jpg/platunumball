revoke all on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) from public;
revoke all on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) from anon;
revoke all on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) to service_role;
