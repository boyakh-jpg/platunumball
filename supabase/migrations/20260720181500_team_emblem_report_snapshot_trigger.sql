create or replace function public.rankball_guard_team_emblem_moderation_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  expected_emblem_key text;
begin
  expected_emblem_key := nullif(current_setting('rankball.team_emblem_expected_key', true), '');
  if expected_emblem_key is not null and old.emblem_key is distinct from expected_emblem_key then
    raise exception 'team_emblem_report_stale' using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_team_emblem_moderation_snapshot_guard on public.teams;
create trigger rankball_team_emblem_moderation_snapshot_guard
before update of emblem_key on public.teams
for each row execute function public.rankball_guard_team_emblem_moderation_snapshot();

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
  reported_emblem_key text;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'team_emblem_moderation_permission_required' using errcode = '42501';
  end if;

  select * into report_row
  from public.reports
  where id = btrim(coalesce(p_report_id, ''));

  if report_row.id is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if report_row.type <> 'team_emblem' then
    raise exception 'team_emblem_report_required' using errcode = '22023';
  end if;

  reported_emblem_key := nullif(btrim(coalesce(report_row.payload->>'emblemKey', '')), '');
  if reported_emblem_key is null then
    raise exception 'team_emblem_report_stale' using errcode = '40001';
  end if;

  perform set_config('rankball.team_emblem_expected_key', reported_emblem_key, true);
  return public.rankball_moderate_team_emblem(
    p_actor_profile_id,
    p_actor_admin_level,
    p_report_id,
    p_reason,
    p_feedback
  );
end;
$$;

revoke all on function public.rankball_guard_team_emblem_moderation_snapshot() from public, anon, authenticated;
revoke all on function public.rankball_moderate_team_emblem_guarded(text, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_moderate_team_emblem_guarded(text, integer, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
