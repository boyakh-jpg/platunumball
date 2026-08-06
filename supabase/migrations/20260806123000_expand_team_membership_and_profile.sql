begin;

alter table public.teams
  add column if not exists description text not null default '';

alter table public.teams drop constraint if exists teams_description_check;
alter table public.teams
  add constraint teams_description_check
  check (
    char_length(description) <= 300
    and cardinality(regexp_split_to_array(description, E'\\r?\\n')) <= 5
  ) not valid;
alter table public.teams validate constraint teams_description_check;

alter table public.team_invitations
  add column if not exists request_kind text not null default 'invite';

alter table public.team_invitations drop constraint if exists team_invitations_request_kind_check;
alter table public.team_invitations
  add constraint team_invitations_request_kind_check
  check (request_kind in ('invite', 'request')) not valid;
alter table public.team_invitations validate constraint team_invitations_request_kind_check;

create index if not exists team_invitations_kind_status_idx
  on public.team_invitations (team_id, request_kind, status, created_at desc);

create unique index if not exists team_invitations_one_pending_target
  on public.team_invitations (team_id, target_user_id)
  where status = 'pending';

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
  ) >= 30 then
    raise exception 'team_members_limit_exceeded' using errcode = '23514';
  end if;

  return new;
end;
$$;

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
  now_ts timestamptz := clock_timestamp();
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_team_id text := nullif(btrim(p_team->>'id'), '');
  safe_name text := nullif(btrim(regexp_replace(coalesce(p_team->>'name', ''), '\s+', ' ', 'g')), '');
  safe_region text := nullif(btrim(p_team->>'region'), '');
  safe_home_court text := coalesce(nullif(btrim(p_team->>'homeCourt'), ''), nullif(btrim(p_team->>'home_court'), ''));
  safe_accent text := coalesce(nullif(btrim(p_team->>'accent'), ''), '#58d2c0');
  member_values jsonb := coalesce(p_team->'members', '[]'::jsonb);
  member_value jsonb;
  member_ids text[] := array[]::text[];
  safe_member_id text;
  safe_role text;
  member_count integer := 0;
  captain_count integer := 0;
  actor_is_captain boolean := false;
  team_exists boolean := false;
  actor_is_existing_captain boolean := false;
  other_team_count integer;
  notification_value jsonb;
  safe_notification_id text;
  safe_notification_target text;
  existing_notification_target text;
  notification_count integer := 0;
