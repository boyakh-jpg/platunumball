alter table public.profiles
  add column if not exists avatar_background_enabled boolean not null default true;

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
  discord_avatar_url,
  avatar_icon_key,
  affiliation_id,
  avatar_background_enabled
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

create or replace function public.rankball_save_profile_icon_settings(
  p_actor_profile_id text,
  p_avatar_source text,
  p_avatar_icon_key text,
  p_avatar_color text,
  p_background_enabled boolean,
  p_border_enabled boolean,
  p_border_color text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
  safe_source text := lower(btrim(coalesce(p_avatar_source, 'initial')));
  safe_icon_key text := lower(btrim(coalesce(p_avatar_icon_key, '')));
  safe_avatar_color text := lower(btrim(coalesce(p_avatar_color, '#58d2c0')));
  safe_border_color text := lower(btrim(coalesce(p_border_color, '#58d2c0')));
  now_at timestamptz := clock_timestamp();
begin
  select * into current_profile
  from public.profiles
  where id = p_actor_profile_id
  for update;

  if current_profile.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if safe_source not in ('initial', 'discord', 'icon') then
    raise exception 'invalid_profile_emblem_source' using errcode = '22023';
  end if;
  if safe_avatar_color !~ '^#[0-9a-f]{6}$' or safe_border_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_emblem_color' using errcode = '22023';
  end if;
  if safe_source = 'discord' and (
    coalesce(current_profile.discord_connection->>'status', '') <> 'linked'
    or nullif(current_profile.discord_avatar_url, '') is null
  ) then
    raise exception 'discord_avatar_unavailable' using errcode = '22023';
  end if;
  if safe_source = 'icon' and not exists (
    select 1
    from public.profile_icon_unlocks unlocked
    where unlocked.profile_id = current_profile.id
      and unlocked.icon_key = safe_icon_key
  ) then
    raise exception 'profile_icon_unavailable' using errcode = '22023';
  end if;

  update public.profiles
  set
    avatar_source = safe_source,
    avatar_icon_key = case when safe_source = 'icon' then safe_icon_key else avatar_icon_key end,
    avatar_color = safe_avatar_color,
    avatar_background_enabled = coalesce(p_background_enabled, true),
    avatar_border_enabled = coalesce(p_border_enabled, false),
    avatar_border_color = safe_border_color,
    avatar_updated_at = now_at,
    updated_at = now_at
  where id = current_profile.id
  returning * into current_profile;

  return jsonb_build_object(
    'ok', true,
    'profileId', current_profile.id,
    'avatarSource', current_profile.avatar_source,
    'avatarIconKey', current_profile.avatar_icon_key,
    'avatarColor', current_profile.avatar_color,
    'avatarBackgroundEnabled', current_profile.avatar_background_enabled,
    'avatarBorderEnabled', current_profile.avatar_border_enabled,
    'avatarBorderColor', current_profile.avatar_border_color,
    'avatarUpdatedAt', current_profile.avatar_updated_at
  );
end;
$$;

create or replace function public.rankball_select_profile_icon(
  p_actor_profile_id text,
  p_icon_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
begin
  select * into current_profile
  from public.profiles
  where id = p_actor_profile_id;

  if current_profile.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  return public.rankball_save_profile_icon_settings(
    current_profile.id,
    'icon',
    p_icon_key,
    current_profile.avatar_color,
    current_profile.avatar_background_enabled,
    current_profile.avatar_border_enabled,
    current_profile.avatar_border_color
  );
end;
$$;

revoke all on function public.rankball_save_profile_icon_settings(text, text, text, text, boolean, boolean, text) from public, anon, authenticated;
grant execute on function public.rankball_save_profile_icon_settings(text, text, text, text, boolean, boolean, text) to service_role;
revoke all on function public.rankball_select_profile_icon(text, text) from public, anon, authenticated;
grant execute on function public.rankball_select_profile_icon(text, text) to service_role;

drop trigger if exists rankball_profiles_feed_dependency_refresh on public.profiles;
create trigger rankball_profiles_feed_dependency_refresh
after insert or update of id, name, handle, hashtag, position, region, region_sido, region_district, avatar_color, avatar_key, avatar_source, avatar_icon_key, avatar_updated_at, avatar_background_enabled, avatar_border_enabled, avatar_border_color, discord_avatar_url or delete
on public.profiles
for each row execute function public.rankball_refresh_profile_feed_dependency_trigger();

select pg_notify('pgrst', 'reload schema');
