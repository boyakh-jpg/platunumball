create or replace function public.current_profile_id()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_id text;
  match_count integer;
begin
  select count(*), max(profile.id)
  into match_count, profile_id
  from public.profiles profile
  where profile.auth_user_id = auth.uid();

  if match_count > 1 then
    raise exception 'duplicate auth_user_id for current auth user';
  end if;

  return profile_id;
end;
$$;

create or replace function public.current_admin_level()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(
    case appointment.grade
      when 'owner' then 100
      when 'senior' then 80
      when 'regionManager' then 60
      when 'matchManager' then 50
      when 'support' then 30
      else 0
    end
  ), 0)
  from public.admin_appointments appointment
  where appointment.user_id = public.current_profile_id()
    and appointment.role = 'admin'
    and appointment.status = 'active'
    and (appointment.starts_at is null or appointment.starts_at <= now())
    and (appointment.ends_at is null or appointment.ends_at >= now())
$$;

create or replace function public.current_is_admin(min_level integer default 30)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_admin_level() >= greatest(coalesce(min_level, 30), 30)
$$;

create or replace function public.rankball_admin_level_for_profile(
  actor_profile_id text,
  override_level integer default 0
)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_profile_id text := public.current_profile_id();
  target_profile_id text;
  resolved_level integer;
begin
  if caller_profile_id is not null then
    if caller_profile_id is distinct from nullif(btrim(actor_profile_id), '') then
      return 0;
    end if;
    target_profile_id := caller_profile_id;
  elsif coalesce(auth.role(), '') = 'service_role' then
    target_profile_id := nullif(btrim(actor_profile_id), '');
  else
    return 0;
  end if;

  if target_profile_id is null then
    return 0;
  end if;

  select coalesce(max(
    case appointment.grade
      when 'owner' then 100
      when 'senior' then 80
      when 'regionManager' then 60
      when 'matchManager' then 50
      when 'support' then 30
      else 0
    end
  ), 0)
  into resolved_level
  from public.admin_appointments appointment
  where appointment.user_id = target_profile_id
    and appointment.role = 'admin'
    and appointment.status = 'active'
    and (appointment.starts_at is null or appointment.starts_at <= now())
    and (appointment.ends_at is null or appointment.ends_at >= now());

  return resolved_level;
end;
$$;

alter function public.current_profile_id() owner to postgres;
alter function public.current_admin_level() owner to postgres;
alter function public.current_is_admin(integer) owner to postgres;
alter function public.rankball_admin_level_for_profile(text, integer) owner to postgres;

revoke all on function public.current_profile_id() from public, anon;
revoke all on function public.current_admin_level() from public, anon;
revoke all on function public.current_is_admin(integer) from public, anon;
revoke all on function public.rankball_admin_level_for_profile(text, integer) from public, anon, authenticated;

grant execute on function public.current_profile_id() to authenticated, service_role;
grant execute on function public.current_admin_level() to authenticated, service_role;
grant execute on function public.current_is_admin(integer) to authenticated, service_role;
grant execute on function public.rankball_admin_level_for_profile(text, integer) to service_role;

do $$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'admin_appointments',
    'referee_appointments',
    'admin_audit_log',
    'admin_disciplinary_actions',
    'rating_policy'
  ]
  loop
    if to_regclass(format('public.%I', relation_name)) is not null then
      execute format('alter table public.%I enable row level security', relation_name);
      execute format('revoke all privileges on table public.%I from anon, authenticated', relation_name);
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        relation_name
      );
    end if;
  end loop;
end
$$;

do $$
declare
  view_name text;
begin
  foreach view_name in array array[
    'rankball_admin_court_database',
    'rankball_admin_court_change_history'
  ]
  loop
    if to_regclass(format('public.%I', view_name)) is not null then
      execute format('revoke all privileges on table public.%I from anon, authenticated', view_name);
      execute format('grant select on table public.%I to service_role', view_name);
    end if;
  end loop;
end
$$;

drop policy if exists admin_appointments_admin_read on public.admin_appointments;
drop policy if exists referee_appointments_admin_read on public.referee_appointments;
drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
drop policy if exists admin_disciplinary_actions_admin_read on public.admin_disciplinary_actions;

create policy admin_appointments_admin_read
on public.admin_appointments
for select
to authenticated
using (public.current_is_admin(30));

create policy referee_appointments_admin_read
on public.referee_appointments
for select
to authenticated
using (public.current_is_admin(30));

create policy admin_audit_log_admin_read
on public.admin_audit_log
for select
to authenticated
using (public.current_is_admin(30));

create policy admin_disciplinary_actions_admin_read
on public.admin_disciplinary_actions
for select
to authenticated
using (public.current_is_admin(30));

do $$
declare
  function_row record;
  function_signature text;
begin
  for function_row in
    select
      namespace.nspname,
      procedure.proname,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and (
        procedure.proname like 'rankball_admin_%'
        or procedure.proname like 'rankball_commit_admin_%'
        or procedure.proname in (
          'rankball_approve_court_request',
          'rankball_get_rating_policy',
          'rankball_moderate_reported_name',
          'rankball_moderate_team_emblem_guarded',
          'rankball_review_void_match_report',
          'rankball_update_rating_policy'
        )
        or pg_get_functiondef(procedure.oid) like '%rankball_admin_level_for_profile%'
      )
  loop
    function_signature := format(
      '%I.%I(%s)',
      function_row.nspname,
      function_row.proname,
      function_row.identity_arguments
    );
    execute 'revoke all on function ' || function_signature || ' from public, anon, authenticated';
    execute 'grant execute on function ' || function_signature || ' to service_role';
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');