begin
  if safe_actor_id is null or safe_team_id is null then
    raise exception 'missing_team_id' using errcode = '23502';
  end if;
  if safe_name is null or char_length(safe_name) > 14 then
    raise exception 'invalid_team_name' using errcode = '22023';
  end if;
  if jsonb_typeof(member_values) <> 'array' or jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_team_members' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || safe_team_id, 0));
  select exists(select 1 from public.teams where id = safe_team_id and deleted_at is null)
  into team_exists;

  if exists(select 1 from public.teams where id = safe_team_id and deleted_at is not null) then
    raise exception 'team_deleted' using errcode = '42501';
  end if;

  select exists(
    select 1 from public.team_members
    where team_id = safe_team_id and user_id = safe_actor_id and role = 'captain'
  ) into actor_is_existing_captain;

  if team_exists and not actor_is_existing_captain then
    raise exception 'team_sync_permission_denied' using errcode = '42501';
  end if;

  for member_value in
    select value
    from jsonb_array_elements(member_values)
    order by btrim(coalesce(value->>'userId', value->>'user_id'))
  loop
    safe_member_id := nullif(btrim(coalesce(member_value->>'userId', member_value->>'user_id')), '');
    if safe_member_id is null or safe_member_id = any(member_ids) then continue; end if;

    perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || safe_member_id, 0));
    perform 1 from public.profiles where id = safe_member_id;
    if not found then raise exception 'team_member_profile_not_found' using errcode = 'P0002'; end if;
    if team_exists and not exists(
      select 1 from public.team_members where team_id = safe_team_id and user_id = safe_member_id
    ) then
      raise exception 'team_member_invite_required' using errcode = '23514';
    end if;

    select count(*) into other_team_count
    from public.team_members
    where user_id = safe_member_id and team_id <> safe_team_id;
    if other_team_count >= 3 then
      raise exception 'team_membership_limit_exceeded' using errcode = '23514';
    end if;

    safe_role := case
      when member_value->>'role' in ('captain', 'regular', 'mercenary') then member_value->>'role'
      when member_value->>'role' = 'guest' then 'mercenary'
      else 'regular'
    end;
    captain_count := captain_count + case when safe_role = 'captain' then 1 else 0 end;
    actor_is_captain := actor_is_captain or (safe_member_id = safe_actor_id and safe_role = 'captain');
    member_ids := array_append(member_ids, safe_member_id);
  end loop;

  member_count := cardinality(member_ids);
  if member_count < 1 then raise exception 'team_member_required' using errcode = '23502'; end if;
  if member_count > 30 then raise exception 'team_members_limit_exceeded' using errcode = '23514'; end if;
  if captain_count <> 1 or not actor_is_captain then raise exception 'team_captain_required' using errcode = '42501'; end if;
  if not team_exists and (member_count <> 1 or member_ids[1] <> safe_actor_id) then
    raise exception 'team_initial_member_must_be_actor_captain' using errcode = '42501';
  end if;

  insert into public.teams (id, name, region, home_court, mmr, wins, losses, accent, deleted_at, updated_at)
  values (safe_team_id, safe_name, safe_region, safe_home_court, 1200, 0, 0, safe_accent, null, now_ts)
  on conflict (id) do update set
    name = excluded.name,
    region = excluded.region,
    home_court = excluded.home_court,
    accent = excluded.accent,
    deleted_at = null,
    updated_at = excluded.updated_at;

  for member_value in select value from jsonb_array_elements(member_values)
  loop
    safe_member_id := nullif(btrim(coalesce(member_value->>'userId', member_value->>'user_id')), '');
    if safe_member_id is null or not (safe_member_id = any(member_ids)) then continue; end if;
    safe_role := case
      when member_value->>'role' in ('captain', 'regular', 'mercenary') then member_value->>'role'
      when member_value->>'role' = 'guest' then 'mercenary'
      else 'regular'
    end;
    insert into public.team_members (team_id, user_id, role)
    values (safe_team_id, safe_member_id, safe_role)
    on conflict (team_id, user_id) do update set role = excluded.role;
  end loop;

  delete from public.team_members
  where team_id = safe_team_id and not (user_id = any(member_ids));

  for notification_value in select value from jsonb_array_elements(coalesce(p_notifications, '[]'::jsonb))
  loop
    safe_notification_id := nullif(btrim(notification_value->>'id'), '');
    safe_notification_target := coalesce(nullif(btrim(notification_value->>'targetUserId'), ''), safe_actor_id);
    if safe_notification_id is null then continue; end if;
    if safe_notification_target <> safe_actor_id then raise exception 'notification_target_mismatch' using errcode = '42501'; end if;

    select coalesce(nullif(target_user_id, ''), nullif(user_id, '')) into existing_notification_target
    from public.notifications where id = safe_notification_id;
    if found and existing_notification_target is distinct from safe_actor_id then
      raise exception 'notification_id_conflict' using errcode = '23505';
    end if;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id, recruiting_post_id,
      invitation_id, discord_event, read_at, payload, created_at, updated_at
    ) values (
      safe_notification_id, safe_actor_id, safe_actor_id,
      coalesce(nullif(notification_value->>'title', ''), '팀 변경'), notification_value->>'body',
      coalesce(nullif(notification_value->>'tone', ''), 'team'), coalesce(nullif(notification_value->>'type', ''), 'team'),
      nullif(notification_value->>'matchId', ''), nullif(notification_value->>'recruitingPostId', ''),
      nullif(notification_value->>'invitationId', ''), coalesce(nullif(notification_value->>'discordEvent', ''), nullif(notification_value->>'eventType', '')),
      nullif(notification_value->>'readAt', '')::timestamptz, notification_value,
      coalesce(nullif(notification_value->>'createdAt', '')::timestamptz, now_ts), now_ts
    ) on conflict (id) do update set
      title = excluded.title, body = excluded.body, tone = excluded.tone, type = excluded.type,
      payload = excluded.payload, updated_at = excluded.updated_at;
    notification_count := notification_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'teamId', safe_team_id, 'memberCount', member_count, 'notificationCount', notification_count);
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
  now_ts timestamptz := clock_timestamp();
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_team_id text := nullif(btrim(p_team_id), '');
  safe_target_id text := nullif(btrim(p_target_user_id), '');
  safe_invitation_id text := nullif(btrim(p_invitation_id), '');
  safe_role text := case when p_role in ('mercenary', 'guest') then 'mercenary' else 'regular' end;
  member_count integer;
  target_team_count integer;
  team_name text;
  existing_notification_target text;
