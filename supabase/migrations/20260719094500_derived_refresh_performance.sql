create or replace function public.rankball_refresh_match_feed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.rankball_refresh_match_feed_for_match(old.id);
    return old;
  end if;

  perform public.rankball_refresh_match_feed_for_match(new.id);
  return new;
end;
$$;

create or replace function public.rankball_refresh_match_player_feed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.rankball_refresh_match_feed_for_match(old.match_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.match_id is distinct from new.match_id then
    perform public.rankball_refresh_match_feed_for_match(old.match_id);
  end if;

  perform public.rankball_refresh_match_feed_for_match(new.match_id);
  return new;
end;
$$;

create or replace function public.rankball_refresh_match_record_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.rankball_refresh_match_feed_for_match(old.match_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.match_id is distinct from new.match_id then
    perform public.rankball_refresh_match_feed_for_match(old.match_id);
  end if;

  perform public.rankball_refresh_match_feed_for_match(new.match_id);
  return new;
end;
$$;

create or replace function public.rankball_profile_match_summary_by_match_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match_id text;
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'matches' then
    target_match_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    target_match_id := case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  end if;

  perform public.rankball_refresh_profile_match_summaries_for_match(target_match_id);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.rankball_profile_match_summary_by_player_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op in ('UPDATE', 'DELETE') and nullif(old.user_id, '') is not null and exists (
    select 1 from public.matches where id = old.match_id and status = 'confirmed'
  ) then
    perform public.rankball_rebuild_profile_match_summary(old.user_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE') and nullif(new.user_id, '') is not null and exists (
    select 1 from public.matches where id = new.match_id and status = 'confirmed'
  ) then
    perform public.rankball_rebuild_profile_match_summary(new.user_id);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.rankball_refresh_court_metrics_after_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform public.rankball_refresh_all_court_metrics();
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.rankball_refresh_court_metrics_after_match()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_counted boolean := false;
  new_counted boolean := false;
  resolved_court_id text;
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then
    old_counted := old.status = 'confirmed' and coalesce(old.ended_at, old.confirmed_at) is not null;
  end if;
  if tg_op <> 'DELETE' then
    new_counted := new.status = 'confirmed' and coalesce(new.ended_at, new.confirmed_at) is not null;
  end if;

  if tg_op = 'INSERT' then
    if not new_counted then return new; end if;
    resolved_court_id := public.rankball_resolve_approved_court_id(new.court_id, new.court_name);
    perform public.rankball_refresh_court_metrics(resolved_court_id);
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not old_counted then return old; end if;
    resolved_court_id := public.rankball_resolve_approved_court_id(old.court_id, old.court_name);
    perform public.rankball_refresh_court_metrics(resolved_court_id);
    return old;
  end if;

  if not old_counted and not new_counted then return new; end if;

  if old_counted and (
    not new_counted
    or row(old.court_id, old.court_name) is distinct from row(new.court_id, new.court_name)
  ) then
    resolved_court_id := public.rankball_resolve_approved_court_id(old.court_id, old.court_name);
    perform public.rankball_refresh_court_metrics(resolved_court_id);
  end if;

  if new_counted and (
    not old_counted
    or row(old.court_id, old.court_name) is distinct from row(new.court_id, new.court_name)
  ) then
    resolved_court_id := public.rankball_resolve_approved_court_id(new.court_id, new.court_name);
    perform public.rankball_refresh_court_metrics(resolved_court_id);
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_cleanup_simulation_artifacts_legacy()') is null then
    if to_regprocedure('public.rankball_cleanup_simulation_artifacts()') is null then
      raise exception 'rankball_cleanup_simulation_artifacts_missing' using errcode = '42883';
    end if;
    alter function public.rankball_cleanup_simulation_artifacts() rename to rankball_cleanup_simulation_artifacts_legacy;
  end if;
end;
$$;

create or replace function public.rankball_cleanup_simulation_artifacts()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_court_ids text[] := array[]::text[];
  affected_court_id text;
  cleanup_result jsonb;
begin
  select coalesce(array_agg(distinct resolved_court_id), array[]::text[])
  into affected_court_ids
  from (
    select public.rankball_resolve_approved_court_id(match_row.court_id, match_row.court_name) as resolved_court_id
    from public.matches match_row
    where match_row.id like 'sim_m\_%' escape '\'
       or match_row.tournament_id like 'sim_trn\_%' escape '\'
  ) courts
  where resolved_court_id is not null;

  perform set_config('rankball.skip_derived_refresh', 'on', true);
  cleanup_result := public.rankball_cleanup_simulation_artifacts_legacy();
  perform set_config('rankball.skip_derived_refresh', 'off', true);

  foreach affected_court_id in array affected_court_ids
  loop
    perform public.rankball_refresh_court_metrics(affected_court_id);
  end loop;

  return coalesce(cleanup_result, '{}'::jsonb) || jsonb_build_object(
    'refreshedCourts', cardinality(affected_court_ids),
    'derivedRefreshSuppressed', true
  );
end;
$$;

revoke all on function public.rankball_cleanup_simulation_artifacts_legacy() from public, anon, authenticated;
revoke all on function public.rankball_cleanup_simulation_artifacts() from public, anon, authenticated;
grant execute on function public.rankball_cleanup_simulation_artifacts_legacy() to service_role;
grant execute on function public.rankball_cleanup_simulation_artifacts() to service_role;

select pg_notify('pgrst', 'reload schema');
