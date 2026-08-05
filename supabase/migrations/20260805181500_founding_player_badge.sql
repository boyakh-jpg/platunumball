begin;

alter table public.profiles
  add column if not exists founding_player boolean not null default false;

create or replace function public.rankball_assign_founding_player()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff_at timestamptz;
  signup_at timestamptz;
begin
  if tg_op = 'UPDATE' and old.founding_player then
    new.founding_player := true;
    return new;
  end if;

  select (season.ends_at + 1)::timestamp at time zone 'Asia/Seoul'
  into cutoff_at
  from public.seasons season
  where season.id = 'season-zero';

  select account.created_at
  into signup_at
  from auth.users account
  where account.id = new.auth_user_id;

  new.founding_player := coalesce(
    coalesce(new.onboarding_complete, false)
      and new.test_login_id is null
      and signup_at < cutoff_at
      and now() < cutoff_at,
    false
  );
  return new;
end;
$$;

drop trigger if exists rankball_profiles_founding_player_guard on public.profiles;
create trigger rankball_profiles_founding_player_guard
before insert or update of onboarding_complete, founding_player, auth_user_id, test_login_id
on public.profiles
for each row
execute function public.rankball_assign_founding_player();

revoke insert (founding_player) on public.profiles from anon, authenticated;
revoke update (founding_player) on public.profiles from anon, authenticated;

update public.profiles profile
set founding_player = true
from auth.users account, public.seasons season
where profile.auth_user_id = account.id
  and profile.onboarding_complete
  and profile.test_login_id is null
  and not profile.founding_player
  and season.id = 'season-zero'
  and account.created_at < (season.ends_at + 1)::timestamp at time zone 'Asia/Seoul'
  and now() < (season.ends_at + 1)::timestamp at time zone 'Asia/Seoul';

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
  avatar_background_enabled,
  placement_match_count,
  founding_player
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