begin
  if safe_actor_id is null or safe_team_id is null or safe_target_id is null then
    raise exception 'missing_team_invitation_input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || safe_team_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || safe_target_id, 0));

  select name into team_name from public.teams where id = safe_team_id and deleted_at is null for update;
  if not found then raise exception 'team_not_found' using errcode = 'P0002'; end if;
  if not exists(select 1 from public.team_members where team_id = safe_team_id and user_id = safe_actor_id and role = 'captain') then
    raise exception 'team_invite_permission_denied' using errcode = '42501';
  end if;
  if exists(select 1 from public.team_members where team_id = safe_team_id and user_id = safe_target_id) then
    raise exception 'team_member_already_exists' using errcode = '23505';
  end if;
  select count(*) into member_count from public.team_members where team_id = safe_team_id;
  if member_count >= 30 then
    update public.team_invitations set status = 'expired', updated_at = now_ts where team_id = safe_team_id and status = 'pending';
    return jsonb_build_object('ok', false, 'error', 'team_members_limit_exceeded', 'teamId', safe_team_id);
  end if;
  select count(*) into target_team_count from public.team_members where user_id = safe_target_id;
  if target_team_count >= 3 then raise exception 'team_membership_limit_exceeded' using errcode = '23514'; end if;

  select id into safe_invitation_id from public.team_invitations
  where team_id = safe_team_id and target_user_id = safe_target_id and status = 'pending'
  order by created_at desc limit 1;
  safe_invitation_id := coalesce(safe_invitation_id, nullif(btrim(p_invitation_id), ''), 'ti_' || replace(gen_random_uuid()::text, '-', ''));

  insert into public.team_invitations (
    id, team_id, from_user_id, target_user_id, role, request_kind, status, created_at, updated_at
  ) values (
    safe_invitation_id, safe_team_id, safe_actor_id, safe_target_id, safe_role, 'invite', 'pending', now_ts, now_ts
  ) on conflict (team_id, target_user_id) where status = 'pending'
  do update set from_user_id = excluded.from_user_id, role = excluded.role, request_kind = 'invite', updated_at = excluded.updated_at
  returning id into safe_invitation_id;

  update public.notifications
  set read_at = coalesce(read_at, now_ts),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('status', 'superseded_by_invite'),
      updated_at = now_ts
  where id = 'n_team_join_request_' || safe_invitation_id;

  select coalesce(nullif(target_user_id, ''), nullif(user_id, '')) into existing_notification_target
  from public.notifications where id = 'n_' || safe_invitation_id;
  if found and existing_notification_target is distinct from safe_target_id then
    raise exception 'notification_id_conflict' using errcode = '23505';
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, invitation_id, payload, created_at, updated_at
  ) values (
    'n_' || safe_invitation_id, safe_target_id, safe_target_id, '팀 초대', team_name || ' 팀 초대가 도착했습니다.',
    'team', 'team_invite', safe_invitation_id,
    jsonb_build_object('teamId', safe_team_id, 'teamInvitationId', safe_invitation_id, 'targetUserId', safe_target_id, 'role', safe_role),
    now_ts, now_ts
  ) on conflict (id) do update set body = excluded.body, payload = excluded.payload, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'teamId', safe_team_id, 'invitationId', safe_invitation_id);
end;
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
  now_ts timestamptz := clock_timestamp();
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  invitation_row public.team_invitations%rowtype;
  member_count integer;
  target_team_count integer;
  actor_is_captain boolean;
