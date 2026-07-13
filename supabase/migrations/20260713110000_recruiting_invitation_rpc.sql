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

  if coalesce(p_reserve, false) then
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
      and coalesce((invitation->>'reserve')::boolean, false) = true;

    if reserve_count + pending_reserve_count + invitation_count > 2 then
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
    'side', safe_side,
    'reserve', coalesce(p_reserve, false),
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
    format('%s %s %s 초대장이 도착했습니다.', current_post.title, case when safe_side = 'teamA' then 'A사이드' else 'B사이드' end, case when coalesce(p_reserve, false) then '후보' else '출전' end),
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

  safe_side := case when invitation->>'side' in ('teamA', 'teamB') then invitation->>'side' else 'teamB' end;
  safe_reserve := coalesce((invitation->>'reserve')::boolean, false);

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
  if safe_reserve and greatest(reserve_count, pinned_reserve_count) >= 2 then
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
      ('rankball_commit_admin_appointment_action', 'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_review_action', 'public.rankball_commit_admin_review_action(text,integer,text,text,text,integer,text,text)'),
      ('rankball_commit_match_rating', 'public.rankball_commit_match_rating(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'),
      ('rankball_delete_team', 'public.rankball_delete_team(text,text,jsonb)'),
      ('rankball_feed_trigger_health', 'public.rankball_feed_trigger_health()'),
      ('rankball_invite_team_member_4', 'public.rankball_invite_team_member(text,text,text,text)'),
      ('rankball_invite_team_member_5', 'public.rankball_invite_team_member(text,text,text,text,text)'),
      ('rankball_match_action', 'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('rankball_match_agree_action', 'public.rankball_match_agree_action(text,text,text,text)'),
      ('rankball_match_approval_action', 'public.rankball_match_approval_action(text,text,text,text)'),
      ('rankball_match_checkin_action', 'public.rankball_match_checkin_action(text,text,text,text)'),
      ('rankball_match_end_action', 'public.rankball_match_end_action(text,text,text,text)'),
      ('rankball_match_late_player_action', 'public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)'),
      ('rankball_match_list', 'public.rankball_match_list(text,integer,text,boolean)'),
      ('rankball_match_roster_move_action', 'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'),
      ('rankball_match_star_toggle_action', 'public.rankball_match_star_toggle_action(text,text,text)'),
      ('rankball_match_start_action', 'public.rankball_match_start_action(text,text,text,text,jsonb)'),
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
      ('rankball_recruiting_feed_counts', 'public.rankball_recruiting_feed_counts(text)'),
      ('rankball_recruiting_interest_player_action', 'public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'),
      ('rankball_recruiting_invitation_decision_action', 'public.rankball_recruiting_invitation_decision_action(text,text,text,text)'),
      ('rankball_recruiting_invite_players_action', 'public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'),
      ('rankball_recruiting_slot_position_action', 'public.rankball_recruiting_slot_position_action(text,text,text,text)'),
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

select pg_notify('pgrst', 'reload schema');
