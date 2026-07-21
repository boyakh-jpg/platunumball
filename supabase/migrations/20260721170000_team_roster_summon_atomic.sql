do $$
begin
  if to_regprocedure('public.rankball_recruiting_management_action_pre_summon(text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_management_action(text,jsonb)') is null then
      raise exception 'rankball_recruiting_management_action_missing';
    end if;
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_pre_summon;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_management_action(
  p_actor_profile_id text,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  safe_post_id text := coalesce(
    nullif(btrim(p_operation->>'preferredPostId'), ''),
    nullif(btrim(p_operation->>'postId'), ''),
    nullif(btrim(p_operation #>> '{draft,id}'), '')
  );
  safe_invitation_id text := nullif(btrim(p_operation->>'invitationId'), '');
  invite_payload jsonb := coalesce(p_operation->'invite', '{}'::jsonb);
  target_team_id text := nullif(btrim(p_operation #>> '{invite,teamId}'), '');
  safe_side text := case when p_operation #>> '{invite,side}' = 'teamA' then 'teamA' else 'teamB' end;
  reserve_requested boolean := coalesce((p_operation #>> '{invite,reserve}')::boolean, false);
  current_post public.recruiting_posts%rowtype;
  application_row public.recruiting_applications%rowtype;
  room_state jsonb := '{}'::jsonb;
  invitations jsonb := '[]'::jsonb;
  next_invitations jsonb := '[]'::jsonb;
  current_active jsonb := '[]'::jsonb;
  current_reserves jsonb := '[]'::jsonb;
  next_active jsonb := '[]'::jsonb;
  next_reserves jsonb := '[]'::jsonb;
  requested_ids jsonb := '[]'::jsonb;
  other_entry_ids jsonb := '[]'::jsonb;
  rostered_ids jsonb := '[]'::jsonb;
  skipped_ids jsonb := '[]'::jsonb;
  resolved_invitation_ids jsonb := '[]'::jsonb;
  team_member_ids jsonb := '[]'::jsonb;
  safe_entry_id text;
  leader_id text;
  candidate_id text;
  entry_row record;
  side_capacity integer := 5;
  result jsonb;
  now_at timestamptz := now();
begin
  if safe_action in ('acceptRecruitingInvitation', 'declineRecruitingInvitation') then
    result := public.rankball_recruiting_management_action_pre_summon(p_actor_profile_id, p_operation);
    if safe_post_id is not null and safe_invitation_id is not null and safe_actor_id is not null then
      update public.notifications notification
      set read_at = coalesce(notification.read_at, now_at),
          payload = coalesce(notification.payload, '{}'::jsonb) || jsonb_build_object(
            'status', case when safe_action = 'acceptRecruitingInvitation' then 'accepted' else 'declined' end,
            'actionRequired', false,
            'resolvedAt', now_at
          ),
          updated_at = now_at
      where notification.recruiting_post_id = safe_post_id
        and notification.invitation_id = safe_invitation_id
        and coalesce(notification.target_user_id, notification.user_id) = safe_actor_id;
      perform public.rankball_refresh_recruiting_feed_for_post(safe_post_id);
    end if;
    return result;
  end if;

  if safe_action <> 'inviteRecruitingPlayers'
     or coalesce(p_operation #>> '{invite,joinMode}', 'player') <> 'team'
     or target_team_id is null
     or safe_post_id is null
     or safe_actor_id is null then
    return public.rankball_recruiting_management_action_pre_summon(p_actor_profile_id, p_operation);
  end if;

  if jsonb_typeof(coalesce(invite_payload->'playerIds', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_recruiting_invite_targets' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
  select * into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if current_post.id is null then
    raise exception 'recruiting_post_not_found' using errcode = 'P0002';
  end if;
  if current_post.status <> 'open' then
    raise exception 'recruiting_room_not_open' using errcode = '23514';
  end if;

  room_state := coalesce(current_post.room_state, '{}'::jsonb);
  invitations := case
    when jsonb_typeof(room_state->'invitations') = 'array' then room_state->'invitations'
    else '[]'::jsonb
  end;
  side_capacity := greatest(1, least(5, coalesce(current_post.side_capacity, 5)));

  if current_post.team_id = target_team_id and current_post.host_side = safe_side then
    safe_entry_id := 'host';
    leader_id := coalesce(room_state #>> '{partyLeaders,host}', current_post.player_id);
    current_active := case
      when jsonb_typeof(current_post.player_ids) = 'array' then current_post.player_ids
      else '[]'::jsonb
    end;
  else
    select * into application_row
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.team_id = target_team_id
      and application.kind = 'team'
      and application.side = safe_side
    order by application.created_at
    limit 1
    for update;
    if application_row.post_id is null then
      return public.rankball_recruiting_management_action_pre_summon(p_actor_profile_id, p_operation);
    end if;
    safe_entry_id := 'team:' || target_team_id;
    leader_id := coalesce(room_state #>> array['partyLeaders', safe_entry_id], application_row.player_id);
    current_active := case
      when jsonb_typeof(application_row.player_ids) = 'array' then application_row.player_ids
      else '[]'::jsonb
    end;
  end if;

  if leader_id is null or leader_id <> safe_actor_id then
    raise exception 'recruiting_party_leader_required' using errcode = '42501';
  end if;

  current_reserves := case
    when jsonb_typeof(room_state #> array['partyReserves', safe_entry_id]) = 'array'
      then room_state #> array['partyReserves', safe_entry_id]
    else '[]'::jsonb
  end;

  select coalesce(jsonb_agg(value order by first_order), '[]'::jsonb)
  into current_active
  from (
    select value, min(ordinality) as first_order
    from jsonb_array_elements_text(current_active) with ordinality player(value, ordinality)
    where nullif(btrim(value), '') is not null
    group by value
  ) normalized;

  select coalesce(jsonb_agg(value order by first_order), '[]'::jsonb)
  into current_reserves
  from (
    select value, min(ordinality) as first_order
    from jsonb_array_elements_text(current_reserves) with ordinality player(value, ordinality)
    where nullif(btrim(value), '') is not null
      and not current_active ? value
    group by value
  ) normalized;

  if not (current_active || current_reserves) ? leader_id then
    raise exception 'recruiting_party_leader_required' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(to_jsonb(member.user_id)), '[]'::jsonb)
  into team_member_ids
  from public.team_members member
  where member.team_id = target_team_id;
  if jsonb_array_length(team_member_ids) = 0 then
    raise exception 'recruiting_team_not_found' using errcode = 'P0002';
  end if;

  for candidate_id in
    select nullif(btrim(value), '')
    from jsonb_array_elements_text(coalesce(invite_payload->'playerIds', '[]'::jsonb)) target(value)
  loop
    if candidate_id is null or requested_ids ? candidate_id then
      continue;
    end if;
    if not team_member_ids ? candidate_id then
      raise exception 'recruiting_team_roster_not_member' using errcode = '42501';
    end if;
    requested_ids := requested_ids || to_jsonb(candidate_id);
  end loop;

  if safe_entry_id <> 'host' then
    other_entry_ids := other_entry_ids || current_post.player_ids;
    other_entry_ids := other_entry_ids || coalesce(room_state #> '{partyReserves,host}', '[]'::jsonb);
  end if;
  for entry_row in
    select application.player_id, application.team_id, application.kind, application.player_ids
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and not (application.kind = 'team' and application.team_id = target_team_id and application.side = safe_side)
  loop
    if entry_row.player_id is not null then
      other_entry_ids := other_entry_ids || to_jsonb(entry_row.player_id);
    end if;
    if jsonb_typeof(entry_row.player_ids) = 'array' then
      other_entry_ids := other_entry_ids || entry_row.player_ids;
    end if;
    if entry_row.kind = 'team' and entry_row.team_id is not null then
      other_entry_ids := other_entry_ids || coalesce(room_state #> array['partyReserves', 'team:' || entry_row.team_id], '[]'::jsonb);
    end if;
  end loop;

  next_active := current_active;
  next_reserves := current_reserves;
  for candidate_id in select value from jsonb_array_elements_text(requested_ids) target(value)
  loop
    if (next_active || next_reserves) ? candidate_id then
      continue;
    end if;
    if other_entry_ids ? candidate_id then
      skipped_ids := skipped_ids || to_jsonb(candidate_id);
      continue;
    end if;
    if not reserve_requested and jsonb_array_length(next_active) < side_capacity then
      next_active := next_active || to_jsonb(candidate_id);
    elsif jsonb_array_length(next_reserves) < 2 then
      next_reserves := next_reserves || to_jsonb(candidate_id);
    else
      skipped_ids := skipped_ids || to_jsonb(candidate_id);
    end if;
  end loop;

  if next_active is distinct from current_active or next_reserves is distinct from current_reserves then
    result := public.rankball_recruiting_management_action_pre_summon(
      safe_actor_id,
      jsonb_build_object(
        'action', 'setRecruitingTeamPartyRoster',
        'postId', safe_post_id,
        'entryId', safe_entry_id,
        'roster', jsonb_build_object(
          'playerIds', next_active,
          'reservePlayerIds', next_reserves
        )
      )
    );
  else
    result := jsonb_build_object(
      'ok', true,
      'action', safe_action,
      'postId', safe_post_id,
      'entryId', safe_entry_id,
      'noop', true,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  rostered_ids := next_active || next_reserves;
  select coalesce(jsonb_agg(to_jsonb(invitation->>'id')), '[]'::jsonb)
  into resolved_invitation_ids
  from jsonb_array_elements(invitations) invitation
  where coalesce(invitation->>'status', 'pending') = 'pending'
    and invitation->>'joinMode' = 'team'
    and invitation->>'teamId' = target_team_id
    and invitation->>'side' = safe_side
    and requested_ids ? (invitation->>'targetUserId');

  select post.room_state into room_state
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  invitations := case
    when jsonb_typeof(room_state->'invitations') = 'array' then room_state->'invitations'
    else '[]'::jsonb
  end;
  select coalesce(jsonb_agg(invitation), '[]'::jsonb)
  into next_invitations
  from jsonb_array_elements(invitations) invitation
  where not (
    coalesce(invitation->>'status', 'pending') = 'pending'
    and invitation->>'joinMode' = 'team'
    and invitation->>'teamId' = target_team_id
    and invitation->>'side' = safe_side
    and requested_ids ? (invitation->>'targetUserId')
  );

  update public.recruiting_posts
  set room_state = jsonb_set(room_state, '{invitations}', next_invitations, true),
      updated_at = now_at
  where id = safe_post_id;

  update public.notifications notification
  set read_at = coalesce(notification.read_at, now_at),
      payload = coalesce(notification.payload, '{}'::jsonb) || jsonb_build_object(
        'status', case when rostered_ids ? coalesce(notification.target_user_id, notification.user_id) then 'summoned' else 'expired' end,
        'actionRequired', false,
        'resolvedAt', now_at
      ),
      updated_at = now_at
  where notification.recruiting_post_id = safe_post_id
    and resolved_invitation_ids ? notification.invitation_id;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type,
    recruiting_post_id, payload, created_at, updated_at
  )
  select
    'notice-recruiting-team-summon-' || safe_post_id || '-' || substr(md5(target.value), 1, 16),
    target.value,
    target.value,
    '팀원 소집',
    current_post.title || ' ' || case when safe_side = 'teamA' then 'A사이드' else 'B사이드' end ||
      case when next_reserves ? target.value then ' 후보 명단에 등록되었습니다.' else ' 출전 명단에 등록되었습니다.' end,
    'match',
    'recruiting_team_summon',
    safe_post_id,
    jsonb_build_object(
      'source', 'recruiting_team_summon',
      'status', 'summoned',
      'actionRequired', false,
      'recruitingPostId', safe_post_id,
      'teamId', target_team_id,
      'side', safe_side,
      'reserve', next_reserves ? target.value
    ),
    now_at,
    now_at
  from jsonb_array_elements_text(requested_ids) target(value)
  where rostered_ids ? target.value
    and target.value <> safe_actor_id
  on conflict (id) do update set
    title = excluded.title,
    body = excluded.body,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  perform public.rankball_refresh_recruiting_feed_for_post(safe_post_id);
  return result || jsonb_build_object(
    'directTeamRosterSummon', true,
    'rosteredCount', jsonb_array_length(rostered_ids),
    'skippedCount', jsonb_array_length(skipped_ids)
  );
end;
$$;

revoke all on function public.rankball_recruiting_management_action_pre_summon(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action(text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_management_action(text, jsonb) to service_role;

do $$
declare
  repair_row record;
begin
  for repair_row in
    select
      post.id as post_id,
      invitation->>'fromUserId' as actor_id,
      invitation->>'teamId' as team_id,
      invitation->>'side' as side_name,
      coalesce((invitation->>'reserve')::boolean, false) as reserve_requested,
      jsonb_agg(to_jsonb(invitation->>'targetUserId')) as target_ids
    from public.recruiting_posts post
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(post.room_state->'invitations') = 'array' then post.room_state->'invitations' else '[]'::jsonb end
    ) invitation
    where post.status = 'open'
      and coalesce(invitation->>'status', 'pending') = 'pending'
      and invitation->>'joinMode' = 'team'
      and nullif(invitation->>'teamId', '') is not null
      and (
        (
          post.team_id = invitation->>'teamId'
          and post.host_side = invitation->>'side'
          and invitation->>'fromUserId' = coalesce(post.room_state #>> '{partyLeaders,host}', post.player_id)
        )
        or exists (
          select 1
          from public.recruiting_applications application
          where application.post_id = post.id
            and application.kind = 'team'
            and application.team_id = invitation->>'teamId'
            and application.side = invitation->>'side'
            and invitation->>'fromUserId' = coalesce(
              post.room_state #>> array['partyLeaders', 'team:' || application.team_id],
              application.player_id
            )
        )
      )
    group by
      post.id,
      invitation->>'fromUserId',
      invitation->>'teamId',
      invitation->>'side',
      coalesce((invitation->>'reserve')::boolean, false)
  loop
    begin
      perform public.rankball_recruiting_management_action(
        repair_row.actor_id,
        jsonb_build_object(
          'action', 'inviteRecruitingPlayers',
          'postId', repair_row.post_id,
          'invite', jsonb_build_object(
            'playerIds', repair_row.target_ids,
            'joinMode', 'team',
            'teamId', repair_row.team_id,
            'side', repair_row.side_name,
            'reserve', repair_row.reserve_requested
          )
        )
      );
    exception when others then
      raise warning 'team roster summon repair skipped for post %: %', repair_row.post_id, sqlerrm;
    end;
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');