begin
  select * into invitation_row from public.team_invitations where id = p_invitation_id;
  if safe_actor_id is null or not found then raise exception 'team_invitation_not_found' using errcode = 'P0002'; end if;
  if invitation_row.request_kind <> 'invite' then raise exception 'team_join_request_action_required' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || invitation_row.team_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || invitation_row.target_user_id, 0));
  select * into invitation_row from public.team_invitations where id = p_invitation_id for update;
  if not found or invitation_row.request_kind <> 'invite' then raise exception 'team_invitation_not_found' using errcode = 'P0002'; end if;
  select exists(select 1 from public.team_members where team_id = invitation_row.team_id and user_id = safe_actor_id and role = 'captain') into actor_is_captain;

  if p_action = 'cancel' then
    if safe_actor_id <> invitation_row.from_user_id and not actor_is_captain then raise exception 'team_invitation_cancel_denied' using errcode = '42501'; end if;
    update public.team_invitations set status = 'cancelled', updated_at = now_ts where id = p_invitation_id and status = 'pending';
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'cancelled');
  end if;
  if safe_actor_id <> invitation_row.target_user_id then raise exception 'team_invitation_target_denied' using errcode = '42501'; end if;
  if invitation_row.status <> 'pending' then return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', invitation_row.status); end if;
  if p_action = 'decline' then
    update public.team_invitations set status = 'declined', updated_at = now_ts where id = p_invitation_id;
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'declined');
  end if;
  if p_action <> 'accept' then raise exception 'invalid_team_invitation_action' using errcode = '22023'; end if;

  perform 1 from public.teams where id = invitation_row.team_id and deleted_at is null for update;
  if not found then raise exception 'team_not_found' using errcode = 'P0002'; end if;
  if exists(select 1 from public.team_members where team_id = invitation_row.team_id and user_id = safe_actor_id) then
    update public.team_invitations set status = 'accepted', updated_at = now_ts where id = p_invitation_id;
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'accepted');
  end if;
  select count(*) into member_count from public.team_members where team_id = invitation_row.team_id;
  if member_count >= 30 then
    update public.team_invitations set status = 'expired', updated_at = now_ts where team_id = invitation_row.team_id and status = 'pending';
    return jsonb_build_object('ok', false, 'error', 'team_members_limit_exceeded', 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'expired');
  end if;
  select count(*) into target_team_count from public.team_members where user_id = safe_actor_id;
  if target_team_count >= 3 then
    update public.team_invitations set status = 'expired', updated_at = now_ts where id = p_invitation_id;
    return jsonb_build_object('ok', false, 'error', 'team_membership_limit_exceeded', 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'expired');
  end if;

  insert into public.team_members (team_id, user_id, role)
  values (invitation_row.team_id, safe_actor_id, case when invitation_row.role = 'mercenary' then 'mercenary' else 'regular' end);
  update public.team_invitations set status = 'accepted', updated_at = now_ts where id = p_invitation_id;
  if member_count + 1 >= 30 then
    update public.team_invitations set status = 'expired', updated_at = now_ts where team_id = invitation_row.team_id and status = 'pending';
  end if;
  return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'accepted', 'memberCount', member_count + 1);
end;
$$;

