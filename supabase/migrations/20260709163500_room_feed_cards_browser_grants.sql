-- Browser clients must not read or write room feed card cache rows directly.
-- Server APIs use service_role and source tables remain the authoritative records.

do $$
begin
  if to_regclass('public.room_feed_cards') is not null then
    execute 'revoke all privileges on table public.room_feed_cards from public';
    execute 'revoke all privileges on table public.room_feed_cards from anon';
    execute 'revoke all privileges on table public.room_feed_cards from authenticated';
    execute 'grant select, insert, update on table public.room_feed_cards to service_role';
  end if;
end;
$$;

create or replace function public.rankball_rls_policy_health()
returns table(check_id text, ok boolean, detail jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with target_tables(tablename) as (
    values
      ('reports'),
      ('court_requests'),
      ('approved_courts'),
      ('court_reviews'),
      ('matches'),
      ('match_players'),
      ('match_results'),
      ('player_match_stats'),
      ('recruiting_posts'),
      ('recruiting_applications'),
      ('user_room_feed'),
      ('room_feed_cards'),
      ('admin_appointments'),
      ('referee_appointments'),
      ('admin_audit_log'),
      ('admin_disciplinary_actions')
  ),
  bad_policies as (
    select p.tablename, p.policyname, p.roles, p.cmd, p.qual
    from pg_policies p
    join target_tables t on t.tablename = p.tablename
    where p.schemaname = 'public'
      and p.cmd = 'SELECT'
      and lower(regexp_replace(coalesce(nullif(btrim(p.qual), ''), 'true'), '\s+', ' ', 'g')) in ('true', '(true)')
  )
  select
    'no_permissive_target_select'::text,
    not exists (select 1 from bad_policies),
    coalesce(jsonb_agg(to_jsonb(bad_policies)), '[]'::jsonb)
  from bad_policies;

  return query
  with required_policies(tablename, policyname) as (
    values
      ('reports', 'reports_self_read'),
      ('reports', 'reports_admin_read'),
      ('court_requests', 'court_requests_self_read'),
      ('court_requests', 'court_requests_admin_read'),
      ('approved_courts', 'approved_courts_select_public'),
      ('approved_courts', 'approved_courts_admin_read'),
      ('court_reviews', 'court_reviews_select_authenticated'),
      ('court_reviews', 'court_reviews_admin_read'),
      ('user_room_feed', 'user_room_feed_select_related'),
      ('matches', 'matches_select_public'),
      ('matches', 'matches_select_related_private'),
      ('match_players', 'match_players_select_match_readable'),
      ('match_results', 'match_results_select_match_readable'),
      ('player_match_stats', 'player_match_stats_select_match_readable')
  ),
  missing as (
    select r.tablename, r.policyname
    from required_policies r
    left join pg_policies p
      on p.schemaname = 'public'
     and p.tablename = r.tablename
     and p.policyname = r.policyname
    where p.policyname is null
  )
  select
    'required_target_policies_present'::text,
    not exists (select 1 from missing),
    coalesce(jsonb_agg(to_jsonb(missing)), '[]'::jsonb)
  from missing;

  return query
  select
    'user_room_feed_profile_only_browser_read'::text,
    not exists (
      select 1
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'user_room_feed'
        and p.cmd = 'SELECT'
        and (
          p.qual is null
          or p.qual not ilike '%feed_scope = ''profile''%'
          or p.qual ilike '%feed_scope = ''public''%'
        )
    ),
    coalesce((
      select jsonb_agg(jsonb_build_object('policyname', p.policyname, 'qual', p.qual))
      from pg_policies p
      where p.schemaname = 'public'
        and p.tablename = 'user_room_feed'
        and p.cmd = 'SELECT'
        and (
          p.qual is null
          or p.qual not ilike '%feed_scope = ''profile''%'
          or p.qual ilike '%feed_scope = ''public''%'
        )
    ), '[]'::jsonb);

  if to_regclass('public.room_feed_cards') is null then
    return query
    select
      'room_feed_cards_no_browser_table_grants'::text,
      false,
      jsonb_build_object('missingTable', true);
  else
    return query
    with browser_privileges(role_name, privilege_name) as (
      values
        ('anon', 'SELECT'),
        ('anon', 'INSERT'),
        ('anon', 'UPDATE'),
        ('anon', 'DELETE'),
        ('anon', 'TRUNCATE'),
        ('anon', 'REFERENCES'),
        ('anon', 'TRIGGER'),
        ('authenticated', 'SELECT'),
        ('authenticated', 'INSERT'),
        ('authenticated', 'UPDATE'),
        ('authenticated', 'DELETE'),
        ('authenticated', 'TRUNCATE'),
        ('authenticated', 'REFERENCES'),
        ('authenticated', 'TRIGGER')
    ),
    browser_grants as (
      select role_name, privilege_name
      from browser_privileges
      where has_table_privilege(role_name, 'public.room_feed_cards', privilege_name)
    )
    select
      'room_feed_cards_no_browser_table_grants'::text,
      not exists (select 1 from browser_grants),
      coalesce(jsonb_agg(to_jsonb(browser_grants)), '[]'::jsonb)
    from browser_grants;
  end if;
end;
$$;

revoke all on function public.rankball_rls_policy_health() from public;
grant execute on function public.rankball_rls_policy_health() to service_role;
