begin;

alter table public.profiles
  add column if not exists withdrawn_at timestamptz;

with invalid_profiles as (
  select
    id,
    '#' || left(coalesce(nullif(regexp_replace(lower(name), '[^[:alnum:]]+', '', 'g'), ''), 'boxtier'), 8)
      || lpad(((hashtextextended(id, 0) & 2147483647) % 10000)::text, 4, '0') as replacement
  from public.profiles
  where char_length(regexp_replace(coalesce(hashtag, handle, ''), '^[@#]+', '')) < 3
)
update public.profiles profile
set handle = invalid.replacement,
    hashtag = invalid.replacement,
    updated_at = clock_timestamp()
from invalid_profiles invalid
where profile.id = invalid.id;

alter table public.profiles
  drop constraint if exists profiles_hashtag_min_length_check;
alter table public.profiles
  add constraint profiles_hashtag_min_length_check
  check (hashtag is null or char_length(regexp_replace(hashtag, '^[@#]+', '')) >= 3);

create index if not exists profiles_withdrawn_at_idx
  on public.profiles (withdrawn_at)
  where withdrawn_at is not null;

create table if not exists public.account_withdrawals (
  identity_hash text primary key check (identity_hash ~ '^[0-9a-f]{64}$'),
  profile_id text not null,
  withdrawn_at timestamptz not null default now(),
  blocked_until timestamptz not null,
  constraint account_withdrawals_block_window_check check (blocked_until > withdrawn_at)
);

alter table public.account_withdrawals enable row level security;
revoke all on public.account_withdrawals from public, anon, authenticated;
grant all on public.account_withdrawals to service_role;

create or replace function public.rankball_withdraw_account(
  p_profile_id text,
  p_auth_user_id uuid,
  p_identity_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  blocked_until_at timestamptz := clock_timestamp() + interval '7 days';
  anonymous_hashtag text := '#gone_' || left(md5(p_profile_id), 12);
begin
  if p_identity_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_account_identity_hash' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_profile_id
      and auth_user_id = p_auth_user_id
      and test_login_id is null
      and withdrawn_at is null
  ) then
    raise exception 'account_withdrawal_profile_mismatch' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.team_members member
    join public.teams team on team.id = member.team_id and team.deleted_at is null
    where member.user_id = p_profile_id and member.role = 'captain'
  ) then
    raise exception 'account_withdrawal_team_captain' using errcode = '23514';
  end if;

  insert into public.account_withdrawals (identity_hash, profile_id, withdrawn_at, blocked_until)
  values (p_identity_hash, p_profile_id, clock_timestamp(), blocked_until_at)
  on conflict (identity_hash) do update set
    profile_id = excluded.profile_id,
    withdrawn_at = excluded.withdrawn_at,
    blocked_until = excluded.blocked_until;

  delete from public.community_post_views where user_id = p_profile_id;
  delete from public.community_post_likes where user_id = p_profile_id;
  delete from public.community_comments where author_id = p_profile_id;
  delete from public.community_posts where author_id = p_profile_id;
  delete from public.favorites where user_id = p_profile_id;
  delete from public.notifications where user_id = p_profile_id or target_user_id = p_profile_id;
  delete from public.discord_notification_deliveries where target_user_id = p_profile_id;
  delete from public.room_chat_messages where user_id = p_profile_id;
  delete from public.team_invitations where from_user_id = p_profile_id or target_user_id = p_profile_id;
  delete from public.recruiting_applications where player_id = p_profile_id;
  delete from public.profile_icon_unlocks where profile_id = p_profile_id;
  delete from public.profile_match_summaries where profile_id = p_profile_id;
  delete from public.team_members where user_id = p_profile_id;

  update public.profiles
  set
    auth_user_id = null,
    name = '탈퇴한 사용자',
    handle = anonymous_hashtag,
    hashtag = anonymous_hashtag,
    birth_year = null,
    age_group = 'open',
    age_group_checked_season = null,
    region = null,
    region_sido = null,
    region_district = null,
    school = '',
    company = '',
    club = '',
    affiliation_id = null,
    discord_connection = null,
    discord_user_id = null,
    discord_avatar_url = null,
    avatar_source = 'initial',
    avatar_icon_key = null,
    app_settings = '{}'::jsonb,
    withdrawn_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_profile_id;

  return jsonb_build_object('ok', true, 'blockedUntil', blocked_until_at);
end;
$$;

revoke all on function public.rankball_withdraw_account(text, uuid, text) from public, anon, authenticated;
grant execute on function public.rankball_withdraw_account(text, uuid, text) to service_role;

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
from public.profiles
where withdrawn_at is null;

grant select on public.public_profiles to anon, authenticated;
select pg_notify('pgrst', 'reload schema');

commit;