create or replace function public.rankball_request_team_membership(
  p_actor_profile_id text,
  p_team_id text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := clock_timestamp();
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_team_id text := nullif(btrim(p_team_id), '');
  safe_request_id text := nullif(btrim(p_request_id), '');
  team_name text;
  captain_id text;
  member_count integer;
  actor_team_count integer;
  existing_kind text;
begin
  if safe_actor_id is null or safe_team_id is null then raise exception 'missing_team_join_request_input' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || safe_team_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || safe_actor_id, 0));

  select team.name, member.user_id into team_name, captain_id
  from public.teams team
  join public.team_members member on member.team_id = team.id and member.role = 'captain'
  where team.id = safe_team_id and team.deleted_at is null
  for update of team;
  if not found then raise exception 'team_not_found' using errcode = 'P0002'; end if;
  if exists(select 1 from public.team_members where team_id = safe_team_id and user_id = safe_actor_id) then
    raise exception 'team_member_already_exists' using errcode = '23505';
  end if;
  select count(*) into member_count from public.team_members where team_id = safe_team_id;
  if member_count >= 30 then raise exception 'team_members_limit_exceeded' using errcode = '23514'; end if;
  select count(*) into actor_team_count from public.team_members where user_id = safe_actor_id;
  if actor_team_count >= 3 then raise exception 'team_membership_limit_exceeded' using errcode = '23514'; end if;

  select id, request_kind into safe_request_id, existing_kind
  from public.team_invitations
  where team_id = safe_team_id and target_user_id = safe_actor_id and status = 'pending'
  order by created_at desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'teamId', safe_team_id, 'invitationId', safe_request_id, 'status', case when existing_kind = 'invite' then 'invited' else 'pending' end);
  end if;

  safe_request_id := coalesce(nullif(btrim(p_request_id), ''), 'tjr_' || replace(gen_random_uuid()::text, '-', ''));
  insert into public.team_invitations (
    id, team_id, from_user_id, target_user_id, role, request_kind, status, created_at, updated_at
  ) values (safe_request_id, safe_team_id, safe_actor_id, safe_actor_id, 'regular', 'request', 'pending', now_ts, now_ts);

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, invitation_id, payload, created_at, updated_at
  ) values (
    'n_team_join_request_' || safe_request_id, captain_id, captain_id, '팀 가입 신청', team_name || ' 팀에 새 가입 신청이 도착했습니다.',
    'team', 'team_join_request', safe_request_id,
    jsonb_build_object('teamId', safe_team_id, 'teamInvitationId', safe_request_id, 'targetUserId', captain_id, 'applicantUserId', safe_actor_id),
    now_ts, now_ts
  ) on conflict (id) do update set target_user_id = excluded.target_user_id, body = excluded.body, payload = excluded.payload, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'teamId', safe_team_id, 'invitationId', safe_request_id, 'status', 'pending');
end;
$$;

create or replace function public.rankball_respond_team_join_request(
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
  now_ts timestamptz := clock_timestamp();
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  invitation_row public.team_invitations%rowtype;
  member_count integer;
  applicant_team_count integer;
  team_name text;
begin
  select * into invitation_row from public.team_invitations
  where id = p_invitation_id and request_kind = 'request';
  if safe_actor_id is null or not found then raise exception 'team_join_request_not_found' using errcode = 'P0002'; end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || invitation_row.team_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || invitation_row.target_user_id, 0));
  select * into invitation_row from public.team_invitations
  where id = p_invitation_id and request_kind = 'request' for update;
  if not found then raise exception 'team_join_request_not_found' using errcode = 'P0002'; end if;

  if p_action = 'cancel' then
    if safe_actor_id <> invitation_row.target_user_id then raise exception 'team_join_request_cancel_denied' using errcode = '42501'; end if;
    update public.team_invitations set status = 'cancelled', updated_at = now_ts where id = p_invitation_id and status = 'pending';
    return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'cancelled');
  end if;
  if not exists(select 1 from public.team_members where team_id = invitation_row.team_id and user_id = safe_actor_id and role = 'captain') then
    raise exception 'team_join_request_permission_denied' using errcode = '42501';
  end if;
  if invitation_row.status <> 'pending' then return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', invitation_row.status); end if;
  if p_action not in ('approve', 'decline') then raise exception 'invalid_team_join_request_action' using errcode = '22023'; end if;

  select name into team_name from public.teams where id = invitation_row.team_id and deleted_at is null for update;
  if not found then raise exception 'team_not_found' using errcode = 'P0002'; end if;

  if p_action = 'decline' then
    update public.team_invitations set status = 'declined', updated_at = now_ts where id = p_invitation_id;
  else
    if not exists(select 1 from public.team_members where team_id = invitation_row.team_id and user_id = invitation_row.target_user_id) then
      select count(*) into member_count from public.team_members where team_id = invitation_row.team_id;
      if member_count >= 30 then
        update public.team_invitations set status = 'expired', updated_at = now_ts where team_id = invitation_row.team_id and status = 'pending';
        return jsonb_build_object('ok', false, 'error', 'team_members_limit_exceeded', 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'expired');
      end if;
      select count(*) into applicant_team_count from public.team_members where user_id = invitation_row.target_user_id;
      if applicant_team_count >= 3 then
        update public.team_invitations set status = 'expired', updated_at = now_ts where id = p_invitation_id;
        return jsonb_build_object('ok', false, 'error', 'team_membership_limit_exceeded', 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', 'expired');
      end if;
      insert into public.team_members (team_id, user_id, role) values (invitation_row.team_id, invitation_row.target_user_id, 'regular');
      member_count := member_count + 1;
    end if;
    update public.team_invitations set status = 'accepted', updated_at = now_ts where id = p_invitation_id;
    if member_count >= 30 then
      update public.team_invitations set status = 'expired', updated_at = now_ts where team_id = invitation_row.team_id and status = 'pending';
    end if;
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, invitation_id, payload, created_at, updated_at
  ) values (
    'n_team_join_result_' || p_invitation_id, invitation_row.target_user_id, invitation_row.target_user_id,
    case when p_action = 'approve' then '팀 가입 승인' else '팀 가입 신청 결과' end,
    team_name || case when p_action = 'approve' then ' 팀 가입이 승인되었습니다.' else ' 팀 가입 신청이 거절되었습니다.' end,
    'team', 'team_join_result', p_invitation_id,
    jsonb_build_object('teamId', invitation_row.team_id, 'teamInvitationId', p_invitation_id, 'targetUserId', invitation_row.target_user_id, 'status', case when p_action = 'approve' then 'accepted' else 'declined' end),
    now_ts, now_ts
  ) on conflict (id) do update set title = excluded.title, body = excluded.body, payload = excluded.payload, updated_at = excluded.updated_at;

  return jsonb_build_object('ok', true, 'teamId', invitation_row.team_id, 'invitationId', p_invitation_id, 'status', case when p_action = 'approve' then 'accepted' else 'declined' end);
