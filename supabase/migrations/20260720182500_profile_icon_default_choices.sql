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
  default_icon_keys constant text[] := array[
    '01-first-bucket',
    '02-court-rookie',
    '03-laced-up',
    '04-ready-whistle',
    '05-playbook'
  ];
  now_at timestamptz := clock_timestamp();
begin
  select * into current_profile
  from public.profiles
  where id = p_actor_profile_id
  for update;

  if current_profile.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if not (safe_icon_key = any(default_icon_keys)) then
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

select pg_notify('pgrst', 'reload schema');
