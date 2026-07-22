-- Pickup rooms are individual-only. Repair legacy team-party rows without deleting data,
-- then enforce the same invariant inside the authoritative recruiting reducer.

do $$
declare
  post_row public.recruiting_posts%rowtype;
  application_row public.recruiting_applications%rowtype;
  participant_id text;
  participant_position text;
  active_ids jsonb;
  reserve_ids jsonb;
  next_invitations jsonb;
  next_pinned_reserves jsonb;
  next_room_state jsonb;
begin
  for post_row in
    select post.*
    from public.recruiting_posts post
    where post.status = 'open'
      and post.rules->>'matchIntent' = 'pickup'
    for update
  loop
    for participant_id in
      select distinct player.value
      from jsonb_array_elements_text(
        case when jsonb_typeof(coalesce(post_row.player_ids, '[]'::jsonb)) = 'array'
          then coalesce(post_row.player_ids, '[]'::jsonb)
          else '[]'::jsonb
        end
      ) player(value)
      where nullif(btrim(player.value), '') is not null
        and player.value <> coalesce(post_row.player_id, '')
    loop
      select profile.position into participant_position
      from public.profiles profile
      where profile.id = participant_id;

      insert into public.recruiting_applications (
        post_id, player_id, team_id, kind, side, status, reserve, position,
        player_ids, source_team_id, source_entry_id, created_at, updated_at
      ) values (
        post_row.id, participant_id, null, 'player', post_row.host_side, 'ready', false,
        participant_position, '[]'::jsonb, null, null, now(), now()
      )
      on conflict (post_id, player_id, kind) do update set
        team_id = null,
        side = excluded.side,
        status = 'ready',
        reserve = false,
        position = coalesce(public.recruiting_applications.position, excluded.position),
        player_ids = '[]'::jsonb,
        source_team_id = null,
        source_entry_id = null,
        updated_at = excluded.updated_at;
    end loop;

    for application_row in
      select application.*
      from public.recruiting_applications application
      where application.post_id = post_row.id
        and application.kind = 'team'
      order by application.created_at, application.player_id
      for update
    loop
      if exists (
        select 1
        from public.recruiting_applications existing
        where existing.post_id = application_row.post_id
          and existing.player_id = application_row.player_id
          and existing.kind = 'player'
      ) then
        raise exception 'pickup_team_leader_player_conflict:%:%', application_row.post_id, application_row.player_id;
      end if;

      active_ids := case
        when jsonb_typeof(coalesce(application_row.player_ids, '[]'::jsonb)) = 'array'
          then coalesce(application_row.player_ids, '[]'::jsonb)
        else '[]'::jsonb
      end;
      reserve_ids := case
        when application_row.team_id is not null
          and jsonb_typeof(post_row.room_state #> array['partyReserves', 'team:' || application_row.team_id]) = 'array'
          then post_row.room_state #> array['partyReserves', 'team:' || application_row.team_id]
        else '[]'::jsonb
      end;

      select profile.position into participant_position
      from public.profiles profile
      where profile.id = application_row.player_id;

      update public.recruiting_applications
      set team_id = null,
          kind = 'player',
          status = 'ready',
          reserve = not (active_ids ? application_row.player_id),
          position = coalesce(application_row.position, participant_position),
          player_ids = '[]'::jsonb,
          source_team_id = null,
          source_entry_id = null,
          updated_at = now()
      where post_id = application_row.post_id
        and player_id = application_row.player_id
        and kind = 'team';

      for participant_id in
        select distinct player.value
        from jsonb_array_elements_text(active_ids) player(value)
        where nullif(btrim(player.value), '') is not null
          and player.value <> application_row.player_id
      loop
        select profile.position into participant_position
        from public.profiles profile
        where profile.id = participant_id;

        insert into public.recruiting_applications (
          post_id, player_id, team_id, kind, side, status, reserve, position,
          player_ids, source_team_id, source_entry_id, created_at, updated_at
        ) values (
          application_row.post_id, participant_id, null, 'player', application_row.side,
          'ready', false, participant_position, '[]'::jsonb, null, null, now(), now()
        )
        on conflict (post_id, player_id, kind) do update set
          team_id = null,
          side = excluded.side,
          status = 'ready',
          reserve = false,
          position = coalesce(public.recruiting_applications.position, excluded.position),
          player_ids = '[]'::jsonb,
          source_team_id = null,
          source_entry_id = null,
          updated_at = excluded.updated_at;
      end loop;

      for participant_id in
        select distinct player.value
        from jsonb_array_elements_text(reserve_ids) player(value)
        where nullif(btrim(player.value), '') is not null
          and not (active_ids ? player.value)
          and player.value <> application_row.player_id
      loop
        select profile.position into participant_position
        from public.profiles profile
        where profile.id = participant_id;

        insert into public.recruiting_applications (
          post_id, player_id, team_id, kind, side, status, reserve, position,
          player_ids, source_team_id, source_entry_id, created_at, updated_at
        ) values (
          application_row.post_id, participant_id, null, 'player', application_row.side,
          'ready', true, participant_position, '[]'::jsonb, null, null, now(), now()
        )
        on conflict (post_id, player_id, kind) do update set
          team_id = null,
          side = excluded.side,
          status = 'ready',
          reserve = case when public.recruiting_applications.reserve then true else false end,
          position = coalesce(public.recruiting_applications.position, excluded.position),
          player_ids = '[]'::jsonb,
          source_team_id = null,
          source_entry_id = null,
          updated_at = excluded.updated_at;
      end loop;
    end loop;

    for participant_id in
      select distinct reserve_player.value
      from jsonb_array_elements_text(
        case when jsonb_typeof(post_row.room_state #> array['partyReserves', 'host']) = 'array'
          then post_row.room_state #> array['partyReserves', 'host']
          else '[]'::jsonb
        end
      ) reserve_player(value)
      where nullif(btrim(reserve_player.value), '') is not null
        and reserve_player.value <> coalesce(post_row.player_id, '')
    loop
      select profile.position into participant_position
      from public.profiles profile
      where profile.id = participant_id;

      insert into public.recruiting_applications (
        post_id, player_id, team_id, kind, side, status, reserve, position,
        player_ids, source_team_id, source_entry_id, created_at, updated_at
      ) values (
        post_row.id, participant_id, null, 'player', post_row.host_side, 'ready', true,
        participant_position, '[]'::jsonb, null, null, now(), now()
      )
      on conflict (post_id, player_id, kind) do update set
        team_id = null,
        status = 'ready',
        player_ids = '[]'::jsonb,
        source_team_id = null,
        source_entry_id = null,
        updated_at = excluded.updated_at;
    end loop;

    select coalesce(jsonb_agg(
      case
        when coalesce(invitation.value->>'role', 'player') = 'referee' then invitation.value
        else (invitation.value - 'teamId') || jsonb_build_object('joinMode', 'player')
      end
      order by invitation.ordinality
    ), '[]'::jsonb)
    into next_invitations
    from jsonb_array_elements(
      case when jsonb_typeof(post_row.room_state->'invitations') = 'array'
        then post_row.room_state->'invitations'
        else '[]'::jsonb
      end
    ) with ordinality invitation(value, ordinality);

    select coalesce(jsonb_object_agg(side, player_ids), '{}'::jsonb)
    into next_pinned_reserves
    from (
      select application.side,
             jsonb_agg(to_jsonb(application.player_id) order by application.created_at, application.player_id) as player_ids
      from public.recruiting_applications application
      where application.post_id = post_row.id
        and application.kind = 'player'
        and application.reserve = true
      group by application.side
    ) reserve_side;

    next_room_state := coalesce(post_row.room_state, '{}'::jsonb) || jsonb_build_object(
      'teamOnly', false,
      'partyLeaders', '{}'::jsonb,
      'partySides', '{}'::jsonb,
      'partyReserves', '{}'::jsonb,
      'pinnedReservePlayers', next_pinned_reserves,
      'invitations', next_invitations
    );

    update public.recruiting_posts
    set team_id = null,
        target_team_id = null,
        host_join_mode = 'player',
        player_ids = '[]'::jsonb,
        ranked = false,
        official = false,
        room_state = next_room_state,
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'matchIntent', 'pickup',
          'hostJoinMode', 'player',
          'teamOnly', false,
          'ranked', false,
          'official', false,
          'playingTimePolicy', 'equal_rotation',
          'lineupSelectionPolicy', 'no_fixed_starter'
        ),
        updated_at = now()
    where id = post_row.id;

    update public.notifications notification
    set payload = (coalesce(notification.payload, '{}'::jsonb) - 'teamId') || jsonb_build_object('joinMode', 'player'),
        updated_at = now()
    where notification.recruiting_post_id = post_row.id
      and notification.invitation_id is not null;

    perform public.rankball_refresh_recruiting_feed_for_post(post_row.id);
  end loop;
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_recruiting_management_action_pre_pickup_guard(text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_management_action(text,jsonb)') is null then
      raise exception 'rankball_recruiting_management_action_missing';
    end if;
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_pre_pickup_guard;
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
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  safe_post_id text := coalesce(
    nullif(btrim(p_operation->>'preferredPostId'), ''),
    nullif(btrim(p_operation->>'postId'), ''),
    nullif(btrim(p_operation #>> '{draft,id}'), '')
  );
  safe_invitation_id text := nullif(btrim(p_operation->>'invitationId'), '');
  normalized_operation jsonb := coalesce(p_operation, '{}'::jsonb);
  normalized_draft jsonb;
  normalized_invite jsonb;
  normalized_application jsonb;
  current_post public.recruiting_posts%rowtype;
  next_invitations jsonb;
  pickup_room boolean := false;
begin
  if safe_post_id is not null then
    select post.* into current_post
    from public.recruiting_posts post
    where post.id = safe_post_id;
    pickup_room := current_post.id is not null and current_post.rules->>'matchIntent' = 'pickup';
  elsif safe_action = 'createRecruitingPost' then
    pickup_room := coalesce(
      normalized_operation #>> '{draft,matchIntent}',
      normalized_operation #>> '{draft,rules,matchIntent}'
    ) = 'pickup';
  end if;

  if not pickup_room then
    return public.rankball_recruiting_management_action_pre_pickup_guard(p_actor_profile_id, p_operation);
  end if;

  if safe_action in (
    'joinRecruitingSideParty',
    'setRecruitingPartyPlayerPlacement',
    'setRecruitingPartyPlayerReserve',
    'setRecruitingTeamPartyRoster',
    'detachRecruitingPartyPlayer',
    'removeRecruitingPartyPlayer'
  ) then
    raise exception 'pickup_party_not_allowed' using errcode = '23514';
  end if;

  if safe_action = 'createRecruitingPost' then
    normalized_draft := coalesce(normalized_operation->'draft', '{}'::jsonb);
    normalized_draft := normalized_draft
      - 'teamId'
      - 'targetTeamId'
      || jsonb_build_object(
        'hostJoinMode', 'player',
        'teamOnly', false,
        'ranked', false,
        'official', false,
        'playerIds', '[]'::jsonb,
        'rules', coalesce(normalized_draft->'rules', '{}'::jsonb) || jsonb_build_object(
          'matchIntent', 'pickup',
          'hostJoinMode', 'player',
          'teamOnly', false,
          'ranked', false,
          'official', false,
          'playingTimePolicy', 'equal_rotation',
          'lineupSelectionPolicy', 'no_fixed_starter'
        )
      );
    normalized_operation := jsonb_set(normalized_operation, '{draft}', normalized_draft, true);
  elsif safe_action = 'inviteRecruitingPlayers' then
    normalized_invite := (coalesce(normalized_operation->'invite', '{}'::jsonb) - 'teamId')
      || jsonb_build_object('joinMode', 'player');
    normalized_operation := jsonb_set(normalized_operation, '{invite}', normalized_invite, true);
  elsif safe_action = 'interestRecruitingPost' then
    normalized_application := (coalesce(normalized_operation->'application', '{}'::jsonb) - 'teamId')
      || jsonb_build_object('joinMode', 'player');
    normalized_operation := jsonb_set(normalized_operation, '{application}', normalized_application, true)
      || jsonb_build_object('joinMode', 'player');
  elsif safe_action in ('acceptRecruitingInvitation', 'declineRecruitingInvitation')
    and safe_invitation_id is not null
    and safe_actor_id is not null
  then
    select coalesce(jsonb_agg(
      case
        when invitation.value->>'id' = safe_invitation_id
          and invitation.value->>'targetUserId' = safe_actor_id
          and coalesce(invitation.value->>'role', 'player') <> 'referee'
        then (invitation.value - 'teamId') || jsonb_build_object('joinMode', 'player')
        else invitation.value
      end
      order by invitation.ordinality
    ), '[]'::jsonb)
    into next_invitations
    from jsonb_array_elements(
      case when jsonb_typeof(current_post.room_state->'invitations') = 'array'
        then current_post.room_state->'invitations'
        else '[]'::jsonb
      end
    ) with ordinality invitation(value, ordinality);

    update public.recruiting_posts
    set room_state = jsonb_set(coalesce(room_state, '{}'::jsonb), '{invitations}', next_invitations, true),
        updated_at = now()
    where id = safe_post_id;
  end if;

  return public.rankball_recruiting_management_action_pre_pickup_guard(p_actor_profile_id, normalized_operation);
end;
$$;

revoke all on function public.rankball_recruiting_management_action_pre_pickup_guard(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action(text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_management_action(text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