end;
$$;

create or replace function public.rankball_update_team_description(
  p_actor_profile_id text,
  p_team_id text,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_description text := btrim(regexp_replace(coalesce(p_description, ''), E'\\r\\n?', E'\\n', 'g'));
begin
  if char_length(safe_description) > 300 or cardinality(regexp_split_to_array(safe_description, E'\\r?\\n')) > 5 then
    raise exception 'invalid_team_description' using errcode = '22023';
  end if;
  if not exists(select 1 from public.team_members where team_id = p_team_id and user_id = p_actor_profile_id and role = 'captain') then
    raise exception 'team_sync_permission_denied' using errcode = '42501';
  end if;
  update public.teams set description = safe_description, updated_at = clock_timestamp()
  where id = p_team_id and deleted_at is null;
  if not found then raise exception 'team_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('ok', true, 'teamId', p_team_id, 'description', safe_description);
end;
$$;

revoke all on function public.enforce_team_membership_limit() from public, anon, authenticated;
revoke all on function public.rankball_sync_team_membership(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_invite_team_member(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_respond_team_invitation(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_request_team_membership(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_respond_team_join_request(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_update_team_description(text, text, text) from public, anon, authenticated;

grant execute on function public.rankball_sync_team_membership(text, jsonb, jsonb) to service_role;
grant execute on function public.rankball_invite_team_member(text, text, text, text, text) to service_role;
grant execute on function public.rankball_respond_team_invitation(text, text, text) to service_role;
grant execute on function public.rankball_request_team_membership(text, text, text) to service_role;
grant execute on function public.rankball_respond_team_join_request(text, text, text) to service_role;
grant execute on function public.rankball_update_team_description(text, text, text) to service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values
  ('general', 'rankball_request_team_membership', 'rankball_request_team_membership', 'public.rankball_request_team_membership(text,text,text)', 'active', true),
  ('general', 'rankball_respond_team_join_request', 'rankball_respond_team_join_request', 'public.rankball_respond_team_join_request(text,text,text)', 'active', true),
  ('general', 'rankball_update_team_description', 'rankball_update_team_description', 'public.rankball_update_team_description(text,text,text)', 'active', true)
on conflict (contract_scope, contract_name) do update set
  function_name = excluded.function_name,
  signature = excluded.signature,
  lifecycle = excluded.lifecycle,
  service_role_execute = excluded.service_role_execute,
  updated_at = clock_timestamp();

select pg_notify('pgrst', 'reload schema');

commit;
