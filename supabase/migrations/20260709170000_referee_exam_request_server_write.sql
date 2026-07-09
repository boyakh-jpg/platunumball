-- Referee exam/request writes must go through /api/referee/sync.

drop policy if exists referee_requests_self_insert on public.referee_requests;
drop policy if exists referee_exam_attempts_self_insert on public.referee_exam_attempts;

revoke all privileges on table public.referee_requests from public;
revoke all privileges on table public.referee_requests from anon;
revoke all privileges on table public.referee_requests from authenticated;
revoke all privileges on table public.referee_requests from service_role;
grant select on table public.referee_requests to authenticated;
grant select, insert, update on table public.referee_requests to service_role;

revoke all privileges on table public.referee_exam_attempts from public;
revoke all privileges on table public.referee_exam_attempts from anon;
revoke all privileges on table public.referee_exam_attempts from authenticated;
revoke all privileges on table public.referee_exam_attempts from service_role;
grant select on table public.referee_exam_attempts to authenticated;
grant select, insert, update on table public.referee_exam_attempts to service_role;

create or replace function public.rankball_referee_rls_policy_health()
returns table(check_id text, ok boolean, detail jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with required_policies(tablename, policyname) as (
    values
      ('referee_requests', 'referee_requests_self_read'),
      ('referee_exam_attempts', 'referee_exam_attempts_self_read')
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
    'referee_self_read_policies_present'::text,
    not exists (select 1 from missing),
    coalesce(jsonb_agg(to_jsonb(missing)), '[]'::jsonb)
  from missing;

  return query
  with insert_policies as (
    select tablename, policyname, roles, cmd, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in ('referee_requests', 'referee_exam_attempts')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and roles && array['anon'::name, 'authenticated'::name, 'public'::name]
  )
  select
    'referee_no_browser_write_policies'::text,
    not exists (select 1 from insert_policies),
    coalesce(jsonb_agg(to_jsonb(insert_policies)), '[]'::jsonb)
  from insert_policies;

  return query
  with browser_privileges(table_name, role_name, privilege_name) as (
    values
      ('referee_requests', 'anon', 'INSERT'),
      ('referee_requests', 'anon', 'UPDATE'),
      ('referee_requests', 'anon', 'DELETE'),
      ('referee_requests', 'anon', 'TRUNCATE'),
      ('referee_requests', 'anon', 'REFERENCES'),
      ('referee_requests', 'anon', 'TRIGGER'),
      ('referee_requests', 'authenticated', 'INSERT'),
      ('referee_requests', 'authenticated', 'UPDATE'),
      ('referee_requests', 'authenticated', 'DELETE'),
      ('referee_requests', 'authenticated', 'TRUNCATE'),
      ('referee_requests', 'authenticated', 'REFERENCES'),
      ('referee_requests', 'authenticated', 'TRIGGER'),
      ('referee_exam_attempts', 'anon', 'INSERT'),
      ('referee_exam_attempts', 'anon', 'UPDATE'),
      ('referee_exam_attempts', 'anon', 'DELETE'),
      ('referee_exam_attempts', 'anon', 'TRUNCATE'),
      ('referee_exam_attempts', 'anon', 'REFERENCES'),
      ('referee_exam_attempts', 'anon', 'TRIGGER'),
      ('referee_exam_attempts', 'authenticated', 'INSERT'),
      ('referee_exam_attempts', 'authenticated', 'UPDATE'),
      ('referee_exam_attempts', 'authenticated', 'DELETE'),
      ('referee_exam_attempts', 'authenticated', 'TRUNCATE'),
      ('referee_exam_attempts', 'authenticated', 'REFERENCES'),
      ('referee_exam_attempts', 'authenticated', 'TRIGGER')
  ),
  browser_grants as (
    select table_name, role_name, privilege_name
    from browser_privileges
    where has_table_privilege(role_name, format('public.%I', table_name), privilege_name)
  )
  select
    'referee_no_browser_write_grants'::text,
    not exists (select 1 from browser_grants),
    coalesce(jsonb_agg(to_jsonb(browser_grants)), '[]'::jsonb)
  from browser_grants;
end;
$$;

revoke all on function public.rankball_referee_rls_policy_health() from public;
grant execute on function public.rankball_referee_rls_policy_health() to service_role;
