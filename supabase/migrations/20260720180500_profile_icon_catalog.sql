alter table public.profiles
  add column if not exists avatar_icon_key text;

alter table public.profiles
  drop constraint if exists profiles_avatar_source_check;

alter table public.profiles
  add constraint profiles_avatar_source_check
  check (avatar_source in ('initial', 'discord', 'upload', 'icon'));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_icon_key_check') then
    alter table public.profiles
      add constraint profiles_avatar_icon_key_check
      check (avatar_icon_key is null or avatar_icon_key ~ '^[a-z0-9][a-z0-9-]{0,79}$');
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
  discord_avatar_url,
  avatar_icon_key
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

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
  safe_icon_key text := lower(btrim(coalesce(p_icon_key, '')));
  now_at timestamptz := clock_timestamp();
begin
  select * into current_profile
  from public.profiles
  where id = p_actor_profile_id
  for update;

  if current_profile.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if safe_icon_key <> '01-first-bucket' then
    raise exception 'profile_icon_unavailable' using errcode = '22023';
  end if;

  update public.profiles
  set
    avatar_icon_key = safe_icon_key,
    avatar_source = 'icon',
    avatar_updated_at = now_at,
    updated_at = now_at
  where id = current_profile.id
  returning * into current_profile;

  return jsonb_build_object(
    'ok', true,
    'profileId', current_profile.id,
    'avatarIconKey', current_profile.avatar_icon_key,
    'avatarSource', current_profile.avatar_source,
    'avatarUpdatedAt', current_profile.avatar_updated_at
  );
end;
$$;

revoke all on function public.rankball_select_profile_icon(text, text) from public, anon, authenticated;
grant execute on function public.rankball_select_profile_icon(text, text) to service_role;

drop trigger if exists rankball_profiles_feed_dependency_refresh on public.profiles;
create trigger rankball_profiles_feed_dependency_refresh
after insert or update of id, name, handle, hashtag, position, region, region_sido, region_district, avatar_color, avatar_key, avatar_source, avatar_icon_key, avatar_updated_at, avatar_border_enabled, avatar_border_color, discord_avatar_url or delete
on public.profiles
for each row execute function public.rankball_refresh_profile_feed_dependency_trigger();

select pg_notify('pgrst', 'reload schema');
