alter table public.profiles
  add column if not exists avatar_key text,
  add column if not exists avatar_source text not null default 'initial',
  add column if not exists avatar_updated_at timestamptz,
  add column if not exists avatar_uploaded_at timestamptz,
  add column if not exists avatar_upload_count integer not null default 0,
  add column if not exists avatar_border_enabled boolean not null default false,
  add column if not exists avatar_border_color text,
  add column if not exists discord_avatar_url text;

alter table public.teams
  add column if not exists emblem_color text,
  add column if not exists emblem_border_enabled boolean not null default true,
  add column if not exists emblem_border_color text,
  add column if not exists emblem_uploaded_at timestamptz,
  add column if not exists emblem_upload_count integer not null default 0;

update public.profiles
set
  avatar_source = 'discord',
  discord_avatar_url = nullif(discord_connection->>'avatarUrl', '')
where coalesce(discord_connection->>'status', '') = 'linked'
  and nullif(discord_connection->>'avatarUrl', '') is not null
  and avatar_key is null
  and avatar_source = 'initial';

update public.teams
set
  emblem_upload_count = greatest(emblem_upload_count, 1),
  emblem_uploaded_at = coalesce(emblem_uploaded_at, emblem_updated_at)
where emblem_key is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_source_check') then
    alter table public.profiles
      add constraint profiles_avatar_source_check
      check (avatar_source in ('initial', 'discord', 'upload'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_key_format_check') then
    alter table public.profiles
      add constraint profiles_avatar_key_format_check
      check (avatar_key is null or avatar_key ~ '^profile-emblems/[A-Za-z0-9_-]{2,128}/[a-f0-9]{24}[.]webp$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_upload_count_check') then
    alter table public.profiles
      add constraint profiles_avatar_upload_count_check
      check (avatar_upload_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_border_color_check') then
    alter table public.profiles
      add constraint profiles_avatar_border_color_check
      check (avatar_border_color is null or avatar_border_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_upload_count_check') then
    alter table public.teams
      add constraint teams_emblem_upload_count_check
      check (emblem_upload_count >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_color_check') then
    alter table public.teams
      add constraint teams_emblem_color_check
      check (emblem_color is null or emblem_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_border_color_check') then
    alter table public.teams
      add constraint teams_emblem_border_color_check
      check (emblem_border_color is null or emblem_border_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

create or replace view public.public_profiles as
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
  updated_at,
  avatar_key,
  avatar_source,
  avatar_updated_at,
  avatar_border_enabled,
  avatar_border_color,
  discord_avatar_url
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

create or replace function public.rankball_update_profile_emblem(
  p_actor_profile_id text,
  p_action text,
  p_avatar_key text,
  p_avatar_source text,
  p_avatar_color text,
  p_border_enabled boolean,
  p_border_color text,
  p_expected_avatar_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
  safe_action text := lower(btrim(coalesce(p_action, '')));
  safe_avatar_key text := nullif(btrim(p_avatar_key), '');
  safe_expected_key text := nullif(btrim(p_expected_avatar_key), '');
  safe_source text := lower(btrim(coalesce(p_avatar_source, 'initial')));
  safe_avatar_color text := lower(btrim(coalesce(p_avatar_color, '#58d2c0')));
  safe_border_color text := lower(btrim(coalesce(p_border_color, '#58d2c0')));
  now_at timestamptz := clock_timestamp();
  next_allowed_at timestamptz;
  next_count integer;
  new_upload boolean := false;
begin
  select * into current_profile
  from public.profiles
  where id = p_actor_profile_id
  for update;

  if current_profile.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if safe_action not in ('upload', 'source', 'style') then
    raise exception 'invalid_profile_emblem_action' using errcode = '22023';
  end if;
  if safe_avatar_color !~ '^#[0-9a-f]{6}$' or safe_border_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_emblem_color' using errcode = '22023';
  end if;

  if safe_action = 'style' then
    update public.profiles
    set
      avatar_color = safe_avatar_color,
      avatar_border_enabled = coalesce(p_border_enabled, false),
      avatar_border_color = safe_border_color,
      updated_at = now_at
    where id = current_profile.id;
  elsif safe_action = 'source' then
    if safe_source not in ('initial', 'discord') then
      raise exception 'invalid_profile_emblem_source' using errcode = '22023';
    end if;
    if current_profile.avatar_key is distinct from safe_expected_key then
      raise exception 'profile_emblem_conflict' using errcode = '40001';
    end if;
    if safe_source = 'discord' and (
      coalesce(current_profile.discord_connection->>'status', '') <> 'linked'
      or nullif(current_profile.discord_avatar_url, '') is null
    ) then
      raise exception 'discord_avatar_unavailable' using errcode = '22023';
    end if;
    update public.profiles
    set
      avatar_key = null,
      avatar_source = safe_source,
      avatar_updated_at = now_at,
      updated_at = now_at
    where id = current_profile.id;
  else
    if current_profile.avatar_key is distinct from safe_expected_key then
      raise exception 'profile_emblem_conflict' using errcode = '40001';
    end if;
    if safe_avatar_key is null
      or position('profile-emblems/' || current_profile.id || '/' in safe_avatar_key) <> 1
      or substring(safe_avatar_key from char_length('profile-emblems/' || current_profile.id || '/') + 1) !~ '^[a-f0-9]{24}[.]webp$' then
      raise exception 'invalid_profile_emblem_key' using errcode = '22023';
    end if;
    new_upload := safe_avatar_key is distinct from current_profile.avatar_key;
    if new_upload and current_profile.avatar_upload_count >= 2 and current_profile.avatar_uploaded_at > now_at - interval '30 days' then
      next_allowed_at := current_profile.avatar_uploaded_at + interval '30 days';
      raise exception 'profile_emblem_cooldown' using errcode = 'P0001', detail = next_allowed_at::text;
    end if;
    next_count := current_profile.avatar_upload_count + case when new_upload then 1 else 0 end;
    update public.profiles
    set
      avatar_key = safe_avatar_key,
      avatar_source = 'upload',
      avatar_updated_at = now_at,
      avatar_uploaded_at = case when new_upload then now_at else avatar_uploaded_at end,
      avatar_upload_count = next_count,
      updated_at = now_at
    where id = current_profile.id;
  end if;

  select * into current_profile from public.profiles where id = current_profile.id;
  next_allowed_at := case
    when current_profile.avatar_upload_count >= 2 and current_profile.avatar_uploaded_at is not null
      then current_profile.avatar_uploaded_at + interval '30 days'
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    'profileId', current_profile.id,
    'avatarKey', current_profile.avatar_key,
    'avatarSource', current_profile.avatar_source,
    'avatarColor', current_profile.avatar_color,
    'avatarUpdatedAt', current_profile.avatar_updated_at,
    'avatarUploadedAt', current_profile.avatar_uploaded_at,
    'avatarUploadCount', current_profile.avatar_upload_count,
    'avatarBorderEnabled', current_profile.avatar_border_enabled,
    'avatarBorderColor', current_profile.avatar_border_color,
    'nextUploadAt', next_allowed_at
  );
end;
$$;

create or replace function public.rankball_update_team_emblem(
  p_actor_profile_id text,
  p_team_id text,
  p_emblem_key text,
  p_expected_emblem_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_team public.teams%rowtype;
  safe_team_id text := btrim(coalesce(p_team_id, ''));
  safe_emblem_key text := nullif(btrim(p_emblem_key), '');
  safe_expected_key text := nullif(btrim(p_expected_emblem_key), '');
  previous_emblem_key text;
  expected_prefix text;
  now_at timestamptz := clock_timestamp();
  next_allowed_at timestamptz;
  new_upload boolean := false;
begin
  select * into current_team
  from public.teams
  where id = safe_team_id
    and deleted_at is null
  for update;

  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = safe_team_id and user_id = p_actor_profile_id and role = 'captain'
  ) then
    raise exception 'team_emblem_permission_denied' using errcode = '42501';
  end if;
  if current_team.emblem_key is distinct from safe_expected_key then
    raise exception 'team_emblem_conflict' using errcode = '40001';
  end if;

  if safe_emblem_key is not null then
    expected_prefix := 'team-emblems/' || safe_team_id || '/';
    if position(expected_prefix in safe_emblem_key) <> 1
      or substring(safe_emblem_key from char_length(expected_prefix) + 1) !~ '^[a-f0-9]{24}[.]webp$' then
      raise exception 'invalid_team_emblem_key' using errcode = '22023';
    end if;
  end if;

  previous_emblem_key := current_team.emblem_key;
  new_upload := safe_emblem_key is not null and safe_emblem_key is distinct from previous_emblem_key;
  if new_upload and current_team.emblem_upload_count >= 2 and current_team.emblem_uploaded_at > now_at - interval '30 days' then
    next_allowed_at := current_team.emblem_uploaded_at + interval '30 days';
    raise exception 'team_emblem_cooldown' using errcode = 'P0001', detail = next_allowed_at::text;
  end if;

  update public.teams
  set
    emblem_key = safe_emblem_key,
    emblem_updated_at = now_at,
    emblem_uploaded_at = case when new_upload then now_at else emblem_uploaded_at end,
    emblem_upload_count = emblem_upload_count + case when new_upload then 1 else 0 end,
    updated_at = now_at
  where id = safe_team_id
  returning * into current_team;

  next_allowed_at := case
    when current_team.emblem_upload_count >= 2 and current_team.emblem_uploaded_at is not null
      then current_team.emblem_uploaded_at + interval '30 days'
    else null
  end;

  return jsonb_build_object(
    'ok', true,
    'teamId', safe_team_id,
    'emblemKey', current_team.emblem_key,
    'emblemUpdatedAt', current_team.emblem_updated_at,
    'emblemUploadedAt', current_team.emblem_uploaded_at,
    'emblemUploadCount', current_team.emblem_upload_count,
    'nextUploadAt', next_allowed_at,
    'previousEmblemKey', previous_emblem_key
  );
end;
$$;

create or replace function public.rankball_update_team_emblem_style(
  p_actor_profile_id text,
  p_team_id text,
  p_emblem_color text,
  p_border_enabled boolean,
  p_border_color text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_team public.teams%rowtype;
  safe_emblem_color text := lower(btrim(coalesce(p_emblem_color, '#f05a46')));
  safe_border_color text := lower(btrim(coalesce(p_border_color, '#f05a46')));
  now_at timestamptz := clock_timestamp();
begin
  select * into current_team
  from public.teams
  where id = btrim(coalesce(p_team_id, '')) and deleted_at is null
  for update;
  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = current_team.id and user_id = p_actor_profile_id and role = 'captain'
  ) then
    raise exception 'team_emblem_permission_denied' using errcode = '42501';
  end if;
  if safe_emblem_color !~ '^#[0-9a-f]{6}$' or safe_border_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_emblem_color' using errcode = '22023';
  end if;

  update public.teams
  set
    emblem_color = safe_emblem_color,
    emblem_border_enabled = coalesce(p_border_enabled, true),
    emblem_border_color = safe_border_color,
    updated_at = now_at
  where id = current_team.id
  returning * into current_team;

  return jsonb_build_object(
    'ok', true,
    'teamId', current_team.id,
    'emblemColor', current_team.emblem_color,
    'emblemBorderEnabled', current_team.emblem_border_enabled,
    'emblemBorderColor', current_team.emblem_border_color
  );
end;
$$;

revoke all on function public.rankball_update_profile_emblem(text, text, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_profile_emblem(text, text, text, text, text, boolean, text, text) to service_role;
revoke all on function public.rankball_update_team_emblem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_emblem(text, text, text, text) to service_role;
revoke all on function public.rankball_update_team_emblem_style(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_emblem_style(text, text, text, boolean, text) to service_role;

drop trigger if exists rankball_profiles_feed_dependency_refresh on public.profiles;
create trigger rankball_profiles_feed_dependency_refresh
after insert or update of id, name, handle, hashtag, position, region, region_sido, region_district, avatar_color, avatar_key, avatar_source, avatar_updated_at, avatar_border_enabled, avatar_border_color, discord_avatar_url or delete
on public.profiles
for each row execute function public.rankball_refresh_profile_feed_dependency_trigger();

drop trigger if exists rankball_teams_feed_dependency_refresh on public.teams;
create trigger rankball_teams_feed_dependency_refresh
after insert or update of id, name, accent, emblem_key, emblem_updated_at, emblem_color, emblem_border_enabled, emblem_border_color, deleted_at or delete
on public.teams
for each row execute function public.rankball_refresh_team_feed_dependency_trigger();

select pg_notify('pgrst', 'reload schema');
