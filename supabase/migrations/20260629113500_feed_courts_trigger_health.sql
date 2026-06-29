do $$
begin
  if to_regclass('public.courts') is not null
    and to_regprocedure('public.rankball_refresh_court_feed_dependency_trigger()') is not null
    and not exists (
      select 1
      from information_schema.triggers
      where trigger_schema = 'public'
        and event_object_table = 'courts'
        and trigger_name = 'rankball_courts_feed_dependency_refresh'
    ) then
    execute 'create trigger rankball_courts_feed_dependency_refresh after insert or update or delete on public.courts for each row execute function public.rankball_refresh_court_feed_dependency_trigger()';
  end if;
end $$;

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
      'rankball_approved_courts_feed_dependency_refresh',
      'rankball_courts_feed_dependency_refresh'
    ])
  order by trigger_row.trigger_name;
$$;

revoke all on function public.rankball_feed_trigger_health() from public;
grant execute on function public.rankball_feed_trigger_health() to service_role;

select pg_notify('pgrst', 'reload schema');
