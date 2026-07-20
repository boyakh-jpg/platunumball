create or replace function public.rankball_moderate_team_emblem_guarded(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_report_id text,
  p_reason text default null,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.reports%rowtype;
  team_row public.teams%rowtype;
  reported_emblem_key text;
begin
  select * into report_row
  from public.reports
  where id = btrim(coalesce(p_report_id, ''))
  for update;

  if report_row.id is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if report_row.type <> 'team_emblem' then
    raise exception 'team_emblem_report_required' using errcode = '22023';
  end if;

  select * into team_row
  from public.teams
  where id = report_row.target_id
    and deleted_at is null
  for update;

  if team_row.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;

  reported_emblem_key := nullif(btrim(coalesce(report_row.payload->>'emblemKey', '')), '');
  if reported_emblem_key is null or team_row.emblem_key is distinct from reported_emblem_key then
    raise exception 'team_emblem_report_stale' using errcode = '40001';
  end if;

  return public.rankball_moderate_team_emblem(
    p_actor_profile_id,
    p_actor_admin_level,
    p_report_id,
    p_reason,
    p_feedback
  );
end;
$$;

revoke all on function public.rankball_moderate_team_emblem_guarded(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_moderate_team_emblem_guarded(text, integer, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
