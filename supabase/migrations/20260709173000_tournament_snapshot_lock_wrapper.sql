create or replace function public.rankball_persist_tournament_snapshot_locked(
  p_tournament_row jsonb,
  p_team_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_tournament_id text := nullif(btrim(p_tournament_row->>'id'), '');
  persist_result jsonb;
begin
  if safe_tournament_id is null then
    raise exception 'missing_tournament_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));

  persist_result := public.rankball_persist_tournament_snapshot(
    p_tournament_row,
    p_team_rows,
    p_notification_rows
  );

  return persist_result || jsonb_build_object('locked', true);
end;
$$;

revoke all on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) from public;
grant execute on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
