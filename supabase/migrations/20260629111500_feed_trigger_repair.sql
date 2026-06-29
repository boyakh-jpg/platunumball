create or replace function public.rankball_refresh_recruiting_feed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rankball_refresh_recruiting_feed_for_post(old.id);
    return old;
  end if;

  perform public.rankball_refresh_recruiting_feed_for_post(new.id);
  return new;
end;
$$;

create or replace function public.rankball_refresh_recruiting_application_feed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rankball_refresh_recruiting_feed_for_post(old.post_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.post_id is distinct from new.post_id then
    perform public.rankball_refresh_recruiting_feed_for_post(old.post_id);
  end if;

  perform public.rankball_refresh_recruiting_feed_for_post(new.post_id);
  return new;
end;
$$;

create or replace function public.rankball_refresh_match_feed_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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

create or replace function public.rankball_refresh_profile_feed_dependency(p_profile_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  row_id text;
begin
  if safe_profile_id is null then
    return;
  end if;

  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in
      select id
      from public.recruiting_posts
      where player_id = safe_profile_id
        or room_state->>'ownerId' = safe_profile_id
        or exists (
          select 1
          from public.rankball_room_state_participant_ids(room_state) room_profile
          where room_profile.profile_id = safe_profile_id
        )
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;
end;
$$;

create or replace function public.rankball_refresh_team_feed_dependency(p_team_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_team_id text := nullif(btrim(p_team_id), '');
  row_id text;
begin
  if safe_team_id is null then
    return;
  end if;

  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in
      select id
      from public.recruiting_posts
      where team_id = safe_team_id
        or target_team_id = safe_team_id
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null
    and to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
    for row_id in
      select id
      from public.matches
      where team_a_id = safe_team_id
        or team_b_id = safe_team_id
    loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;
end;
$$;

create or replace function public.rankball_refresh_court_feed_dependency(p_court_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  row_id text;
begin
  if safe_court_id is null then
    return;
  end if;

  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in
      select id
      from public.recruiting_posts
      where court_id = safe_court_id
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null
    and to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
    for row_id in
      select id
      from public.matches
      where court_id = safe_court_id
    loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;
end;
$$;

create or replace function public.rankball_refresh_profile_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rankball_refresh_profile_feed_dependency(old.id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    perform public.rankball_refresh_profile_feed_dependency(old.id);
  end if;

  perform public.rankball_refresh_profile_feed_dependency(new.id);
  return new;
end;
$$;

create or replace function public.rankball_refresh_team_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rankball_refresh_team_feed_dependency(old.id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    perform public.rankball_refresh_team_feed_dependency(old.id);
  end if;

  perform public.rankball_refresh_team_feed_dependency(new.id);
  return new;
end;
$$;

create or replace function public.rankball_refresh_court_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rankball_refresh_court_feed_dependency(old.id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    perform public.rankball_refresh_court_feed_dependency(old.id);
  end if;

  perform public.rankball_refresh_court_feed_dependency(new.id);
  return new;
end;
$$;

create or replace function public.rankball_refresh_team_member_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rankball_refresh_team_feed_dependency(old.team_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.team_id is distinct from new.team_id then
    perform public.rankball_refresh_team_feed_dependency(old.team_id);
  end if;

  perform public.rankball_refresh_team_feed_dependency(new.team_id);
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

do $$
declare
  has_recruiting_refresh boolean := to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null;
  has_match_refresh boolean := to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null;
begin
  if has_recruiting_refresh and to_regclass('public.recruiting_posts') is not null then
    execute 'drop trigger if exists rankball_recruiting_posts_feed_refresh on public.recruiting_posts';
    execute 'create trigger rankball_recruiting_posts_feed_refresh after insert or update or delete on public.recruiting_posts for each row execute function public.rankball_refresh_recruiting_feed_trigger()';
  end if;

  if has_recruiting_refresh and to_regclass('public.recruiting_applications') is not null then
    execute 'drop trigger if exists rankball_recruiting_applications_feed_refresh on public.recruiting_applications';
    execute 'create trigger rankball_recruiting_applications_feed_refresh after insert or update or delete on public.recruiting_applications for each row execute function public.rankball_refresh_recruiting_application_feed_trigger()';
  end if;

  if has_match_refresh and to_regclass('public.matches') is not null then
    execute 'drop trigger if exists rankball_matches_feed_refresh on public.matches';
    execute 'create trigger rankball_matches_feed_refresh after insert or update or delete on public.matches for each row execute function public.rankball_refresh_match_feed_trigger()';
  end if;

  if has_match_refresh and to_regclass('public.match_players') is not null then
    execute 'drop trigger if exists rankball_match_players_feed_refresh on public.match_players';
    execute 'create trigger rankball_match_players_feed_refresh after insert or update or delete on public.match_players for each row execute function public.rankball_refresh_match_player_feed_trigger()';
  end if;

  if has_match_refresh and to_regclass('public.match_agreements') is not null then
    execute 'drop trigger if exists rankball_match_agreements_feed_refresh on public.match_agreements';
    execute 'create trigger rankball_match_agreements_feed_refresh after insert or update or delete on public.match_agreements for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if has_match_refresh and to_regclass('public.match_approvals') is not null then
    execute 'drop trigger if exists rankball_match_approvals_feed_refresh on public.match_approvals';
    execute 'create trigger rankball_match_approvals_feed_refresh after insert or update or delete on public.match_approvals for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if has_match_refresh and to_regclass('public.match_disputes') is not null then
    execute 'drop trigger if exists rankball_match_disputes_feed_refresh on public.match_disputes';
    execute 'create trigger rankball_match_disputes_feed_refresh after insert or update or delete on public.match_disputes for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.team_members') is not null then
    execute 'drop trigger if exists rankball_team_members_feed_dependency_refresh on public.team_members';
    execute 'create trigger rankball_team_members_feed_dependency_refresh after insert or update of team_id or delete on public.team_members for each row execute function public.rankball_refresh_team_member_feed_dependency_trigger()';
  end if;

  if has_match_refresh and to_regclass('public.match_results') is not null then
    execute 'drop trigger if exists rankball_match_results_feed_refresh on public.match_results';
    execute 'create trigger rankball_match_results_feed_refresh after insert or update or delete on public.match_results for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if has_match_refresh and to_regclass('public.player_match_stats') is not null then
    execute 'drop trigger if exists rankball_player_match_stats_feed_refresh on public.player_match_stats';
    execute 'create trigger rankball_player_match_stats_feed_refresh after insert or update or delete on public.player_match_stats for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists rankball_profiles_feed_dependency_refresh on public.profiles';
    execute 'create trigger rankball_profiles_feed_dependency_refresh after insert or update of id, name or delete on public.profiles for each row execute function public.rankball_refresh_profile_feed_dependency_trigger()';
  end if;

  if to_regclass('public.teams') is not null then
    execute 'drop trigger if exists rankball_teams_feed_dependency_refresh on public.teams';
    execute 'create trigger rankball_teams_feed_dependency_refresh after insert or update of id, name, deleted_at or delete on public.teams for each row execute function public.rankball_refresh_team_feed_dependency_trigger()';
  end if;

  if to_regclass('public.approved_courts') is not null then
    execute 'drop trigger if exists rankball_approved_courts_feed_dependency_refresh on public.approved_courts';
    execute 'create trigger rankball_approved_courts_feed_dependency_refresh after insert or update of id, name, status or delete on public.approved_courts for each row execute function public.rankball_refresh_court_feed_dependency_trigger()';
  end if;
end;
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in select id from public.recruiting_posts loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null
    and to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
    for row_id in select id from public.matches loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;
end;
$$;

create or replace function public.rankball_feed_trigger_health()
returns table(trigger_name text, event_object_table text)
language sql
security definer
set search_path = public
as $$
  select
    trigger_row.trigger_name::text,
    trigger_row.event_object_table::text
  from information_schema.triggers as trigger_row
  where trigger_row.trigger_schema = 'public'
    and trigger_row.trigger_name = any(array[
      'rankball_recruiting_posts_feed_refresh',
      'rankball_recruiting_applications_feed_refresh',
      'rankball_matches_feed_refresh',
      'rankball_match_players_feed_refresh',
      'rankball_match_agreements_feed_refresh',
      'rankball_match_approvals_feed_refresh',
      'rankball_match_disputes_feed_refresh',
      'rankball_team_members_feed_dependency_refresh',
      'rankball_match_results_feed_refresh',
      'rankball_player_match_stats_feed_refresh',
      'rankball_profiles_feed_dependency_refresh',
      'rankball_teams_feed_dependency_refresh',
      'rankball_approved_courts_feed_dependency_refresh'
    ])
  order by trigger_row.trigger_name;
$$;

revoke all on function public.rankball_feed_trigger_health() from public;
grant execute on function public.rankball_feed_trigger_health() to service_role;

select pg_notify('pgrst', 'reload schema');
