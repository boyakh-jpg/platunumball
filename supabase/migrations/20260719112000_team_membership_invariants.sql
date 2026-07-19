create or replace function public.enforce_team_membership_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || new.team_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || new.user_id, 0));

  if (
    select count(*)
    from public.team_members
    where user_id = new.user_id
      and team_id <> new.team_id
  ) >= 3 then
    raise exception 'team_membership_limit_exceeded' using errcode = '23514';
  end if;

  if (
    select count(*)
    from public.team_members
    where team_id = new.team_id
      and user_id <> new.user_id
  ) >= 10 then
    raise exception 'team_members_limit_exceeded' using errcode = '23514';
  end if;

  return new;
end;
$$;

create unique index if not exists team_members_one_captain_idx
  on public.team_members (team_id)
  where role = 'captain';

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
  safe_actor_profile_id text := nullif(btrim(p_actor_profile_id), '');
  safe_team_id text := nullif(btrim(p_team->>'id'), '');
  member_rows jsonb := coalesce(p_team->'members', '[]'::jsonb);
  member_value jsonb;
  initial_member jsonb;
  safe_member_id text;
  captain_count integer := 0;
  actor_is_captain boolean := false;
  has_existing_members boolean := false;
  notification_value jsonb;
  safe_notification_id text;
  safe_notification_target text;
  existing_notification_target text;
begin
  if safe_actor_profile_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;
  if safe_team_id is null then
    raise exception 'missing_team_id' using errcode = '23502';
  end if;
  if jsonb_typeof(member_rows) <> 'array' then
    raise exception 'invalid_team_members' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_notifications' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || safe_team_id, 0));

  for safe_member_id in
    select distinct nullif(btrim(coalesce(value->>'userId', value->>'user_id')), '')
    from jsonb_array_elements(member_rows)
    where nullif(btrim(coalesce(value->>'userId', value->>'user_id')), '') is not null
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || safe_member_id, 0));
  end loop;

  for member_value in select value from jsonb_array_elements(member_rows)
  loop
    safe_member_id := nullif(btrim(coalesce(member_value->>'userId', member_value->>'user_id')), '');
    if member_value->>'role' = 'captain' then
      captain_count := captain_count + 1;
      actor_is_captain := actor_is_captain or safe_member_id = safe_actor_profile_id;
    end if;
  end loop;

  if captain_count <> 1 or not actor_is_captain then
    raise exception 'team_captain_required' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.team_members where team_id = safe_team_id
  ) into has_existing_members;

  if not has_existing_members then
    if jsonb_array_length(member_rows) <> 1 then
      raise exception 'team_initial_member_must_be_actor_captain' using errcode = '42501';
    end if;
    initial_member := member_rows->0;
    if coalesce(nullif(btrim(initial_member->>'userId'), ''), nullif(btrim(initial_member->>'user_id'), ''), '') <> safe_actor_profile_id
      or coalesce(initial_member->>'role', '') <> 'captain' then
      raise exception 'team_initial_member_must_be_actor_captain' using errcode = '42501';
    end if;
  end if;

  for notification_value in select value from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb))
  loop
    safe_notification_id := nullif(btrim(notification_value->>'id'), '');
    safe_notification_target := coalesce(nullif(btrim(notification_value->>'targetUserId'), ''), safe_actor_profile_id);
    if safe_notification_id is null then
      continue;
    end if;
    if safe_notification_target <> safe_actor_profile_id then
      raise exception 'notification_target_mismatch' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('rankball_notification:' || safe_notification_id, 0));
    select coalesce(nullif(target_user_id, ''), nullif(user_id, ''))
    into existing_notification_target
    from public.notifications
    where id = safe_notification_id;
    if found and existing_notification_target is distinct from safe_actor_profile_id then
      raise exception 'notification_id_conflict' using errcode = '23505';
    end if;
  end loop;

  return public.rankball_sync_team_membership_identity_guard_legacy(
    safe_actor_profile_id,
    p_team,
    p_notifications
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_invite_team_member_notification_guard_legacy(text,text,text,text,text)') is null then
    alter function public.rankball_invite_team_member(text, text, text, text, text)
      rename to rankball_invite_team_member_notification_guard_legacy;
  end if;
end
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
  safe_team_id text := nullif(btrim(p_team_id), '');
  safe_target_user_id text := nullif(btrim(p_target_user_id), '');
  effective_invitation_id text := nullif(btrim(p_invitation_id), '');
  existing_notification_target text;
begin
  if safe_team_id is null or safe_target_user_id is null then
    raise exception 'missing_team_invitation_input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_team_invite:' || safe_team_id || ':' || safe_target_user_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || safe_target_user_id, 0));

  select id
  into effective_invitation_id
  from public.team_invitations
  where team_id = safe_team_id
    and target_user_id = safe_target_user_id
    and status = 'pending'
  order by created_at desc
  limit 1;

  effective_invitation_id := coalesce(
    effective_invitation_id,
    nullif(btrim(p_invitation_id), ''),
    'ti_' || md5(random()::text || clock_timestamp()::text)
  );

  perform pg_advisory_xact_lock(hashtextextended('rankball_notification:n_' || effective_invitation_id, 0));
  select coalesce(nullif(target_user_id, ''), nullif(user_id, ''))
  into existing_notification_target
  from public.notifications
  where id = 'n_' || effective_invitation_id;
  if found and existing_notification_target is distinct from safe_target_user_id then
    raise exception 'notification_id_conflict' using errcode = '23505';
  end if;

  return public.rankball_invite_team_member_notification_guard_legacy(
    p_actor_profile_id,
    safe_team_id,
    safe_target_user_id,
    effective_invitation_id,
    p_role
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_respond_team_invitation_identity_guard_legacy(text,text,text)') is null then
    alter function public.rankball_respond_team_invitation(text, text, text)
      rename to rankball_respond_team_invitation_identity_guard_legacy;
  end if;
end
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
  target_user_id text;
  target_team_id text;
begin
  select invitation.target_user_id, invitation.team_id
  into target_user_id, target_team_id
  from public.team_invitations invitation
  where invitation.id = p_invitation_id;

  if target_team_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || target_team_id, 0));
  end if;
  if target_user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || target_user_id, 0));
  end if;

  return public.rankball_respond_team_invitation_identity_guard_legacy(
    p_actor_profile_id,
    p_invitation_id,
    p_action
  );
end;
$$;

revoke all on function public.enforce_team_membership_limit() from public, anon, authenticated;
revoke all on function public.rankball_sync_team_membership(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_invite_team_member(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_respond_team_invitation(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_sync_team_membership(text, jsonb, jsonb) to service_role;
grant execute on function public.rankball_invite_team_member(text, text, text, text, text) to service_role;
grant execute on function public.rankball_respond_team_invitation(text, text, text) to service_role;
revoke all on function public.rankball_invite_team_member_notification_guard_legacy(text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_respond_team_invitation_identity_guard_legacy(text, text, text) from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
