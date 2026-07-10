-- Admin appointment/audit/disciplinary writes must stay server-action/RPC only.
-- Keep browser raw table access to authenticated admin read policies only.

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'admin_appointments',
        'referee_appointments',
        'admin_audit_log',
        'admin_disciplinary_actions'
      )
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
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
      ('match_agreements'),
      ('match_approvals'),
      ('match_disputes'),
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
      ('player_match_stats', 'player_match_stats_select_match_readable'),
      ('match_agreements', 'match_agreements_select_match_readable'),
      ('match_approvals', 'match_approvals_select_match_readable'),
      ('match_disputes', 'match_disputes_select_actor'),
      ('recruiting_posts', 'recruiting_posts_select_related'),
      ('recruiting_applications', 'recruiting_applications_related_user_read'),
      ('admin_appointments', 'admin_appointments_admin_read'),
      ('referee_appointments', 'referee_appointments_admin_read'),
      ('admin_audit_log', 'admin_audit_log_admin_read'),
      ('admin_disciplinary_actions', 'admin_disciplinary_actions_admin_read')
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

  return query
  select
    'room_feed_cards_no_browser_table_grants'::text,
    case
      when to_regclass('public.room_feed_cards') is null then false
      else not has_table_privilege('anon', 'public.room_feed_cards', 'SELECT')
        and not has_table_privilege('authenticated', 'public.room_feed_cards', 'SELECT')
    end,
    jsonb_build_object(
      'anonSelect', case when to_regclass('public.room_feed_cards') is null then null else has_table_privilege('anon', 'public.room_feed_cards', 'SELECT') end,
      'authenticatedSelect', case when to_regclass('public.room_feed_cards') is null then null else has_table_privilege('authenticated', 'public.room_feed_cards', 'SELECT') end
    );

  return query
  with admin_tables(tablename) as (
    values
      ('admin_appointments'),
      ('referee_appointments'),
      ('admin_audit_log'),
      ('admin_disciplinary_actions')
  ),
  unsafe_grants as (
    select g.grantee, g.table_name, g.privilege_type
    from information_schema.role_table_grants g
    join admin_tables t on t.tablename = g.table_name
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
  )
  select
    'admin_tables_no_browser_write_grants'::text,
    not exists (select 1 from unsafe_grants),
    coalesce(jsonb_agg(to_jsonb(unsafe_grants)), '[]'::jsonb)
  from unsafe_grants;

  return query
  with admin_tables(tablename) as (
    values
      ('admin_appointments'),
      ('referee_appointments'),
      ('admin_audit_log'),
      ('admin_disciplinary_actions')
  ),
  unsafe_policies as (
    select p.tablename, p.policyname, p.roles, p.cmd
    from pg_policies p
    join admin_tables t on t.tablename = p.tablename
    where p.schemaname = 'public'
      and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and p.roles && array['public'::name, 'anon'::name, 'authenticated'::name]
  )
  select
    'admin_tables_no_browser_write_policies'::text,
    not exists (select 1 from unsafe_policies),
    coalesce(jsonb_agg(to_jsonb(unsafe_policies)), '[]'::jsonb)
  from unsafe_policies;

  return query
  with admin_tables(tablename) as (
    values
      ('admin_appointments'),
      ('referee_appointments'),
      ('admin_audit_log'),
      ('admin_disciplinary_actions')
  ),
  anon_select_grants as (
    select g.grantee, g.table_name, g.privilege_type
    from information_schema.role_table_grants g
    join admin_tables t on t.tablename = g.table_name
    where g.table_schema = 'public'
      and g.grantee = 'anon'
      and g.privilege_type = 'SELECT'
  )
  select
    'admin_tables_no_anon_select_grants'::text,
    not exists (select 1 from anon_select_grants),
    coalesce(jsonb_agg(to_jsonb(anon_select_grants)), '[]'::jsonb)
  from anon_select_grants;

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
      ('match_agreements'),
      ('match_approvals'),
      ('match_disputes'),
      ('recruiting_posts'),
      ('recruiting_applications')
  ),
  unsafe_grants as (
    select g.grantee, g.table_name, g.privilege_type
    from information_schema.role_table_grants g
    join target_tables t on t.tablename = g.table_name
    where g.table_schema = 'public'
      and g.grantee in ('anon', 'authenticated')
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
  )
  select
    'target_tables_no_browser_write_grants'::text,
    not exists (select 1 from unsafe_grants),
    coalesce(jsonb_agg(to_jsonb(unsafe_grants)), '[]'::jsonb)
  from unsafe_grants;

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
      ('match_agreements'),
      ('match_approvals'),
      ('match_disputes'),
      ('recruiting_posts'),
      ('recruiting_applications')
  ),
  unsafe_policies as (
    select p.tablename, p.policyname, p.roles, p.cmd
    from pg_policies p
    join target_tables t on t.tablename = p.tablename
    where p.schemaname = 'public'
      and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and p.roles && array['public'::name, 'anon'::name, 'authenticated'::name]
  )
  select
    'target_tables_no_browser_write_policies'::text,
    not exists (select 1 from unsafe_policies),
    coalesce(jsonb_agg(to_jsonb(unsafe_policies)), '[]'::jsonb)
  from unsafe_policies;

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
      ('match_agreements'),
      ('match_approvals'),
      ('match_disputes'),
      ('recruiting_posts'),
      ('recruiting_applications')
  ),
  anon_select_grants as (
    select g.grantee, g.table_name, g.privilege_type
    from information_schema.role_table_grants g
    join target_tables t on t.tablename = g.table_name
    where g.table_schema = 'public'
      and g.grantee = 'anon'
      and g.privilege_type = 'SELECT'
  )
  select
    'target_tables_no_anon_select_grants'::text,
    not exists (select 1 from anon_select_grants),
    coalesce(jsonb_agg(to_jsonb(anon_select_grants)), '[]'::jsonb)
  from anon_select_grants;
end;
$$;

revoke all on function public.rankball_rls_policy_health() from public;
grant execute on function public.rankball_rls_policy_health() to service_role;

select pg_notify('pgrst', 'reload schema');
