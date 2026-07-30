do $$
begin
  if to_regclass('public.rankball_state') is not null then
    execute 'drop policy if exists "rankball_state_select_public" on public.rankball_state';
    execute 'drop policy if exists "rankball_state_insert_public" on public.rankball_state';
    execute 'drop policy if exists "rankball_state_update_public" on public.rankball_state';
    execute 'drop policy if exists "rankball_state_admin_only" on public.rankball_state';
    execute 'drop table if exists public.rankball_state';
  end if;
end $$;

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles add column if not exists auth_user_id uuid';
    execute 'alter table public.profiles add column if not exists test_login_id text';
    execute 'alter table public.profiles add column if not exists hashtag text';
    execute 'alter table public.profiles add column if not exists birth_year integer';
    execute 'alter table public.profiles add column if not exists age_group text';
    execute 'alter table public.profiles add column if not exists age_group_checked_season text';
    execute 'alter table public.profiles add column if not exists region_sido text';
    execute 'alter table public.profiles add column if not exists region_district text';
    execute 'alter table public.profiles add column if not exists onboarding_complete boolean not null default false';
    execute 'alter table public.profiles add column if not exists profile_version integer not null default 0';
    execute 'alter table public.profiles add column if not exists handle_locked_at timestamptz';
    execute 'alter table public.profiles add column if not exists birth_year_locked_at timestamptz';
    execute 'alter table public.profiles add column if not exists name_updated_at timestamptz';
    execute 'alter table public.profiles add column if not exists discord_connection jsonb';
    execute 'alter table public.profiles add column if not exists discord_user_id text';
    execute 'alter table public.profiles add column if not exists app_settings jsonb not null default ''{}''::jsonb';
    execute 'update public.profiles set hashtag = lower(''#'' || regexp_replace(coalesce(nullif(hashtag, ''''), handle, id), ''^[@#]+'', ''''))';
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'handle'
    ) then
      execute 'update public.profiles set handle = hashtag where hashtag is not null and handle is distinct from hashtag';
    end if;

    if exists (
      select 1
      from public.profiles
      where auth_user_id is not null
        and auth_user_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'profiles.auth_user_id contains non-uuid values';
    end if;

    if exists (
      select 1
      from public.profiles
      where auth_user_id is not null
      group by auth_user_id
      having count(*) > 1
    ) then
      raise exception 'profiles.auth_user_id contains duplicate values';
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'auth_user_id'
        and data_type <> 'uuid'
    ) then
      execute 'alter table public.profiles alter column auth_user_id type uuid using auth_user_id::uuid';
    end if;

    if exists (
      select 1
      from public.profiles p
      where p.auth_user_id is not null
        and not exists (select 1 from auth.users au where au.id = p.auth_user_id)
    ) then
      raise exception 'profiles.auth_user_id contains ids missing from auth.users';
    end if;

    execute 'create unique index if not exists profiles_auth_user_id_unique on public.profiles (auth_user_id) where auth_user_id is not null';
    execute 'create unique index if not exists profiles_test_login_id_unique on public.profiles (test_login_id) where test_login_id is not null';

    if not exists (
      select 1
      from pg_constraint
      where conname = 'profiles_auth_user_id_fkey'
        and conrelid = 'public.profiles'::regclass
    ) then
      execute 'alter table public.profiles add constraint profiles_auth_user_id_fkey foreign key (auth_user_id) references auth.users(id) on delete set null';
    end if;

    if not exists (
      select 1
      from public.profiles
      where hashtag is not null
      group by lower(regexp_replace(hashtag, '^[@#]+', ''))
      having count(*) > 1
    ) then
      execute 'create unique index if not exists profiles_hashtag_unique on public.profiles (lower(regexp_replace(hashtag, ''^[@#]+'', ''''))) where hashtag is not null';
    end if;
    execute 'update public.profiles set discord_user_id = nullif(discord_connection->>''userId'', '''') where discord_user_id is null';
    if not exists (
      select 1
      from public.profiles
      where discord_user_id is not null
      group by discord_user_id
      having count(*) > 1
    ) then
      execute 'create unique index if not exists profiles_discord_user_id_unique on public.profiles (discord_user_id) where discord_user_id is not null';
    end if;

    execute 'drop policy if exists profiles_read_all on public.profiles';
    execute 'drop policy if exists profiles_select_all on public.profiles';
    execute 'drop policy if exists profiles_public_read on public.profiles';
    execute 'drop policy if exists profiles_self_read on public.profiles';

    execute 'drop view if exists public.public_profiles';
    execute $view$
      create view public.public_profiles as
      select
        id,
        name,
        handle,
        hashtag,
        position,
        region,
        region_sido,
        region_district,
        trust_score,
        streak,
        avatar_color,
        ratings,
        age_group,
        age_group_checked_season,
        onboarding_complete,
        updated_at
      from public.profiles
    $view$;

    execute 'revoke all on public.profiles from anon, authenticated';
    execute 'grant select on public.profiles to authenticated';
    execute 'grant select on public.public_profiles to anon, authenticated';
  end if;
end;
$$;

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
  select count(*), max(p.id)
  into match_count, profile_id
  from public.profiles p
  where p.auth_user_id = auth.uid();

  if match_count > 1 then
    raise exception 'duplicate auth_user_id for current auth user';
  end if;

  return profile_id;
end;
$$;

do $$
declare
  policy_row record;
begin
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles enable row level security';
    execute 'drop policy if exists profiles_read_all on public.profiles';
    execute 'drop policy if exists profiles_select_all on public.profiles';
    execute 'drop policy if exists profiles_public_read on public.profiles';
    execute 'drop policy if exists profiles_self_read on public.profiles';
    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and cmd = 'SELECT'
        and qual in ('true', '(true)')
    loop
      execute format('drop policy if exists %I on public.profiles', policy_row.policyname);
    end loop;
    execute 'create policy profiles_self_read on public.profiles for select to authenticated using (id = public.current_profile_id())';
  end if;
end;
$$;

create or replace function public.prevent_profile_auth_user_id_client_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('postgres', 'service_role') or current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' and new.auth_user_id is not null then
    raise exception 'auth_user_id is server-managed' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'auth_user_id is server-managed' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.rankball_normalize_hashtag(
  p_value text,
  p_fallback text default null
)
returns text
language sql
immutable
as $$
  select case
    when normalized.body = '' then null
    else '#' || normalized.body
  end
  from (
    select left(
      regexp_replace(
        regexp_replace(
          lower(coalesce(nullif(btrim(p_value), ''), nullif(btrim(p_fallback), ''), '')),
          '^[@#]+',
          ''
        ),
        '[^[:alnum:]_-]+',
        '',
        'g'
      ),
      20
    ) as body
  ) normalized
$$;

create or replace function public.rankball_profile_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_hashtag text;
  safe_region text;
  linked_discord_id text;
begin
  safe_hashtag := public.rankball_normalize_hashtag(new.hashtag, coalesce(new.handle, new.id));
  if safe_hashtag is not null then
    new.hashtag := safe_hashtag;
    new.handle := safe_hashtag;
  end if;

  safe_region := nullif(btrim(concat_ws(
    ' ',
    nullif(btrim(new.region_sido), ''),
    nullif(btrim(new.region_district), '')
  )), '');
  if safe_region is not null then
    new.region := safe_region;
  end if;

  if new.discord_connection is null then
    new.discord_user_id := null;
  elsif jsonb_typeof(new.discord_connection) = 'object' then
    linked_discord_id := nullif(btrim(coalesce(new.discord_connection->>'userId', new.discord_connection->>'id')), '');
    if coalesce(new.discord_connection->>'status', '') = 'linked' and linked_discord_id is not null then
      new.discord_user_id := linked_discord_id;
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists profiles_auth_user_id_client_write_guard on public.profiles';
    execute '
      create trigger profiles_auth_user_id_client_write_guard
      before insert or update of auth_user_id on public.profiles
      for each row
      execute function public.prevent_profile_auth_user_id_client_write()
    ';
    execute 'revoke insert (auth_user_id) on public.profiles from anon, authenticated';
    execute 'revoke update (auth_user_id) on public.profiles from anon, authenticated';
    execute 'drop trigger if exists rankball_profiles_snapshot_guard on public.profiles';
    execute 'create trigger rankball_profiles_snapshot_guard before insert or update of handle, hashtag, region, region_sido, region_district, discord_connection, discord_user_id on public.profiles for each row execute function public.rankball_profile_snapshot_guard()';

    with normalized as (
      select
        id,
        public.rankball_normalize_hashtag(hashtag, coalesce(handle, id)) as normalized_hashtag,
        nullif(btrim(concat_ws(
          ' ',
          nullif(btrim(region_sido), ''),
          nullif(btrim(region_district), '')
        )), '') as normalized_region,
        case
          when discord_connection is null then null
          when jsonb_typeof(discord_connection) = 'object'
            and coalesce(discord_connection->>'status', '') = 'linked'
            and nullif(btrim(coalesce(discord_connection->>'userId', discord_connection->>'id')), '') is not null
            then nullif(btrim(coalesce(discord_connection->>'userId', discord_connection->>'id')), '')
          else discord_user_id
        end as normalized_discord_user_id
      from public.profiles
    )
    update public.profiles profile
    set
      handle = coalesce(normalized.normalized_hashtag, profile.handle),
      hashtag = coalesce(normalized.normalized_hashtag, profile.hashtag),
      region = coalesce(normalized.normalized_region, profile.region),
      discord_user_id = normalized.normalized_discord_user_id
    from normalized
    where profile.id = normalized.id
      and (
        (normalized.normalized_hashtag is not null and (
          profile.handle is distinct from normalized.normalized_hashtag
          or profile.hashtag is distinct from normalized.normalized_hashtag
        ))
        or (normalized.normalized_region is not null and profile.region is distinct from normalized.normalized_region)
        or profile.discord_user_id is distinct from normalized.normalized_discord_user_id
      );
  end if;
end;
$$;

create or replace function public.enforce_team_membership_limit()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.team_members
    where user_id = new.user_id
      and team_id <> new.team_id
  ) >= 3 then
    raise exception 'team membership limit exceeded: max 3 teams per user';
  end if;

  if (
    select count(*)
    from public.team_members
    where team_id = new.team_id
      and user_id <> new.user_id
  ) >= 10 then
    raise exception 'team member limit exceeded: max 10 members per team';
  end if;

  return new;
end;
$$;

create table if not exists public.tournaments (
  id text primary key,
  title text not null,
  format text not null default 'league',
  visibility text not null default 'private',
  status text not null default 'draft',
  region text,
  court_id text,
  court_name text,
  mode text,
  ranked boolean not null default true,
  official boolean not null default false,
  start_date date,
  end_date date,
  schedule_policy text not null default 'weekly',
  schedule_note text,
  mmr_limit_mode text not null default 'warn',
  max_mmr_gap integer not null default 250,
  mmr_policy text not null default 'gap_adjusted',
  rules jsonb not null default '{}'::jsonb,
  memo text,
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  match_ids jsonb not null default '[]'::jsonb,
  team_statuses jsonb not null default '{}'::jsonb,
  team_approvals jsonb not null default '{}'::jsonb,
  referee_ids jsonb not null default '[]'::jsonb,
  referee_statuses jsonb not null default '{}'::jsonb,
  referee_approvals jsonb not null default '{}'::jsonb,
  sanction_status text not null default 'pending',
  sanction_reviewed_by text,
  sanction_reviewed_at timestamptz,
  sanction_review_note text,
  bracket jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint tournaments_format_check check (format in ('league', 'tournament')),
  constraint tournaments_visibility_check check (visibility in ('private', 'public')),
  constraint tournaments_status_check check (status in ('draft', 'scheduled', 'active', 'closed', 'cancelled')),
  constraint tournaments_mmr_limit_mode_check check (mmr_limit_mode in ('off', 'warn', 'block')),
  constraint tournaments_mmr_policy_check check (mmr_policy in ('gap_adjusted', 'standard', 'event_only')),
  constraint tournaments_sanction_status_check check (
    sanction_status in ('pending', 'regional_pending', 'regional_rejected', 'approved', 'community')
  )
);

create table if not exists public.tournament_teams (
  tournament_id text not null references public.tournaments(id) on delete cascade,
  team_id text not null,
  seed_order integer not null default 1,
  status text not null default 'invited',
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tournament_id, team_id),
  constraint tournament_teams_status_check check (status in ('invited', 'accepted', 'declined'))
);

create index if not exists tournaments_created_at_idx on public.tournaments (created_at desc);
create index if not exists tournaments_court_id_idx on public.tournaments (court_id) where court_id is not null;
create index if not exists tournaments_referee_ids_idx on public.tournaments using gin (referee_ids);
create index if not exists tournament_teams_team_id_idx on public.tournament_teams (team_id);

create or replace function public.rankball_normalize_dispute_minutes(p_value integer default null)
returns integer
language sql
immutable
parallel safe
as $$
  select case when p_value in (10, 15, 20) then p_value else 15 end;
$$;

grant execute on function public.rankball_normalize_dispute_minutes(integer)
to anon, authenticated, service_role;

create table if not exists public.recruiting_posts (
  id text primary key,
  type text not null default 'need_player',
  title text not null,
  visibility text not null default 'public',
  player_id text,
  team_id text,
  region text,
  court_id text,
  court_name text,
  mode text,
  scheduled_date date,
  scheduled_time time,
  scheduled_at text,
  ranked boolean not null default true,
  official boolean not null default false,
  pre_registered boolean not null default true,
  rating_scale numeric not null default 1,
  age_restriction text,
  allowed_age_groups jsonb not null default '[]'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  stakes text,
  court_reserved boolean not null default false,
  court_fee text,
  spots integer not null default 0,
  target_team_id text,
  referee_id text,
  referee_trust_min integer not null default 90,
  stat_entry_minutes integer not null default 60,
  dispute_minutes integer not null default 15,
  room_state jsonb not null default '{}'::jsonb,
  host_join_mode text not null default 'team',
  host_side text not null default 'teamA',
  host_ready boolean not null default false,
  side_capacity integer not null default 5,
  bench_capacity smallint not null default 2,
  player_ids jsonb not null default '[]'::jsonb,
  position text,
  memo text,
  status text not null default 'open',
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruiting_posts_visibility_check check (visibility in ('public', 'private')),
  constraint recruiting_posts_host_join_mode_check check (host_join_mode in ('player', 'team')),
  constraint recruiting_posts_host_side_check check (host_side in ('teamA', 'teamB')),
  constraint recruiting_posts_side_capacity_check check (side_capacity between 1 and 5),
  constraint recruiting_posts_bench_capacity_check check (bench_capacity between 0 and 3)
);

create table if not exists public.recruiting_applications (
  post_id text not null references public.recruiting_posts(id) on delete cascade,
  player_id text not null,
  team_id text,
  kind text not null default 'player',
  side text not null default 'teamB',
  status text not null default 'waiting',
  reserve boolean not null default false,
  position text,
  player_ids jsonb not null default '[]'::jsonb,
  source_team_id text,
  source_entry_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key (post_id, player_id, kind),
  constraint recruiting_applications_kind_check check (kind in ('player', 'team')),
  constraint recruiting_applications_side_check check (side in ('teamA', 'teamB')),
  constraint recruiting_applications_status_check check (status in ('waiting', 'ready', 'confirmed'))
);

do $$
begin
  if to_regclass('public.recruiting_posts') is not null then
    execute 'alter table public.recruiting_posts add column if not exists type text not null default ''need_player''';
    execute 'alter table public.recruiting_posts add column if not exists title text not null default ''모집방''';
    execute 'alter table public.recruiting_posts add column if not exists visibility text not null default ''public''';
    execute 'alter table public.recruiting_posts add column if not exists player_id text';
    execute 'alter table public.recruiting_posts add column if not exists team_id text';
    execute 'alter table public.recruiting_posts add column if not exists region text';
    execute 'alter table public.recruiting_posts add column if not exists court_id text';
    execute 'alter table public.recruiting_posts add column if not exists court_name text';
    execute 'alter table public.recruiting_posts add column if not exists mode text';
    execute 'alter table public.recruiting_posts add column if not exists ranked boolean not null default true';
    execute 'alter table public.recruiting_posts add column if not exists official boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists pre_registered boolean not null default true';
    execute 'alter table public.recruiting_posts add column if not exists rating_scale numeric not null default 1';
    execute 'alter table public.recruiting_posts add column if not exists age_restriction text';
    execute 'alter table public.recruiting_posts add column if not exists allowed_age_groups jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists rules jsonb not null default ''{}''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists stakes text';
    execute 'alter table public.recruiting_posts add column if not exists court_reserved boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists court_fee text';
    execute 'alter table public.recruiting_posts add column if not exists spots integer not null default 0';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_date date';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_time time';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_at text';
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'recruiting_posts'
        and column_name = 'scheduled_at'
        and data_type <> 'text'
    ) then
      execute 'alter table public.recruiting_posts alter column scheduled_at type text using scheduled_at::text';
    end if;
    execute 'alter table public.recruiting_posts add column if not exists confirmed_at timestamptz';
    execute 'alter table public.recruiting_posts add column if not exists player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists room_state jsonb not null default ''{}''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists host_join_mode text not null default ''team''';
    execute 'alter table public.recruiting_posts add column if not exists host_side text not null default ''teamA''';
    execute 'alter table public.recruiting_posts add column if not exists host_ready boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists side_capacity integer not null default 5';
    execute 'alter table public.recruiting_posts add column if not exists bench_capacity smallint not null default 2';
    execute 'alter table public.recruiting_posts add column if not exists position text';
    execute 'alter table public.recruiting_posts add column if not exists memo text';
    execute 'alter table public.recruiting_posts add column if not exists status text not null default ''open''';
    execute 'alter table public.recruiting_posts add column if not exists target_team_id text';
    execute 'alter table public.recruiting_posts add column if not exists referee_id text';
    execute 'alter table public.recruiting_posts add column if not exists referee_trust_min integer not null default 90';
    execute 'alter table public.recruiting_posts add column if not exists stat_entry_minutes integer not null default 60';
    execute 'alter table public.recruiting_posts add column if not exists dispute_minutes integer not null default 15';
    execute 'alter table public.recruiting_posts add column if not exists created_at timestamptz not null default now()';
    execute 'alter table public.recruiting_posts add column if not exists updated_at timestamptz not null default now()';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_visibility_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_visibility_check check (visibility in (''public'', ''private''))';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_bench_capacity_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_bench_capacity_check check (bench_capacity between 0 and 3)';
  end if;

  if to_regclass('public.recruiting_applications') is not null then
    execute 'alter table public.recruiting_applications add column if not exists team_id text';
    execute 'alter table public.recruiting_applications add column if not exists kind text not null default ''player''';
    execute 'alter table public.recruiting_applications add column if not exists side text not null default ''teamB''';
    execute 'alter table public.recruiting_applications add column if not exists status text not null default ''waiting''';
    execute 'alter table public.recruiting_applications add column if not exists reserve boolean not null default false';
    execute 'alter table public.recruiting_applications add column if not exists position text';
    execute 'alter table public.recruiting_applications add column if not exists player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_applications add column if not exists source_team_id text';
    execute 'alter table public.recruiting_applications add column if not exists source_entry_id text';
    execute 'alter table public.recruiting_applications add column if not exists created_at timestamptz not null default now()';
    execute 'alter table public.recruiting_applications add column if not exists updated_at timestamptz';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.recruiting_posts') is not null then
    execute $stmt$update public.recruiting_posts set target_team_id = null where target_team_id is not null and btrim(target_team_id) = ''$stmt$;
    execute $stmt$update public.recruiting_posts set court_fee = null where court_fee is not null and btrim(court_fee) = ''$stmt$;
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_target_team_id_not_blank';
    execute $stmt$alter table public.recruiting_posts add constraint recruiting_posts_target_team_id_not_blank check (target_team_id is null or btrim(target_team_id) <> '') not valid$stmt$;
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_court_fee_not_blank';
    execute $stmt$alter table public.recruiting_posts add constraint recruiting_posts_court_fee_not_blank check (court_fee is null or btrim(court_fee) <> '') not valid$stmt$;
  end if;

  if to_regclass('public.recruiting_applications') is not null then
    execute $stmt$update public.recruiting_applications set team_id = null where team_id is not null and btrim(team_id) = ''$stmt$;
    execute $stmt$update public.recruiting_applications set source_team_id = null where source_team_id is not null and btrim(source_team_id) = ''$stmt$;
    execute $stmt$update public.recruiting_applications set source_entry_id = null where source_entry_id is not null and btrim(source_entry_id) = ''$stmt$;
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_team_id_not_blank';
    execute $stmt$alter table public.recruiting_applications add constraint recruiting_applications_team_id_not_blank check (team_id is null or btrim(team_id) <> '') not valid$stmt$;
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_source_team_id_not_blank';
    execute $stmt$alter table public.recruiting_applications add constraint recruiting_applications_source_team_id_not_blank check (source_team_id is null or btrim(source_team_id) <> '') not valid$stmt$;
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_source_entry_id_not_blank';
    execute $stmt$alter table public.recruiting_applications add constraint recruiting_applications_source_entry_id_not_blank check (source_entry_id is null or btrim(source_entry_id) <> '') not valid$stmt$;
  end if;
end;
$$;

create index if not exists recruiting_posts_created_at_idx on public.recruiting_posts (created_at desc);
create index if not exists recruiting_posts_visibility_status_idx on public.recruiting_posts (visibility, status);
create index if not exists recruiting_posts_open_public_updated_idx
on public.recruiting_posts (updated_at desc, id desc)
where status = 'open' and visibility = 'public';

create index if not exists recruiting_posts_open_player_updated_idx
on public.recruiting_posts (player_id, updated_at desc, id desc)
where status = 'open';

create index if not exists recruiting_posts_open_owner_updated_idx
on public.recruiting_posts ((room_state->>'ownerId'), updated_at desc, id desc)
where status = 'open';

create index if not exists recruiting_posts_open_referee_updated_idx
on public.recruiting_posts (referee_id, updated_at desc, id desc)
where status = 'open';

create index if not exists recruiting_posts_player_ids_gin_idx
on public.recruiting_posts using gin (player_ids);

create index if not exists recruiting_posts_room_state_gin_idx
on public.recruiting_posts using gin (room_state);

create index if not exists recruiting_applications_post_side_idx on public.recruiting_applications (post_id, side, reserve);
create index if not exists recruiting_applications_player_updated_idx
on public.recruiting_applications (player_id, updated_at desc, post_id);

create index if not exists recruiting_applications_player_ids_gin_idx
on public.recruiting_applications using gin (player_ids);

alter table public.tournaments enable row level security;
alter table public.tournament_teams enable row level security;
alter table public.recruiting_posts enable row level security;
alter table public.recruiting_applications enable row level security;

drop policy if exists "tournaments_select_public" on public.tournaments;
drop policy if exists "tournaments_insert_public" on public.tournaments;
drop policy if exists "tournaments_update_public" on public.tournaments;
drop policy if exists "tournament_teams_select_public" on public.tournament_teams;
drop policy if exists "tournament_teams_insert_public" on public.tournament_teams;
drop policy if exists "tournament_teams_update_public" on public.tournament_teams;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('tournaments', 'tournament_teams')
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and ('public' = any(roles) or 'anon' = any(roles))
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end;
$$;

create policy "tournaments_select_public"
on public.tournaments
for select
to anon, authenticated
using (visibility = 'public');

create policy "tournament_teams_select_public"
on public.tournament_teams
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.tournaments t
    where t.id = tournament_id
      and t.visibility = 'public'
  )
);

create or replace function public.rankball_room_state_participant_ids(p_room_state jsonb)
returns table(profile_id text)
language sql
immutable
set search_path = public
as $$
  with room_state as (
    select coalesce(p_room_state, '{}'::jsonb) as value
  ),
  relation_values as (
    select relation_value.value as raw_value
    from room_state
    cross join lateral jsonb_array_elements_text('["partyLeaders","partyReserves","pinnedReservePlayers"]'::jsonb) as field(name)
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(room_state.value->field.name) = 'object' then room_state.value->field.name
        else '{}'::jsonb
      end
    ) as relation_value(key, value)
  ),
  raw_ids as (
    select raw_value #>> '{}' as profile_id
    from relation_values
    where jsonb_typeof(raw_value) = 'string'

    union all

    select array_value.profile_id
    from relation_values
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(raw_value) = 'array' then raw_value
        else '[]'::jsonb
      end
    ) as array_value(profile_id)

    union all

    select ready.key as profile_id
    from room_state
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(room_state.value->'reserveReady') = 'object' then room_state.value->'reserveReady'
        else '{}'::jsonb
      end
    ) as ready(key, value)
    where ready.value = 'true'::jsonb
  )
  select distinct nullif(btrim(profile_id), '') as profile_id
  from raw_ids
  where nullif(btrim(profile_id), '') is not null;
$$;

grant execute on function public.rankball_room_state_participant_ids(jsonb) to authenticated, service_role;

create table if not exists public.room_chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_type text not null default 'recruiting',
  room_id text not null,
  user_id text not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  message_seq bigint,
  source text not null default 'web',
  external_message_id text,
  external_channel_id text,
  external_thread_id text,
  metadata jsonb not null default '{}'::jsonb,
  constraint room_chat_messages_room_type_check check (room_type in ('recruiting')),
  constraint room_chat_messages_body_length_check check (char_length(btrim(body)) between 1 and 60),
  constraint room_chat_messages_body_plain_text_check check (body !~ '[[:cntrl:]]'),
  constraint room_chat_messages_body_not_empty_check check (char_length(btrim(body)) > 0),
  constraint room_chat_messages_body_no_newline_check check (position(E'\n' in body) = 0 and position(E'\r' in body) = 0),
  constraint room_chat_messages_source_check check (source in ('web', 'discord')),
  constraint room_chat_messages_external_message_check check (
    source <> 'discord'
    or (
      external_message_id ~ '^[0-9]{17,20}$'
      and external_channel_id ~ '^[0-9]{17,20}$'
      and (external_thread_id is null or external_thread_id ~ '^[0-9]{17,20}$')
    )
  )
);

create sequence if not exists public.room_chat_messages_message_seq_seq;

alter sequence public.room_chat_messages_message_seq_seq
  owned by public.room_chat_messages.message_seq;

alter table public.room_chat_messages
  alter column message_seq set default nextval('public.room_chat_messages_message_seq_seq');

alter table public.room_chat_messages
  alter column message_seq set not null;

create index if not exists room_chat_messages_room_created_idx
  on public.room_chat_messages (room_type, room_id, created_at desc, id desc);

create index if not exists room_chat_messages_user_created_idx
  on public.room_chat_messages (user_id, created_at desc);

create index if not exists room_chat_messages_room_seq_idx
  on public.room_chat_messages (room_type, room_id, message_seq);

create index if not exists room_chat_messages_room_user_created_idx
  on public.room_chat_messages (room_type, room_id, user_id, created_at desc);

create unique index if not exists room_chat_messages_discord_message_unique_idx
  on public.room_chat_messages (external_channel_id, coalesce(external_thread_id, ''), external_message_id)
  where source = 'discord' and external_message_id is not null;

create table if not exists public.room_discord_links (
  id uuid primary key default gen_random_uuid(),
  room_type text not null default 'recruiting',
  room_id text not null,
  discord_channel_id text not null,
  discord_thread_id text,
  enabled boolean not null default true,
  created_by text references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_discord_links_room_type_check check (room_type in ('recruiting')),
  constraint room_discord_links_channel_check check (discord_channel_id ~ '^[0-9]{17,20}$'),
  constraint room_discord_links_thread_check check (discord_thread_id is null or discord_thread_id ~ '^[0-9]{17,20}$')
);

create unique index if not exists room_discord_links_room_enabled_unique_idx
  on public.room_discord_links (room_type, room_id)
  where enabled;

create unique index if not exists room_discord_links_discord_target_enabled_unique_idx
  on public.room_discord_links (discord_channel_id, coalesce(discord_thread_id, ''))
  where enabled;

create index if not exists room_discord_links_room_idx
  on public.room_discord_links (room_type, room_id);

alter table public.room_chat_messages enable row level security;

create or replace function public.rankball_can_access_recruiting_room_chat(p_post_id text, p_profile_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_post_id), '') as post_id,
      nullif(btrim(p_profile_id), '') as profile_id
  )
  select exists (
    select 1
    from params
    join public.recruiting_posts post on post.id = params.post_id
    where params.post_id is not null
      and params.profile_id is not null
      and (
        post.player_id = params.profile_id
        or coalesce(post.player_ids, '[]'::jsonb) ? params.profile_id
        or post.room_state->>'ownerId' = params.profile_id
        or post.referee_id = params.profile_id
        or exists (
          select 1
          from public.recruiting_applications application
          where application.post_id = post.id
            and (
              application.player_id = params.profile_id
              or coalesce(application.player_ids, '[]'::jsonb) ? params.profile_id
            )
        )
        or exists (
          select 1
          from public.rankball_room_state_participant_ids(post.room_state) room_profile
          where room_profile.profile_id = params.profile_id
        )
      )
  );
$$;

revoke all on function public.rankball_can_access_recruiting_room_chat(text, text) from public;
grant execute on function public.rankball_can_access_recruiting_room_chat(text, text) to authenticated, service_role;

create or replace function public.rankball_guard_room_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_status text;
  post_confirmed_at timestamptz;
  recent_count integer;
begin
  new.body := btrim(coalesce(new.body, ''));

  if new.room_type <> 'recruiting' then
    raise exception 'chat_not_allowed';
  end if;

  if new.user_id is null or btrim(new.user_id) = '' then
    raise exception 'chat_not_allowed';
  end if;

  if char_length(new.body) = 0
    or char_length(new.body) > 60
    or position(E'\n' in new.body) > 0
    or position(E'\r' in new.body) > 0 then
    raise exception 'chat_message_invalid';
  end if;

  select status, confirmed_at
  into post_status, post_confirmed_at
  from public.recruiting_posts
  where id = new.room_id;

  if not found or coalesce(post_status, '') <> 'open' or post_confirmed_at is not null then
    raise exception 'chat_room_closed';
  end if;

  if exists (
    select 1
    from public.room_chat_messages message
    where message.room_type = new.room_type
      and message.room_id = new.room_id
      and message.user_id = new.user_id
      and message.created_at > now() - interval '3 seconds'
  ) then
    raise exception 'chat_rate_limited';
  end if;

  select count(*)
  into recent_count
  from public.room_chat_messages message
  where message.room_type = new.room_type
    and message.room_id = new.room_id
    and message.user_id = new.user_id
    and message.created_at > now() - interval '1 minute';

  if recent_count >= 6 then
    raise exception 'chat_rate_limited';
  end if;

  if exists (
    select 1
    from public.room_chat_messages message
    where message.room_type = new.room_type
      and message.room_id = new.room_id
      and message.user_id = new.user_id
      and message.body = new.body
      and message.created_at > now() - interval '30 seconds'
  ) then
    raise exception 'chat_rate_limited';
  end if;

  return new;
end;
$$;

revoke all on function public.rankball_guard_room_chat_message() from public;

drop trigger if exists rankball_room_chat_message_guard on public.room_chat_messages;
create trigger rankball_room_chat_message_guard
before insert on public.room_chat_messages
for each row
execute function public.rankball_guard_room_chat_message();

drop policy if exists room_chat_messages_select_related on public.room_chat_messages;
create policy room_chat_messages_select_related
on public.room_chat_messages
for select
to authenticated
using (
  room_type = 'recruiting'
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);

drop policy if exists room_chat_messages_insert_related on public.room_chat_messages;
create policy room_chat_messages_insert_related
on public.room_chat_messages
for insert
to authenticated
with check (
  room_type = 'recruiting'
  and user_id = public.current_profile_id()
  and exists (
    select 1
    from public.recruiting_posts post
    where post.id = room_id
      and post.status = 'open'
      and post.confirmed_at is null
  )
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);

alter table public.room_discord_links enable row level security;

drop policy if exists room_discord_links_select_related on public.room_discord_links;
create policy room_discord_links_select_related
on public.room_discord_links
for select
to authenticated
using (
  room_type = 'recruiting'
  and public.rankball_can_access_recruiting_room_chat(room_id, public.current_profile_id())
);

grant select, insert on public.room_chat_messages to authenticated;
grant all on public.room_chat_messages to service_role;
grant select on public.room_discord_links to authenticated;
grant all on public.room_discord_links to service_role;

drop policy if exists "recruiting_posts_select_public" on public.recruiting_posts;
drop policy if exists "recruiting_posts_select_related_private" on public.recruiting_posts;
drop policy if exists "recruiting_posts_select_related" on public.recruiting_posts;
drop policy if exists recruiting_read_all on public.recruiting_posts;
drop policy if exists recruiting_posts_read_all on public.recruiting_posts;
drop policy if exists recruiting_posts_select_all on public.recruiting_posts;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'recruiting_posts'
      and cmd = 'SELECT'
      and qual in ('true', '(true)')
  loop
    execute format('drop policy if exists %I on public.recruiting_posts', policy_row.policyname);
  end loop;
end;
$$;

create policy "recruiting_posts_select_related"
on public.recruiting_posts
for select
to authenticated
using (
  player_id = public.current_profile_id()
  or player_ids ? public.current_profile_id()
  or room_state->>'ownerId' = public.current_profile_id()
  or referee_id = public.current_profile_id()
  or exists (
    select 1
    from public.rankball_room_state_participant_ids(room_state) room_profile
    where room_profile.profile_id = public.current_profile_id()
  )
  or exists (
    select 1
    from jsonb_array_elements(coalesce(room_state->'invitations', '[]'::jsonb)) invitation
    where invitation->>'targetUserId' = public.current_profile_id()
       or invitation->>'fromUserId' = public.current_profile_id()
  )
);

do $$
begin
  if to_regclass('public.team_members') is not null then
    execute '
      update public.team_members
      set role = case
        when role in (''captain'', ''regular'', ''mercenary'') then role
        when role = ''guest'' then ''mercenary''
        else ''regular''
      end
      where role is null
         or role not in (''captain'', ''regular'', ''mercenary'')
    ';
    execute 'alter table public.team_members drop constraint if exists team_members_role_check';
    execute '
      alter table public.team_members
      add constraint team_members_role_check
      check (role in (''captain'', ''regular'', ''mercenary''))
      not valid
    ';
    execute 'alter table public.team_members validate constraint team_members_role_check';
    execute 'drop trigger if exists team_members_limit_3 on public.team_members';
    execute '
      create trigger team_members_limit_3
      before insert or update of user_id, team_id on public.team_members
      for each row
      execute function public.enforce_team_membership_limit()
    ';
  end if;
end;
$$;

update public.recruiting_posts
set bench_capacity = case
  when coalesce(rules->>'benchCapacity', '') ~ '^[0-3]$' then (rules->>'benchCapacity')::smallint
  else 2
end
where bench_capacity is distinct from case
  when coalesce(rules->>'benchCapacity', '') ~ '^[0-3]$' then (rules->>'benchCapacity')::smallint
  else 2
end;

update public.recruiting_posts
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{benchCapacity}', to_jsonb(bench_capacity), true)
where rules->>'benchCapacity' is distinct from bench_capacity::text;

create or replace function public.rankball_normalize_recruiting_bench_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_capacity text;
  safe_capacity integer;
begin
  if tg_op = 'INSERT' then
    raw_capacity := coalesce(new.rules->>'benchCapacity', new.bench_capacity::text, '2');
  elsif new.bench_capacity is distinct from old.bench_capacity then
    raw_capacity := new.bench_capacity::text;
  elsif (new.rules->>'benchCapacity') is distinct from (old.rules->>'benchCapacity') then
    raw_capacity := new.rules->>'benchCapacity';
  else
    raw_capacity := old.bench_capacity::text;
  end if;

  if coalesce(raw_capacity, '') !~ '^[0-3]$' then
    raise exception 'invalid_bench_capacity' using errcode = '23514';
  end if;
  safe_capacity := raw_capacity::integer;
  new.bench_capacity := safe_capacity;
  new.rules := jsonb_set(coalesce(new.rules, '{}'::jsonb), '{benchCapacity}', to_jsonb(safe_capacity), true);
  return new;
end;
$$;

drop trigger if exists normalize_recruiting_bench_capacity on public.recruiting_posts;
create trigger normalize_recruiting_bench_capacity
before insert or update of bench_capacity, rules on public.recruiting_posts
for each row execute function public.rankball_normalize_recruiting_bench_capacity();

create or replace function public.rankball_recruiting_side_bench_count(
  p_post_id text,
  p_side text
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with post_row as (
    select * from public.recruiting_posts where id = p_post_id
  ), application_rows as (
    select * from public.recruiting_applications where post_id = p_post_id
  ), bench_ids as (
    select reserve_id as player_id
    from post_row post
    cross join lateral jsonb_array_elements_text(
      case
        when post.host_side = p_side and jsonb_typeof(post.room_state #> '{partyReserves,host}') = 'array'
          then post.room_state #> '{partyReserves,host}'
        else '[]'::jsonb
      end
    ) reserve(reserve_id)

    union

    select reserve_id
    from post_row post
    join application_rows application on application.side = p_side
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(post.room_state #> array[
          'partyReserves',
          case when application.kind = 'team' and application.team_id is not null
            then 'team:' || application.team_id
            else 'player:' || application.player_id
          end
        ]) = 'array'
          then post.room_state #> array[
            'partyReserves',
            case when application.kind = 'team' and application.team_id is not null
              then 'team:' || application.team_id
              else 'player:' || application.player_id
            end
          ]
        else '[]'::jsonb
      end
    ) reserve(reserve_id)

    union

    select reserve_id
    from application_rows application
    cross join lateral jsonb_array_elements_text(
      case
        when application.side <> p_side or application.reserve = false then '[]'::jsonb
        when jsonb_typeof(application.player_ids) = 'array' and jsonb_array_length(application.player_ids) > 0
          then application.player_ids
        else jsonb_build_array(application.player_id)
      end
    ) reserve(reserve_id)

    union

    select reserve_id
    from post_row post
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(post.room_state #> array['pinnedReservePlayers', p_side]) = 'array'
        then post.room_state #> array['pinnedReservePlayers', p_side]
        else '[]'::jsonb
      end
    ) reserve(reserve_id)

    union

    select invitation->>'targetUserId'
    from post_row post
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(post.room_state->'invitations') = 'array'
        then post.room_state->'invitations'
        else '[]'::jsonb
      end
    ) invitation
    where invitation->>'role' <> 'referee'
      and coalesce(invitation->>'status', 'pending') = 'pending'
      and lower(coalesce(invitation->>'reserve', 'false')) in ('true', 't', '1', 'yes', 'on')
      and coalesce(invitation->>'side', 'teamB') = p_side
  )
  select count(distinct player_id)::integer
  from bench_ids
  where nullif(btrim(player_id), '') is not null
$$;

create or replace function public.rankball_validate_recruiting_bench_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_post_id text;
  safe_capacity integer;
begin
  if tg_table_name = 'recruiting_posts' then
    safe_post_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    safe_post_id := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
  end if;
  select bench_capacity into safe_capacity
  from public.recruiting_posts
  where id = safe_post_id;
  if safe_capacity is null then return null; end if;

  if public.rankball_recruiting_side_bench_count(safe_post_id, 'teamA') > safe_capacity
     or public.rankball_recruiting_side_bench_count(safe_post_id, 'teamB') > safe_capacity then
    raise exception 'recruiting_reserve_full' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists validate_recruiting_post_bench_capacity on public.recruiting_posts;
create constraint trigger validate_recruiting_post_bench_capacity
after insert or update of bench_capacity, rules, room_state, host_side on public.recruiting_posts
deferrable initially deferred
for each row execute function public.rankball_validate_recruiting_bench_capacity();

drop trigger if exists validate_recruiting_application_bench_capacity on public.recruiting_applications;
create constraint trigger validate_recruiting_application_bench_capacity
after insert or update or delete on public.recruiting_applications
deferrable initially deferred
for each row execute function public.rankball_validate_recruiting_bench_capacity();

revoke all on function public.rankball_normalize_recruiting_bench_capacity() from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_side_bench_count(text, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_validate_recruiting_bench_capacity() from public, anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.teams') is not null and to_regclass('public.profiles') is not null then
    execute '
      create table if not exists public.team_invitations (
        id text primary key,
        team_id text not null references public.teams(id) on delete cascade,
        from_user_id text not null references public.profiles(id) on delete cascade,
        target_user_id text not null references public.profiles(id) on delete cascade,
        status text not null default ''pending'',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint team_invitations_status_check check (status in (''pending'', ''accepted'', ''declined'', ''cancelled'', ''expired''))
      )
    ';
    execute 'alter table public.team_invitations add column if not exists role text not null default ''regular''';
    execute '
      update public.team_invitations
      set role = case
        when role = ''mercenary'' or role = ''guest'' then ''mercenary''
        else ''regular''
      end
      where role is null
         or role not in (''regular'', ''mercenary'')
    ';
    execute 'alter table public.team_invitations drop constraint if exists team_invitations_role_check';
    execute '
      alter table public.team_invitations
      add constraint team_invitations_role_check
      check (role in (''regular'', ''mercenary''))
      not valid
    ';
  end if;

  if to_regclass('public.team_invitations') is not null then
    execute 'alter table public.team_invitations validate constraint team_invitations_role_check';
    execute 'create index if not exists team_invitations_team_status_idx on public.team_invitations (team_id, status)';
    execute 'create index if not exists team_invitations_target_status_idx on public.team_invitations (target_user_id, status)';
    execute 'create unique index if not exists team_invitations_one_pending_target on public.team_invitations (team_id, target_user_id) where status = ''pending''';
    execute 'alter table public.team_invitations enable row level security';
    execute 'drop policy if exists team_invitations_related_read on public.team_invitations';
    execute '
      create policy team_invitations_related_read
      on public.team_invitations
      for select
      to authenticated
      using (
        from_user_id = public.current_profile_id()
        or target_user_id = public.current_profile_id()
        or exists (
          select 1
          from public.team_members tm
          where tm.team_id = team_invitations.team_id
            and tm.user_id = public.current_profile_id()
            and tm.role = ''captain''
        )
      )
    ';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.teams') is not null then
    execute 'alter table public.teams add column if not exists deleted_at timestamptz';
    execute 'create index if not exists teams_deleted_at_idx on public.teams (deleted_at)';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.tournaments') is not null then
    execute 'alter table public.tournaments add column if not exists started_at timestamptz';
    execute 'alter table public.tournaments add column if not exists match_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.tournaments add column if not exists team_statuses jsonb not null default ''{}''::jsonb';
    execute 'alter table public.tournaments add column if not exists team_approvals jsonb not null default ''{}''::jsonb';
    execute 'alter table public.tournaments add column if not exists bracket jsonb not null default ''{}''::jsonb';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.tournament_teams') is not null then
    execute 'alter table public.tournament_teams add column if not exists approved_by text';
    execute 'alter table public.tournament_teams add column if not exists approved_at timestamptz';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.affiliations') is not null then
    execute 'delete from public.affiliations where type = ''club''';
    execute 'alter table public.affiliations drop constraint if exists affiliations_type_check';
    execute 'alter table public.affiliations add constraint affiliations_type_check check (type in (''region'', ''school'', ''company''))';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.matches') is not null then
    execute 'alter table public.matches add column if not exists title text not null default ''Match''';
    execute 'alter table public.matches add column if not exists mode text not null default ''5v5''';
    execute 'alter table public.matches add column if not exists court_id text';
    execute 'alter table public.matches add column if not exists court_name text';
    execute 'alter table public.matches add column if not exists visibility text not null default ''public''';
    execute 'alter table public.matches add column if not exists status text not null default ''contract''';
    execute 'alter table public.matches add column if not exists ranked boolean not null default true';
    execute 'alter table public.matches add column if not exists official boolean not null default false';
    execute 'alter table public.matches add column if not exists pre_registered boolean not null default true';
    execute 'alter table public.matches add column if not exists scheduled_at text';
    execute 'alter table public.matches add column if not exists scheduled_date date';
    execute 'alter table public.matches add column if not exists scheduled_time time';
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'matches'
        and column_name = 'scheduled_at'
        and data_type <> 'text'
    ) then
      execute 'alter table public.matches alter column scheduled_at type text using scheduled_at::text';
    end if;
    execute 'alter table public.matches add column if not exists team_a_id text';
    execute 'alter table public.matches add column if not exists team_b_id text';
    execute 'alter table public.matches add column if not exists score_a integer not null default 0';
    execute 'alter table public.matches add column if not exists score_b integer not null default 0';
    execute 'alter table public.matches add column if not exists rules jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists memo text';
    execute 'alter table public.matches add column if not exists stakes text';
    execute 'alter table public.matches add column if not exists objection_window text';
    execute 'alter table public.matches add column if not exists evidence jsonb not null default ''[]''::jsonb';
    execute 'alter table public.matches add column if not exists created_by text';
    execute 'alter table public.matches add column if not exists created_at timestamptz not null default now()';
    execute 'alter table public.matches add column if not exists agreed_at timestamptz';
    execute 'alter table public.matches add column if not exists started_at timestamptz';
    execute 'alter table public.matches add column if not exists mmr_limit_mode text not null default ''block''';
    execute 'alter table public.matches add column if not exists referee_id text';
    execute 'alter table public.matches add column if not exists referee_trust_min integer not null default 90';
    execute 'alter table public.matches add column if not exists stat_entry_minutes integer not null default 60';
    execute 'alter table public.matches add column if not exists dispute_minutes integer not null default 15';
    execute 'alter table public.matches add column if not exists ended_at timestamptz';
    execute 'alter table public.matches add column if not exists confirmed_at timestamptz';
    execute 'alter table public.matches add column if not exists cancelled_at timestamptz';
    execute 'alter table public.matches add column if not exists voided_at timestamptz';
    execute 'alter table public.matches add column if not exists trust_feedback jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists stat_recorders jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists played_player_ids jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists reserve_players jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists promoted_reserve_ids jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists attendance jsonb not null default ''{"teamA":[],"teamB":[]}''::jsonb';
    execute 'alter table public.matches add column if not exists referee_absence_request jsonb';
    execute 'alter table public.matches add column if not exists former_referee_id text';
    execute 'alter table public.matches add column if not exists dispute_draft_result jsonb';
    execute 'alter table public.matches add column if not exists dispute_draft_updated_at timestamptz';
    execute 'alter table public.matches add column if not exists dispute_resolved_at timestamptz';
    execute 'alter table public.matches add column if not exists mmr_excluded_player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.matches add column if not exists anonymous_players jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists rating_result jsonb';
    execute 'alter table public.matches add column if not exists team_rating_result jsonb';
    execute 'alter table public.matches add column if not exists updated_at timestamptz not null default now()';
    execute 'alter table public.matches drop constraint if exists matches_visibility_check';
    execute 'alter table public.matches add constraint matches_visibility_check check (visibility in (''public'', ''private''))';
    execute 'create index if not exists matches_visibility_idx on public.matches (visibility, created_at desc)';
    execute 'create index if not exists matches_referee_id_idx on public.matches (referee_id)';
  end if;
end;
$$;

update public.matches
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{benchCapacity}', '2'::jsonb, true)
where coalesce(rules->>'benchCapacity', '') !~ '^[0-3]$';

create or replace function public.rankball_normalize_match_bench_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_capacity text;
  safe_capacity integer;
  team_a_count integer;
  team_b_count integer;
  is_team_match_record boolean;
begin
  is_team_match_record := coalesce(new.rules->>'recordType', '') = 'match_record'
    and coalesce(new.rules->>'recordComposition', '') = 'team';
  raw_capacity := coalesce(
    new.rules->>'benchCapacity',
    case when tg_op = 'UPDATE' then old.rules->>'benchCapacity' end,
    '2'
  );
  if is_team_match_record then
    safe_capacity := 3;
  else
    if coalesce(raw_capacity, '') !~ '^[0-3]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    safe_capacity := raw_capacity::integer;
  end if;
  team_a_count := jsonb_array_length(case when jsonb_typeof(new.reserve_players->'teamA') = 'array' then new.reserve_players->'teamA' else '[]'::jsonb end);
  team_b_count := jsonb_array_length(case when jsonb_typeof(new.reserve_players->'teamB') = 'array' then new.reserve_players->'teamB' else '[]'::jsonb end);
  if team_a_count > safe_capacity or team_b_count > safe_capacity then
    raise exception 'match_reserve_exceeds_bench_capacity' using errcode = '23514';
  end if;
  new.rules := jsonb_set(coalesce(new.rules, '{}'::jsonb), '{benchCapacity}', to_jsonb(safe_capacity), true);
  return new;
end;
$$;

drop trigger if exists normalize_match_bench_capacity on public.matches;
create trigger normalize_match_bench_capacity
before insert or update of rules, reserve_players on public.matches
for each row execute function public.rankball_normalize_match_bench_capacity();

revoke all on function public.rankball_normalize_match_bench_capacity() from public, anon, authenticated, service_role;

do $$
begin
  if to_regclass('public.matches') is not null then
    execute 'alter table public.matches add column if not exists tournament_id text';
    execute 'alter table public.matches add column if not exists tournament_format text';
    execute 'alter table public.matches add column if not exists tournament_round integer';
    execute 'alter table public.matches add column if not exists tournament_fixture integer';
    execute 'alter table public.matches add column if not exists tournament_mmr_policy text';
    execute 'create index if not exists matches_tournament_id_idx on public.matches (tournament_id)';
    execute 'alter table public.matches drop constraint if exists matches_mmr_limit_mode_check';
    execute 'alter table public.matches add constraint matches_mmr_limit_mode_check check (mmr_limit_mode in (''off'', ''warn'', ''block''))';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.match_results') is not null then
    execute 'alter table public.match_results add column if not exists score_a integer not null default 0';
    execute 'alter table public.match_results add column if not exists score_b integer not null default 0';
    execute 'update public.match_results set score_a = 0 where score_a is null';
    execute 'update public.match_results set score_b = 0 where score_b is null';
    execute 'alter table public.match_results add column if not exists stat_submissions jsonb not null default ''{}''::jsonb';
    execute 'alter table public.match_results add column if not exists submitted_by text';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.player_match_stats') is not null then
    execute 'alter table public.player_match_stats add column if not exists recorded_by text';
    execute 'alter table public.player_match_stats add column if not exists record_source text not null default ''player''';
    execute 'alter table public.player_match_stats add column if not exists fouls integer not null default 0';
    execute 'update public.player_match_stats set fouls = 0 where fouls is null';
    execute 'alter table public.player_match_stats drop constraint if exists player_match_stats_record_source_check';
    execute 'alter table public.player_match_stats add constraint player_match_stats_record_source_check check (record_source in (''player'', ''referee'', ''candidate_recorder'', ''host_postgame'', ''dispute_operator''))';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.recruiting_posts') is not null then
    execute 'alter table public.recruiting_posts add column if not exists visibility text not null default ''public''';
    execute 'alter table public.recruiting_posts add column if not exists official boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists pre_registered boolean not null default true';
    execute 'alter table public.recruiting_posts add column if not exists rating_scale numeric not null default 1';
    execute 'alter table public.recruiting_posts add column if not exists age_restriction text';
    execute 'alter table public.recruiting_posts add column if not exists allowed_age_groups jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists rules jsonb not null default ''{}''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists stakes text';
    execute 'alter table public.recruiting_posts add column if not exists court_reserved boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists court_fee text';
    execute 'alter table public.recruiting_posts add column if not exists host_join_mode text not null default ''team''';
    execute 'alter table public.recruiting_posts add column if not exists host_side text not null default ''teamA''';
    execute 'alter table public.recruiting_posts add column if not exists host_ready boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists side_capacity integer not null default 5';
    execute 'alter table public.recruiting_posts add column if not exists target_team_id text';
    execute 'alter table public.recruiting_posts add column if not exists referee_id text';
    execute 'alter table public.recruiting_posts add column if not exists referee_trust_min integer not null default 90';
    execute 'alter table public.recruiting_posts add column if not exists stat_entry_minutes integer not null default 60';
    execute 'alter table public.recruiting_posts add column if not exists dispute_minutes integer not null default 15';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.recruiting_posts') is not null then
    execute 'alter table public.recruiting_posts add column if not exists scheduled_date date';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_time time';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_at text';
    execute 'alter table public.recruiting_posts add column if not exists confirmed_at timestamptz';
    execute 'alter table public.recruiting_posts add column if not exists player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists room_state jsonb not null default ''{}''::jsonb';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_host_join_mode_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_host_join_mode_check check (host_join_mode in (''player'', ''team''))';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_host_side_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_host_side_check check (host_side in (''teamA'', ''teamB''))';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_side_capacity_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_side_capacity_check check (side_capacity between 1 and 5)';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_visibility_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_visibility_check check (visibility in (''public'', ''private''))';
  end if;
end;
$$;

do $$
declare
  policy_name text;
begin
  if to_regclass('public.recruiting_applications') is not null then
    execute 'alter table public.recruiting_applications enable row level security';
    execute 'alter table public.recruiting_applications add column if not exists side text not null default ''teamB''';
    execute 'alter table public.recruiting_applications add column if not exists status text not null default ''waiting''';
    execute 'alter table public.recruiting_applications add column if not exists reserve boolean not null default false';
    execute 'alter table public.recruiting_applications add column if not exists position text';
    execute 'alter table public.recruiting_applications add column if not exists player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_applications add column if not exists source_team_id text';
    execute 'alter table public.recruiting_applications add column if not exists source_entry_id text';
    execute 'alter table public.recruiting_applications add column if not exists updated_at timestamptz';
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_kind_check';
    execute 'alter table public.recruiting_applications add constraint recruiting_applications_kind_check check (kind in (''player'', ''team''))';
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_side_check';
    execute 'alter table public.recruiting_applications add constraint recruiting_applications_side_check check (side in (''teamA'', ''teamB''))';
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_status_check';
    execute 'alter table public.recruiting_applications add constraint recruiting_applications_status_check check (status in (''waiting'', ''ready'', ''confirmed''))';
    execute 'create index if not exists recruiting_applications_post_side_idx on public.recruiting_applications (post_id, side, reserve)';

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'recruiting_applications'
        and cmd in ('SELECT', 'ALL')
    loop
      execute format('drop policy if exists %I on public.recruiting_applications', policy_name);
    end loop;

    if to_regclass('public.recruiting_posts') is not null then
      execute '
        create policy recruiting_applications_related_user_read
        on public.recruiting_applications
        for select
        to authenticated
        using (
          player_id = public.current_profile_id()
          or player_ids ? public.current_profile_id()
          or exists (
            select 1
            from public.recruiting_posts post
            where post.id = recruiting_applications.post_id
              and (
                post.player_id = public.current_profile_id()
                or post.player_ids ? public.current_profile_id()
                or post.room_state->>''ownerId'' = public.current_profile_id()
                or post.referee_id = public.current_profile_id()
                or exists (
                  select 1
                  from public.rankball_room_state_participant_ids(post.room_state) room_profile
                  where room_profile.profile_id = public.current_profile_id()
                )
                or exists (
                  select 1
                  from jsonb_array_elements(coalesce(post.room_state->''invitations'', ''[]''::jsonb)) invitation
                  where invitation->>''targetUserId'' = public.current_profile_id()
                     or invitation->>''fromUserId'' = public.current_profile_id()
                )
              )
          )
        )
      ';
    else
      execute '
        create policy recruiting_applications_related_user_read
        on public.recruiting_applications
        for select
        to authenticated
        using (
          player_id = public.current_profile_id()
          or player_ids ? public.current_profile_id()
        )
      ';
    end if;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.affiliations') is not null then
    execute 'alter table public.affiliations enable row level security';
    execute 'drop policy if exists affiliations_read_all on public.affiliations';
    execute 'create policy affiliations_read_all on public.affiliations for select to public using (true)';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.seasons') is not null then
    execute 'alter table public.seasons enable row level security';
    execute 'drop policy if exists seasons_read_all on public.seasons';
    execute 'create policy seasons_read_all on public.seasons for select to public using (true)';
  end if;
end;
$$;

create table if not exists public.notifications (
  id text primary key,
  user_id text,
  target_user_id text,
  title text not null,
  body text,
  tone text,
  type text,
  match_id text,
  recruiting_post_id text,
  invitation_id text,
  discord_event text,
  read_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id text primary key,
  type text not null,
  target_id text not null,
  user_id text,
  reported_user_ids jsonb not null default '[]'::jsonb,
  reason text not null,
  status text not null default 'open',
  resolved_at timestamptz,
  resolved_by text,
  resolution jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.court_requests (
  id text primary key,
  requested_by text,
  status text not null default 'pending',
  name text not null,
  hashtag text,
  address_text text not null,
  road_address text,
  jibun_address text,
  zonecode text,
  lat double precision,
  lng double precision,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.court_requests') is not null
    and not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.court_requests'::regclass
        and conname = 'court_requests_pending_pin_required'
    ) then
    alter table public.court_requests
      add constraint court_requests_pending_pin_required
      check (status <> 'pending' or (lat is not null and lng is not null)) not valid;
  end if;
end;
$$;

create table if not exists public.approved_courts (
  id text primary key,
  source_request_id text,
  approved_by text,
  status text not null default 'active',
  name text not null,
  hashtag text,
  address_text text not null,
  road_address text,
  jibun_address text,
  zonecode text,
  lat double precision,
  lng double precision,
  region_key text,
  hidden_at timestamptz,
  hidden_by text,
  hidden_reason text,
  payload jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.court_reviews (
  id text primary key,
  court_id text not null,
  court_name text,
  match_id text not null,
  reviewer_id text not null,
  rating integer not null,
  surface_rating integer,
  rim_rating integer,
  lighting_rating integer,
  crowd_rating integer,
  location_accuracy integer,
  fit_modes jsonb not null default '[]'::jsonb,
  tags jsonb not null default '[]'::jsonb,
  memo text,
  status text not null default 'active',
  hidden_at timestamptz,
  hidden_by text,
  hidden_reason text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint court_reviews_rating_check check (rating between 1 and 5),
  constraint court_reviews_surface_rating_check check (surface_rating is null or surface_rating between 1 and 5),
  constraint court_reviews_rim_rating_check check (rim_rating is null or rim_rating between 1 and 5),
  constraint court_reviews_lighting_rating_check check (lighting_rating is null or lighting_rating between 1 and 5),
  constraint court_reviews_crowd_rating_check check (crowd_rating is null or crowd_rating between 1 and 5),
  constraint court_reviews_location_accuracy_check check (location_accuracy is null or location_accuracy between 1 and 5)
);

create unique index if not exists court_reviews_match_reviewer_unique
on public.court_reviews (match_id, reviewer_id);
create index if not exists court_reviews_court_id_idx
on public.court_reviews (court_id, created_at desc);

do $$
begin
  if to_regclass('public.approved_courts') is not null then
    execute 'alter table public.approved_courts add column if not exists status text not null default ''active''';
    execute 'alter table public.approved_courts add column if not exists hidden_at timestamptz';
    execute 'alter table public.approved_courts add column if not exists hidden_by text';
    execute 'alter table public.approved_courts add column if not exists hidden_reason text';
    execute 'alter table public.approved_courts drop constraint if exists approved_courts_status_check';
    execute 'alter table public.approved_courts add constraint approved_courts_status_check check (status in (''active'', ''hidden'', ''disabled''))';
  end if;

  if to_regclass('public.court_reviews') is not null then
    execute 'alter table public.court_reviews add column if not exists status text not null default ''active''';
    execute 'alter table public.court_reviews add column if not exists hidden_at timestamptz';
    execute 'alter table public.court_reviews add column if not exists hidden_by text';
    execute 'alter table public.court_reviews add column if not exists hidden_reason text';
    execute 'alter table public.court_reviews drop constraint if exists court_reviews_status_check';
    execute 'alter table public.court_reviews add constraint court_reviews_status_check check (status in (''active'', ''hidden''))';
  end if;
end;
$$;

create or replace function public.rankball_submit_court_request(
  actor_profile_id text,
  request_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_id text := nullif(btrim(request_payload->>'id'), '');
  safe_name text := nullif(btrim(request_payload->>'name'), '');
  safe_hashtag text := nullif(btrim(request_payload->>'hashtag'), '');
  safe_address_text text := nullif(btrim(request_payload->>'addressText'), '');
  safe_road_address text := nullif(btrim(request_payload->>'roadAddress'), '');
  safe_jibun_address text := nullif(btrim(request_payload->>'jibunAddress'), '');
  safe_zonecode text := nullif(btrim(request_payload->>'zonecode'), '');
  safe_lat double precision := nullif(request_payload->>'lat', '')::double precision;
  safe_lng double precision := nullif(request_payload->>'lng', '')::double precision;
  identity_address text;
  actor_trust integer := 0;
  safe_payload jsonb;
begin
  if actor_profile_id is null or btrim(actor_profile_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;

  if safe_id is null then
    safe_id := 'cr_' || md5(actor_profile_id || now_ts::text || random()::text);
  end if;

  if safe_name is null or safe_address_text is null then
    raise exception 'missing_court_request_fields' using errcode = '22023';
  end if;

  if safe_lat is null or safe_lng is null then
    raise exception 'court_pin_required' using errcode = '22023';
  end if;

  if safe_lat is not null and (safe_lat < -90 or safe_lat > 90) then
    raise exception 'invalid_latitude' using errcode = '22023';
  end if;

  if safe_lng is not null and (safe_lng < -180 or safe_lng > 180) then
    raise exception 'invalid_longitude' using errcode = '22023';
  end if;

  select coalesce(trust_score, 80)
  into actor_trust
  from public.profiles
  where id = actor_profile_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if actor_trust < 70 then
    raise exception 'court_request_trust_required' using errcode = '42501';
  end if;

  identity_address := lower(coalesce(nullif(safe_road_address, ''), nullif(safe_jibun_address, ''), safe_address_text));

  if exists (
    select 1
    from public.court_requests
    where id = safe_id
      and (coalesce(requested_by, '') <> actor_profile_id or status <> 'pending')
  ) then
    raise exception 'court_request_locked' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.approved_courts
    where lower(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text)) = identity_address
      and coalesce(zonecode, '') = coalesce(safe_zonecode, '')
  ) then
    raise exception 'duplicate_approved_court' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.court_requests
    where id <> safe_id
      and status in ('pending', 'reported')
      and lower(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text)) = identity_address
      and coalesce(zonecode, '') = coalesce(safe_zonecode, '')
  ) then
    raise exception 'duplicate_pending_court_request' using errcode = '23505';
  end if;

  safe_payload := request_payload
    || jsonb_build_object(
      'id', safe_id,
      'requestedBy', actor_profile_id,
      'requestedByTrustScore', actor_trust,
      'status', 'pending',
      'name', safe_name,
      'hashtag', safe_hashtag,
      'addressText', safe_address_text,
      'roadAddress', safe_road_address,
      'jibunAddress', safe_jibun_address,
      'zonecode', safe_zonecode,
      'lat', safe_lat,
      'lng', safe_lng,
      'createdAt', coalesce(request_payload->>'createdAt', now_ts::text),
      'updatedAt', now_ts
    );

  insert into public.court_requests (
    id,
    requested_by,
    status,
    name,
    hashtag,
    address_text,
    road_address,
    jibun_address,
    zonecode,
    lat,
    lng,
    payload,
    created_at,
    updated_at
  )
  values (
    safe_id,
    actor_profile_id,
    'pending',
    safe_name,
    safe_hashtag,
    safe_address_text,
    safe_road_address,
    safe_jibun_address,
    safe_zonecode,
    safe_lat,
    safe_lng,
    safe_payload,
    coalesce(nullif(request_payload->>'createdAt', '')::timestamptz, now_ts),
    now_ts
  )
  on conflict (id) do update set
    status = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then 'pending' else public.court_requests.status end,
    name = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.name else public.court_requests.name end,
    hashtag = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.hashtag else public.court_requests.hashtag end,
    address_text = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.address_text else public.court_requests.address_text end,
    road_address = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.road_address else public.court_requests.road_address end,
    jibun_address = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.jibun_address else public.court_requests.jibun_address end,
    zonecode = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.zonecode else public.court_requests.zonecode end,
    lat = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.lat else public.court_requests.lat end,
    lng = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.lng else public.court_requests.lng end,
    payload = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then excluded.payload else public.court_requests.payload end,
    updated_at = case when public.court_requests.requested_by = actor_profile_id and public.court_requests.status = 'pending' then now_ts else public.court_requests.updated_at end;

  return jsonb_build_object('ok', true, 'requestId', safe_id);
end;
$$;

create table if not exists public.referee_requests (
  id text primary key,
  requested_by text,
  status text not null default 'pending',
  qualification text,
  trust_score integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referee_exam_attempts (
  id text primary key,
  user_id text,
  status text not null default 'started',
  exam_version text,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  available_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_appointments (
  id text primary key,
  user_id text,
  role text not null default 'admin',
  grade text,
  status text not null default 'active',
  appointed_by text,
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referee_appointments (
  id text primary key,
  user_id text,
  role text not null default 'referee',
  grade text,
  status text not null default 'active',
  appointed_by text,
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id text primary key,
  type text,
  status text,
  report_id text,
  request_id text,
  appointment_id text,
  target_user_id text,
  created_by text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_disciplinary_actions (
  id text primary key,
  user_id text,
  type text,
  action_type text,
  status text not null default 'active',
  source_report_id text,
  created_by text,
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discord_notification_deliveries (
  id text primary key,
  notification_id text,
  target_user_id text,
  discord_user_id text,
  event text,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  queued_at timestamptz,
  send_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.discord_notification_deliveries
  add column if not exists send_at timestamptz not null default now();

alter table if exists public.discord_notification_deliveries
  add column if not exists last_error text;

update public.discord_notification_deliveries
set send_at = coalesce(send_at, queued_at, created_at, now())
where send_at is null;

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

create or replace function public.rankball_is_match_actor(target_match_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_id text := public.current_profile_id();
begin
  if public.current_is_admin(30) then
    return true;
  end if;

  if profile_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.matches m
    where m.id = target_match_id
      and profile_id in (m.created_by, m.referee_id, m.former_referee_id)
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.match_players mp
    where mp.match_id = target_match_id
      and mp.user_id = profile_id
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.matches m
    where m.id = target_match_id
      and (
        jsonb_path_exists(coalesce(m.reserve_players, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
        or jsonb_path_exists(coalesce(m.played_player_ids, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
        or jsonb_path_exists(coalesce(m.stat_recorders, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
      )
  ) then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.rankball_can_read_match(target_match_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.matches m
    where m.id = target_match_id
      and coalesce(m.visibility, 'public') = 'public'
  ) then
    return true;
  end if;

  return public.rankball_is_match_actor(target_match_id);
end;
$$;

create or replace function public.rankball_can_read_private_tournament(target_tournament_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_id text := public.current_profile_id();
  owner_id text;
  is_public boolean;
  allowed boolean := false;
begin
  select created_by, visibility = 'public'
  into owner_id, is_public
  from public.tournaments
  where id = target_tournament_id;

  if not found then
    return false;
  end if;

  if is_public then
    return true;
  end if;

  if public.current_is_admin(30) then
    return true;
  end if;

  if profile_id is null then
    return false;
  end if;

  if owner_id = profile_id then
    return true;
  end if;

  if exists (
    select 1
    from public.tournament_teams tt
    where tt.tournament_id = target_tournament_id
      and tt.approved_by = profile_id
  ) then
    return true;
  end if;

  if to_regclass('public.team_members') is not null then
    execute '
      select exists (
        select 1
        from public.tournament_teams tt
        join public.team_members tm on tm.team_id = tt.team_id
        where tt.tournament_id = $1
          and tm.user_id = $2
      )
    '
    into allowed
    using target_tournament_id, profile_id;
  end if;

  return allowed;
end;
$$;

drop policy if exists "tournaments_select_private_related" on public.tournaments;
create policy "tournaments_select_private_related"
on public.tournaments
for select
to authenticated
using (public.rankball_can_read_private_tournament(id));

drop policy if exists "tournament_teams_select_private_related" on public.tournament_teams;
create policy "tournament_teams_select_private_related"
on public.tournament_teams
for select
to authenticated
using (public.rankball_can_read_private_tournament(tournament_id));

create or replace function public.rankball_admin_level_for_profile(actor_profile_id text, override_level integer default 0)
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

create or replace function public.rankball_approve_court_request(
  actor_profile_id text,
  actor_admin_level integer,
  request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  duplicate_id text;
  approved_id text;
  now_ts timestamptz := now();
  approved_payload jsonb;
begin
  if public.rankball_admin_level_for_profile(actor_profile_id, actor_admin_level) < 30 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;

  select id into duplicate_id
  from public.approved_courts
  where lower(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text)) =
    lower(coalesce(nullif(request_row.road_address, ''), nullif(request_row.jibun_address, ''), request_row.address_text))
    and coalesce(zonecode, '') = coalesce(request_row.zonecode, '')
    and source_request_id is distinct from request_row.id
  limit 1;

  if duplicate_id is not null then
    raise exception 'court_duplicate:%', duplicate_id using errcode = '23505';
  end if;

  approved_id := coalesce(
    (
      select id
      from public.approved_courts
      where source_request_id = request_row.id
      limit 1
    ),
    'court_' || request_row.id
  );

  approved_payload := jsonb_build_object(
    'id', approved_id,
    'name', request_row.name,
    'hashtag', request_row.hashtag,
    'addressText', request_row.address_text,
    'roadAddress', request_row.road_address,
    'jibunAddress', request_row.jibun_address,
    'zonecode', request_row.zonecode,
    'lat', request_row.lat,
    'lng', request_row.lng,
    'region', request_row.payload->>'region',
    'type', request_row.payload->>'type',
    'baseName', request_row.payload->>'baseName',
    'addressDong', request_row.payload->>'addressDong',
    'detailAddress', request_row.payload->>'detailAddress',
    'locationNote', request_row.payload->>'locationNote',
    'courtKind', request_row.payload->>'courtKind',
    'surfaceType', request_row.payload->>'surfaceType',
    'courtLayout', request_row.payload->>'courtLayout',
    'paid', coalesce(request_row.payload->'paid', 'false'::jsonb),
    'approvedAt', now_ts,
    'favorite', false
  );

  insert into public.approved_courts (
    id,
    source_request_id,
    approved_by,
    name,
    hashtag,
    address_text,
    road_address,
    jibun_address,
    zonecode,
    lat,
    lng,
    payload,
    approved_at,
    created_at,
    updated_at
  )
  values (
    approved_id,
    request_row.id,
    actor_profile_id,
    request_row.name,
    request_row.hashtag,
    request_row.address_text,
    request_row.road_address,
    request_row.jibun_address,
    request_row.zonecode,
    request_row.lat,
    request_row.lng,
    approved_payload,
    now_ts,
    now_ts,
    now_ts
  )
  on conflict (id) do update set
    approved_by = excluded.approved_by,
    payload = excluded.payload,
    approved_at = excluded.approved_at,
    updated_at = excluded.updated_at;

  if to_regclass('public.courts') is not null then
    execute $sql$
      insert into public.courts (
        id,
        name,
        region,
        type,
        region_key,
        created_at
      )
      values (
        $1,
        $2,
        coalesce(nullif($3, ''), nullif($4, ''), 'unknown'),
        coalesce(nullif($5, ''), 'outdoor'),
        coalesce(nullif($4, ''), public.rankball_court_region_key($3, $6, $7, $8, $9)),
        $10
      )
      on conflict (id) do update set
        name = excluded.name,
        region = excluded.region,
        type = excluded.type,
        region_key = excluded.region_key
    $sql$
    using
      approved_id,
      request_row.name,
      request_row.payload->>'region',
      public.rankball_court_region_key(request_row.payload->>'region', request_row.address_text, request_row.road_address, request_row.jibun_address, request_row.payload),
      request_row.payload->>'type',
      request_row.address_text,
      request_row.road_address,
      request_row.jibun_address,
      request_row.payload,
      now_ts;
  end if;

  update public.court_requests
  set
    status = 'approved',
    payload = payload || jsonb_build_object(
      'status', 'approved',
      'approvedBy', actor_profile_id,
      'approvedAt', now_ts,
      'approvedCourtId', approved_id
    ),
    updated_at = now_ts
  where id = request_row.id;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    request_id,
    target_user_id,
    created_by,
    payload,
    created_at
  )
  values (
    'aa_' || md5(request_row.id || actor_profile_id || now_ts::text),
    'court_approval',
    'committed',
    request_row.id,
    request_row.requested_by,
    actor_profile_id,
    jsonb_build_object('requestId', request_row.id, 'courtId', approved_id),
    now_ts
  )
  on conflict (id) do nothing;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values (
    'n_' || md5('court-approved' || request_row.id || now_ts::text),
    request_row.requested_by,
    request_row.requested_by,
    '구장 등록 승인',
    request_row.name || ' 구장 등록요청이 승인되었습니다.',
    'team',
    'court_request',
    jsonb_build_object('courtRequestId', request_row.id, 'approvedCourtId', approved_id),
    now_ts,
    now_ts
  )
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'requestId', request_row.id, 'approvedCourtId', approved_id);
end;
$$;

create or replace function public.rankball_report_court_request(
  actor_profile_id text,
  request_id text,
  reason text default '허위 구장 등록'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  duplicate_report_id text;
  report_id text;
  now_ts timestamptz := now();
  next_trust integer;
  safe_reason text := coalesce(nullif(trim(reason), ''), '허위 구장 등록');
begin
  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;

  if request_row.requested_by = actor_profile_id then
    raise exception 'cannot_report_own_court_request' using errcode = '42501';
  end if;

  select id into duplicate_report_id
  from public.reports
  where type = 'court_request'
    and target_id = request_row.id
    and user_id = actor_profile_id
    and status <> 'dismissed'
  limit 1;

  if duplicate_report_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'reportId', duplicate_report_id);
  end if;

  report_id := 'r_' || md5(request_row.id || actor_profile_id || now_ts::text);

  insert into public.reports (
    id,
    type,
    target_id,
    user_id,
    reported_user_ids,
    reason,
    status,
    payload,
    created_at,
    updated_at
  )
  values (
    report_id,
    'court_request',
    request_row.id,
    actor_profile_id,
    to_jsonb(array[request_row.requested_by]),
    safe_reason,
    'open',
    jsonb_build_object(
      'id', report_id,
      'type', 'court_request',
      'targetId', request_row.id,
      'by', actor_profile_id,
      'reportedUserIds', jsonb_build_array(request_row.requested_by),
      'reason', safe_reason,
      'status', 'open',
      'createdAt', now_ts
    ),
    now_ts,
    now_ts
  );

  update public.profiles
  set
    trust_score = greatest(0, least(100, coalesce(trust_score, 80) - 8)),
    updated_at = now_ts
  where id = request_row.requested_by
  returning trust_score into next_trust;

  update public.court_requests
  set
    status = 'reported',
    payload = payload || jsonb_build_object(
      'status', 'reported',
      'reportedAt', now_ts,
      'reportedBy', actor_profile_id,
      'trustPenalty', 8,
      'requesterTrustAfterReport', next_trust
    ),
    updated_at = now_ts
  where id = request_row.id;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values
    (
      'n_' || md5('court-report-requester' || request_row.id || now_ts::text),
      request_row.requested_by,
      request_row.requested_by,
      case when coalesce(next_trust, 80) < 70 then '구장 등록 제한' else '구장 등록요청 신고됨' end,
      case when coalesce(next_trust, 80) < 70
        then '허위 구장 신고로 신뢰도 ' || coalesce(next_trust, 80)::text || '점이 되어 구장 등록요청이 제한됩니다.'
        else '허위 구장 신고로 신뢰도 8점이 차감되었습니다. 현재 ' || coalesce(next_trust, 80)::text || '점입니다.'
      end,
      'orange',
      'court_request',
      jsonb_build_object('courtRequestId', request_row.id, 'reportId', report_id),
      now_ts,
      now_ts
    ),
    (
      'n_' || md5('court-report-reporter' || request_row.id || actor_profile_id || now_ts::text),
      actor_profile_id,
      actor_profile_id,
      '구장 허위 신고 접수',
      request_row.name || ' 등록요청을 허위 구장으로 신고했습니다.',
      'orange',
      'court_request',
      jsonb_build_object('courtRequestId', request_row.id, 'reportId', report_id),
      now_ts,
      now_ts
    )
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'requestId', request_row.id, 'reportId', report_id, 'requesterTrustAfterReport', next_trust);
end;
$$;

create or replace function public.rankball_submit_court_review(
  actor_profile_id text,
  review_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_match_id text := nullif(btrim(review_payload->>'matchId'), '');
  safe_rating integer := nullif(review_payload->>'rating', '')::integer;
  safe_court_id text;
  safe_court_name text;
  review_id text := nullif(btrim(review_payload->>'id'), '');
  match_row record;
  safe_payload jsonb;
begin
  if actor_profile_id is null or btrim(actor_profile_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;

  if safe_match_id is null then
    raise exception 'missing_match_id' using errcode = '22023';
  end if;

  if safe_rating is null or safe_rating < 1 or safe_rating > 5 then
    raise exception 'invalid_court_rating' using errcode = '22023';
  end if;

  select id, court_id, court_name, status, ended_at
  into match_row
  from public.matches
  where id = safe_match_id
  for share;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if match_row.status in ('void', 'cancelled') then
    raise exception 'court_review_match_closed' using errcode = '42501';
  end if;

  if match_row.ended_at is null and match_row.status not in ('approval', 'disputed', 'confirmed') then
    raise exception 'court_review_match_not_finished' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.match_players
    where match_id = safe_match_id
      and user_id = actor_profile_id
  ) then
    raise exception 'court_review_participant_required' using errcode = '42501';
  end if;

  safe_court_name := coalesce(nullif(match_row.court_name, ''), nullif(btrim(review_payload->>'courtName'), ''), '구장 미정');
  safe_court_id := coalesce(nullif(match_row.court_id, ''), nullif(btrim(review_payload->>'courtId'), ''), 'court_' || md5(safe_court_name));

  if review_id is null then
    review_id := 'cvr_' || md5(safe_match_id || actor_profile_id);
  end if;

  safe_payload := review_payload || jsonb_build_object(
    'id', review_id,
    'courtId', safe_court_id,
    'courtName', safe_court_name,
    'matchId', safe_match_id,
    'reviewerId', actor_profile_id,
    'rating', safe_rating,
    'createdAt', coalesce(review_payload->>'createdAt', now_ts::text),
    'updatedAt', now_ts
  );

  insert into public.court_reviews (
    id,
    court_id,
    court_name,
    match_id,
    reviewer_id,
    rating,
    surface_rating,
    rim_rating,
    lighting_rating,
    crowd_rating,
    location_accuracy,
    fit_modes,
    tags,
    memo,
    payload,
    created_at,
    updated_at
  )
  values (
    review_id,
    safe_court_id,
    safe_court_name,
    safe_match_id,
    actor_profile_id,
    safe_rating,
    nullif(review_payload->>'surfaceRating', '')::integer,
    nullif(review_payload->>'rimRating', '')::integer,
    nullif(review_payload->>'lightingRating', '')::integer,
    nullif(review_payload->>'crowdRating', '')::integer,
    nullif(review_payload->>'locationAccuracy', '')::integer,
    coalesce(review_payload->'fitModes', '[]'::jsonb),
    coalesce(review_payload->'tags', '[]'::jsonb),
    nullif(btrim(review_payload->>'memo'), ''),
    safe_payload,
    coalesce(nullif(review_payload->>'createdAt', '')::timestamptz, now_ts),
    now_ts
  )
  on conflict (match_id, reviewer_id) do update set
    court_id = excluded.court_id,
    court_name = excluded.court_name,
    rating = excluded.rating,
    surface_rating = excluded.surface_rating,
    rim_rating = excluded.rim_rating,
    lighting_rating = excluded.lighting_rating,
    crowd_rating = excluded.crowd_rating,
    location_accuracy = excluded.location_accuracy,
    fit_modes = excluded.fit_modes,
    tags = excluded.tags,
    memo = excluded.memo,
    payload = excluded.payload,
    updated_at = excluded.updated_at
  returning id into review_id;

  return jsonb_build_object(
    'ok', true,
    'reviewId', review_id,
    'courtId', safe_court_id,
    'matchId', safe_match_id
  );
end;
$$;

revoke all on function public.rankball_approve_court_request(text, integer, text) from public;
revoke all on function public.rankball_report_court_request(text, text, text) from public;
revoke all on function public.rankball_submit_court_review(text, jsonb) from public;
revoke all on function public.rankball_submit_court_request(text, jsonb) from public;
grant execute on function public.rankball_approve_court_request(text, integer, text) to service_role;
grant execute on function public.rankball_report_court_request(text, text, text) to service_role;
grant execute on function public.rankball_submit_court_review(text, jsonb) to service_role;
grant execute on function public.rankball_submit_court_request(text, jsonb) to service_role;

create or replace function public.rankball_sync_team_membership(
  p_actor_profile_id text,
  p_team jsonb,
  p_notifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_team_id text := nullif(btrim(p_team->>'id'), '');
  safe_name text := nullif(btrim(regexp_replace(coalesce(p_team->>'name', ''), '\s+', ' ', 'g')), '');
  safe_region text := nullif(btrim(p_team->>'region'), '');
  safe_home_court text := coalesce(nullif(btrim(p_team->>'homeCourt'), ''), nullif(btrim(p_team->>'home_court'), ''));
  safe_accent text := coalesce(nullif(btrim(p_team->>'accent'), ''), '#58d2c0');
  existing_mmr integer;
  existing_wins integer;
  existing_losses integer;
  existing_deleted_at timestamptz;
  team_exists boolean := false;
  has_existing_members boolean := false;
  actor_is_existing_captain boolean := false;
  actor_is_new_captain boolean := false;
  member_value jsonb;
  member_rows jsonb := '[]'::jsonb;
  member_ids text[] := array[]::text[];
  safe_member_id text;
  safe_role text;
  member_count integer := 0;
  captain_count integer := 0;
  other_team_count integer;
  notification_value jsonb;
  safe_notification_id text;
  safe_target_user_id text;
  notification_count integer := 0;
begin
  if p_actor_profile_id is null or btrim(p_actor_profile_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;

  if safe_team_id is null then
    raise exception 'missing_team_id' using errcode = '23502';
  end if;

  if safe_name is null or char_length(safe_name) > 14 then
    raise exception 'invalid_team_name' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_team->'members', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_team_members' using errcode = '22023';
  end if;

  select mmr, wins, losses, deleted_at
  into existing_mmr, existing_wins, existing_losses, existing_deleted_at
  from public.teams
  where id = safe_team_id
  for update;

  team_exists := found;

  if team_exists and existing_deleted_at is not null then
    raise exception 'team_deleted' using errcode = '42501';
  end if;

  select exists(select 1 from public.team_members where team_id = safe_team_id)
  into has_existing_members;

  select exists(
    select 1
    from public.team_members
    where team_id = safe_team_id
      and user_id = p_actor_profile_id
      and role = 'captain'
  )
  into actor_is_existing_captain;

  if has_existing_members and not actor_is_existing_captain then
    raise exception 'team_sync_permission_denied' using errcode = '42501';
  end if;

  for member_value in
    select value from jsonb_array_elements(coalesce(p_team->'members', '[]'::jsonb))
  loop
    safe_member_id := nullif(btrim(coalesce(member_value->>'userId', member_value->>'user_id')), '');
    if safe_member_id is null or safe_member_id = any(member_ids) then
      continue;
    end if;

    perform 1 from public.profiles where id = safe_member_id;
    if not found then
      raise exception 'team_member_profile_not_found' using errcode = 'P0002';
    end if;

    select count(distinct team_id)
    into other_team_count
    from public.team_members
    where user_id = safe_member_id
      and team_id <> safe_team_id;

    if other_team_count >= 3 then
      raise exception 'team_membership_limit_exceeded' using errcode = '23514';
    end if;

    safe_role := case
      when member_value->>'role' in ('captain', 'regular', 'mercenary') then member_value->>'role'
      when member_value->>'role' = 'guest' then 'mercenary'
      else 'regular'
    end;
    if safe_role = 'captain' then
      captain_count := captain_count + 1;
    end if;
    if safe_member_id = p_actor_profile_id and safe_role = 'captain' then
      actor_is_new_captain := true;
    end if;

    member_ids := array_append(member_ids, safe_member_id);
    member_rows := member_rows || jsonb_build_array(jsonb_build_object(
      'team_id', safe_team_id,
      'user_id', safe_member_id,
      'role', safe_role
    ));
  end loop;

  member_count := jsonb_array_length(member_rows);

  if member_count = 0 then
    raise exception 'team_member_required' using errcode = '23502';
  end if;

  if member_count > 10 then
    raise exception 'team_members_limit_exceeded' using errcode = '23514';
  end if;

  if captain_count = 0 or not actor_is_new_captain then
    raise exception 'team_captain_required' using errcode = '42501';
  end if;

  insert into public.teams (
    id,
    name,
    region,
    home_court,
    mmr,
    wins,
    losses,
    accent,
    deleted_at,
    updated_at
  )
  values (
    safe_team_id,
    safe_name,
    safe_region,
    safe_home_court,
    case when team_exists then coalesce(existing_mmr, 1200) else 1200 end,
    case when team_exists then coalesce(existing_wins, 0) else 0 end,
    case when team_exists then coalesce(existing_losses, 0) else 0 end,
    safe_accent,
    null,
    now_ts
  )
  on conflict (id) do update set
    name = excluded.name,
    region = excluded.region,
    home_court = excluded.home_court,
    accent = excluded.accent,
    deleted_at = null,
    updated_at = excluded.updated_at;

  delete from public.team_members
  where team_id = safe_team_id;

  insert into public.team_members (team_id, user_id, role)
  select
    value->>'team_id',
    value->>'user_id',
    value->>'role'
  from jsonb_array_elements(member_rows);

  for notification_value in
    select value from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb))
  loop
    safe_notification_id := nullif(btrim(notification_value->>'id'), '');
    safe_target_user_id := coalesce(nullif(btrim(notification_value->>'targetUserId'), ''), p_actor_profile_id);
    if safe_notification_id is null or safe_target_user_id <> p_actor_profile_id then
      continue;
    end if;

    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      match_id,
      recruiting_post_id,
      invitation_id,
      discord_event,
      read_at,
      payload,
      created_at,
      updated_at
    )
    values (
      safe_notification_id,
      p_actor_profile_id,
      safe_target_user_id,
      coalesce(nullif(notification_value->>'title', ''), '팀 변경'),
      notification_value->>'body',
      coalesce(nullif(notification_value->>'tone', ''), 'team'),
      coalesce(nullif(notification_value->>'type', ''), 'team'),
      nullif(notification_value->>'matchId', ''),
      nullif(notification_value->>'recruitingPostId', ''),
      nullif(notification_value->>'invitationId', ''),
      coalesce(nullif(notification_value->>'discordEvent', ''), nullif(notification_value->>'eventType', '')),
      nullif(notification_value->>'readAt', '')::timestamptz,
      notification_value,
      coalesce(nullif(notification_value->>'createdAt', '')::timestamptz, now_ts),
      coalesce(nullif(notification_value->>'updatedAt', '')::timestamptz, now_ts)
    )
    on conflict (id) do update set
      title = excluded.title,
      body = excluded.body,
      tone = excluded.tone,
      type = excluded.type,
      match_id = excluded.match_id,
      recruiting_post_id = excluded.recruiting_post_id,
      invitation_id = excluded.invitation_id,
      discord_event = excluded.discord_event,
      read_at = excluded.read_at,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

    notification_count := notification_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'teamId', safe_team_id,
    'memberCount', member_count,
    'notificationCount', notification_count
  );
end;
$$;

create or replace function public.rankball_invite_team_member(
  p_actor_profile_id text,
  p_team_id text,
  p_target_user_id text,
  p_invitation_id text default null,
  p_role text default 'regular'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_invitation_id text := coalesce(nullif(btrim(p_invitation_id), ''), 'ti_' || md5(random()::text || clock_timestamp()::text));
  member_count integer;
  target_team_count integer;
  team_name text;
  safe_role text := case
    when p_role = 'mercenary' or p_role = 'guest' then 'mercenary'
    else 'regular'
  end;
begin
  if nullif(btrim(p_actor_profile_id), '') is null or nullif(btrim(p_team_id), '') is null or nullif(btrim(p_target_user_id), '') is null then
    raise exception 'missing_team_invitation_input' using errcode = '22023';
  end if;

  select t.name
  into team_name
  from public.teams t
  where t.id = p_team_id
    and t.deleted_at is null
  for update;

  if not found then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.team_members
    where team_id = p_team_id
      and user_id = p_actor_profile_id
      and role = 'captain'
  ) then
    raise exception 'team_invite_permission_denied' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.team_members
    where team_id = p_team_id
      and user_id = p_target_user_id
  ) then
    raise exception 'team_member_already_exists' using errcode = '23505';
  end if;

  select count(*) into member_count from public.team_members where team_id = p_team_id;
  if member_count >= 10 then
    update public.team_invitations
    set status = 'expired', updated_at = now_ts
    where team_id = p_team_id
      and status = 'pending';
    raise exception 'team_members_limit_exceeded' using errcode = '23514';
  end if;

  select count(*) into target_team_count from public.team_members where user_id = p_target_user_id;
  if target_team_count >= 3 then
    raise exception 'team_membership_limit_exceeded' using errcode = '23514';
  end if;

  insert into public.team_invitations (
    id, team_id, from_user_id, target_user_id, role, status, created_at, updated_at
  )
  values (
    safe_invitation_id, p_team_id, p_actor_profile_id, p_target_user_id, safe_role, 'pending', now_ts, now_ts
  )
  on conflict (team_id, target_user_id) where status = 'pending'
  do update set
    from_user_id = excluded.from_user_id,
    role = excluded.role,
    updated_at = excluded.updated_at
  returning id into safe_invitation_id;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    invitation_id,
    payload,
    created_at,
    updated_at
  )
  values (
    'n_' || safe_invitation_id,
    p_target_user_id,
    p_target_user_id,
    '팀 초대',
    coalesce(team_name, '팀') || ' 팀 초대가 도착했습니다.',
    'team',
    'team_invite',
    safe_invitation_id,
    jsonb_build_object(
      'id', 'n_' || safe_invitation_id,
      'title', '팀 초대',
      'body', coalesce(team_name, '팀') || ' 팀 초대가 도착했습니다.',
      'tone', 'team',
      'type', 'team_invite',
      'teamId', p_team_id,
      'teamInvitationId', safe_invitation_id,
      'targetUserId', p_target_user_id,
      'role', safe_role
    ),
    now_ts,
    now_ts
  )
  on conflict (id) do update set
    body = excluded.body,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'teamId', p_team_id, 'invitationId', safe_invitation_id);
end;
$$;

create or replace function public.rankball_invite_team_member(
  p_actor_profile_id text,
  p_team_id text,
  p_target_user_id text,
  p_invitation_id text default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.rankball_invite_team_member(
    p_actor_profile_id,
    p_team_id,
    p_target_user_id,
    p_invitation_id,
    'regular'
  );
$$;

create or replace function public.rankball_respond_team_invitation(
  p_actor_profile_id text,
  p_invitation_id text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  invitation_row public.team_invitations%rowtype;
  member_count integer;
  target_team_count integer;
  actor_is_captain boolean := false;
  safe_role text;
begin
  if nullif(btrim(p_actor_profile_id), '') is null or nullif(btrim(p_invitation_id), '') is null then
    raise exception 'missing_team_invitation_input' using errcode = '22023';
  end if;

  select *
  into invitation_row
  from public.team_invitations
  where id = p_invitation_id
  for update;

  if not found then
    raise exception 'team_invitation_not_found' using errcode = 'P0002';
  end if;

  select exists(
    select 1
    from public.team_members
    where team_id = invitation_row.team_id
      and user_id = p_actor_profile_id
      and role = 'captain'
  )
  into actor_is_captain;

  if p_action = 'cancel' then
    if p_actor_profile_id <> invitation_row.from_user_id and not actor_is_captain then
      raise exception 'team_invitation_cancel_denied' using errcode = '42501';
    end if;
    update public.team_invitations
    set status = 'cancelled', updated_at = now_ts
    where id = p_invitation_id
      and status = 'pending';
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'cancelled');
  end if;

  if p_actor_profile_id <> invitation_row.target_user_id then
    raise exception 'team_invitation_target_denied' using errcode = '42501';
  end if;

  if invitation_row.status <> 'pending' then
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', invitation_row.status);
  end if;

  if p_action = 'decline' then
    update public.team_invitations
    set status = 'declined', updated_at = now_ts
    where id = p_invitation_id;
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'declined');
  end if;

  if p_action <> 'accept' then
    raise exception 'invalid_team_invitation_action' using errcode = '22023';
  end if;

  perform 1 from public.teams where id = invitation_row.team_id and deleted_at is null for update;
  if not found then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.team_members
    where team_id = invitation_row.team_id
      and user_id = p_actor_profile_id
  ) then
    update public.team_invitations
    set status = 'accepted', updated_at = now_ts
    where id = p_invitation_id;
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'accepted');
  end if;

  select count(*) into member_count from public.team_members where team_id = invitation_row.team_id;
  if member_count >= 10 then
    update public.team_invitations
    set status = 'expired', updated_at = now_ts
    where team_id = invitation_row.team_id
      and status = 'pending';
    raise exception 'team_members_limit_exceeded' using errcode = '23514';
  end if;

  select count(*) into target_team_count from public.team_members where user_id = p_actor_profile_id;
  if target_team_count >= 3 then
    update public.team_invitations
    set status = 'expired', updated_at = now_ts
    where id = p_invitation_id;
    raise exception 'team_membership_limit_exceeded' using errcode = '23514';
  end if;

  safe_role := case
    when invitation_row.role = 'mercenary' or invitation_row.role = 'guest' then 'mercenary'
    else 'regular'
  end;

  insert into public.team_members (team_id, user_id, role)
  values (invitation_row.team_id, p_actor_profile_id, safe_role);

  update public.team_invitations
  set status = 'accepted', updated_at = now_ts
  where id = p_invitation_id;

  if member_count + 1 >= 10 then
    update public.team_invitations
    set status = 'expired', updated_at = now_ts
    where team_id = invitation_row.team_id
      and status = 'pending';
  end if;

  return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'accepted', 'memberCount', member_count + 1);
end;
$$;

create or replace function public.rankball_delete_team(
  p_actor_profile_id text,
  p_team_id text,
  p_notifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_team_id text := nullif(btrim(p_team_id), '');
  existing_deleted_at timestamptz;
  notification_value jsonb;
  safe_notification_id text;
  safe_target_user_id text;
  notification_count integer := 0;
begin
  if p_actor_profile_id is null or btrim(p_actor_profile_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;

  if safe_team_id is null then
    raise exception 'missing_team_id' using errcode = '23502';
  end if;

  select deleted_at
  into existing_deleted_at
  from public.teams
  where id = safe_team_id
  for update;

  if not found then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;

  if existing_deleted_at is not null then
    return jsonb_build_object('ok', true, 'teamId', safe_team_id, 'deleted', true, 'notificationCount', 0);
  end if;

  if not exists (
    select 1
    from public.team_members
    where team_id = safe_team_id
      and user_id = p_actor_profile_id
      and role = 'captain'
  ) then
    raise exception 'team_delete_permission_denied' using errcode = '42501';
  end if;

  delete from public.team_members
  where team_id = safe_team_id;

  delete from public.favorites
  where target_type = 'team'
    and target_id = safe_team_id;

  update public.recruiting_posts
  set status = 'closed',
      updated_at = now_ts
  where team_id = safe_team_id;

  update public.teams
  set deleted_at = now_ts,
      updated_at = now_ts
  where id = safe_team_id;

  for notification_value in
    select value from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb))
  loop
    safe_notification_id := nullif(btrim(notification_value->>'id'), '');
    safe_target_user_id := coalesce(nullif(btrim(notification_value->>'targetUserId'), ''), p_actor_profile_id);
    if safe_notification_id is null or safe_target_user_id <> p_actor_profile_id then
      continue;
    end if;

    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      match_id,
      recruiting_post_id,
      invitation_id,
      discord_event,
      read_at,
      payload,
      created_at,
      updated_at
    )
    values (
      safe_notification_id,
      p_actor_profile_id,
      safe_target_user_id,
      coalesce(nullif(notification_value->>'title', ''), '팀 변경'),
      notification_value->>'body',
      coalesce(nullif(notification_value->>'tone', ''), 'team'),
      coalesce(nullif(notification_value->>'type', ''), 'team'),
      nullif(notification_value->>'matchId', ''),
      nullif(notification_value->>'recruitingPostId', ''),
      nullif(notification_value->>'invitationId', ''),
      coalesce(nullif(notification_value->>'discordEvent', ''), nullif(notification_value->>'eventType', '')),
      nullif(notification_value->>'readAt', '')::timestamptz,
      notification_value,
      coalesce(nullif(notification_value->>'createdAt', '')::timestamptz, now_ts),
      coalesce(nullif(notification_value->>'updatedAt', '')::timestamptz, now_ts)
    )
    on conflict (id) do update set
      title = excluded.title,
      body = excluded.body,
      tone = excluded.tone,
      type = excluded.type,
      match_id = excluded.match_id,
      recruiting_post_id = excluded.recruiting_post_id,
      invitation_id = excluded.invitation_id,
      discord_event = excluded.discord_event,
      read_at = excluded.read_at,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

    notification_count := notification_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'teamId', safe_team_id,
    'deleted', true,
    'notificationCount', notification_count
  );
end;
$$;

revoke all on function public.rankball_sync_team_membership(text, jsonb, jsonb) from public;
revoke all on function public.rankball_invite_team_member(text, text, text, text) from public;
revoke all on function public.rankball_invite_team_member(text, text, text, text, text) from public;
revoke all on function public.rankball_respond_team_invitation(text, text, text) from public;
revoke all on function public.rankball_delete_team(text, text, jsonb) from public;
grant execute on function public.rankball_sync_team_membership(text, jsonb, jsonb) to service_role;
grant execute on function public.rankball_invite_team_member(text, text, text, text) to service_role;
grant execute on function public.rankball_invite_team_member(text, text, text, text, text) to service_role;
grant execute on function public.rankball_respond_team_invitation(text, text, text) to service_role;
grant execute on function public.rankball_delete_team(text, text, jsonb) to service_role;

create or replace function public.rankball_persist_recruiting_snapshot(
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  application_count integer := 0;
  notification_count integer := 0;
begin
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  insert into public.recruiting_posts (
    id, type, title, visibility, player_id, team_id, region, court_id, court_name, mode,
    scheduled_date, scheduled_time, scheduled_at, ranked, official, pre_registered,
    rating_scale, age_restriction, allowed_age_groups, rules, stakes, court_reserved,
    court_fee, spots, target_team_id, referee_id, referee_trust_min, stat_entry_minutes,
    dispute_minutes, room_state, host_join_mode, host_side, host_ready, side_capacity,
    player_ids, position, memo, status, confirmed_at, created_at, updated_at
  )
  select
    id, type, title, visibility, player_id, team_id, region, court_id, court_name, mode,
    scheduled_date, scheduled_time, scheduled_at, ranked, official, pre_registered,
    rating_scale, age_restriction, allowed_age_groups, rules, stakes, court_reserved,
    court_fee, spots, target_team_id, referee_id, referee_trust_min, stat_entry_minutes,
    dispute_minutes, room_state, host_join_mode, host_side, host_ready, side_capacity,
    player_ids, position, memo, status, confirmed_at, created_at, updated_at
  from jsonb_populate_record(
    null::public.recruiting_posts,
    p_post_row || jsonb_build_object(
      'dispute_minutes', public.rankball_normalize_dispute_minutes(nullif(p_post_row->>'dispute_minutes', '')::integer)
    )
  )
  on conflict (id) do update set
    type = excluded.type,
    title = excluded.title,
    visibility = excluded.visibility,
    player_id = excluded.player_id,
    team_id = excluded.team_id,
    region = excluded.region,
    court_id = excluded.court_id,
    court_name = excluded.court_name,
    mode = excluded.mode,
    scheduled_date = excluded.scheduled_date,
    scheduled_time = excluded.scheduled_time,
    scheduled_at = excluded.scheduled_at,
    ranked = excluded.ranked,
    official = excluded.official,
    pre_registered = excluded.pre_registered,
    rating_scale = excluded.rating_scale,
    age_restriction = excluded.age_restriction,
    allowed_age_groups = excluded.allowed_age_groups,
    rules = excluded.rules,
    stakes = excluded.stakes,
    court_reserved = excluded.court_reserved,
    court_fee = excluded.court_fee,
    spots = excluded.spots,
    target_team_id = excluded.target_team_id,
    referee_id = excluded.referee_id,
    referee_trust_min = excluded.referee_trust_min,
    stat_entry_minutes = excluded.stat_entry_minutes,
    dispute_minutes = excluded.dispute_minutes,
    room_state = excluded.room_state,
    host_join_mode = excluded.host_join_mode,
    host_side = excluded.host_side,
    host_ready = excluded.host_ready,
    side_capacity = excluded.side_capacity,
    player_ids = excluded.player_ids,
    position = excluded.position,
    memo = excluded.memo,
    status = excluded.status,
    confirmed_at = excluded.confirmed_at,
    updated_at = excluded.updated_at;

  delete from public.recruiting_applications where post_id = safe_post_id;

  insert into public.recruiting_applications (
    post_id, player_id, team_id, kind, side, status, reserve, position,
    player_ids, source_team_id, source_entry_id, created_at, updated_at
  )
  select
    post_id, player_id, team_id, kind, side, status, reserve, position,
    player_ids, source_team_id, source_entry_id, created_at, updated_at
  from jsonb_populate_recordset(null::public.recruiting_applications, coalesce(p_application_rows, '[]'::jsonb));
  get diagnostics application_count = row_count;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  )
  select
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  from jsonb_populate_recordset(null::public.notifications, coalesce(p_notification_rows, '[]'::jsonb))
  on conflict (id) do update set
    user_id = excluded.user_id,
    target_user_id = excluded.target_user_id,
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    match_id = excluded.match_id,
    recruiting_post_id = excluded.recruiting_post_id,
    invitation_id = excluded.invitation_id,
    discord_event = excluded.discord_event,
    read_at = excluded.read_at,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics notification_count = row_count;

  return jsonb_build_object('ok', true, 'postId', safe_post_id, 'applicationCount', application_count, 'notificationCount', notification_count);
end;
$$;

revoke all on function public.rankball_persist_recruiting_snapshot(jsonb, jsonb, jsonb) from public;
grant execute on function public.rankball_persist_recruiting_snapshot(jsonb, jsonb, jsonb) to service_role;

create or replace function public.rankball_recruiting_slot_position_action(
  p_actor_profile_id text,
  p_post_id text,
  p_player_id text default null,
  p_position text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_player_id text := coalesce(nullif(btrim(p_player_id), ''), safe_actor_id);
  safe_position text := coalesce(nullif(btrim(p_position), ''), '');
  current_status text;
  current_room_state jsonb;
  next_slot_positions jsonb;
  is_room_member boolean := false;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;
  if safe_player_id is null or safe_player_id <> safe_actor_id then
    raise exception 'recruiting_slot_position_permission_denied' using errcode = '42501';
  end if;

  if safe_position not in ('상관없음', 'PG', 'SG', 'SF', 'PF', 'C') then
    safe_position := '';
  end if;

  select status, coalesce(room_state, '{}'::jsonb)
  into current_status, current_room_state
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  if current_status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;

  select (
    exists (
      select 1
      from public.recruiting_posts post
      where post.id = safe_post_id
        and (
          post.player_id = safe_player_id
          or coalesce(post.player_ids, '[]'::jsonb) ? safe_player_id
        )
    )
    or exists (
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and (
          application.player_id = safe_player_id
          or coalesce(application.player_ids, '[]'::jsonb) ? safe_player_id
        )
    )
  )
  into is_room_member;

  if not is_room_member then
    raise exception 'recruiting_room_member_required' using errcode = '42501';
  end if;

  next_slot_positions := case
    when jsonb_typeof(current_room_state->'slotPositions') = 'object' then current_room_state->'slotPositions'
    else '{}'::jsonb
  end;

  if safe_position = '' then
    next_slot_positions := next_slot_positions - safe_player_id;
  else
    next_slot_positions := jsonb_set(next_slot_positions, array[safe_player_id], to_jsonb(safe_position), true);
  end if;

  update public.recruiting_posts
  set
    room_state = jsonb_set(current_room_state, '{slotPositions}', next_slot_positions, true),
    updated_at = now()
  where id = safe_post_id;

  update public.recruiting_posts
  set
    position = nullif(safe_position, ''),
    updated_at = now()
  where id = safe_post_id
    and player_id = safe_player_id;

  update public.recruiting_applications
  set
    position = nullif(safe_position, ''),
    updated_at = now()
  where post_id = safe_post_id
    and player_id = safe_player_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setRecruitingSlotPosition',
    'postId', safe_post_id,
    'playerId', safe_player_id,
    'position', safe_position,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_slot_position_action(text, text, text, text) from public;
grant execute on function public.rankball_recruiting_slot_position_action(text, text, text, text) to service_role;

create or replace function public.rankball_recruiting_cancel_participation_action(
  p_actor_profile_id text,
  p_post_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  current_status text;
  current_player_id text;
  current_player_ids jsonb;
  current_room_state jsonb;
  next_player_ids jsonb;
  next_party_reserves jsonb;
  next_pinned_reserve_players jsonb;
  next_reserve_ready jsonb;
  next_slot_positions jsonb;
  next_stat_recorders jsonb;
  next_room_state jsonb;
  is_room_member boolean := false;
  application_delete_count integer := 0;
  application_update_count integer := 0;
  deleted_empty_application_count integer := 0;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  select
    status,
    player_id,
    coalesce(player_ids, '[]'::jsonb),
    coalesce(room_state, '{}'::jsonb)
  into current_status, current_player_id, current_player_ids, current_room_state
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  if current_status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;
  if current_player_id = safe_actor_id or current_room_state->>'ownerId' = safe_actor_id then
    raise exception 'recruiting_owner_cannot_cancel_participation' using errcode = '42501';
  end if;

  select (
    coalesce(current_player_ids, '[]'::jsonb) ? safe_actor_id
    or exists (
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and (
          application.player_id = safe_actor_id
          or coalesce(application.player_ids, '[]'::jsonb) ? safe_actor_id
        )
    )
    or exists (
      select 1
      from jsonb_each(
        case when jsonb_typeof(current_room_state->'partyReserves') = 'object'
          then current_room_state->'partyReserves'
          else '{}'::jsonb
        end
      ) entry(key, value)
      where (case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) ? safe_actor_id
    )
    or exists (
      select 1
      from jsonb_each(
        case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object'
          then current_room_state->'pinnedReservePlayers'
          else '{}'::jsonb
        end
      ) entry(key, value)
      where (case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) ? safe_actor_id
    )
    or (
      case when jsonb_typeof(current_room_state->'reserveReady') = 'object'
        then current_room_state->'reserveReady'
        else '{}'::jsonb
      end
    ) ? safe_actor_id
    or (
      case when jsonb_typeof(current_room_state->'slotPositions') = 'object'
        then current_room_state->'slotPositions'
        else '{}'::jsonb
      end
    ) ? safe_actor_id
    or exists (
      select 1
      from jsonb_each_text(
        case when jsonb_typeof(current_room_state->'statRecorders') = 'object'
          then current_room_state->'statRecorders'
          else '{}'::jsonb
        end
      ) entry(key, value)
      where value = safe_actor_id
    )
  )
  into is_room_member;

  if not is_room_member then
    raise exception 'recruiting_room_member_required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_actor_id), '[]'::jsonb)
  into next_player_ids
  from jsonb_array_elements_text(
    case when jsonb_typeof(current_player_ids) = 'array' then current_player_ids else '[]'::jsonb end
  ) ids(value);

  select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb)
  into next_party_reserves
  from (
    select
      key,
      coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_actor_id), '[]'::jsonb) as filtered_ids
    from jsonb_each(
      case when jsonb_typeof(current_room_state->'partyReserves') = 'object'
        then current_room_state->'partyReserves'
        else '{}'::jsonb
      end
    ) entry(key, raw_ids)
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end
    ) ids(value) on true
    group by key
  ) cleaned
  where jsonb_array_length(filtered_ids) > 0;

  select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb)
  into next_pinned_reserve_players
  from (
    select
      key,
      coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_actor_id), '[]'::jsonb) as filtered_ids
    from jsonb_each(
      case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object'
        then current_room_state->'pinnedReservePlayers'
        else '{}'::jsonb
      end
    ) entry(key, raw_ids)
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end
    ) ids(value) on true
    group by key
  ) cleaned
  where jsonb_array_length(filtered_ids) > 0;

  next_reserve_ready := (
    case when jsonb_typeof(current_room_state->'reserveReady') = 'object'
      then current_room_state->'reserveReady'
      else '{}'::jsonb
    end
  ) - safe_actor_id;

  next_slot_positions := (
    case when jsonb_typeof(current_room_state->'slotPositions') = 'object'
      then current_room_state->'slotPositions'
      else '{}'::jsonb
    end
  ) - safe_actor_id;

  select coalesce(jsonb_object_agg(key, to_jsonb(value)), '{}'::jsonb)
  into next_stat_recorders
  from jsonb_each_text(
    case when jsonb_typeof(current_room_state->'statRecorders') = 'object'
      then current_room_state->'statRecorders'
      else '{}'::jsonb
    end
  ) entry(key, value)
  where value <> safe_actor_id;

  next_room_state := current_room_state;
  next_room_state := jsonb_set(next_room_state, '{partyReserves}', coalesce(next_party_reserves, '{}'::jsonb), true);
  next_room_state := jsonb_set(next_room_state, '{pinnedReservePlayers}', coalesce(next_pinned_reserve_players, '{}'::jsonb), true);
  next_room_state := jsonb_set(next_room_state, '{reserveReady}', coalesce(next_reserve_ready, '{}'::jsonb), true);
  next_room_state := jsonb_set(next_room_state, '{slotPositions}', coalesce(next_slot_positions, '{}'::jsonb), true);
  next_room_state := jsonb_set(next_room_state, '{statRecorders}', coalesce(next_stat_recorders, '{}'::jsonb), true);

  delete from public.recruiting_applications
  where post_id = safe_post_id
    and player_id = safe_actor_id;
  get diagnostics application_delete_count = row_count;

  delete from public.recruiting_applications
  where post_id = safe_post_id
    and coalesce(player_ids, '[]'::jsonb) ? safe_actor_id
    and jsonb_array_length(case when jsonb_typeof(player_ids) = 'array' then player_ids else '[]'::jsonb end) <= 1;
  get diagnostics deleted_empty_application_count = row_count;
  application_delete_count := application_delete_count + deleted_empty_application_count;

  with next_applications as (
    select
      application.post_id,
      application.player_id,
      application.kind,
      (
        select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_actor_id), '[]'::jsonb)
        from jsonb_array_elements_text(
          case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end
        ) ids(value)
      ) as next_player_ids
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and coalesce(application.player_ids, '[]'::jsonb) ? safe_actor_id
  )
  update public.recruiting_applications application
  set
    player_ids = next_applications.next_player_ids,
    updated_at = now()
  from next_applications
  where application.post_id = next_applications.post_id
    and application.player_id = next_applications.player_id
    and application.kind = next_applications.kind;
  get diagnostics application_update_count = row_count;

  update public.recruiting_posts
  set
    player_ids = coalesce(next_player_ids, '[]'::jsonb),
    room_state = next_room_state,
    updated_at = now()
  where id = safe_post_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'cancelRecruitingParticipation',
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'applicationDeleteCount', application_delete_count,
    'applicationUpdateCount', application_update_count,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_cancel_participation_action(text, text) from public;
grant execute on function public.rankball_recruiting_cancel_participation_action(text, text) to service_role;

create or replace function public.rankball_recruiting_interest_player_action(
  p_actor_profile_id text,
  p_post_id text,
  p_join_mode text default '',
  p_team_id text default null,
  p_side text default null,
  p_reserve boolean default false,
  p_position text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_join_mode text := lower(coalesce(nullif(btrim(p_join_mode), ''), ''));
  safe_team_id text := nullif(btrim(p_team_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_position text := nullif(btrim(p_position), '');
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  actor_position text;
  actor_age_group text;
  actor_mmr numeric := 1200;
  target_mmr numeric := 1200;
  range_mode text;
  range_gap numeric := 120;
  allowed_groups jsonb;
  host_a_count integer := 0;
  host_b_count integer := 0;
  app_a_count integer := 0;
  app_b_count integer := 0;
  side_filled integer := 0;
  selected_reserve_count integer := 0;
  selected_pinned_reserve_count integer := 0;
  safe_reserve boolean := coalesce(p_reserve, false);
  already_joined boolean := false;
  next_pinned_reserve_players jsonb;
  side_pinned_ids jsonb;
  next_room_state jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);

  if current_post.status <> 'open' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recruiting_room_not_open', 'postId', safe_post_id);
  end if;
  if coalesce(current_post.visibility, 'public') <> 'public' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recruiting_private_room', 'postId', safe_post_id);
  end if;
  if safe_join_mode in ('team', 'referee') or safe_team_id is not null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'unsupported_interest_join_mode', 'postId', safe_post_id);
  end if;
  if safe_join_mode = '' and coalesce(current_post.type, 'need_player') <> 'need_player' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'implicit_team_join_mode', 'postId', safe_post_id);
  end if;
  if current_room_state->>'teamOnly' = 'true' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'team_only_room', 'postId', safe_post_id);
  end if;

  select
    position,
    case
      when age_group in ('junior', 'rising', 'open') then age_group
      when birth_year is not null and extract(year from now())::integer - birth_year <= 12 then 'junior'
      when birth_year is not null and extract(year from now())::integer - birth_year <= 19 then 'rising'
      when birth_year is not null then 'open'
      else null
    end,
    case
      when ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$' then (ratings->>'integrated')::numeric
      else 1200
    end
  into actor_position, actor_age_group, actor_mmr
  from public.profiles
  where id = safe_actor_id;

  if not found then
    raise exception 'recruiting_player_not_found' using errcode = '22023';
  end if;
  if safe_position is null then
    safe_position := actor_position;
  end if;

  allowed_groups := case
    when jsonb_typeof(current_post.allowed_age_groups) = 'array' then current_post.allowed_age_groups
    else '[]'::jsonb
  end;
  if jsonb_array_length(allowed_groups) > 0 and jsonb_array_length(allowed_groups) < 3 then
    if actor_age_group is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'missing_actor_age_group', 'postId', safe_post_id);
    end if;
    if not (allowed_groups ? actor_age_group) then
      raise exception 'age_group_not_allowed' using errcode = '42501';
    end if;
  elsif coalesce(nullif(current_post.age_restriction, ''), 'any') <> 'any' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'age_restriction_requires_replay', 'postId', safe_post_id);
  end if;

  range_mode := coalesce(nullif(current_room_state->>'mmrRangeMode', ''), current_post.rules->>'mmrRangeMode', 'narrow');
  if range_mode = 'standard' then
    range_gap := 220;
  elsif range_mode = 'wide' then
    range_gap := 360;
  else
    range_gap := 120;
  end if;

  if current_post.team_id is not null then
    select coalesce(mmr, 1200)
    into target_mmr
    from public.teams
    where id = current_post.team_id;
    target_mmr := coalesce(target_mmr, 1200);
  elsif current_post.player_id is not null then
    select case
      when ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$' then (ratings->>'integrated')::numeric
      else 1200
    end
    into target_mmr
    from public.profiles
    where id = current_post.player_id;
    target_mmr := coalesce(target_mmr, 1200);
  end if;

  if current_post.ranked is distinct from false and (actor_mmr < target_mmr - range_gap or actor_mmr > target_mmr + range_gap) then
    raise exception 'recruiting_mmr_out_of_range' using errcode = '42501';
  end if;

  select (
    current_post.player_id = safe_actor_id
    or coalesce(current_post.player_ids, '[]'::jsonb) ? safe_actor_id
    or exists (
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and (
          application.player_id = safe_actor_id
          or coalesce(application.player_ids, '[]'::jsonb) ? safe_actor_id
        )
    )
    or exists (
      select 1
      from jsonb_each(
        case when jsonb_typeof(current_room_state->'partyReserves') = 'object'
          then current_room_state->'partyReserves'
          else '{}'::jsonb
        end
      ) entry(key, value)
      where (case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) ? safe_actor_id
    )
    or exists (
      select 1
      from jsonb_each(
        case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object'
          then current_room_state->'pinnedReservePlayers'
          else '{}'::jsonb
        end
      ) entry(key, value)
      where (case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) ? safe_actor_id
    )
  )
  into already_joined;

  if already_joined then
    return jsonb_build_object(
      'ok', true,
      'action', 'interestRecruitingPost',
      'postId', safe_post_id,
      'actorProfileId', safe_actor_id,
      'noop', true,
      'sqlReducer', true
    );
  end if;

  if current_post.host_side = 'teamA' then
    host_a_count := case
      when current_post.host_join_mode = 'player' then case when current_post.player_id is null then 0 else 1 end
      else jsonb_array_length(case when jsonb_typeof(coalesce(current_post.player_ids, '[]'::jsonb)) = 'array' then coalesce(current_post.player_ids, '[]'::jsonb) else '[]'::jsonb end)
    end;
  elsif current_post.host_side = 'teamB' then
    host_b_count := case
      when current_post.host_join_mode = 'player' then case when current_post.player_id is null then 0 else 1 end
      else jsonb_array_length(case when jsonb_typeof(coalesce(current_post.player_ids, '[]'::jsonb)) = 'array' then coalesce(current_post.player_ids, '[]'::jsonb) else '[]'::jsonb end)
    end;
  end if;

  select coalesce(sum(case
    when kind = 'team' then greatest(1, jsonb_array_length(case when jsonb_typeof(player_ids) = 'array' then player_ids else '[]'::jsonb end))
    else 1
  end), 0)::integer
  into app_a_count
  from public.recruiting_applications
  where post_id = safe_post_id
    and side = 'teamA'
    and reserve = false;

  select coalesce(sum(case
    when kind = 'team' then greatest(1, jsonb_array_length(case when jsonb_typeof(player_ids) = 'array' then player_ids else '[]'::jsonb end))
    else 1
  end), 0)::integer
  into app_b_count
  from public.recruiting_applications
  where post_id = safe_post_id
    and side = 'teamB'
    and reserve = false;

  if safe_side is null or safe_side not in ('teamA', 'teamB') then
    safe_side := case when host_a_count + app_a_count <= host_b_count + app_b_count then 'teamA' else 'teamB' end;
  end if;

  side_filled := case when safe_side = 'teamA' then host_a_count + app_a_count else host_b_count + app_b_count end;
  safe_reserve := safe_reserve or side_filled >= greatest(1, least(5, coalesce(current_post.side_capacity, 5)));

  select count(*)::integer
  into selected_reserve_count
  from public.recruiting_applications
  where post_id = safe_post_id
    and side = safe_side
    and reserve = true;

  selected_pinned_reserve_count := jsonb_array_length(
    case
      when jsonb_typeof(current_room_state #> array['pinnedReservePlayers', safe_side]) = 'array'
        then current_room_state #> array['pinnedReservePlayers', safe_side]
      else '[]'::jsonb
    end
  );

  if safe_reserve and greatest(selected_reserve_count, selected_pinned_reserve_count) >= current_post.bench_capacity then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_limit_requires_replay', 'postId', safe_post_id);
  end if;

  select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb)
  into next_pinned_reserve_players
  from (
    select
      key,
      coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_actor_id), '[]'::jsonb) as filtered_ids
    from jsonb_each(
      case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object'
        then current_room_state->'pinnedReservePlayers'
        else '{}'::jsonb
      end
    ) entry(key, raw_ids)
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end
    ) ids(value) on true
    group by key
  ) cleaned
  where jsonb_array_length(filtered_ids) > 0;

  if safe_reserve then
    side_pinned_ids := case
      when jsonb_typeof(next_pinned_reserve_players->safe_side) = 'array' then next_pinned_reserve_players->safe_side
      else '[]'::jsonb
    end;

    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
    into side_pinned_ids
    from (
      select distinct value
      from (
        select value from jsonb_array_elements_text(side_pinned_ids) ids(value)
        union all
        select safe_actor_id
      ) values_to_pin
      where value is not null
    ) distinct_values;

    next_pinned_reserve_players := jsonb_set(next_pinned_reserve_players, array[safe_side], side_pinned_ids, true);
  end if;

  insert into public.recruiting_applications (
    post_id, player_id, team_id, kind, side, status, reserve, position,
    player_ids, source_team_id, source_entry_id, created_at, updated_at
  )
  values (
    safe_post_id, safe_actor_id, null, 'player', safe_side, 'ready', safe_reserve, safe_position,
    '[]'::jsonb, null, null, now(), now()
  )
  on conflict (post_id, player_id, kind) do update set
    team_id = null,
    side = excluded.side,
    status = 'ready',
    reserve = excluded.reserve,
    position = excluded.position,
    player_ids = '[]'::jsonb,
    source_team_id = null,
    source_entry_id = null,
    updated_at = now();

  next_room_state := jsonb_set(
    current_room_state,
    '{pinnedReservePlayers}',
    coalesce(next_pinned_reserve_players, '{}'::jsonb),
    true
  );

  update public.recruiting_posts
  set
    room_state = next_room_state,
    updated_at = now()
  where id = safe_post_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'interestRecruitingPost',
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'side', safe_side,
    'reserve', safe_reserve,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_interest_player_action(text, text, text, text, text, boolean, text) from public;
grant execute on function public.rankball_recruiting_interest_player_action(text, text, text, text, text, boolean, text) to service_role;

create or replace function public.rankball_recruiting_ready_action(
  p_actor_profile_id text,
  p_post_id text,
  p_ready boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_ready boolean := coalesce(p_ready, true);
  current_post public.recruiting_posts%rowtype;
  current_application public.recruiting_applications%rowtype;
  current_room_state jsonb;
  next_room_state jsonb;
  next_stat_recorders jsonb;
  is_host_player boolean := false;
  has_application boolean := false;
  is_complex_member boolean := false;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  is_host_player := (
    current_post.player_id = safe_actor_id
    or coalesce(current_post.player_ids, '[]'::jsonb) ? safe_actor_id
  );

  next_room_state := current_room_state;
  if not safe_ready then
    select coalesce(jsonb_object_agg(key, to_jsonb(value)), '{}'::jsonb)
    into next_stat_recorders
    from jsonb_each_text(
      case when jsonb_typeof(current_room_state->'statRecorders') = 'object'
        then current_room_state->'statRecorders'
        else '{}'::jsonb
      end
    ) entry(key, value)
    where value <> safe_actor_id;
    next_room_state := jsonb_set(next_room_state, '{statRecorders}', coalesce(next_stat_recorders, '{}'::jsonb), true);
  end if;

  if is_host_player then
    update public.recruiting_posts
    set
      host_ready = safe_ready,
      room_state = next_room_state,
      updated_at = now()
    where id = safe_post_id;

    return jsonb_build_object(
      'ok', true,
      'action', 'setRecruitingReady',
      'postId', safe_post_id,
      'actorProfileId', safe_actor_id,
      'ready', safe_ready,
      'target', 'host',
      'sqlReducer', true
    );
  end if;

  select *
  into current_application
  from public.recruiting_applications application
  where application.post_id = safe_post_id
    and application.player_id = safe_actor_id
  for update;
  has_application := found;

  if has_application then
    if current_application.kind <> 'player'
      or current_application.reserve = true
      or jsonb_array_length(
        case when jsonb_typeof(current_application.player_ids) = 'array'
          then current_application.player_ids
          else '[]'::jsonb
        end
      ) > 0 then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'ready_complex_application_requires_replay', 'postId', safe_post_id);
    end if;

    update public.recruiting_applications
    set
      status = case when safe_ready then 'ready' else 'waiting' end,
      updated_at = now()
    where post_id = safe_post_id
      and player_id = safe_actor_id
      and kind = current_application.kind;

    update public.recruiting_posts
    set
      room_state = next_room_state,
      updated_at = now()
    where id = safe_post_id;

    return jsonb_build_object(
      'ok', true,
      'action', 'setRecruitingReady',
      'postId', safe_post_id,
      'actorProfileId', safe_actor_id,
      'ready', safe_ready,
      'target', 'application',
      'sqlReducer', true
    );
  end if;

  select (
    exists (
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and coalesce(application.player_ids, '[]'::jsonb) ? safe_actor_id
    )
    or exists (
      select 1
      from jsonb_each(
        case when jsonb_typeof(current_room_state->'partyReserves') = 'object'
          then current_room_state->'partyReserves'
          else '{}'::jsonb
        end
      ) entry(key, value)
      where (case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) ? safe_actor_id
    )
    or exists (
      select 1
      from jsonb_each(
        case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object'
          then current_room_state->'pinnedReservePlayers'
          else '{}'::jsonb
        end
      ) entry(key, value)
      where (case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) ? safe_actor_id
    )
  )
  into is_complex_member;

  if is_complex_member then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'ready_complex_member_requires_replay', 'postId', safe_post_id);
  end if;

  raise exception 'recruiting_room_member_required' using errcode = '42501';
end;
$$;

revoke all on function public.rankball_recruiting_ready_action(text, text, boolean) from public;
grant execute on function public.rankball_recruiting_ready_action(text, text, boolean) to service_role;

create or replace function public.rankball_recruiting_applicant_placement_action(
  p_actor_profile_id text,
  p_post_id text,
  p_player_id text,
  p_side text default null,
  p_reserve boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_player_id text := coalesce(nullif(btrim(p_player_id), ''), safe_actor_id);
  safe_side text := nullif(btrim(p_side), '');
  safe_reserve boolean := coalesce(p_reserve, false);
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_application public.recruiting_applications%rowtype;
  side_capacity integer;
  active_count integer := 0;
  reserve_count integer := 0;
  next_pinned_reserve_players jsonb;
  side_pinned_ids jsonb;
  next_room_state jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;
  if safe_player_id is null or safe_player_id <> safe_actor_id then
    raise exception 'recruiting_applicant_placement_permission_denied' using errcode = '42501';
  end if;

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  if current_post.status = 'closed' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recruiting_room_closed', 'postId', safe_post_id);
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);

  select *
  into current_application
  from public.recruiting_applications
  where post_id = safe_post_id
    and player_id = safe_player_id
    and kind = 'player'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'unsupported_host_or_team_placement', 'postId', safe_post_id);
  end if;

  if current_application.player_id <> safe_actor_id and not (coalesce(current_application.player_ids, '[]'::jsonb) ? safe_actor_id) then
    raise exception 'recruiting_applicant_placement_permission_denied' using errcode = '42501';
  end if;

  if safe_side is null or safe_side not in ('teamA', 'teamB') then
    safe_side := current_application.side;
  end if;

  if (
    (current_post.host_join_mode = 'team' or current_post.team_id is not null)
    and (coalesce(current_post.visibility, 'public') = 'private' or current_room_state->>'teamOnly' = 'true')
    and safe_side <> current_application.side
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'team_side_locked', 'postId', safe_post_id);
  end if;

  side_capacity := greatest(1, least(5, coalesce(current_post.side_capacity, 5)));

  if not safe_reserve then
    select coalesce(sum(player_count), 0)::integer
    into active_count
    from (
      select case
        when current_post.host_side = safe_side and current_post.host_join_mode = 'player' and current_post.player_id is not null then 1
        when current_post.host_side = safe_side and current_post.host_join_mode <> 'player' then jsonb_array_length(case when jsonb_typeof(coalesce(current_post.player_ids, '[]'::jsonb)) = 'array' then coalesce(current_post.player_ids, '[]'::jsonb) else '[]'::jsonb end)
        else 0
      end as player_count

      union all

      select case
        when application.kind = 'team' then greatest(1, jsonb_array_length(case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end))
        else 1
      end as player_count
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and application.player_id <> safe_player_id
        and application.side = safe_side
        and application.reserve = false
    ) active_rows;

    if active_count + 1 > side_capacity then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'side_capacity_requires_replay', 'postId', safe_post_id);
    end if;
  end if;

  select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb)
  into next_pinned_reserve_players
  from (
    select
      key,
      coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_player_id), '[]'::jsonb) as filtered_ids
    from jsonb_each(
      case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object'
        then current_room_state->'pinnedReservePlayers'
        else '{}'::jsonb
      end
    ) entry(key, raw_ids)
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end
    ) ids(value) on true
    group by key
  ) cleaned
  where jsonb_array_length(filtered_ids) > 0;

  if safe_reserve then
    select count(*)::integer
    into reserve_count
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.player_id <> safe_player_id
      and application.side = safe_side
      and application.reserve = true;

    side_pinned_ids := case
      when jsonb_typeof(next_pinned_reserve_players->safe_side) = 'array' then next_pinned_reserve_players->safe_side
      else '[]'::jsonb
    end;

    if greatest(reserve_count, jsonb_array_length(side_pinned_ids)) >= current_post.bench_capacity and not (side_pinned_ids ? safe_player_id) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_limit_requires_replay', 'postId', safe_post_id);
    end if;

    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
    into side_pinned_ids
    from (
      select distinct value
      from (
        select value from jsonb_array_elements_text(side_pinned_ids) ids(value)
        union all
        select safe_player_id
      ) values_to_pin
      where value is not null
    ) distinct_values;

    next_pinned_reserve_players := jsonb_set(next_pinned_reserve_players, array[safe_side], side_pinned_ids, true);
  end if;

  next_room_state := jsonb_set(
    current_room_state,
    '{pinnedReservePlayers}',
    coalesce(next_pinned_reserve_players, '{}'::jsonb),
    true
  );

  update public.recruiting_applications
  set
    side = safe_side,
    reserve = safe_reserve,
    status = 'waiting',
    updated_at = now()
  where post_id = safe_post_id
    and player_id = safe_player_id
    and kind = 'player';

  update public.recruiting_posts
  set
    room_state = next_room_state,
    updated_at = now()
  where id = safe_post_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setRecruitingApplicantPlacement',
    'postId', safe_post_id,
    'playerId', safe_player_id,
    'side', safe_side,
    'reserve', safe_reserve,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_applicant_placement_action(text, text, text, text, boolean) from public;
grant execute on function public.rankball_recruiting_applicant_placement_action(text, text, text, text, boolean) to service_role;

create or replace function public.rankball_current_recruiting_post_ids(
  p_profile_id text,
  p_limit integer default 50
)
returns table(post_id text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_profile_id), '') as profile_id,
      greatest(1, least(80, coalesce(p_limit, 50)))::integer as row_limit
  ),
  candidate_rows as (
    select post.id as post_id, post.updated_at
    from public.recruiting_posts post, params
    where params.profile_id is not null
      and post.status = 'open'
      and (
        post.player_id = params.profile_id
        or post.room_state->>'ownerId' = params.profile_id
        or coalesce(post.player_ids, '[]'::jsonb) ? params.profile_id
        or post.referee_id = params.profile_id
        or exists (
          select 1
          from public.rankball_room_state_participant_ids(post.room_state) room_profile
          where room_profile.profile_id = params.profile_id
        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(post.room_state->'invitations', '[]'::jsonb)) invitation
          where invitation->>'targetUserId' = params.profile_id
            and coalesce(invitation->>'status', 'pending') = 'pending'
        )
      )

    union all

    select
      post.id as post_id,
      greatest(coalesce(post.updated_at, post.created_at), coalesce(application.updated_at, application.created_at)) as updated_at
    from public.recruiting_applications application
    join public.recruiting_posts post on post.id = application.post_id
    cross join params
    where params.profile_id is not null
      and post.status = 'open'
      and (
        application.player_id = params.profile_id
        or coalesce(application.player_ids, '[]'::jsonb) ? params.profile_id
      )
  ),
  ranked_rows as (
    select
      candidate_rows.post_id,
      max(candidate_rows.updated_at) as updated_at
    from candidate_rows
    group by candidate_rows.post_id
  )
  select ranked_rows.post_id, ranked_rows.updated_at
  from ranked_rows, params
  order by ranked_rows.updated_at desc nulls last, ranked_rows.post_id desc
  limit (select row_limit from params);
$$;

revoke all on function public.rankball_current_recruiting_post_ids(text, integer) from public;
grant execute on function public.rankball_current_recruiting_post_ids(text, integer) to service_role;

create table if not exists public.user_room_feed (
  profile_id text not null,
  entity_type text not null,
  entity_id text not null,
  relation text not null,
  feed_scope text not null default 'profile',
  region_key text,
  status text,
  visibility text,
  timing_type text,
  scheduled_date date,
  sort_at timestamptz not null default now(),
  is_active boolean not null default true,
  card_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (profile_id, entity_type, entity_id, relation),
  constraint user_room_feed_entity_type_check check (entity_type in ('recruiting', 'match')),
  constraint user_room_feed_relation_check check (relation in ('region_public', 'owner', 'participant', 'invited', 'referee')),
  constraint user_room_feed_scope_check check (feed_scope in ('profile', 'public')),
  constraint user_room_feed_scope_relation_check check (
    (relation = 'region_public' and feed_scope = 'public')
    or (relation <> 'region_public' and feed_scope = 'profile')
  )
);

create table if not exists public.room_feed_cards (
  entity_type text not null,
  entity_id text not null,
  card_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (entity_type, entity_id),
  constraint room_feed_cards_entity_type_check check (entity_type in ('recruiting', 'match'))
);

drop index if exists public.user_room_feed_profile_idx;
drop index if exists public.user_room_feed_region_idx;
drop index if exists public.user_room_feed_profile_relation_idx;
drop index if exists public.user_room_feed_scope_public_idx;
drop index if exists public.user_room_feed_scope_profile_idx;

create index if not exists user_room_feed_active_public_idx
  on public.user_room_feed (entity_type, region_key, status, sort_at desc, entity_id desc)
  where feed_scope = 'public' and relation = 'region_public' and is_active = true;

create index if not exists user_room_feed_active_profile_idx
  on public.user_room_feed (entity_type, profile_id, relation, status, sort_at desc, entity_id desc)
  where feed_scope = 'profile' and is_active = true;

create index if not exists user_room_feed_entity_idx
  on public.user_room_feed (entity_type, entity_id);

create index if not exists match_players_user_match_idx
  on public.match_players (user_id, match_id);

create index if not exists match_players_match_user_idx
  on public.match_players (match_id, user_id);

create index if not exists matches_created_by_updated_idx
  on public.matches (created_by, updated_at desc, id desc);

create index if not exists matches_referee_updated_idx
  on public.matches (referee_id, updated_at desc, id desc);

create index if not exists matches_former_referee_updated_idx
  on public.matches (former_referee_id, updated_at desc, id desc);

alter table public.user_room_feed enable row level security;
alter table public.room_feed_cards enable row level security;

drop policy if exists user_room_feed_select_related on public.user_room_feed;
create policy user_room_feed_select_related
on public.user_room_feed
for select
to authenticated
using (
  feed_scope = 'profile'
  and profile_id = public.current_profile_id()
);

grant select on public.user_room_feed to authenticated;
grant select, insert, update on public.room_feed_cards to service_role;

create or replace function public.rankball_room_feed_region_key(p_value text)
returns text
language sql
immutable
as $$
  with normalized as (
    select regexp_replace(lower(btrim(coalesce(p_value, ''))), '\s+', ' ', 'g') as value
  ),
  district as (
    select coalesce((regexp_split_to_array(value, ' '))[array_length(regexp_split_to_array(value, ' '), 1)], value) as value
    from normalized
  )
  select nullif(regexp_replace(value, '(특별시|광역시|특별자치시|특별자치도|자치구|시|군|구)$', '', 'g'), '')
  from district;
$$;

create or replace function public.rankball_court_region_key(
  p_region text,
  p_address_text text default null,
  p_road_address text default null,
  p_jibun_address text default null,
  p_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  candidate text;
  candidate_key text;
  tokens text[];
  token text;
  raw_values text[] := array[
    p_payload->>'sigungu',
    p_payload->>'addressSigungu',
    p_payload->>'addressDistrict',
    p_road_address,
    p_jibun_address,
    p_address_text,
    p_payload->>'region',
    p_region,
    p_payload->>'addressDong'
  ];
begin
  foreach candidate in array raw_values loop
    candidate := regexp_replace(btrim(coalesce(candidate, '')), '\s+', ' ', 'g');
    if candidate is null or candidate = '' then
      continue;
    end if;

    candidate_key := public.rankball_room_feed_region_key(candidate);
    candidate_key := case candidate_key
      when '성수' then '성동'
      when '잠실' then '송파'
      else candidate_key
    end;

    tokens := regexp_split_to_array(candidate, '\s+');
    if array_length(tokens, 1) >= 2 then
      for token_index in 2..array_length(tokens, 1) loop
        token := nullif(btrim(tokens[token_index]), '');
        if token is not null and token ~ '(구|군|시)$' then
          candidate_key := public.rankball_room_feed_region_key(token);
          return case candidate_key
            when '성수' then '성동'
            when '잠실' then '송파'
            else candidate_key
          end;
        end if;
      end loop;
    end if;

    if candidate !~ '(특별시|광역시|특별자치시|특별자치도|도)$' then
      return candidate_key;
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.rankball_approved_courts_region_key_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.region_key := public.rankball_court_region_key(
    new.payload->>'region',
    new.address_text,
    new.road_address,
    new.jibun_address,
    new.payload
  );
  return new;
end;
$$;

create or replace function public.rankball_courts_region_key_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.region_key := public.rankball_court_region_key(new.region, null, null, null, '{}'::jsonb);
  return new;
end;
$$;

create or replace function public.rankball_court_snapshot(
  p_court_id text,
  p_fallback_name text default null,
  p_fallback_region text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  safe_name text := nullif(btrim(p_fallback_name), '');
  safe_region text := nullif(btrim(p_fallback_region), '');
  legacy_name text;
  legacy_region text;
  approved_name text;
  approved_region text;
begin
  if safe_court_id is not null then
    if to_regclass('public.courts') is not null then
      if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'courts'
          and column_name = 'region'
      ) then
        execute 'select name, region from public.courts where id = $1 limit 1'
        into legacy_name, legacy_region
        using safe_court_id;
      else
        execute 'select name from public.courts where id = $1 limit 1'
        into legacy_name
        using safe_court_id;
      end if;

      safe_name := coalesce(nullif(btrim(legacy_name), ''), safe_name);
      safe_region := coalesce(nullif(btrim(legacy_region), ''), safe_region);
    end if;

    if safe_name is null or safe_region is null then
      select nullif(btrim(name), ''), nullif(btrim(payload->>'region'), '')
      into approved_name, approved_region
      from public.approved_courts
      where id = safe_court_id
        and coalesce(status, 'active') = 'active'
      limit 1;

      safe_name := coalesce(safe_name, approved_name);
      safe_region := coalesce(safe_region, approved_region);
    end if;
  end if;

  return jsonb_build_object(
    'courtName', coalesce(safe_name, '미정'),
    'region', safe_region
  );
end;
$$;

create or replace function public.rankball_court_snapshot(
  p_court_id text,
  p_fallback_name text default null,
  p_fallback_region text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  safe_name text := nullif(btrim(p_fallback_name), '');
  safe_region text := nullif(btrim(p_fallback_region), '');
  safe_region_key text := public.rankball_court_region_key(safe_region, null, null, null, '{}'::jsonb);
  legacy_name text;
  legacy_region text;
  approved_id text;
  approved_name text;
  approved_region text;
  approved_region_key text;
  legacy_id text;
  candidate_count integer := 0;
  has_legacy_region boolean := false;
begin
  if safe_court_id is not null then
    if to_regclass('public.courts') is not null then
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'courts'
          and column_name = 'region'
      )
      into has_legacy_region;

      if has_legacy_region then
        execute 'select name, region from public.courts where id = $1 limit 1'
        into legacy_name, legacy_region
        using safe_court_id;
      else
        execute 'select name from public.courts where id = $1 limit 1'
        into legacy_name
        using safe_court_id;
      end if;

      safe_name := coalesce(nullif(btrim(legacy_name), ''), safe_name);
      safe_region_key := coalesce(public.rankball_court_region_key(legacy_region, null, null, null, '{}'::jsonb), safe_region_key);
      safe_region := coalesce(safe_region_key, nullif(btrim(legacy_region), ''), safe_region);
    end if;

    if safe_court_id is not null then
      select
        nullif(btrim(name), ''),
        nullif(btrim(payload->>'region'), ''),
        coalesce(
          nullif(btrim(region_key), ''),
          public.rankball_court_region_key(payload->>'region', address_text, road_address, jibun_address, payload)
        )
      into approved_name, approved_region, approved_region_key
      from public.approved_courts
      where id = safe_court_id
        and coalesce(status, 'active') = 'active'
      limit 1;

      safe_name := coalesce(safe_name, approved_name);
      safe_region_key := coalesce(safe_region_key, approved_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
    end if;
  end if;

  if safe_court_id is null and safe_name is not null and to_regclass('public.approved_courts') is not null then
    select count(*)
    into candidate_count
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
      and (
        safe_region_key is null
        or coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(court.payload->>'region', court.address_text, court.road_address, court.jibun_address, court.payload)
        ) = safe_region_key
      );

    if candidate_count = 1 then
      select
        court.id,
        nullif(btrim(court.name), ''),
        nullif(btrim(court.payload->>'region'), ''),
        coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(court.payload->>'region', court.address_text, court.road_address, court.jibun_address, court.payload)
        )
      into approved_id, approved_name, approved_region, approved_region_key
      from public.approved_courts court
      where coalesce(court.status, 'active') = 'active'
        and regexp_replace(coalesce(court.name, ''), '\s+', '', 'g') = regexp_replace(safe_name, '\s+', '', 'g')
        and (
          safe_region_key is null
          or coalesce(
            nullif(btrim(court.region_key), ''),
            public.rankball_court_region_key(court.payload->>'region', court.address_text, court.road_address, court.jibun_address, court.payload)
          ) = safe_region_key
        )
      limit 1;

      safe_court_id := approved_id;
      safe_name := coalesce(approved_name, safe_name);
      safe_region_key := coalesce(approved_region_key, safe_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
    end if;
  end if;

  if safe_court_id is null and safe_name is not null and to_regclass('public.courts') is not null then
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'courts'
        and column_name = 'region'
    )
    into has_legacy_region;

    if has_legacy_region then
      execute '
        select count(*)
        from public.courts court
        where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
          and (
            $2 is null
            or public.rankball_court_region_key(court.region, null, null, null, ''{}''::jsonb) = $2
          )'
      into candidate_count
      using safe_name, safe_region_key;

      if candidate_count = 1 then
        execute '
          select court.id, court.name, court.region
          from public.courts court
          where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
            and (
              $2 is null
              or public.rankball_court_region_key(court.region, null, null, null, ''{}''::jsonb) = $2
            )
          limit 1'
        into legacy_id, legacy_name, legacy_region
        using safe_name, safe_region_key;
      end if;
    else
      execute '
        select count(*)
        from public.courts court
        where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')'
      into candidate_count
      using safe_name;

      if candidate_count = 1 then
        execute '
          select court.id, court.name
          from public.courts court
          where regexp_replace(coalesce(court.name, ''''), ''\s+'', '''', ''g'') = regexp_replace($1, ''\s+'', '''', ''g'')
          limit 1'
        into legacy_id, legacy_name
        using safe_name;
      end if;
    end if;

    if legacy_id is not null then
      safe_court_id := legacy_id;
      safe_name := coalesce(nullif(btrim(legacy_name), ''), safe_name);
      safe_region_key := coalesce(public.rankball_court_region_key(legacy_region, null, null, null, '{}'::jsonb), safe_region_key);
      safe_region := coalesce(safe_region_key, nullif(btrim(legacy_region), ''), safe_region);
    end if;
  end if;

  return jsonb_build_object(
    'courtId', safe_court_id,
    'courtName', coalesce(safe_name, '미정'),
    'region', coalesce(safe_region_key, safe_region),
    'regionKey', safe_region_key
  );
end;
$$;

create or replace function public.rankball_upsert_room_feed_card(
  p_entity_type text,
  p_entity_id text,
  p_card_json jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.room_feed_cards (
    entity_type,
    entity_id,
    card_json,
    updated_at
  )
  values (
    p_entity_type,
    p_entity_id,
    coalesce(p_card_json, '{}'::jsonb),
    now()
  )
  on conflict (entity_type, entity_id)
  do update set
    card_json = excluded.card_json,
    updated_at = now();
$$;

create or replace function public.rankball_upsert_room_feed(
  p_profile_id text,
  p_entity_type text,
  p_entity_id text,
  p_relation text,
  p_region_key text,
  p_status text,
  p_visibility text,
  p_sort_at timestamptz,
  p_card_json jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  feed_card jsonb := coalesce(p_card_json, '{}'::jsonb);
  feed_timing_type text := nullif(feed_card->>'timingType', '');
  feed_scheduled_date date := case
    when coalesce(feed_card->>'scheduledDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then (feed_card->>'scheduledDate')::date
    else null
  end;
begin
  if jsonb_typeof(feed_card) = 'object' and feed_card <> '{}'::jsonb then
    perform public.rankball_upsert_room_feed_card(p_entity_type, p_entity_id, feed_card);
  end if;

  insert into public.user_room_feed (
    profile_id,
    entity_type,
    entity_id,
    relation,
    feed_scope,
    region_key,
    status,
    visibility,
    timing_type,
    scheduled_date,
    sort_at,
    is_active,
    card_json,
    updated_at
  )
  values (
    nullif(btrim(p_profile_id), ''),
    p_entity_type,
    p_entity_id,
    p_relation,
    case when p_relation = 'region_public' then 'public' else 'profile' end,
    p_region_key,
    p_status,
    p_visibility,
    feed_timing_type,
    feed_scheduled_date,
    coalesce(p_sort_at, now()),
    true,
    '{}'::jsonb,
    now()
  )
  on conflict (profile_id, entity_type, entity_id, relation)
  do update set
    feed_scope = excluded.feed_scope,
    region_key = excluded.region_key,
    status = excluded.status,
    visibility = excluded.visibility,
    timing_type = excluded.timing_type,
    scheduled_date = excluded.scheduled_date,
    sort_at = excluded.sort_at,
    is_active = true,
    card_json = '{}'::jsonb,
    updated_at = now();
end;
$$;

create or replace function public.rankball_refresh_recruiting_feed_for_post(p_post_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
  owner_id text;
  region_key text;
  row_sort_at timestamptz;
  card_json jsonb;
  application_cards jsonb := '[]'::jsonb;
  court_snapshot jsonb;
  court_region text;
  player_value text;
  application_row record;
  invitation_row jsonb;
begin
  update public.user_room_feed
  set is_active = false, updated_at = now()
  where entity_type = 'recruiting'
    and entity_id = p_post_id
    and is_active = true;

  select *
  into post_row
  from public.recruiting_posts
  where id = p_post_id;

  if not found then
    return;
  end if;

  row_sort_at := coalesce(post_row.updated_at, post_row.created_at, now());
  owner_id := coalesce(nullif(post_row.room_state->>'ownerId', ''), nullif(post_row.player_id, ''));
  court_snapshot := public.rankball_court_snapshot(post_row.court_id, post_row.court_name, post_row.region);
  court_region := nullif(btrim(court_snapshot->>'region'), '');
  region_key := public.rankball_room_feed_region_key(coalesce(court_region, post_row.region));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', coalesce(app.kind, 'player'),
        'joinMode', coalesce(app.kind, 'player'),
        'teamId', app.team_id,
        'playerId', app.player_id,
        'side', coalesce(app.side, 'teamB'),
        'status', coalesce(app.status, 'waiting'),
        'reserve', coalesce(app.reserve, false),
        'playerIds', coalesce(app.player_ids, '[]'::jsonb),
        'sourceTeamId', app.source_team_id,
        'sourceEntryId', app.source_entry_id
      )
      order by coalesce(app.updated_at, app.created_at) desc, app.player_id
    ),
    '[]'::jsonb
  )
  into application_cards
  from public.recruiting_applications app
  where app.post_id = post_row.id;

  card_json := jsonb_build_object(
    'id', post_row.id,
    'listCardOnly', true,
    'type', post_row.type,
    'title', post_row.title,
    'visibility', coalesce(post_row.visibility, 'public'),
    'region', coalesce(court_region, post_row.region),
    'courtId', post_row.court_id,
    'mode', post_row.mode,
    'scheduledDate', post_row.scheduled_date,
    'scheduledTime', case when post_row.scheduled_time is null then '' else left(post_row.scheduled_time::text, 5) end,
    'scheduledAt', case
      when post_row.room_state->>'timingType' = 'instant' then '즉시'
      when post_row.scheduled_date is not null and post_row.scheduled_time is not null then post_row.scheduled_date::text || ' ' || left(post_row.scheduled_time::text, 5)
      when post_row.scheduled_date is not null then post_row.scheduled_date::text
      else coalesce(post_row.scheduled_at::text, '미정')
    end,
    'timingType', case when post_row.room_state->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
    'ranked', coalesce(post_row.ranked, true),
    'official', coalesce(post_row.official, false),
    'preRegistered', coalesce(post_row.pre_registered, true),
    'ratingScale', coalesce(post_row.rating_scale, 1),
    'ageRestriction', coalesce(post_row.age_restriction, 'open'),
    'allowedAgeGroups', coalesce(post_row.allowed_age_groups, '[]'::jsonb),
    'spots', post_row.spots,
    'teamId', post_row.team_id,
    'targetTeamId', post_row.target_team_id,
    'refereeWanted', coalesce(post_row.room_state->'refereeWanted', to_jsonb(nullif(post_row.referee_id, '') is not null)),
    'refereeId', coalesce(post_row.referee_id, ''),
    'roomState', jsonb_build_object(
      'ownerId', owner_id,
      'teamOnly', coalesce(post_row.room_state->'teamOnly', 'false'::jsonb),
      'timingType', case when post_row.room_state->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
      'hostReserve', coalesce(post_row.room_state->'hostReserve', 'false'::jsonb),
      'refereeWanted', coalesce(post_row.room_state->'refereeWanted', to_jsonb(nullif(post_row.referee_id, '') is not null)),
      'invitations', coalesce(post_row.room_state->'invitations', '[]'::jsonb),
      'partyLeaders', coalesce(post_row.room_state->'partyLeaders', '{}'::jsonb),
      'partyReserves', coalesce(post_row.room_state->'partyReserves', '{}'::jsonb),
      'reserveReady', coalesce(post_row.room_state->'reserveReady', '{}'::jsonb),
      'pinnedReservePlayers', coalesce(post_row.room_state->'pinnedReservePlayers', '{}'::jsonb),
      'slotPositions', coalesce(post_row.room_state->'slotPositions', '{}'::jsonb),
      'approvalModeA', coalesce(post_row.room_state->>'approvalModeA', 'leader'),
      'approvalModeB', coalesce(post_row.room_state->>'approvalModeB', 'leader')
    ),
    'teamOnly', coalesce((post_row.room_state->>'teamOnly')::boolean, false),
    'hostJoinMode', post_row.host_join_mode,
    'hostSide', post_row.host_side,
    'hostReady', coalesce(post_row.host_ready, false),
    'sideCapacity', post_row.side_capacity,
    'benchCapacity', post_row.bench_capacity,
    'playerIds', coalesce(post_row.player_ids, '[]'::jsonb),
    'position', post_row.position,
    'playerId', post_row.player_id,
    'status', post_row.status,
    'createdAt', post_row.created_at,
    'updatedAt', post_row.updated_at,
    'applicants', application_cards
  );

  if post_row.status = 'open' and coalesce(post_row.visibility, 'public') = 'public' then
    perform public.rankball_upsert_room_feed(
      '*',
      'recruiting',
      post_row.id,
      'region_public',
      region_key,
      post_row.status,
      coalesce(post_row.visibility, 'public'),
      row_sort_at,
      card_json
    );
  end if;

  if post_row.status <> 'open' then
    return;
  end if;

  if owner_id is not null then
    perform public.rankball_upsert_room_feed(owner_id, 'recruiting', post_row.id, 'owner', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
  end if;

  if nullif(post_row.player_id, '') is not null and post_row.player_id is distinct from owner_id then
    perform public.rankball_upsert_room_feed(post_row.player_id, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
  end if;

  for player_value in
    select value
    from jsonb_array_elements_text(coalesce(post_row.player_ids, '[]'::jsonb))
  loop
    if nullif(player_value, '') is not null and player_value is distinct from owner_id then
      perform public.rankball_upsert_room_feed(player_value, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
    end if;
  end loop;

  for player_value in
    select profile_id
    from public.rankball_room_state_participant_ids(post_row.room_state)
  loop
    if nullif(player_value, '') is not null and player_value is distinct from owner_id then
      perform public.rankball_upsert_room_feed(player_value, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
    end if;
  end loop;

  if nullif(post_row.referee_id, '') is not null then
    perform public.rankball_upsert_room_feed(post_row.referee_id, 'recruiting', post_row.id, 'referee', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
  end if;

  for application_row in
    select *
    from public.recruiting_applications
    where post_id = post_row.id
  loop
    if nullif(application_row.player_id, '') is not null then
      perform public.rankball_upsert_room_feed(application_row.player_id, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), coalesce(application_row.updated_at, application_row.created_at, row_sort_at), card_json);
    end if;

    for player_value in
      select value
      from jsonb_array_elements_text(coalesce(application_row.player_ids, '[]'::jsonb))
    loop
      if nullif(player_value, '') is not null then
        perform public.rankball_upsert_room_feed(player_value, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), coalesce(application_row.updated_at, application_row.created_at, row_sort_at), card_json);
      end if;
    end loop;
  end loop;

  for invitation_row in
    select value
    from jsonb_array_elements(coalesce(post_row.room_state->'invitations', '[]'::jsonb))
  loop
    if coalesce(invitation_row->>'status', 'pending') = 'pending' and nullif(invitation_row->>'targetUserId', '') is not null then
      perform public.rankball_upsert_room_feed(
        invitation_row->>'targetUserId',
        'recruiting',
        post_row.id,
        'invited',
        region_key,
        post_row.status,
        coalesce(post_row.visibility, 'public'),
        coalesce(nullif(invitation_row->>'updatedAt', '')::timestamptz, nullif(invitation_row->>'createdAt', '')::timestamptz, row_sort_at),
        card_json
      );
    end if;
  end loop;
end;
$$;

create or replace function public.rankball_refresh_match_feed_for_match(p_match_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
  region_key text;
  row_sort_at timestamptz;
  card_json jsonb;
  court_snapshot jsonb;
  court_region text;
  team_a_players jsonb := '[]'::jsonb;
  team_b_players jsonb := '[]'::jsonb;
  agreements_json jsonb := jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb);
  approvals_json jsonb := jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb);
  disputes_json jsonb := '[]'::jsonb;
  player_row record;
begin
  update public.user_room_feed
  set is_active = false, updated_at = now()
  where entity_type = 'match'
    and entity_id = p_match_id
    and is_active = true;

  select *
  into match_row
  from public.matches
  where id = p_match_id;

  if not found then
    return;
  end if;

  row_sort_at := coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at, now());
  court_snapshot := public.rankball_court_snapshot(match_row.court_id, match_row.court_name, match_row.rules->>'region');
  court_region := nullif(btrim(court_snapshot->>'region'), '');
  region_key := public.rankball_room_feed_region_key(coalesce(court_region, match_row.rules->>'region'));

  select
    coalesce(jsonb_agg(mp.user_id order by mp.slot_order, mp.user_id) filter (where mp.side = 'teamA'), '[]'::jsonb),
    coalesce(jsonb_agg(mp.user_id order by mp.slot_order, mp.user_id) filter (where mp.side = 'teamB'), '[]'::jsonb)
  into team_a_players, team_b_players
  from public.match_players mp
  where mp.match_id = match_row.id;

  select jsonb_build_object(
    'teamA', coalesce(jsonb_agg(agreement.user_id order by agreement.user_id) filter (where agreement.side = 'teamA'), '[]'::jsonb),
    'teamB', coalesce(jsonb_agg(agreement.user_id order by agreement.user_id) filter (where agreement.side = 'teamB'), '[]'::jsonb)
  )
  into agreements_json
  from public.match_agreements agreement
  where agreement.match_id = match_row.id;

  select jsonb_build_object(
    'teamA', coalesce(jsonb_agg(approval.user_id order by approval.user_id) filter (where approval.side = 'teamA'), '[]'::jsonb),
    'teamB', coalesce(jsonb_agg(approval.user_id order by approval.user_id) filter (where approval.side = 'teamB'), '[]'::jsonb)
  )
  into approvals_json
  from public.match_approvals approval
  where approval.match_id = match_row.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', dispute.id,
    'by', dispute.user_id,
    'reason', dispute.reason,
    'createdAt', dispute.created_at
  ) order by dispute.created_at desc nulls last), '[]'::jsonb)
  into disputes_json
  from public.match_disputes dispute
  where dispute.match_id = match_row.id;

  card_json := jsonb_build_object(
    'id', match_row.id,
    'listCardOnly', true,
    'title', match_row.title,
    'mode', match_row.mode,
    'benchCapacity', case
      when coalesce(match_row.rules->>'benchCapacity', '') ~ '^[0-3]$' then (match_row.rules->>'benchCapacity')::integer
      else 2
    end,
    'courtId', match_row.court_id,
    'visibility', coalesce(match_row.visibility, match_row.rules->>'visibility', 'public'),
    'scheduledDate', match_row.scheduled_date,
    'scheduledTime', case when match_row.scheduled_time is null then '' else left(match_row.scheduled_time::text, 5) end,
    'scheduledAt', case
      when match_row.rules->>'timingType' = 'instant' then '즉시'
      when match_row.scheduled_date is not null and match_row.scheduled_time is not null then match_row.scheduled_date::text || ' ' || left(match_row.scheduled_time::text, 5)
      when match_row.scheduled_date is not null then match_row.scheduled_date::text
      else coalesce(match_row.scheduled_at::text, '미정')
    end,
    'timingType', case when match_row.rules->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
    'status', coalesce(match_row.status, 'contract'),
    'official', coalesce(match_row.official, false),
    'preRegistered', coalesce(match_row.pre_registered, false),
    'ranked', coalesce(match_row.ranked, true),
    'refereeId', coalesce(match_row.referee_id, ''),
    'formerRefereeId', coalesce(match_row.former_referee_id, ''),
    'refereeWanted', coalesce(match_row.referee_id, '') <> '' or coalesce((match_row.rules->>'refereeWanted')::boolean, false),
    'createdBy', coalesce(match_row.created_by, ''),
    'recruitingPostId', coalesce(match_row.rules->>'recruitingPostId', ''),
    'tournamentId', coalesce(match_row.tournament_id, ''),
    'teamA', jsonb_build_object(
      'teamId', coalesce(match_row.team_a_id, ''),
      'players', team_a_players,
      'score', coalesce(match_row.score_a, 0)
    ),
    'teamB', jsonb_build_object(
      'teamId', coalesce(match_row.team_b_id, ''),
      'players', team_b_players,
      'score', coalesce(match_row.score_b, 0)
    ),
    'agreements', agreements_json,
    'approvals', approvals_json,
    'disputes', disputes_json,
    'parties', coalesce(match_row.rules->'parties', '[]'::jsonb),
    'createdAt', match_row.created_at,
    'agreedAt', match_row.agreed_at,
    'startedAt', match_row.started_at,
    'endedAt', match_row.ended_at,
    'confirmedAt', match_row.confirmed_at,
    'cancelledAt', match_row.cancelled_at,
    'voidedAt', match_row.voided_at,
    'updatedAt', coalesce(match_row.updated_at, match_row.created_at)
  );

  if nullif(match_row.created_by, '') is not null then
    perform public.rankball_upsert_room_feed(match_row.created_by, 'match', match_row.id, 'owner', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
  end if;

  if nullif(match_row.referee_id, '') is not null then
    perform public.rankball_upsert_room_feed(match_row.referee_id, 'match', match_row.id, 'referee', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
  end if;

  if nullif(match_row.former_referee_id, '') is not null then
    perform public.rankball_upsert_room_feed(match_row.former_referee_id, 'match', match_row.id, 'referee', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
  end if;

  for player_row in
    select user_id
    from public.match_players
    where match_id = match_row.id
  loop
    if nullif(player_row.user_id, '') is not null then
      perform public.rankball_upsert_room_feed(player_row.user_id, 'match', match_row.id, 'participant', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
    end if;
  end loop;
end;
$$;

create or replace function public.rankball_match_list(
  p_profile_id text,
  p_limit integer default 5,
  p_cursor text default '',
  p_active_only boolean default false
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_profile_id), '') as profile_id,
      greatest(1, least(200, coalesce(p_limit, 5))) as row_limit,
      case
        when coalesce(p_cursor, '') like 'feed:%' and substring(coalesce(p_cursor, '') from 6) ~ '^[0-9]+$'
          then greatest(0, substring(coalesce(p_cursor, '') from 6)::integer)
        else 0
      end as row_offset
  ),
  grouped as (
    select
      feed.entity_id,
      max(feed.sort_at) as sort_at,
      max(feed.status) as status,
      coalesce(
        (
          select card.card_json
          from public.room_feed_cards card
          where card.entity_type = 'match'
            and card.entity_id = feed.entity_id
          limit 1
        ),
        (array_agg(feed.card_json order by feed.sort_at desc, feed.relation))[1],
        '{}'::jsonb
      ) as card_json,
      jsonb_agg(distinct feed.relation) as relations
    from public.user_room_feed feed, params
    where feed.entity_type = 'match'
      and feed.feed_scope = 'profile'
      and feed.profile_id = params.profile_id
      and feed.is_active = true
      and coalesce(feed.status, '') <> 'closed'
      and (
        not coalesce(p_active_only, false)
        or coalesce(feed.status, '') not in ('confirmed', 'cancelled', 'void', 'closed')
      )
      and feed.relation in ('owner', 'participant', 'referee')
    group by feed.entity_id
  ),
  paged as (
    select grouped.*
    from grouped, params
    order by grouped.sort_at desc nulls last, grouped.entity_id desc
    offset (select row_offset from params)
    limit (select row_limit + 1 from params)
  ),
  numbered as (
    select
      paged.*,
      row_number() over (order by paged.sort_at desc nulls last, paged.entity_id desc) as rn
    from paged
  )
  select jsonb_build_object(
    'rows',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entity_id', numbered.entity_id,
          'sort_at', numbered.sort_at,
          'status', numbered.status,
          'relations', numbered.relations,
          'card_json', numbered.card_json
        )
        order by numbered.sort_at desc nulls last, numbered.entity_id desc
      ) filter (where numbered.rn <= (select row_limit from params)),
      '[]'::jsonb
    ),
    'cursor',
    case
      when count(*) > (select row_limit from params) then 'feed:' || ((select row_offset from params) + (select row_limit from params))::text
      else ''
    end,
    'exhausted',
    count(*) <= (select row_limit from params)
  )
  from numbered, params;
$$;

revoke all on function public.rankball_match_list(text, integer, text, boolean) from public;
grant execute on function public.rankball_match_list(text, integer, text, boolean) to service_role;

create or replace function public.rankball_recruiting_feed_counts(p_profile_id text)
returns table(created bigint, joined bigint, invited bigint)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select entity_id, relation
    from public.user_room_feed
    where profile_id = nullif(btrim(p_profile_id), '')
      and entity_type = 'recruiting'
      and feed_scope = 'profile'
      and is_active = true
      and status = 'open'
      and relation in ('owner', 'participant', 'invited', 'referee')
  ),
  owned as (
    select distinct entity_id
    from scoped
    where relation = 'owner'
  ),
  joined_rows as (
    select distinct scoped.entity_id
    from scoped
    where scoped.relation in ('participant', 'referee')
      and not exists (
        select 1
        from owned
        where owned.entity_id = scoped.entity_id
      )
  ),
  invited_rows as (
    select distinct entity_id
    from scoped
    where relation = 'invited'
  )
  select
    (select count(*) from owned)::bigint as created,
    (select count(*) from joined_rows)::bigint as joined,
    (select count(*) from invited_rows)::bigint as invited;
$$;

revoke all on function public.rankball_recruiting_feed_counts(text) from public;
grant execute on function public.rankball_recruiting_feed_counts(text) to service_role;

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

create or replace function public.rankball_recruiting_schedule_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_room_state jsonb := coalesce(new.room_state, '{}'::jsonb);
  previous_timing text := null;
  requested_timing text;
  safe_timing text;
begin
  if tg_op = 'UPDATE' then
    previous_timing := old.room_state->>'timingType';
  end if;

  requested_timing := coalesce(safe_room_state->>'timingType', previous_timing);

  safe_timing := case
    when requested_timing = 'instant' then 'instant'
    when safe_room_state ? 'timingType' then 'scheduled'
    when lower(btrim(coalesce(new.scheduled_at::text, ''))) in ('instant', '즉시') then 'instant'
    else 'scheduled'
  end;

  new.room_state := safe_room_state || jsonb_build_object('timingType', safe_timing);

  if safe_timing = 'instant' then
    new.scheduled_date := null;
    new.scheduled_time := null;
    new.scheduled_at := null;
  elsif new.scheduled_date is not null and new.scheduled_time is not null then
    new.scheduled_at := new.scheduled_date::text || ' ' || left(new.scheduled_time::text, 5);
  elsif new.scheduled_date is not null then
    new.scheduled_at := new.scheduled_date::text;
  else
    new.scheduled_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.rankball_match_court_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_rules jsonb := coalesce(new.rules, '{}'::jsonb);
  snapshot jsonb;
  snapshot_region text;
begin
  snapshot := public.rankball_court_snapshot(new.court_id, new.court_name, safe_rules->>'region');
  snapshot_region := nullif(btrim(snapshot->>'region'), '');

  new.court_name := coalesce(nullif(btrim(snapshot->>'courtName'), ''), '미정');
  new.rules := safe_rules;

  if snapshot_region is not null then
    new.rules := new.rules || jsonb_build_object('region', snapshot_region);
  end if;

  return new;
end;
$$;

create or replace function public.rankball_recruiting_court_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot jsonb;
  snapshot_region text;
begin
  snapshot := public.rankball_court_snapshot(new.court_id, new.court_name, new.region);
  snapshot_region := nullif(btrim(snapshot->>'region'), '');

  new.court_name := coalesce(nullif(btrim(snapshot->>'courtName'), ''), '미정');
  new.region := coalesce(snapshot_region, nullif(btrim(new.region), ''));

  return new;
end;
$$;

create or replace function public.rankball_tournament_court_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot jsonb;
  snapshot_court_id text;
  snapshot_region text;
begin
  snapshot := public.rankball_court_snapshot(new.court_id, new.court_name, new.region);
  snapshot_court_id := nullif(btrim(snapshot->>'courtId'), '');
  snapshot_region := nullif(btrim(snapshot->>'region'), '');

  new.court_id := coalesce(snapshot_court_id, nullif(btrim(new.court_id), ''));
  new.court_name := coalesce(nullif(btrim(snapshot->>'courtName'), ''), '미정');
  new.region := coalesce(snapshot_region, nullif(btrim(new.region), ''));

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

  if to_regclass('public.recruiting_posts') is not null then
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

  if to_regclass('public.recruiting_posts') is not null then
    for row_id in
      select id
      from public.recruiting_posts
      where team_id = safe_team_id
        or target_team_id = safe_team_id
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
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

  if to_regclass('public.recruiting_posts') is not null then
    with snapshots as (
      select
        post.id,
        snapshot.data->>'courtName' as court_name,
        nullif(btrim(snapshot.data->>'region'), '') as region
      from public.recruiting_posts post
      cross join lateral public.rankball_court_snapshot(post.court_id, post.court_name, post.region) as snapshot(data)
      where post.court_id = safe_court_id
    )
    update public.recruiting_posts post
    set
      court_name = snapshots.court_name,
      region = coalesce(snapshots.region, post.region)
    from snapshots
    where post.id = snapshots.id
      and (
        post.court_name is distinct from snapshots.court_name
        or (snapshots.region is not null and post.region is distinct from snapshots.region)
      );

    for row_id in
      select id
      from public.recruiting_posts
      where court_id = safe_court_id
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
    with snapshots as (
      select
        match_row.id,
        snapshot.data->>'courtName' as court_name,
        nullif(btrim(snapshot.data->>'region'), '') as region
      from public.matches match_row
      cross join lateral public.rankball_court_snapshot(match_row.court_id, match_row.court_name, match_row.rules->>'region') as snapshot(data)
      where match_row.court_id = safe_court_id
    )
    update public.matches match_row
    set
      court_name = snapshots.court_name,
      rules = case
        when snapshots.region is null then coalesce(match_row.rules, '{}'::jsonb)
        else coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object('region', snapshots.region)
      end
    from snapshots
    where match_row.id = snapshots.id
      and (
        match_row.court_name is distinct from snapshots.court_name
        or (snapshots.region is not null and match_row.rules->>'region' is distinct from snapshots.region)
      );

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

create or replace function public.rankball_match_schedule_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_rules jsonb := coalesce(new.rules, '{}'::jsonb);
  previous_timing text := null;
  requested_timing text;
  safe_timing text;
begin
  if tg_op = 'UPDATE' then
    previous_timing := old.rules->>'timingType';
  end if;

  requested_timing := coalesce(safe_rules->>'timingType', previous_timing);

  safe_timing := case
    when requested_timing = 'instant' then 'instant'
    when safe_rules ? 'timingType' then 'scheduled'
    when lower(btrim(coalesce(new.scheduled_at::text, ''))) in ('instant', '즉시') then 'instant'
    else 'scheduled'
  end;

  new.rules := safe_rules || jsonb_build_object('timingType', safe_timing);

  if safe_timing = 'instant' then
    new.scheduled_date := null;
    new.scheduled_time := null;
    new.scheduled_at := null;
  elsif new.scheduled_date is not null and new.scheduled_time is not null then
    new.scheduled_at := new.scheduled_date::text || ' ' || left(new.scheduled_time::text, 5);
  elsif new.scheduled_date is not null then
    new.scheduled_at := new.scheduled_date::text;
  else
    new.scheduled_at := null;
  end if;

  return new;
end;
$$;

create or replace function public.rankball_match_visibility_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_rules jsonb := coalesce(new.rules, '{}'::jsonb);
  previous_visibility text := null;
  safe_visibility text;
begin
  if tg_op = 'UPDATE' then
    previous_visibility := old.visibility;
  end if;

  safe_visibility := case
    when new.visibility in ('public', 'private') then new.visibility
    when previous_visibility in ('public', 'private') then previous_visibility
    when safe_rules->>'visibility' in ('public', 'private') then safe_rules->>'visibility'
    else 'private'
  end;

  new.visibility := safe_visibility;
  new.rules := safe_rules || jsonb_build_object('visibility', safe_visibility);
  return new;
end;
$$;

create or replace function public.rankball_sync_match_score_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.matches
    set score_a = 0,
        score_b = 0
    where id = old.match_id
      and (score_a is distinct from 0 or score_b is distinct from 0);
    return old;
  end if;

  update public.matches
  set score_a = coalesce(new.score_a, 0),
      score_b = coalesce(new.score_b, 0)
  where id = new.match_id
    and (
      score_a is distinct from coalesce(new.score_a, 0)
      or score_b is distinct from coalesce(new.score_b, 0)
    );

  return new;
end;
$$;

create or replace function public.rankball_match_score_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  result_score record;
begin
  select score_a, score_b
  into result_score
  from public.match_results
  where match_id = new.id
  limit 1;

  if found then
    new.score_a := coalesce(result_score.score_a, 0);
    new.score_b := coalesce(result_score.score_b, 0);
  else
    new.score_a := 0;
    new.score_b := 0;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.recruiting_posts') is not null then
    execute 'drop trigger if exists rankball_recruiting_court_snapshot_guard on public.recruiting_posts';
    execute 'create trigger rankball_recruiting_court_snapshot_guard before insert or update of court_id, court_name, region on public.recruiting_posts for each row execute function public.rankball_recruiting_court_snapshot_guard()';
    execute 'drop trigger if exists rankball_recruiting_schedule_snapshot_guard on public.recruiting_posts';
    execute 'create trigger rankball_recruiting_schedule_snapshot_guard before insert or update of scheduled_at, scheduled_date, scheduled_time, room_state on public.recruiting_posts for each row execute function public.rankball_recruiting_schedule_snapshot_guard()';
    execute 'drop trigger if exists rankball_recruiting_posts_feed_refresh on public.recruiting_posts';
    execute 'create trigger rankball_recruiting_posts_feed_refresh after insert or update or delete on public.recruiting_posts for each row execute function public.rankball_refresh_recruiting_feed_trigger()';
  end if;

  if to_regclass('public.recruiting_applications') is not null then
    execute 'drop trigger if exists rankball_recruiting_applications_feed_refresh on public.recruiting_applications';
    execute 'create trigger rankball_recruiting_applications_feed_refresh after insert or update or delete on public.recruiting_applications for each row execute function public.rankball_refresh_recruiting_application_feed_trigger()';
  end if;

  if to_regclass('public.matches') is not null then
    execute 'drop trigger if exists rankball_matches_court_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_court_snapshot_guard before insert or update of court_id, court_name, rules on public.matches for each row execute function public.rankball_match_court_snapshot_guard()';
    execute 'drop trigger if exists rankball_matches_schedule_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_schedule_snapshot_guard before insert or update of scheduled_at, scheduled_date, scheduled_time, rules on public.matches for each row execute function public.rankball_match_schedule_snapshot_guard()';
    execute 'drop trigger if exists rankball_matches_visibility_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_visibility_snapshot_guard before insert or update of visibility, rules on public.matches for each row execute function public.rankball_match_visibility_snapshot_guard()';
    execute 'drop trigger if exists rankball_matches_feed_refresh on public.matches';
    execute 'create trigger rankball_matches_feed_refresh after insert or update or delete on public.matches for each row execute function public.rankball_refresh_match_feed_trigger()';
  end if;

  if to_regclass('public.matches') is not null
    and to_regclass('public.match_results') is not null then
    execute 'drop trigger if exists rankball_matches_score_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_score_snapshot_guard before insert or update of score_a, score_b on public.matches for each row execute function public.rankball_match_score_snapshot_guard()';
  end if;

  if to_regclass('public.tournaments') is not null then
    execute 'drop trigger if exists rankball_tournaments_court_snapshot_guard on public.tournaments';
    execute 'create trigger rankball_tournaments_court_snapshot_guard before insert or update of court_id, court_name, region on public.tournaments for each row execute function public.rankball_tournament_court_snapshot_guard()';
  end if;

  if to_regclass('public.match_players') is not null then
    execute 'drop trigger if exists rankball_match_players_feed_refresh on public.match_players';
    execute 'create trigger rankball_match_players_feed_refresh after insert or update or delete on public.match_players for each row execute function public.rankball_refresh_match_player_feed_trigger()';
  end if;

  if to_regclass('public.match_agreements') is not null and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_agreements'
      and column_name = 'match_id'
  ) then
    execute 'drop trigger if exists rankball_match_agreements_feed_refresh on public.match_agreements';
    execute 'create trigger rankball_match_agreements_feed_refresh after insert or update or delete on public.match_agreements for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.match_approvals') is not null and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_approvals'
      and column_name = 'match_id'
  ) then
    execute 'drop trigger if exists rankball_match_approvals_feed_refresh on public.match_approvals';
    execute 'create trigger rankball_match_approvals_feed_refresh after insert or update or delete on public.match_approvals for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.match_disputes') is not null and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_disputes'
      and column_name = 'match_id'
  ) then
    execute 'drop trigger if exists rankball_match_disputes_feed_refresh on public.match_disputes';
    execute 'create trigger rankball_match_disputes_feed_refresh after insert or update or delete on public.match_disputes for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.team_members') is not null and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'team_members'
      and column_name = 'team_id'
  ) then
    execute 'drop trigger if exists rankball_team_members_feed_dependency_refresh on public.team_members';
    execute 'create trigger rankball_team_members_feed_dependency_refresh after insert or update of team_id or delete on public.team_members for each row execute function public.rankball_refresh_team_member_feed_dependency_trigger()';
  end if;

  if to_regclass('public.match_results') is not null and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_results'
      and column_name = 'match_id'
  ) then
    execute 'drop trigger if exists rankball_match_results_feed_refresh on public.match_results';
    execute 'create trigger rankball_match_results_feed_refresh after insert or update or delete on public.match_results for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
    execute 'drop trigger if exists rankball_match_results_score_snapshot on public.match_results';
    execute 'create trigger rankball_match_results_score_snapshot after insert or update of score_a, score_b or delete on public.match_results for each row execute function public.rankball_sync_match_score_snapshot()';
  end if;

  if to_regclass('public.player_match_stats') is not null and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'player_match_stats'
      and column_name = 'match_id'
  ) then
    execute 'drop trigger if exists rankball_player_match_stats_feed_refresh on public.player_match_stats';
    execute 'create trigger rankball_player_match_stats_feed_refresh after insert or update or delete on public.player_match_stats for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists rankball_profiles_feed_dependency_refresh on public.profiles';
    execute 'create trigger rankball_profiles_feed_dependency_refresh after insert or update of id, name, handle, hashtag, position, region, region_sido, region_district, avatar_color or delete on public.profiles for each row execute function public.rankball_refresh_profile_feed_dependency_trigger()';
  end if;

  if to_regclass('public.teams') is not null then
    execute 'drop trigger if exists rankball_teams_feed_dependency_refresh on public.teams';
    execute 'create trigger rankball_teams_feed_dependency_refresh after insert or update of id, name, deleted_at or delete on public.teams for each row execute function public.rankball_refresh_team_feed_dependency_trigger()';
  end if;

  if to_regclass('public.approved_courts') is not null then
    execute 'drop trigger if exists rankball_approved_courts_region_key_guard on public.approved_courts';
    execute 'create trigger rankball_approved_courts_region_key_guard before insert or update of payload, address_text, road_address, jibun_address on public.approved_courts for each row execute function public.rankball_approved_courts_region_key_guard()';
    execute 'drop trigger if exists rankball_approved_courts_feed_dependency_refresh on public.approved_courts';
    execute 'create trigger rankball_approved_courts_feed_dependency_refresh after insert or update of id, name, status, payload, address_text, road_address, jibun_address, region_key or delete on public.approved_courts for each row execute function public.rankball_refresh_court_feed_dependency_trigger()';
  end if;

  if to_regclass('public.courts') is not null then
    execute 'alter table public.courts add column if not exists region_key text';
    execute 'create index if not exists courts_region_key_idx on public.courts (region_key) where region_key is not null';
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'courts'
        and column_name = 'region'
    ) then
      execute 'update public.courts set region_key = public.rankball_court_region_key(region, null, null, null, ''{}''::jsonb) where region_key is distinct from public.rankball_court_region_key(region, null, null, null, ''{}''::jsonb)';
      execute 'drop trigger if exists rankball_courts_region_key_guard on public.courts';
      execute 'create trigger rankball_courts_region_key_guard before insert or update of region on public.courts for each row execute function public.rankball_courts_region_key_guard()';
    end if;
    execute 'drop trigger if exists rankball_courts_feed_dependency_refresh on public.courts';
    execute 'create trigger rankball_courts_feed_dependency_refresh after insert or update or delete on public.courts for each row execute function public.rankball_refresh_court_feed_dependency_trigger()';
  end if;
end;
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null then
    for row_id in select id from public.recruiting_posts loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
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
      'rankball_approved_courts_feed_dependency_refresh',
      'rankball_courts_feed_dependency_refresh'
    ])
  order by trigger_row.trigger_name;
$$;

revoke all on function public.rankball_feed_trigger_health() from public;
grant execute on function public.rankball_feed_trigger_health() to service_role;

select pg_notify('pgrst', 'reload schema');

-- Authoritative bench-capacity and supported-mode guards.
-- Keep synchronized with 20260722225600_bench_capacity_authoritative_guards.sql
-- and 20260722225700_bench_capacity_three.sql.
create or replace function pg_temp.rankball_patch_function_definition(
  target_function regprocedure,
  old_fragment text,
  new_fragment text,
  shape_error text
)
returns void
language plpgsql
as $helper$
declare
  function_definition text;
begin
  select pg_get_functiondef(target_function) into function_definition;
  if function_definition is null then
    raise exception '%', shape_error;
  end if;
  if position(old_fragment in function_definition) > 0 then
    execute replace(function_definition, old_fragment, new_fragment);
  elsif position(new_fragment in function_definition) = 0 then
    raise exception '%', shape_error;
  end if;
end;
$helper$;

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$  side_capacity integer;
  active_a jsonb;$old$,
  $new$  side_capacity integer;
  bench_capacity integer;
  active_a jsonb;$new$,
  'match_room_bench_declaration_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$  side_capacity := greatest(1, least(5, coalesce((current_match.rules->>'sideCapacity')::integer, substring(current_match.mode from '^[0-9]+')::integer, 5)));$old$,
  $new$  side_capacity := greatest(1, least(5, coalesce((current_match.rules->>'sideCapacity')::integer, substring(current_match.mode from '^[0-9]+')::integer, 5)));
  bench_capacity := case
    when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-3]$' then (current_match.rules->>'benchCapacity')::integer
    else 2
  end;$new$,
  'match_room_bench_initialization_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$    side_capacity := greatest(1, least(5, coalesce((patch->>'sideCapacity')::integer, side_capacity)));
    if jsonb_array_length(active_a) > side_capacity or jsonb_array_length(active_b) > side_capacity then$old$,
  $new$    side_capacity := greatest(1, least(5, coalesce((patch->>'sideCapacity')::integer, side_capacity)));
    if side_capacity not in (1, 2, 3, 5)
       and not (side_capacity = 4 and coalesce(current_match.rules->>'recordType', '') = 'solo') then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    if patch ? 'benchCapacity' and coalesce(patch->>'benchCapacity', '') !~ '^[0-3]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    bench_capacity := coalesce((patch->>'benchCapacity')::integer, bench_capacity);
    if jsonb_array_length(active_a) > side_capacity or jsonb_array_length(active_b) > side_capacity then$new$,
  'match_room_mode_and_bench_guard_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$          'sideCapacity', side_capacity,
          'targetScore',$old$,
  $new$          'sideCapacity', side_capacity,
          'benchCapacity', bench_capacity,
          'targetScore',$new$,
  'match_room_rules_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  '      limit 2',
  '      limit bench_capacity',
  'match_room_roster_bench_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$        if jsonb_array_length(coalesce(reserves->target_side, '[]'::jsonb)) >= 2 then raise exception 'match_reserve_full' using errcode = '23514'; end if;$old$,
  $new$        if jsonb_array_length(coalesce(reserves->target_side, '[]'::jsonb)) >= bench_capacity then raise exception 'match_reserve_full' using errcode = '23514'; end if;$new$,
  'match_room_placement_bench_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$  side_capacity integer;
  active_count integer;$old$,
  $new$  side_capacity integer;
  bench_capacity integer;
  active_count integer;$new$,
  'recruiting_management_bench_declaration_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$    side_capacity := greatest(1, least(5, coalesce((draft->>'sideCapacity')::integer, substring(coalesce(draft->>'mode', '5v5') from '^[0-9]+')::integer, 5)));$old$,
  $new$    side_capacity := greatest(1, least(5, coalesce((draft->>'sideCapacity')::integer, substring(coalesce(draft->>'mode', '5v5') from '^[0-9]+')::integer, 5)));
    if side_capacity not in (1, 2, 3, 5)
       or coalesce(nullif(btrim(draft->>'mode'), ''), side_capacity::text || 'v' || side_capacity::text) <> side_capacity::text || 'v' || side_capacity::text then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    if coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2') !~ '^[0-3]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    bench_capacity := coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2')::integer;$new$,
  'recruiting_management_create_policy_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$      coalesce(draft->'rules', '{}'::jsonb) || jsonb_build_object('mmrRangeMode', mmr_range_mode, 'ratingScale', rating_scale),$old$,
  $new$      coalesce(draft->'rules', '{}'::jsonb) || jsonb_build_object(
        'sideCapacity', side_capacity,
        'benchCapacity', bench_capacity,
        'mmrRangeMode', mmr_range_mode,
        'ratingScale', rating_scale
      ),$new$,
  'recruiting_management_create_rules_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$  side_capacity := current_post.side_capacity;

  if safe_action = 'interestRecruitingPost' then$old$,
  $new$  side_capacity := current_post.side_capacity;
  bench_capacity := current_post.bench_capacity;

  if safe_action = 'interestRecruitingPost' then$new$,
  'recruiting_management_existing_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  ' > 2 then',
  ' > bench_capacity then',
  'recruiting_management_bench_overflow_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'limit 2',
  'limit bench_capacity',
  'recruiting_management_bench_query_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'reserve_count >= 2',
  'reserve_count >= bench_capacity',
  'recruiting_management_bench_count_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'side_reserve_count(current_post, safe_side) >= 2',
  'side_reserve_count(current_post, safe_side) >= bench_capacity',
  'recruiting_management_side_bench_count_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'jsonb_array_length(next_reserve_ids) >= 2',
  'jsonb_array_length(next_reserve_ids) >= bench_capacity',
  'recruiting_management_party_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$    side_capacity := greatest(1, least(5, coalesce((payload->>'sideCapacity')::integer, current_post.side_capacity)));
    if public.rankball_recruiting_side_active_count(current_post, 'teamA') > side_capacity$old$,
  $new$    side_capacity := greatest(1, least(5, coalesce((payload->>'sideCapacity')::integer, current_post.side_capacity)));
    if side_capacity not in (1, 2, 3, 5) then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    if payload ? 'benchCapacity' and coalesce(payload->>'benchCapacity', '') !~ '^[0-3]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    bench_capacity := coalesce((payload->>'benchCapacity')::integer, current_post.bench_capacity);
    if public.rankball_recruiting_side_active_count(current_post, 'teamA') > side_capacity$new$,
  'recruiting_management_update_policy_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$    set mode = management.side_capacity::text || 'v' || management.side_capacity::text,
        side_capacity = management.side_capacity,$old$,
  $new$    set mode = management.side_capacity::text || 'v' || management.side_capacity::text,
        side_capacity = management.side_capacity,
        bench_capacity = management.bench_capacity,$new$,
  'recruiting_management_update_bench_column_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'targetScore',$old$,
  $new$        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'sideCapacity', management.side_capacity,
          'benchCapacity', management.bench_capacity,
          'targetScore',$new$,
  'recruiting_management_update_rules_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action(text,jsonb)'::regprocedure,
  '    elsif jsonb_array_length(next_reserves) < 2 then',
  '    elsif jsonb_array_length(next_reserves) < current_post.bench_capacity then',
  'recruiting_management_summon_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_pre_summon(text,jsonb)'::regprocedure,
  '  if jsonb_array_length(selected_reserve) > 2 then',
  '  if jsonb_array_length(selected_reserve) > current_post.bench_capacity then',
  'recruiting_management_pre_summon_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_side_party_join_action(text,text,text,text,text)'::regprocedure,
  '    if side_reserve_count >= 2 then',
  '    if side_reserve_count >= post_row.bench_capacity then',
  'recruiting_side_party_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure,
  $old$  capacity integer;
  captain_id text;$old$,
  $new$  capacity integer;
  bench_capacity integer;
  captain_id text;$new$,
  'tournament_roster_bench_declaration_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure,
  $old$  )));
  team_snapshot := tournament_row.rules #> array['teamRosterSnapshot', 'teams', side_team_id];$old$,
  $new$  )));
  bench_capacity := case
    when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-3]$' then (current_match.rules->>'benchCapacity')::integer
    else 2
  end;
  team_snapshot := tournament_row.rules #> array['teamRosterSnapshot', 'teams', side_team_id];$new$,
  'tournament_roster_bench_initialization_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure,
  $old$  if jsonb_array_length(requested_reserve) > 2 then raise exception 'match_reserve_full' using errcode = '23514'; end if;$old$,
  $new$  if jsonb_array_length(requested_reserve) > bench_capacity then raise exception 'match_reserve_full' using errcode = '23514'; end if;$new$,
  'tournament_roster_bench_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_operation_action(text,jsonb)'::regprocedure,
  $old$    capacity := greatest(1, least(5, coalesce(substring(coalesce(nullif(btrim(draft->>'mode'), ''), '5v5') from '^(\d+)')::integer, 5)));
    rules_json :=$old$,
  $new$    capacity := greatest(1, least(5, coalesce(substring(coalesce(nullif(btrim(draft->>'mode'), ''), '5v5') from '^(\d+)')::integer, 5)));
    if capacity not in (1, 2, 3, 5)
       or coalesce(nullif(btrim(draft->>'mode'), ''), '5v5') <> capacity::text || 'v' || capacity::text then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    rules_json :=$new$,
  'tournament_create_mode_guard_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_operation_action(text,jsonb)'::regprocedure,
  $old$    roster_snapshot := jsonb_build_object('version', 1, 'capturedAt', now_at, 'teams', '{}'::jsonb);$old$,
  $new$    if coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2') !~ '^[0-3]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    rules_json := rules_json || jsonb_build_object(
      'sideCapacity', capacity,
      'benchCapacity', coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2')::integer
    );
    roster_snapshot := jsonb_build_object('version', 1, 'capturedAt', now_at, 'teams', '{}'::jsonb);$new$,
  'tournament_create_bench_policy_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_create_tournament_match_locked_unguarded(text,text,text,integer,integer,text)'::regprocedure,
  $old$  end if;
  if nullif(btrim(p_team_a_id), '') is null or nullif(btrim(p_team_b_id), '') is null or p_team_a_id = p_team_b_id then$old$,
  $new$  end if;
  if coalesce(tournament_row.mode, '') not in ('1v1', '2v2', '3v3', '5v5') then
    raise exception 'unsupported_match_mode' using errcode = '23514';
  end if;
  if nullif(btrim(p_team_a_id), '') is null or nullif(btrim(p_team_b_id), '') is null or p_team_a_id = p_team_b_id then$new$,
  'tournament_child_mode_guard_shape_changed'
);

alter table public.recruiting_posts
  drop constraint if exists recruiting_posts_supported_mode_check;
alter table public.recruiting_posts
  add constraint recruiting_posts_supported_mode_check
  check (coalesce(mode, '') in ('1v1', '2v2', '3v3', '5v5')) not valid;
alter table public.recruiting_posts validate constraint recruiting_posts_supported_mode_check;

alter table public.tournaments
  drop constraint if exists tournaments_supported_mode_check;
alter table public.tournaments
  add constraint tournaments_supported_mode_check
  check (coalesce(mode, '') in ('1v1', '2v2', '3v3', '5v5')) not valid;
alter table public.tournaments validate constraint tournaments_supported_mode_check;

alter table public.matches
  drop constraint if exists matches_supported_mode_check;
alter table public.matches
  add constraint matches_supported_mode_check
  check (
    coalesce(mode, '') in ('1v1', '2v2', '3v3', '5v5')
    or (mode = '4v4' and coalesce(rules->>'recordType', '') = 'solo')
  ) not valid;
alter table public.matches validate constraint matches_supported_mode_check;

notify pgrst, 'reload schema';

create or replace function public.rankball_confirm_recruiting_match_action(
  p_actor_profile_id text,
  p_post_action text,
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_recruiting_notification_rows jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null,
  p_match_action text default 'confirmRecruitingMatch',
  p_match_row jsonb default '{}'::jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_match_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  current_post public.recruiting_posts%rowtype;
  current_owner_id text;
  recruiting_result jsonb;
  match_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null or safe_match_id is null then
    raise exception 'missing_recruiting_confirmation_ids' using errcode = '22023';
  end if;
  if p_post_action <> 'confirmRecruitingMatch' or p_match_action <> 'confirmRecruitingMatch' then
    raise exception 'invalid_recruiting_confirmation_action' using errcode = '22023';
  end if;
  if p_post_row->>'status' <> 'closed' or p_match_row->>'status' <> 'agreed' then
    raise exception 'invalid_recruiting_confirmation_state' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  current_owner_id := coalesce(nullif(current_post.room_state->>'ownerId', ''), nullif(current_post.player_id, ''));
  if current_owner_id is distinct from safe_actor_id then
    raise exception 'recruiting_room_owner_required' using errcode = '42501';
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;
  if exists (select 1 from public.matches where id = safe_match_id) then
    raise exception 'match_already_exists' using errcode = '23505';
  end if;

  recruiting_result := public.rankball_recruiting_action(
    safe_actor_id,
    p_post_action,
    p_post_row,
    p_application_rows,
    p_recruiting_notification_rows,
    p_expected_updated_at
  );

  match_result := public.rankball_match_action(
    safe_actor_id,
    p_match_action,
    p_match_row,
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    p_dispute_rows,
    p_match_notification_rows,
    p_replace_result
  );

  return jsonb_build_object(
    'ok', true,
    'postId', safe_post_id,
    'matchId', safe_match_id,
    'recruiting', recruiting_result,
    'match', match_result,
    'confirmationAtomic', true
  );
end;
$$;

revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from anon;
revoke all on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from authenticated;
grant execute on function public.rankball_confirm_recruiting_match_action(text, text, jsonb, jsonb, jsonb, timestamptz, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)'),
      ('rankball_apply_profile_trust_deltas', 'public.rankball_apply_profile_trust_deltas(text,text,jsonb)'),
      ('rankball_cleanup_room_feed', 'public.rankball_cleanup_room_feed(timestamptz)'),
      ('rankball_confirm_recruiting_match_action', 'public.rankball_confirm_recruiting_match_action(text,text,jsonb,jsonb,jsonb,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)'),
      ('rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)'),
      ('rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()'),
      ('rankball_invite_team_member_4', 'public.rankball_invite_team_member(text,text,text,text)'),
      ('rankball_invite_team_member_5', 'public.rankball_invite_team_member(text,text,text,text,text)'),
      ('rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_match_action_with_rating', 'public.rankball_match_action_with_rating(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)'),
      ('rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)'),
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_dispute_action', 'public.rankball_match_dispute_action(text,text,jsonb)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
      ('rankball_mark_notifications_read_action', 'public.rankball_mark_notifications_read_action(text,text,boolean,timestamptz)'),
      ('rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
      ('rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)'),
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
      ('rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text)'),
      ('rankball_match_thumbs_action', 'public.rankball_match_thumbs_action(text,text,jsonb)'),
      ('rankball_normalize_match_dispute_rows', 'public.rankball_normalize_match_dispute_rows(jsonb,text)'),
      ('rankball_persist_match_snapshot', 'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_persist_recruiting_snapshot', 'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot', 'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot_locked', 'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)'),
      ('rankball_rebuild_profile_match_summary', 'public.rankball_rebuild_profile_match_summary(text)'),
      ('rankball_recruiting_action', 'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_recruiting_applicant_placement_action', 'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)'),
      ('rankball_recruiting_cancel_participation_action', 'public.rankball_recruiting_cancel_participation_action(text,text)'),
      ('rankball_recruiting_close_action', 'public.rankball_recruiting_close_action(text,text)'),
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)'),
      ('rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'),
      ('rankball_recruiting_ready_action', 'public.rankball_recruiting_ready_action(text,text,boolean)'),
      ('rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
      ('rankball_referee_rls_policy_health', 'public.rankball_referee_rls_policy_health()'),
      ('rankball_refresh_all_profile_match_summaries', 'public.rankball_refresh_all_profile_match_summaries()'),
      ('rankball_refresh_profile_match_summaries_for_match', 'public.rankball_refresh_profile_match_summaries_for_match(text)'),
      ('rankball_report_court_request', 'public.rankball_report_court_request(text,text,text)'),
      ('rankball_respond_team_invitation', 'public.rankball_respond_team_invitation(text,text,text)'),
      ('rankball_rls_policy_health', 'public.rankball_rls_policy_health()'),
      ('rankball_submit_court_request', 'public.rankball_submit_court_request(text,jsonb)'),
      ('rankball_submit_court_review', 'public.rankball_submit_court_review(text,jsonb)'),
      ('rankball_sync_team_membership', 'public.rankball_sync_team_membership(text,jsonb,jsonb)')
  ),
  resolved as (
    select function_name, signature, to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'rpc_grant:' || function_name as check_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false) as ok,
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    ) as detail
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_rpc_grant_health() from public;
revoke all on function public.rankball_rpc_grant_health() from anon;
revoke all on function public.rankball_rpc_grant_health() from authenticated;
grant execute on function public.rankball_rpc_grant_health() to service_role;

update public.matches
set dispute_minutes = public.rankball_normalize_dispute_minutes(dispute_minutes),
    objection_window = public.rankball_normalize_dispute_minutes(dispute_minutes)::text || '분'
where dispute_minutes not in (10, 15, 20)
   or dispute_minutes is null
   or objection_window is distinct from public.rankball_normalize_dispute_minutes(dispute_minutes)::text || '분';

update public.recruiting_posts
set dispute_minutes = public.rankball_normalize_dispute_minutes(dispute_minutes)
where dispute_minutes not in (10, 15, 20) or dispute_minutes is null;

alter table public.matches alter column dispute_minutes set default 15;
alter table public.recruiting_posts alter column dispute_minutes set default 15;

alter table public.matches drop constraint if exists matches_dispute_minutes_range;
alter table public.matches add constraint matches_dispute_minutes_range
  check (dispute_minutes in (10, 15, 20));

alter table public.recruiting_posts drop constraint if exists recruiting_posts_dispute_minutes_range;
alter table public.recruiting_posts add constraint recruiting_posts_dispute_minutes_range
  check (dispute_minutes in (10, 15, 20));

create or replace function public.rankball_normalize_dispute_window_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.dispute_minutes := public.rankball_normalize_dispute_minutes(new.dispute_minutes);
  if tg_table_name = 'matches' then
    new.objection_window := new.dispute_minutes::text || '분';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_matches_normalize_dispute_window on public.matches;
create trigger rankball_matches_normalize_dispute_window
before insert or update of dispute_minutes, objection_window on public.matches
for each row execute function public.rankball_normalize_dispute_window_row();

drop trigger if exists rankball_recruiting_normalize_dispute_window on public.recruiting_posts;
create trigger rankball_recruiting_normalize_dispute_window
before insert or update of dispute_minutes on public.recruiting_posts
for each row execute function public.rankball_normalize_dispute_window_row();

create or replace function public.rankball_dispute_window_health()
returns table(check_name text, ok boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  match_default text;
  recruiting_default text;
  invalid_match_count bigint;
  invalid_recruiting_count bigint;
begin
  select pg_get_expr(default_value.adbin, default_value.adrelid)
  into match_default
  from pg_attribute attribute
  join pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid and default_value.adnum = attribute.attnum
  where attribute.attrelid = 'public.matches'::regclass and attribute.attname = 'dispute_minutes';

  select pg_get_expr(default_value.adbin, default_value.adrelid)
  into recruiting_default
  from pg_attribute attribute
  join pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid and default_value.adnum = attribute.attnum
  where attribute.attrelid = 'public.recruiting_posts'::regclass and attribute.attname = 'dispute_minutes';

  select count(*) into invalid_match_count
  from public.matches where dispute_minutes not in (10, 15, 20) or dispute_minutes is null;
  select count(*) into invalid_recruiting_count
  from public.recruiting_posts where dispute_minutes not in (10, 15, 20) or dispute_minutes is null;

  return query values
    ('normalizer_values',
      public.rankball_normalize_dispute_minutes(10) = 10
      and public.rankball_normalize_dispute_minutes(15) = 15
      and public.rankball_normalize_dispute_minutes(20) = 20
      and public.rankball_normalize_dispute_minutes(null) = 15
      and public.rankball_normalize_dispute_minutes(30) = 15,
      'allowed=10,15,20; fallback=15'),
    ('matches_default', match_default = '15', coalesce(match_default, 'missing')),
    ('recruiting_default', recruiting_default = '15', coalesce(recruiting_default, 'missing')),
    ('matches_values', invalid_match_count = 0, invalid_match_count::text),
    ('recruiting_values', invalid_recruiting_count = 0, invalid_recruiting_count::text),
    ('matches_constraint', exists (
      select 1 from pg_constraint where conrelid = 'public.matches'::regclass
        and conname = 'matches_dispute_minutes_range' and convalidated
        and pg_get_constraintdef(oid) like '%10%15%20%'
    ), 'matches_dispute_minutes_range'),
    ('recruiting_constraint', exists (
      select 1 from pg_constraint where conrelid = 'public.recruiting_posts'::regclass
        and conname = 'recruiting_posts_dispute_minutes_range' and convalidated
        and pg_get_constraintdef(oid) like '%10%15%20%'
    ), 'recruiting_posts_dispute_minutes_range'),
    ('matches_trigger', exists (
      select 1 from pg_trigger where tgrelid = 'public.matches'::regclass
        and tgname = 'rankball_matches_normalize_dispute_window' and tgenabled <> 'D'
    ), 'rankball_matches_normalize_dispute_window'),
    ('recruiting_trigger', exists (
      select 1 from pg_trigger where tgrelid = 'public.recruiting_posts'::regclass
        and tgname = 'rankball_recruiting_normalize_dispute_window' and tgenabled <> 'D'
    ), 'rankball_recruiting_normalize_dispute_window');
end;
$$;

revoke all on function public.rankball_dispute_window_health() from public, anon, authenticated;
grant execute on function public.rankball_dispute_window_health() to service_role;

select pg_notify('pgrst', 'reload schema');

create or replace function public.rankball_recruiting_stat_recorder_action(
  p_actor_profile_id text,
  p_post_id text,
  p_side text,
  p_player_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_side text := nullif(btrim(p_side), '');
  requested_player_id text := nullif(btrim(p_player_id), '');
  next_player_id text := requested_player_id;
  other_side text;
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_recorders jsonb;
  next_recorders jsonb;
  owner_id text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_recruiting_side' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  owner_id := coalesce(nullif(current_room_state->>'ownerId', ''), nullif(current_post.player_id, ''));
  if owner_id is distinct from safe_actor_id then
    raise exception 'recruiting_room_owner_required' using errcode = '42501';
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;
  if nullif(current_post.referee_id, '') is not null then
    raise exception 'recruiting_recorder_disabled_with_referee' using errcode = '42501';
  end if;

  current_recorders := case
    when jsonb_typeof(current_room_state->'statRecorders') = 'object' then current_room_state->'statRecorders'
    else '{}'::jsonb
  end;

  if requested_player_id is not null and current_recorders->>safe_side = requested_player_id then
    next_player_id := null;
  elsif requested_player_id is not null and not exists (
    select 1
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.kind = 'player'
      and application.player_id = requested_player_id
      and application.side = safe_side
      and application.reserve = true
      and application.status = 'ready'
      and not exists (
        select 1
        from public.recruiting_applications active_application
        where active_application.post_id = safe_post_id
          and active_application.reserve = false
          and (
            active_application.player_id = requested_player_id
            or coalesce(active_application.player_ids, '[]'::jsonb) ? requested_player_id
          )
      )
      and not (coalesce(current_post.player_ids, '[]'::jsonb) ? requested_player_id)
  ) then
    return jsonb_build_object(
      'ok', false,
      'fallback', true,
      'reason', 'recruiting_complex_recorder_requires_replay',
      'postId', safe_post_id
    );
  end if;

  next_recorders := jsonb_set(
    current_recorders,
    array[safe_side],
    to_jsonb(coalesce(next_player_id, '')),
    true
  );
  other_side := case when safe_side = 'teamA' then 'teamB' else 'teamA' end;
  if next_player_id is not null and next_recorders->>other_side = next_player_id then
    next_recorders := jsonb_set(next_recorders, array[other_side], to_jsonb(''::text), true);
  end if;

  update public.recruiting_posts
  set
    room_state = jsonb_set(current_room_state, '{statRecorders}', next_recorders, true),
    updated_at = now()
  where id = safe_post_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setRecruitingStatRecorder',
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'side', safe_side,
    'playerId', coalesce(next_player_id, ''),
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) from public;
revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) from anon;
revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) from authenticated;
grant execute on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) to service_role;

create or replace function public.rankball_recruiting_close_action_pre_cancel_policy(
  p_actor_profile_id text,
  p_post_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  next_room_state jsonb;
  host_penalties jsonb;
  owner_id text;
  application_count integer := 0;
  penalty integer := 0;
  hours_until numeric := 1000000;
  scheduled_time_at timestamptz;
  is_short_notice boolean := false;
  notification_id text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  owner_id := coalesce(nullif(current_room_state->>'ownerId', ''), nullif(current_post.player_id, ''));
  if owner_id is distinct from safe_actor_id then
    raise exception 'recruiting_room_owner_required' using errcode = '42501';
  end if;
  if current_post.status = 'closed' then
    return jsonb_build_object(
      'ok', true,
      'action', 'closeRecruitingPost',
      'postId', safe_post_id,
      'alreadyClosed', true,
      'penalty', 0,
      'sqlReducer', true
    );
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_mutable' using errcode = '42501';
  end if;

  select count(*)::integer
  into application_count
  from public.recruiting_applications
  where post_id = safe_post_id;

  if current_post.scheduled_date is not null and current_post.scheduled_time is not null then
    scheduled_time_at := (current_post.scheduled_date + current_post.scheduled_time) at time zone 'Asia/Seoul';
    hours_until := extract(epoch from (scheduled_time_at - now())) / 3600;
    is_short_notice := extract(epoch from (scheduled_time_at - current_post.created_at)) / 3600 <= 24;
  end if;

  if application_count > 0 or hours_until <= 24 then
    penalty := case when application_count > 0 then public.rankball_rating_policy_number(array['trust', 'closeWithApplicantsPenalty'], 2, 0, 10)::integer else 0 end;
    if not coalesce(current_post.host_ready, false) then
      penalty := penalty + public.rankball_rating_policy_number(array['trust', 'closeUnreadyPenalty'], 2, 0, 10)::integer;
    end if;
    penalty := penalty + case
      when hours_until < 0 then public.rankball_rating_policy_number(array['trust', 'closeExpiredPenalty'], 8, 0, 15)::integer
      when hours_until <= 6 then public.rankball_rating_policy_number(array['trust', 'closeWithin6HoursPenalty'], 5, 0, 15)::integer
      when hours_until <= 24 then public.rankball_rating_policy_number(array['trust', 'closeWithin24HoursPenalty'], 3, 0, 15)::integer
      when hours_until <= 72 then public.rankball_rating_policy_number(array['trust', 'closeWithin72HoursPenalty'], 1, 0, 15)::integer
      else 0
    end;
    if is_short_notice then
      penalty := greatest(0, penalty - public.rankball_rating_policy_number(array['trust', 'closeShortNoticeDiscount'], 2, 0, 10)::integer);
    end if;
    penalty := least(public.rankball_rating_policy_number(array['trust', 'closeMaxPenalty'], 12, 0, 20)::integer, penalty);
  end if;

  host_penalties := case
    when jsonb_typeof(current_room_state->'hostPenalties') = 'array' then current_room_state->'hostPenalties'
    else '[]'::jsonb
  end;
  if penalty > 0 then
    host_penalties := host_penalties || jsonb_build_array(jsonb_build_object(
      'id', 'penalty_' || replace(gen_random_uuid()::text, '-', ''),
      'by', safe_actor_id,
      'penalty', penalty,
      'reason', 'room_closed',
      'createdAt', now()
    ));
  end if;

  next_room_state := jsonb_set(current_room_state, '{hostPenalties}', host_penalties, true);
  next_room_state := jsonb_set(next_room_state, '{invitations}', '[]'::jsonb, true);

  update public.recruiting_posts
  set
    status = 'closed',
    room_state = next_room_state,
    updated_at = now()
  where id = safe_post_id;

  if penalty > 0 then
    update public.profiles
    set
      trust_score = greatest(0, coalesce(trust_score, 80) - penalty),
      updated_at = now()
    where id = safe_actor_id;
    if not found then
      raise exception 'profile_not_found' using errcode = '22023';
    end if;

    notification_id := 'n_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      recruiting_post_id,
      discord_event,
      payload,
      created_at,
      updated_at
    ) values (
      notification_id,
      safe_actor_id,
      safe_actor_id,
      '방 닫기 페널티',
      '대기 인원 또는 임박한 일정이 있는 방을 닫아 신뢰 점수가 감소했습니다.',
      'orange',
      'recruiting_closed',
      safe_post_id,
      'recruiting',
      jsonb_build_object(
        'id', notification_id,
        'targetUserId', safe_actor_id,
        'recruitingPostId', safe_post_id,
        'penalty', penalty,
        'skipDiscordSync', true
      ),
      now(),
      now()
    );
  end if;

  update public.room_discord_links
  set enabled = false, updated_at = now()
  where room_type = 'recruiting'
    and room_id = safe_post_id
    and enabled = true;

  return jsonb_build_object(
    'ok', true,
    'action', 'closeRecruitingPost',
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'penalty', penalty,
    'sqlReducer', true
  );
end;
$$;

create or replace function public.rankball_recruiting_close_action(
  p_actor_profile_id text,
  p_post_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  current_post public.recruiting_posts%rowtype;
  closed_post public.recruiting_posts%rowtype;
  proposal jsonb;
  proposal_status text;
  proposal_deadline timestamptz;
  rule_deadline timestamptz;
  required_ids text[];
  acknowledged_ids text[];
  scheduled_at timestamptz;
  hours_until numeric;
  waiver_reason text := '';
  desired_penalty integer := 0;
  actual_penalty integer := 0;
  original_penalties jsonb := '[]'::jsonb;
  next_penalties jsonb := '[]'::jsonb;
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_recruiting_expire_room_change(safe_post_id);
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  if current_post.id is null then
    raise exception 'recruiting_post_not_found' using errcode = 'P0002';
  end if;
  if current_post.status = 'closed' then
    return public.rankball_recruiting_close_action_pre_cancel_policy(
      safe_actor_id,
      safe_post_id
    );
  end if;

  scheduled_at := coalesce(
    public.rankball_scheduled_at_kst(current_post.scheduled_at),
    case
      when current_post.scheduled_date is not null and current_post.scheduled_time is not null
        then (current_post.scheduled_date + current_post.scheduled_time) at time zone 'Asia/Seoul'
      else null
    end
  );
  if scheduled_at is not null then
    hours_until := extract(epoch from (scheduled_at - now_at)) / 3600;
    if hours_until <= 2 then
      raise exception 'room_cancel_locked' using errcode = '23514';
    end if;
  end if;

  proposal := current_post.room_state->'scheduleProposal';
  proposal_status := coalesce(proposal->>'status', '');
  proposal_deadline := nullif(proposal->>'consentDeadlineAt', '')::timestamptz;
  if proposal_status in ('rejected', 'expired') then
    waiver_reason := proposal_status;
  elsif proposal_status = 'pending'
    and proposal_deadline is not null
    and proposal_deadline <= now_at
  then
    waiver_reason := 'schedule_consent_expired';
  end if;

  if waiver_reason = '' then
    rule_deadline := nullif(
      current_post.room_state->>'ruleAcknowledgementDeadlineAt',
      ''
    )::timestamptz;
    if rule_deadline is not null and rule_deadline <= now_at then
      required_ids := public.rankball_recruiting_change_required_ids(safe_post_id);
      select coalesce(array_agg(value), array[]::text[])
      into acknowledged_ids
      from jsonb_array_elements_text(
        coalesce(current_post.room_state->'ruleAcknowledgedIds', '[]'::jsonb)
      ) item(value);
      if exists (
        select 1
        from unnest(required_ids) required(profile_id)
        where not required.profile_id = any(acknowledged_ids)
      ) then
        waiver_reason := 'rule_acknowledgement_expired';
      end if;
    end if;
  end if;

  if waiver_reason = '' and scheduled_at is not null then
    desired_penalty := case
      when hours_until <= 6 then public.rankball_rating_policy_number(
        array['trust', 'closeWithin6HoursPenalty'],
        5,
        0,
        15
      )::integer
      when hours_until <= 12 then public.rankball_rating_policy_number(
        array['trust', 'closeWithin24HoursPenalty'],
        3,
        0,
        15
      )::integer
      else 0
    end;
  end if;
  original_penalties := case
    when jsonb_typeof(current_post.room_state->'hostPenalties') = 'array'
      then current_post.room_state->'hostPenalties'
    else '[]'::jsonb
  end;

  result := public.rankball_recruiting_close_action_pre_cancel_policy(
    safe_actor_id,
    safe_post_id
  );
  actual_penalty := case
    when coalesce(result->>'penalty', '') ~ '^[0-9]+$'
      then (result->>'penalty')::integer
    else 0
  end;
  if actual_penalty <> desired_penalty then
    update public.profiles
    set
      trust_score = greatest(
        0,
        coalesce(trust_score, 80) + actual_penalty - desired_penalty
      ),
      updated_at = now_at
    where id = safe_actor_id;
  end if;

  select post.* into closed_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  next_penalties := original_penalties;
  if desired_penalty > 0 then
    next_penalties := next_penalties || jsonb_build_array(jsonb_build_object(
      'id',
      'penalty_' || replace(gen_random_uuid()::text, '-', ''),
      'by',
      safe_actor_id,
      'penalty',
      desired_penalty,
      'reason',
      'room_cancelled_within_12_hours',
      'createdAt',
      now_at
    ));
  end if;
  update public.recruiting_posts
  set
    room_state = coalesce(closed_post.room_state, '{}'::jsonb)
      || jsonb_build_object(
        'hostPenalties',
        next_penalties,
        'cancelPenalty',
        desired_penalty,
        'cancelPenaltyWaived',
        waiver_reason <> '',
        'cancelWaiverReason',
        waiver_reason,
        'cancelledAt',
        now_at
      ),
    updated_at = now_at
  where id = safe_post_id;

  delete from public.notifications
  where recruiting_post_id = safe_post_id
    and target_user_id = safe_actor_id
    and type = 'recruiting_closed'
    and coalesce(payload->>'penalty', '') <> '';
  if desired_penalty > 0 then
    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      recruiting_post_id,
      payload,
      created_at,
      updated_at
    ) values (
      'notice-recruiting-cancel-penalty-'
        || substr(md5(safe_post_id || ':' || now_at::text), 1, 24),
      safe_actor_id,
      safe_actor_id,
      '경기 취소 신뢰도 반영',
      '경기 시작 12시간 이내에 취소해 신뢰도 '
        || desired_penalty::text
        || '점이 감소했습니다.',
      'orange',
      'recruiting_cancel_penalty',
      safe_post_id,
      jsonb_build_object(
        'targetUserId',
        safe_actor_id,
        'recruitingPostId',
        safe_post_id,
        'penalty',
        desired_penalty,
        'actionRequired',
        false,
        'skipDiscordSync',
        true
      ),
      now_at,
      now_at
    );
  end if;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'penalty',
    desired_penalty,
    'penaltyWaived',
    waiver_reason <> '',
    'waiverReason',
    waiver_reason
  );
end;
$$;

revoke all on function public.rankball_recruiting_close_action_pre_cancel_policy(
  text,
  text
) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_close_action(text, text) from public;
revoke all on function public.rankball_recruiting_close_action(text, text) from anon;
revoke all on function public.rankball_recruiting_close_action(text, text) from authenticated;
grant execute on function public.rankball_recruiting_close_action(text, text) to service_role;

revoke all on function public.rankball_recruiting_ready_action(text, text, boolean) from public;
revoke all on function public.rankball_recruiting_ready_action(text, text, boolean) from anon;
revoke all on function public.rankball_recruiting_ready_action(text, text, boolean) from authenticated;
grant execute on function public.rankball_recruiting_ready_action(text, text, boolean) to service_role;

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)'),
      ('rankball_apply_profile_trust_deltas', 'public.rankball_apply_profile_trust_deltas(text,text,jsonb)'),
      ('rankball_cleanup_room_feed', 'public.rankball_cleanup_room_feed(timestamptz)'),
      ('rankball_confirm_recruiting_match_action', 'public.rankball_confirm_recruiting_match_action(text,text,jsonb,jsonb,jsonb,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)'),
      ('rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)'),
      ('rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()'),
      ('rankball_invite_team_member_4', 'public.rankball_invite_team_member(text,text,text,text)'),
      ('rankball_invite_team_member_5', 'public.rankball_invite_team_member(text,text,text,text,text)'),
      ('rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_match_action_with_rating', 'public.rankball_match_action_with_rating(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)'),
      ('rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)'),
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_dispute_action', 'public.rankball_match_dispute_action(text,text,jsonb)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
      ('rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
      ('rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)'),
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
      ('rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text)'),
      ('rankball_match_thumbs_action', 'public.rankball_match_thumbs_action(text,text,jsonb)'),
      ('rankball_normalize_match_dispute_rows', 'public.rankball_normalize_match_dispute_rows(jsonb,text)'),
      ('rankball_persist_match_snapshot', 'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_persist_recruiting_snapshot', 'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot', 'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot_locked', 'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)'),
      ('rankball_rebuild_profile_match_summary', 'public.rankball_rebuild_profile_match_summary(text)'),
      ('rankball_recruiting_action', 'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_recruiting_applicant_placement_action', 'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)'),
      ('rankball_recruiting_cancel_participation_action', 'public.rankball_recruiting_cancel_participation_action(text,text)'),
      ('rankball_recruiting_close_action', 'public.rankball_recruiting_close_action(text,text)'),
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)'),
      ('rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'),
      ('rankball_recruiting_ready_action', 'public.rankball_recruiting_ready_action(text,text,boolean)'),
      ('rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
      ('rankball_referee_rls_policy_health', 'public.rankball_referee_rls_policy_health()'),
      ('rankball_refresh_all_profile_match_summaries', 'public.rankball_refresh_all_profile_match_summaries()'),
      ('rankball_refresh_profile_match_summaries_for_match', 'public.rankball_refresh_profile_match_summaries_for_match(text)'),
      ('rankball_report_court_request', 'public.rankball_report_court_request(text,text,text)'),
      ('rankball_respond_team_invitation', 'public.rankball_respond_team_invitation(text,text,text)'),
      ('rankball_rls_policy_health', 'public.rankball_rls_policy_health()'),
      ('rankball_submit_court_request', 'public.rankball_submit_court_request(text,jsonb)'),
      ('rankball_submit_court_review', 'public.rankball_submit_court_review(text,jsonb)'),
      ('rankball_sync_team_membership', 'public.rankball_sync_team_membership(text,jsonb,jsonb)')
  ),
  resolved as (
    select function_name, signature, to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'rpc_grant:' || function_name as check_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false) as ok,
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    ) as detail
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_rpc_grant_health() from public;
revoke all on function public.rankball_rpc_grant_health() from anon;
revoke all on function public.rankball_rpc_grant_health() from authenticated;
grant execute on function public.rankball_rpc_grant_health() to service_role;

do $$
declare
  function_definition text;
  old_fragment text;
  new_fragment text;
begin
  if to_regprocedure('public.rankball_slim_room_feed_card(text,jsonb)') is null then
    return;
  end if;

  select pg_get_functiondef('public.rankball_slim_room_feed_card(text,jsonb)'::regprocedure)
  into function_definition;

  old_fragment := $old$      'sideCapacity', side_capacity,$old$;
  new_fragment := $new$      'sideCapacity', side_capacity,
      'benchCapacity', case
        when coalesce(card->>'benchCapacity', '') ~ '^[0-3]$' then (card->>'benchCapacity')::integer
        else 2
      end,$new$;
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'slim_room_feed_side_capacity_shape_changed'; end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);
  end if;

  old_fragment := $old$      'listCardOnly', true,
      'title', card->>'title',
      'mode', card->>'mode',
      'courtId', card->>'courtId',$old$;
  new_fragment := $new$      'listCardOnly', true,
      'title', card->>'title',
      'mode', card->>'mode',
      'benchCapacity', case
        when coalesce(card->>'benchCapacity', '') ~ '^[0-3]$' then (card->>'benchCapacity')::integer
        else 2
      end,
      'courtId', card->>'courtId',$new$;
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'slim_match_feed_mode_shape_changed'; end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);
  end if;

  execute function_definition;
end;
$$;

select pg_notify('pgrst', 'reload schema');

create or replace function public.rankball_match_action_with_rating(
  p_actor_profile_id text,
  p_action text,
  p_match_row jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false,
  p_rating_result jsonb default null,
  p_team_rating_result jsonb default '{}'::jsonb,
  p_profile_updates jsonb default '[]'::jsonb,
  p_team_updates jsonb default '[]'::jsonb,
  p_confirmed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  persist_result jsonb;
  rating_commit_result jsonb;
begin
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if p_rating_result is null or jsonb_typeof(p_rating_result) <> 'array' then
    raise exception 'invalid_rating_result' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  persist_result := public.rankball_match_action(
    p_actor_profile_id,
    p_action,
    p_match_row,
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    p_dispute_rows,
    p_notification_rows,
    p_replace_result
  );

  rating_commit_result := public.rankball_commit_match_rating(
    safe_match_id,
    p_actor_profile_id,
    p_rating_result,
    p_team_rating_result,
    p_profile_updates,
    p_team_updates,
    p_confirmed_at
  );

  return coalesce(persist_result, '{}'::jsonb) || jsonb_build_object(
    'ratingCommit', rating_commit_result,
    'ratingAtomic', true
  );
end;
$$;

revoke all on function public.rankball_match_action_with_rating(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, timestamptz) from public;
revoke all on function public.rankball_match_action_with_rating(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, timestamptz) from anon;
revoke all on function public.rankball_match_action_with_rating(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, timestamptz) from authenticated;
grant execute on function public.rankball_match_action_with_rating(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb, jsonb, jsonb, timestamptz) to service_role;

-- Commit match dispute intake and draft creation under a per-match lock.

create or replace function public.rankball_match_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_request jsonb default '""'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  dispute_reason text;
  requested_player_id text;
  requested_points integer;
  player_stats jsonb := '{}'::jsonb;
  stat_submissions jsonb := '{}'::jsonb;
  dispute_draft jsonb;
  actor_stats jsonb;
  actor_side text;
  score_a integer;
  score_b integer;
  actor_allowed boolean := false;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;

  select *
  into current_result
  from public.match_results
  where match_id = safe_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_missing', 'matchId', safe_match_id);
  end if;
  if not (
    current_match.status = 'approval'
    or (current_match.status = 'agreed' and current_match.ended_at is not null)
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_disputable', 'matchId', safe_match_id);
  end if;
  if current_match.ended_at is null
    or current_match.ended_at + make_interval(mins => public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)) < now()
  then
    raise exception 'match_dispute_window_closed' using errcode = '42501';
  end if;

  select (
    safe_actor_id = coalesce(current_match.created_by, '')
    or safe_actor_id = coalesce(current_match.referee_id, '')
    or exists (
      select 1 from public.match_players player
      where player.match_id = safe_match_id and player.user_id = safe_actor_id
    )
    or (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamA}') ? safe_actor_id
    or (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamB}') ? safe_actor_id
    or (coalesce(current_match.reserve_players, '{}'::jsonb) #> '{teamA}') ? safe_actor_id
    or (coalesce(current_match.reserve_players, '{}'::jsonb) #> '{teamB}') ? safe_actor_id
    or exists (
      select 1
      from jsonb_each_text(case when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders else '{}'::jsonb end) recorder(side, profile_id)
      where recorder.profile_id = safe_actor_id
    )
  ) into actor_allowed;

  if not actor_allowed then
    raise exception 'match_dispute_permission_denied' using errcode = '42501';
  end if;

  dispute_reason := case
    when jsonb_typeof(coalesce(p_dispute_request, '""'::jsonb)) = 'object' then nullif(btrim(p_dispute_request->>'reason'), '')
    when jsonb_typeof(coalesce(p_dispute_request, '""'::jsonb)) = 'string' then nullif(btrim(p_dispute_request #>> '{}'), '')
    else null
  end;
  dispute_reason := left(coalesce(dispute_reason, '스코어 또는 개인 기록 확인이 필요합니다.'), 500);
  requested_player_id := case when jsonb_typeof(coalesce(p_dispute_request, '{}'::jsonb)) = 'object' then nullif(btrim(p_dispute_request->>'playerId'), '') else null end;
  if requested_player_id = safe_actor_id and coalesce(p_dispute_request->>'requestedPoints', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    requested_points := least(9999::numeric, greatest(0::numeric, round((p_dispute_request->>'requestedPoints')::numeric)))::integer;
  else
    requested_points := null;
  end if;

  select coalesce(jsonb_object_agg(stat.user_id, jsonb_build_object(
    'points', greatest(0, coalesce(stat.points, 0)),
    'rebounds', greatest(0, coalesce(stat.rebounds, 0)),
    'assists', greatest(0, coalesce(stat.assists, 0)),
    'steals', greatest(0, coalesce(stat.steals, 0)),
    'blocks', greatest(0, coalesce(stat.blocks, 0)),
    'fouls', greatest(0, coalesce(stat.fouls, 0))
  )), '{}'::jsonb)
  into player_stats
  from public.player_match_stats stat
  where stat.match_id = safe_match_id;

  stat_submissions := coalesce(current_result.stat_submissions, '{}'::jsonb);
  score_a := greatest(0, coalesce(current_result.score_a, 0));
  score_b := greatest(0, coalesce(current_result.score_b, 0));

  if requested_points is not null and player_stats ? safe_actor_id then
    actor_stats := coalesce(player_stats->safe_actor_id, '{}'::jsonb);
    player_stats := jsonb_set(
      player_stats,
      array[safe_actor_id],
      jsonb_set(actor_stats, '{points}', to_jsonb(requested_points), true),
      true
    );

    select coalesce(
      (select player.side from public.match_players player where player.match_id = safe_match_id and player.user_id = safe_actor_id limit 1),
      case when (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamA}') ? safe_actor_id then 'teamA' end,
      case when (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamB}') ? safe_actor_id then 'teamB' end
    ) into actor_side;

    if actor_side = 'teamA' then
      select coalesce(sum(greatest(0, coalesce((player_stats->player_id->>'points')::integer, 0))), 0)::integer
      into score_a
      from (
        select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamA'
        union
        select value from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end) ids(value)
      ) side_players;
    elsif actor_side = 'teamB' then
      select coalesce(sum(greatest(0, coalesce((player_stats->player_id->>'points')::integer, 0))), 0)::integer
      into score_b
      from (
        select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamB'
        union
        select value from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end) ids(value)
      ) side_players;
    end if;
  end if;

  dispute_draft := jsonb_build_object(
    'scoreA', score_a,
    'scoreB', score_b,
    'playerStats', player_stats,
    'statSubmissions', stat_submissions,
    'submittedBy', current_result.submitted_by,
    'submittedAt', current_result.submitted_at,
    'updatedAt', now()
  );

  insert into public.match_disputes (id, match_id, user_id, reason, created_at)
  values (gen_random_uuid(), safe_match_id, safe_actor_id, dispute_reason, now());

  update public.matches
  set
    status = 'disputed',
    dispute_draft_result = dispute_draft,
    dispute_draft_updated_at = now(),
    updated_at = now()
  where id = safe_match_id;

  insert into public.notifications (
    id, user_id, title, body, tone, match_id, payload, created_at, updated_at
  ) values (
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    safe_actor_id,
    '이의제기 접수',
    format('%s 결과가 보류됐습니다.', current_match.title),
    'match',
    safe_match_id,
    jsonb_build_object('source', 'match_dispute_action'),
    now(),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'action', 'disputeMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from public;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from anon;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from authenticated;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');

-- Commit terminal match lifecycle actions under a per-match transaction lock.

create or replace function public.rankball_match_terminal_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  operator_id text;
  after_start boolean := false;
  notification_title text;
  notification_body text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_action not in ('cancelMatch', 'deleteSoloRecord', 'voidMatch') then
    raise exception 'invalid_match_terminal_action' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;

  if safe_action = 'cancelMatch' then
    if current_match.status not in ('contract', 'agreed') then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_cancellable', 'matchId', safe_match_id);
    end if;

    after_start := current_match.started_at is not null
      or current_match.ended_at is not null
      or exists (select 1 from public.match_results result where result.match_id = safe_match_id);
    operator_id := case
      when after_start and nullif(current_match.referee_id, '') is not null then current_match.referee_id
      else current_match.created_by
    end;
    if safe_actor_id <> coalesce(operator_id, '') then
      raise exception 'match_cancel_permission_denied' using errcode = '42501';
    end if;

    update public.matches
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
    where id = safe_match_id;
    notification_title := case
      when coalesce(current_match.rules->>'recordType', '') = 'match_record' then '기록 취소'
      else '경기 취소'
    end;
    notification_body := case
      when coalesce(current_match.rules->>'recordType', '') = 'match_record' then format('%s 기록이 취소됐습니다.', current_match.title)
      else format('%s 경기방이 취소됐습니다.', current_match.title)
    end;
  elsif safe_action = 'voidMatch' then
    if current_match.status <> 'disputed' then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_voidable', 'matchId', safe_match_id);
    end if;

    operator_id := coalesce(nullif(current_match.referee_id, ''), current_match.created_by);
    if safe_actor_id <> coalesce(operator_id, '') then
      raise exception 'match_void_permission_denied' using errcode = '42501';
    end if;

    update public.matches
    set status = 'void', ranked = false, voided_at = coalesce(voided_at, now()), updated_at = now()
    where id = safe_match_id;
    notification_title := '결과 무효';
    notification_body := format('%s 결과가 랭킹 반영에서 제외됐습니다.', current_match.title);
  else
    if current_match.created_by <> safe_actor_id
      or coalesce(current_match.rules->>'recordType', '') <> 'solo'
      or current_match.status = 'cancelled'
    then
      raise exception 'solo_record_delete_permission_denied' using errcode = '42501';
    end if;

    update public.matches
    set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
    where id = safe_match_id;
    notification_title := '개인 기록 삭제';
    notification_body := format('%s 기록을 삭제했습니다.', current_match.title);
  end if;

  insert into public.notifications (
    id, user_id, title, body, tone, match_id, payload, created_at, updated_at
  ) values (
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    safe_actor_id,
    notification_title,
    notification_body,
    'match',
    safe_match_id,
    jsonb_build_object('source', 'match_terminal_action', 'action', safe_action),
    now(),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_terminal_action(text, text, text) from public;
revoke all on function public.rankball_match_terminal_action(text, text, text) from anon;
revoke all on function public.rankball_match_terminal_action(text, text, text) from authenticated;
grant execute on function public.rankball_match_terminal_action(text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

create or replace function public.rankball_recruiting_action(
  p_actor_profile_id text,
  p_action text,
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := coalesce(nullif(btrim(p_action), ''), 'sync');
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  expected_updated_at timestamptz := coalesce(p_expected_updated_at, nullif(p_post_row->>'__expectedUpdatedAt', '')::timestamptz);
  current_updated_at timestamptz;
  persist_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  if safe_action = 'setRecruitingSlotPosition' and p_post_row ? '__operation' then
    return public.rankball_recruiting_slot_position_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,playerId}',
      p_post_row #>> '{__operation,position}'
    );
  end if;

  if safe_action = 'interestRecruitingPost' and p_post_row ? '__operation' then
    return public.rankball_recruiting_interest_player_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,application,joinMode}',
      p_post_row #>> '{__operation,application,teamId}',
      p_post_row #>> '{__operation,application,side}',
      case when lower(coalesce(p_post_row #>> '{__operation,application,reserve}', 'false')) = 'true' then true else false end,
      p_post_row #>> '{__operation,application,position}'
    );
  end if;

  if safe_action = 'setRecruitingApplicantPlacement' and p_post_row ? '__operation' then
    return public.rankball_recruiting_applicant_placement_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,playerId}',
      p_post_row #>> '{__operation,placement,side}',
      case when lower(coalesce(p_post_row #>> '{__operation,placement,reserve}', 'false')) = 'true' then true else false end
    );
  end if;

  if safe_action = 'cancelRecruitingParticipation' and p_post_row ? '__operation' then
    return public.rankball_recruiting_cancel_participation_action(
      safe_actor_id,
      safe_post_id
    );
  end if;

  select updated_at
  into current_updated_at
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if expected_updated_at is not null and current_updated_at is not null and current_updated_at <> expected_updated_at then
    raise exception 'recruiting_stale_snapshot' using errcode = '40001';
  end if;

  persist_result := public.rankball_persist_recruiting_snapshot(
    p_post_row - '__expectedUpdatedAt',
    p_application_rows,
    p_notification_rows
  );

  return persist_result || jsonb_build_object(
    'action', safe_action,
    'actorProfileId', safe_actor_id,
    'advisoryLocked', true
  );
end;
$$;

drop function if exists public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb);
revoke all on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) from public;
grant execute on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) to service_role;
select pg_notify('pgrst', 'reload schema');

create or replace function public.rankball_persist_match_snapshot(
  p_match_row jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  player_count integer := 0;
  stat_count integer := 0;
  notification_count integer := 0;
begin
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  insert into public.matches (
    id, title, mode, court_id, court_name, visibility, status, ranked, mmr_limit_mode,
    trust_feedback, referee_id, former_referee_id, referee_trust_min, stat_entry_minutes,
    dispute_minutes, stat_recorders, played_player_ids, reserve_players, promoted_reserve_ids,
    attendance, referee_absence_request, dispute_draft_result, dispute_draft_updated_at,
    dispute_resolved_at, mmr_excluded_player_ids, anonymous_players, tournament_id,
    tournament_format, tournament_round, tournament_fixture, tournament_mmr_policy,
    official, pre_registered, scheduled_at, scheduled_date, scheduled_time, team_a_id,
    team_b_id, score_a, score_b, rules, memo, stakes, objection_window, evidence,
    created_by, created_at, agreed_at, started_at, ended_at, confirmed_at, cancelled_at,
    voided_at, rating_result, team_rating_result, updated_at
  )
  select
    id, title, mode, court_id, court_name, visibility, status, ranked, mmr_limit_mode,
    trust_feedback, referee_id, former_referee_id, referee_trust_min, stat_entry_minutes,
    dispute_minutes, stat_recorders, played_player_ids, reserve_players, promoted_reserve_ids,
    attendance, referee_absence_request, dispute_draft_result, dispute_draft_updated_at,
    dispute_resolved_at, mmr_excluded_player_ids, anonymous_players, tournament_id,
    tournament_format, tournament_round, tournament_fixture, tournament_mmr_policy,
    official, pre_registered, scheduled_at, scheduled_date, scheduled_time, team_a_id,
    team_b_id, score_a, score_b, rules, memo, stakes, objection_window, evidence,
    created_by, created_at, agreed_at, started_at, ended_at, confirmed_at, cancelled_at,
    voided_at, rating_result, team_rating_result, updated_at
  from jsonb_populate_record(
    null::public.matches,
    p_match_row || jsonb_build_object(
      'dispute_minutes', public.rankball_normalize_dispute_minutes(nullif(p_match_row->>'dispute_minutes', '')::integer),
      'objection_window', public.rankball_normalize_dispute_minutes(nullif(p_match_row->>'dispute_minutes', '')::integer)::text || '분'
    )
  )
  on conflict (id) do update set
    title = excluded.title,
    mode = excluded.mode,
    court_id = excluded.court_id,
    court_name = excluded.court_name,
    visibility = excluded.visibility,
    status = excluded.status,
    ranked = excluded.ranked,
    mmr_limit_mode = excluded.mmr_limit_mode,
    trust_feedback = excluded.trust_feedback,
    referee_id = excluded.referee_id,
    former_referee_id = excluded.former_referee_id,
    referee_trust_min = excluded.referee_trust_min,
    stat_entry_minutes = excluded.stat_entry_minutes,
    dispute_minutes = excluded.dispute_minutes,
    stat_recorders = excluded.stat_recorders,
    played_player_ids = excluded.played_player_ids,
    reserve_players = excluded.reserve_players,
    promoted_reserve_ids = excluded.promoted_reserve_ids,
    attendance = excluded.attendance,
    referee_absence_request = excluded.referee_absence_request,
    dispute_draft_result = excluded.dispute_draft_result,
    dispute_draft_updated_at = excluded.dispute_draft_updated_at,
    dispute_resolved_at = excluded.dispute_resolved_at,
    mmr_excluded_player_ids = excluded.mmr_excluded_player_ids,
    anonymous_players = excluded.anonymous_players,
    tournament_id = excluded.tournament_id,
    tournament_format = excluded.tournament_format,
    tournament_round = excluded.tournament_round,
    tournament_fixture = excluded.tournament_fixture,
    tournament_mmr_policy = excluded.tournament_mmr_policy,
    official = excluded.official,
    pre_registered = excluded.pre_registered,
    scheduled_at = excluded.scheduled_at,
    scheduled_date = excluded.scheduled_date,
    scheduled_time = excluded.scheduled_time,
    team_a_id = excluded.team_a_id,
    team_b_id = excluded.team_b_id,
    score_a = excluded.score_a,
    score_b = excluded.score_b,
    rules = excluded.rules,
    memo = excluded.memo,
    stakes = excluded.stakes,
    objection_window = excluded.objection_window,
    evidence = excluded.evidence,
    created_by = excluded.created_by,
    agreed_at = excluded.agreed_at,
    started_at = excluded.started_at,
    ended_at = excluded.ended_at,
    confirmed_at = excluded.confirmed_at,
    cancelled_at = excluded.cancelled_at,
    voided_at = excluded.voided_at,
    rating_result = excluded.rating_result,
    team_rating_result = excluded.team_rating_result,
    updated_at = excluded.updated_at;

  delete from public.match_players where match_id = safe_match_id;
  delete from public.match_agreements where match_id = safe_match_id;
  delete from public.match_approvals where match_id = safe_match_id;
  delete from public.match_disputes where match_id = safe_match_id;

  if p_replace_result then
    delete from public.player_match_stats where match_id = safe_match_id;
    delete from public.match_results where match_id = safe_match_id;
  end if;

  insert into public.match_players (match_id, team_id, user_id, side, slot_order)
  select match_id, team_id, user_id, side, slot_order
  from jsonb_populate_recordset(null::public.match_players, coalesce(p_player_rows, '[]'::jsonb));
  get diagnostics player_count = row_count;

  if p_result_row is not null and jsonb_typeof(p_result_row) = 'object' then
    insert into public.match_results (
      match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at
    )
    select match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at
    from jsonb_populate_record(null::public.match_results, p_result_row)
    on conflict (match_id) do update set
      submitted_by = excluded.submitted_by,
      score_a = excluded.score_a,
      score_b = excluded.score_b,
      stat_submissions = excluded.stat_submissions,
      submitted_at = excluded.submitted_at;
  end if;

  insert into public.player_match_stats (
    match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at
  )
  select match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at
  from jsonb_populate_recordset(null::public.player_match_stats, coalesce(p_stat_rows, '[]'::jsonb))
  on conflict (match_id, user_id) do update set
    recorded_by = excluded.recorded_by,
    record_source = excluded.record_source,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    fouls = excluded.fouls,
    updated_at = excluded.updated_at;
  get diagnostics stat_count = row_count;

  insert into public.match_agreements (match_id, user_id, side)
  select match_id, user_id, side
  from jsonb_populate_recordset(null::public.match_agreements, coalesce(p_agreement_rows, '[]'::jsonb))
  on conflict (match_id, user_id) do update set side = excluded.side;

  insert into public.match_approvals (match_id, user_id, side)
  select match_id, user_id, side
  from jsonb_populate_recordset(null::public.match_approvals, coalesce(p_approval_rows, '[]'::jsonb))
  on conflict (match_id, user_id) do update set side = excluded.side;

  insert into public.match_disputes (id, match_id, user_id, reason, created_at)
  select id, match_id, user_id, reason, created_at
  from jsonb_populate_recordset(null::public.match_disputes, coalesce(p_dispute_rows, '[]'::jsonb))
  on conflict (id) do update set
    match_id = excluded.match_id,
    user_id = excluded.user_id,
    reason = excluded.reason;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  )
  select
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  from jsonb_populate_recordset(null::public.notifications, coalesce(p_notification_rows, '[]'::jsonb))
  on conflict (id) do update set
    user_id = excluded.user_id,
    target_user_id = excluded.target_user_id,
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    match_id = excluded.match_id,
    recruiting_post_id = excluded.recruiting_post_id,
    invitation_id = excluded.invitation_id,
    discord_event = excluded.discord_event,
    read_at = excluded.read_at,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics notification_count = row_count;

  return jsonb_build_object('ok', true, 'matchId', safe_match_id, 'playerCount', player_count, 'statCount', stat_count, 'notificationCount', notification_count);
end;
$$;

revoke all on function public.rankball_persist_match_snapshot(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.rankball_persist_match_snapshot(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

create or replace function public.rankball_normalize_match_dispute_rows(
  p_dispute_rows jsonb,
  p_match_id text
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',
      case
        when coalesce(dispute.item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then dispute.item->>'id'
        else concat(
          '00000000-0000-4000-8000-',
          substr(md5(concat_ws('|',
            coalesce(nullif(dispute.item->>'match_id', ''), nullif(p_match_id, '')),
            dispute.item->>'user_id',
            dispute.item->>'reason',
            dispute.item->>'created_at',
            dispute.item::text
          )), 1, 12)
        )
      end,
    'match_id', coalesce(nullif(dispute.item->>'match_id', ''), nullif(p_match_id, '')),
    'user_id', nullif(dispute.item->>'user_id', ''),
    'reason', coalesce(dispute.item->>'reason', ''),
    'created_at', coalesce(nullif(dispute.item->>'created_at', ''), now()::text)
  )), '[]'::jsonb)
  from jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(p_dispute_rows, '[]'::jsonb)) = 'array' then coalesce(p_dispute_rows, '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as dispute(item)
  where nullif(dispute.item->>'user_id', '') is not null;
$$;

revoke all on function public.rankball_normalize_match_dispute_rows(jsonb, text) from public;
grant execute on function public.rankball_normalize_match_dispute_rows(jsonb, text) to service_role;

create or replace function public.rankball_match_agree_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  team_a_player_count integer := 0;
  team_b_player_count integer := 0;
  team_a_agreement_count integer := 0;
  team_b_agreement_count integer := 0;
  team_a_needed integer := 1;
  team_b_needed integer := 1;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') or safe_player_id is null then
    raise exception 'invalid_match_agreement_target' using errcode = '22023';
  end if;
  if safe_actor_id <> safe_player_id then
    raise exception 'match_agreement_actor_mismatch' using errcode = '42501';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.status not in ('contract', 'agreed') then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_agreement_locked', 'matchId', safe_match_id);
  end if;
  if current_match.team_a_id is not null or current_match.team_b_id is not null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'team_agreement_requires_replay', 'matchId', safe_match_id);
  end if;
  if jsonb_typeof(current_match.rules->'parties') = 'array' and jsonb_array_length(current_match.rules->'parties') > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'party_agreement_requires_replay', 'matchId', safe_match_id);
  end if;
  if not exists (
    select 1
    from public.match_players mp
    where mp.match_id = safe_match_id
      and mp.side = safe_side
      and mp.user_id = safe_player_id
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_agreement_player_not_found', 'matchId', safe_match_id);
  end if;
  if exists (
    select 1
    from public.match_agreements agreement
    where agreement.match_id = safe_match_id
      and agreement.user_id = safe_player_id
  ) then
    return jsonb_build_object('ok', true, 'action', 'agreeMatch', 'matchId', safe_match_id, 'actorProfileId', safe_actor_id, 'playerId', safe_player_id, 'sideName', safe_side, 'sqlReducer', true, 'alreadyAgreed', true);
  end if;

  select
    count(*) filter (where mp.side = 'teamA'),
    count(*) filter (where mp.side = 'teamB')
  into team_a_player_count, team_b_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB');

  if team_a_player_count = 0 or team_b_player_count = 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_agreement_players_missing', 'matchId', safe_match_id);
  end if;

  select
    count(distinct agreement.user_id) filter (where agreement.side = 'teamA'),
    count(distinct agreement.user_id) filter (where agreement.side = 'teamB')
  into team_a_agreement_count, team_b_agreement_count
  from public.match_agreements agreement
  where agreement.match_id = safe_match_id;

  if safe_side = 'teamA' then
    team_a_agreement_count := team_a_agreement_count + 1;
  else
    team_b_agreement_count := team_b_agreement_count + 1;
  end if;

  team_a_needed := floor(team_a_player_count / 2.0)::integer + 1;
  team_b_needed := floor(team_b_player_count / 2.0)::integer + 1;

  if current_match.status <> 'agreed'
    and team_a_agreement_count >= team_a_needed
    and team_b_agreement_count >= team_b_needed then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_agreement_completion_requires_replay', 'matchId', safe_match_id);
  end if;

  insert into public.match_agreements (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;

  return jsonb_build_object(
    'ok', true,
    'action', 'agreeMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'playerId', safe_player_id,
    'sideName', safe_side,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_agree_action(text, text, text, text) from public;
grant execute on function public.rankball_match_agree_action(text, text, text, text) to service_role;

create or replace function public.rankball_match_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  result_row public.match_results%rowtype;
  already_approved boolean := false;
  missing_stat_count integer := 0;
  team_a_player_count integer := 0;
  team_b_player_count integer := 0;
  team_a_approval_count integer := 0;
  team_b_approval_count integer := 0;
  team_a_needed integer := 1;
  team_b_needed integer := 1;
  team_a_stat_points integer := 0;
  team_b_stat_points integer := 0;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') or safe_player_id is null then
    raise exception 'invalid_match_approval_target' using errcode = '22023';
  end if;
  if safe_actor_id <> safe_player_id then
    raise exception 'match_approval_actor_mismatch' using errcode = '42501';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.status <> 'approval' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_locked', 'matchId', safe_match_id);
  end if;

  select *
  into result_row
  from public.match_results
  where match_id = safe_match_id;

  if not found then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_result_missing', 'matchId', safe_match_id);
  end if;

  if not exists (
    select 1
    from public.match_players mp
    where mp.match_id = safe_match_id
      and mp.side = safe_side
      and mp.user_id = safe_player_id
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_player_not_found', 'matchId', safe_match_id);
  end if;

  select count(*)
  into missing_stat_count
  from public.match_players mp
  left join public.player_match_stats stat
    on stat.match_id = mp.match_id
   and stat.user_id = mp.user_id
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB')
    and stat.user_id is null;

  if missing_stat_count > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_stats_incomplete', 'matchId', safe_match_id);
  end if;

  select
    coalesce(sum(coalesce(stat.points, 0)) filter (where mp.side = 'teamA'), 0)::integer,
    coalesce(sum(coalesce(stat.points, 0)) filter (where mp.side = 'teamB'), 0)::integer
  into team_a_stat_points, team_b_stat_points
  from public.match_players mp
  left join public.player_match_stats stat
    on stat.match_id = mp.match_id
   and stat.user_id = mp.user_id
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB');

  if team_a_stat_points <> coalesce(result_row.score_a, current_match.score_a, 0)
    or team_b_stat_points <> coalesce(result_row.score_b, current_match.score_b, 0) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_point_mismatch', 'matchId', safe_match_id);
  end if;

  select
    count(*) filter (where mp.side = 'teamA'),
    count(*) filter (where mp.side = 'teamB')
  into team_a_player_count, team_b_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB');

  if team_a_player_count = 0 or team_b_player_count = 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_players_missing', 'matchId', safe_match_id);
  end if;

  select
    count(distinct approval.user_id) filter (where approval.side = 'teamA'),
    count(distinct approval.user_id) filter (where approval.side = 'teamB')
  into team_a_approval_count, team_b_approval_count
  from public.match_approvals approval
  where approval.match_id = safe_match_id;

  select exists (
    select 1
    from public.match_approvals approval
    where approval.match_id = safe_match_id
      and approval.user_id = safe_player_id
  )
  into already_approved;

  if not already_approved then
    if safe_side = 'teamA' then
      team_a_approval_count := team_a_approval_count + 1;
    else
      team_b_approval_count := team_b_approval_count + 1;
    end if;
  end if;

  team_a_needed := floor(team_a_player_count / 2.0)::integer + 1;
  team_b_needed := floor(team_b_player_count / 2.0)::integer + 1;

  if team_a_approval_count >= team_a_needed and team_b_approval_count >= team_b_needed then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_approval_completion_requires_replay', 'matchId', safe_match_id);
  end if;

  if already_approved then
    return jsonb_build_object('ok', true, 'action', 'approveMatch', 'matchId', safe_match_id, 'actorProfileId', safe_actor_id, 'playerId', safe_player_id, 'sideName', safe_side, 'sqlReducer', true, 'alreadyApproved', true);
  end if;

  insert into public.match_approvals (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;

  update public.matches
  set updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'approveMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'playerId', safe_player_id,
    'sideName', safe_side,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_approval_action(text, text, text, text) from public;
revoke all on function public.rankball_match_approval_action(text, text, text, text) from anon;
revoke all on function public.rankball_match_approval_action(text, text, text, text) from authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text) to service_role;

create or replace function public.rankball_match_thumbs_action(
  p_actor_profile_id text,
  p_match_id text,
  p_target_user_ids jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  current_recorders jsonb := '{}'::jsonb;
  current_feedback jsonb := '{}'::jsonb;
  current_stars jsonb := '{}'::jsonb;
  next_feedback jsonb := '{}'::jsonb;
  feedback_ids text[] := array[]::text[];
  operation_ids text[] := array[]::text[];
  previous_ids text[] := array[]::text[];
  next_ids text[] := array[]::text[];
  candidate_id text;
  active_player_count integer := 0;
  max_thumbs integer := 1;
  affected_count integer := 0;
  profile_count integer := 0;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_target_user_ids), 'array') <> 'array' then
    raise exception 'invalid_match_thumbs_target_ids' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_thumbs_closed', 'matchId', safe_match_id);
  end if;
  if coalesce(current_match.confirmed_at, current_match.updated_at, current_match.created_at) + interval '24 hours' < now() then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_thumbs_window_closed', 'matchId', safe_match_id);
  end if;

  current_recorders := case
    when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
    when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
    else '{}'::jsonb
  end;

  select count(distinct mp.user_id)
  into active_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> '';

  with raw(id) as (
    select mp.user_id
    from public.match_players mp
    where mp.match_id = safe_match_id
    union all
    select reserve.value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.reserve_players->'teamA') = 'array' then current_match.reserve_players->'teamA'
        else '[]'::jsonb
      end
    ) as reserve(value)
    union all
    select reserve.value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.reserve_players->'teamB') = 'array' then current_match.reserve_players->'teamB'
        else '[]'::jsonb
      end
    ) as reserve(value)
    union all
    select current_match.created_by
    union all
    select current_match.referee_id
    union all
    select current_match.former_referee_id
    union all
    select current_recorders->>'teamA'
    union all
    select current_recorders->>'teamB'
  )
  select coalesce(array_agg(distinct id), array[]::text[])
  into feedback_ids
  from raw
  where nullif(btrim(coalesce(id, '')), '') is not null;

  if not (safe_actor_id = any(feedback_ids)) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_thumbs_actor_not_allowed', 'matchId', safe_match_id);
  end if;

  with raw(id) as (
    values
      (current_match.created_by),
      (current_match.referee_id),
      (current_recorders->>'teamA'),
      (current_recorders->>'teamB')
  )
  select coalesce(array_agg(distinct id), array[]::text[])
  into operation_ids
  from raw
  where nullif(btrim(coalesce(id, '')), '') is not null;

  max_thumbs := greatest(1, floor(active_player_count / 2.0)::integer)
    + case when coalesce(array_length(operation_ids, 1), 0) > 0 then 1 else 0 end;

  current_feedback := case
    when jsonb_typeof(current_match.trust_feedback) = 'object' then current_match.trust_feedback
    else '{}'::jsonb
  end;
  current_stars := case
    when jsonb_typeof(current_feedback->'stars') = 'object' then current_feedback->'stars'
    else '{}'::jsonb
  end;

  select coalesce(array_agg(distinct previous.value), array[]::text[])
  into previous_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_stars->safe_actor_id) = 'array' then current_stars->safe_actor_id
      else '[]'::jsonb
    end
  ) as previous(value)
  where nullif(btrim(coalesce(previous.value, '')), '') is not null;

  for candidate_id in
    select target.value
    from jsonb_array_elements_text(coalesce(p_target_user_ids, '[]'::jsonb)) as target(value)
  loop
    candidate_id := nullif(btrim(coalesce(candidate_id, '')), '');
    if candidate_id is null or candidate_id = safe_actor_id then
      continue;
    end if;
    if not (candidate_id = any(feedback_ids)) or candidate_id = any(next_ids) then
      continue;
    end if;
    if not exists (select 1 from public.profiles profile where profile.id = candidate_id) then
      continue;
    end if;

    next_ids := array_append(next_ids, candidate_id);
    if coalesce(array_length(next_ids, 1), 0) >= max_thumbs then
      exit;
    end if;
  end loop;

  foreach candidate_id in array next_ids loop
    if candidate_id <> safe_actor_id and candidate_id = any(feedback_ids) and not (candidate_id = any(previous_ids)) then
      update public.profiles
      set trust_score = greatest(0, least(100, coalesce(trust_score, 80) + 1)),
          updated_at = now()
      where id = candidate_id;

      get diagnostics affected_count = row_count;
      if affected_count = 1 then
        profile_count := profile_count + 1;
      end if;
    end if;
  end loop;

  foreach candidate_id in array previous_ids loop
    if candidate_id <> safe_actor_id and candidate_id = any(feedback_ids) and not (candidate_id = any(next_ids)) then
      update public.profiles
      set trust_score = greatest(0, least(100, coalesce(trust_score, 80) - 1)),
          updated_at = now()
      where id = candidate_id;

      get diagnostics affected_count = row_count;
      if affected_count = 1 then
        profile_count := profile_count + 1;
      end if;
    end if;
  end loop;

  current_stars := jsonb_set(current_stars, array[safe_actor_id], to_jsonb(next_ids), true);
  next_feedback := jsonb_set(current_feedback, '{stars}', current_stars, true);
  next_feedback := jsonb_set(next_feedback, '{updatedAt}', to_jsonb(now()::text), true);

  update public.matches
  set trust_feedback = next_feedback,
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'submitMatchThumbs',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'targetUserIds', to_jsonb(next_ids),
    'sqlReducer', true,
    'trustCommitted', profile_count > 0,
    'trustProfileCount', profile_count
  );
end;
$$;

revoke all on function public.rankball_match_thumbs_action(text, text, jsonb) from public;
revoke all on function public.rankball_match_thumbs_action(text, text, jsonb) from anon;
revoke all on function public.rankball_match_thumbs_action(text, text, jsonb) from authenticated;
grant execute on function public.rankball_match_thumbs_action(text, text, jsonb) to service_role;

create or replace function public.rankball_match_star_toggle_action(
  p_actor_profile_id text,
  p_match_id text,
  p_target_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_target_id text := nullif(btrim(p_target_user_id), '');
  current_match public.matches%rowtype;
  current_recorders jsonb := '{}'::jsonb;
  current_feedback jsonb := '{}'::jsonb;
  current_stars jsonb := '{}'::jsonb;
  feedback_ids text[] := array[]::text[];
  operation_ids text[] := array[]::text[];
  previous_ids text[] := array[]::text[];
  next_ids text[] := array[]::text[];
  active_player_count integer := 0;
  max_stars integer := 1;
  already_starred boolean := false;
  result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_target_id is null then
    raise exception 'missing_match_star_target' using errcode = '22023';
  end if;
  if safe_actor_id = safe_target_id then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_self_target', 'matchId', safe_match_id);
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.status <> 'confirmed' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_closed', 'matchId', safe_match_id);
  end if;
  if coalesce(current_match.confirmed_at, current_match.updated_at, current_match.created_at) + interval '24 hours' < now() then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_window_closed', 'matchId', safe_match_id);
  end if;

  current_recorders := case
    when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
    when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
    else '{}'::jsonb
  end;

  select count(distinct mp.user_id)
  into active_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> '';

  with raw(id) as (
    select mp.user_id
    from public.match_players mp
    where mp.match_id = safe_match_id
    union all
    select reserve.value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.reserve_players->'teamA') = 'array' then current_match.reserve_players->'teamA'
        else '[]'::jsonb
      end
    ) as reserve(value)
    union all
    select reserve.value
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.reserve_players->'teamB') = 'array' then current_match.reserve_players->'teamB'
        else '[]'::jsonb
      end
    ) as reserve(value)
    union all
    select current_match.created_by
    union all
    select current_match.referee_id
    union all
    select current_match.former_referee_id
    union all
    select current_recorders->>'teamA'
    union all
    select current_recorders->>'teamB'
  )
  select coalesce(array_agg(distinct id), array[]::text[])
  into feedback_ids
  from raw
  where nullif(btrim(coalesce(id, '')), '') is not null;

  if not (safe_actor_id = any(feedback_ids)) or not (safe_target_id = any(feedback_ids)) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_target_not_allowed', 'matchId', safe_match_id);
  end if;
  if not exists (select 1 from public.profiles profile where profile.id = safe_target_id) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_target_profile_missing', 'matchId', safe_match_id);
  end if;

  with raw(id) as (
    values
      (current_match.created_by),
      (current_match.referee_id),
      (current_recorders->>'teamA'),
      (current_recorders->>'teamB')
  )
  select coalesce(array_agg(distinct id), array[]::text[])
  into operation_ids
  from raw
  where nullif(btrim(coalesce(id, '')), '') is not null;

  max_stars := greatest(1, floor(active_player_count / 2.0)::integer)
    + case when coalesce(array_length(operation_ids, 1), 0) > 0 then 1 else 0 end;

  current_feedback := case
    when jsonb_typeof(current_match.trust_feedback) = 'object' then current_match.trust_feedback
    else '{}'::jsonb
  end;
  current_stars := case
    when jsonb_typeof(current_feedback->'stars') = 'object' then current_feedback->'stars'
    else '{}'::jsonb
  end;

  select coalesce(array_agg(previous.value order by previous.ordinality), array[]::text[])
  into previous_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_stars->safe_actor_id) = 'array' then current_stars->safe_actor_id
      else '[]'::jsonb
    end
  ) with ordinality as previous(value, ordinality)
  where nullif(btrim(coalesce(previous.value, '')), '') is not null;

  already_starred := safe_target_id = any(previous_ids);
  if not already_starred and coalesce(array_length(previous_ids, 1), 0) >= max_stars then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_star_limit_reached', 'matchId', safe_match_id);
  end if;

  if already_starred then
    select coalesce(array_agg(item.value order by item.ordinality), array[]::text[])
    into next_ids
    from unnest(previous_ids) with ordinality as item(value, ordinality)
    where item.value <> safe_target_id;
  else
    next_ids := previous_ids || safe_target_id;
  end if;

  result := public.rankball_match_thumbs_action(
    safe_actor_id,
    safe_match_id,
    to_jsonb(next_ids)
  );

  return result || jsonb_build_object(
    'action', 'toggleMatchStar',
    'targetUserId', safe_target_id,
    'starred', not already_starred
  );
end;
$$;

revoke all on function public.rankball_match_star_toggle_action(text, text, text) from public;
revoke all on function public.rankball_match_star_toggle_action(text, text, text) from anon;
revoke all on function public.rankball_match_star_toggle_action(text, text, text) from authenticated;
grant execute on function public.rankball_match_star_toggle_action(text, text, text) to service_role;

create or replace function public.rankball_match_checkin_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  current_attendance jsonb;
  current_side_attendance jsonb;
  next_side_attendance jsonb;
  next_attendance jsonb;
  current_reserve jsonb;
  scheduled_at_kst timestamptz;
  reserve_count integer := 0;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') or safe_player_id is null then
    raise exception 'invalid_match_checkin_target' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.referee_id is not null and current_match.referee_id <> '' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'referee_match_requires_replay', 'matchId', safe_match_id);
  end if;
  if current_match.created_by <> safe_actor_id then
    raise exception 'match_checkin_permission_denied' using errcode = '42501';
  end if;
  if safe_actor_id = safe_player_id then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'self_checkin_requires_replay', 'matchId', safe_match_id);
  end if;
  if current_match.status not in ('contract', 'agreed') or current_match.started_at is not null or current_match.ended_at is not null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_checkin_locked', 'matchId', safe_match_id);
  end if;
  if exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_exists', 'matchId', safe_match_id);
  end if;

  if coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_schedule_requires_replay', 'matchId', safe_match_id);
    end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if now() < scheduled_at_kst then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_checkin_time', 'matchId', safe_match_id);
    end if;
  end if;

  current_reserve := case
    when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players
    when jsonb_typeof(current_match.rules->'reservePlayers') = 'object' then current_match.rules->'reservePlayers'
    else '{}'::jsonb
  end;
  select count(*)
  into reserve_count
  from jsonb_each(current_reserve) item
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(item.value) = 'array' then item.value else '[]'::jsonb end) ids(value);

  if reserve_count > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_checkin_requires_replay', 'matchId', safe_match_id);
  end if;
  if jsonb_typeof(current_match.rules->'parties') = 'array' and jsonb_array_length(current_match.rules->'parties') > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'party_checkin_requires_replay', 'matchId', safe_match_id);
  end if;
  if not exists (
    select 1
    from public.match_players mp
    where mp.match_id = safe_match_id
      and mp.side = safe_side
      and mp.user_id = safe_player_id
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_checkin_player_not_found', 'matchId', safe_match_id);
  end if;

  current_attendance := case when jsonb_typeof(current_match.attendance) = 'object' then current_match.attendance else '{}'::jsonb end;
  current_side_attendance := case
    when jsonb_typeof(current_attendance->safe_side) = 'array' then current_attendance->safe_side
    else '[]'::jsonb
  end;

  select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
  into next_side_attendance
  from (
    select distinct value
    from (
      select value from jsonb_array_elements_text(current_side_attendance) ids(value)
      union all
      select safe_player_id
    ) values_to_attend
    where value is not null and value <> ''
  ) distinct_values;

  next_attendance := jsonb_set(current_attendance, array[safe_side], next_side_attendance, true);

  update public.matches
  set
    attendance = next_attendance,
    updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'checkInMatchPlayer',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'playerId', safe_player_id,
    'sideName', safe_side,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_checkin_action(text, text, text, text) from public;
grant execute on function public.rankball_match_checkin_action(text, text, text, text) to service_role;

create or replace function public.rankball_match_start_action(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{"teamA":[],"teamB":[]}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  requested_started_at timestamptz := nullif(btrim(coalesce(p_started_at, '')), '')::timestamptz;
  requested_agreed_at timestamptz := nullif(btrim(coalesce(p_agreed_at, '')), '')::timestamptz;
  current_match public.matches%rowtype;
  current_reserve jsonb;
  input_attendance jsonb;
  next_attendance jsonb;
  actor_side text;
  actor_side_attendance jsonb;
  next_started_at timestamptz;
  next_agreed_at timestamptz;
  next_rules jsonb;
  scheduled_at_kst timestamptz;
  active_player_count integer := 0;
  attended_player_count integer := 0;
  reserve_count integer := 0;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.referee_id is not null and current_match.referee_id <> '' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'referee_match_requires_replay', 'matchId', safe_match_id);
  end if;
  if current_match.created_by <> safe_actor_id then
    raise exception 'match_start_permission_denied' using errcode = '42501';
  end if;
  if current_match.status not in ('contract', 'agreed') or current_match.started_at is not null or current_match.ended_at is not null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_startable', 'matchId', safe_match_id);
  end if;
  if exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_exists', 'matchId', safe_match_id);
  end if;

  if coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_schedule_requires_replay', 'matchId', safe_match_id);
    end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if now() < scheduled_at_kst then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_checkin_time', 'matchId', safe_match_id);
    end if;
  end if;

  current_reserve := case
    when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players
    when jsonb_typeof(current_match.rules->'reservePlayers') = 'object' then current_match.rules->'reservePlayers'
    else '{}'::jsonb
  end;
  select count(*)
  into reserve_count
  from jsonb_each(current_reserve) item
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(item.value) = 'array' then item.value else '[]'::jsonb end) ids(value);

  if reserve_count > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_attendance_requires_replay', 'matchId', safe_match_id);
  end if;
  if jsonb_typeof(current_match.rules->'parties') = 'array' and jsonb_array_length(current_match.rules->'parties') > 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'party_attendance_requires_replay', 'matchId', safe_match_id);
  end if;
  input_attendance := case
    when jsonb_typeof(p_attendance) = 'object'
      and (
        jsonb_typeof(p_attendance->'teamA') = 'array'
        or jsonb_typeof(p_attendance->'teamB') = 'array'
      )
      then p_attendance
    when jsonb_typeof(current_match.attendance) = 'object' then current_match.attendance
    else '{}'::jsonb
  end;
  if jsonb_typeof(input_attendance) <> 'object' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'attendance_snapshot_missing', 'matchId', safe_match_id);
  end if;

  select count(*)
  into active_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and mp.side in ('teamA', 'teamB');

  if active_player_count = 0 then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_players_missing', 'matchId', safe_match_id);
  end if;
  if exists (
    select 1
    from public.match_players mp
    where mp.match_id = safe_match_id
      and coalesce(mp.side, '') not in ('teamA', 'teamB')
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'unsupported_match_side', 'matchId', safe_match_id);
  end if;

  next_attendance := jsonb_build_object(
    'teamA',
    case when jsonb_typeof(input_attendance->'teamA') = 'array' then input_attendance->'teamA' else '[]'::jsonb end,
    'teamB',
    case when jsonb_typeof(input_attendance->'teamB') = 'array' then input_attendance->'teamB' else '[]'::jsonb end
  );

  select mp.side
  into actor_side
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id = safe_actor_id
    and mp.side in ('teamA', 'teamB')
  order by mp.slot_order nulls last
  limit 1;

  if actor_side in ('teamA', 'teamB') then
    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
    into actor_side_attendance
    from (
      select distinct value
      from (
        select value from jsonb_array_elements_text(next_attendance->actor_side) ids(value)
        union all
        select safe_actor_id
      ) values_to_attend
      where value is not null and value <> ''
    ) distinct_values;
    next_attendance := jsonb_set(next_attendance, array[actor_side], actor_side_attendance, true);
  end if;

  select count(distinct mp.user_id)
  into attended_player_count
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.user_id is not null
    and mp.user_id <> ''
    and (
      (mp.side = 'teamA' and (next_attendance->'teamA') ? mp.user_id)
      or (mp.side = 'teamB' and (next_attendance->'teamB') ? mp.user_id)
    );

  if attended_player_count < active_player_count then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_attendance_missing', 'matchId', safe_match_id);
  end if;

  next_started_at := coalesce(requested_started_at, now());
  next_agreed_at := coalesce(current_match.agreed_at, requested_agreed_at, next_started_at);
  next_rules := jsonb_set(
    coalesce(current_match.rules, '{}'::jsonb),
    '{startedAt}',
    to_jsonb(next_started_at::text),
    true
  );

  update public.matches
  set
    status = 'agreed',
    agreed_at = next_agreed_at,
    started_at = next_started_at,
    attendance = next_attendance,
    rules = next_rules,
    updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'startMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'startedAt', next_started_at,
    'agreedAt', next_agreed_at,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_start_action(text, text, text, text, jsonb) from public;
revoke all on function public.rankball_match_start_action(text, text, text, text, jsonb) from anon;
revoke all on function public.rankball_match_start_action(text, text, text, text, jsonb) from authenticated;
grant execute on function public.rankball_match_start_action(text, text, text, text, jsonb) to service_role;

create or replace function public.rankball_match_end_action(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_ended_at text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  requested_started_at timestamptz := nullif(btrim(p_started_at), '')::timestamptz;
  requested_ended_at timestamptz := nullif(btrim(p_ended_at), '')::timestamptz;
  current_match public.matches%rowtype;
  next_started_at timestamptz;
  next_ended_at timestamptz;
  next_rules jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.referee_id is not null and current_match.referee_id <> '' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'referee_match_requires_replay', 'matchId', safe_match_id);
  end if;
  if current_match.created_by <> safe_actor_id then
    raise exception 'match_end_permission_denied' using errcode = '42501';
  end if;
  if current_match.status <> 'agreed' or current_match.ended_at is not null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_endable', 'matchId', safe_match_id);
  end if;
  if exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_exists', 'matchId', safe_match_id);
  end if;

  next_started_at := coalesce(current_match.started_at, requested_started_at, now());
  next_ended_at := coalesce(requested_ended_at, now());
  next_rules := jsonb_set(
    coalesce(current_match.rules, '{}'::jsonb),
    '{startedAt}',
    to_jsonb(coalesce(current_match.rules->>'startedAt', next_started_at::text)),
    true
  );

  update public.matches
  set
    started_at = next_started_at,
    ended_at = next_ended_at,
    rules = next_rules,
    updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'endMatch',
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'startedAt', next_started_at,
    'endedAt', next_ended_at,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_end_action(text, text, text, text) from public;
grant execute on function public.rankball_match_end_action(text, text, text, text) to service_role;

create or replace function public.rankball_match_late_player_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_player_id text default '',
  p_played_player_ids jsonb default '{}'::jsonb,
  p_reserve_players jsonb default '{}'::jsonb,
  p_anonymous_players jsonb default '{}'::jsonb,
  p_mmr_excluded_player_ids jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  requested_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  current_played jsonb;
  current_reserve jsonb;
  current_anonymous jsonb;
  current_excluded jsonb;
  requested_played jsonb;
  requested_anonymous jsonb;
  requested_excluded jsonb;
  added_ids text[];
  removed_ids text[];
  delta_player_id text;
  delta_side text;
  current_side_ids jsonb;
  next_team_a_ids jsonb;
  next_team_b_ids jsonb;
  next_reserve_team_a_ids jsonb;
  next_reserve_team_b_ids jsonb;
  next_played jsonb;
  next_reserve jsonb;
  next_anonymous jsonb;
  next_excluded jsonb;
  next_rules jsonb;
  anonymous_payload jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_action not in ('addMatchLatePlayer', 'removeMatchLatePlayer') then
    raise exception 'unsupported_late_player_action' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;
  if current_match.referee_id is not null and current_match.referee_id <> '' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'referee_match_requires_replay', 'matchId', safe_match_id);
  end if;
  if current_match.created_by <> safe_actor_id then
    raise exception 'match_late_player_permission_denied' using errcode = '42501';
  end if;
  if current_match.status in ('approval', 'confirmed', 'void', 'cancelled', 'disputed') then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_late_player_locked', 'matchId', safe_match_id);
  end if;
  if current_match.ended_at is null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_postgame', 'matchId', safe_match_id);
  end if;
  if current_match.ended_at + ((coalesce(current_match.stat_entry_minutes, 60)::text || ' minutes')::interval) < now() then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'stat_entry_window_expired', 'matchId', safe_match_id);
  end if;
  if exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_exists', 'matchId', safe_match_id);
  end if;

  current_played := case
    when jsonb_typeof(current_match.played_player_ids) = 'object' then current_match.played_player_ids
    when jsonb_typeof(current_match.rules->'playedPlayerIds') = 'object' then current_match.rules->'playedPlayerIds'
    else '{}'::jsonb
  end;
  current_reserve := case
    when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players
    when jsonb_typeof(current_match.rules->'reservePlayers') = 'object' then current_match.rules->'reservePlayers'
    else '{}'::jsonb
  end;
  current_anonymous := case
    when jsonb_typeof(current_match.anonymous_players) = 'object' then current_match.anonymous_players
    else '{}'::jsonb
  end;
  current_excluded := case
    when jsonb_typeof(current_match.mmr_excluded_player_ids) = 'array' then current_match.mmr_excluded_player_ids
    when jsonb_typeof(current_match.rules->'mmrExcludedPlayerIds') = 'array' then current_match.rules->'mmrExcludedPlayerIds'
    else '[]'::jsonb
  end;
  requested_played := case when jsonb_typeof(p_played_player_ids) = 'object' then p_played_player_ids else '{}'::jsonb end;
  requested_anonymous := case when jsonb_typeof(p_anonymous_players) = 'object' then p_anonymous_players else '{}'::jsonb end;
  requested_excluded := case when jsonb_typeof(p_mmr_excluded_player_ids) = 'array' then p_mmr_excluded_player_ids else '[]'::jsonb end;

  if safe_action = 'addMatchLatePlayer' then
    select coalesce(array_agg(value), '{}'::text[])
    into added_ids
    from jsonb_array_elements_text(requested_excluded) ids(value)
    where not (current_excluded ? value);

    select coalesce(array_agg(value), '{}'::text[])
    into removed_ids
    from jsonb_array_elements_text(current_excluded) ids(value)
    where not (requested_excluded ? value);

    if array_length(added_ids, 1) is distinct from 1 or array_length(removed_ids, 1) is not null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'late_player_delta_not_single_add', 'matchId', safe_match_id);
    end if;

    delta_player_id := added_ids[1];
    if delta_player_id not like 'anon_%' then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'registered_late_player_requires_replay', 'matchId', safe_match_id);
    end if;

    if (case when jsonb_typeof(requested_played->'teamA') = 'array' then requested_played->'teamA' else '[]'::jsonb end) ? delta_player_id then
      delta_side := 'teamA';
    end if;
    if (case when jsonb_typeof(requested_played->'teamB') = 'array' then requested_played->'teamB' else '[]'::jsonb end) ? delta_player_id then
      if delta_side is not null then
        return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'late_player_multiple_sides', 'matchId', safe_match_id);
      end if;
      delta_side := 'teamB';
    end if;
    if delta_side is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'late_player_side_missing', 'matchId', safe_match_id);
    end if;

    anonymous_payload := requested_anonymous->delta_player_id;
    if jsonb_typeof(anonymous_payload) <> 'object' or nullif(btrim(anonymous_payload->>'name'), '') is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'anonymous_late_player_name_missing', 'matchId', safe_match_id);
    end if;

    current_side_ids := case when jsonb_typeof(current_played->delta_side) = 'array' then current_played->delta_side else '[]'::jsonb end;
    if current_side_ids ? delta_player_id then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'late_player_already_played', 'matchId', safe_match_id);
    end if;

    next_played := jsonb_set(current_played, array[delta_side], current_side_ids || jsonb_build_array(delta_player_id), true);
    next_excluded := current_excluded || jsonb_build_array(delta_player_id);
    next_anonymous := jsonb_set(current_anonymous, array[delta_player_id], anonymous_payload, true);
  else
    delta_player_id := requested_player_id;
    if delta_player_id is null then
      select coalesce(array_agg(value), '{}'::text[])
      into removed_ids
      from jsonb_array_elements_text(current_excluded) ids(value)
      where not (requested_excluded ? value);
      if array_length(removed_ids, 1) is distinct from 1 then
        return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'late_player_delta_not_single_remove', 'matchId', safe_match_id);
      end if;
      delta_player_id := removed_ids[1];
    end if;

    if not (current_excluded ? delta_player_id) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'late_player_not_excluded', 'matchId', safe_match_id);
    end if;

    select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> delta_player_id), '[]'::jsonb)
    into next_team_a_ids
    from jsonb_array_elements_text(case when jsonb_typeof(current_played->'teamA') = 'array' then current_played->'teamA' else '[]'::jsonb end) ids(value);
    select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> delta_player_id), '[]'::jsonb)
    into next_team_b_ids
    from jsonb_array_elements_text(case when jsonb_typeof(current_played->'teamB') = 'array' then current_played->'teamB' else '[]'::jsonb end) ids(value);
    next_played := jsonb_set(jsonb_set(current_played, '{teamA}', next_team_a_ids, true), '{teamB}', next_team_b_ids, true);

    select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> delta_player_id), '[]'::jsonb)
    into next_excluded
    from jsonb_array_elements_text(current_excluded) ids(value);
    next_anonymous := current_anonymous - delta_player_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> delta_player_id), '[]'::jsonb)
  into next_reserve_team_a_ids
  from jsonb_array_elements_text(case when jsonb_typeof(current_reserve->'teamA') = 'array' then current_reserve->'teamA' else '[]'::jsonb end) ids(value);
  select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> delta_player_id), '[]'::jsonb)
  into next_reserve_team_b_ids
  from jsonb_array_elements_text(case when jsonb_typeof(current_reserve->'teamB') = 'array' then current_reserve->'teamB' else '[]'::jsonb end) ids(value);
  next_reserve := jsonb_set(jsonb_set(current_reserve, '{teamA}', next_reserve_team_a_ids, true), '{teamB}', next_reserve_team_b_ids, true);

  next_rules := coalesce(current_match.rules, '{}'::jsonb);
  next_rules := jsonb_set(next_rules, '{playedPlayerIds}', next_played, true);
  next_rules := jsonb_set(next_rules, '{reservePlayers}', next_reserve, true);
  next_rules := jsonb_set(next_rules, '{mmrExcludedPlayerIds}', next_excluded, true);

  update public.matches
  set
    played_player_ids = next_played,
    reserve_players = next_reserve,
    anonymous_players = next_anonymous,
    mmr_excluded_player_ids = next_excluded,
    rules = next_rules,
    updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'matchId', safe_match_id,
    'playerId', delta_player_id,
    'actorProfileId', safe_actor_id,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_late_player_action(text, text, text, text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.rankball_match_late_player_action(text, text, text, text, jsonb, jsonb, jsonb, jsonb) to service_role;

create or replace function public.rankball_match_roster_move_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_side text,
  p_active_player_id text default null,
  p_reserve_player_id text default null,
  p_next_recorder_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_active_player_id text := nullif(btrim(p_active_player_id), '');
  safe_reserve_player_id text := nullif(btrim(p_reserve_player_id), '');
  safe_next_recorder_id text := nullif(btrim(p_next_recorder_id), '');
  current_match public.matches%rowtype;
  side_player_ids text[] := array[]::text[];
  side_reserve_ids text[] := array[]::text[];
  side_played_ids text[] := array[]::text[];
  current_recorders jsonb := '{}'::jsonb;
  next_recorders jsonb := '{}'::jsonb;
  current_recorder_id text := '';
  requested_recorder_id text := '';
  first_reserve_id text := '';
  active_in_id text := '';
  benched_id text := '';
  candidate_id text;
  next_side_reserve jsonb := '[]'::jsonb;
  next_reserve_players jsonb := '{}'::jsonb;
  next_side_played jsonb := '[]'::jsonb;
  next_played_player_ids jsonb := '{}'::jsonb;
  next_rules jsonb := '{}'::jsonb;
  active_slot_order integer;
  active_team_id text;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_action is null or safe_action not in ('handoffMatchRecorder', 'substituteMatchPlayer') then
    raise exception 'unsupported_match_roster_move_action' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_side' using errcode = '22023';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = '22023';
  end if;

  select coalesce(array_agg(mp.user_id order by mp.slot_order, mp.user_id), array[]::text[])
  into side_player_ids
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.side = safe_side
    and mp.user_id is not null
    and mp.user_id <> '';

  select coalesce(array_agg(value), array[]::text[])
  into side_reserve_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_match.reserve_players->safe_side) = 'array' then current_match.reserve_players->safe_side
      else '[]'::jsonb
    end
  ) as reserve(value);

  select coalesce(array_agg(value), array[]::text[])
  into side_played_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_match.played_player_ids->safe_side) = 'array' then current_match.played_player_ids->safe_side
      else '[]'::jsonb
    end
  ) as played(value);

  current_recorders := case
    when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
    when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
    else '{}'::jsonb
  end;
  first_reserve_id := coalesce(side_reserve_ids[1], '');
  requested_recorder_id := coalesce(current_recorders->>safe_side, '');
  current_recorder_id := case
    when requested_recorder_id <> '' and requested_recorder_id = any(side_reserve_ids) then requested_recorder_id
    when first_reserve_id <> '' then first_reserve_id
    when requested_recorder_id <> '' and requested_recorder_id = any(side_player_ids) then requested_recorder_id
    else ''
  end;

  if safe_action = 'handoffMatchRecorder' then
    if current_match.referee_id is not null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'referee_match_requires_replay', 'matchId', safe_match_id);
    end if;
    if current_match.status not in ('agreed', 'approval') then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_recorder_handoff_locked', 'matchId', safe_match_id);
    end if;
    if current_recorder_id = '' or current_recorder_id <> safe_actor_id then
      raise exception 'match_recorder_handoff_actor_mismatch' using errcode = '42501';
    end if;
    if safe_next_recorder_id is null then
      raise exception 'missing_next_recorder' using errcode = '22023';
    end if;
    if not (safe_next_recorder_id = any(side_player_ids) or safe_next_recorder_id = any(side_reserve_ids)) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recorder_target_not_on_side', 'matchId', safe_match_id);
    end if;

    if current_match.started_at is not null and current_match.ended_at is null and (
      (current_recorder_id = any(side_reserve_ids) and safe_next_recorder_id = any(side_player_ids)) or
      (current_recorder_id = any(side_player_ids) and safe_next_recorder_id = any(side_reserve_ids))
    ) then
      active_in_id := case when current_recorder_id = any(side_reserve_ids) then current_recorder_id else safe_next_recorder_id end;
      benched_id := case when current_recorder_id = any(side_reserve_ids) then safe_next_recorder_id else current_recorder_id end;
    end if;

    next_recorders := jsonb_set(current_recorders, array[safe_side], to_jsonb(safe_next_recorder_id), true);
  else
    if current_match.status <> 'agreed' or current_match.started_at is null or current_match.ended_at is not null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_substitution_not_live', 'matchId', safe_match_id);
    end if;
    if safe_active_player_id is null or safe_reserve_player_id is null then
      raise exception 'missing_substitution_players' using errcode = '22023';
    end if;
    if not (
      safe_actor_id = coalesce(current_match.created_by, '') or
      safe_actor_id = coalesce(current_match.referee_id, '') or
      safe_actor_id = current_recorder_id
    ) then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    if not (safe_active_player_id = any(side_player_ids) and safe_reserve_player_id = any(side_reserve_ids)) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_substitution_roster_mismatch', 'matchId', safe_match_id);
    end if;

    active_in_id := safe_reserve_player_id;
    benched_id := safe_active_player_id;
    next_recorders := current_recorders;
  end if;

  if active_in_id <> '' and benched_id <> '' then
    select mp.slot_order, mp.team_id
    into active_slot_order, active_team_id
    from public.match_players mp
    where mp.match_id = safe_match_id
      and mp.side = safe_side
      and mp.user_id = benched_id
    limit 1;

    if active_slot_order is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_active_player_missing', 'matchId', safe_match_id);
    end if;
    if exists (
      select 1
      from public.match_players mp
      where mp.match_id = safe_match_id
        and mp.user_id = active_in_id
    ) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'active_in_player_already_active', 'matchId', safe_match_id);
    end if;

    update public.match_players
    set user_id = active_in_id,
        team_id = active_team_id
    where match_id = safe_match_id
      and side = safe_side
      and slot_order = active_slot_order
      and user_id = benched_id;

    foreach candidate_id in array side_reserve_ids loop
      if candidate_id <> active_in_id and not (next_side_reserve ? candidate_id) then
        next_side_reserve := next_side_reserve || to_jsonb(candidate_id);
      end if;
    end loop;
    if not (next_side_reserve ? benched_id) then
      next_side_reserve := next_side_reserve || to_jsonb(benched_id);
    end if;

    foreach candidate_id in array side_played_ids loop
      if candidate_id <> '' and not (next_side_played ? candidate_id) then
        next_side_played := next_side_played || to_jsonb(candidate_id);
      end if;
    end loop;
    foreach candidate_id in array side_player_ids loop
      if candidate_id <> '' and not (next_side_played ? candidate_id) then
        next_side_played := next_side_played || to_jsonb(candidate_id);
      end if;
    end loop;
    foreach candidate_id in array array[active_in_id, benched_id] loop
      if candidate_id <> '' and not (next_side_played ? candidate_id) then
        next_side_played := next_side_played || to_jsonb(candidate_id);
      end if;
    end loop;

    next_reserve_players := jsonb_set(
      case when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players else '{}'::jsonb end,
      array[safe_side],
      next_side_reserve,
      true
    );
    next_played_player_ids := jsonb_set(
      case when jsonb_typeof(current_match.played_player_ids) = 'object' then current_match.played_player_ids else '{}'::jsonb end,
      array[safe_side],
      next_side_played,
      true
    );
  else
    next_reserve_players := case when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players else '{}'::jsonb end;
    next_played_player_ids := case when jsonb_typeof(current_match.played_player_ids) = 'object' then current_match.played_player_ids else '{}'::jsonb end;
  end if;

  next_rules := jsonb_set(coalesce(current_match.rules, '{}'::jsonb), '{statRecorders}', next_recorders, true);
  if active_in_id <> '' and benched_id <> '' then
    next_rules := jsonb_set(next_rules, '{playedPlayerIds}', next_played_player_ids, true);
  end if;

  update public.matches
  set stat_recorders = next_recorders,
      reserve_players = next_reserve_players,
      played_player_ids = next_played_player_ids,
      rules = next_rules,
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'matchId', safe_match_id,
    'actorProfileId', safe_actor_id,
    'sideName', safe_side,
    'sqlReducer', true,
    'swapped', active_in_id <> '' and benched_id <> '',
    'activeInId', nullif(active_in_id, ''),
    'benchedId', nullif(benched_id, '')
  );
end;
$$;

revoke all on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) from public;
revoke all on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) from anon;
revoke all on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) from authenticated;
grant execute on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text) to service_role;

create or replace function public.rankball_match_action(
  p_actor_profile_id text,
  p_action text,
  p_match_row jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := coalesce(nullif(btrim(p_action), ''), 'sync');
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  expected_updated_at timestamptz := nullif(p_match_row->>'__expectedUpdatedAt', '')::timestamptz;
  current_updated_at timestamptz;
  persist_result jsonb;
  branch_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  if safe_action = 'agreeMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_agree_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'approveMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_approval_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'submitMatchThumbs' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_thumbs_action(
      safe_actor_id,
      safe_match_id,
      coalesce(p_match_row->'__operation'->'targetUserIds', '[]'::jsonb)
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'toggleMatchStar' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_star_toggle_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,targetUserId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'checkInMatchPlayer' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_checkin_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action in ('handoffMatchRecorder', 'substituteMatchPlayer') and p_match_row ? '__operation' then
    branch_result := public.rankball_match_roster_move_action(
      safe_actor_id,
      safe_action,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,activePlayerId}',
      p_match_row #>> '{__operation,reservePlayerId}',
      p_match_row #>> '{__operation,nextRecorderId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'startMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_start_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{agreed_at}',
      coalesce(p_match_row->'attendance', '{}'::jsonb)
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  if safe_action = 'endMatch' and p_match_row ? '__operation' then
    branch_result := public.rankball_match_end_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{ended_at}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;

  select updated_at
  into current_updated_at
  from public.matches
  where id = safe_match_id
  for update;

  if expected_updated_at is not null and current_updated_at is not null and current_updated_at <> expected_updated_at then
    raise exception 'match_stale_snapshot' using errcode = '40001';
  end if;

  persist_result := public.rankball_persist_match_snapshot(
    p_match_row - '__expectedUpdatedAt',
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    public.rankball_normalize_match_dispute_rows(p_dispute_rows, safe_match_id),
    p_notification_rows,
    p_replace_result
  );

  return persist_result || jsonb_build_object(
    'action', safe_action,
    'actorProfileId', safe_actor_id,
    'advisoryLocked', true,
    'branchFallback', coalesce((branch_result->>'fallback')::boolean, false),
    'branchFallbackReason', branch_result->>'reason'
  );
end;
$$;

revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

create or replace function public.rankball_persist_tournament_snapshot(
  p_tournament_row jsonb,
  p_team_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_tournament_id text := nullif(btrim(p_tournament_row->>'id'), '');
  team_count integer := 0;
  notification_count integer := 0;
begin
  if safe_tournament_id is null then
    raise exception 'missing_tournament_id' using errcode = '22023';
  end if;

  insert into public.tournaments (
    id, title, format, visibility, status, region, court_name, mode, ranked, official,
    start_date, end_date, schedule_policy, schedule_note, mmr_limit_mode, max_mmr_gap,
    mmr_policy, rules, memo, created_by, created_at, started_at, match_ids,
    team_statuses, team_approvals, bracket, updated_at
  )
  select
    id, title, format, visibility, status, region, court_name, mode, ranked, official,
    start_date, end_date, schedule_policy, schedule_note, mmr_limit_mode, max_mmr_gap,
    mmr_policy, rules, memo, created_by, created_at, started_at, match_ids,
    team_statuses, team_approvals, bracket, updated_at
  from jsonb_populate_record(null::public.tournaments, p_tournament_row)
  on conflict (id) do update set
    title = excluded.title,
    format = excluded.format,
    visibility = excluded.visibility,
    status = excluded.status,
    region = excluded.region,
    court_name = excluded.court_name,
    mode = excluded.mode,
    ranked = excluded.ranked,
    official = excluded.official,
    start_date = excluded.start_date,
    end_date = excluded.end_date,
    schedule_policy = excluded.schedule_policy,
    schedule_note = excluded.schedule_note,
    mmr_limit_mode = excluded.mmr_limit_mode,
    max_mmr_gap = excluded.max_mmr_gap,
    mmr_policy = excluded.mmr_policy,
    rules = excluded.rules,
    memo = excluded.memo,
    created_by = excluded.created_by,
    started_at = excluded.started_at,
    match_ids = excluded.match_ids,
    team_statuses = excluded.team_statuses,
    team_approvals = excluded.team_approvals,
    bracket = excluded.bracket,
    updated_at = excluded.updated_at;

  delete from public.tournament_teams where tournament_id = safe_tournament_id;

  insert into public.tournament_teams (
    tournament_id, team_id, seed_order, status, approved_by, approved_at
  )
  select tournament_id, team_id, seed_order, status, approved_by, approved_at
  from jsonb_populate_recordset(null::public.tournament_teams, coalesce(p_team_rows, '[]'::jsonb));
  get diagnostics team_count = row_count;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  )
  select
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  from jsonb_populate_recordset(null::public.notifications, coalesce(p_notification_rows, '[]'::jsonb))
  on conflict (id) do update set
    user_id = excluded.user_id,
    target_user_id = excluded.target_user_id,
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    match_id = excluded.match_id,
    recruiting_post_id = excluded.recruiting_post_id,
    invitation_id = excluded.invitation_id,
    discord_event = excluded.discord_event,
    read_at = excluded.read_at,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics notification_count = row_count;

  return jsonb_build_object('ok', true, 'tournamentId', safe_tournament_id, 'teamCount', team_count, 'notificationCount', notification_count);
end;
$$;

revoke all on function public.rankball_persist_tournament_snapshot(jsonb, jsonb, jsonb) from public;
grant execute on function public.rankball_persist_tournament_snapshot(jsonb, jsonb, jsonb) to service_role;

create or replace function public.rankball_persist_tournament_snapshot_locked(
  p_tournament_row jsonb,
  p_team_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_tournament_id text := nullif(btrim(p_tournament_row->>'id'), '');
  persist_result jsonb;
begin
  if safe_tournament_id is null then
    raise exception 'missing_tournament_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));

  persist_result := public.rankball_persist_tournament_snapshot(
    p_tournament_row,
    p_team_rows,
    p_notification_rows
  );

  return persist_result || jsonb_build_object('locked', true);
end;
$$;

revoke all on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) from public;
revoke all on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) from anon;
revoke all on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.rankball_persist_tournament_snapshot_locked(jsonb, jsonb, jsonb) to service_role;

create or replace function public.rankball_commit_admin_review_action(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_report_id text,
  p_action_type text default 'validReport',
  p_target_user_id text default null,
  p_duration_days integer default 3,
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
  now_ts timestamptz := now();
  safe_admin_level integer;
  safe_action_type text;
  safe_reason text;
  safe_feedback text;
  safe_duration integer;
  safe_target_user_id text;
  disciplined_user_id text;
  discipline_type text;
  next_status text;
  audit_id text;
  disciplinary_id text;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 30 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  select * into report_row
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  if report_row.status <> 'open' or exists (
    select 1
    from public.admin_audit_log
    where report_id = p_report_id
      and type = 'report_action'
      and status = 'committed'
  ) then
    raise exception 'report_already_processed' using errcode = '23505';
  end if;

  safe_action_type := case
    when p_action_type in ('validReport', 'dismissReport', 'maliciousReporter', 'suspendTarget', 'refereeDiscipline', 'hideCourt', 'hideCourtReview')
      then p_action_type
    else 'validReport'
  end;
  safe_reason := coalesce(nullif(trim(p_reason), ''), case safe_action_type
    when 'validReport' then '신고 인정'
    when 'dismissReport' then '신고 기각'
    when 'maliciousReporter' then '악성 신고자 제재'
    when 'suspendTarget' then '대상 제재'
    when 'refereeDiscipline' then '심판 조치'
    when 'hideCourt' then '구장 숨김'
    when 'hideCourtReview' then '구장 리뷰 숨김'
    else '관리자 처리'
  end);
  safe_feedback := coalesce(nullif(trim(p_feedback), ''), case safe_action_type
    when 'dismissReport' then '확인 결과 신고가 기각되었습니다.'
    when 'maliciousReporter' then '악성 신고로 판단되어 신고자에게 제재가 적용되었습니다.'
    when 'suspendTarget' then '신고 대상에게 제재가 적용되었습니다.'
    when 'refereeDiscipline' then '심판 권한 또는 등급 검토 조치가 등록되었습니다.'
    when 'hideCourt' then '신고된 구장이 숨김 처리되었습니다.'
    when 'hideCourtReview' then '신고된 구장 리뷰가 숨김 처리되었습니다.'
    else '신고가 인정되어 조치되었습니다.'
  end);
  safe_duration := case
    when p_duration_days in (3, 7, 14, 28, 42, 56, 168, 280) then p_duration_days
    else 3
  end;
  safe_target_user_id := coalesce(nullif(trim(p_target_user_id), ''), report_row.reported_user_ids->>0, '');

  if safe_action_type in ('suspendTarget', 'refereeDiscipline') and safe_target_user_id = '' then
    raise exception 'target_user_required' using errcode = '23502';
  end if;

  if safe_action_type = 'hideCourt' and report_row.type <> 'court' then
    raise exception 'court_report_required' using errcode = '22023';
  end if;

  if safe_action_type = 'hideCourtReview' and report_row.type <> 'court_review' then
    raise exception 'court_review_report_required' using errcode = '22023';
  end if;

  disciplined_user_id := case
    when safe_action_type = 'maliciousReporter' then report_row.user_id
    when safe_action_type in ('suspendTarget', 'refereeDiscipline') then safe_target_user_id
    else null
  end;

  if safe_action_type = 'maliciousReporter' and coalesce(disciplined_user_id, '') = '' then
    raise exception 'reporter_not_found' using errcode = '23502';
  end if;

  next_status := case
    when safe_action_type in ('dismissReport', 'maliciousReporter') then 'dismissed'
    else 'resolved'
  end;
  audit_id := 'aa_' || md5(p_report_id || p_actor_profile_id || safe_action_type || now_ts::text);

  update public.reports
  set
    status = next_status,
    resolved_at = now_ts,
    resolved_by = p_actor_profile_id,
    resolution = jsonb_build_object(
      'actionType', safe_action_type,
      'feedback', safe_feedback,
      'reason', safe_reason,
      'targetUserId', nullif(safe_target_user_id, ''),
      'durationDays', safe_duration
    ),
    payload = payload || jsonb_build_object(
      'status', next_status,
      'resolvedAt', now_ts,
      'resolvedBy', p_actor_profile_id,
      'resolution', jsonb_build_object(
        'actionType', safe_action_type,
        'feedback', safe_feedback,
        'reason', safe_reason,
        'targetUserId', nullif(safe_target_user_id, ''),
        'durationDays', safe_duration
      )
    ),
    updated_at = now_ts
  where id = report_row.id;

  if safe_action_type = 'hideCourt' then
    update public.approved_courts
    set
      status = 'hidden',
      hidden_at = now_ts,
      hidden_by = p_actor_profile_id,
      hidden_reason = safe_reason,
      payload = payload || jsonb_build_object(
        'status', 'hidden',
        'hiddenAt', now_ts,
        'hiddenBy', p_actor_profile_id,
        'hiddenReason', safe_reason
      ),
      updated_at = now_ts
    where id = report_row.target_id;

    if not found then
      raise exception 'court_not_found' using errcode = 'P0002';
    end if;
  elsif safe_action_type = 'hideCourtReview' then
    update public.court_reviews
    set
      status = 'hidden',
      hidden_at = now_ts,
      hidden_by = p_actor_profile_id,
      hidden_reason = safe_reason,
      payload = payload || jsonb_build_object(
        'status', 'hidden',
        'hiddenAt', now_ts,
        'hiddenBy', p_actor_profile_id,
        'hiddenReason', safe_reason
      ),
      updated_at = now_ts
    where id = report_row.target_id;

    if not found then
      raise exception 'court_review_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    report_id,
    target_user_id,
    created_by,
    payload,
    created_at
  )
  values (
    audit_id,
    'report_action',
    'committed',
    report_row.id,
    nullif(coalesce(safe_target_user_id, disciplined_user_id), ''),
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', 'report_action',
      'status', 'committed',
      'reportId', report_row.id,
      'actionType', safe_action_type,
      'reason', safe_reason,
      'feedback', safe_feedback,
      'targetUserId', nullif(safe_target_user_id, ''),
      'durationDays', safe_duration,
      'reportVersion', coalesce(report_row.updated_at, report_row.created_at),
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id
    ),
    now_ts
  );

  if disciplined_user_id is not null then
    discipline_type := case when safe_action_type = 'refereeDiscipline' then 'referee_discipline' else 'suspension' end;
    disciplinary_id := 'ad_' || md5(report_row.id || disciplined_user_id || safe_action_type || now_ts::text);

    insert into public.admin_disciplinary_actions (
      id,
      user_id,
      type,
      action_type,
      status,
      source_report_id,
      created_by,
      starts_at,
      ends_at,
      payload,
      created_at,
      updated_at
    )
    values (
      disciplinary_id,
      disciplined_user_id,
      discipline_type,
      safe_action_type,
      'active',
      report_row.id,
      p_actor_profile_id,
      now_ts,
      now_ts + make_interval(days => safe_duration),
      jsonb_build_object(
        'id', disciplinary_id,
        'userId', disciplined_user_id,
        'type', discipline_type,
        'actionType', safe_action_type,
        'sourceReportId', report_row.id,
        'reason', safe_reason,
        'startsAt', now_ts,
        'endsAt', now_ts + make_interval(days => safe_duration),
        'durationDays', safe_duration,
        'createdAt', now_ts,
        'createdBy', p_actor_profile_id,
        'status', 'active'
      ),
      now_ts,
      now_ts
    );
  end if;

  if report_row.user_id is not null then
    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      payload,
      created_at,
      updated_at
    )
    values (
      'n_' || md5('report-result' || report_row.id || report_row.user_id || now_ts::text),
      report_row.user_id,
      report_row.user_id,
      '신고 처리 결과',
      safe_feedback,
      case when next_status = 'resolved' then 'team' else 'orange' end,
      'report',
      jsonb_build_object('reportId', report_row.id, 'actionType', safe_action_type),
      now_ts,
      now_ts
    )
    on conflict (id) do nothing;
  end if;

  if disciplined_user_id is not null then
    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      payload,
      created_at,
      updated_at
    )
    values (
      'n_' || md5('disciplinary' || report_row.id || disciplined_user_id || now_ts::text),
      disciplined_user_id,
      disciplined_user_id,
      '운영 제재 안내',
      safe_reason || ' · ' || safe_duration::text || '일',
      'orange',
      'disciplinary',
      jsonb_build_object('reportId', report_row.id, 'disciplinaryActionId', disciplinary_id),
      now_ts,
      now_ts
    )
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reportId', report_row.id,
    'actionType', safe_action_type,
    'status', next_status,
    'auditId', audit_id,
    'disciplinaryActionId', disciplinary_id
  );
end;
$$;

create or replace function public.rankball_commit_admin_appointment_action(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_action_type text default 'appointReferee',
  p_target_user_id text default null,
  p_appointment_id text default null,
  p_admin_grade text default null,
  p_referee_grade text default null,
  p_term_days integer default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_row public.admin_appointments%rowtype;
  referee_row public.referee_appointments%rowtype;
  now_ts timestamptz := now();
  safe_admin_level integer;
  safe_action_type text;
  safe_role text;
  safe_grade text;
  safe_target_user_id text;
  safe_term_days integer;
  safe_reason text;
  required_level integer;
  appointment_id text;
  audit_id text;
  ends_ts timestamptz;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  safe_action_type := case
    when p_action_type in ('appointAdmin', 'appointReferee', 'revokeAppointment') then p_action_type
    else 'appointReferee'
  end;

  if safe_action_type = 'revokeAppointment' then
    appointment_id := nullif(trim(p_appointment_id), '');
    if appointment_id is null then
      raise exception 'appointment_id_required' using errcode = '23502';
    end if;

    select * into admin_row
    from public.admin_appointments
    where id = appointment_id
    for update;

    if found then
      safe_role := 'admin';
      safe_grade := admin_row.grade;
      safe_target_user_id := admin_row.user_id;
    else
      select * into referee_row
      from public.referee_appointments
      where id = appointment_id
      for update;

      if not found then
        raise exception 'appointment_not_found' using errcode = 'P0002';
      end if;

      safe_role := 'referee';
      safe_grade := referee_row.grade;
      safe_target_user_id := referee_row.user_id;
    end if;

    required_level := case when safe_role = 'admin' then 80 else 50 end;
    if safe_admin_level < required_level then
      raise exception 'admin_permission_required' using errcode = '42501';
    end if;

    if safe_role = 'admin' then
      if admin_row.status in ('revoked', 'expired') or (admin_row.ends_at is not null and admin_row.ends_at < now_ts) then
        raise exception 'appointment_not_active' using errcode = '23505';
      end if;

      update public.admin_appointments
      set
        status = 'revoked',
        payload = payload || jsonb_build_object('status', 'revoked', 'revokedAt', now_ts, 'revokedBy', p_actor_profile_id, 'revokeReason', coalesce(nullif(trim(p_reason), ''), '임명 회수')),
        updated_at = now_ts
      where id = appointment_id;
    else
      if referee_row.status in ('revoked', 'expired') or (referee_row.ends_at is not null and referee_row.ends_at < now_ts) then
        raise exception 'appointment_not_active' using errcode = '23505';
      end if;

      update public.referee_appointments
      set
        status = 'revoked',
        payload = payload || jsonb_build_object('status', 'revoked', 'revokedAt', now_ts, 'revokedBy', p_actor_profile_id, 'revokeReason', coalesce(nullif(trim(p_reason), ''), '임명 회수')),
        updated_at = now_ts
      where id = appointment_id;
    end if;

    safe_reason := coalesce(nullif(trim(p_reason), ''), '임명 회수');
    audit_id := 'aa_' || md5(appointment_id || p_actor_profile_id || safe_action_type || now_ts::text);

    insert into public.admin_audit_log (
      id,
      type,
      status,
      appointment_id,
      target_user_id,
      created_by,
      payload,
      created_at
    )
    values (
      audit_id,
      'appointment_action',
      'committed',
      appointment_id,
      safe_target_user_id,
      p_actor_profile_id,
      jsonb_build_object(
        'id', audit_id,
        'type', 'appointment_action',
        'status', 'committed',
        'actionType', safe_action_type,
        'appointmentId', appointment_id,
        'targetUserId', safe_target_user_id,
        'role', safe_role,
        'grade', safe_grade,
        'reason', safe_reason,
        'createdAt', now_ts,
        'createdBy', p_actor_profile_id
      ),
      now_ts
    );

    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      payload,
      created_at,
      updated_at
    )
    values (
      'n_' || md5('appointment-revoke' || appointment_id || safe_target_user_id || now_ts::text),
      safe_target_user_id,
      safe_target_user_id,
      '임명 회수',
      safe_reason,
      'orange',
      'appointment',
      jsonb_build_object('appointmentId', appointment_id, 'role', safe_role),
      now_ts,
      now_ts
    )
    on conflict (id) do nothing;

    return jsonb_build_object('ok', true, 'actionType', safe_action_type, 'appointmentId', appointment_id);
  end if;

  safe_role := case when safe_action_type = 'appointAdmin' then 'admin' else 'referee' end;
  required_level := case when safe_role = 'admin' then 80 else 50 end;
  if safe_admin_level < required_level then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  safe_target_user_id := nullif(trim(p_target_user_id), '');
  if safe_target_user_id is null then
    raise exception 'target_user_required' using errcode = '23502';
  end if;

  perform 1 from public.profiles where id = safe_target_user_id;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if safe_role = 'admin' then
    safe_grade := case
      when p_admin_grade in ('senior', 'regionManager', 'matchManager', 'support') then p_admin_grade
      else 'support'
    end;
  else
    safe_grade := case
      when p_referee_grade in ('official', 'platinum', 'gold', 'silver', 'candidate') then p_referee_grade
      else 'candidate'
    end;
  end if;

  safe_term_days := case
    when p_term_days is not null and p_term_days > 0 then p_term_days
    when safe_role = 'admin' and safe_grade = 'senior' then 180
    when safe_role = 'admin' and safe_grade = 'regionManager' then 120
    when safe_role = 'admin' and safe_grade = 'matchManager' then 90
    when safe_role = 'admin' and safe_grade = 'support' then 30
    else 90
  end;
  safe_reason := coalesce(nullif(trim(p_reason), ''), '관리자 임명');
  ends_ts := now_ts + make_interval(days => safe_term_days);
  appointment_id := 'ap_' || md5(safe_role || safe_target_user_id || safe_grade || now_ts::text);
  audit_id := 'aa_' || md5(appointment_id || p_actor_profile_id || safe_action_type || now_ts::text);

  if safe_role = 'admin' and exists (
    select 1
    from public.admin_appointments
    where user_id = safe_target_user_id
      and role = 'admin'
      and status not in ('revoked', 'expired')
      and (starts_at is null or starts_at <= now_ts)
      and (ends_at is null or ends_at >= now_ts)
  ) then
    raise exception 'active_appointment_exists' using errcode = '23505';
  end if;

  if safe_role = 'referee' and exists (
    select 1
    from public.referee_appointments
    where user_id = safe_target_user_id
      and role = 'referee'
      and status not in ('revoked', 'expired')
      and (starts_at is null or starts_at <= now_ts)
      and (ends_at is null or ends_at >= now_ts)
  ) then
    raise exception 'active_appointment_exists' using errcode = '23505';
  end if;

  if safe_role = 'admin' then
    insert into public.admin_appointments (
      id,
      user_id,
      role,
      grade,
      status,
      appointed_by,
      starts_at,
      ends_at,
      payload,
      created_at,
      updated_at
    )
    values (
      appointment_id,
      safe_target_user_id,
      'admin',
      safe_grade,
      'active',
      p_actor_profile_id,
      now_ts,
      ends_ts,
      jsonb_build_object(
        'id', appointment_id,
        'role', 'admin',
        'grade', safe_grade,
        'userId', safe_target_user_id,
        'status', 'active',
        'startsAt', now_ts,
        'endsAt', ends_ts,
        'appointedBy', p_actor_profile_id,
        'reason', safe_reason,
        'createdAt', now_ts
      ),
      now_ts,
      now_ts
    );
  else
    insert into public.referee_appointments (
      id,
      user_id,
      role,
      grade,
      status,
      appointed_by,
      starts_at,
      ends_at,
      payload,
      created_at,
      updated_at
    )
    values (
      appointment_id,
      safe_target_user_id,
      'referee',
      safe_grade,
      'active',
      p_actor_profile_id,
      now_ts,
      ends_ts,
      jsonb_build_object(
        'id', appointment_id,
        'role', 'referee',
        'grade', safe_grade,
        'userId', safe_target_user_id,
        'status', 'active',
        'startsAt', now_ts,
        'endsAt', ends_ts,
        'appointedBy', p_actor_profile_id,
        'reason', safe_reason,
        'createdAt', now_ts
      ),
      now_ts,
      now_ts
    );
  end if;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    appointment_id,
    target_user_id,
    created_by,
    payload,
    created_at
  )
  values (
    audit_id,
    'appointment_action',
    'committed',
    appointment_id,
    safe_target_user_id,
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', 'appointment_action',
      'status', 'committed',
      'actionType', safe_action_type,
      'appointmentId', appointment_id,
      'targetUserId', safe_target_user_id,
      'role', safe_role,
      'grade', safe_grade,
      'termDays', safe_term_days,
      'reason', safe_reason,
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id
    ),
    now_ts
  );

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values (
    'n_' || md5('appointment' || appointment_id || safe_target_user_id || now_ts::text),
    safe_target_user_id,
    safe_target_user_id,
    case when safe_role = 'admin' then '관리자 임명' else '심판 임명' end,
    safe_reason || ' · ' || safe_term_days::text || '일',
    'team',
    'appointment',
    jsonb_build_object('appointmentId', appointment_id, 'role', safe_role, 'grade', safe_grade),
    now_ts,
    now_ts
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'actionType', safe_action_type,
    'appointmentId', appointment_id,
    'role', safe_role,
    'grade', safe_grade
  );
end;
$$;

create or replace function public.rankball_commit_admin_disciplinary_action(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_target_user_id text,
  p_action_type text default 'suspendTarget',
  p_type text default 'suspension',
  p_duration_days integer default 3,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_admin_level integer;
  safe_target_user_id text;
  safe_action_type text;
  safe_type text;
  safe_duration integer;
  safe_reason text;
  disciplinary_id text;
  audit_id text;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  safe_target_user_id := nullif(trim(p_target_user_id), '');
  if safe_target_user_id is null then
    raise exception 'target_user_required' using errcode = '23502';
  end if;

  perform 1 from public.profiles where id = safe_target_user_id;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  safe_type := case when p_type = 'referee_discipline' then 'referee_discipline' else 'suspension' end;
  safe_action_type := case
    when p_action_type in ('maliciousReporter', 'suspendTarget', 'refereeDiscipline') then p_action_type
    when safe_type = 'referee_discipline' then 'refereeDiscipline'
    else 'suspendTarget'
  end;
  safe_duration := case
    when p_duration_days in (3, 7, 14, 28, 42, 56, 168, 280) then p_duration_days
    else 3
  end;
  safe_reason := coalesce(nullif(trim(p_reason), ''), '관리자 직접 제재');
  disciplinary_id := 'ad_' || md5(safe_target_user_id || safe_action_type || now_ts::text);
  audit_id := 'aa_' || md5(disciplinary_id || p_actor_profile_id || now_ts::text);

  insert into public.admin_disciplinary_actions (
    id,
    user_id,
    type,
    action_type,
    status,
    created_by,
    starts_at,
    ends_at,
    payload,
    created_at,
    updated_at
  )
  values (
    disciplinary_id,
    safe_target_user_id,
    safe_type,
    safe_action_type,
    'active',
    p_actor_profile_id,
    now_ts,
    now_ts + make_interval(days => safe_duration),
    jsonb_build_object(
      'id', disciplinary_id,
      'userId', safe_target_user_id,
      'type', safe_type,
      'actionType', safe_action_type,
      'reason', safe_reason,
      'startsAt', now_ts,
      'endsAt', now_ts + make_interval(days => safe_duration),
      'durationDays', safe_duration,
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id,
      'status', 'active'
    ),
    now_ts,
    now_ts
  );

  insert into public.admin_audit_log (
    id,
    type,
    status,
    target_user_id,
    created_by,
    payload,
    created_at
  )
  values (
    audit_id,
    'disciplinary_action',
    'committed',
    safe_target_user_id,
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', 'disciplinary_action',
      'status', 'committed',
      'actionType', safe_action_type,
      'disciplinaryActionId', disciplinary_id,
      'targetUserId', safe_target_user_id,
      'durationDays', safe_duration,
      'reason', safe_reason,
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id
    ),
    now_ts
  );

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values (
    'n_' || md5('direct-disciplinary' || disciplinary_id || safe_target_user_id || now_ts::text),
    safe_target_user_id,
    safe_target_user_id,
    '운영 제재 안내',
    safe_reason || ' · ' || safe_duration::text || '일',
    'orange',
    'disciplinary',
    jsonb_build_object('disciplinaryActionId', disciplinary_id),
    now_ts,
    now_ts
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'disciplinaryActionId', disciplinary_id,
    'actionType', safe_action_type,
    'type', safe_type
  );
end;
$$;

revoke all on function public.rankball_commit_admin_review_action(text, integer, text, text, text, integer, text, text) from public;
revoke all on function public.rankball_commit_admin_appointment_action(text, integer, text, text, text, text, text, integer, text) from public;
revoke all on function public.rankball_commit_admin_disciplinary_action(text, integer, text, text, text, integer, text) from public;
grant execute on function public.rankball_commit_admin_review_action(text, integer, text, text, text, integer, text, text) to service_role;
grant execute on function public.rankball_commit_admin_appointment_action(text, integer, text, text, text, text, text, integer, text) to service_role;
grant execute on function public.rankball_commit_admin_disciplinary_action(text, integer, text, text, text, integer, text) to service_role;

create table if not exists public.profile_match_summaries (
  profile_id text primary key references public.profiles(id) on delete cascade,
  match_count integer not null default 0 check (match_count >= 0),
  win_count integer not null default 0 check (win_count >= 0),
  loss_count integer not null default 0 check (loss_count >= 0),
  draw_count integer not null default 0 check (draw_count >= 0),
  points integer not null default 0 check (points >= 0),
  rebounds integer not null default 0 check (rebounds >= 0),
  assists integer not null default 0 check (assists >= 0),
  steals integer not null default 0 check (steals >= 0),
  blocks integer not null default 0 check (blocks >= 0),
  fouls integer not null default 0 check (fouls >= 0),
  last_match_id text,
  last_match_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists profile_match_summaries_last_match_at_idx
  on public.profile_match_summaries (last_match_at desc);

alter table public.profile_match_summaries enable row level security;

drop policy if exists profile_match_summaries_select_self on public.profile_match_summaries;
create policy profile_match_summaries_select_self
on public.profile_match_summaries
for select
to authenticated
using (
  profile_id = public.current_profile_id()
  or exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.auth_user_id = auth.uid()
  )
);

revoke all on public.profile_match_summaries from anon;
grant select on public.profile_match_summaries to authenticated;
grant all on public.profile_match_summaries to service_role;

create or replace function public.rankball_match_summary_at(
  p_confirmed_at timestamptz,
  p_ended_at timestamptz,
  p_started_at timestamptz,
  p_scheduled_date date,
  p_scheduled_time time,
  p_created_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_confirmed_at,
    p_ended_at,
    p_started_at,
    case
      when p_scheduled_date is not null and p_scheduled_time is not null then (p_scheduled_date::text || ' ' || p_scheduled_time::text)::timestamptz
      when p_scheduled_date is not null then p_scheduled_date::timestamptz
      else null
    end,
    p_created_at
  );
$$;

create or replace function public.rankball_rebuild_profile_match_summary(p_profile_id text)
returns public.profile_match_summaries
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  summary_row public.profile_match_summaries%rowtype;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id';
  end if;

  if not exists (select 1 from public.profiles where id = safe_profile_id) then
    raise exception 'profile_not_found';
  end if;

  with participant_matches as (
    select distinct on (m.id)
      m.id as match_id,
      coalesce(nullif(mp.side, ''), 'teamA') as side,
      coalesce(result.score_a, m.score_a, 0) as score_a,
      coalesce(result.score_b, m.score_b, 0) as score_b,
      public.rankball_match_summary_at(
        m.confirmed_at,
        m.ended_at,
        m.started_at,
        m.scheduled_date,
        m.scheduled_time,
        m.created_at
      ) as match_at
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.match_results result on result.match_id = m.id
    where mp.user_id = safe_profile_id
      and m.status = 'confirmed'
    order by m.id, mp.slot_order nulls last
  ),
  scored_matches as (
    select
      participant_matches.*,
      case
        when score_a = score_b then 'draw'
        when side in ('teamB', 'B', 'b') and score_b > score_a then 'win'
        when side not in ('teamB', 'B', 'b') and score_a > score_b then 'win'
        else 'loss'
      end as outcome
    from participant_matches
  ),
  aggregate_row as (
    select
      safe_profile_id as profile_id,
      count(*)::integer as match_count,
      count(*) filter (where outcome = 'win')::integer as win_count,
      count(*) filter (where outcome = 'loss')::integer as loss_count,
      count(*) filter (where outcome = 'draw')::integer as draw_count,
      coalesce(sum(coalesce(stat.points, 0)), 0)::integer as points,
      coalesce(sum(coalesce(stat.rebounds, 0)), 0)::integer as rebounds,
      coalesce(sum(coalesce(stat.assists, 0)), 0)::integer as assists,
      coalesce(sum(coalesce(stat.steals, 0)), 0)::integer as steals,
      coalesce(sum(coalesce(stat.blocks, 0)), 0)::integer as blocks,
      coalesce(sum(coalesce(stat.fouls, 0)), 0)::integer as fouls,
      (array_agg(scored_matches.match_id order by scored_matches.match_at desc nulls last, scored_matches.match_id desc))[1] as last_match_id,
      max(scored_matches.match_at) as last_match_at
    from scored_matches
    left join public.player_match_stats stat
      on stat.match_id = scored_matches.match_id
     and stat.user_id = safe_profile_id
  )
  insert into public.profile_match_summaries (
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    updated_at
  )
  select
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    now()
  from aggregate_row
  on conflict (profile_id) do update set
    match_count = excluded.match_count,
    win_count = excluded.win_count,
    loss_count = excluded.loss_count,
    draw_count = excluded.draw_count,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    fouls = excluded.fouls,
    last_match_id = excluded.last_match_id,
    last_match_at = excluded.last_match_at,
    updated_at = now()
  returning * into summary_row;

  return summary_row;
end;
$$;

revoke all on function public.rankball_rebuild_profile_match_summary(text) from public;
grant execute on function public.rankball_rebuild_profile_match_summary(text) to service_role;

create or replace function public.rankball_refresh_profile_match_summaries_for_match(p_match_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  profile_row record;
  refreshed_count integer := 0;
begin
  if safe_match_id is null then
    return 0;
  end if;

  if not exists (select 1 from public.matches where id = safe_match_id and status = 'confirmed') then
    return 0;
  end if;

  for profile_row in
    select distinct nullif(btrim(user_id), '') as profile_id
    from public.match_players
    where match_id = safe_match_id
      and nullif(btrim(user_id), '') is not null
  loop
    perform public.rankball_rebuild_profile_match_summary(profile_row.profile_id);
    refreshed_count := refreshed_count + 1;
  end loop;

  return refreshed_count;
end;
$$;

revoke all on function public.rankball_refresh_profile_match_summaries_for_match(text) from public;
grant execute on function public.rankball_refresh_profile_match_summaries_for_match(text) to service_role;

create or replace function public.rankball_refresh_all_profile_match_summaries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_count integer := 0;
begin
  with participant_matches as (
    select distinct on (mp.user_id, m.id)
      mp.user_id as profile_id,
      m.id as match_id,
      coalesce(nullif(mp.side, ''), 'teamA') as side,
      coalesce(result.score_a, m.score_a, 0) as score_a,
      coalesce(result.score_b, m.score_b, 0) as score_b,
      public.rankball_match_summary_at(
        m.confirmed_at,
        m.ended_at,
        m.started_at,
        m.scheduled_date,
        m.scheduled_time,
        m.created_at
      ) as match_at
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.match_results result on result.match_id = m.id
    where nullif(btrim(mp.user_id), '') is not null
      and m.status = 'confirmed'
    order by mp.user_id, m.id, mp.slot_order nulls last
  ),
  scored_matches as (
    select
      participant_matches.*,
      case
        when score_a = score_b then 'draw'
        when side in ('teamB', 'B', 'b') and score_b > score_a then 'win'
        when side not in ('teamB', 'B', 'b') and score_a > score_b then 'win'
        else 'loss'
      end as outcome
    from participant_matches
  ),
  aggregate_rows as (
    select
      scored_matches.profile_id,
      count(*)::integer as match_count,
      count(*) filter (where outcome = 'win')::integer as win_count,
      count(*) filter (where outcome = 'loss')::integer as loss_count,
      count(*) filter (where outcome = 'draw')::integer as draw_count,
      coalesce(sum(coalesce(stat.points, 0)), 0)::integer as points,
      coalesce(sum(coalesce(stat.rebounds, 0)), 0)::integer as rebounds,
      coalesce(sum(coalesce(stat.assists, 0)), 0)::integer as assists,
      coalesce(sum(coalesce(stat.steals, 0)), 0)::integer as steals,
      coalesce(sum(coalesce(stat.blocks, 0)), 0)::integer as blocks,
      coalesce(sum(coalesce(stat.fouls, 0)), 0)::integer as fouls,
      (array_agg(scored_matches.match_id order by scored_matches.match_at desc nulls last, scored_matches.match_id desc))[1] as last_match_id,
      max(scored_matches.match_at) as last_match_at
    from scored_matches
    left join public.player_match_stats stat
      on stat.match_id = scored_matches.match_id
     and stat.user_id = scored_matches.profile_id
    group by scored_matches.profile_id
  )
  insert into public.profile_match_summaries (
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    updated_at
  )
  select
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    now()
  from aggregate_rows
  on conflict (profile_id) do update set
    match_count = excluded.match_count,
    win_count = excluded.win_count,
    loss_count = excluded.loss_count,
    draw_count = excluded.draw_count,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    fouls = excluded.fouls,
    last_match_id = excluded.last_match_id,
    last_match_at = excluded.last_match_at,
    updated_at = now();

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.rankball_refresh_all_profile_match_summaries() from public;
grant execute on function public.rankball_refresh_all_profile_match_summaries() to service_role;

create or replace function public.rankball_profile_match_summary_by_match_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match_id text;
begin
  if TG_TABLE_NAME = 'matches' then
    target_match_id := case when TG_OP = 'DELETE' then old.id else new.id end;
  else
    target_match_id := case when TG_OP = 'DELETE' then old.match_id else new.match_id end;
  end if;

  perform public.rankball_refresh_profile_match_summaries_for_match(target_match_id);
  if TG_OP = 'DELETE' then
    return old;
  end if;
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
  if TG_OP in ('UPDATE', 'DELETE') and nullif(old.user_id, '') is not null and exists (
    select 1 from public.matches where id = old.match_id and status = 'confirmed'
  ) then
    perform public.rankball_rebuild_profile_match_summary(old.user_id);
  end if;

  if TG_OP in ('INSERT', 'UPDATE') and nullif(new.user_id, '') is not null and exists (
    select 1 from public.matches where id = new.match_id and status = 'confirmed'
  ) then
    perform public.rankball_rebuild_profile_match_summary(new.user_id);
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_profile_match_summary_matches_refresh on public.matches;
create trigger rankball_profile_match_summary_matches_refresh
after insert or update of status, confirmed_at, score_a, score_b on public.matches
for each row execute function public.rankball_profile_match_summary_by_match_trigger();

drop trigger if exists rankball_profile_match_summary_results_refresh on public.match_results;
create trigger rankball_profile_match_summary_results_refresh
after insert or update or delete on public.match_results
for each row execute function public.rankball_profile_match_summary_by_match_trigger();

drop trigger if exists rankball_profile_match_summary_players_refresh on public.match_players;
create trigger rankball_profile_match_summary_players_refresh
after insert or update or delete on public.match_players
for each row execute function public.rankball_profile_match_summary_by_player_trigger();

drop trigger if exists rankball_profile_match_summary_stats_refresh on public.player_match_stats;
create trigger rankball_profile_match_summary_stats_refresh
after insert or update or delete on public.player_match_stats
for each row execute function public.rankball_profile_match_summary_by_player_trigger();

create or replace function public.rankball_commit_match_rating(
  p_match_id text,
  p_actor_profile_id text,
  p_rating_result jsonb,
  p_team_rating_result jsonb,
  p_profile_updates jsonb default '[]'::jsonb,
  p_team_updates jsonb default '[]'::jsonb,
  p_confirmed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_match record;
  rating_change jsonb;
  profile_update jsonb;
  team_update jsonb;
  safe_mode text;
  affected_count integer := 0;
  rating_count integer := 0;
  profile_count integer := 0;
  team_count integer := 0;
begin
  if nullif(p_match_id, '') is null then
    raise exception 'missing_match_id';
  end if;

  select id, status, mode, rating_result
    into locked_match
    from public.matches
    where id = p_match_id
    for update;

  if not found then
    raise exception 'match_not_found';
  end if;

  if locked_match.rating_result is not null then
    return jsonb_build_object('ok', true, 'alreadyCommitted', true, 'profileCount', 0, 'teamCount', 0);
  end if;

  if locked_match.status in ('void', 'cancelled') then
    raise exception 'match_not_committable';
  end if;

  if p_rating_result is null or jsonb_typeof(p_rating_result) <> 'array' then
    raise exception 'invalid_rating_result';
  end if;

  if coalesce(jsonb_typeof(p_profile_updates), 'array') <> 'array' then
    raise exception 'invalid_profile_updates';
  end if;

  if coalesce(jsonb_typeof(p_team_updates), 'array') <> 'array' then
    raise exception 'invalid_team_updates';
  end if;

  safe_mode := coalesce(nullif(locked_match.mode, ''), '5v5');

  for rating_change in
    select value from jsonb_array_elements(p_rating_result)
  loop
    if nullif(rating_change->>'playerId', '') is null then
      raise exception 'invalid_rating_change';
    end if;

    update public.profiles
    set
      ratings = jsonb_set(
        jsonb_set(
          coalesce(ratings, jsonb_build_object('integrated', 1200, 'modes', '{}'::jsonb)),
          '{integrated}',
          to_jsonb(greatest(0, round(coalesce((ratings->>'integrated')::numeric, 1200) + coalesce(nullif(rating_change->>'integratedDelta', '')::numeric, 0))::integer)),
          true
        ),
        array['modes', safe_mode],
        to_jsonb(greatest(0, round(coalesce((ratings #>> array['modes', safe_mode])::numeric, coalesce((ratings->>'integrated')::numeric, 1200)) + coalesce(nullif(rating_change->>'modeDelta', '')::numeric, 0))::integer)),
        true
      ),
      updated_at = now()
    where id = rating_change->>'playerId';

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'rating_profile_not_found';
    end if;
    rating_count := rating_count + 1;
  end loop;

  for profile_update in
    select value from jsonb_array_elements(coalesce(p_profile_updates, '[]'::jsonb))
  loop
    if nullif(profile_update->>'id', '') is null then
      raise exception 'invalid_profile_update';
    end if;

    update public.profiles
    set
      trust_score = greatest(0, least(100, coalesce(trust_score, 80) + coalesce(nullif(profile_update->>'trustDelta', '')::integer, 0))),
      streak = case profile_update->>'streakResult'
        when 'win' then greatest(1, coalesce(streak, 0) + 1)
        when 'loss' then least(-1, coalesce(streak, 0) - 1)
        else coalesce(streak, 0)
      end,
      updated_at = now()
    where id = profile_update->>'id';

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'rating_profile_not_found';
    end if;
    profile_count := profile_count + 1;
  end loop;

  for team_update in
    select value from jsonb_array_elements(coalesce(p_team_updates, '[]'::jsonb))
  loop
    if nullif(team_update->>'id', '') is null then
      raise exception 'invalid_team_update';
    end if;

    update public.teams
    set
      mmr = greatest(0, round(coalesce(mmr, 1200) + coalesce(nullif(team_update->>'mmrDelta', '')::numeric, 0))::integer),
      wins = greatest(0, coalesce(wins, 0) + coalesce(nullif(team_update->>'winDelta', '')::integer, 0)),
      losses = greatest(0, coalesce(losses, 0) + coalesce(nullif(team_update->>'lossDelta', '')::integer, 0)),
      updated_at = now()
    where id = team_update->>'id';

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'rating_team_not_found';
    end if;
    team_count := team_count + 1;
  end loop;

  update public.matches
  set
    status = 'confirmed',
    rating_result = p_rating_result,
    team_rating_result = coalesce(p_team_rating_result, '{}'::jsonb),
    confirmed_at = coalesce(p_confirmed_at, now()),
    updated_at = now()
  where id = p_match_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyCommitted', false,
    'ratingCount', rating_count,
    'profileCount', profile_count,
    'teamCount', team_count
  );
end;
$$;

revoke all on function public.rankball_commit_match_rating(text, text, jsonb, jsonb, jsonb, jsonb, timestamptz) from public;
grant execute on function public.rankball_commit_match_rating(text, text, jsonb, jsonb, jsonb, jsonb, timestamptz) to service_role;

create or replace function public.rankball_apply_profile_trust_deltas(
  p_actor_profile_id text,
  p_match_id text,
  p_deltas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_match public.matches%rowtype;
  delta_row jsonb;
  target_profile_id text;
  delta_value integer;
  affected_count integer;
  profile_count integer := 0;
begin
  if nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception 'missing_actor_profile_id' using errcode = '23502';
  end if;

  if nullif(trim(coalesce(p_match_id, '')), '') is null then
    raise exception 'missing_match_id' using errcode = '23502';
  end if;

  if coalesce(jsonb_typeof(p_deltas), 'array') <> 'array' then
    raise exception 'invalid_trust_deltas' using errcode = '22023';
  end if;

  select *
  into locked_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if locked_match.status in ('cancelled', 'voided') then
    raise exception 'match_not_trust_mutable' using errcode = '42501';
  end if;

  for delta_row in
    select value from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb))
  loop
    target_profile_id := nullif(trim(coalesce(delta_row->>'id', '')), '');
    delta_value := coalesce(nullif(delta_row->>'trustDelta', '')::integer, 0);

    if target_profile_id is null then
      raise exception 'invalid_profile_update' using errcode = '22023';
    end if;

    if delta_value = 0 then
      continue;
    end if;

    update public.profiles
    set
      trust_score = greatest(0, least(100, coalesce(trust_score, 80) + delta_value)),
      updated_at = now()
    where id = target_profile_id;

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'trust_profile_not_found' using errcode = 'P0002';
    end if;

    profile_count := profile_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'matchId', p_match_id,
    'profileCount', profile_count
  );
end;
$$;

revoke all on function public.rankball_apply_profile_trust_deltas(text, text, jsonb) from public;
grant execute on function public.rankball_apply_profile_trust_deltas(text, text, jsonb) to service_role;

create or replace function public.rankball_mark_notification_read(notification_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notifications
  set
    read_at = coalesce(read_at, now()),
    updated_at = now()
  where id = notification_id
    and (user_id = public.current_profile_id() or target_user_id = public.current_profile_id());
end;
$$;

revoke all on function public.rankball_mark_notification_read(text) from public;
grant execute on function public.rankball_mark_notification_read(text) to authenticated;

do $$
begin
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications add column if not exists user_id text';
    execute 'alter table public.notifications add column if not exists target_user_id text';
    execute 'alter table public.notifications add column if not exists type text';
    execute 'alter table public.notifications add column if not exists recruiting_post_id text';
    execute 'alter table public.notifications add column if not exists invitation_id text';
    execute 'alter table public.notifications add column if not exists discord_event text';
    execute 'alter table public.notifications add column if not exists payload jsonb not null default ''{}''::jsonb';
    execute 'alter table public.notifications add column if not exists updated_at timestamptz not null default now()';
  end if;

  if to_regclass('public.reports') is not null then
    execute 'alter table public.reports add column if not exists reported_user_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.reports add column if not exists resolved_at timestamptz';
    execute 'alter table public.reports add column if not exists resolved_by text';
    execute 'alter table public.reports add column if not exists resolution jsonb';
    execute 'alter table public.reports add column if not exists payload jsonb not null default ''{}''::jsonb';
    execute 'alter table public.reports add column if not exists updated_at timestamptz not null default now()';
  end if;
end;
$$;

create unique index if not exists approved_courts_address_identity_unique
on public.approved_courts (
  lower(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text)),
  coalesce(zonecode, '')
);
create index if not exists approved_courts_region_key_idx
on public.approved_courts (region_key, status)
where region_key is not null;
update public.approved_courts
set region_key = public.rankball_court_region_key(
  payload->>'region',
  address_text,
  road_address,
  jibun_address,
  payload
)
where region_key is distinct from public.rankball_court_region_key(
  payload->>'region',
  address_text,
  road_address,
  jibun_address,
  payload
);

update public.approved_courts
set payload = payload
  - 'requestedBy'
  - 'requestedByTrustScore'
  - 'reportedBy'
  - 'reportedAt'
  - 'requesterTrustAfterReport'
  - 'trustPenalty'
  - 'approvedBy'
  - 'sourceRequestId'
where payload ?| array[
  'requestedBy',
  'requestedByTrustScore',
  'reportedBy',
  'reportedAt',
  'requesterTrustAfterReport',
  'trustPenalty',
  'approvedBy',
  'sourceRequestId'
];

do $$
begin
  if to_regclass('public.approved_courts_source_request_unique') is null and not exists (
    select 1
    from public.approved_courts
    where source_request_id is not null
    group by source_request_id
    having count(*) > 1
  ) then
    execute 'create unique index approved_courts_source_request_unique on public.approved_courts (source_request_id) where source_request_id is not null';
  end if;

  if to_regclass('public.reports_court_request_active_reporter_unique') is null and not exists (
    select 1
    from public.reports
    where type = 'court_request'
      and status <> 'dismissed'
    group by target_id, user_id
    having count(*) > 1
  ) then
    execute 'create unique index reports_court_request_active_reporter_unique on public.reports (target_id, user_id) where type = ''court_request'' and status <> ''dismissed''';
  end if;

  if to_regclass('public.reports_court_active_reporter_unique') is null and not exists (
    select 1
    from public.reports
    where type = 'court'
      and status not in ('dismissed', 'resolved')
    group by target_id, user_id
    having count(*) > 1
  ) then
    execute 'create unique index reports_court_active_reporter_unique on public.reports (target_id, user_id) where type = ''court'' and status not in (''dismissed'', ''resolved'')';
  end if;

  if to_regclass('public.reports_court_review_active_reporter_unique') is null and not exists (
    select 1
    from public.reports
    where type = 'court_review'
      and status not in ('dismissed', 'resolved')
    group by target_id, user_id
    having count(*) > 1
  ) then
    execute 'create unique index reports_court_review_active_reporter_unique on public.reports (target_id, user_id) where type = ''court_review'' and status not in (''dismissed'', ''resolved'')';
  end if;
end;
$$;

create index if not exists court_requests_status_idx on public.court_requests (status, created_at desc);
create index if not exists approved_courts_status_idx on public.approved_courts (status, updated_at desc);
create index if not exists court_reviews_status_idx on public.court_reviews (status, updated_at desc);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists discord_notification_deliveries_status_idx on public.discord_notification_deliveries (status, queued_at);
create index if not exists discord_notification_deliveries_due_idx on public.discord_notification_deliveries (status, send_at, queued_at) where sent_at is null;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'notifications',
    'reports',
    'court_requests',
    'approved_courts',
    'court_reviews',
    'referee_requests',
    'referee_exam_attempts',
    'admin_appointments',
    'referee_appointments',
    'admin_audit_log',
    'admin_disciplinary_actions',
    'discord_notification_deliveries'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'reports',
        'court_requests',
        'approved_courts',
        'court_reviews',
        'matches',
        'match_players',
        'match_results',
        'player_match_stats',
        'match_agreements',
        'match_approvals',
        'match_disputes',
        'recruiting_posts',
        'recruiting_applications',
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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'reports',
    'court_requests',
    'approved_courts',
    'court_reviews',
    'matches',
    'match_players',
    'match_results',
    'player_match_stats',
    'match_agreements',
    'match_approvals',
    'match_disputes',
    'recruiting_posts',
    'recruiting_applications'
  ]
  loop
    execute format('revoke all privileges on table public.%I from public', table_name);
    execute format('revoke all privileges on table public.%I from anon, authenticated', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('grant all privileges on table public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke all privileges on table public.admin_appointments from anon, authenticated;
revoke all privileges on table public.referee_appointments from anon, authenticated;
revoke all privileges on table public.admin_audit_log from anon, authenticated;
revoke all privileges on table public.admin_disciplinary_actions from anon, authenticated;
grant select on table public.admin_appointments to authenticated;
grant select on table public.referee_appointments to authenticated;
grant select on table public.admin_audit_log to authenticated;
grant select on table public.admin_disciplinary_actions to authenticated;

drop policy if exists approved_courts_select_public on public.approved_courts;
drop policy if exists approved_courts_admin_read on public.approved_courts;
create policy approved_courts_select_public
on public.approved_courts
for select
to authenticated
using (status = 'active');
create policy approved_courts_admin_read
on public.approved_courts
for select
to authenticated
using (public.current_is_admin(30));

drop policy if exists court_reviews_select_authenticated on public.court_reviews;
drop policy if exists court_reviews_admin_read on public.court_reviews;
create policy court_reviews_select_authenticated
on public.court_reviews
for select
to authenticated
using (status = 'active');
create policy court_reviews_admin_read
on public.court_reviews
for select
to authenticated
using (public.current_is_admin(30));

drop policy if exists court_requests_self_read on public.court_requests;
drop policy if exists court_requests_self_insert on public.court_requests;
drop policy if exists court_requests_admin_read on public.court_requests;
create policy court_requests_self_read
on public.court_requests
for select
to authenticated
using (requested_by = public.current_profile_id());
create policy court_requests_admin_read
on public.court_requests
for select
to authenticated
using (public.current_is_admin(30));

drop policy if exists referee_requests_self_read on public.referee_requests;
drop policy if exists referee_requests_self_insert on public.referee_requests;
create policy referee_requests_self_read
on public.referee_requests
for select
to authenticated
using (requested_by = public.current_profile_id());
create policy referee_requests_self_insert
on public.referee_requests
for insert
to authenticated
with check (requested_by = public.current_profile_id());

drop policy if exists referee_exam_attempts_self_read on public.referee_exam_attempts;
drop policy if exists referee_exam_attempts_self_insert on public.referee_exam_attempts;
create policy referee_exam_attempts_self_read
on public.referee_exam_attempts
for select
to authenticated
using (user_id = public.current_profile_id());
create policy referee_exam_attempts_self_insert
on public.referee_exam_attempts
for insert
to authenticated
with check (user_id = public.current_profile_id());

drop policy if exists admin_appointments_admin_read on public.admin_appointments;
drop policy if exists referee_appointments_admin_read on public.referee_appointments;
drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
drop policy if exists admin_disciplinary_actions_admin_read on public.admin_disciplinary_actions;
create policy admin_appointments_admin_read on public.admin_appointments for select to authenticated using (public.current_is_admin(30));
create policy referee_appointments_admin_read on public.referee_appointments for select to authenticated using (public.current_is_admin(30));
create policy admin_audit_log_admin_read on public.admin_audit_log for select to authenticated using (public.current_is_admin(30));
create policy admin_disciplinary_actions_admin_read on public.admin_disciplinary_actions for select to authenticated using (public.current_is_admin(30));

drop policy if exists discord_notification_deliveries_self_read on public.discord_notification_deliveries;
create policy discord_notification_deliveries_self_read
on public.discord_notification_deliveries
for select
to authenticated
using (target_user_id = public.current_profile_id());

do $$
begin
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications enable row level security';
    execute 'drop policy if exists notifications_read_all on public.notifications';
    execute 'drop policy if exists notifications_self_read on public.notifications';
    execute 'drop policy if exists notifications_self_update on public.notifications';
    execute 'drop policy if exists notifications_read_at_update on public.notifications';
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'notifications' and column_name = 'user_id'
    ) then
      execute 'create policy notifications_self_read on public.notifications for select to authenticated using (user_id = public.current_profile_id() or target_user_id = public.current_profile_id())';
    else
      execute 'create policy notifications_self_read on public.notifications for select to authenticated using (false)';
    end if;
    execute 'revoke update on public.notifications from anon, authenticated';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.reports') is not null then
    execute 'alter table public.reports enable row level security';
    execute 'drop policy if exists reports_read_all on public.reports';
    execute 'drop policy if exists reports_insert_authenticated on public.reports';
    execute 'drop policy if exists reports_no_public_read on public.reports';
    execute 'drop policy if exists reports_admin_read on public.reports';
    execute 'drop policy if exists reports_self_read on public.reports';
    execute 'create policy reports_self_read on public.reports for select to authenticated using (
      user_id = public.current_profile_id()
      or target_id = public.current_profile_id()
      or coalesce(reported_user_ids, ''[]''::jsonb) @> jsonb_build_array(public.current_profile_id())
    )';
    execute 'create policy reports_admin_read on public.reports for select to authenticated using (public.current_is_admin(30))';
  end if;
end;
$$;

do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'matches',
    'match_players',
    'match_results',
    'player_match_stats',
    'match_agreements',
    'match_approvals',
    'match_disputes'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_read_all', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_select_all', table_name);

    for policy_row in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and cmd = 'SELECT'
        and qual in ('true', '(true)')
    loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_name);
    end loop;
  end loop;

  if to_regclass('public.matches') is not null then
    execute 'drop policy if exists matches_select_public on public.matches';
    execute 'drop policy if exists matches_select_related_private on public.matches';
    execute 'create policy matches_select_public on public.matches for select to anon, authenticated using (coalesce(visibility, ''public'') = ''public'')';
    execute 'create policy matches_select_related_private on public.matches for select to authenticated using (public.rankball_can_read_match(id))';
  end if;

  foreach table_name in array array[
    'match_players',
    'match_results',
    'player_match_stats',
    'match_agreements',
    'match_approvals'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', table_name || '_select_match_readable', table_name);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (public.rankball_can_read_match(match_id))',
      table_name || '_select_match_readable',
      table_name
    );
  end loop;

  if to_regclass('public.match_disputes') is not null then
    execute 'drop policy if exists match_disputes_read_all on public.match_disputes';
    execute 'drop policy if exists match_disputes_no_public_read on public.match_disputes';
    execute 'drop policy if exists match_disputes_select_actor on public.match_disputes';
    execute 'create policy match_disputes_select_actor on public.match_disputes for select to authenticated using (public.rankball_is_match_actor(match_id))';
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

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)'),
      ('rankball_apply_profile_trust_deltas', 'public.rankball_apply_profile_trust_deltas(text,text,jsonb)'),
      ('rankball_cleanup_room_feed', 'public.rankball_cleanup_room_feed(timestamptz)'),
      ('rankball_confirm_recruiting_match_action', 'public.rankball_confirm_recruiting_match_action(text,text,jsonb,jsonb,jsonb,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)'),
      ('rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)'),
      ('rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()'),
      ('rankball_invite_team_member_4', 'public.rankball_invite_team_member(text,text,text,text)'),
      ('rankball_invite_team_member_5', 'public.rankball_invite_team_member(text,text,text,text,text)'),
      ('rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_match_action_with_rating', 'public.rankball_match_action_with_rating(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)'),
      ('rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)'),
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_dispute_action', 'public.rankball_match_dispute_action(text,text,jsonb)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
      ('rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
      ('rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)'),
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
      ('rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text)'),
      ('rankball_match_thumbs_action', 'public.rankball_match_thumbs_action(text,text,jsonb)'),
      ('rankball_normalize_match_dispute_rows', 'public.rankball_normalize_match_dispute_rows(jsonb,text)'),
      ('rankball_persist_match_snapshot', 'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_persist_recruiting_snapshot', 'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot', 'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot_locked', 'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)'),
      ('rankball_rebuild_profile_match_summary', 'public.rankball_rebuild_profile_match_summary(text)'),
      ('rankball_recruiting_action', 'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_recruiting_applicant_placement_action', 'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)'),
      ('rankball_recruiting_cancel_participation_action', 'public.rankball_recruiting_cancel_participation_action(text,text)'),
      ('rankball_recruiting_close_action', 'public.rankball_recruiting_close_action(text,text)'),
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_ready_action', 'public.rankball_recruiting_ready_action(text,text,boolean)'),
      ('rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
      ('rankball_referee_rls_policy_health', 'public.rankball_referee_rls_policy_health()'),
      ('rankball_refresh_all_profile_match_summaries', 'public.rankball_refresh_all_profile_match_summaries()'),
      ('rankball_refresh_profile_match_summaries_for_match', 'public.rankball_refresh_profile_match_summaries_for_match(text)'),
      ('rankball_report_court_request', 'public.rankball_report_court_request(text,text,text)'),
      ('rankball_respond_team_invitation', 'public.rankball_respond_team_invitation(text,text,text)'),
      ('rankball_rls_policy_health', 'public.rankball_rls_policy_health()'),
      ('rankball_submit_court_request', 'public.rankball_submit_court_request(text,jsonb)'),
      ('rankball_submit_court_review', 'public.rankball_submit_court_review(text,jsonb)'),
      ('rankball_sync_team_membership', 'public.rankball_sync_team_membership(text,jsonb,jsonb)')
  ),
  resolved as (
    select
      function_name,
      signature,
      to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'rpc_grant:' || function_name as check_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false) as ok,
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    ) as detail
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_rpc_grant_health() from public;
revoke all on function public.rankball_rpc_grant_health() from anon;
revoke all on function public.rankball_rpc_grant_health() from authenticated;
grant execute on function public.rankball_rpc_grant_health() to service_role;

do $$
declare
  signature text;
begin
  foreach signature in array array[
    'public.rankball_approve_court_request(text,integer,text)',
    'public.rankball_apply_profile_trust_deltas(text,text,jsonb)',
    'public.rankball_cleanup_room_feed(timestamptz)',
    'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)',
    'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)',
    'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)',
    'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)',
    'public.rankball_delete_team(text,text,jsonb)',
    'public.rankball_feed_trigger_health()',
    'public.rankball_invite_team_member(text,text,text,text)',
    'public.rankball_invite_team_member(text,text,text,text,text)',
    'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)',
    'public.rankball_match_agree_action(text,text,text,text)',
    'public.rankball_match_approval_action(text,text,text,text)',
    'public.rankball_match_checkin_action(text,text,text,text)',
    'public.rankball_match_end_action(text,text,text,text)',
    'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)',
    'public.rankball_match_list(text,integer,text,boolean)',
    'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)',
    'public.rankball_match_star_toggle_action(text,text,text)',
    'public.rankball_match_start_action(text,text,text,text,jsonb)',
    'public.rankball_match_thumbs_action(text,text,jsonb)',
    'public.rankball_normalize_match_dispute_rows(jsonb,text)',
    'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)',
    'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)',
    'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)',
    'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)',
    'public.rankball_rebuild_profile_match_summary(text)',
    'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)',
    'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)',
    'public.rankball_recruiting_cancel_participation_action(text,text)',
    'public.rankball_recruiting_feed_counts(text)',
    'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)',
    'public.rankball_recruiting_slot_position_action(text,text,text,text)',
    'public.rankball_referee_rls_policy_health()',
    'public.rankball_refresh_all_profile_match_summaries()',
    'public.rankball_refresh_profile_match_summaries_for_match(text)',
    'public.rankball_report_court_request(text,text,text)',
    'public.rankball_respond_team_invitation(text,text,text)',
    'public.rankball_rls_policy_health()',
    'public.rankball_submit_court_request(text,jsonb)',
    'public.rankball_submit_court_review(text,jsonb)',
    'public.rankball_sync_team_membership(text,jsonb,jsonb)'
  ]
  loop
    execute format('revoke all on function %s from public', signature);
    execute format('revoke all on function %s from anon', signature);
    execute format('revoke all on function %s from authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$$;

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

-- Commit simple player invitation mutations under a per-room transaction lock.

create or replace function public.rankball_recruiting_invite_players_action(
  p_actor_profile_id text,
  p_post_id text,
  p_target_user_ids jsonb default '[]'::jsonb,
  p_side text default 'teamB',
  p_reserve boolean default false,
  p_join_mode text default 'player',
  p_team_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_side text := case when p_side in ('teamA', 'teamB') then p_side else 'teamB' end;
  safe_join_mode text := lower(coalesce(nullif(btrim(p_join_mode), ''), 'player'));
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_invitations jsonb;
  requested_ids jsonb := '[]'::jsonb;
  eligible_ids jsonb := '[]'::jsonb;
  new_invitations jsonb := '[]'::jsonb;
  next_room_state jsonb;
  target_id text;
  target_age_group text;
  target_mmr numeric;
  host_mmr numeric := 1200;
  range_gap numeric := 120;
  allowed_groups jsonb;
  reserve_count integer := 0;
  pending_reserve_count integer := 0;
  invitation_count integer := 0;
  is_participant boolean := false;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_target_user_ids, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_recruiting_invite_targets' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  current_invitations := case
    when jsonb_typeof(current_room_state->'invitations') = 'array' then current_room_state->'invitations'
    else '[]'::jsonb
  end;

  if current_post.status <> 'open' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recruiting_room_not_open', 'postId', safe_post_id);
  end if;
  if safe_join_mode <> 'player' or nullif(btrim(p_team_id), '') is not null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'team_invitation_requires_replay', 'postId', safe_post_id);
  end if;
  if current_post.host_join_mode <> 'player' or current_room_state->>'teamOnly' = 'true' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'team_room_invitation_requires_replay', 'postId', safe_post_id);
  end if;
  if coalesce(current_room_state->>'mmrLimitMode', 'off') = 'block' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'mmr_block_invitation_requires_replay', 'postId', safe_post_id);
  end if;

  select (
    current_post.player_id = safe_actor_id
    or coalesce(current_post.player_ids, '[]'::jsonb) ? safe_actor_id
    or exists (
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and (
          application.player_id = safe_actor_id
          or coalesce(application.player_ids, '[]'::jsonb) ? safe_actor_id
        )
    )
    or exists (
      select 1
      from jsonb_each(case when jsonb_typeof(current_room_state->'partyReserves') = 'object' then current_room_state->'partyReserves' else '{}'::jsonb end) entry(key, value)
      where (case when jsonb_typeof(value) = 'array' then value else '[]'::jsonb end) ? safe_actor_id
    )
  ) into is_participant;

  if not is_participant then
    raise exception 'recruiting_sync_permission_denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
  into requested_ids
  from (
    select distinct nullif(btrim(value), '') as value
    from jsonb_array_elements_text(coalesce(p_target_user_ids, '[]'::jsonb)) ids(value)
    where nullif(btrim(value), '') is not null
      and nullif(btrim(value), '') <> safe_actor_id
    limit 20
  ) requested;

  if jsonb_array_length(requested_ids) = 0 then
    return jsonb_build_object('ok', true, 'action', 'inviteRecruitingPlayers', 'postId', safe_post_id, 'noop', true, 'sqlReducer', true);
  end if;

  allowed_groups := case
    when jsonb_typeof(current_post.allowed_age_groups) = 'array' then current_post.allowed_age_groups
    else '[]'::jsonb
  end;

  if coalesce(current_room_state->>'mmrRangeMode', current_post.rules->>'mmrRangeMode', 'narrow') = 'standard' then
    range_gap := 220;
  elsif coalesce(current_room_state->>'mmrRangeMode', current_post.rules->>'mmrRangeMode', 'narrow') = 'wide' then
    range_gap := 360;
  end if;

  if current_post.player_id is not null then
    select case
      when ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$' then (ratings->>'integrated')::numeric
      else 1200
    end
    into host_mmr
    from public.profiles
    where id = current_post.player_id;
    host_mmr := coalesce(host_mmr, 1200);
  end if;

  for target_id in select jsonb_array_elements_text(requested_ids)
  loop
    select
      case
        when age_group in ('junior', 'rising', 'open') then age_group
        when birth_year is not null and extract(year from now())::integer - birth_year <= 12 then 'junior'
        when birth_year is not null and extract(year from now())::integer - birth_year <= 19 then 'rising'
        when birth_year is not null then 'open'
        else null
      end,
      case
        when ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$' then (ratings->>'integrated')::numeric
        else 1200
      end
    into target_age_group, target_mmr
    from public.profiles
    where id = target_id;

    if not found then
      raise exception 'recruiting_player_not_found' using errcode = '22023';
    end if;
    if jsonb_array_length(allowed_groups) > 0 and jsonb_array_length(allowed_groups) < 3 and not (allowed_groups ? coalesce(target_age_group, 'open')) then
      raise exception 'age_group_not_allowed' using errcode = '42501';
    end if;
    if coalesce(current_room_state->>'mmrLimitMode', 'off') = 'block' and (target_mmr < host_mmr - range_gap or target_mmr > host_mmr + range_gap) then
      raise exception 'recruiting_mmr_out_of_range' using errcode = '42501';
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(eligible.target_id)), '[]'::jsonb)
  into eligible_ids
  from (
    select requested.value as target_id
    from jsonb_array_elements_text(requested_ids) requested(value)
    where requested.value <> coalesce(current_post.player_id, '')
      and not (coalesce(current_post.player_ids, '[]'::jsonb) ? requested.value)
      and not exists (
        select 1
        from public.recruiting_applications application
        where application.post_id = safe_post_id
          and (application.player_id = requested.value or coalesce(application.player_ids, '[]'::jsonb) ? requested.value)
      )
      and not exists (
        select 1
        from jsonb_array_elements(current_invitations) invitation
        where invitation->>'targetUserId' = requested.value
          and coalesce(invitation->>'status', 'pending') = 'pending'
      )
  ) eligible;

  invitation_count := jsonb_array_length(eligible_ids);
  if invitation_count = 0 then
    return jsonb_build_object('ok', true, 'action', 'inviteRecruitingPlayers', 'postId', safe_post_id, 'noop', true, 'sqlReducer', true);
  end if;

  if coalesce(p_reserve, false)
    and coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') <> 'pickup'
  then
    select count(*)::integer
    into reserve_count
    from public.recruiting_applications
    where post_id = safe_post_id
      and side = safe_side
      and reserve = true;

    select count(*)::integer
    into pending_reserve_count
    from jsonb_array_elements(current_invitations) invitation
    where coalesce(invitation->>'status', 'pending') = 'pending'
      and invitation->>'side' = safe_side
      and lower(coalesce(invitation->>'reserve', 'false')) in ('true', 't', '1', 'yes', 'on');

    if reserve_count + pending_reserve_count + invitation_count > current_post.bench_capacity then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_limit_requires_replay', 'postId', safe_post_id);
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', 'inv_' || replace(gen_random_uuid()::text, '-', ''),
    'role', 'player',
    'targetUserId', value,
    'fromUserId', safe_actor_id,
    'teamId', null,
    'joinMode', 'player',
    'side', case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then null
      else safe_side
    end,
    'reserve', case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then false
      else coalesce(p_reserve, false)
    end,
    'status', 'pending',
    'createdAt', now(),
    'updatedAt', now()
  )), '[]'::jsonb)
  into new_invitations
  from jsonb_array_elements_text(eligible_ids) ids(value);

  next_room_state := jsonb_set(current_room_state, '{invitations}', current_invitations || new_invitations, true);

  update public.recruiting_posts
  set room_state = next_room_state, updated_at = now()
  where id = safe_post_id;

  insert into public.notifications (
    id, target_user_id, title, body, tone, recruiting_post_id, invitation_id,
    discord_event, payload, created_at, updated_at
  )
  select
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    invitation->>'targetUserId',
    '매칭방 초대',
    case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup'
        then format('%s 통합 참가 초대장이 도착했습니다.', current_post.title)
      else format('%s %s %s 초대장이 도착했습니다.', current_post.title, case when safe_side = 'teamA' then 'A사이드' else 'B사이드' end, case when coalesce(p_reserve, false) then '후보' else '출전' end)
    end,
    'match',
    safe_post_id,
    invitation->>'id',
    'match',
    jsonb_build_object('source', 'recruiting_invitation'),
    now(),
    now()
  from jsonb_array_elements(new_invitations) invitation;

  return jsonb_build_object(
    'ok', true,
    'action', 'inviteRecruitingPlayers',
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'invitationCount', invitation_count,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_invite_players_action(text, text, jsonb, text, boolean, text, text) from public;
revoke all on function public.rankball_recruiting_invite_players_action(text, text, jsonb, text, boolean, text, text) from anon;
revoke all on function public.rankball_recruiting_invite_players_action(text, text, jsonb, text, boolean, text, text) from authenticated;
grant execute on function public.rankball_recruiting_invite_players_action(text, text, jsonb, text, boolean, text, text) to service_role;

create or replace function public.rankball_recruiting_pickup_best_side(p_post_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with current_post as (
    select
      post.host_side,
      post.host_join_mode,
      post.player_id,
      greatest(1, least(5, coalesce(post.side_capacity, 5))) as side_capacity,
      greatest(0, least(3, coalesce(post.bench_capacity, 0))) as bench_capacity
    from public.recruiting_posts post
    where post.id = p_post_id
  ),
  sides(side) as (
    values ('teamA'::text), ('teamB'::text)
  ),
  application_counts as (
    select
      application.side,
      coalesce(sum(case
        when application.kind = 'team' then greatest(
          1,
          jsonb_array_length(case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end)
        )
        else 1
      end), 0)::integer as participant_count
    from public.recruiting_applications application
    where application.post_id = p_post_id
    group by application.side
  ),
  occupancy as (
    select
      sides.side,
      (
        case
          when post.host_join_mode = 'player' and post.player_id is not null and post.host_side = sides.side then 1
          else 0
        end
        + coalesce(application_counts.participant_count, 0)
      )::integer as participant_count,
      post.side_capacity + post.bench_capacity as participant_capacity
    from current_post post
    cross join sides
    left join application_counts on application_counts.side = sides.side
  )
  select coalesce(
    (
      select occupancy.side
      from occupancy
      where occupancy.participant_count < occupancy.participant_capacity
      order by occupancy.participant_count asc, case when occupancy.side = 'teamA' then 0 else 1 end
      limit 1
    ),
    'teamA'
  );
$$;

revoke all on function public.rankball_recruiting_pickup_best_side(text) from public;
revoke all on function public.rankball_recruiting_pickup_best_side(text) from anon;
revoke all on function public.rankball_recruiting_pickup_best_side(text) from authenticated;
revoke all on function public.rankball_recruiting_pickup_best_side(text) from service_role;

create or replace function public.rankball_recruiting_invitation_decision_action(
  p_actor_profile_id text,
  p_post_id text,
  p_invitation_id text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_invitation_id text := nullif(btrim(p_invitation_id), '');
  safe_action text := nullif(btrim(p_action), '');
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_invitations jsonb;
  invitation jsonb;
  next_invitations jsonb;
  next_room_state jsonb;
  next_pinned_reserves jsonb := '{}'::jsonb;
  side_pinned_ids jsonb := '[]'::jsonb;
  safe_side text;
  safe_reserve boolean;
  actor_position text;
  actor_age_group text;
  actor_mmr numeric := 1200;
  host_mmr numeric := 1200;
  range_gap numeric := 120;
  allowed_groups jsonb;
  active_count integer := 0;
  reserve_count integer := 0;
  pinned_reserve_count integer := 0;
  owner_id text;
  already_joined boolean := false;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null or safe_invitation_id is null then
    raise exception 'missing_recruiting_invitation_id' using errcode = '22023';
  end if;
  if safe_action not in ('acceptRecruitingInvitation', 'declineRecruitingInvitation') then
    raise exception 'invalid_recruiting_invitation_action' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  current_invitations := case
    when jsonb_typeof(current_room_state->'invitations') = 'array' then current_room_state->'invitations'
    else '[]'::jsonb
  end;

  select candidate
  into invitation
  from jsonb_array_elements(current_invitations) candidate
  where candidate->>'id' = safe_invitation_id
    and candidate->>'targetUserId' = safe_actor_id
    and coalesce(candidate->>'status', 'pending') = 'pending'
  limit 1;

  if invitation is null then
    raise exception 'recruiting_invitation_not_found' using errcode = '22023';
  end if;

  if current_post.status <> 'open' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recruiting_room_not_open', 'postId', safe_post_id);
  end if;

  if safe_action = 'declineRecruitingInvitation' then
    select coalesce(jsonb_agg(candidate), '[]'::jsonb)
    into next_invitations
    from jsonb_array_elements(current_invitations) candidate
    where candidate->>'id' <> safe_invitation_id;

    update public.recruiting_posts
    set room_state = jsonb_set(current_room_state, '{invitations}', next_invitations, true), updated_at = now()
    where id = safe_post_id;

    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'actorProfileId', safe_actor_id, 'sqlReducer', true);
  end if;

  if coalesce(invitation->>'role', 'player') = 'referee'
    or nullif(invitation->>'teamId', '') is not null
    or coalesce(nullif(invitation->>'joinMode', ''), 'player') <> 'player'
    or current_post.host_join_mode <> 'player'
    or current_room_state->>'teamOnly' = 'true'
  then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'complex_invitation_requires_replay', 'postId', safe_post_id);
  end if;
  if coalesce(current_room_state->>'mmrLimitMode', 'off') = 'block' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'mmr_block_invitation_requires_replay', 'postId', safe_post_id);
  end if;

  owner_id := coalesce(nullif(current_room_state->>'ownerId', ''), current_post.player_id, invitation->>'fromUserId');
  if safe_actor_id = coalesce(owner_id, '') or safe_actor_id = coalesce(current_post.player_id, '') then
    raise exception 'recruiting_invitation_owner_not_allowed' using errcode = '42501';
  end if;

  select
    position,
    case
      when age_group in ('junior', 'rising', 'open') then age_group
      when birth_year is not null and extract(year from now())::integer - birth_year <= 12 then 'junior'
      when birth_year is not null and extract(year from now())::integer - birth_year <= 19 then 'rising'
      when birth_year is not null then 'open'
      else null
    end,
    case
      when ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$' then (ratings->>'integrated')::numeric
      else 1200
    end
  into actor_position, actor_age_group, actor_mmr
  from public.profiles
  where id = safe_actor_id;

  if not found then
    raise exception 'recruiting_player_not_found' using errcode = '22023';
  end if;

  allowed_groups := case
    when jsonb_typeof(current_post.allowed_age_groups) = 'array' then current_post.allowed_age_groups
    else '[]'::jsonb
  end;
  if jsonb_array_length(allowed_groups) > 0 and jsonb_array_length(allowed_groups) < 3 and not (allowed_groups ? coalesce(actor_age_group, 'open')) then
    raise exception 'age_group_not_allowed' using errcode = '42501';
  end if;

  if coalesce(current_room_state->>'mmrRangeMode', current_post.rules->>'mmrRangeMode', 'narrow') = 'standard' then
    range_gap := 220;
  elsif coalesce(current_room_state->>'mmrRangeMode', current_post.rules->>'mmrRangeMode', 'narrow') = 'wide' then
    range_gap := 360;
  end if;
  if current_post.player_id is not null then
    select case
      when ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$' then (ratings->>'integrated')::numeric
      else 1200
    end
    into host_mmr
    from public.profiles
    where id = current_post.player_id;
    host_mmr := coalesce(host_mmr, 1200);
  end if;
  if coalesce(current_room_state->>'mmrLimitMode', 'off') = 'block' and (actor_mmr < host_mmr - range_gap or actor_mmr > host_mmr + range_gap) then
    raise exception 'recruiting_mmr_out_of_range' using errcode = '42501';
  end if;

  select (
    coalesce(current_post.player_ids, '[]'::jsonb) ? safe_actor_id
    or exists (
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and (application.player_id = safe_actor_id or coalesce(application.player_ids, '[]'::jsonb) ? safe_actor_id)
    )
  ) into already_joined;

  select coalesce(jsonb_agg(candidate), '[]'::jsonb)
  into next_invitations
  from jsonb_array_elements(current_invitations) candidate
  where not (
    candidate->>'id' = safe_invitation_id
    or (
      coalesce(candidate->>'role', 'player') <> 'referee'
      and coalesce(candidate->>'status', 'pending') = 'pending'
      and candidate->>'targetUserId' = safe_actor_id
    )
  );

  if already_joined then
    update public.recruiting_posts
    set room_state = jsonb_set(current_room_state, '{invitations}', next_invitations, true), updated_at = now()
    where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'actorProfileId', safe_actor_id, 'noop', true, 'sqlReducer', true);
  end if;

  safe_side := case
    when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup'
      then public.rankball_recruiting_pickup_best_side(safe_post_id)
    when invitation->>'side' in ('teamA', 'teamB') then invitation->>'side'
    else 'teamB'
  end;
  safe_reserve := lower(coalesce(invitation->>'reserve', 'false')) in ('true', 't', '1', 'yes', 'on');

  active_count := case
    when current_post.host_side = safe_side and current_post.host_join_mode = 'player' and current_post.player_id is not null then 1
    when current_post.host_side = safe_side then jsonb_array_length(case when jsonb_typeof(current_post.player_ids) = 'array' then current_post.player_ids else '[]'::jsonb end)
    else 0
  end;

  select active_count + coalesce(sum(case
    when kind = 'team' then greatest(1, jsonb_array_length(case when jsonb_typeof(player_ids) = 'array' then player_ids else '[]'::jsonb end))
    else 1
  end), 0)::integer
  into active_count
  from public.recruiting_applications
  where post_id = safe_post_id
    and side = safe_side
    and reserve = false;

  select count(*)::integer
  into reserve_count
  from public.recruiting_applications
  where post_id = safe_post_id
    and side = safe_side
    and reserve = true;

  pinned_reserve_count := jsonb_array_length(case
    when jsonb_typeof(current_room_state #> array['pinnedReservePlayers', safe_side]) = 'array' then current_room_state #> array['pinnedReservePlayers', safe_side]
    else '[]'::jsonb
  end);

  if not safe_reserve and active_count >= greatest(1, least(5, coalesce(current_post.side_capacity, 5))) then
    safe_reserve := true;
  end if;
  if safe_reserve and greatest(reserve_count, pinned_reserve_count) >= current_post.bench_capacity then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_limit_requires_replay', 'postId', safe_post_id);
  end if;

  select coalesce(jsonb_object_agg(key, filtered_ids) filter (where jsonb_array_length(filtered_ids) > 0), '{}'::jsonb)
  into next_pinned_reserves
  from (
    select
      key,
      coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_actor_id), '[]'::jsonb) as filtered_ids
    from jsonb_each(case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object' then current_room_state->'pinnedReservePlayers' else '{}'::jsonb end) entry(key, raw_ids)
    left join lateral jsonb_array_elements_text(case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end) ids(value) on true
    group by key
  ) cleaned;

  if safe_reserve then
    side_pinned_ids := case when jsonb_typeof(next_pinned_reserves->safe_side) = 'array' then next_pinned_reserves->safe_side else '[]'::jsonb end;
    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
    into side_pinned_ids
    from (
      select distinct value
      from (
        select value from jsonb_array_elements_text(side_pinned_ids) ids(value)
        union all
        select safe_actor_id
      ) values_to_pin
      where value is not null
    ) unique_values;
    next_pinned_reserves := jsonb_set(next_pinned_reserves, array[safe_side], side_pinned_ids, true);
  end if;

  insert into public.recruiting_applications (
    post_id, player_id, team_id, kind, side, status, reserve, position, player_ids, created_at, updated_at
  ) values (
    safe_post_id, safe_actor_id, null, 'player', safe_side, 'ready', safe_reserve, actor_position, '[]'::jsonb, now(), now()
  )
  on conflict (post_id, player_id, kind) do update set
    team_id = null,
    side = excluded.side,
    status = 'ready',
    reserve = excluded.reserve,
    position = excluded.position,
    updated_at = excluded.updated_at;

  next_room_state := current_room_state;
  next_room_state := jsonb_set(next_room_state, '{invitations}', next_invitations, true);
  next_room_state := jsonb_set(next_room_state, '{pinnedReservePlayers}', next_pinned_reserves, true);

  update public.recruiting_posts
  set room_state = next_room_state, updated_at = now()
  where id = safe_post_id;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, recruiting_post_id, invitation_id, payload, created_at, updated_at
  ) values (
    'n_' || replace(gen_random_uuid()::text, '-', ''),
    safe_actor_id,
    null,
    '초대 수락',
    format('%s %s %s으로 대기 등록되었습니다.', current_post.title, case when safe_side = 'teamA' then 'A사이드' else 'B사이드' end, case when safe_reserve then '후보' else '출전' end),
    'match',
    safe_post_id,
    safe_invitation_id,
    jsonb_build_object('source', 'recruiting_invitation_accept'),
    now(),
    now()
  );

  if coalesce(invitation->>'fromUserId', owner_id, '') <> '' and coalesce(invitation->>'fromUserId', owner_id, '') <> safe_actor_id then
    insert into public.notifications (
      id, target_user_id, title, body, tone, recruiting_post_id, invitation_id, payload, created_at, updated_at
    ) values (
      'n_' || replace(gen_random_uuid()::text, '-', ''),
      coalesce(invitation->>'fromUserId', owner_id),
      '초대 수락',
      format('%s 초대가 수락되었습니다.', current_post.title),
      'match',
      safe_post_id,
      safe_invitation_id,
      jsonb_build_object('source', 'recruiting_invitation_accept'),
      now(),
      now()
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'postId', safe_post_id,
    'actorProfileId', safe_actor_id,
    'side', safe_side,
    'reserve', safe_reserve,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_invitation_decision_action(text, text, text, text) from public;
revoke all on function public.rankball_recruiting_invitation_decision_action(text, text, text, text) from anon;
revoke all on function public.rankball_recruiting_invitation_decision_action(text, text, text, text) from authenticated;
grant execute on function public.rankball_recruiting_invitation_decision_action(text, text, text, text) to service_role;

do $patch$
declare
  function_def text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure)
  into function_def;

  old_fragment := $old$      safe_side := case when payload->>'side' = 'teamA' then 'teamA' else 'teamB' end;
      reserve := coalesce((payload->>'reserve')::$old$ || 'boolean' || $old$, false);$old$;
  new_fragment := $new$      if coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then
        safe_side := null;
        reserve := false;
      else
        safe_side := case when payload->>'side' = 'teamA' then 'teamA' else 'teamB' end;
        reserve := lower(coalesce(payload->>'reserve', 'false')) in ('true', 't', '1', 'yes', 'on');
      end if;$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action pickup invite shape changed';
  end if;

  old_fragment := $old$    safe_side := case when invitation->>'side' = 'teamA' then 'teamA' else 'teamB' end;
    reserve := coalesce((invitation->>'reserve')::$old$ || 'boolean' || $old$, false);$old$;
  new_fragment := $new$    safe_side := case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup'
        then public.rankball_recruiting_pickup_best_side(safe_post_id)
      when invitation->>'side' = 'teamA' then 'teamA'
      else 'teamB'
    end;
    reserve := case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then false
      else lower(coalesce(invitation->>'reserve', 'false')) in ('true', 't', '1', 'yes', 'on')
    end;$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action pickup acceptance shape changed';
  end if;

  execute function_def;
end;
$patch$;

create or replace function public.rankball_recruiting_expire_player_invitations_if_full(
  p_post_id text,
  p_invitations jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_post public.recruiting_posts%rowtype;
  participant_capacity integer;
  occupied_count integer;
  next_invitations jsonb;
begin
  select *
  into current_post
  from public.recruiting_posts
  where id = p_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = 'P0002';
  end if;

  participant_capacity := 2 * (
    greatest(1, least(5, coalesce(current_post.side_capacity, 5)))
    + greatest(0, least(3, coalesce(current_post.bench_capacity, 0)))
  );
  occupied_count :=
    public.rankball_recruiting_side_active_count(current_post, 'teamA')
    + public.rankball_recruiting_side_reserve_count(current_post, 'teamA')
    + public.rankball_recruiting_side_active_count(current_post, 'teamB')
    + public.rankball_recruiting_side_reserve_count(current_post, 'teamB');

  if participant_capacity <= 0 or occupied_count < participant_capacity then
    return jsonb_build_object(
      'filled', false,
      'invitations', coalesce(p_invitations, '[]'::jsonb)
    );
  end if;

  update public.notifications notice
  set
    read_at = coalesce(notice.read_at, p_now),
    updated_at = p_now
  where notice.recruiting_post_id = p_post_id
    and notice.read_at is null
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb)) invitation(value)
      where (invitation.value::jsonb)->>'id' = notice.invitation_id
        and (invitation.value::jsonb)->>'role' <> 'referee'
        and coalesce((invitation.value::jsonb)->>'status', 'pending') = 'pending'
    );

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    recruiting_post_id,
    invitation_id,
    payload,
    created_at,
    updated_at
  )
  select
    'notice-recruiting-full-' || substr(md5(p_post_id || ':' || ((invitation.value::jsonb)->>'id')), 1, 24),
    (invitation.value::jsonb)->>'targetUserId',
    (invitation.value::jsonb)->>'targetUserId',
    '방이 마감됐습니다',
    format('%s 방의 정원이 모두 찼습니다. 먼저 수락한 선수만 참가합니다.', current_post.title),
    'orange',
    'recruiting_invitation_closed',
    p_post_id,
    (invitation.value::jsonb)->>'id',
    jsonb_build_object(
      'source', 'recruiting_capacity_full',
      'recruitingPostId', p_post_id,
      'invitationId', (invitation.value::jsonb)->>'id'
    ),
    p_now,
    p_now
  from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb)) invitation(value)
  where (invitation.value::jsonb)->>'role' <> 'referee'
    and coalesce((invitation.value::jsonb)->>'status', 'pending') = 'pending'
    and nullif(btrim((invitation.value::jsonb)->>'targetUserId'), '') is not null
  on conflict (id) do update set
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    payload = excluded.payload,
    read_at = null,
    updated_at = excluded.updated_at;

  select coalesce(
    jsonb_agg(
      case
        when (invitation.value::jsonb)->>'role' <> 'referee'
          and coalesce((invitation.value::jsonb)->>'status', 'pending') = 'pending'
          then invitation.value::jsonb || jsonb_build_object('status', 'expired', 'updatedAt', p_now)
        else invitation.value::jsonb
      end
      order by invitation.ordinality
    ),
    '[]'::jsonb
  )
  into next_invitations
  from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb))
    with ordinality invitation(value, ordinality);

  return jsonb_build_object(
    'filled', true,
    'invitations', next_invitations
  );
end;
$$;

revoke all on function public.rankball_recruiting_expire_player_invitations_if_full(text, jsonb, timestamptz)
from public, anon, authenticated, service_role;

do $patch$
declare
  function_def text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure)
  into function_def;

  old_fragment := $old$    if reserve and reserve_count >= bench_capacity then
      invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'expired', now_at);
      update public.recruiting_posts
      set room_state = jsonb_set(management.room_state, '{invitations}', invitations, true), updated_at = now_at
      where id = safe_post_id;
      update public.notifications notice
      set read_at = coalesce(read_at, now_at), updated_at = now_at
      where notice.recruiting_post_id = safe_post_id
        and notice.invitation_id = management.invitation_id
        and notice.target_user_id = safe_actor_id;
      return jsonb_build_object(
        'ok', true,
        'action', safe_action,
        'postId', safe_post_id,
        'invitationExpired', true,
        'reason', 'recruiting_reserve_full',
        'sqlReducer', true,
        'advisoryLocked', true
      );
    end if;$old$;
  new_fragment := $new$    if reserve and reserve_count >= bench_capacity then
      payload := public.rankball_recruiting_expire_player_invitations_if_full(safe_post_id, invitations, now_at);
      if coalesce((payload->>'filled')::boolean, false) then
        invitations := coalesce(payload->'invitations', invitations);
      else
        invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'expired', now_at);
      end if;
      update public.recruiting_posts
      set room_state = jsonb_set(
            management.room_state
              || case
                when coalesce((payload->>'filled')::boolean, false)
                  then jsonb_build_object('playerCapacityFilledAt', now_at)
                else '{}'::jsonb
              end,
            '{invitations}',
            invitations,
            true
          ),
          updated_at = now_at
      where id = safe_post_id;
      update public.notifications notice
      set read_at = coalesce(read_at, now_at), updated_at = now_at
      where notice.recruiting_post_id = safe_post_id
        and notice.invitation_id = management.invitation_id
        and notice.target_user_id = safe_actor_id
        and notice.id not like 'notice-recruiting-full-%';
      return jsonb_build_object(
        'ok', false,
        'action', safe_action,
        'postId', safe_post_id,
        'invitationExpired', true,
        'reason', case
          when coalesce((payload->>'filled')::boolean, false) then 'recruiting_player_capacity_full'
          else 'recruiting_reserve_full'
        end,
        'message', case
          when coalesce((payload->>'filled')::boolean, false) then '방이 마감됐습니다. 먼저 수락한 선수만 참가합니다.'
          else '해당 후보 자리가 이미 찼습니다.'
        end,
        'sqlReducer', true,
        'advisoryLocked', true
      );
    end if;$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action full rejection shape changed';
  end if;

  old_fragment := $old$    invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'accepted', now_at);
    update public.recruiting_posts set room_state = jsonb_set(management.room_state, '{invitations}', invitations, true), updated_at = now_at where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sideName', safe_side, 'reserve', reserve, 'sqlReducer', true, 'advisoryLocked', true);$old$;
  new_fragment := $new$    invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'accepted', now_at);
    payload := public.rankball_recruiting_expire_player_invitations_if_full(safe_post_id, invitations, now_at);
    invitations := coalesce(payload->'invitations', invitations);
    update public.recruiting_posts
    set room_state = jsonb_set(
          management.room_state
            || case
              when coalesce((payload->>'filled')::boolean, false)
                then jsonb_build_object('playerCapacityFilledAt', now_at)
              else '{}'::jsonb
            end,
          '{invitations}',
          invitations,
          true
        ),
        updated_at = now_at
    where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sideName', safe_side, 'reserve', reserve, 'roomFilled', coalesce((payload->>'filled')::boolean, false), 'sqlReducer', true, 'advisoryLocked', true);$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action full acceptance shape changed';
  end if;

  execute function_def;
end;
$patch$;

create index if not exists recruiting_posts_owner_created_idx
  on public.recruiting_posts (
    (coalesce(nullif(room_state->>'ownerId', ''), nullif(player_id, ''))),
    created_at desc
  );

create index if not exists reports_player_target_status_created_idx
  on public.reports (target_id, status, created_at desc)
  where type = 'player';

create index if not exists reports_type_created_idx
  on public.reports (type, created_at desc);

create index if not exists admin_audit_log_target_type_created_idx
  on public.admin_audit_log (target_user_id, type, created_at desc);

create or replace function public.rankball_admin_user_operations(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_limit integer default 30,
  p_offset integer default 0,
  p_search text default null,
  p_risk_only boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_admin_level integer;
  safe_limit integer := greatest(1, least(60, coalesce(p_limit, 30)));
  safe_offset integer := greatest(0, least(10000, coalesce(p_offset, 0)));
  safe_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  cutoff_at timestamptz := now() - interval '30 days';
  result jsonb;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  with room_stats as (
    select
      coalesce(nullif(post.room_state->>'ownerId', ''), nullif(post.player_id, '')) as user_id,
      count(*)::integer as room_count_30d,
      count(*) filter (where post.status = 'closed')::integer as closed_room_count_30d,
      max(coalesce(post.updated_at, post.created_at)) as last_room_at
    from public.recruiting_posts post
    where post.created_at >= cutoff_at
      and coalesce(nullif(post.room_state->>'ownerId', ''), nullif(post.player_id, '')) is not null
    group by coalesce(nullif(post.room_state->>'ownerId', ''), nullif(post.player_id, ''))
  ),
  match_stats as (
    select
      player.user_id,
      count(distinct player.match_id) filter (
        where coalesce(match_row.started_at, match_row.agreed_at, match_row.created_at) >= cutoff_at
      )::integer as match_count_30d,
      count(distinct player.match_id) filter (
        where match_row.status = 'cancelled'
          and coalesce(match_row.cancelled_at, match_row.updated_at, match_row.created_at) >= cutoff_at
      )::integer as cancelled_match_count_30d,
      max(coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at)) as last_match_at
    from public.match_players player
    join public.matches match_row on match_row.id = player.match_id
    where coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at) >= cutoff_at
    group by player.user_id
  ),
  chat_stats as (
    select
      message.user_id,
      count(*)::integer as message_count_30d,
      max(message.created_at) as last_message_at
    from public.room_chat_messages message
    where message.created_at >= cutoff_at
    group by message.user_id
  ),
  filed_report_stats as (
    select
      report.user_id,
      count(*)::integer as filed_report_count_30d,
      max(report.created_at) as last_report_at
    from public.reports report
    where report.created_at >= cutoff_at
      and report.user_id is not null
    group by report.user_id
  ),
  raw_received_reports as (
    select report.id, report.target_id as user_id, report.status, report.created_at
    from public.reports report
    where report.type = 'player'
      and report.target_id is not null
      and (report.created_at >= cutoff_at or report.status = 'open')
    union
    select report.id, target.value as user_id, report.status, report.created_at
    from public.reports report
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(report.reported_user_ids) = 'array' then report.reported_user_ids else '[]'::jsonb end
    ) target(value)
    where report.type = 'player'
      and (report.created_at >= cutoff_at or report.status = 'open')
  ),
  received_report_stats as (
    select
      received.user_id,
      count(*) filter (where received.created_at >= cutoff_at)::integer as received_report_count_30d,
      count(*) filter (where received.status = 'open')::integer as open_report_count,
      max(received.created_at) as last_received_report_at
    from raw_received_reports received
    where nullif(btrim(received.user_id), '') is not null
    group by received.user_id
  ),
  discipline_stats as (
    select
      action.user_id,
      count(*)::integer as active_sanction_count,
      max(action.ends_at) filter (where action.type = 'suspension') as full_suspension_until,
      max(action.ends_at) filter (where action.type = 'public_room_suspension') as public_room_suspension_until
    from public.admin_disciplinary_actions action
    where action.status not in ('revoked', 'expired')
      and (action.starts_at is null or action.starts_at <= now())
      and (action.ends_at is null or action.ends_at >= now())
    group by action.user_id
  ),
  warning_stats as (
    select
      audit.target_user_id as user_id,
      count(*)::integer as warning_count_30d,
      max(audit.created_at) as last_warning_at
    from public.admin_audit_log audit
    where audit.type = 'manual_user_warning'
      and audit.created_at >= cutoff_at
    group by audit.target_user_id
  ),
  base as (
    select
      profile.id,
      profile.name,
      coalesce(profile.hashtag, profile.handle, profile.id) as hashtag,
      profile.position,
      profile.region,
      coalesce(profile.trust_score, 80)::integer as trust_score,
      profile.created_at,
      coalesce(summary.match_count, 0)::integer as total_match_count,
      coalesce(room.room_count_30d, 0)::integer as room_count_30d,
      coalesce(room.closed_room_count_30d, 0)::integer as closed_room_count_30d,
      coalesce(match_activity.match_count_30d, 0)::integer as match_count_30d,
      coalesce(match_activity.cancelled_match_count_30d, 0)::integer as cancelled_match_count_30d,
      coalesce(chat.message_count_30d, 0)::integer as message_count_30d,
      coalesce(filed.filed_report_count_30d, 0)::integer as filed_report_count_30d,
      coalesce(received.received_report_count_30d, 0)::integer as received_report_count_30d,
      coalesce(received.open_report_count, 0)::integer as open_report_count,
      coalesce(discipline.active_sanction_count, 0)::integer as active_sanction_count,
      discipline.full_suspension_until,
      discipline.public_room_suspension_until,
      coalesce(warning.warning_count_30d, 0)::integer as warning_count_30d,
      greatest(
        coalesce(profile.updated_at, profile.created_at, 'epoch'::timestamptz),
        coalesce(summary.last_match_at, 'epoch'::timestamptz),
        coalesce(room.last_room_at, 'epoch'::timestamptz),
        coalesce(match_activity.last_match_at, 'epoch'::timestamptz),
        coalesce(chat.last_message_at, 'epoch'::timestamptz),
        coalesce(filed.last_report_at, 'epoch'::timestamptz)
      ) as last_activity_at
    from public.profiles profile
    left join public.profile_match_summaries summary on summary.profile_id = profile.id
    left join room_stats room on room.user_id = profile.id
    left join match_stats match_activity on match_activity.user_id = profile.id
    left join chat_stats chat on chat.user_id = profile.id
    left join filed_report_stats filed on filed.user_id = profile.id
    left join received_report_stats received on received.user_id = profile.id
    left join discipline_stats discipline on discipline.user_id = profile.id
    left join warning_stats warning on warning.user_id = profile.id
  ),
  scored as (
    select
      raw.*,
      case
        when raw.risk_score >= 60 then 'high'
        when raw.risk_score >= 30 then 'review'
        when raw.risk_score >= 10 then 'watch'
        else 'normal'
      end as risk_level,
      array_remove(array[
        case when raw.active_sanction_count > 0 then 'active_discipline' end,
        case when raw.open_report_count >= 3 then 'repeated_open_reports' when raw.open_report_count >= 1 then 'open_report' end,
        case when raw.received_report_count_30d >= 5 then 'repeated_received_reports' when raw.received_report_count_30d >= 2 then 'received_reports' end,
        case when raw.trust_score < 50 then 'very_low_trust' when raw.trust_score < 70 then 'low_trust' end,
        case when raw.cancelled_match_count_30d >= 3 then 'repeated_cancelled_matches' end,
        case when raw.room_count_30d >= 20 then 'high_room_creation' end,
        case when raw.filed_report_count_30d >= 15 then 'high_report_filing' end
      ]::text[], null) as risk_signals
    from (
      select
        base.*,
        (
          case when base.active_sanction_count > 0 then 50 else 0 end
          + case when base.open_report_count >= 3 then 30 when base.open_report_count >= 1 then 15 else 0 end
          + case when base.received_report_count_30d >= 5 then 20 when base.received_report_count_30d >= 2 then 10 else 0 end
          + case when base.trust_score < 50 then 25 when base.trust_score < 70 then 10 else 0 end
          + case when base.cancelled_match_count_30d >= 3 then 20 else 0 end
          + case when base.room_count_30d >= 20 then 10 else 0 end
          + case when base.filed_report_count_30d >= 15 then 10 else 0 end
        )::integer as risk_score
      from base
    ) raw
  ),
  filtered as (
    select *
    from scored
    where (safe_search is null or lower(concat_ws(' ', name, hashtag, id, region)) like '%' || safe_search || '%')
      and (not coalesce(p_risk_only, true) or risk_score >= 10)
  ),
  paged as (
    select *
    from filtered
    order by risk_score desc, last_activity_at desc, id
    limit safe_limit
    offset safe_offset
  )
  select jsonb_build_object(
    'ok', true,
    'summary', jsonb_build_object(
      'totalUsers', (select count(*) from scored),
      'activeUsers30d', (select count(*) from scored where last_activity_at >= cutoff_at),
      'signalUsers', (select count(*) from scored where risk_score >= 10),
      'reviewUsers', (select count(*) from scored where risk_score >= 30),
      'activeSanctionUsers', (select count(*) from scored where active_sanction_count > 0),
      'newUsers30d', (select count(*) from scored where created_at >= cutoff_at),
      'warningCount30d', (select coalesce(sum(warning_count_30d), 0) from scored)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'name', page.name,
        'hashtag', page.hashtag,
        'position', page.position,
        'region', page.region,
        'trustScore', page.trust_score,
        'createdAt', page.created_at,
        'lastActivityAt', page.last_activity_at,
        'totalMatchCount', page.total_match_count,
        'roomCount30d', page.room_count_30d,
        'closedRoomCount30d', page.closed_room_count_30d,
        'matchCount30d', page.match_count_30d,
        'cancelledMatchCount30d', page.cancelled_match_count_30d,
        'messageCount30d', page.message_count_30d,
        'filedReportCount30d', page.filed_report_count_30d,
        'receivedReportCount30d', page.received_report_count_30d,
        'openReportCount', page.open_report_count,
        'activeSanctionCount', page.active_sanction_count,
        'fullSuspensionUntil', page.full_suspension_until,
        'publicRoomSuspensionUntil', page.public_room_suspension_until,
        'warningCount30d', page.warning_count_30d,
        'riskScore', page.risk_score,
        'riskLevel', page.risk_level,
        'riskSignals', to_jsonb(page.risk_signals)
      ) order by page.risk_score desc, page.last_activity_at desc, page.id)
      from paged page
    ), '[]'::jsonb),
    'page', jsonb_build_object(
      'limit', safe_limit,
      'offset', safe_offset,
      'total', (select count(*) from filtered),
      'nextOffset', case
        when safe_offset + (select count(*) from paged) < (select count(*) from filtered)
          then safe_offset + (select count(*) from paged)
        else null
      end,
      'hasMore', safe_offset + (select count(*) from paged) < (select count(*) from filtered)
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.rankball_commit_admin_manual_user_action(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_target_user_id text,
  p_action_type text,
  p_duration_days integer default 3,
  p_reason text default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_admin_level integer;
  target_admin_level integer;
  safe_target_user_id text := nullif(btrim(p_target_user_id), '');
  safe_action_type text := nullif(btrim(p_action_type), '');
  safe_duration integer := coalesce(p_duration_days, 3);
  safe_reason text := nullif(btrim(p_reason), '');
  safe_message text := nullif(btrim(p_message), '');
  disciplinary_type text;
  disciplinary_id text;
  audit_id text := 'aa_' || replace(gen_random_uuid()::text, '-', '');
  notification_id text := 'n_' || replace(gen_random_uuid()::text, '-', '');
  action_ends_at timestamptz;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if safe_target_user_id is null then
    raise exception 'target_user_required' using errcode = '23502';
  end if;
  if safe_target_user_id = p_actor_profile_id then
    raise exception 'self_admin_action_denied' using errcode = '42501';
  end if;
  if safe_action_type not in ('warning', 'publicRoomSuspend', 'suspendTarget') then
    raise exception 'unsupported_admin_user_action' using errcode = '22023';
  end if;
  if safe_reason is null or char_length(safe_reason) not between 4 and 300 then
    raise exception 'admin_user_action_reason_required' using errcode = '22023';
  end if;
  if safe_message is null or char_length(safe_message) not between 4 and 500 then
    raise exception 'admin_user_action_message_required' using errcode = '22023';
  end if;
  if safe_action_type <> 'warning' and safe_duration not in (3, 7, 14, 28, 42, 56, 168, 280) then
    raise exception 'invalid_suspension_duration' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:admin-user-action'), hashtext(safe_target_user_id));
  perform 1 from public.profiles where id = safe_target_user_id for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  target_admin_level := public.rankball_admin_level_for_profile(safe_target_user_id, 0);
  if target_admin_level > 0 and target_admin_level >= safe_admin_level then
    raise exception 'admin_target_protected' using errcode = '42501';
  end if;

  if safe_action_type <> 'warning' then
    disciplinary_type := case when safe_action_type = 'publicRoomSuspend' then 'public_room_suspension' else 'suspension' end;
    disciplinary_id := 'ad_' || replace(gen_random_uuid()::text, '-', '');
    action_ends_at := now_ts + make_interval(days => safe_duration);

    insert into public.admin_disciplinary_actions (
      id,
      user_id,
      type,
      action_type,
      status,
      created_by,
      starts_at,
      ends_at,
      payload,
      created_at,
      updated_at
    ) values (
      disciplinary_id,
      safe_target_user_id,
      disciplinary_type,
      safe_action_type,
      'active',
      p_actor_profile_id,
      now_ts,
      action_ends_at,
      jsonb_build_object(
        'id', disciplinary_id,
        'userId', safe_target_user_id,
        'type', disciplinary_type,
        'actionType', safe_action_type,
        'reason', safe_reason,
        'startsAt', now_ts,
        'endsAt', action_ends_at,
        'durationDays', safe_duration,
        'createdAt', now_ts,
        'createdBy', p_actor_profile_id,
        'status', 'active',
        'source', 'manual_user_operation'
      ),
      now_ts,
      now_ts
    );
  end if;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    target_user_id,
    created_by,
    payload,
    created_at
  ) values (
    audit_id,
    case when safe_action_type = 'warning' then 'manual_user_warning' else 'manual_user_sanction' end,
    'committed',
    safe_target_user_id,
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', case when safe_action_type = 'warning' then 'manual_user_warning' else 'manual_user_sanction' end,
      'status', 'committed',
      'actionType', safe_action_type,
      'disciplinaryActionId', disciplinary_id,
      'targetUserId', safe_target_user_id,
      'durationDays', case when safe_action_type = 'warning' then null else safe_duration end,
      'reason', safe_reason,
      'message', safe_message,
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id,
      'sourceReportId', null
    ),
    now_ts
  );

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  ) values (
    notification_id,
    safe_target_user_id,
    safe_target_user_id,
    case
      when safe_action_type = 'warning' then '운영 경고 안내'
      when safe_action_type = 'publicRoomSuspend' then '공개방 이용 제한 안내'
      else '서비스 이용 제한 안내'
    end,
    safe_message,
    'orange',
    case when safe_action_type = 'warning' then 'admin_warning' else 'disciplinary' end,
    jsonb_build_object(
      'source', 'admin_manual_user_action',
      'actionType', safe_action_type,
      'auditLogId', audit_id,
      'disciplinaryActionId', disciplinary_id,
      'durationDays', case when safe_action_type = 'warning' then null else safe_duration end,
      'endsAt', action_ends_at
    ),
    now_ts,
    now_ts
  );

  return jsonb_build_object(
    'ok', true,
    'actionType', safe_action_type,
    'targetUserId', safe_target_user_id,
    'auditLogId', audit_id,
    'disciplinaryActionId', disciplinary_id,
    'notificationId', notification_id,
    'endsAt', action_ends_at
  );
end;
$$;

revoke all on function public.rankball_admin_user_operations(text, integer, integer, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.rankball_commit_admin_manual_user_action(text, integer, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.rankball_admin_user_operations(text, integer, integer, integer, text, boolean) to service_role;
grant execute on function public.rankball_commit_admin_manual_user_action(text, integer, text, text, integer, text, text) to service_role;

create or replace function public.rankball_mark_notifications_read_action(
  p_profile_id text,
  p_notification_id text default null,
  p_all boolean default false,
  p_read_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  safe_notification_id text := nullif(btrim(p_notification_id), '');
  safe_read_at timestamptz := coalesce(p_read_at, now());
  notification_ids jsonb := '[]'::jsonb;
  affected_count integer := 0;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id' using errcode = '22023';
  end if;
  if not coalesce(p_all, false) and safe_notification_id is null then
    raise exception 'missing_notification_id' using errcode = '22023';
  end if;

  with updated as (
    update public.notifications notification
    set
      read_at = coalesce(notification.read_at, safe_read_at),
      updated_at = safe_read_at
    where (
        notification.user_id = safe_profile_id
        or notification.target_user_id = safe_profile_id
      )
      and notification.due_at <= safe_read_at
      and (
        (coalesce(p_all, false) and notification.read_at is null)
        or (not coalesce(p_all, false) and notification.id = safe_notification_id)
      )
    returning notification.id
  )
  select coalesce(jsonb_agg(updated.id order by updated.id), '[]'::jsonb), count(*)::integer
  into notification_ids, affected_count
  from updated;

  return jsonb_build_object(
    'ok', true,
    'all', coalesce(p_all, false),
    'count', affected_count,
    'notificationIds', notification_ids,
    'readAt', safe_read_at
  );
end;
$$;

revoke all on function public.rankball_mark_notifications_read_action(text, text, boolean, timestamptz)
from public, anon, authenticated;
grant execute on function public.rankball_mark_notifications_read_action(text, text, boolean, timestamptz)
to service_role;

create or replace function public.rankball_create_match_terminal_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notice_prefix text;
  notice_title text;
  notice_body text;
  notice_type text;
  notice_action text;
  notice_tone text := 'match';
  now_at timestamptz := now();
begin
  if lower(coalesce(old.status, '')) = lower(coalesce(new.status, '')) then
    return new;
  end if;
  if lower(coalesce(new.status, '')) not in ('cancelled', 'canceled', 'void', 'voided') then
    return new;
  end if;
  if lower(coalesce(new.status, '')) in ('cancelled', 'canceled')
     and coalesce(new.rules->>'recordType', '') = 'solo' then
    return new;
  end if;

  if lower(coalesce(new.status, '')) in ('cancelled', 'canceled') then
    notice_prefix := 'match-cancelled';
    notice_type := 'match_cancelled';
    notice_action := 'cancelMatch';
    notice_title := case
      when coalesce(new.rules->>'recordType', '') = 'match_record' then '기록 취소'
      else '경기 취소'
    end;
    notice_body := case
      when coalesce(new.rules->>'recordType', '') = 'match_record' then format('%s 기록이 취소됐습니다.', new.title)
      else format('%s 경기방이 취소됐습니다.', new.title)
    end;
  else
    notice_prefix := 'match-voided';
    notice_type := 'match_voided';
    notice_action := 'voidMatch';
    notice_title := '경기 무효 처리';
    notice_tone := 'orange';
    notice_body := format(
      '%s 경기가 무효 처리됐습니다.%s',
      new.title,
      case when nullif(btrim(new.void_reason), '') is null then '' else ' 사유: ' || new.void_reason end
    );
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    discord_event, read_at, payload, created_at, updated_at
  )
  select
    'notice-' || notice_prefix || '-' || new.id || '-' || recipient.profile_id,
    recipient.profile_id,
    recipient.profile_id,
    notice_title,
    notice_body,
    notice_tone,
    notice_type,
    new.id,
    'match',
    null,
    jsonb_build_object(
      'matchId', new.id,
      'targetUserId', recipient.profile_id,
      'targetStatus', new.status,
      'targetUnavailable', true,
      'action', notice_action,
      'actionRequired', false,
      'homeAction', false,
      'skipDiscordSync', true,
      'source', 'match_terminal_status_trigger'
    ),
    now_at,
    now_at
  from (
    select distinct nullif(btrim(candidate.profile_id), '') as profile_id
    from (
      select new.created_by as profile_id
      union all select new.referee_id
      union all select new.former_referee_id
      union all select player.user_id from public.match_players player where player.match_id = new.id
      union all
      select reserve_player.profile_id
      from jsonb_each(
        case when jsonb_typeof(new.reserve_players) = 'object' then new.reserve_players else '{}'::jsonb end
      ) reserve_side
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(reserve_side.value) = 'array' then reserve_side.value else '[]'::jsonb end
      ) reserve_player(profile_id)
      union all
      select played_player.profile_id
      from jsonb_each(
        case when jsonb_typeof(new.played_player_ids) = 'object' then new.played_player_ids else '{}'::jsonb end
      ) played_side
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(played_side.value) = 'array' then played_side.value else '[]'::jsonb end
      ) played_player(profile_id)
      union all
      select attendee.profile_id
      from jsonb_each(
        case when jsonb_typeof(new.attendance) = 'object' then new.attendance else '{}'::jsonb end
      ) attendance_side
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(attendance_side.value) = 'array' then attendance_side.value else '[]'::jsonb end
      ) attendee(profile_id)
    ) candidate
  ) recipient
  where recipient.profile_id is not null
  on conflict (id) do update
  set
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    target_user_id = excluded.target_user_id,
    discord_event = excluded.discord_event,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists matches_create_terminal_notifications on public.matches;
create trigger matches_create_terminal_notifications
after update of status on public.matches
for each row
execute function public.rankball_create_match_terminal_notifications();

create or replace function public.rankball_suppress_legacy_match_terminal_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id text := coalesce(nullif(btrim(new.target_user_id), ''), nullif(btrim(new.user_id), ''));
  notice_prefix text;
  canonical_id text;
begin
  if new.match_id is null or recipient_id is null or new.id not like 'n\_%' escape '\' then
    return new;
  end if;
  if coalesce(new.payload->>'action', '') = 'cancelMatch'
     and coalesce(new.payload->>'source', '') = 'match_terminal_action' then
    notice_prefix := 'match-cancelled';
  elsif coalesce(new.payload->>'action', '') = 'voidMatch' then
    notice_prefix := 'match-voided';
  else
    return new;
  end if;

  canonical_id := 'notice-' || notice_prefix || '-' || new.match_id || '-' || recipient_id;
  if exists (select 1 from public.notifications notification where notification.id = canonical_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_suppress_legacy_match_terminal on public.notifications;
create trigger notifications_suppress_legacy_match_terminal
before insert on public.notifications
for each row
execute function public.rankball_suppress_legacy_match_terminal_notification();

revoke all on function public.rankball_create_match_terminal_notifications() from public, anon, authenticated;
revoke all on function public.rankball_suppress_legacy_match_terminal_notification() from public, anon, authenticated;

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)'),
      ('rankball_apply_profile_trust_deltas', 'public.rankball_apply_profile_trust_deltas(text,text,jsonb)'),
      ('rankball_cleanup_room_feed', 'public.rankball_cleanup_room_feed(timestamptz)'),
      ('rankball_confirm_recruiting_match_action', 'public.rankball_confirm_recruiting_match_action(text,text,jsonb,jsonb,jsonb,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'),
      ('rankball_admin_user_operations', 'public.rankball_admin_user_operations(text,integer,integer,integer,text,boolean)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_manual_user_action', 'public.rankball_commit_admin_manual_user_action(text,integer,text,text,integer,text,text)'),
      ('rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)'),
      ('rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)'),
      ('rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()'),
      ('rankball_invite_team_member_4', 'public.rankball_invite_team_member(text,text,text,text)'),
      ('rankball_invite_team_member_5', 'public.rankball_invite_team_member(text,text,text,text,text)'),
      ('rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_match_action_with_rating', 'public.rankball_match_action_with_rating(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)'),
      ('rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)'),
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_dispute_action', 'public.rankball_match_dispute_action(text,text,jsonb)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
      ('rankball_mark_notifications_read_action', 'public.rankball_mark_notifications_read_action(text,text,boolean,timestamptz)'),
      ('rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
      ('rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)'),
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
      ('rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text)'),
      ('rankball_match_thumbs_action', 'public.rankball_match_thumbs_action(text,text,jsonb)'),
      ('rankball_normalize_match_dispute_rows', 'public.rankball_normalize_match_dispute_rows(jsonb,text)'),
      ('rankball_persist_match_snapshot', 'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_persist_recruiting_snapshot', 'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot', 'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)'),
      ('rankball_persist_tournament_snapshot_locked', 'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)'),
      ('rankball_rebuild_profile_match_summary', 'public.rankball_rebuild_profile_match_summary(text)'),
      ('rankball_recruiting_action', 'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_recruiting_applicant_placement_action', 'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)'),
      ('rankball_recruiting_cancel_participation_action', 'public.rankball_recruiting_cancel_participation_action(text,text)'),
      ('rankball_recruiting_close_action', 'public.rankball_recruiting_close_action(text,text)'),
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)'),
      ('rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'),
      ('rankball_recruiting_ready_action', 'public.rankball_recruiting_ready_action(text,text,boolean)'),
      ('rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
      ('rankball_referee_rls_policy_health', 'public.rankball_referee_rls_policy_health()'),
      ('rankball_refresh_all_profile_match_summaries', 'public.rankball_refresh_all_profile_match_summaries()'),
      ('rankball_refresh_profile_match_summaries_for_match', 'public.rankball_refresh_profile_match_summaries_for_match(text)'),
      ('rankball_report_court_request', 'public.rankball_report_court_request(text,text,text)'),
      ('rankball_respond_team_invitation', 'public.rankball_respond_team_invitation(text,text,text)'),
      ('rankball_rls_policy_health', 'public.rankball_rls_policy_health()'),
      ('rankball_submit_court_request', 'public.rankball_submit_court_request(text,jsonb)'),
      ('rankball_submit_court_review', 'public.rankball_submit_court_review(text,jsonb)'),
      ('rankball_sync_team_membership', 'public.rankball_sync_team_membership(text,jsonb,jsonb)')
  ),
  resolved as (
    select function_name, signature, to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'rpc_grant:' || function_name as check_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false) as ok,
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    ) as detail
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_rpc_grant_health() from public;
revoke all on function public.rankball_rpc_grant_health() from anon;
revoke all on function public.rankball_rpc_grant_health() from authenticated;
grant execute on function public.rankball_rpc_grant_health() to service_role;

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

alter table public.rating_policy enable row level security;
revoke all privileges on table public.admin_appointments from anon, authenticated;
revoke all privileges on table public.referee_appointments from anon, authenticated;
revoke all privileges on table public.admin_audit_log from anon, authenticated;
revoke all privileges on table public.admin_disciplinary_actions from anon, authenticated;
revoke all privileges on table public.rating_policy from anon, authenticated;
revoke all privileges on table public.rankball_admin_court_database from anon, authenticated;
revoke all privileges on table public.rankball_admin_court_change_history from anon, authenticated;
grant select, insert, update, delete on table public.admin_appointments to service_role;
grant select, insert, update, delete on table public.referee_appointments to service_role;
grant select, insert, update, delete on table public.admin_audit_log to service_role;
grant select, insert, update, delete on table public.admin_disciplinary_actions to service_role;
grant select, insert, update, delete on table public.rating_policy to service_role;
grant select on table public.rankball_admin_court_database to service_role;
grant select on table public.rankball_admin_court_change_history to service_role;

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

create or replace function public.rankball_scheduled_at_kst(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
  safe_value text := nullif(btrim(p_value), '');
begin
  if safe_value is null then
    return null;
  end if;
  if safe_value ~* '(z|[+-][0-9]{2}:?[0-9]{2})$' then
    return safe_value::timestamptz;
  end if;
  return safe_value::timestamp at time zone 'Asia/Seoul';
exception
  when others then
    return null;
end;
$$;

revoke all on function public.rankball_scheduled_at_kst(text)
from public, anon, authenticated, service_role;

do $patch$
declare
  target record;
  function_def text;
begin
  for target in
    select *
    from (values
      (
        'public.rankball_recruiting_close_action(text,text)',
        'nullif(current_post.scheduled_at, '''')::timestamptz',
        'public.rankball_scheduled_at_kst(current_post.scheduled_at)'
      ),
      (
        'public.rankball_match_terminal_action(text,text,text,text)',
        'nullif(current_match.scheduled_at, '''')::timestamptz',
        'public.rankball_scheduled_at_kst(current_match.scheduled_at)'
      )
    ) values_table(signature, old_fragment, new_fragment)
  loop
    if to_regprocedure(target.signature) is null then
      raise exception 'room_cancel_policy_function_missing: %', target.signature;
    end if;
    function_def := pg_get_functiondef(to_regprocedure(target.signature));
    if strpos(function_def, target.new_fragment) > 0 then
      continue;
    end if;
    if strpos(function_def, target.old_fragment) = 0 then
      raise exception 'room_cancel_policy_schedule_shape_changed: %', target.signature;
    end if;
    execute replace(function_def, target.old_fragment, target.new_fragment);
  end loop;
end;
$patch$;

do $patch$
declare
  signature text;
  start_signature text;
  function_def text;
  old_fragment text := 'if now() < scheduled_at_kst then';
  new_fragment text := 'if now() < scheduled_at_kst - interval ''10 minutes'' then';
begin
  start_signature := case
    when to_regprocedure(
      'public.rankball_match_start_action_pre_server_time(text,text,text,text,jsonb)'
    ) is not null
      then 'public.rankball_match_start_action_pre_server_time(text,text,text,text,jsonb)'
    else 'public.rankball_match_start_action(text,text,text,text,jsonb)'
  end;
  foreach signature in array array[
    'public.rankball_match_checkin_action(text,text,text,text)',
    start_signature
  ]
  loop
    if to_regprocedure(signature) is null then
      raise exception 'match_checkin_window_function_missing: %', signature;
    end if;
    function_def := pg_get_functiondef(to_regprocedure(signature));
    if strpos(function_def, new_fragment) > 0 then
      continue;
    end if;
    if strpos(function_def, old_fragment) = 0 then
      raise exception 'match_checkin_window_shape_changed: %', signature;
    end if;
    execute replace(function_def, old_fragment, new_fragment);
  end loop;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');

do $patch$
declare
  function_signature text := 'public.rankball_match_attendance_qr_action(text,text)';
  function_def text;
  patched_def text;
begin
  if to_regprocedure(function_signature) is null then
    raise exception 'match_attendance_qr_function_missing' using errcode = '42883';
  end if;
  function_def := pg_get_functiondef(to_regprocedure(function_signature));
  if strpos(
    function_def,
    'if (current_match.visibility <> ''public'' and current_match.tournament_id is null)'
  ) = 0 then
    patched_def := regexp_replace(
      function_def,
      'if current_match\.visibility <> ''public''[[:space:]]+or current_match\.tournament_id is not null',
      'if (current_match.visibility <> ''public'' and current_match.tournament_id is null)'
    );
    if patched_def = function_def then
      raise exception 'match_attendance_qr_eligibility_shape_changed' using errcode = '23514';
    end if;
    execute patched_def;
  end if;
end;
$patch$;

update public.matches
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{qrAttendanceEnabled}', 'true'::jsonb, true),
    updated_at = clock_timestamp()
where tournament_id is not null
  and status in ('contract', 'agreed')
  and ended_at is null
  and cancelled_at is null
  and voided_at is null
  and coalesce(nullif(rules->>'recordType', ''), 'match') = 'match'
  and lower(coalesce(rules->>'gameClockEnabled', 'true')) = 'true'
  and lower(coalesce(rules->>'qrAttendanceEnabled', 'false')) <> 'true';

select pg_notify('pgrst', 'reload schema');

-- Current RPC contract snapshot correction.
-- Historical definitions above are preserved; this tail owns the final executable state.
begin;

-- Remove the obsolete rankball_match_action dispatch before its retired
-- reducer entry point is dropped. A changed function shape aborts safely.
do $migration$
declare
  function_signature text :=
    'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)';
  function_def text;
  patched_def text;
  obsolete_branch text := $branch$
  if safe_action in ('handoffMatchRecorder', 'substituteMatchPlayer') and p_match_row ? '__operation' then
    branch_result := public.rankball_match_roster_move_action(
      safe_actor_id,
      safe_action,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,activePlayerId}',
      p_match_row #>> '{__operation,reservePlayerId}',
      p_match_row #>> '{__operation,nextRecorderId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;
$branch$;
begin
  if to_regprocedure(function_signature) is null then
    raise exception 'match_action_function_missing: %', function_signature
      using errcode = '42883';
  end if;

  function_def := pg_get_functiondef(to_regprocedure(function_signature));
  if position('rankball_match_roster_move_action(' in function_def) = 0 then
    if position(
      'handoffMatchRecorder' in function_def
    ) > 0 or position(
      'substituteMatchPlayer' in function_def
    ) > 0 then
      raise exception 'retired_match_action_branch_shape_changed'
        using errcode = '23514';
    end if;
  else
    if position(obsolete_branch in function_def) = 0 then
      raise exception 'retired_match_action_branch_shape_changed'
        using errcode = '23514';
    end if;
    patched_def := replace(function_def, obsolete_branch, '');
    execute patched_def;
    if position(
      'rankball_match_roster_move_action('
      in pg_get_functiondef(to_regprocedure(function_signature))
    ) > 0 then
      raise exception 'retired_match_action_branch_still_present'
        using errcode = '23514';
    end if;
  end if;
end;
$migration$;

-- Grant health is registry-backed so new RPC migrations add one contract row
-- instead of copying and replacing the complete health function.
create table if not exists public.rankball_rpc_contract_registry (
  contract_scope text not null,
  contract_name text not null,
  function_name text not null,
  signature text not null,
  lifecycle text not null default 'active',
  service_role_execute boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (contract_scope, contract_name),
  constraint rankball_rpc_contract_registry_scope_check
    check (contract_scope in ('general', 'authoritative')),
  constraint rankball_rpc_contract_registry_lifecycle_check
    check (lifecycle in ('active', 'retired')),
  constraint rankball_rpc_contract_registry_execute_check
    check (
      (lifecycle = 'active' and service_role_execute = true)
      or (lifecycle = 'retired' and service_role_execute = false)
    )
);

comment on table public.rankball_rpc_contract_registry is
  'Current and retired server RPC execute contracts used by schema health.';

alter table public.rankball_rpc_contract_registry enable row level security;
revoke all on table public.rankball_rpc_contract_registry
  from public, anon, authenticated, service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  ('general', 'rankball_admin_auto_group_nearby_courts', 'rankball_admin_auto_group_nearby_courts', 'public.rankball_admin_auto_group_nearby_courts(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_admin_level_for_profile', 'rankball_admin_level_for_profile', 'public.rankball_admin_level_for_profile(text,integer)', 'active', true),
  ('general', 'rankball_admin_review_court_with_auto_unit', 'rankball_admin_review_court_with_auto_unit', 'public.rankball_admin_review_court_with_auto_unit(text,integer,text,text,jsonb,text)', 'active', true),
  ('general', 'rankball_admin_room_remake_stats', 'rankball_admin_room_remake_stats', 'public.rankball_admin_room_remake_stats(text,integer,text,integer)', 'active', true),
  ('general', 'rankball_admin_update_court_with_auto_unit', 'rankball_admin_update_court_with_auto_unit', 'public.rankball_admin_update_court_with_auto_unit(text,integer,text,jsonb,text)', 'active', true),
  ('general', 'rankball_admin_update_courts_batch_with_auto_unit', 'rankball_admin_update_courts_batch_with_auto_unit', 'public.rankball_admin_update_courts_batch_with_auto_unit(text,integer,jsonb,text)', 'active', true),
  ('general', 'rankball_admin_user_operations', 'rankball_admin_user_operations', 'public.rankball_admin_user_operations(text,integer,integer,integer,text,boolean)', 'active', true),
  ('general', 'rankball_admin_verify_nearby_court_count', 'rankball_admin_verify_nearby_court_count', 'public.rankball_admin_verify_nearby_court_count(text,integer,text,integer,text,jsonb,text)', 'active', true),
  ('general', 'rankball_approve_court_request', 'rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)', 'active', true),
  ('general', 'rankball_apply_court_correction_report', 'rankball_apply_court_correction_report', 'public.rankball_apply_court_correction_report(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_apply_profile_trust_deltas', 'rankball_apply_profile_trust_deltas', 'public.rankball_apply_profile_trust_deltas(text,text,jsonb)', 'active', true),
  ('general', 'rankball_archive_and_cleanup_completed_records', 'rankball_archive_and_cleanup_completed_records', 'public.rankball_archive_and_cleanup_completed_records(integer,timestamptz)', 'active', true),
  ('general', 'rankball_assert_match_actor_active', 'rankball_assert_match_actor_active', 'public.rankball_assert_match_actor_active(text)', 'active', true),
  ('general', 'rankball_assert_tournament_team_snapshot_eligible', 'rankball_assert_tournament_team_snapshot_eligible', 'public.rankball_assert_tournament_team_snapshot_eligible(text,integer,boolean,text,text,jsonb)', 'active', true),
  ('general', 'rankball_cleanup_read_notifications', 'rankball_cleanup_read_notifications', 'public.rankball_cleanup_read_notifications(timestamptz)', 'active', true),
  ('general', 'rankball_cleanup_room_feed', 'rankball_cleanup_room_feed', 'public.rankball_cleanup_room_feed(timestamptz)', 'active', true),
  ('general', 'rankball_cleanup_simulation_artifacts', 'rankball_cleanup_simulation_artifacts', 'public.rankball_cleanup_simulation_artifacts()', 'active', true),
  ('general', 'rankball_cleanup_simulation_artifacts_exact', 'rankball_cleanup_simulation_artifacts_exact', 'public.rankball_cleanup_simulation_artifacts_exact(text[],text[])', 'active', true),
  ('general', 'rankball_cleanup_simulation_notices', 'rankball_cleanup_simulation_notices', 'public.rankball_cleanup_simulation_notices()', 'active', true),
  ('general', 'rankball_cleanup_simulation_recruiting_artifacts', 'rankball_cleanup_simulation_recruiting_artifacts', 'public.rankball_cleanup_simulation_recruiting_artifacts(integer)', 'active', true),
  ('general', 'rankball_confirm_recruiting_match_action', 'rankball_confirm_recruiting_match_action', 'public.rankball_confirm_recruiting_match_action(text,text,jsonb,jsonb,jsonb,timestamptz,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'active', true),
  ('general', 'rankball_commit_admin_appointment_action', 'rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)', 'active', true),
  ('general', 'rankball_commit_admin_disciplinary_action', 'rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)', 'active', true),
  ('general', 'rankball_commit_admin_manual_user_action', 'rankball_commit_admin_manual_user_action', 'public.rankball_commit_admin_manual_user_action(text,integer,text,text,integer,text,text)', 'active', true),
  ('general', 'rankball_commit_admin_review_action', 'rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)', 'active', true),
  ('general', 'rankball_commit_match_rating', 'rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)', 'active', true),
  ('general', 'rankball_court_detail_review_rows', 'rankball_court_detail_review_rows', 'public.rankball_court_detail_review_rows(text,text,integer)', 'active', true),
  ('general', 'rankball_court_reviewable_matches', 'rankball_court_reviewable_matches', 'public.rankball_court_reviewable_matches(text,text,text,integer)', 'active', true),
  ('general', 'rankball_current_recruiting_post_ids', 'rankball_current_recruiting_post_ids', 'public.rankball_current_recruiting_post_ids(text,integer)', 'active', true),
  ('general', 'rankball_delete_team', 'rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)', 'active', true),
  ('general', 'rankball_dispute_window_health', 'rankball_dispute_window_health', 'public.rankball_dispute_window_health()', 'active', true),
  ('general', 'rankball_event_profile_eligible', 'rankball_event_profile_eligible', 'public.rankball_event_profile_eligible(text,boolean,text,numeric,text,jsonb)', 'active', true),
  ('general', 'rankball_event_profile_mmr', 'rankball_event_profile_mmr', 'public.rankball_event_profile_mmr(text)', 'active', true),
  ('general', 'rankball_expire_unconfirmed_recruiting_rooms', 'rankball_expire_unconfirmed_recruiting_rooms', 'public.rankball_expire_unconfirmed_recruiting_rooms(timestamptz)', 'active', true),
  ('general', 'rankball_extend_admin_appointment_action', 'rankball_extend_admin_appointment_action', 'public.rankball_extend_admin_appointment_action(text,integer,text,integer,text)', 'active', true),
  ('general', 'rankball_feed_trigger_health', 'rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()', 'active', true),
  ('general', 'rankball_get_rating_policy', 'rankball_get_rating_policy', 'public.rankball_get_rating_policy(text,integer)', 'active', true),
  ('general', 'rankball_invite_team_member_4', 'rankball_invite_team_member', 'public.rankball_invite_team_member(text,text,text,text)', 'active', true),
  ('general', 'rankball_invite_team_member_5', 'rankball_invite_team_member', 'public.rankball_invite_team_member(text,text,text,text,text)', 'active', true),
  ('general', 'rankball_mark_notifications_read_action', 'rankball_mark_notifications_read_action', 'public.rankball_mark_notifications_read_action(text,text,boolean,timestamptz)', 'active', true),
  ('general', 'rankball_match_action', 'rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'active', true),
  ('general', 'rankball_match_action_with_rating', 'rankball_match_action_with_rating', 'public.rankball_match_action_with_rating(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb,jsonb,jsonb,timestamptz)', 'active', true),
  ('general', 'rankball_match_agree_action', 'rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_approval_action', 'rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_attendance_qr_action', 'rankball_match_attendance_qr_action', 'public.rankball_match_attendance_qr_action(text,text)', 'active', true),
  ('general', 'rankball_match_attendance_resize_action', 'rankball_match_attendance_resize_action', 'public.rankball_match_attendance_resize_action(text,text)', 'active', true),
  ('general', 'rankball_match_auto_finalize_action', 'rankball_match_auto_finalize_action', 'public.rankball_match_auto_finalize_action(text,timestamptz)', 'active', true),
  ('general', 'rankball_match_checkin_action', 'rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_clock_action', 'rankball_match_clock_action', 'public.rankball_match_clock_action(text,text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_confirm_pickup_assignment', 'rankball_match_confirm_pickup_assignment', 'public.rankball_match_confirm_pickup_assignment(text,text,text,integer)', 'active', true),
  ('general', 'rankball_match_dispute_action', 'rankball_match_dispute_action', 'public.rankball_match_dispute_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_end_action', 'rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_generate_pickup_assignment', 'rankball_match_generate_pickup_assignment', 'public.rankball_match_generate_pickup_assignment(text,text,text)', 'active', true),
  ('general', 'rankball_match_late_player_action_legacy', 'rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)', 'retired', false),
  ('general', 'rankball_match_list', 'rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)', 'active', true),
  ('general', 'rankball_match_list_legacy_3arg', 'rankball_match_list', 'public.rankball_match_list(text,integer,text)', 'retired', false),
  ('general', 'rankball_match_overlap_policy_health', 'rankball_match_overlap_policy_health', 'public.rankball_match_overlap_policy_health()', 'active', true),
  ('general', 'rankball_match_room_update_action', 'rankball_match_room_update_action', 'public.rankball_match_room_update_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_roster_move_action_legacy', 'rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)', 'retired', false),
  ('general', 'rankball_match_roster_transition_action', 'rankball_match_roster_transition_action', 'public.rankball_match_roster_transition_action(text,text,text,text,text,text,text,text)', 'active', true),
  ('general', 'rankball_match_rule_ack_action', 'rankball_match_rule_ack_action', 'public.rankball_match_rule_ack_action(text,text,integer)', 'active', true),
  ('general', 'rankball_match_schedule_response_action', 'rankball_match_schedule_response_action', 'public.rankball_match_schedule_response_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_score_increment_action', 'rankball_match_score_increment_action', 'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)', 'active', true),
  ('general', 'rankball_match_score_operation_policy_health', 'rankball_match_score_operation_policy_health', 'public.rankball_match_score_operation_policy_health()', 'active', true),
  ('general', 'rankball_match_star_toggle_action', 'rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)', 'active', true),
  ('general', 'rankball_match_start_action', 'rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_start_action_guarded', 'rankball_match_start_action_guarded', 'public.rankball_match_start_action_guarded(text,text,text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_substitute_action', 'rankball_match_substitute_action', 'public.rankball_match_substitute_action(text,text,text,text,text,text)', 'active', true),
  ('general', 'rankball_match_swap_pickup_players', 'rankball_match_swap_pickup_players', 'public.rankball_match_swap_pickup_players(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_team_roster_action', 'rankball_match_team_roster_action', 'public.rankball_match_team_roster_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_match_terminal_action', 'rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_match_terminal_action_legacy_3arg', 'rankball_match_terminal_action', 'public.rankball_match_terminal_action(text,text,text)', 'retired', false),
  ('general', 'rankball_match_thumbs_action', 'rankball_match_thumbs_action', 'public.rankball_match_thumbs_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_moderate_reported_name', 'rankball_moderate_reported_name', 'public.rankball_moderate_reported_name(text,integer,text,text,text,text,text,text)', 'active', true),
  ('general', 'rankball_moderate_team_emblem', 'rankball_moderate_team_emblem', 'public.rankball_moderate_team_emblem(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_moderate_team_emblem_guarded', 'rankball_moderate_team_emblem_guarded', 'public.rankball_moderate_team_emblem_guarded(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_normalize_match_dispute_rows', 'rankball_normalize_match_dispute_rows', 'public.rankball_normalize_match_dispute_rows(jsonb,text)', 'active', true),
  ('general', 'rankball_persist_match_snapshot', 'rankball_persist_match_snapshot', 'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)', 'active', true),
  ('general', 'rankball_persist_recruiting_snapshot', 'rankball_persist_recruiting_snapshot', 'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_persist_tournament_snapshot', 'rankball_persist_tournament_snapshot', 'public.rankball_persist_tournament_snapshot(jsonb,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_persist_tournament_snapshot_locked', 'rankball_persist_tournament_snapshot_locked', 'public.rankball_persist_tournament_snapshot_locked(jsonb,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_profile_icon_metrics', 'rankball_profile_icon_metrics', 'public.rankball_profile_icon_metrics(text)', 'active', true),
  ('general', 'rankball_profile_icon_verified_metrics', 'rankball_profile_icon_verified_metrics', 'public.rankball_profile_icon_verified_metrics(text)', 'active', true),
  ('general', 'rankball_profile_identity_health', 'rankball_profile_identity_health', 'public.rankball_profile_identity_health()', 'active', true),
  ('general', 'rankball_profile_representative_team_id', 'rankball_profile_representative_team_id', 'public.rankball_profile_representative_team_id(text)', 'active', true),
  ('general', 'rankball_quarantine_simulation_artifacts', 'rankball_quarantine_simulation_artifacts', 'public.rankball_quarantine_simulation_artifacts(timestamptz)', 'active', true),
  ('general', 'rankball_rebuild_profile_match_summary', 'rankball_rebuild_profile_match_summary', 'public.rankball_rebuild_profile_match_summary(text)', 'active', true),
  ('general', 'rankball_recruiting_action', 'rankball_recruiting_action', 'public.rankball_recruiting_action(text,text,jsonb,jsonb,jsonb,timestamptz)', 'active', true),
  ('general', 'rankball_recruiting_applicant_placement_action', 'rankball_recruiting_applicant_placement_action', 'public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)', 'active', true),
  ('general', 'rankball_recruiting_cancel_participation_action', 'rankball_recruiting_cancel_participation_action', 'public.rankball_recruiting_cancel_participation_action(text,text)', 'active', true),
  ('general', 'rankball_recruiting_close_action', 'rankball_recruiting_close_action', 'public.rankball_recruiting_close_action(text,text)', 'active', true),
  ('general', 'rankball_recruiting_close_with_reason_action', 'rankball_recruiting_close_with_reason_action', 'public.rankball_recruiting_close_with_reason_action(text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_expire_room_change', 'rankball_recruiting_expire_room_change', 'public.rankball_recruiting_expire_room_change(text)', 'active', true),
  ('general', 'rankball_recruiting_feed_counts', 'rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)', 'active', true),
  ('general', 'rankball_recruiting_interest_player_action', 'rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)', 'active', true),
  ('general', 'rankball_recruiting_invitation_decision_action', 'rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_invite_players_action', 'rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)', 'active', true),
  ('general', 'rankball_recruiting_ready_action', 'rankball_recruiting_ready_action', 'public.rankball_recruiting_ready_action(text,text,boolean)', 'active', true),
  ('general', 'rankball_recruiting_room_update_action', 'rankball_recruiting_room_update_action', 'public.rankball_recruiting_room_update_action(text,text,jsonb)', 'active', true),
  ('general', 'rankball_recruiting_rule_ack_action', 'rankball_recruiting_rule_ack_action', 'public.rankball_recruiting_rule_ack_action(text,text,integer)', 'active', true),
  ('general', 'rankball_recruiting_schedule_response_action', 'rankball_recruiting_schedule_response_action', 'public.rankball_recruiting_schedule_response_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_set_room_team_action', 'rankball_recruiting_set_room_team_action', 'public.rankball_recruiting_set_room_team_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_side_party_join_action', 'rankball_recruiting_side_party_join_action', 'public.rankball_recruiting_side_party_join_action(text,text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_slot_position_action', 'rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)', 'active', true),
  ('general', 'rankball_recruiting_stat_recorder_action_legacy', 'rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)', 'retired', false),
  ('general', 'rankball_referee_rls_policy_health', 'rankball_referee_rls_policy_health', 'public.rankball_referee_rls_policy_health()', 'active', true),
  ('general', 'rankball_refresh_all_profile_match_summaries', 'rankball_refresh_all_profile_match_summaries', 'public.rankball_refresh_all_profile_match_summaries()', 'active', true),
  ('general', 'rankball_refresh_match_feed_for_match', 'rankball_refresh_match_feed_for_match', 'public.rankball_refresh_match_feed_for_match(text)', 'active', true),
  ('general', 'rankball_refresh_profile_match_summaries_for_match', 'rankball_refresh_profile_match_summaries_for_match', 'public.rankball_refresh_profile_match_summaries_for_match(text)', 'active', true),
  ('general', 'rankball_refresh_recruiting_feed_for_post', 'rankball_refresh_recruiting_feed_for_post', 'public.rankball_refresh_recruiting_feed_for_post(text)', 'active', true),
  ('general', 'rankball_related_active_match_list', 'rankball_related_active_match_list', 'public.rankball_related_active_match_list(text,integer,boolean)', 'active', true),
  ('general', 'rankball_report_court_request', 'rankball_report_court_request', 'public.rankball_report_court_request(text,text,text)', 'active', true),
  ('general', 'rankball_resolve_duplicate_court_report', 'rankball_resolve_duplicate_court_report', 'public.rankball_resolve_duplicate_court_report(text,integer,text,text,text)', 'active', true),
  ('general', 'rankball_respond_team_invitation', 'rankball_respond_team_invitation', 'public.rankball_respond_team_invitation(text,text,text)', 'active', true),
  ('general', 'rankball_restore_team_emblem', 'rankball_restore_team_emblem', 'public.rankball_restore_team_emblem(text,text,text,text)', 'active', true),
  ('general', 'rankball_review_void_match_report', 'rankball_review_void_match_report', 'public.rankball_review_void_match_report(text,integer,text,text,text,text,integer,text,text)', 'active', true),
  ('general', 'rankball_rls_policy_health', 'rankball_rls_policy_health', 'public.rankball_rls_policy_health()', 'active', true),
  ('general', 'rankball_rpc_grant_health', 'rankball_rpc_grant_health', 'public.rankball_rpc_grant_health()', 'active', true),
  ('general', 'rankball_save_profile_icon_settings_6', 'rankball_save_profile_icon_settings', 'public.rankball_save_profile_icon_settings(text,text,text,text,boolean,text)', 'active', true),
  ('general', 'rankball_save_profile_icon_settings_7', 'rankball_save_profile_icon_settings', 'public.rankball_save_profile_icon_settings(text,text,text,text,boolean,boolean,text)', 'active', true),
  ('general', 'rankball_select_profile_icon', 'rankball_select_profile_icon', 'public.rankball_select_profile_icon(text,text)', 'active', true),
  ('general', 'rankball_set_profile_affiliation', 'rankball_set_profile_affiliation', 'public.rankball_set_profile_affiliation(text,text,text)', 'active', true),
  ('general', 'rankball_submit_court_request', 'rankball_submit_court_request', 'public.rankball_submit_court_request(text,jsonb)', 'active', true),
  ('general', 'rankball_submit_court_review', 'rankball_submit_court_review', 'public.rankball_submit_court_review(text,jsonb)', 'active', true),
  ('general', 'rankball_sync_team_membership', 'rankball_sync_team_membership', 'public.rankball_sync_team_membership(text,jsonb,jsonb)', 'active', true),
  ('general', 'rankball_tournament_invitation_health', 'rankball_tournament_invitation_health', 'public.rankball_tournament_invitation_health()', 'active', true),
  ('general', 'rankball_tournament_lineup_deadline_batch_action', 'rankball_tournament_lineup_deadline_batch_action', 'public.rankball_tournament_lineup_deadline_batch_action(timestamptz,integer)', 'active', true),
  ('general', 'rankball_tournament_match_forfeit_action', 'rankball_tournament_match_forfeit_action', 'public.rankball_tournament_match_forfeit_action(text,text,text,text,text)', 'active', true),
  ('general', 'rankball_tournament_start_delivery_health', 'rankball_tournament_start_delivery_health', 'public.rankball_tournament_start_delivery_health()', 'active', true),
  ('general', 'rankball_tournament_team_roster_snapshot', 'rankball_tournament_team_roster_snapshot', 'public.rankball_tournament_team_roster_snapshot(text,integer,boolean,text,text,jsonb)', 'active', true),
  ('general', 'rankball_update_profile_emblem', 'rankball_update_profile_emblem', 'public.rankball_update_profile_emblem(text,text,text,text,text,boolean,text,text)', 'active', true),
  ('general', 'rankball_update_rating_policy', 'rankball_update_rating_policy', 'public.rankball_update_rating_policy(text,integer,integer,jsonb,text)', 'active', true),
  ('general', 'rankball_update_team_emblem', 'rankball_update_team_emblem', 'public.rankball_update_team_emblem(text,text,text,text)', 'active', true),
  ('general', 'rankball_update_team_emblem_design', 'rankball_update_team_emblem_design', 'public.rankball_update_team_emblem_design(text,text,text,boolean,text,text,text,text)', 'active', true),
  ('general', 'rankball_update_team_emblem_source', 'rankball_update_team_emblem_source', 'public.rankball_update_team_emblem_source(text,text,text)', 'active', true),
  ('general', 'rankball_update_team_emblem_style', 'rankball_update_team_emblem_style', 'public.rankball_update_team_emblem_style(text,text,text,boolean,text)', 'active', true),
  ('authoritative', 'rankball_authoritative_rpc_grant_health', 'rankball_authoritative_rpc_grant_health', 'public.rankball_authoritative_rpc_grant_health()', 'active', true),
  ('authoritative', 'rankball_create_tournament_match_locked', 'rankball_create_tournament_match_locked', 'public.rankball_create_tournament_match_locked(text,text,text,integer,integer,text)', 'active', true),
  ('authoritative', 'rankball_expire_recruiting_rooms', 'rankball_expire_recruiting_rooms', 'public.rankball_expire_recruiting_rooms(timestamptz)', 'active', true),
  ('authoritative', 'rankball_match_finalize_locked', 'rankball_match_finalize_locked', 'public.rankball_match_finalize_locked(text,text,text,boolean)', 'active', true),
  ('authoritative', 'rankball_match_finalize_locked_legacy_3arg', 'rankball_match_finalize_locked', 'public.rankball_match_finalize_locked(text,text,text)', 'retired', false),
  ('authoritative', 'rankball_match_referee_absence_action', 'rankball_match_referee_absence_action', 'public.rankball_match_referee_absence_action(text,text,text)', 'active', true),
  ('authoritative', 'rankball_match_result_action', 'rankball_match_result_action', 'public.rankball_match_result_action(text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_match_resolve_dispute_action', 'rankball_match_resolve_dispute_action', 'public.rankball_match_resolve_dispute_action(text,text,text,text,text)', 'active', true),
  ('authoritative', 'rankball_match_resolve_dispute_action_legacy_4arg', 'rankball_match_resolve_dispute_action', 'public.rankball_match_resolve_dispute_action(text,text,text,text)', 'retired', false),
  ('authoritative', 'rankball_match_room_action', 'rankball_match_room_action', 'public.rankball_match_room_action(text,text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_recruiting_management_action', 'rankball_recruiting_management_action', 'public.rankball_recruiting_management_action(text,jsonb)', 'active', true),
  ('authoritative', 'rankball_recruiting_stat_recorder_action_legacy', 'rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)', 'retired', false),
  ('authoritative', 'rankball_tournament_advance_locked', 'rankball_tournament_advance_locked', 'public.rankball_tournament_advance_locked(text)', 'active', true),
  ('authoritative', 'rankball_league_finalize_locked', 'rankball_league_finalize_locked', 'public.rankball_league_finalize_locked(text)', 'active', true),
  ('authoritative', 'rankball_tournament_match_lineup_deadline_action', 'rankball_tournament_match_lineup_deadline_action', 'public.rankball_tournament_match_lineup_deadline_action(text,timestamptz)', 'active', true),
  ('authoritative', 'rankball_tournament_match_roster_action', 'rankball_tournament_match_roster_action', 'public.rankball_tournament_match_roster_action(text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_tournament_match_schedule_action', 'rankball_tournament_match_schedule_action', 'public.rankball_tournament_match_schedule_action(text,text,text,jsonb)', 'active', true),
  ('authoritative', 'rankball_tournament_operation_action', 'rankball_tournament_operation_action', 'public.rankball_tournament_operation_action(text,jsonb)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

create or replace function public.rankball_rpc_contract_health(
  p_contract_scope text
)
returns table(contract_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with resolved as (
    select
      registry.contract_name,
      registry.function_name,
      registry.signature,
      registry.lifecycle,
      registry.service_role_execute,
      to_regprocedure(registry.signature) as proc_oid
    from public.rankball_rpc_contract_registry registry
    where registry.contract_scope = p_contract_scope
  )
  select
    resolved.contract_name,
    case
      when resolved.lifecycle = 'retired' then
        resolved.proc_oid is null
        or (
          not coalesce(has_function_privilege('service_role', resolved.proc_oid, 'execute'), false)
          and not coalesce(has_function_privilege('anon', resolved.proc_oid, 'execute'), false)
          and not coalesce(has_function_privilege('authenticated', resolved.proc_oid, 'execute'), false)
        )
      else
        resolved.proc_oid is not null
        and coalesce(has_function_privilege('service_role', resolved.proc_oid, 'execute'), false)
          = resolved.service_role_execute
        and not coalesce(has_function_privilege('anon', resolved.proc_oid, 'execute'), false)
        and not coalesce(has_function_privilege('authenticated', resolved.proc_oid, 'execute'), false)
    end,
    jsonb_build_object(
      'function', resolved.function_name,
      'signature', resolved.signature,
      'lifecycle', resolved.lifecycle,
      'exists', resolved.proc_oid is not null,
      'expectedServiceRoleExecute', resolved.service_role_execute,
      'anonExecute', coalesce(has_function_privilege('anon', resolved.proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', resolved.proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', resolved.proc_oid, 'execute'), false)
    )
  from resolved
  order by resolved.contract_name;
$$;

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    'rpc_grant:' || contract.contract_name,
    contract.ok,
    contract.detail
  from public.rankball_rpc_contract_health('general') contract

  union all

  select
    'rpc_grant:rankball_rpc_contract_registry_acl',
    catalog.relrowsecurity
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
    jsonb_build_object(
      'table', 'rankball_rpc_contract_registry',
      'rowLevelSecurity', catalog.relrowsecurity,
      'anonSelect', has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select'),
      'authenticatedSelect', has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleSelect', has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleRpcOnly', true
    )
  from pg_catalog.pg_class catalog
  join pg_catalog.pg_namespace namespace
    on namespace.oid = catalog.relnamespace
  where namespace.nspname = 'public'
    and catalog.relname = 'rankball_rpc_contract_registry'
  order by 1;
$$;

create or replace function public.rankball_authoritative_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    'authoritative_rpc_grant:' || contract.contract_name,
    contract.ok,
    contract.detail
  from public.rankball_rpc_contract_health('authoritative') contract
  order by contract.contract_name;
$$;

-- Legacy reject-only signatures. Their definitions may remain for old rows and
-- audit history, but no service path can execute them.
do $migration$
declare
  legacy_signature text;
begin
  foreach legacy_signature in array array[
    'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)',
    'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)',
    'public.rankball_recruiting_stat_recorder_action(text,text,text,text)',
    'public.rankball_match_finalize_locked(text,text,text)',
    'public.rankball_match_resolve_dispute_action(text,text,text,text)',
    'public.rankball_match_terminal_action(text,text,text)',
    'public.rankball_match_list(text,integer,text)'
  ]
  loop
    if to_regprocedure(legacy_signature) is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated, service_role',
        legacy_signature
      );
    end if;
  end loop;
end;
$migration$;

revoke all on function public.rankball_rpc_contract_health(text)
  from public, anon, authenticated, service_role;

revoke all on function public.rankball_rpc_grant_health()
  from public, anon, authenticated;
grant execute on function public.rankball_rpc_grant_health()
  to service_role;

revoke all on function public.rankball_authoritative_rpc_grant_health()
  from public, anon, authenticated;
grant execute on function public.rankball_authoritative_rpc_grant_health()
  to service_role;

select pg_notify('pgrst', 'reload schema');


-- Keep retired contract tombstones after their executable entry points are gone.
insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  (
    'general',
    'rankball_match_scorekeeper_scope_action_legacy',
    'rankball_match_scorekeeper_scope_action',
    'public.rankball_match_scorekeeper_scope_action(text,text,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_match_recorder_takeover_action_legacy',
    'rankball_match_recorder_takeover_action',
    'public.rankball_match_recorder_takeover_action(text,text,text,text,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_match_substitution_action_legacy',
    'rankball_match_substitution_action',
    'public.rankball_match_substitution_action(text,text,text,text,text,text)',
    'retired',
    false
  )
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

-- Exact DROP statements below intentionally omit CASCADE. Any catalog dependency aborts the schema transaction.

-- Exact signatures only. CASCADE is intentionally forbidden so an unknown
-- catalog dependency aborts and rolls back this migration.
drop function if exists public.rankball_match_late_player_action(
  text, text, text, text, jsonb, jsonb, jsonb, jsonb
);
drop function if exists public.rankball_match_roster_move_action(
  text, text, text, text, text, text, text
);
drop function if exists public.rankball_recruiting_stat_recorder_action(
  text, text, text, text
);
drop function if exists public.rankball_match_resolve_dispute_action(
  text, text, text, text
);
drop function if exists public.rankball_match_terminal_action(
  text, text, text
);
drop function if exists public.rankball_match_list(
  text, integer, text
);
drop function if exists public.rankball_match_scorekeeper_scope_action(
  text, text, text
);
drop function if exists public.rankball_match_recorder_takeover_action(
  text, text, text, text, text
);
drop function if exists public.rankball_match_substitution_action(
  text, text, text, text, text, text
);

-- The request table remains an audit archive. Only the retired mutation RPC
-- is removed; no table or row is deleted.
create or replace function public.rankball_match_score_operation_policy_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with checks as (
    select jsonb_build_object(
      'dualScoreRecorderSide', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'matches'
          and column_name = 'dual_score_recorder_side'
      ),
      'scoreRevisionA', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_revision_a'
      ),
      'scoreRevisionB', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_revision_b'
      ),
      'scoreSubmissions', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_submissions'
      ),
      'statMatchCount', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profile_match_summaries'
          and column_name = 'stat_match_count'
      ),
      'scoreEvents', to_regclass('public.match_score_events') is not null,
      'takeoverRequestArchive', to_regclass('public.match_recorder_takeover_requests') is not null,
      'scoreRpc', to_regprocedure(
        'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)'
      ) is not null,
      'latePlayerRpcRetired', to_regprocedure(
        'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'
      ) is null,
      'legacyRosterMoveRpcRetired', to_regprocedure(
        'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'
      ) is null,
      'recruitingStatRecorderRpcRetired', to_regprocedure(
        'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'
      ) is null,
      'legacyDisputeResolutionRpcRetired', to_regprocedure(
        'public.rankball_match_resolve_dispute_action(text,text,text,text)'
      ) is null,
      'legacyTerminalRpcRetired', to_regprocedure(
        'public.rankball_match_terminal_action(text,text,text)'
      ) is null,
      'legacyMatchListRpcRetired', to_regprocedure(
        'public.rankball_match_list(text,integer,text)'
      ) is null,
      'scorekeeperScopeRpcRetired', to_regprocedure(
        'public.rankball_match_scorekeeper_scope_action(text,text,text)'
      ) is null,
      'takeoverRpcRetired', to_regprocedure(
        'public.rankball_match_recorder_takeover_action(text,text,text,text,text)'
      ) is null,
      'legacySubstitutionRpcRetired', to_regprocedure(
        'public.rankball_match_substitution_action(text,text,text,text,text,text)'
      ) is null,
      'statGuard', exists (
        select 1 from pg_trigger
        where tgname = 'rankball_no_referee_player_match_stats_guard' and not tgisinternal
      ),
      'autoFinalizeLocked', case
        when to_regprocedure(
          'public.rankball_match_auto_finalize_action(text,timestamp with time zone)'
        ) is null then false
        else position(
          'match_auto_finalization_locked'
          in pg_get_functiondef(
            to_regprocedure(
              'public.rankball_match_auto_finalize_action(text,timestamp with time zone)'
            )
          )
        ) > 0
      end
    ) as value
  )
  select jsonb_build_object(
    'ok', not exists (
      select 1 from checks, jsonb_each(checks.value) item
      where item.value <> 'true'::jsonb
    ),
    'checks', checks.value
  )
  from checks;
$$;

revoke all on function public.rankball_match_score_operation_policy_health()
  from public, anon, authenticated;
grant execute on function public.rankball_match_score_operation_policy_health()
  to service_role;

select pg_notify('pgrst', 'reload schema');


commit;

begin;

do $patch$
declare
  function_signature text;
  function_def text;
  old_fragment constant text :=
    'if (current_match.visibility <> ''public'' and current_match.tournament_id is null)';
  new_fragment constant text :=
    'if (current_match.visibility not in (''public'', ''private'') and current_match.tournament_id is null)';
  old_resize_fragment constant text :=
    'if current_match.visibility <> ''public''';
  new_resize_fragment constant text :=
    'if current_match.visibility not in (''public'', ''private'')';
  old_record_fragment constant text :=
    'or coalesce(nullif(current_match.rules->>''recordType'', ''''), ''match'') <> ''match''';
  new_record_fragment constant text :=
    'or coalesce(nullif(current_match.rules->>''recordType'', ''''), ''match'') = ''match_record''';
  record_pattern constant text :=
    $pattern$coalesce\([[:space:]]*nullif\([[:space:]]*current_match\.rules[[:space:]]*->[>][[:space:]]*'recordType'(?:::[a-z]+)?[[:space:]]*,[[:space:]]*''(?:::[a-z]+)?[[:space:]]*\)[[:space:]]*,[[:space:]]*'match'(?:::[a-z]+)?[[:space:]]*\)[[:space:]]*<>[[:space:]]*'match'(?:::[a-z]+)?$pattern$;
  patched_def text;
begin
  foreach function_signature in array array[
    'public.rankball_match_attendance_qr_action(text,text)',
    'public.rankball_match_attendance_resize_action(text,text)'
  ]
  loop
    if to_regprocedure(function_signature) is null then
      raise exception 'match_attendance_qr_function_missing: %', function_signature
        using errcode = '42883';
    end if;
    function_def := pg_get_functiondef(to_regprocedure(function_signature));
    if function_signature = 'public.rankball_match_attendance_qr_action(text,text)' then
      if strpos(function_def, new_fragment) = 0 and strpos(function_def, old_fragment) = 0 then
        raise exception 'match_attendance_qr_eligibility_shape_changed: %', function_signature
          using errcode = '23514';
      end if;
      function_def := replace(function_def, old_fragment, new_fragment);
    else
      if strpos(function_def, new_resize_fragment) = 0 and strpos(function_def, old_resize_fragment) = 0 then
        raise exception 'match_attendance_qr_eligibility_shape_changed: %', function_signature
          using errcode = '23514';
      end if;
      function_def := replace(function_def, old_resize_fragment, new_resize_fragment);
    end if;
    if strpos(function_def, 'match_record') = 0 then
      patched_def := regexp_replace(function_def, record_pattern, new_record_fragment);
      if patched_def = function_def then
        raise exception 'match_attendance_qr_record_type_shape_changed: %', function_signature
          using errcode = '23514';
      end if;
      function_def := patched_def;
    end if;
    execute function_def;
  end loop;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');

commit;

-- Final unused legacy RPC entry-point retirement.
begin;

insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  (
    'general',
    'rankball_current_recruiting_post_ids',
    'rankball_current_recruiting_post_ids',
    'public.rankball_current_recruiting_post_ids(text,integer)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_recruiting_ready_action',
    'rankball_recruiting_ready_action',
    'public.rankball_recruiting_ready_action(text,text,boolean)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_update_team_emblem_style',
    'rankball_update_team_emblem_style',
    'public.rankball_update_team_emblem_style(text,text,text,boolean,text)',
    'retired',
    false
  )
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

do $migration$
declare
  blocking_functions text;
begin
  select string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ),
    ', '
    order by proc.proname, proc.oid
  )
  into blocking_functions
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.prokind in ('f', 'p')
    and proc.proname not in (
      'rankball_current_recruiting_post_ids',
      'rankball_recruiting_ready_action',
      'rankball_update_team_emblem_style'
    )
    and (
      position(
        'rankball_current_recruiting_post_ids(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_recruiting_ready_action(' in pg_get_functiondef(proc.oid)
      ) > 0
      or position(
        'rankball_update_team_emblem_style(' in pg_get_functiondef(proc.oid)
      ) > 0
    );

  if blocking_functions is not null then
    raise exception 'unused_legacy_rpc_internal_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

drop function if exists public.rankball_current_recruiting_post_ids(
  text, integer
);
drop function if exists public.rankball_recruiting_ready_action(
  text, text, boolean
);
drop function if exists public.rankball_update_team_emblem_style(
  text, text, text, boolean, text
);

select pg_notify('pgrst', 'reload schema');

commit;

-- Final remaining unused RPC overload retirement.
begin;

insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  (
    'general',
    'rankball_approve_court_request',
    'rankball_approve_court_request',
    'public.rankball_approve_court_request(text,integer,text,jsonb)',
    'active',
    true
  ),
  (
    'general',
    'rankball_approve_court_request_legacy_3arg',
    'rankball_approve_court_request',
    'public.rankball_approve_court_request(text,integer,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_invite_team_member_4',
    'rankball_invite_team_member',
    'public.rankball_invite_team_member(text,text,text,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_save_profile_icon_settings_6',
    'rankball_save_profile_icon_settings',
    'public.rankball_save_profile_icon_settings(text,text,text,text,boolean,text)',
    'retired',
    false
  ),
  (
    'general',
    'rankball_match_terminal_action_pre_cancel_policy_legacy_3arg',
    'rankball_match_terminal_action_pre_cancel_policy',
    'public.rankball_match_terminal_action_pre_cancel_policy(text,text,text)',
    'retired',
    false
  )
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

do $migration$
declare
  target_oids oid[] := array_remove(array[
    to_regprocedure('public.rankball_approve_court_request(text,integer,text)'),
    to_regprocedure('public.rankball_invite_team_member(text,text,text,text)'),
    to_regprocedure('public.rankball_save_profile_icon_settings(text,text,text,text,boolean,text)'),
    to_regprocedure('public.rankball_match_terminal_action_pre_cancel_policy(text,text,text)')
  ], null);
  blocking_functions text;
begin
  select string_agg(
    format(
      '%I.%I(%s)',
      caller_namespace.nspname,
      caller.proname,
      pg_get_function_identity_arguments(caller.oid)
    ),
    ', '
    order by caller.proname, caller.oid
  )
  into blocking_functions
  from pg_depend dependency
  join pg_proc caller on caller.oid = dependency.objid
  join pg_namespace caller_namespace on caller_namespace.oid = caller.pronamespace
  where dependency.refobjid = any(target_oids)
    and caller_namespace.nspname = 'public'
    and caller.oid <> all(target_oids);

  if blocking_functions is not null then
    raise exception 'remaining_legacy_rpc_catalog_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

do $migration$
declare
  blocking_functions text;
  select_icon_definition text;
  terminal_reason_definition text;
begin
  select pg_get_functiondef(
    'public.rankball_select_profile_icon(text,text)'::regprocedure
  )
  into select_icon_definition;
  if position(
    'current_profile.avatar_background_enabled' in select_icon_definition
  ) = 0 then
    raise exception 'current_profile_icon_settings_call_shape_changed'
      using errcode = '2BP01';
  end if;

  select pg_get_functiondef(
    'public.rankball_match_terminal_action_pre_cancel_reason(text,text,text,text)'::regprocedure
  )
  into terminal_reason_definition;
  if position(
    'rankball_match_terminal_action_pre_cancel_policy(' in terminal_reason_definition
  ) = 0
     or position('p_reason' in terminal_reason_definition) = 0
  then
    raise exception 'current_terminal_cancel_policy_call_shape_changed'
      using errcode = '2BP01';
  end if;

  select string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ),
    ', '
    order by proc.proname, proc.oid
  )
  into blocking_functions
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.prokind in ('f', 'p')
    and (
      (
        proc.proname <> 'rankball_approve_court_request'
        and position(
          'rankball_approve_court_request(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname <> 'rankball_invite_team_member'
        and position(
          'rankball_invite_team_member(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname not in (
          'rankball_save_profile_icon_settings',
          'rankball_select_profile_icon'
        )
        and position(
          'rankball_save_profile_icon_settings(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname not in (
          'rankball_match_terminal_action_pre_cancel_policy',
          'rankball_match_terminal_action_pre_cancel_reason'
        )
        and position(
          'rankball_match_terminal_action_pre_cancel_policy('
          in pg_get_functiondef(proc.oid)
        ) > 0
      )
    );

  if blocking_functions is not null then
    raise exception 'remaining_legacy_rpc_internal_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

drop function if exists public.rankball_approve_court_request(
  text, integer, text
);
drop function if exists public.rankball_invite_team_member(
  text, text, text, text
);
drop function if exists public.rankball_save_profile_icon_settings(
  text, text, text, text, boolean, text
);
drop function if exists public.rankball_match_terminal_action_pre_cancel_policy(
  text, text, text
);

revoke all on function public.rankball_approve_court_request(
  text, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.rankball_approve_court_request(
  text, integer, text, jsonb
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;

-- Final internal room-update helper grant hardening.
begin;

do $migration$
declare
  recruiting_helper regprocedure := to_regprocedure(
    'public.rankball_recruiting_room_update_action_pre_change_deadline(text,text,jsonb)'
  );
  match_helper regprocedure := to_regprocedure(
    'public.rankball_match_room_update_action_pre_change_deadline(text,text,jsonb)'
  );
  recruiting_wrapper regprocedure := to_regprocedure(
    'public.rankball_recruiting_room_update_action(text,text,jsonb)'
  );
  match_wrapper regprocedure := to_regprocedure(
    'public.rankball_match_room_update_action(text,text,jsonb)'
  );
begin
  if recruiting_helper is null or match_helper is null then
    raise exception 'room_update_internal_helper_missing'
      using errcode = '42883';
  end if;
  if recruiting_wrapper is null
     or position(
       'rankball_recruiting_room_update_action_pre_change_deadline('
       in pg_get_functiondef(recruiting_wrapper)
     ) = 0
  then
    raise exception 'recruiting_room_update_internal_dependency_missing'
      using errcode = '2BP01';
  end if;
  if match_wrapper is null
     or position(
       'rankball_match_room_update_action_pre_change_deadline('
       in pg_get_functiondef(match_wrapper)
     ) = 0
  then
    raise exception 'match_room_update_internal_dependency_missing'
      using errcode = '2BP01';
  end if;
end;
$migration$;

revoke all on function public.rankball_recruiting_room_update_action_pre_change_deadline(
  text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_room_update_action_pre_change_deadline(
  text, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.rankball_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  select
    'rpc_grant:' || contract.contract_name,
    contract.ok,
    contract.detail
  from public.rankball_rpc_contract_health('general') contract

  union all

  select
    'rpc_grant:rankball_rpc_contract_registry_acl',
    catalog.relrowsecurity
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'insert')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'update')
      and not has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'delete')
      and not has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
    jsonb_build_object(
      'table', 'rankball_rpc_contract_registry',
      'rowLevelSecurity', catalog.relrowsecurity,
      'anonSelect', has_table_privilege('anon', 'public.rankball_rpc_contract_registry', 'select'),
      'authenticatedSelect', has_table_privilege('authenticated', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleSelect', has_table_privilege('service_role', 'public.rankball_rpc_contract_registry', 'select'),
      'serviceRoleRpcOnly', true
    )
  from pg_catalog.pg_class catalog
  join pg_catalog.pg_namespace namespace
    on namespace.oid = catalog.relnamespace
  where namespace.nspname = 'public'
    and catalog.relname = 'rankball_rpc_contract_registry'

  union all

  select
    'rpc_grant:internal_helper:' || helper.name,
    helper.proc_oid is not null
      and not coalesce(has_function_privilege('service_role', helper.proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', helper.proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', helper.proc_oid, 'execute'), false),
    jsonb_build_object(
      'signature', helper.signature,
      'exists', helper.proc_oid is not null,
      'ownerOnly', true,
      'anonExecute', coalesce(has_function_privilege('anon', helper.proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', helper.proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', helper.proc_oid, 'execute'), false)
    )
  from (
    values
      (
        'rankball_match_room_update_action_pre_change_deadline',
        'public.rankball_match_room_update_action_pre_change_deadline(text,text,jsonb)',
        to_regprocedure(
          'public.rankball_match_room_update_action_pre_change_deadline(text,text,jsonb)'
        )
      ),
      (
        'rankball_recruiting_room_update_action_pre_change_deadline',
        'public.rankball_recruiting_room_update_action_pre_change_deadline(text,text,jsonb)',
        to_regprocedure(
          'public.rankball_recruiting_room_update_action_pre_change_deadline(text,text,jsonb)'
        )
      )
  ) helper(name, signature, proc_oid)
  order by 1;
$$;

revoke all on function public.rankball_rpc_grant_health()
  from public, anon, authenticated;
grant execute on function public.rankball_rpc_grant_health()
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;

-- approved_courts is the only live court source.
-- courts remains a read-only archive and is never backfilled or deleted here.

begin;

do $preflight$
declare
  legacy_only_count bigint;
  missing_reference_count bigint;
  deleted_synthetic_residue bigint;
begin
  select count(*)
    into legacy_only_count
  from public.courts legacy
  where not exists (
    select 1
    from public.approved_courts approved
    where approved.id = legacy.id
  );

  if legacy_only_count > 0 then
    raise exception 'legacy_court_without_approved_row count=%', legacy_only_count
      using errcode = '23514';
  end if;

  select count(*)
    into missing_reference_count
  from (
    select match_row.court_id
    from public.matches match_row
    where match_row.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = match_row.court_id
      )
    union all
    select post.court_id
    from public.recruiting_posts post
    where post.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = post.court_id
      )
    union all
    select tournament.court_id
    from public.tournaments tournament
    where tournament.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = tournament.court_id
      )
    union all
    select review.court_id
    from public.court_reviews review
    where review.court_id is not null
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = review.court_id
      )
    union all
    select favorite.target_id
    from public.favorites favorite
    where favorite.target_type = 'court'
      and not exists (
        select 1 from public.approved_courts approved
        where approved.id = favorite.target_id
      )
  ) missing_reference;

  if missing_reference_count > 0 then
    raise exception 'court_reference_without_approved_row count=%', missing_reference_count
      using errcode = '23514';
  end if;

  select count(*)
    into deleted_synthetic_residue
  from (
    select id from public.courts
    where id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select id from public.approved_courts
    where id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.matches
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.recruiting_posts
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.tournaments
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    union all
    select court_id from public.court_reviews
    where court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
  ) residue;

  if deleted_synthetic_residue > 0 then
    raise exception 'deleted_synthetic_court_residue count=%', deleted_synthetic_residue
      using errcode = '23514';
  end if;
end
$preflight$;

do $foreign_keys$
declare
  target_table text;
begin
  select target.relname
    into target_table
  from pg_constraint constraint_row
  join pg_class target on target.oid = constraint_row.confrelid
  where constraint_row.conrelid = 'public.matches'::regclass
    and constraint_row.conname = 'matches_court_id_fkey';

  if target_table = 'courts' then
    alter table public.matches
      add constraint matches_court_id_approved_fkey
      foreign key (court_id) references public.approved_courts(id)
      on delete set null not valid;
    alter table public.matches validate constraint matches_court_id_approved_fkey;
    alter table public.matches drop constraint matches_court_id_fkey;
    alter table public.matches
      rename constraint matches_court_id_approved_fkey to matches_court_id_fkey;
  elsif target_table is distinct from 'approved_courts' then
    raise exception 'unexpected_matches_court_fk_target target=%', target_table
      using errcode = '55000';
  end if;

  select target.relname
    into target_table
  from pg_constraint constraint_row
  join pg_class target on target.oid = constraint_row.confrelid
  where constraint_row.conrelid = 'public.recruiting_posts'::regclass
    and constraint_row.conname = 'recruiting_posts_court_id_fkey';

  if target_table = 'courts' then
    alter table public.recruiting_posts
      add constraint recruiting_posts_court_id_approved_fkey
      foreign key (court_id) references public.approved_courts(id)
      on delete set null not valid;
    alter table public.recruiting_posts
      validate constraint recruiting_posts_court_id_approved_fkey;
    alter table public.recruiting_posts
      drop constraint recruiting_posts_court_id_fkey;
    alter table public.recruiting_posts
      rename constraint recruiting_posts_court_id_approved_fkey
      to recruiting_posts_court_id_fkey;
  elsif target_table is distinct from 'approved_courts' then
    raise exception 'unexpected_recruiting_court_fk_target target=%', target_table
      using errcode = '55000';
  end if;
end
$foreign_keys$;

drop trigger if exists "00_courts_mirror_payload" on public.courts;
drop trigger if exists courts_00_identity_lock on public.courts;
drop trigger if exists courts_identity_guard on public.courts;
drop trigger if exists courts_sync_approved_identity on public.courts;
drop trigger if exists rankball_courts_feed_dependency_refresh on public.courts;
drop trigger if exists rankball_courts_region_key_guard on public.courts;
drop trigger if exists approved_courts_legacy_identity_guard on public.approved_courts;
drop trigger if exists approved_courts_sync_legacy_identity on public.approved_courts;
drop trigger if exists rankball_approved_court_legacy_mirror on public.approved_courts;
drop trigger if exists court_requests_legacy_identity_guard on public.court_requests;
drop trigger if exists rankball_recruiting_court_legacy_mirror on public.recruiting_posts;

drop function if exists public.rankball_sync_approved_court_legacy_mirror();
drop function if exists public.rankball_sync_court_identity_tables();
drop function if exists public.rankball_enforce_legacy_court_identity();
drop function if exists public.rankball_enforce_legacy_court_row_identity();
drop function if exists public.rankball_ensure_recruiting_court_legacy_mirror();
drop function if exists public.rankball_courts_region_key_guard();
drop function if exists public.rankball_mirror_court_payload_guard();

create or replace function public.rankball_court_snapshot(
  p_court_id text,
  p_fallback_name text default null,
  p_fallback_region text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  safe_name text := nullif(btrim(p_fallback_name), '');
  safe_region text := nullif(btrim(p_fallback_region), '');
  safe_region_key text := public.rankball_court_region_key(
    safe_region, null, null, null, '{}'::jsonb
  );
  approved_id text;
  approved_name text;
  approved_region text;
  approved_region_key text;
  candidate_count integer := 0;
begin
  if safe_court_id is not null then
    select
      court.id,
      nullif(btrim(court.name), ''),
      coalesce(
        nullif(btrim(court.sigungu), ''),
        nullif(btrim(court.sido), ''),
        nullif(btrim(court.emd), '')
      ),
      coalesce(
        nullif(btrim(court.region_key), ''),
        public.rankball_court_region_key(
          coalesce(court.sigungu, court.sido, court.emd),
          court.address_text,
          court.road_address,
          court.jibun_address,
          jsonb_strip_nulls(jsonb_build_object(
            'sido', court.sido,
            'sigungu', court.sigungu,
            'addressDong', court.emd
          ))
        )
      )
    into approved_id, approved_name, approved_region, approved_region_key
    from public.approved_courts court
    where court.id = safe_court_id
      and coalesce(court.status, 'active') = 'active'
      and court.hidden_at is null
    limit 1;

    if approved_id is null then
      safe_court_id := null;
    else
      safe_name := coalesce(safe_name, approved_name);
      safe_region_key := coalesce(safe_region_key, approved_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
    end if;
  end if;

  if safe_court_id is null and safe_name is not null then
    select count(*)
      into candidate_count
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and court.hidden_at is null
      and public.rankball_court_name_key(court.name)
        = public.rankball_court_name_key(safe_name)
      and (
        safe_region_key is null
        or coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(
            coalesce(court.sigungu, court.sido, court.emd),
            court.address_text,
            court.road_address,
            court.jibun_address,
            jsonb_strip_nulls(jsonb_build_object(
              'sido', court.sido,
              'sigungu', court.sigungu,
              'addressDong', court.emd
            ))
          )
        ) = safe_region_key
      );

    if candidate_count = 1 then
      select
        court.id,
        nullif(btrim(court.name), ''),
        coalesce(
          nullif(btrim(court.sigungu), ''),
          nullif(btrim(court.sido), ''),
          nullif(btrim(court.emd), '')
        ),
        coalesce(
          nullif(btrim(court.region_key), ''),
          public.rankball_court_region_key(
            coalesce(court.sigungu, court.sido, court.emd),
            court.address_text,
            court.road_address,
            court.jibun_address,
            jsonb_strip_nulls(jsonb_build_object(
              'sido', court.sido,
              'sigungu', court.sigungu,
              'addressDong', court.emd
            ))
          )
        )
      into approved_id, approved_name, approved_region, approved_region_key
      from public.approved_courts court
      where coalesce(court.status, 'active') = 'active'
        and court.hidden_at is null
        and public.rankball_court_name_key(court.name)
          = public.rankball_court_name_key(safe_name)
        and (
          safe_region_key is null
          or coalesce(
            nullif(btrim(court.region_key), ''),
            public.rankball_court_region_key(
              coalesce(court.sigungu, court.sido, court.emd),
              court.address_text,
              court.road_address,
              court.jibun_address,
              jsonb_strip_nulls(jsonb_build_object(
                'sido', court.sido,
                'sigungu', court.sigungu,
                'addressDong', court.emd
              ))
            )
          ) = safe_region_key
        )
      limit 1;
      safe_court_id := approved_id;
      safe_name := coalesce(approved_name, safe_name);
      safe_region_key := coalesce(approved_region_key, safe_region_key);
      safe_region := coalesce(safe_region_key, approved_region, safe_region);
    end if;
  end if;

  return jsonb_build_object(
    'courtId', safe_court_id,
    'courtName', coalesce(safe_name, '미정'),
    'region', coalesce(safe_region_key, safe_region),
    'regionKey', safe_region_key
  );
end;
$$;

create or replace function public.rankball_resolve_approved_court_id(
  p_court_id text,
  p_court_name text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select court.id
  from public.approved_courts court
  where coalesce(court.status, 'active') = 'active'
    and court.hidden_at is null
    and (
      court.id = nullif(btrim(p_court_id), '')
      or (
        nullif(btrim(p_court_name), '') is not null
        and public.rankball_court_name_key(court.name)
          = public.rankball_court_name_key(p_court_name)
      )
    )
  order by
    (court.id = nullif(btrim(p_court_id), '')) desc,
    court.created_at asc
  limit 1;
$$;

create or replace function public.rankball_refresh_court_metrics(p_court_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_court_id text := nullif(btrim(p_court_id), '');
  safe_court_name text;
  global_mean double precision := 3.5;
  raw_average double precision;
  adjusted_average double precision := 3.5;
  safe_review_count integer := 0;
  safe_completed_match_count integer := 0;
  safe_recent_reviews jsonb := '[]'::jsonb;
  safe_recommendation_score double precision := 3.5;
begin
  if safe_court_id is null then return; end if;

  select court.name
    into safe_court_name
  from public.approved_courts court
  where court.id = safe_court_id
    and coalesce(court.status, 'active') = 'active'
    and court.hidden_at is null;
  if safe_court_name is null then return; end if;

  select coalesce(avg(rating::double precision), 3.5)
    into global_mean
  from public.court_reviews
  where coalesce(status, 'active') = 'active';

  select
    count(*)::integer,
    avg(raw_rating),
    (coalesce(sum(adjusted_rating), 0) + (5 * global_mean)) / (count(*) + 5)
  into safe_review_count, raw_average, adjusted_average
  from public.rankball_court_rating_rows()
  where court_id = safe_court_id
    or public.rankball_court_name_key(court_name)
      = public.rankball_court_name_key(safe_court_name);

  select count(*)::integer
    into safe_completed_match_count
  from public.matches
  where (
      court_id = safe_court_id
      or public.rankball_court_name_key(court_name)
        = public.rankball_court_name_key(safe_court_name)
    )
    and status = 'confirmed'
    and coalesce(ended_at, confirmed_at) is not null;

  select coalesce(jsonb_agg(review_item order by sort_at desc), '[]'::jsonb)
    into safe_recent_reviews
  from (
    select
      jsonb_build_object(
        'id', review.review_id,
        'rating', review.raw_rating,
        'adjustedRating', round(review.adjusted_rating::numeric, 1),
        'memo', left(btrim(review.memo), 240),
        'createdAt', review.created_at
      ) as review_item,
      coalesce(review.updated_at, review.created_at) as sort_at
    from public.rankball_court_rating_rows() review
    where (
        review.court_id = safe_court_id
        or public.rankball_court_name_key(review.court_name)
          = public.rankball_court_name_key(safe_court_name)
      )
      and nullif(btrim(review.memo), '') is not null
    order by coalesce(review.updated_at, review.created_at) desc
    limit 3
  ) recent;

  adjusted_average := greatest(
    1.0,
    least(5.0, coalesce(adjusted_average, global_mean))
  );
  safe_recommendation_score := adjusted_average
    + least(0.8, ln(1 + safe_completed_match_count) * 0.2);

  update public.approved_courts
  set
    raw_rating = case
      when safe_review_count > 0 then round(raw_average::numeric, 2)
      else null
    end,
    adjusted_rating = round(adjusted_average::numeric, 2),
    review_count = safe_review_count,
    completed_match_count = safe_completed_match_count,
    recommendation_score = round(safe_recommendation_score::numeric, 3),
    recent_reviews = safe_recent_reviews,
    metrics_updated_at = now()
  where coalesce(status, 'active') = 'active'
    and hidden_at is null
    and (
      id = safe_court_id
      or public.rankball_court_name_key(name)
        = public.rankball_court_name_key(safe_court_name)
    );
end;
$$;

create or replace function public.rankball_refresh_all_court_metrics()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row record;
  refreshed_count integer := 0;
begin
  for court_row in
    select court.id
    from public.approved_courts court
    where coalesce(court.status, 'active') = 'active'
      and court.hidden_at is null
  loop
    perform public.rankball_refresh_court_metrics(court_row.id);
    refreshed_count := refreshed_count + 1;
  end loop;
  return refreshed_count;
end;
$$;

create function pg_temp.rankball_patch_court_function(
  p_target regprocedure,
  p_replacements jsonb
)
returns void
language plpgsql
as $patch_function$
declare
  function_definition text;
  replacement jsonb;
  old_fragment text;
  new_fragment text;
begin
  select replace(pg_get_functiondef(p_target), E'\r\n', E'\n')
    into function_definition;

  if position('public.courts' in function_definition) = 0 then
    return;
  end if;

  for replacement in
    select value from jsonb_array_elements(p_replacements)
  loop
    old_fragment := replace(replacement->>'old', E'\r\n', E'\n');
    new_fragment := replace(coalesce(replacement->>'new', ''), E'\r\n', E'\n');
    if position(old_fragment in function_definition) = 0 then
      raise exception 'legacy_court_function_fragment_changed function=%',
        p_target::text using errcode = '55000';
    end if;
    function_definition := replace(
      function_definition,
      old_fragment,
      new_fragment
    );
  end loop;

  if position('public.courts' in function_definition) > 0 then
    raise exception 'legacy_court_function_reference_remains function=%',
      p_target::text using errcode = '55000';
  end if;

  execute function_definition;
end;
$patch_function$;

select pg_temp.rankball_patch_court_function(
  'public.rankball_apply_osm_court_name_evidence(jsonb,boolean,text)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
      update public.courts
      set name = court_row.name,
          payload = payload || jsonb_build_object(
            'name', court_row.name,
            'canonicalName', court_row.name,
            'canonicalBaseName', court_row.name,
            'baseName', court_row.facility_name,
            'facilityName', court_row.facility_name
          )
      where id = safe_court_id;
$old$,
    'new', ''
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_approve_court_request(text,integer,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  if to_regclass('public.courts') is not null then
    execute $sql$
      insert into public.courts (id, name, region, type, region_key, created_at)
      values (
        $1, $2, coalesce(nullif($3, ''), nullif($4, ''), 'unknown'),
        coalesce(nullif($5, ''), 'outdoor'),
        coalesce(nullif($4, ''), public.rankball_court_region_key($3, $6, $7, $8, $9)), $10
      )
      on conflict (id) do update set
        name = excluded.name,
        region = excluded.region,
        type = excluded.type,
        region_key = excluded.region_key
    $sql$
    using approved_id, approved_name, request_row.payload->>'region',
      public.rankball_court_region_key(request_row.payload->>'region', request_row.address_text, request_row.road_address, request_row.jibun_address, request_row.payload),
      request_row.payload->>'type', request_row.address_text, request_row.road_address,
      request_row.jibun_address, request_row.payload, now_ts;
  end if;
$old$,
    'new', ''
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_import_public_courts(text,text,text,jsonb,boolean)'::regprocedure,
  jsonb_build_array(
    jsonb_build_object(
      'old', $old$
        union all
        select
          'legacy'::text,
          legacy.id,
          legacy.name,
          coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name),
          legacy.address_text,
          legacy.road_address,
          legacy.jibun_address,
          legacy.lat,
          legacy.lng
        from public.courts legacy
        where legacy.id <> safe_id
          and not exists (
            select 1 from public.approved_courts mirrored where mirrored.id = legacy.id
          )
$old$,
      'new', ''
    ),
    jsonb_build_object(
      'old', $old$
          union all
          select coalesce(legacy.payload->>'canonicalBaseName', legacy.payload->>'baseName', legacy.name)
          from public.courts legacy
          where legacy.id <> safe_id
            and not exists (
              select 1 from public.approved_courts mirrored where mirrored.id = legacy.id
            )
            and public.rankball_same_court_location(
              safe_address_text, safe_road_address, safe_jibun_address, safe_lat, safe_lng,
              legacy.address_text, legacy.road_address, legacy.jibun_address, legacy.lat, legacy.lng
            )
$old$,
      'new', ''
    ),
    jsonb_build_object(
      'old', $old$
    if to_regclass('public.courts') is not null then
      execute $legacy$
        insert into public.courts (
          id, name, region, type, region_key, address_text, road_address,
          jibun_address, lat, lng, payload, created_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
        )
        on conflict (id) do update set
          name = excluded.name,
          region = excluded.region,
          type = excluded.type,
          region_key = excluded.region_key,
          address_text = excluded.address_text,
          road_address = excluded.road_address,
          jibun_address = excluded.jibun_address,
          lat = excluded.lat,
          lng = excluded.lng,
          payload = excluded.payload
      $legacy$
      using safe_id, safe_name, safe_region, safe_type, safe_region_key,
        safe_address_text, safe_road_address, safe_jibun_address, safe_lat,
        safe_lng, safe_payload, now_ts;
    end if;
$old$,
      'new', ''
    )
  )
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_quarantine_simulation_artifacts(timestamptz)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  update public.courts court
  set payload = coalesce(court.payload, '{}'::jsonb) || jsonb_build_object(
        'synthetic', true,
        'active', false,
        'quarantinedAt', p_now,
        'quarantineReason', 'simulation_artifact'
      )
  where court.id like 'court\_sim\_%' escape '\'
    and coalesce(court.payload->>'active', 'true') <> 'false';
$old$,
    'new', ''
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_match_room_update_action_pre_change_approval(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  select court.id, court.name, coalesce(court.region_key, court.region)
  into next_court_id, next_court_name, next_court_region
  from public.courts court
  join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
  where court.id = next_court_id;
$old$,
    'new', $new$
  select
    approved.id,
    approved.name,
    coalesce(
      nullif(approved.region_key, ''),
      nullif(approved.sigungu, ''),
      nullif(approved.sido, ''),
      nullif(approved.emd, '')
    )
  into next_court_id, next_court_name, next_court_region
  from public.approved_courts approved
  where approved.id = next_court_id
    and coalesce(approved.status, 'active') = 'active'
    and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_match_room_update_action_pre_edit_once(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
    select court.id, court.name, coalesce(nullif(court.region_key, ''), court.region)
    into target_court_id, target_court_name, target_region
    from public.courts court
    join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
    where court.id = target_court_id;
$old$,
    'new', $new$
    select
      approved.id,
      approved.name,
      coalesce(
        nullif(approved.region_key, ''),
        nullif(approved.sigungu, ''),
        nullif(approved.sido, ''),
        nullif(approved.emd, '')
      )
    into target_court_id, target_court_name, target_region
    from public.approved_courts approved
    where approved.id = target_court_id
      and coalesce(approved.status, 'active') = 'active'
      and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_recruiting_room_update_action_pre_edit_once(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
    select court.id, court.name, coalesce(nullif(court.region_key, ''), court.region)
    into target_court_id, target_court_name, target_region
    from public.courts court
    join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
    where court.id = target_court_id;
$old$,
    'new', $new$
    select
      approved.id,
      approved.name,
      coalesce(
        nullif(approved.region_key, ''),
        nullif(approved.sigungu, ''),
        nullif(approved.sido, ''),
        nullif(approved.emd, '')
      )
    into target_court_id, target_court_name, target_region
    from public.approved_courts approved
    where approved.id = target_court_id
      and coalesce(approved.status, 'active') = 'active'
      and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_recruiting_room_update_action_pre_pickup_resize(text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  select court.id, court.name, coalesce(court.region_key, court.region)
  into next_court_id, next_court_name, next_court_region
  from public.courts court
  join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
  where court.id = next_court_id;
$old$,
    'new', $new$
  select
    approved.id,
    approved.name,
    coalesce(
      nullif(approved.region_key, ''),
      nullif(approved.sigungu, ''),
      nullif(approved.sido, ''),
      nullif(approved.emd, '')
    )
  into next_court_id, next_court_name, next_court_region
  from public.approved_courts approved
  where approved.id = next_court_id
    and coalesce(approved.status, 'active') = 'active'
    and approved.hidden_at is null;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_tournament_match_schedule_action_unrestricted(text,text,text,jsonb)'::regprocedure,
  jsonb_build_array(jsonb_build_object(
    'old', $old$
  select court_source.name
  into safe_court_name
  from (
    select approved.name, 1 as priority
    from public.approved_courts approved
    where approved.id = safe_court_id
      and coalesce(approved.status, 'active') in ('active', 'approved')
      and approved.hidden_at is null
    union all
    select legacy.name, 2 as priority
    from public.courts legacy
    where legacy.id = safe_court_id
  ) court_source
  order by court_source.priority
  limit 1;
$old$,
    'new', $new$
  select approved.name
  into safe_court_name
  from public.approved_courts approved
  where approved.id = safe_court_id
    and coalesce(approved.status, 'active') in ('active', 'approved')
    and approved.hidden_at is null
  limit 1;
$new$
  ))
);

select pg_temp.rankball_patch_court_function(
  'public.rankball_operational_data_health()'::regprocedure,
  jsonb_build_array(
    jsonb_build_object(
      'old', $old$
      union all
      select 'legacy:' || court.id
      from public.courts court
      where court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
$old$,
      'new', ''
    ),
    jsonb_build_object(
      'old', $old$
    left join public.courts court on court.id = match_row.court_id
$old$,
      'new', $new$
    left join public.approved_courts court on court.id = match_row.court_id
$new$
    ),
    jsonb_build_object(
      'old', $old$
    left join public.courts court on court.id = post.court_id
$old$,
      'new', $new$
    left join public.approved_courts court on court.id = post.court_id
$new$
    ),
    jsonb_build_object(
      'old', $old$
    left join public.courts court on court.id = tournament.court_id
$old$,
      'new', $new$
    left join public.approved_courts court on court.id = tournament.court_id
$new$
    ),
    jsonb_build_object(
      'old', $old$
    select 'inactiveFeedSourceMissing' check_name, count(*)::bigint affected_count
    from public.user_room_feed feed
    where not feed.is_active
      and (
        (feed.entity_type = 'match' and not exists (
          select 1 from public.matches match_row where match_row.id = feed.entity_id
        ))
        or (feed.entity_type = 'recruiting' and not exists (
          select 1 from public.recruiting_posts post where post.id = feed.entity_id
        ))
      )
$old$,
      'new', $new$
    select 'inactiveFeedSourceMissing' check_name, count(*)::bigint affected_count
    from public.user_room_feed feed
    where not feed.is_active
      and feed.updated_at < now() - interval '7 days'
      and (
        (feed.entity_type = 'match' and not exists (
          select 1 from public.matches match_row where match_row.id = feed.entity_id
        ))
        or (feed.entity_type = 'recruiting' and not exists (
          select 1 from public.recruiting_posts post where post.id = feed.entity_id
        ))
      )
$new$
    ),
    jsonb_build_object(
      'old', $old$
    select 'quarantinedCardAwaitingRetention', count(*)
    from public.room_feed_cards card
    where card.card_json->>'dataState' = 'quarantined'
$old$,
      'new', $new$
    select 'quarantinedCardAwaitingRetention', count(*)
    from public.room_feed_cards card
    where card.card_json->>'dataState' = 'quarantined'
      and card.updated_at < now() - interval '7 days'
      and not exists (
        select 1
        from public.user_room_feed feed
        where feed.entity_type = card.entity_type
          and feed.entity_id = card.entity_id
          and feed.is_active = true
      )
      and coalesce((
        select max(feed.updated_at)
        from public.user_room_feed feed
        where feed.entity_type = card.entity_type
          and feed.entity_id = card.entity_id
      ), card.updated_at) < now() - interval '7 days'
$new$
    )
  )
);

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

revoke all on function public.rankball_court_snapshot(text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_resolve_approved_court_id(text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_refresh_court_metrics(text)
  from public, anon, authenticated;
revoke all on function public.rankball_refresh_all_court_metrics()
  from public, anon, authenticated;
revoke all on function public.rankball_feed_trigger_health()
  from public, anon, authenticated;
grant execute on function public.rankball_court_snapshot(text, text, text)
  to service_role;
grant execute on function public.rankball_resolve_approved_court_id(text, text)
  to service_role;
grant execute on function public.rankball_refresh_court_metrics(text)
  to service_role;
grant execute on function public.rankball_refresh_all_court_metrics()
  to service_role;
grant execute on function public.rankball_feed_trigger_health()
  to service_role;

revoke all on table public.courts from public, anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.courts from service_role;
grant select on table public.courts to service_role;

comment on table public.courts is
  'Read-only legacy court archive. approved_courts is the only live court source.';
comment on function public.rankball_operational_data_health() is
  'Checks live canonical sources; retention warnings count only rows already eligible for seven-day cleanup.';

select public.rankball_cleanup_room_feed(now());

do $postflight$
declare
  legacy_function_count bigint;
  legacy_trigger_count bigint;
  legacy_fk_count bigint;
begin
  select count(*)
    into legacy_function_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and position('public.courts' in pg_get_functiondef(procedure.oid)) > 0;

  if legacy_function_count > 0 then
    raise exception 'live_function_still_reads_legacy_courts count=%',
      legacy_function_count using errcode = '55000';
  end if;

  select count(*)
    into legacy_trigger_count
  from pg_trigger trigger_row
  where trigger_row.tgrelid = 'public.courts'::regclass
    and not trigger_row.tgisinternal;

  if legacy_trigger_count > 0 then
    raise exception 'legacy_courts_trigger_remains count=%',
      legacy_trigger_count using errcode = '55000';
  end if;

  select count(*)
    into legacy_fk_count
  from pg_constraint constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid = 'public.courts'::regclass;

  if legacy_fk_count > 0 then
    raise exception 'legacy_courts_foreign_key_remains count=%',
      legacy_fk_count using errcode = '55000';
  end if;
end
$postflight$;

commit;

select pg_notify('pgrst', 'reload schema');

-- Final internal legacy RPC wrapper removal.
begin;

-- The public manual-finalization contract stays four-argument. Its owner-only
-- live dispatch no longer routes through the retired three-argument overload.
do $migration$
declare
  target_function regprocedure := to_regprocedure(
    'public.rankball_match_finalize_locked(text,text,text,boolean)'
  );
  function_definition text;
  old_call constant text := $old$  return public.rankball_match_finalize_locked(
    p_actor_profile_id,
    safe_match_id,
    coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );$old$;
  new_call constant text := $new$  return public.rankball_match_live_finalize_action(
    p_actor_profile_id,
    safe_match_id,
    coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );$new$;
begin
  if target_function is null then
    raise exception 'rankball_match_finalize_locked_4arg_missing'
      using errcode = '42883';
  end if;

  function_definition := pg_get_functiondef(target_function);
  if position(new_call in function_definition) = 0 then
    if position(old_call in function_definition) = 0 then
      raise exception 'rankball_match_finalize_locked_4arg_dispatch_shape_changed'
        using errcode = '55000';
    end if;
    execute replace(function_definition, old_call, new_call);
  end if;
end;
$migration$;

-- Convert every remaining internal three-argument finalizer caller before the
-- compatibility router is removed. These callers already resolve a valid
-- host/referee operator and therefore use the owner-only live finalizer.
do $migration$
declare
  target_signature text;
  target_function regprocedure;
  function_definition text;
  legacy_call constant text := 'rankball_match_finalize_locked(';
  live_call constant text := 'rankball_match_live_finalize_action(';
begin
  foreach target_signature in array array[
    'public.rankball_match_auto_finalize_action_pre_record_window(text,timestamptz)',
    'public.rankball_match_resolve_dispute_action_pre_score_policy(text,text,text,text)',
    'public.rankball_review_void_match_report(text,integer,text,text,text,text,integer,text,text)'
  ] loop
    target_function := to_regprocedure(target_signature);
    if target_function is null then
      raise exception 'internal_finalizer_caller_missing: %', target_signature
        using errcode = '42883';
    end if;

    function_definition := pg_get_functiondef(target_function);
    if position(live_call in function_definition) = 0 then
      if position(legacy_call in function_definition) = 0 then
        raise exception 'internal_finalizer_call_shape_changed: %', target_signature
          using errcode = '55000';
      end if;
      execute replace(function_definition, legacy_call, live_call);
    end if;

    if position(
      legacy_call in pg_get_functiondef(target_function)
    ) > 0 then
      raise exception 'internal_finalizer_legacy_call_remains: %', target_signature
        using errcode = '55000';
    end if;
  end loop;
end;
$migration$;

-- Inline the current tournament roster reducer. This preserves the host-side
-- wrapper, representative roster snapshot, and the latest 0..3 bench policy.
create or replace function public.rankball_tournament_match_roster_action(
  p_actor_profile_id text,
  p_match_id text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text;
  current_match public.matches%rowtype;
  tournament_row public.tournaments%rowtype;
  actor_team_id text;
  actor_side text;
  organizer_id text;
  assignment_locked boolean;
  deadline_status text;
  side_team_id text;
  team_mmr numeric;
  capacity integer;
  bench_capacity integer;
  captain_id text;
  eligibility jsonb;
  team_snapshot jsonb;
  requested_active jsonb := '[]'::jsonb;
  requested_reserve jsonb := '[]'::jsonb;
  existing_active jsonb := '[]'::jsonb;
  stale_active jsonb := '[]'::jsonb;
  new_active jsonb := '[]'::jsonb;
  other_side_ids jsonb := '[]'::jsonb;
  reserves jsonb;
  ready_at jsonb;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'match_roster_target_missing' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.tournament_id is null then
    raise exception 'tournament_match_required' using errcode = '23514';
  end if;

  deadline_status := coalesce(
    nullif(current_match.rules->>'lineupDeadlineState', ''),
    'pending'
  );
  if deadline_status <> 'pending' then
    raise exception 'tournament_lineup_deadline_locked' using errcode = '23514';
  end if;

  select member_row.team_id
  into actor_team_id
  from public.team_members member_row
  where member_row.user_id = safe_actor_id
    and member_row.role = 'captain'
    and member_row.team_id in (current_match.team_a_id, current_match.team_b_id)
    and member_row.team_id = public.rankball_profile_representative_team_id(safe_actor_id)
  order by member_row.team_id
  limit 1;
  if actor_team_id is null then
    raise exception 'match_side_captain_required' using errcode = '42501';
  end if;

  actor_side := case
    when actor_team_id = current_match.team_a_id then 'teamA'
    else 'teamB'
  end;
  assignment_locked :=
    coalesce(current_match.rules->>'tournamentSideAssignmentLocked', 'false') = 'true'
    or coalesce(current_match.rules->>'sideAssignmentLocked', 'false') = 'true';

  if not assignment_locked and actor_side = 'teamB' then
    perform public.rankball_tournament_match_swap_pregame_sides(
      safe_match_id,
      now_at
    );
    select * into current_match
    from public.matches
    where id = safe_match_id
    for update;
    actor_side := 'teamA';
  end if;
  safe_side := actor_side;

  if current_match.scheduled_date is null or current_match.scheduled_time is null then
    raise exception 'tournament_schedule_required' using errcode = '23514';
  end if;
  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or exists (
       select 1
       from public.match_results result
       where result.match_id = safe_match_id
     ) then
    raise exception 'match_roster_locked' using errcode = '23514';
  end if;

  select * into tournament_row
  from public.tournaments
  where id = current_match.tournament_id;
  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;

  side_team_id := case
    when safe_side = 'teamA' then current_match.team_a_id
    else current_match.team_b_id
  end;
  select member_row.user_id
  into captain_id
  from public.team_members member_row
  where member_row.team_id = side_team_id
    and member_row.role = 'captain'
  order by member_row.user_id
  limit 1;
  if captain_id is null or captain_id <> safe_actor_id then
    raise exception 'match_side_captain_required' using errcode = '42501';
  end if;
  if public.rankball_profile_representative_team_id(safe_actor_id)
     is distinct from side_team_id then
    raise exception 'tournament_team_representative_required' using errcode = '23514';
  end if;

  capacity := greatest(1, least(5, coalesce(
    (current_match.rules->>'sideCapacity')::integer,
    substring(current_match.mode from '^[0-9]+')::integer,
    5
  )));
  bench_capacity := case
    when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-3]$'
      then (current_match.rules->>'benchCapacity')::integer
    else 2
  end;

  team_snapshot := tournament_row.rules
    #> array['teamRosterSnapshot', 'teams', side_team_id];
  if jsonb_typeof(tournament_row.rules->'teamRosterSnapshot') = 'object'
     and coalesce(jsonb_typeof(team_snapshot), '') <> 'object' then
    raise exception 'tournament_team_snapshot_missing' using errcode = '23514';
  end if;
  if jsonb_typeof(team_snapshot) = 'object' then
    eligibility := jsonb_build_object(
      'eligiblePlayerIds',
      coalesce(team_snapshot->'eligiblePlayerIds', '[]'::jsonb),
      'eligibleCount',
      coalesce((team_snapshot->>'eligibleCount')::integer, 0)
    );
  else
    select coalesce(team_row.mmr, 1200)
    into team_mmr
    from public.teams team_row
    where team_row.id = side_team_id;
    eligibility := public.rankball_assert_team_event_eligible(
      side_team_id,
      capacity,
      current_match.ranked,
      coalesce(
        nullif(current_match.rules->>'mmrLimitMode', ''),
        current_match.mmr_limit_mode
      ),
      team_mmr,
      coalesce(nullif(current_match.rules->>'mmrRangeMode', ''), 'narrow'),
      coalesce(current_match.rules->'allowedAgeGroups', '[]'::jsonb),
      false
    );
  end if;

  select coalesce(jsonb_agg(player_id order by first_order), '[]'::jsonb)
  into requested_active
  from (
    select player_id, min(ordinality)::integer as first_order
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_payload #> '{roster,playerIds}') = 'array'
          then p_payload #> '{roster,playerIds}'
        else '[]'::jsonb
      end
    ) with ordinality player(player_id, ordinality)
    group by player_id
    order by min(ordinality)
  ) selected;

  select coalesce(jsonb_agg(player_id order by first_order), '[]'::jsonb)
  into requested_reserve
  from (
    select player_id, min(ordinality)::integer as first_order
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(p_payload #> '{roster,reservePlayerIds}') = 'array'
          then p_payload #> '{roster,reservePlayerIds}'
        else '[]'::jsonb
      end
    ) with ordinality player(player_id, ordinality)
    group by player_id
    order by min(ordinality)
  ) selected;

  if jsonb_array_length(requested_active) <> capacity then
    raise exception 'team_eligible_roster_insufficient' using errcode = '23514';
  end if;
  if jsonb_array_length(requested_reserve) > bench_capacity then
    raise exception 'match_reserve_full' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(requested_active || requested_reserve)
      player(player_id)
    where not coalesce(eligibility->'eligiblePlayerIds', '[]'::jsonb)
      ? player.player_id
  ) then
    raise exception 'team_roster_player_ineligible' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(requested_reserve) reserve(player_id)
    where requested_active ? reserve.player_id
  ) then
    raise exception 'match_roster_duplicate_player' using errcode = '23514';
  end if;

  reserves := coalesce(
    current_match.reserve_players,
    jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb)
  );
  select coalesce(jsonb_agg(player_row.user_id), '[]'::jsonb)
  into other_side_ids
  from public.match_players player_row
  where player_row.match_id = safe_match_id
    and player_row.side <> safe_side;
  other_side_ids := other_side_ids || coalesce(
    reserves->(
      case when safe_side = 'teamA' then 'teamB' else 'teamA' end
    ),
    '[]'::jsonb
  );
  if exists (
    select 1
    from jsonb_array_elements_text(requested_active || requested_reserve)
      player(player_id)
    where other_side_ids ? player.player_id
  ) then
    raise exception 'match_roster_cross_side_duplicate' using errcode = '23514';
  end if;

  select coalesce(
    jsonb_agg(
      player_row.user_id
      order by player_row.slot_order, player_row.user_id
    ),
    '[]'::jsonb
  )
  into existing_active
  from public.match_players player_row
  where player_row.match_id = safe_match_id
    and player_row.side = safe_side;
  if jsonb_array_length(existing_active) > capacity then
    raise exception 'match_roster_slot_overflow' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(player_id), '[]'::jsonb)
  into stale_active
  from jsonb_array_elements_text(existing_active) player(player_id)
  where not requested_active ? player.player_id;

  select coalesce(jsonb_agg(player_id), '[]'::jsonb)
  into new_active
  from jsonb_array_elements_text(requested_active) player(player_id)
  where not existing_active ? player.player_id;

  if jsonb_array_length(new_active) > 0 then
    for slot_index in 0..jsonb_array_length(new_active) - 1 loop
      if slot_index < jsonb_array_length(stale_active) then
        update public.match_players
        set user_id = new_active->>slot_index,
            team_id = side_team_id
        where match_id = safe_match_id
          and side = safe_side
          and user_id = stale_active->>slot_index;
      else
        insert into public.match_players (
          match_id,
          team_id,
          user_id,
          side,
          slot_order
        )
        values (
          safe_match_id,
          side_team_id,
          new_active->>slot_index,
          safe_side,
          jsonb_array_length(existing_active) + slot_index
        )
        on conflict (match_id, user_id) do update
        set team_id = excluded.team_id,
            side = excluded.side,
            slot_order = excluded.slot_order;
      end if;
    end loop;
  end if;

  update public.match_players player_row
  set slot_order = requested.ordinality::integer - 1,
      team_id = side_team_id
  from jsonb_array_elements_text(requested_active)
    with ordinality requested(player_id, ordinality)
  where player_row.match_id = safe_match_id
    and player_row.user_id = requested.player_id;

  reserves := jsonb_set(reserves, array[safe_side], requested_reserve, true);
  update public.matches match_row
  set reserve_players = reserves,
      played_player_ids = jsonb_set(
        coalesce(match_row.played_player_ids, '{}'::jsonb),
        array[safe_side],
        requested_active,
        true
      ),
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'rosterReady',
        coalesce(match_row.rules->'rosterReady', '{}'::jsonb)
          || jsonb_build_object(safe_side, true)
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  insert into public.match_agreements (match_id, user_id, side)
  select safe_match_id, player_id, safe_side
  from jsonb_array_elements_text(requested_active) player(player_id)
  on conflict (match_id, user_id) do nothing;

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = payload || jsonb_build_object(
        'actionRequired', false,
        'homeAction', false,
        'resolvedAt', now_at
      ),
      updated_at = now_at
  where target_user_id = safe_actor_id
    and match_id = safe_match_id
    and type = 'tournament_match_schedule';

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = payload || jsonb_build_object(
        'stale', true,
        'actionRequired', false
      ),
      updated_at = now_at
  where match_id = safe_match_id
    and type = 'tournament_roster_assignment'
    and payload->>'sideName' = safe_side
    and not (requested_active || requested_reserve) ? target_user_id;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    match_id,
    discord_event,
    read_at,
    payload,
    created_at,
    updated_at
  )
  select
    'tournament-roster-' || substr(
      md5(safe_match_id || ':' || safe_side || ':' || assignment.player_id),
      1,
      24
    ),
    assignment.player_id,
    assignment.player_id,
    '대회 출전 명단',
    case
      when assignment.role_name = 'active'
        then '대회 경기 출전 선수로 배정됐습니다.'
      else '대회 경기 후보 선수로 배정됐습니다.'
    end,
    'match',
    'tournament_roster_assignment',
    safe_match_id,
    'match',
    null,
    jsonb_build_object(
      'targetUserId', assignment.player_id,
      'tournamentId', current_match.tournament_id,
      'matchId', safe_match_id,
      'teamId', side_team_id,
      'sideName', safe_side,
      'rosterRole', assignment.role_name,
      'webPath', '/app/matches?match=' || safe_match_id
    ),
    now_at,
    now_at
  from (
    select player_id, 'active'::text as role_name
    from jsonb_array_elements_text(requested_active) player(player_id)
    union all
    select player_id, 'reserve'::text
    from jsonb_array_elements_text(requested_reserve) player(player_id)
  ) assignment
  on conflict (id) do update
  set body = excluded.body,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

  select tournament.created_by
  into organizer_id
  from public.tournaments tournament
  where tournament.id = current_match.tournament_id;
  organizer_id := coalesce(
    nullif(btrim(current_match.rules->>'tournamentOrganizerId'), ''),
    organizer_id,
    current_match.created_by
  );
  ready_at := coalesce(current_match.rules->'rosterReadyAt', '{}'::jsonb)
    || jsonb_build_object(actor_side, now_at);

  update public.matches match_row
  set created_by = case
        when assignment_locked then match_row.created_by
        else safe_actor_id
      end,
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'tournamentOrganizerId', organizer_id,
        'tournamentHostPlayerId', case
          when assignment_locked then coalesce(
            nullif(match_row.rules->>'tournamentHostPlayerId', ''),
            match_row.created_by
          )
          else safe_actor_id
        end,
        'tournamentHostTeamId', case
          when assignment_locked then coalesce(
            nullif(match_row.rules->>'tournamentHostTeamId', ''),
            match_row.team_a_id
          )
          else actor_team_id
        end,
        'tournamentHostSide', case
          when assignment_locked then coalesce(
            nullif(match_row.rules->>'tournamentHostSide', ''),
            'teamA'
          )
          else 'teamA'
        end,
        'tournamentSideAssignmentLocked', true,
        'sideAssignmentLocked', true,
        'rosterReadyAt', ready_at,
        'lineupDeadlineState', 'pending',
        'lineupDeadlineCheckedAt', null
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setMatchRecordTeamRoster',
    'matchId', safe_match_id,
    'sideName', actor_side,
    'teamId', actor_team_id,
    'activeCount', jsonb_array_length(requested_active),
    'reserveCount', jsonb_array_length(requested_reserve),
    'rosterReady', true,
    'representativeRosterSnapshot', jsonb_typeof(team_snapshot) = 'object',
    'tournamentHostPlayerId', case
      when assignment_locked then current_match.rules->>'tournamentHostPlayerId'
      else safe_actor_id
    end,
    'tournamentHostTeamId', case
      when assignment_locked then current_match.rules->>'tournamentHostTeamId'
      else actor_team_id
    end,
    'tournamentHostSide', 'teamA',
    'sideAssignmentLocked', true,
    'rosterReadyAt', now_at,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

do $migration$
declare
  blocking_functions text;
begin
  if to_regprocedure(
    'public.rankball_match_finalize_locked(text,text,text)'
  ) is null then
    raise exception 'rankball_match_finalize_locked_3arg_missing'
      using errcode = '42883';
  end if;
  if to_regprocedure(
    'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'
  ) is null then
    raise exception 'rankball_tournament_match_roster_action_legacy_missing'
      using errcode = '42883';
  end if;

  select string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ),
    ', '
    order by proc.proname, proc.oid
  )
  into blocking_functions
  from pg_depend dependency
  join pg_proc proc
    on dependency.classid = 'pg_proc'::regclass
   and dependency.objid = proc.oid
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where dependency.refclassid = 'pg_proc'::regclass
    and dependency.refobjid in (
      'public.rankball_match_finalize_locked(text,text,text)'::regprocedure,
      'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure
    );

  if blocking_functions is not null then
    raise exception 'internal_legacy_rpc_catalog_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;

  select string_agg(
    format(
      '%I.%I(%s)',
      namespace.nspname,
      proc.proname,
      pg_get_function_identity_arguments(proc.oid)
    ),
    ', '
    order by proc.proname, proc.oid
  )
  into blocking_functions
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.prokind in ('f', 'p')
    and (
      (
        proc.oid not in (
          'public.rankball_match_finalize_locked(text,text,text)'::regprocedure,
          'public.rankball_match_finalize_locked(text,text,text,boolean)'::regprocedure
        )
        and position(
          'rankball_match_finalize_locked(' in pg_get_functiondef(proc.oid)
        ) > 0
      )
      or (
        proc.proname <> 'rankball_tournament_match_roster_action_legacy'
        and position(
          'rankball_tournament_match_roster_action_legacy('
          in pg_get_functiondef(proc.oid)
        ) > 0
      )
    );

  if blocking_functions is not null then
    raise exception 'internal_legacy_rpc_dependency: %', blocking_functions
      using errcode = '2BP01';
  end if;
end;
$migration$;

revoke all on function public.rankball_match_finalize_locked(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_tournament_match_roster_action_legacy(
  text,
  text,
  jsonb
) from public, anon, authenticated, service_role;

drop function if exists public.rankball_match_finalize_locked(text, text, text);
drop function if exists public.rankball_tournament_match_roster_action_legacy(
  text,
  text,
  jsonb
);

revoke all on function public.rankball_match_finalize_locked(
  text,
  text,
  text,
  boolean
) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(
  text,
  text,
  text,
  boolean
) to service_role;

revoke all on function public.rankball_tournament_match_roster_action(
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.rankball_tournament_match_roster_action(
  text,
  text,
  jsonb
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;

-- Final match-record participant operation reducer.
begin;

create or replace function public.rankball_match_record_participants_action(
  p_actor_profile_id text,
  p_match_id text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  requested_composition text := nullif(btrim(p_payload->>'composition'), '');
  current_composition text;
  current_match public.matches%rowtype;
  side_capacity integer;
  team_a_player_ids jsonb := '[]'::jsonb;
  team_b_player_ids jsonb := '[]'::jsonb;
  target_ids jsonb := '[]'::jsonb;
  selected_team_a_id text;
  selected_team_b_id text;
  team_a_captain_id text;
  team_b_captain_id text;
  setup_ready boolean := false;
  notification_title text;
  notification_body text;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) <> 'match_record' then
    raise exception 'match_record_room_required' using errcode = '23514';
  end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_record_host_required' using errcode = '42501';
  end if;
  if current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null
     or current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or exists (
       select 1
       from public.match_results result
       where result.match_id = safe_match_id
     ) then
    raise exception 'match_record_setup_locked' using errcode = '23514';
  end if;
  if coalesce(current_match.rules->>'recordSetupReady', 'false') = 'true' then
    raise exception 'match_record_roster_locked' using errcode = '23514';
  end if;

  current_composition := case
    when current_match.rules->>'recordComposition' = 'team' then 'team'
    else 'individual'
  end;
  if requested_composition not in ('individual', 'team')
     or requested_composition <> current_composition then
    raise exception 'match_record_composition_invalid' using errcode = '22023';
  end if;

  side_capacity := greatest(1, least(5, coalesce(
    nullif(current_match.rules->>'sideCapacity', '')::integer,
    nullif(substring(current_match.mode from '^[0-9]+'), '')::integer,
    5
  )));

  if current_composition = 'individual' then
    select coalesce(
      jsonb_agg(selected.player_id order by selected.first_order),
      '[]'::jsonb
    )
    into team_a_player_ids
    from (
      select candidate.player_id, min(candidate.ordinality)::integer as first_order
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(p_payload->'teamAPlayerIds') = 'array'
            then p_payload->'teamAPlayerIds'
          else '[]'::jsonb
        end
      ) with ordinality candidate(player_id, ordinality)
      where exists (
        select 1
        from public.profiles profile
        where profile.id = candidate.player_id
      )
      group by candidate.player_id
    ) selected;

    select coalesce(
      jsonb_agg(selected.player_id order by selected.first_order),
      '[]'::jsonb
    )
    into team_b_player_ids
    from (
      select candidate.player_id, min(candidate.ordinality)::integer as first_order
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(p_payload->'teamBPlayerIds') = 'array'
            then p_payload->'teamBPlayerIds'
          else '[]'::jsonb
        end
      ) with ordinality candidate(player_id, ordinality)
      where exists (
        select 1
        from public.profiles profile
        where profile.id = candidate.player_id
      )
      group by candidate.player_id
    ) selected;

    if jsonb_array_length(team_a_player_ids) <> side_capacity
       or jsonb_array_length(team_b_player_ids) <> side_capacity then
      raise exception 'match_record_roster_exact_capacity_required'
        using errcode = '23514';
    end if;
    if not team_a_player_ids ? safe_actor_id then
      raise exception 'match_record_host_side_required' using errcode = '42501';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(team_a_player_ids) player(player_id)
      where team_b_player_ids ? player.player_id
    ) then
      raise exception 'match_roster_cross_side_duplicate' using errcode = '23514';
    end if;

    target_ids := team_a_player_ids || team_b_player_ids;
    setup_ready := true;

    delete from public.match_players
    where match_id = safe_match_id;
    insert into public.match_players (
      match_id,
      team_id,
      user_id,
      side,
      slot_order
    )
    select
      safe_match_id,
      null,
      player.player_id,
      'teamA',
      player.ordinality::integer - 1
    from jsonb_array_elements_text(team_a_player_ids)
      with ordinality player(player_id, ordinality)
    union all
    select
      safe_match_id,
      null,
      player.player_id,
      'teamB',
      player.ordinality::integer - 1
    from jsonb_array_elements_text(team_b_player_ids)
      with ordinality player(player_id, ordinality);
  else
    selected_team_a_id := nullif(btrim(p_payload->>'teamAId'), '');
    selected_team_b_id := nullif(btrim(p_payload->>'teamBId'), '');
    if selected_team_a_id is null
       or selected_team_b_id is null
       or selected_team_a_id = selected_team_b_id
       or not exists (
         select 1
         from public.teams team
         where team.id = selected_team_a_id
           and team.deleted_at is null
       )
       or not exists (
         select 1
         from public.teams team
         where team.id = selected_team_b_id
           and team.deleted_at is null
       ) then
      raise exception 'match_record_team_invalid' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.team_members member
      where member.team_id = selected_team_a_id
        and member.user_id = safe_actor_id
    ) then
      raise exception 'match_record_team_member_required' using errcode = '42501';
    end if;

    select member.user_id
    into team_a_captain_id
    from public.team_members member
    where member.team_id = selected_team_a_id
      and member.role = 'captain'
    order by member.user_id
    limit 1;
    select member.user_id
    into team_b_captain_id
    from public.team_members member
    where member.team_id = selected_team_b_id
      and member.role = 'captain'
    order by member.user_id
    limit 1;
    if team_a_captain_id is null
       or team_b_captain_id is null
       or team_a_captain_id = team_b_captain_id then
      raise exception 'match_record_team_captain_required' using errcode = '23514';
    end if;

    team_a_player_ids := jsonb_build_array(team_a_captain_id);
    team_b_player_ids := jsonb_build_array(team_b_captain_id);
    target_ids := team_a_player_ids || team_b_player_ids;

    delete from public.match_players
    where match_id = safe_match_id;
    insert into public.match_players (
      match_id,
      team_id,
      user_id,
      side,
      slot_order
    )
    values
      (safe_match_id, selected_team_a_id, team_a_captain_id, 'teamA', 0),
      (safe_match_id, selected_team_b_id, team_b_captain_id, 'teamB', 0);
  end if;

  delete from public.match_agreements
  where match_id = safe_match_id;
  insert into public.match_agreements (match_id, user_id, side)
  select safe_match_id, player.player_id, 'teamA'
  from jsonb_array_elements_text(team_a_player_ids) player(player_id)
  union all
  select safe_match_id, player.player_id, 'teamB'
  from jsonb_array_elements_text(team_b_player_ids) player(player_id);

  delete from public.match_approvals
  where match_id = safe_match_id;

  update public.matches match_row
  set team_a_id = case
        when current_composition = 'team' then selected_team_a_id
        else null
      end,
      team_b_id = case
        when current_composition = 'team' then selected_team_b_id
        else null
      end,
      played_player_ids = case
        when current_composition = 'individual'
          then jsonb_build_object(
            'teamA', team_a_player_ids,
            'teamB', team_b_player_ids
          )
        else jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb)
      end,
      reserve_players = jsonb_build_object(
        'teamA', '[]'::jsonb,
        'teamB', '[]'::jsonb
      ),
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'recordSetupReady', setup_ready,
        'recordApprovalMode', jsonb_build_object(
          'teamA', 'all',
          'teamB', 'all'
        ),
        'recordApproverIds', case
          when current_composition = 'individual'
            then jsonb_build_object(
              'teamA', team_a_player_ids,
              'teamB', team_b_player_ids
            )
          else jsonb_build_object(
            'teamA', '[]'::jsonb,
            'teamB', '[]'::jsonb
          )
        end,
        'participantAcceptedIds', '[]'::jsonb,
        'rosterReady', jsonb_build_object(
          'teamA', setup_ready,
          'teamB', setup_ready
        ),
        'playedPlayerIds', case
          when current_composition = 'individual'
            then jsonb_build_object(
              'teamA', team_a_player_ids,
              'teamB', team_b_player_ids
            )
          else jsonb_build_object(
            'teamA', '[]'::jsonb,
            'teamB', '[]'::jsonb
          )
        end,
        'reservePlayers', jsonb_build_object(
          'teamA', '[]'::jsonb,
          'teamB', '[]'::jsonb
        )
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  notification_title := case
    when current_composition = 'team' then '팀 경기 기록 확인'
    else '경기 기록 확인 요청'
  end;
  notification_body := case
    when current_composition = 'team'
      then current_match.title || ' 경기 기록의 팀 명단을 확인해 주세요.'
    else current_match.title
      || ' 경기 기록에 참가자로 등록됐습니다. 기록 입력 후 최종 확인이 필요합니다.'
  end;

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'stale', true,
        'actionRequired', false,
        'homeAction', false
      ),
      updated_at = now_at
  where match_id = safe_match_id
    and type = 'match_record_setup';

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    match_id,
    discord_event,
    read_at,
    payload,
    created_at,
    updated_at
  )
  select
    'match-record-setup-' || substr(
      md5(safe_match_id || ':' || player.player_id),
      1,
      24
    ),
    player.player_id,
    player.player_id,
    notification_title,
    notification_body,
    'match',
    'match_record_setup',
    safe_match_id,
    'match',
    null,
    jsonb_build_object(
      'targetUserId', player.player_id,
      'fromUserId', safe_actor_id,
      'matchId', safe_match_id,
      'discordEvent', 'match',
      'actionRequired', true,
      'homeAction', true,
      'webPath', '/app/recorder?match=' || safe_match_id
    ),
    now_at,
    now_at
  from jsonb_array_elements_text(target_ids) player(player_id)
  where player.player_id <> safe_actor_id
  on conflict (id) do update
  set title = excluded.title,
      body = excluded.body,
      discord_event = excluded.discord_event,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'action', 'setMatchRecordParticipants',
    'matchId', safe_match_id,
    'composition', current_composition,
    'recordSetupReady', setup_ready,
    'teamAPlayerCount', jsonb_array_length(team_a_player_ids),
    'teamBPlayerCount', jsonb_array_length(team_b_player_ids),
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  ('general', 'rankball_match_record_participants_action', 'rankball_match_record_participants_action', 'public.rankball_match_record_participants_action(text,text,jsonb)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

revoke all on function public.rankball_match_record_participants_action(
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.rankball_match_record_participants_action(
  text,
  text,
  jsonb
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
