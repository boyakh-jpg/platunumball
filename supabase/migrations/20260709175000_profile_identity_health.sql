create or replace function public.rankball_profile_identity_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with checks as (
    select
      'profiles_auth_user_id_uuid'::text as check_name,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'profiles'
          and column_name = 'auth_user_id'
          and udt_name = 'uuid'
      ) as ok,
      jsonb_build_object('table', 'profiles', 'column', 'auth_user_id', 'expectedType', 'uuid') as detail
    union all
    select
      'profiles_auth_user_id_fkey',
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_auth_user_id_fkey'
      ),
      jsonb_build_object('constraint', 'profiles_auth_user_id_fkey')
    union all
    select
      'profiles_auth_user_id_unique',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'profiles'
          and indexname = 'profiles_auth_user_id_unique'
      ),
      jsonb_build_object('index', 'profiles_auth_user_id_unique')
    union all
    select
      'profiles_discord_user_id_unique',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'profiles'
          and indexname = 'profiles_discord_user_id_unique'
      ),
      jsonb_build_object('index', 'profiles_discord_user_id_unique')
    union all
    select
      'profiles_hashtag_unique',
      exists (
        select 1
        from pg_indexes
        where schemaname = 'public'
          and tablename = 'profiles'
          and indexname = 'profiles_hashtag_unique'
      ),
      jsonb_build_object('index', 'profiles_hashtag_unique')
    union all
    select
      'profiles_auth_user_id_client_write_guard',
      exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.profiles'::regclass
          and tgname = 'profiles_auth_user_id_client_write_guard'
          and not tgisinternal
          and tgenabled <> 'D'
      ),
      jsonb_build_object('trigger', 'profiles_auth_user_id_client_write_guard')
    union all
    select
      'profiles_snapshot_guard',
      exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.profiles'::regclass
          and tgname = 'rankball_profiles_snapshot_guard'
          and not tgisinternal
          and tgenabled <> 'D'
      ),
      jsonb_build_object('trigger', 'rankball_profiles_snapshot_guard')
    union all
    select
      'profiles_auth_user_id_browser_column_privileges',
      not has_column_privilege('anon', 'public.profiles', 'auth_user_id', 'insert')
        and not has_column_privilege('anon', 'public.profiles', 'auth_user_id', 'update')
        and not has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'insert')
        and not has_column_privilege('authenticated', 'public.profiles', 'auth_user_id', 'update'),
      jsonb_build_object('column', 'auth_user_id', 'anonInsertUpdate', false, 'authenticatedInsertUpdate', false)
    union all
    select
      'profiles_lock_columns_exist',
      not exists (
        select required.column_name
        from (values
          ('handle_locked_at'),
          ('birth_year_locked_at'),
          ('name_updated_at'),
          ('discord_user_id')
        ) as required(column_name)
        where not exists (
          select 1
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'profiles'
            and column_name = required.column_name
        )
      ),
      jsonb_build_object('columns', jsonb_build_array('handle_locked_at', 'birth_year_locked_at', 'name_updated_at', 'discord_user_id'))
    union all
    select
      'public_profiles_private_columns_hidden',
      not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'public_profiles'
          and column_name in ('school', 'company', 'club', 'test_login_id', 'discord_connection', 'discord_user_id', 'auth_user_id')
      ),
      jsonb_build_object('view', 'public_profiles')
  )
  select check_name, ok, detail
  from checks
  order by check_name;
$$;

revoke all on function public.rankball_profile_identity_health() from public;
revoke all on function public.rankball_profile_identity_health() from anon;
revoke all on function public.rankball_profile_identity_health() from authenticated;
grant execute on function public.rankball_profile_identity_health() to service_role;

select pg_notify('pgrst', 'reload schema');
