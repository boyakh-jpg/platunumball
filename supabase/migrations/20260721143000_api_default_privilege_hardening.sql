alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;

do $$
begin
  if pg_has_role(current_user, 'supabase_admin', 'member') then
    execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon, authenticated, service_role';
    execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated, service_role';
  else
    raise notice 'supabase_admin default privileges were not changed because the migration role is not a member';
  end if;
end
$$;

select pg_notify('pgrst', 'reload schema');
