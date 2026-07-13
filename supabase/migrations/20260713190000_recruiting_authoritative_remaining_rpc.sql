-- Finish recruiting operation reducers for create, team/party/referee, rules, roster, and kick paths.

create or replace function public.rankball_recruiting_is_related(
  p_post public.recruiting_posts,
  p_profile_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_profile_id = p_post.player_id
    or coalesce(p_post.player_ids, '[]'::jsonb) ? p_profile_id
    or p_profile_id = p_post.referee_id
    or exists (
      select 1 from public.recruiting_applications application
      where application.post_id = p_post.id
        and (application.player_id = p_profile_id or coalesce(application.player_ids, '[]'::jsonb) ? p_profile_id)
    )
    or exists (
      select 1 from public.rankball_room_state_participant_ids(p_post.room_state) participant
      where participant.profile_id = p_profile_id
    ),
    false
  )
$$;

create or replace function public.rankball_recruiting_side_active_count(
  p_post public.recruiting_posts,
  p_side text
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case when p_post.host_side = p_side then
      case
        when p_post.host_join_mode = 'team' then greatest(1, jsonb_array_length(coalesce(p_post.player_ids, '[]'::jsonb)))
        when coalesce(p_post.room_state->>'hostReserve', 'false') in ('true', '1') then 0
        else 1
      end
    else 0 end,
    0
  ) + coalesce((
    select sum(
      case
        when application.reserve then 0
        when application.kind = 'team' then greatest(1, jsonb_array_length(coalesce(application.player_ids, '[]'::jsonb)))
        else 1
      end
    )::integer
    from public.recruiting_applications application
    where application.post_id = p_post.id and application.side = p_side
  ), 0)
$$;

create or replace function public.rankball_recruiting_side_reserve_count(
  p_post public.recruiting_posts,
  p_side text
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from (
    select p_post.player_id as reserve_id
    where p_post.host_join_mode = 'player'
      and p_post.host_side = p_side
      and coalesce(p_post.room_state->>'hostReserve', 'false') in ('true', '1')
    union
    select candidate.reserve_id
    from public.recruiting_applications application
    cross join lateral (
      select application.player_id as reserve_id
      union
      select value from jsonb_array_elements_text(coalesce(application.player_ids, '[]'::jsonb)) player(value)
    ) candidate
    where application.post_id = p_post.id and application.side = p_side and application.reserve
    union
    select reserve_id
    from jsonb_each(coalesce(p_post.room_state->'partyReserves', '{}'::jsonb)) reserve_entry(entry_id, reserve_ids)
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(reserve_ids) = 'array' then reserve_ids else '[]'::jsonb end) reserve(reserve_id)
    where coalesce(
      p_post.room_state #>> array['partySides', entry_id],
      case when entry_id = 'host' then p_post.host_side else null end
    ) = p_side
    union
    select reserve_id
    from jsonb_array_elements_text(coalesce(p_post.room_state #> array['pinnedReservePlayers', p_side], '[]'::jsonb)) reserve(reserve_id)
  ) reserves
  where reserve_id is not null
$$;

create or replace function public.rankball_recruiting_replace_invitation_status(
  p_invitations jsonb,
  p_invitation_id text,
  p_target_user_id text,
  p_status text,
  p_now timestamptz
)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    case
      when invitation->>'id' = p_invitation_id then invitation || jsonb_build_object('status', p_status, 'updatedAt', p_now)
      when invitation->>'targetUserId' = p_target_user_id and coalesce(invitation->>'status', 'pending') = 'pending'
        then invitation || jsonb_build_object('status', 'expired', 'updatedAt', p_now)
      else invitation
    end
    order by ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb)) with ordinality item(invitation, ordinality)
$$;

create or replace function public.rankball_jsonb_object_array_remove_value(
  p_object jsonb,
  p_value text
)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb)
  from (
    select
      key,
      coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> p_value), '[]'::jsonb) as filtered_ids
    from jsonb_each(case when jsonb_typeof(p_object) = 'object' then p_object else '{}'::jsonb end) entry(key, raw_ids)
    left join lateral jsonb_array_elements_text(case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end) ids(value) on true
    group by key
  ) cleaned
  where jsonb_array_length(filtered_ids) > 0
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
<<management>>
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  safe_post_id text := coalesce(
    nullif(btrim(p_operation->>'preferredPostId'), ''),
    nullif(btrim(p_operation->>'postId'), ''),
    nullif(btrim(p_operation #>> '{draft,id}'), '')
  );
  current_post public.recruiting_posts%rowtype;
  draft jsonb := coalesce(p_operation->'draft', '{}'::jsonb);
  payload jsonb;
  room_state jsonb;
  invitations jsonb;
  invitation jsonb;
  invitation_id text;
  target_user_id text;
  target_user_ids jsonb;
  target_team_id text;
  previous_side text;
  join_mode text;
  safe_side text;
  safe_player_id text;
  safe_entry_id text;
  reserve boolean;
  side_capacity integer;
  active_count integer;
  reserve_count integer;
  now_at timestamptz := now();
  invitation_row jsonb;
  selected_players jsonb;
  selected_reserves jsonb;
  team_member_ids jsonb;
  application_row public.recruiting_applications%rowtype;
  leader_id text;
  party_reserves jsonb;
  party_leaders jsonb;
  party_sides jsonb;
  next_player_ids jsonb;
  next_reserve_ids jsonb;
  schedule_date date;
  schedule_time time;
  timing_type text;
  visibility text;
  host_join_mode text;
  host_team_id text;
  opponent_team_id text;
  opponent_leader_id text;
  referee_target_id text;
  mmr_range_mode text;
  mmr_limit_mode text;
  rating_scale numeric;
  host_trust integer;
  trust_required integer;
  created_count integer := 0;
begin
  if safe_actor_id is null or not exists (select 1 from public.profiles where id = safe_actor_id) then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.admin_disciplinary_actions action
    where action.user_id = safe_actor_id and action.status = 'active'
      and coalesce(action.starts_at, now_at) <= now_at
      and (action.ends_at is null or action.ends_at > now_at)
  ) then
    raise exception 'profile_discipline_blocked' using errcode = '42501';
  end if;
  if safe_action not in (
    'createRecruitingPost', 'inviteRecruitingReferee', 'inviteRecruitingPlayers',
    'acceptRecruitingInvitation', 'declineRecruitingInvitation', 'updateRecruitingRoomRules',
    'interestRecruitingPost',
    'setRecruitingApplicantReserve', 'setRecruitingApplicantPlacement', 'joinRecruitingSideParty',
    'setRecruitingPartyPlayerReserve', 'setRecruitingPartyPlayerPlacement', 'setRecruitingTeamPartyRoster',
    'detachRecruitingPartyPlayer', 'removeRecruitingPartyPlayer', 'kickRecruitingApplicant'
  ) then
    raise exception 'unsupported_recruiting_operation' using errcode = '22023';
  end if;
  if safe_post_id is null then raise exception 'missing_recruiting_post' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  if safe_action = 'createRecruitingPost' then
    if exists (select 1 from public.recruiting_posts where id = safe_post_id) then
      raise exception 'recruiting_post_already_exists' using errcode = '23505';
    end if;
    visibility := case when draft->>'visibility' = 'private' then 'private' else 'public' end;
    host_join_mode := case when draft->>'hostJoinMode' = 'player' then 'player' else 'team' end;
    side_capacity := greatest(1, least(5, coalesce((draft->>'sideCapacity')::integer, substring(coalesce(draft->>'mode', '5v5') from '^[0-9]+')::integer, 5)));
    host_team_id := case when host_join_mode = 'team' then nullif(btrim(draft->>'teamId'), '') else null end;
    if host_join_mode = 'team' and not exists (
      select 1 from public.team_members where team_id = host_team_id and user_id = safe_actor_id
    ) then raise exception 'recruiting_host_team_membership_required' using errcode = '42501'; end if;
    if nullif(btrim(coalesce(draft->>'courtId', draft->>'court_id')), '') is null then
      raise exception 'missing_recruiting_court' using errcode = '22023';
    end if;
    select coalesce(trust_score, 80) into host_trust from public.profiles where id = safe_actor_id;
    trust_required := case when coalesce((draft->>'ranked')::boolean, true) = false then 0 when coalesce((draft->>'official')::boolean, false) then 80 when visibility = 'public' then 75 else 70 end;
    if host_trust < trust_required then raise exception 'recruiting_host_trust_required' using errcode = '42501'; end if;

    timing_type := case when draft->>'timingType' = 'instant' then 'instant' else 'scheduled' end;
    if timing_type = 'scheduled' then
      schedule_date := nullif(draft->>'scheduledDate', '')::date;
      schedule_time := nullif(draft->>'scheduledTime', '')::time;
      if schedule_date is null or schedule_time is null or schedule_date < current_date
         or schedule_date > (current_date + case when visibility = 'public' then 5 else 30 end) then
        raise exception 'invalid_recruiting_schedule' using errcode = '22023';
      end if;
      if visibility = 'public' and schedule_date::timestamp + schedule_time < now_at + interval '4 hours' then
        raise exception 'public_recruiting_min_lead_time' using errcode = '23514';
      end if;
    end if;
    mmr_range_mode := case when draft->>'mmrRangeMode' in ('narrow', 'normal', 'wide') then draft->>'mmrRangeMode' else 'normal' end;
    mmr_limit_mode := case when draft->>'mmrLimitMode' in ('off', 'warn', 'block') then draft->>'mmrLimitMode' else 'block' end;
    rating_scale := case when coalesce((draft->>'ranked')::boolean, true) = false then 1 when mmr_range_mode = 'narrow' then 1.1 when mmr_range_mode = 'wide' then 0.8 else 1 end;
    opponent_team_id := case when visibility = 'private' and host_join_mode = 'team' then nullif(btrim(coalesce(draft->>'opponentTeamId', draft->>'targetTeamId')), '') else null end;
    opponent_leader_id := nullif(btrim(coalesce(draft->>'opponentLeaderId', draft #>> '{opponentPlayerIds,0}')), '');
    if opponent_team_id is not null and (
      opponent_team_id = host_team_id or opponent_leader_id is null or not exists (
        select 1 from public.team_members where team_id = opponent_team_id and user_id = opponent_leader_id
      )
    ) then raise exception 'recruiting_opponent_team_leader_required' using errcode = '23514'; end if;
    referee_target_id := nullif(btrim(draft->>'refereeId'), '');
    if referee_target_id is not null and not exists (
      select 1 from public.referee_appointments appointment
      join public.profiles profile on profile.id = appointment.user_id
      where appointment.user_id = referee_target_id and appointment.status = 'active'
        and coalesce(appointment.starts_at, now_at) <= now_at and (appointment.ends_at is null or appointment.ends_at > now_at)
        and coalesce(profile.trust_score, 80) >= 90
    ) then raise exception 'recruiting_referee_not_eligible' using errcode = '42501'; end if;

    invitations := '[]'::jsonb;
    if visibility = 'private' and host_join_mode = 'player' then
      for target_user_id in select distinct value from jsonb_array_elements_text(coalesce(draft->'invitePlayerIds', '[]'::jsonb))
      loop
        if target_user_id <> safe_actor_id and exists (select 1 from public.profiles where id = target_user_id) then
          invitation_id := 'inv_' || substr(md5(safe_post_id || ':player:' || target_user_id), 1, 24);
          invitations := invitations || jsonb_build_object(
            'id', invitation_id, 'role', 'player', 'targetUserId', target_user_id, 'fromUserId', safe_actor_id,
            'teamId', null, 'joinMode', 'player', 'side', 'teamB', 'reserve', false,
            'status', 'pending', 'createdAt', now_at, 'updatedAt', now_at
          );
        end if;
      end loop;
    elsif opponent_team_id is not null then
      invitation_id := 'inv_' || substr(md5(safe_post_id || ':team:' || opponent_team_id || ':' || opponent_leader_id), 1, 24);
      invitations := invitations || jsonb_build_object(
        'id', invitation_id, 'role', 'player', 'targetUserId', opponent_leader_id, 'fromUserId', safe_actor_id,
        'teamId', opponent_team_id, 'joinMode', 'team', 'side', 'teamB', 'reserve', false,
        'status', 'pending', 'createdAt', now_at, 'updatedAt', now_at
      );
    end if;
    if referee_target_id is not null then
      invitation_id := 'inv_' || substr(md5(safe_post_id || ':referee:' || referee_target_id), 1, 24);
      invitations := invitations || jsonb_build_object(
        'id', invitation_id, 'role', 'referee', 'targetUserId', referee_target_id, 'fromUserId', safe_actor_id,
        'teamId', null, 'side', 'teamB', 'reserve', false, 'status', 'pending',
        'createdAt', now_at, 'updatedAt', now_at
      );
    end if;
    room_state := jsonb_build_object(
      'ownerId', safe_actor_id,
      'mmrRangeMode', mmr_range_mode,
      'mmrLimitMode', mmr_limit_mode,
      'timingType', timing_type,
      'ruleRevision', 1,
      'teamOnly', host_join_mode = 'team',
      'refereeWanted', coalesce((draft->>'refereeWanted')::boolean, referee_target_id is not null),
      'approvalModeA', case when draft->>'approvalModeA' = 'all' then 'all' else 'leader' end,
      'approvalModeB', case when draft->>'approvalModeB' = 'all' then 'all' else 'leader' end,
      'partyReserves', '{}'::jsonb,
      'partyLeaders', jsonb_build_object('host', safe_actor_id),
      'partySides', jsonb_build_object('host', 'teamA'),
      'invitations', invitations
    );

    insert into public.recruiting_posts (
      id, type, title, visibility, player_id, team_id, region, court_id, court_name, mode,
      scheduled_date, scheduled_time, scheduled_at, ranked, official, pre_registered, rating_scale,
      age_restriction, allowed_age_groups, rules, stakes, court_reserved, court_fee, spots,
      target_team_id, referee_id, referee_trust_min, stat_entry_minutes, dispute_minutes,
      room_state, host_join_mode, host_side, host_ready, side_capacity, player_ids, position,
      memo, status, created_at, updated_at
    ) values (
      safe_post_id,
      case when host_join_mode = 'team' then 'need_team' else 'find_team' end,
      coalesce(nullif(btrim(draft->>'title'), ''), case when coalesce((draft->>'ranked')::boolean, true) then '정규전 ' else '친선전 ' end || coalesce(draft->>'mode', '5v5') || ' 매치 큐'),
      visibility, safe_actor_id, host_team_id,
      coalesce(nullif(btrim(draft->>'region'), ''), (select region from public.profiles where id = safe_actor_id), '전체'),
      nullif(btrim(coalesce(draft->>'courtId', draft->>'court_id')), ''),
      coalesce(nullif(btrim(draft->>'court'), ''), '미정'),
      coalesce(nullif(btrim(draft->>'mode'), ''), side_capacity::text || 'v' || side_capacity::text),
      schedule_date, schedule_time, case when timing_type = 'instant' then '즉시' else schedule_date::text || ' ' || left(schedule_time::text, 5) end,
      coalesce((draft->>'ranked')::boolean, true), coalesce((draft->>'official')::boolean, false), coalesce((draft->>'preRegistered')::boolean, true), rating_scale,
      coalesce(nullif(draft->>'ageRestriction', ''), draft #>> '{rules,ageRestriction}', 'any'),
      coalesce(draft->'allowedAgeGroups', draft #> '{rules,allowedAgeGroups}', '[]'::jsonb),
      coalesce(draft->'rules', '{}'::jsonb) || jsonb_build_object('mmrRangeMode', mmr_range_mode, 'ratingScale', rating_scale),
      coalesce(draft->>'stakes', ''), coalesce((draft->>'courtReserved')::boolean, false), nullif(btrim(coalesce(draft->>'courtFee', '')), ''),
      greatest(0, side_capacity * 2 - 1), opponent_team_id, null, 90, 60, 30,
      room_state, host_join_mode, 'teamA', true, side_capacity,
      case when host_join_mode = 'team' then jsonb_build_array(safe_actor_id) else '[]'::jsonb end,
      coalesce(nullif(draft->>'position', ''), '포지션 자유'),
      left(coalesce(nullif(btrim(draft->>'memo'), ''), case when host_join_mode = 'team' then '팀 대표가 방 안에서 출전/후보 명단을 확정합니다.' else '개인이나 팀 파티로 빈자리에 들어올 수 있습니다.' end), 500),
      'open', now_at, now_at
    );
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      recruiting_post_id, invitation_id, payload, created_at, updated_at
    )
    select
      'notice-recruiting-invite-' || safe_post_id || '-' || (invitation_item.invitation->>'id'),
      invitation_item.invitation->>'targetUserId',
      invitation_item.invitation->>'targetUserId',
      case when invitation_item.invitation->>'role' = 'referee' then '심판 초대' else '매치방 초대' end,
      coalesce(nullif(btrim(draft->>'title'), ''), '매치방') || case
        when invitation_item.invitation->>'role' = 'referee' then ' 심판 초대가 도착했습니다. 수락하면 심판으로 배정됩니다.'
        when invitation_item.invitation->>'joinMode' = 'team' then ' B사이드 파티장 초대장이 도착했습니다. 수락하면 B사이드 참가가 확정됩니다.'
        else ' 초대장이 도착했습니다. 수락하면 B사이드 참가가 확정됩니다.'
      end,
      'match',
      'recruiting_invitation',
      safe_post_id,
      invitation_item.invitation->>'id',
      invitation_item.invitation || jsonb_build_object(
        'targetUserId', invitation_item.invitation->>'targetUserId',
        'recruitingPostId', safe_post_id,
        'invitationId', invitation_item.invitation->>'id'
      ),
      now_at,
      now_at
    from jsonb_array_elements(invitations) invitation_item(invitation)
    on conflict (id) do update set
      target_user_id = excluded.target_user_id,
      body = excluded.body,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
    created_count := jsonb_array_length(invitations);
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'invitationCount', created_count, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  select * into current_post from public.recruiting_posts where id = safe_post_id for update;
  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;
  if current_post.status <> 'open' then raise exception 'recruiting_room_not_open' using errcode = '23514'; end if;
  room_state := coalesce(current_post.room_state, '{}'::jsonb);
  invitations := coalesce(room_state->'invitations', '[]'::jsonb);
  side_capacity := current_post.side_capacity;

  if safe_action = 'interestRecruitingPost' then
    payload := coalesce(p_operation->'application', '{}'::jsonb);
    join_mode := lower(coalesce(nullif(btrim(payload->>'joinMode'), ''), nullif(btrim(p_operation->>'joinMode'), ''), 'player'));
    if current_post.player_id = safe_actor_id or public.rankball_recruiting_is_related(current_post, safe_actor_id) then
      return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'noop', true, 'sqlReducer', true, 'advisoryLocked', true);
    end if;
    if current_post.visibility <> 'public' then raise exception 'recruiting_private_room' using errcode = '42501'; end if;

    if join_mode = 'referee' then
      if coalesce((room_state->>'refereeWanted')::boolean, false) = false or current_post.referee_id is not null then
        raise exception 'referee_join_not_available' using errcode = '23514';
      end if;
      if not exists (
        select 1 from public.referee_appointments appointment
        join public.profiles profile on profile.id = appointment.user_id
        where appointment.user_id = safe_actor_id and appointment.status = 'active'
          and coalesce(appointment.starts_at, now_at) <= now_at
          and (appointment.ends_at is null or appointment.ends_at > now_at)
          and coalesce(profile.trust_score, 80) >= current_post.referee_trust_min
      ) then raise exception 'referee_not_eligible' using errcode = '42501'; end if;
      select coalesce(jsonb_agg(item.value), '[]'::jsonb) into invitations
      from jsonb_array_elements(invitations) item(value)
      where item.value->>'role' <> 'referee';
      update public.recruiting_posts
      set referee_id = safe_actor_id,
          room_state = jsonb_set(management.room_state || jsonb_build_object('refereeWanted', true), '{invitations}', invitations, true),
          updated_at = now_at
      where id = safe_post_id;
      return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'refereeId', safe_actor_id, 'sqlReducer', true, 'advisoryLocked', true);
    end if;

    if join_mode = 'team' then
      target_team_id := nullif(btrim(payload->>'teamId'), '');
      if side_capacity = 1 and current_post.host_join_mode = 'player' then
        raise exception 'solo_room_team_party_not_allowed' using errcode = '23514';
      end if;
      if target_team_id is null or not exists (
        select 1 from public.team_members where team_id = target_team_id and user_id = safe_actor_id
      ) then raise exception 'recruiting_team_membership_required' using errcode = '42501'; end if;
      safe_side := case
        when payload->>'side' in ('teamA', 'teamB') then payload->>'side'
        when public.rankball_recruiting_side_active_count(current_post, 'teamA') <= public.rankball_recruiting_side_active_count(current_post, 'teamB') then 'teamA'
        else 'teamB'
      end;
      if exists (
        select 1 from public.recruiting_applications
        where post_id = safe_post_id and team_id = target_team_id and side <> safe_side
      ) then raise exception 'recruiting_team_side_conflict' using errcode = '23514'; end if;
      select coalesce(jsonb_agg(player_id order by ordinality), '[]'::jsonb) into selected_players
      from (
        select member.user_id as player_id, min(candidate.ordinality) as ordinality
        from (
          select safe_actor_id as player_id, 0::bigint as ordinality
          union all
          select value, ordinality from jsonb_array_elements_text(coalesce(payload->'playerIds', '[]'::jsonb)) with ordinality requested(value, ordinality)
        ) candidate
        join public.team_members member on member.team_id = target_team_id and member.user_id = candidate.player_id
        group by member.user_id
        order by min(candidate.ordinality)
        limit side_capacity
      ) selected;
      if jsonb_array_length(selected_players) = 0 then raise exception 'recruiting_team_roster_required' using errcode = '23514'; end if;
      reserve := coalesce((payload->>'reserve')::boolean, false);
      active_count := public.rankball_recruiting_side_active_count(current_post, safe_side);
      if not reserve and active_count + jsonb_array_length(selected_players) > side_capacity then
        select coalesce(jsonb_agg(value), '[]'::jsonb) into selected_players
        from (
          select value from jsonb_array_elements_text(selected_players)
          limit greatest(0, side_capacity - active_count)
        ) available(value);
        if jsonb_array_length(selected_players) = 0 then reserve := true; end if;
      end if;
      reserve_count := public.rankball_recruiting_side_reserve_count(current_post, safe_side);
      if reserve and reserve_count + greatest(1, jsonb_array_length(selected_players)) > 2 then
        raise exception 'recruiting_reserve_full' using errcode = '23514';
      end if;
      safe_entry_id := 'team:' || target_team_id;
      insert into public.recruiting_applications (
        post_id, player_id, team_id, kind, side, status, reserve, position, player_ids, created_at, updated_at
      ) values (
        safe_post_id, safe_actor_id, target_team_id, 'team', safe_side, 'ready', reserve, null, selected_players, now_at, now_at
      )
      on conflict (post_id, player_id, kind) do update set
        team_id = excluded.team_id, side = excluded.side, status = 'ready', reserve = excluded.reserve,
        player_ids = excluded.player_ids, updated_at = now_at;
      selected_reserves := coalesce(payload->'reservePlayerIds', '[]'::jsonb);
      select coalesce(jsonb_agg(value), '[]'::jsonb) into selected_reserves
      from (
        select distinct requested.value
        from jsonb_array_elements_text(selected_reserves) requested(value)
        join public.team_members member on member.team_id = target_team_id and member.user_id = requested.value
        where not selected_players ? requested.value
        limit 2
      ) reserves(value);
      room_state := room_state || jsonb_build_object(
        'partyReserves', jsonb_set(coalesce(room_state->'partyReserves', '{}'::jsonb), array[safe_entry_id], selected_reserves, true),
        'partyLeaders', jsonb_set(coalesce(room_state->'partyLeaders', '{}'::jsonb), array[safe_entry_id], to_jsonb(safe_actor_id), true),
        'partySides', jsonb_set(coalesce(room_state->'partySides', '{}'::jsonb), array[safe_entry_id], to_jsonb(safe_side), true)
      );
      update public.recruiting_posts set room_state = management.room_state, updated_at = now_at where id = safe_post_id;
      return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'entryId', safe_entry_id, 'sqlReducer', true, 'advisoryLocked', true);
    end if;

    raise exception 'unsupported_interest_join_mode' using errcode = '23514';
  end if;

  if safe_action in ('inviteRecruitingReferee', 'inviteRecruitingPlayers') then
    if not public.rankball_recruiting_is_related(current_post, safe_actor_id) then
      raise exception 'recruiting_invite_permission_denied' using errcode = '42501';
    end if;
    if safe_action = 'inviteRecruitingReferee' then
      target_user_ids := jsonb_build_array(nullif(btrim(p_operation->>'refereeId'), ''));
      join_mode := 'referee';
      safe_side := 'teamB';
      reserve := false;
    else
      payload := coalesce(p_operation->'invite', '{}'::jsonb);
      target_user_ids := coalesce(payload->'playerIds', jsonb_build_array(payload->>'playerId'));
      join_mode := case when payload->>'joinMode' = 'team' then 'team' else 'player' end;
      target_team_id := nullif(btrim(payload->>'teamId'), '');
      safe_side := case when payload->>'side' = 'teamA' then 'teamA' else 'teamB' end;
      reserve := coalesce((payload->>'reserve')::boolean, false);
    end if;
    for target_user_id in select distinct value from jsonb_array_elements_text(target_user_ids)
    loop
      if target_user_id is null or target_user_id = safe_actor_id or not exists (select 1 from public.profiles where id = target_user_id) then continue; end if;
      if exists (
        select 1 from jsonb_array_elements(invitations) item
        where item->>'targetUserId' = target_user_id and coalesce(item->>'status', 'pending') = 'pending'
      ) or public.rankball_recruiting_is_related(current_post, target_user_id) then continue; end if;
      if join_mode = 'referee' then
        if current_post.referee_id is not null or not exists (
          select 1 from public.referee_appointments appointment
          join public.profiles profile on profile.id = appointment.user_id
          where appointment.user_id = target_user_id and appointment.status = 'active'
            and coalesce(appointment.starts_at, now_at) <= now_at and (appointment.ends_at is null or appointment.ends_at > now_at)
            and coalesce(profile.trust_score, 80) >= current_post.referee_trust_min
        ) then raise exception 'recruiting_referee_not_eligible' using errcode = '42501'; end if;
      elsif target_team_id is not null and not exists (
        select 1 from public.team_members where team_id = target_team_id and user_id = target_user_id
      ) then raise exception 'recruiting_team_invite_membership_required' using errcode = '42501'; end if;
      invitation_id := 'inv_' || substr(md5(safe_post_id || ':' || join_mode || ':' || target_user_id || ':' || now_at::text), 1, 24);
      invitation_row := jsonb_build_object(
        'id', invitation_id, 'role', case when join_mode = 'referee' then 'referee' else 'player' end,
        'targetUserId', target_user_id, 'fromUserId', safe_actor_id, 'teamId', target_team_id,
        'joinMode', join_mode, 'side', safe_side, 'reserve', reserve, 'status', 'pending',
        'createdAt', now_at, 'updatedAt', now_at
      );
      invitations := invitations || invitation_row;
      insert into public.notifications (
        id, user_id, target_user_id, title, body, tone, type,
        recruiting_post_id, invitation_id, payload, created_at, updated_at
      ) values (
        'notice-recruiting-invite-' || safe_post_id || '-' || invitation_id,
        target_user_id,
        target_user_id,
        case when join_mode = 'referee' then '심판 초대' else '매치방 초대' end,
        current_post.title || case
          when join_mode = 'referee' then ' 심판 초대가 도착했습니다. 수락하면 심판으로 배정됩니다.'
          when join_mode = 'team' then ' 파티장 초대장이 도착했습니다. 수락하면 참가가 확정됩니다.'
          else ' 초대장이 도착했습니다. 수락하면 참가가 확정됩니다.'
        end,
        'match',
        'recruiting_invitation',
        safe_post_id,
        invitation_id,
        invitation_row || jsonb_build_object(
          'targetUserId', target_user_id,
          'recruitingPostId', safe_post_id,
          'invitationId', invitation_id
        ),
        now_at,
        now_at
      ) on conflict (id) do update set
        target_user_id = excluded.target_user_id,
        body = excluded.body,
        payload = excluded.payload,
        updated_at = excluded.updated_at;
      created_count := created_count + 1;
    end loop;
    if created_count = 0 then raise exception 'recruiting_invite_target_missing' using errcode = '23514'; end if;
    update public.recruiting_posts
    set room_state = jsonb_set(management.room_state || case when join_mode = 'referee' then jsonb_build_object('refereeWanted', true) else '{}'::jsonb end, '{invitations}', invitations, true),
        updated_at = now_at
    where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'invitationCount', created_count, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  if safe_action in ('acceptRecruitingInvitation', 'declineRecruitingInvitation') then
    invitation_id := nullif(btrim(p_operation->>'invitationId'), '');
    select value into invitation
    from jsonb_array_elements(invitations)
    where value->>'id' = invitation_id and value->>'targetUserId' = safe_actor_id and coalesce(value->>'status', 'pending') = 'pending'
    limit 1;
    if invitation is null then raise exception 'recruiting_invitation_not_found' using errcode = 'P0002'; end if;
    if safe_action = 'declineRecruitingInvitation' then
      invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'declined', now_at);
      update public.recruiting_posts set room_state = jsonb_set(management.room_state, '{invitations}', invitations, true), updated_at = now_at where id = safe_post_id;
      return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sqlReducer', true, 'advisoryLocked', true);
    end if;
    safe_side := case when invitation->>'side' = 'teamA' then 'teamA' else 'teamB' end;
    reserve := coalesce((invitation->>'reserve')::boolean, false);
    if invitation->>'role' = 'referee' then
      if current_post.referee_id is not null or public.rankball_recruiting_is_related(current_post, safe_actor_id)
         or not exists (
           select 1 from public.referee_appointments appointment
           join public.profiles profile on profile.id = appointment.user_id
           where appointment.user_id = safe_actor_id and appointment.status = 'active'
             and coalesce(appointment.starts_at, now_at) <= now_at and (appointment.ends_at is null or appointment.ends_at > now_at)
             and coalesce(profile.trust_score, 80) >= current_post.referee_trust_min
         ) then raise exception 'recruiting_referee_accept_blocked' using errcode = '42501'; end if;
      invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'accepted', now_at);
      update public.recruiting_posts
      set referee_id = safe_actor_id,
          room_state = jsonb_set(management.room_state || jsonb_build_object('refereeWanted', true), '{invitations}', invitations, true),
          updated_at = now_at
      where id = safe_post_id;
      return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'refereeId', safe_actor_id, 'sqlReducer', true, 'advisoryLocked', true);
    end if;

    target_team_id := nullif(btrim(invitation->>'teamId'), '');
    if target_team_id is not null and not exists (select 1 from public.team_members where team_id = target_team_id and user_id = safe_actor_id) then
      raise exception 'recruiting_team_membership_required' using errcode = '42501';
    end if;
    active_count := public.rankball_recruiting_side_active_count(current_post, safe_side);
    reserve_count := public.rankball_recruiting_side_reserve_count(current_post, safe_side);
    if not reserve and active_count >= side_capacity then reserve := true; end if;
    if reserve and reserve_count >= 2 then
      invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'expired', now_at);
      update public.recruiting_posts
      set room_state = jsonb_set(management.room_state, '{invitations}', invitations, true), updated_at = now_at
      where id = safe_post_id;
      update public.notifications notice
      set read_at = coalesce(read_at, now_at), updated_at = now_at
      where notice.recruiting_post_id = safe_post_id
        and notice.invitation_id = management.invitation_id
        and notice.target_user_id = safe_actor_id;
      return jsonb_build_object(
        'ok', true,
        'action', safe_action,
        'postId', safe_post_id,
        'invitationExpired', true,
        'reason', 'recruiting_reserve_full',
        'sqlReducer', true,
        'advisoryLocked', true
      );
    end if;

    if target_team_id is null then
      insert into public.recruiting_applications (post_id, player_id, team_id, kind, side, status, reserve, position, player_ids, created_at, updated_at)
      values (safe_post_id, safe_actor_id, null, 'player', safe_side, 'ready', reserve, (select position from public.profiles where id = safe_actor_id), '[]'::jsonb, now_at, now_at)
      on conflict (post_id, player_id, kind) do update set side = excluded.side, status = 'ready', reserve = excluded.reserve, updated_at = now_at;
    else
      select * into application_row
      from public.recruiting_applications
      where post_id = safe_post_id and team_id = target_team_id and kind = 'team'
      order by created_at limit 1 for update;
      safe_entry_id := 'team:' || target_team_id;
      party_reserves := coalesce(room_state->'partyReserves', '{}'::jsonb);
      party_leaders := coalesce(room_state->'partyLeaders', '{}'::jsonb);
      party_sides := coalesce(room_state->'partySides', '{}'::jsonb);
      if application_row.post_id is null then
        next_player_ids := case when reserve then '[]'::jsonb else jsonb_build_array(safe_actor_id) end;
        insert into public.recruiting_applications (post_id, player_id, team_id, kind, side, status, reserve, position, player_ids, created_at, updated_at)
        values (safe_post_id, safe_actor_id, target_team_id, 'team', safe_side, 'ready', false, null, next_player_ids, now_at, now_at);
        party_leaders := jsonb_set(party_leaders, array[safe_entry_id], to_jsonb(safe_actor_id), true);
      else
        next_player_ids := coalesce(application_row.player_ids, '[]'::jsonb);
        if not reserve and not next_player_ids ? safe_actor_id then next_player_ids := next_player_ids || to_jsonb(safe_actor_id); end if;
        update public.recruiting_applications set player_ids = next_player_ids, status = 'ready', updated_at = now_at
        where post_id = application_row.post_id and player_id = application_row.player_id and kind = application_row.kind;
      end if;
      next_reserve_ids := coalesce(party_reserves->safe_entry_id, '[]'::jsonb);
      if reserve and not next_reserve_ids ? safe_actor_id then next_reserve_ids := next_reserve_ids || to_jsonb(safe_actor_id); end if;
      if not reserve then next_reserve_ids := coalesce((select jsonb_agg(item.value) from jsonb_array_elements_text(next_reserve_ids) item(value) where item.value <> safe_actor_id), '[]'::jsonb); end if;
      party_reserves := jsonb_set(party_reserves, array[safe_entry_id], next_reserve_ids, true);
      party_sides := jsonb_set(party_sides, array[safe_entry_id], to_jsonb(safe_side), true);
      room_state := room_state || jsonb_build_object('partyReserves', party_reserves, 'partyLeaders', party_leaders, 'partySides', party_sides);
    end if;
    invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'accepted', now_at);
    update public.recruiting_posts set room_state = jsonb_set(management.room_state, '{invitations}', invitations, true), updated_at = now_at where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sideName', safe_side, 'reserve', reserve, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  if safe_action = 'updateRecruitingRoomRules' then
    if current_post.player_id <> safe_actor_id then raise exception 'recruiting_owner_required' using errcode = '42501'; end if;
    payload := coalesce(p_operation->'patch', '{}'::jsonb);
    side_capacity := greatest(1, least(5, coalesce((payload->>'sideCapacity')::integer, current_post.side_capacity)));
    if public.rankball_recruiting_side_active_count(current_post, 'teamA') > side_capacity
       or public.rankball_recruiting_side_active_count(current_post, 'teamB') > side_capacity then
      raise exception 'recruiting_side_capacity_below_roster' using errcode = '23514';
    end if;
    mmr_range_mode := case when payload->>'mmrRangeMode' in ('narrow', 'normal', 'wide') then payload->>'mmrRangeMode' else coalesce(room_state->>'mmrRangeMode', 'normal') end;
    rating_scale := case when current_post.ranked = false then 1 when mmr_range_mode = 'narrow' then 1.1 when mmr_range_mode = 'wide' then 0.8 else 1 end;
    room_state := room_state || jsonb_build_object(
      'mmrRangeMode', mmr_range_mode,
      'ruleRevision', coalesce((room_state->>'ruleRevision')::integer, 0) + 1,
      'ruleChangedAt', now_at
    );
    update public.recruiting_posts
    set mode = management.side_capacity::text || 'v' || management.side_capacity::text,
        side_capacity = management.side_capacity,
        court_id = case when payload ? 'courtId' then nullif(btrim(payload->>'courtId'), '') else court_id end,
        court_name = case when payload ? 'court' then left(coalesce(nullif(btrim(payload->>'court'), ''), court_name), 80) else court_name end,
        rating_scale = management.rating_scale,
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'targetScore', greatest(7, least(31, coalesce((payload->>'targetScore')::integer, (rules->>'targetScore')::integer, 21))),
          'timeLimit', greatest(5, least(60, coalesce((payload->>'timeLimit')::integer, (rules->>'timeLimit')::integer, 12))),
          'winByTwo', coalesce((payload->>'winByTwo')::boolean, (rules->>'winByTwo')::boolean, true),
          'ball', coalesce(nullif(payload->>'ball', ''), rules->>'ball', '7호 공'),
          'attackRule', left(coalesce(nullif(payload->>'attackRule', ''), rules->>'attackRule', '득점 후 공격권 교대'), 120),
          'foulRule', left(coalesce(nullif(payload->>'foulRule', ''), rules->>'foulRule', '파울 콜 즉시 중단, 공격권 유지'), 120),
          'mmrRangeMode', mmr_range_mode,
          'ratingScale', management.rating_scale
        ),
        memo = case when payload ? 'memo' then left(coalesce(payload->>'memo', ''), 500) else memo end,
        host_ready = true,
        room_state = management.room_state,
        updated_at = now_at
    where id = safe_post_id;
    update public.recruiting_applications set status = 'ready', updated_at = now_at where post_id = safe_post_id;
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      recruiting_post_id, payload, created_at, updated_at
    )
    select
      'notice-recruiting-rules-' || safe_post_id || '-' || coalesce((management.room_state->>'ruleRevision')::integer, 1)::text || '-' || profile.id,
      profile.id,
      profile.id,
      '매칭방 룰 변경',
      current_post.title || ' 룰이 바뀌어 참여자 재확인이 필요합니다.',
      'match',
      'recruiting_rules_changed',
      safe_post_id,
      jsonb_build_object(
        'targetUserId', profile.id,
        'recruitingPostId', safe_post_id,
        'ruleRevision', coalesce((management.room_state->>'ruleRevision')::integer, 1),
        'actionRequired', true
      ),
      now_at,
      now_at
    from public.profiles profile
    where public.rankball_recruiting_is_related(current_post, profile.id)
    on conflict (id) do update set
      body = excluded.body,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  if safe_action in ('setRecruitingApplicantReserve', 'setRecruitingApplicantPlacement') then
    safe_player_id := coalesce(nullif(btrim(p_operation->>'playerId'), ''), safe_actor_id);
    if safe_player_id = current_post.player_id then
      if safe_actor_id <> current_post.player_id then raise exception 'recruiting_placement_permission_denied' using errcode = '42501'; end if;
      safe_side := current_post.host_side;
      if p_operation #>> '{placement,side}' in ('teamA', 'teamB') and p_operation #>> '{placement,side}' <> safe_side then
        raise exception 'recruiting_host_side_locked' using errcode = '23514';
      end if;
      reserve := case
        when safe_action = 'setRecruitingApplicantReserve' then coalesce((p_operation->>'reserve')::boolean, false)
        else coalesce((p_operation #>> '{placement,reserve}')::boolean, false)
      end;
      if reserve and coalesce(room_state->>'hostReserve', 'false') not in ('true', '1')
         and public.rankball_recruiting_side_reserve_count(current_post, safe_side) >= 2 then
        raise exception 'recruiting_reserve_full' using errcode = '23514';
      end if;
      if not reserve and coalesce(room_state->>'hostReserve', 'false') in ('true', '1')
         and public.rankball_recruiting_side_active_count(current_post, safe_side) >= side_capacity then
        raise exception 'recruiting_side_full' using errcode = '23514';
      end if;
      select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb) into payload
      from (
        select key, coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_player_id), '[]'::jsonb) as filtered_ids
        from jsonb_each(case when jsonb_typeof(room_state->'pinnedReservePlayers') = 'object' then room_state->'pinnedReservePlayers' else '{}'::jsonb end) entry(key, raw_ids)
        left join lateral jsonb_array_elements_text(case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end) ids(value) on true
        group by key
      ) cleaned
      where jsonb_array_length(filtered_ids) > 0;
      if reserve then
        selected_reserves := coalesce(payload->safe_side, '[]'::jsonb);
        if not selected_reserves ? safe_player_id then selected_reserves := selected_reserves || to_jsonb(safe_player_id); end if;
        payload := jsonb_set(payload, array[safe_side], selected_reserves, true);
      end if;
      selected_players := case when jsonb_typeof(room_state->'statRecorders') = 'object' then room_state->'statRecorders' else '{}'::jsonb end;
      if not reserve then
        if selected_players->>'teamA' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamA}', to_jsonb(''::text), true); end if;
        if selected_players->>'teamB' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamB}', to_jsonb(''::text), true); end if;
      end if;
      room_state := room_state || jsonb_build_object(
        'hostReserve', reserve,
        'pinnedReservePlayers', payload,
        'statRecorders', selected_players
      );
      update public.recruiting_posts
      set host_ready = true, room_state = management.room_state, updated_at = now_at
      where id = safe_post_id;
      return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'playerId', safe_player_id, 'sideName', safe_side, 'reserve', reserve, 'sqlReducer', true, 'advisoryLocked', true);
    end if;
    select * into application_row from public.recruiting_applications
    where post_id = safe_post_id and (player_id = safe_player_id or coalesce(player_ids, '[]'::jsonb) ? safe_player_id)
    order by kind limit 1 for update;
    if application_row.post_id is null then raise exception 'recruiting_applicant_not_found' using errcode = 'P0002'; end if;
    if safe_actor_id not in (current_post.player_id, application_row.player_id, safe_player_id) then raise exception 'recruiting_placement_permission_denied' using errcode = '42501'; end if;
    safe_side := case when p_operation #>> '{placement,side}' = 'teamA' then 'teamA' when p_operation #>> '{placement,side}' = 'teamB' then 'teamB' else application_row.side end;
    reserve := case when safe_action = 'setRecruitingApplicantReserve' then coalesce((p_operation->>'reserve')::boolean, false) else coalesce((p_operation #>> '{placement,reserve}')::boolean, application_row.reserve) end;
    if (current_post.host_join_mode = 'team' or current_post.team_id is not null)
       and (current_post.visibility = 'private' or coalesce(room_state->>'teamOnly', 'false') in ('true', '1'))
       and safe_side <> application_row.side then
      raise exception 'recruiting_team_side_locked' using errcode = '23514';
    end if;
    if not reserve and (application_row.reserve or safe_side <> application_row.side)
       and public.rankball_recruiting_side_active_count(current_post, safe_side) >= side_capacity then
      raise exception 'recruiting_side_full' using errcode = '23514';
    end if;
    if reserve and (not application_row.reserve or safe_side <> application_row.side)
       and public.rankball_recruiting_side_reserve_count(current_post, safe_side) >= 2 then
      raise exception 'recruiting_reserve_full' using errcode = '23514';
    end if;
    select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb) into payload
    from (
      select key, coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_player_id), '[]'::jsonb) as filtered_ids
      from jsonb_each(case when jsonb_typeof(room_state->'pinnedReservePlayers') = 'object' then room_state->'pinnedReservePlayers' else '{}'::jsonb end) entry(key, raw_ids)
      left join lateral jsonb_array_elements_text(case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end) ids(value) on true
      group by key
    ) cleaned
    where jsonb_array_length(filtered_ids) > 0;
    if reserve then
      selected_reserves := coalesce(payload->safe_side, '[]'::jsonb);
      if not selected_reserves ? safe_player_id then selected_reserves := selected_reserves || to_jsonb(safe_player_id); end if;
      payload := jsonb_set(payload, array[safe_side], selected_reserves, true);
    end if;
    selected_players := case when jsonb_typeof(room_state->'statRecorders') = 'object' then room_state->'statRecorders' else '{}'::jsonb end;
    if not reserve or safe_side <> application_row.side then
      if selected_players->>'teamA' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamA}', to_jsonb(''::text), true); end if;
      if selected_players->>'teamB' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamB}', to_jsonb(''::text), true); end if;
    end if;
    update public.recruiting_applications set side = safe_side, reserve = management.reserve, status = 'ready', updated_at = now_at
    where post_id = application_row.post_id and player_id = application_row.player_id and kind = application_row.kind;
    update public.recruiting_posts
    set room_state = management.room_state || jsonb_build_object('pinnedReservePlayers', payload, 'statRecorders', selected_players), updated_at = now_at
    where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  if safe_action = 'joinRecruitingSideParty' then
    target_team_id := nullif(btrim(p_operation->>'teamId'), '');
    safe_side := case when p_operation->>'sideName' = 'teamA' then 'teamA' else 'teamB' end;
    if target_team_id is null or not exists (select 1 from public.team_members where team_id = target_team_id and user_id = safe_actor_id) then
      raise exception 'recruiting_team_membership_required' using errcode = '42501';
    end if;
    if exists (select 1 from public.recruiting_applications where post_id = safe_post_id and team_id = target_team_id and side <> safe_side) then
      raise exception 'recruiting_team_side_conflict' using errcode = '23514';
    end if;
    safe_entry_id := coalesce(nullif(btrim(p_operation->>'entryId'), ''), 'team:' || target_team_id);
    insert into public.recruiting_applications (post_id, player_id, team_id, kind, side, status, reserve, player_ids, created_at, updated_at)
    values (safe_post_id, safe_actor_id, target_team_id, 'team', safe_side, 'ready', false, jsonb_build_array(safe_actor_id), now_at, now_at)
    on conflict (post_id, player_id, kind) do update set team_id = excluded.team_id, side = excluded.side, status = 'ready', reserve = false, player_ids = excluded.player_ids, updated_at = now_at;
    room_state := room_state || jsonb_build_object(
      'partyLeaders', jsonb_set(coalesce(room_state->'partyLeaders', '{}'::jsonb), array[safe_entry_id], to_jsonb(safe_actor_id), true),
      'partySides', jsonb_set(coalesce(room_state->'partySides', '{}'::jsonb), array[safe_entry_id], to_jsonb(safe_side), true)
    );
    update public.recruiting_posts set room_state = management.room_state, updated_at = now_at where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'entryId', safe_entry_id, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  if safe_action in ('setRecruitingTeamPartyRoster', 'setRecruitingPartyPlayerReserve', 'setRecruitingPartyPlayerPlacement', 'detachRecruitingPartyPlayer', 'removeRecruitingPartyPlayer') then
    safe_entry_id := nullif(btrim(p_operation->>'entryId'), '');
    target_team_id := case when safe_entry_id like 'team:%' then substring(safe_entry_id from 6) else null end;
    if safe_entry_id = 'host' then target_team_id := current_post.team_id; end if;
    select * into application_row
    from public.recruiting_applications
    where post_id = safe_post_id and team_id = target_team_id and kind = 'team'
    order by created_at limit 1 for update;
    leader_id := coalesce(room_state #>> array['partyLeaders', safe_entry_id], case when safe_entry_id = 'host' then current_post.player_id else application_row.player_id end);
    if leader_id is null then raise exception 'recruiting_party_leader_required' using errcode = '42501'; end if;
    if safe_action = 'setRecruitingTeamPartyRoster' and safe_actor_id <> leader_id then
      raise exception 'recruiting_party_leader_required' using errcode = '42501';
    end if;
    if safe_action = 'removeRecruitingPartyPlayer' and safe_actor_id <> current_post.player_id then
      raise exception 'recruiting_owner_required' using errcode = '42501';
    end if;
    select coalesce(jsonb_agg(user_id), '[]'::jsonb) into team_member_ids from public.team_members where team_id = target_team_id;
    if jsonb_array_length(team_member_ids) = 0 then raise exception 'recruiting_team_not_found' using errcode = 'P0002'; end if;
    party_reserves := coalesce(room_state->'partyReserves', '{}'::jsonb);
    party_leaders := coalesce(room_state->'partyLeaders', '{}'::jsonb);
    party_sides := coalesce(room_state->'partySides', '{}'::jsonb);
    safe_side := coalesce(room_state #>> array['partySides', safe_entry_id], case when safe_entry_id = 'host' then current_post.host_side else application_row.side end, 'teamB');
    previous_side := safe_side;
    next_player_ids := case when safe_entry_id = 'host' then coalesce(current_post.player_ids, '[]'::jsonb) else coalesce(application_row.player_ids, '[]'::jsonb) end;
    next_reserve_ids := coalesce(party_reserves->safe_entry_id, '[]'::jsonb);
    target_user_ids := next_reserve_ids;
    selected_players := case when jsonb_typeof(room_state->'statRecorders') = 'object' then room_state->'statRecorders' else '{}'::jsonb end;

    if safe_action = 'setRecruitingTeamPartyRoster' then
      select coalesce(jsonb_agg(player_id order by ordinality), '[]'::jsonb) into selected_players
      from (
        select player_id, ordinality
        from jsonb_array_elements_text(coalesce(p_operation #> '{roster,playerIds}', '[]'::jsonb)) with ordinality player(player_id, ordinality)
        where team_member_ids ? player_id
        order by ordinality limit side_capacity
      ) selected;
      select coalesce(jsonb_agg(player_id order by ordinality), '[]'::jsonb) into selected_reserves
      from (
        select player_id, ordinality
        from jsonb_array_elements_text(coalesce(p_operation #> '{roster,reservePlayerIds}', '[]'::jsonb)) with ordinality player(player_id, ordinality)
        where team_member_ids ? player_id and not selected_players ? player_id
        order by ordinality limit 2
      ) selected;
      if not (selected_players || selected_reserves) ? leader_id then raise exception 'recruiting_party_leader_required' using errcode = '23514'; end if;
      next_player_ids := selected_players;
      next_reserve_ids := selected_reserves;
    else
      safe_player_id := nullif(btrim(p_operation->>'playerId'), '');
      if safe_player_id is null or not team_member_ids ? safe_player_id then raise exception 'recruiting_party_player_not_found' using errcode = 'P0002'; end if;
      if not (next_player_ids || next_reserve_ids) ? safe_player_id then raise exception 'recruiting_party_player_not_found' using errcode = 'P0002'; end if;
      if safe_action = 'detachRecruitingPartyPlayer' and safe_actor_id not in (current_post.player_id, leader_id, safe_player_id) then
        raise exception 'recruiting_party_detach_permission_denied' using errcode = '42501';
      end if;
      if safe_action in ('setRecruitingPartyPlayerReserve', 'setRecruitingPartyPlayerPlacement') and safe_actor_id not in (leader_id, safe_player_id) then
        raise exception 'recruiting_party_leader_required' using errcode = '42501';
      end if;
      if safe_action = 'removeRecruitingPartyPlayer' and safe_entry_id = 'host' and safe_player_id = current_post.player_id then
        raise exception 'recruiting_host_cannot_be_removed' using errcode = '23514';
      end if;
      next_player_ids := coalesce((select jsonb_agg(item.value) from jsonb_array_elements_text(next_player_ids) item(value) where item.value <> safe_player_id), '[]'::jsonb);
      next_reserve_ids := coalesce((select jsonb_agg(item.value) from jsonb_array_elements_text(next_reserve_ids) item(value) where item.value <> safe_player_id), '[]'::jsonb);
      if safe_action in ('setRecruitingPartyPlayerReserve', 'setRecruitingPartyPlayerPlacement') then
        reserve := case when safe_action = 'setRecruitingPartyPlayerReserve' then coalesce((p_operation->>'reserve')::boolean, false) else coalesce((p_operation #>> '{placement,reserve}')::boolean, false) end;
        if safe_action = 'setRecruitingPartyPlayerPlacement'
           and p_operation #>> '{placement,side}' in ('teamA', 'teamB')
           and p_operation #>> '{placement,side}' <> safe_side then
          raise exception 'recruiting_party_side_locked' using errcode = '23514';
        end if;
        if reserve then
          if jsonb_array_length(next_reserve_ids) >= 2 then raise exception 'recruiting_reserve_full' using errcode = '23514'; end if;
          next_reserve_ids := next_reserve_ids || to_jsonb(safe_player_id);
        else
          if jsonb_array_length(next_player_ids) >= side_capacity then raise exception 'recruiting_side_full' using errcode = '23514'; end if;
          next_player_ids := next_player_ids || to_jsonb(safe_player_id);
        end if;
      elsif safe_action = 'detachRecruitingPartyPlayer' then
        reserve := coalesce((p_operation #>> '{placement,reserve}')::boolean, false);
        safe_side := case when p_operation #>> '{placement,side}' = 'teamA' then 'teamA' when p_operation #>> '{placement,side}' = 'teamB' then 'teamB' else safe_side end;
        insert into public.recruiting_applications (post_id, player_id, kind, side, status, reserve, position, player_ids, source_team_id, source_entry_id, created_at, updated_at)
        values (safe_post_id, safe_player_id, 'player', safe_side, 'ready', reserve, (select position from public.profiles where id = safe_player_id), '[]'::jsonb, target_team_id, safe_entry_id, now_at, now_at)
        on conflict (post_id, player_id, kind) do update set side = excluded.side, reserve = excluded.reserve, status = 'ready', source_team_id = excluded.source_team_id, source_entry_id = excluded.source_entry_id, updated_at = now_at;
      end if;
    end if;

    for target_user_id in select value from jsonb_array_elements_text(target_user_ids) reserve_player(value)
    loop
      if not next_reserve_ids ? target_user_id
         and not (safe_action = 'detachRecruitingPartyPlayer' and safe_player_id = target_user_id and reserve and safe_side = previous_side) then
        if selected_players->>'teamA' = target_user_id then selected_players := jsonb_set(selected_players, '{teamA}', to_jsonb(''::text), true); end if;
        if selected_players->>'teamB' = target_user_id then selected_players := jsonb_set(selected_players, '{teamB}', to_jsonb(''::text), true); end if;
      end if;
    end loop;
    if safe_player_id is not null and (
      safe_action = 'removeRecruitingPartyPlayer'
      or (safe_action in ('setRecruitingPartyPlayerReserve', 'setRecruitingPartyPlayerPlacement') and not reserve)
      or (safe_action = 'detachRecruitingPartyPlayer' and (not reserve or safe_side <> previous_side))
    ) then
      if selected_players->>'teamA' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamA}', to_jsonb(''::text), true); end if;
      if selected_players->>'teamB' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamB}', to_jsonb(''::text), true); end if;
    end if;

    party_reserves := jsonb_set(party_reserves, array[safe_entry_id], next_reserve_ids, true);
    party_sides := jsonb_set(party_sides, array[safe_entry_id], to_jsonb(safe_side), true);
    if not (next_player_ids || next_reserve_ids) ? leader_id then
      leader_id := coalesce(next_player_ids->>0, next_reserve_ids->>0);
      party_leaders := case
        when leader_id is null then party_leaders - safe_entry_id
        else jsonb_set(party_leaders, array[safe_entry_id], to_jsonb(leader_id), true)
      end;
    end if;
    if safe_entry_id = 'host' then
      update public.recruiting_posts
      set player_ids = next_player_ids,
          room_state = management.room_state || jsonb_build_object('partyReserves', party_reserves, 'partyLeaders', party_leaders, 'partySides', party_sides, 'statRecorders', selected_players),
          updated_at = now_at
      where id = safe_post_id;
    else
      if jsonb_array_length(next_player_ids) = 0 and jsonb_array_length(next_reserve_ids) = 0 then
        delete from public.recruiting_applications where post_id = application_row.post_id and player_id = application_row.player_id and kind = application_row.kind;
      else
        update public.recruiting_applications
        set player_id = coalesce(leader_id, application_row.player_id), player_ids = next_player_ids, side = safe_side, status = 'ready', updated_at = now_at
        where post_id = application_row.post_id and player_id = application_row.player_id and kind = application_row.kind;
      end if;
      update public.recruiting_posts
      set room_state = management.room_state || jsonb_build_object('partyReserves', party_reserves, 'partyLeaders', party_leaders, 'partySides', party_sides, 'statRecorders', selected_players), updated_at = now_at
      where id = safe_post_id;
    end if;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'entryId', safe_entry_id, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  if safe_action = 'kickRecruitingApplicant' then
    if current_post.player_id <> safe_actor_id then raise exception 'recruiting_owner_required' using errcode = '42501'; end if;
    safe_player_id := nullif(btrim(p_operation->>'playerId'), '');
    if safe_player_id is null or safe_player_id = safe_actor_id then raise exception 'invalid_recruiting_kick_target' using errcode = '22023'; end if;
    select * into application_row
    from public.recruiting_applications
    where post_id = safe_post_id and player_id = safe_player_id
    order by kind
    limit 1
    for update;
    if application_row.post_id is null then raise exception 'recruiting_applicant_not_found' using errcode = 'P0002'; end if;
    delete from public.recruiting_applications
    where post_id = application_row.post_id and player_id = application_row.player_id and kind = application_row.kind;
    safe_entry_id := case when application_row.kind = 'team' and application_row.team_id is not null then 'team:' || application_row.team_id else null end;
    selected_players := case when jsonb_typeof(room_state->'statRecorders') = 'object' then room_state->'statRecorders' else '{}'::jsonb end;
    if selected_players->>'teamA' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamA}', to_jsonb(''::text), true); end if;
    if selected_players->>'teamB' = safe_player_id then selected_players := jsonb_set(selected_players, '{teamB}', to_jsonb(''::text), true); end if;
    select count(*)::integer into active_count
    from jsonb_array_elements(case when jsonb_typeof(room_state->'kickLog') = 'array' then room_state->'kickLog' else '[]'::jsonb end) kick(item)
    where item->>'by' = safe_actor_id;
    trust_required := case when active_count + 1 >= 3 then 1 else 0 end;
    room_state := room_state || jsonb_build_object(
      'invitations', coalesce((select jsonb_agg(item.value) from jsonb_array_elements(invitations) item(value) where item.value->>'targetUserId' <> safe_player_id), '[]'::jsonb),
      'partyReserves', public.rankball_jsonb_object_array_remove_value(room_state->'partyReserves', safe_player_id),
      'pinnedReservePlayers', public.rankball_jsonb_object_array_remove_value(room_state->'pinnedReservePlayers', safe_player_id),
      'reserveReady', case when jsonb_typeof(room_state->'reserveReady') = 'object' then (room_state->'reserveReady') - safe_player_id else '{}'::jsonb end,
      'slotPositions', case when jsonb_typeof(room_state->'slotPositions') = 'object' then (room_state->'slotPositions') - safe_player_id else '{}'::jsonb end,
      'statRecorders', selected_players,
      'kickLog', (case when jsonb_typeof(room_state->'kickLog') = 'array' then room_state->'kickLog' else '[]'::jsonb end) || jsonb_build_object(
        'id', 'kick_' || substr(md5(safe_post_id || ':' || safe_player_id || ':' || now_at::text), 1, 24),
        'targetUserId', safe_player_id,
        'by', safe_actor_id,
        'penalty', trust_required,
        'createdAt', now_at
      )
    );
    if safe_entry_id is not null then
      room_state := room_state || jsonb_build_object(
        'partyReserves', (coalesce(room_state->'partyReserves', '{}'::jsonb)) - safe_entry_id,
        'partyLeaders', (coalesce(room_state->'partyLeaders', '{}'::jsonb)) - safe_entry_id,
        'partySides', (coalesce(room_state->'partySides', '{}'::jsonb)) - safe_entry_id
      );
    end if;
    update public.recruiting_posts set room_state = management.room_state, updated_at = now_at where id = safe_post_id;
    if trust_required > 0 then
      update public.profiles
      set trust_score = greatest(0, coalesce(trust_score, 80) - trust_required), updated_at = now_at
      where id = safe_actor_id;
    end if;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'playerId', safe_player_id, 'penalty', trust_required, 'sqlReducer', true, 'advisoryLocked', true);
  end if;

  raise exception 'unsupported_recruiting_operation' using errcode = '22023';
end;
$$;

create or replace function public.rankball_recruiting_stat_recorder_action(
  p_actor_profile_id text,
  p_post_id text,
  p_side text,
  p_player_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_side text := nullif(btrim(p_side), '');
  requested_player_id text := nullif(btrim(p_player_id), '');
  next_player_id text := requested_player_id;
  other_side text;
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_recorders jsonb;
  next_recorders jsonb;
  owner_id text;
  is_reserve_candidate boolean := false;
  is_active_player boolean := false;
begin
  if safe_actor_id is null or safe_post_id is null then
    raise exception 'missing_recruiting_recorder_target' using errcode = '22023';
  end if;
  if safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_recruiting_side' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
  select * into current_post from public.recruiting_posts where id = safe_post_id for update;
  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);
  owner_id := coalesce(nullif(current_room_state->>'ownerId', ''), current_post.player_id);
  if owner_id is distinct from safe_actor_id then raise exception 'recruiting_room_owner_required' using errcode = '42501'; end if;
  if current_post.status <> 'open' then raise exception 'recruiting_room_not_mutable' using errcode = '42501'; end if;
  if nullif(current_post.referee_id, '') is not null then raise exception 'recruiting_recorder_disabled_with_referee' using errcode = '42501'; end if;

  current_recorders := case when jsonb_typeof(current_room_state->'statRecorders') = 'object' then current_room_state->'statRecorders' else '{}'::jsonb end;
  if requested_player_id is not null and current_recorders->>safe_side = requested_player_id then
    next_player_id := null;
  elsif requested_player_id is not null then
    select exists (
      select 1
      where current_post.host_join_mode = 'player'
        and current_post.player_id = requested_player_id
        and current_post.host_side = safe_side
        and coalesce(current_room_state->>'hostReserve', 'false') in ('true', '1')
      union all
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and application.side = safe_side
        and application.status = 'ready'
        and application.reserve
        and (application.player_id = requested_player_id or coalesce(application.player_ids, '[]'::jsonb) ? requested_player_id)
      union all
      select 1
      from jsonb_each(case when jsonb_typeof(current_room_state->'partyReserves') = 'object' then current_room_state->'partyReserves' else '{}'::jsonb end) reserve_entry(entry_id, reserve_ids)
      where coalesce(current_room_state #>> array['partySides', entry_id], case when entry_id = 'host' then current_post.host_side else null end) = safe_side
        and case when jsonb_typeof(reserve_ids) = 'array' then reserve_ids ? requested_player_id else false end
      union all
      select 1
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_room_state #> array['pinnedReservePlayers', safe_side]) = 'array'
          then current_room_state #> array['pinnedReservePlayers', safe_side]
          else '[]'::jsonb
        end
      ) pinned(player_id)
      where pinned.player_id = requested_player_id
    ) into is_reserve_candidate;

    select exists (
      select 1
      where current_post.host_side = safe_side
        and (
          (current_post.host_join_mode = 'player' and current_post.player_id = requested_player_id and coalesce(current_room_state->>'hostReserve', 'false') not in ('true', '1'))
          or (current_post.host_join_mode = 'team' and coalesce(current_post.player_ids, '[]'::jsonb) ? requested_player_id)
        )
      union all
      select 1
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and application.side = safe_side
        and not application.reserve
        and (application.player_id = requested_player_id or coalesce(application.player_ids, '[]'::jsonb) ? requested_player_id)
    ) into is_active_player;

    if not is_reserve_candidate or is_active_player then
      raise exception 'recruiting_recorder_reserve_required' using errcode = '23514';
    end if;
  end if;

  next_recorders := jsonb_set(current_recorders, array[safe_side], to_jsonb(coalesce(next_player_id, '')), true);
  other_side := case when safe_side = 'teamA' then 'teamB' else 'teamA' end;
  if next_player_id is not null and next_recorders->>other_side = next_player_id then
    next_recorders := jsonb_set(next_recorders, array[other_side], to_jsonb(''::text), true);
  end if;

  update public.recruiting_posts
  set room_state = jsonb_set(current_room_state, '{statRecorders}', next_recorders, true), updated_at = now()
  where id = safe_post_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setRecruitingStatRecorder',
    'postId', safe_post_id,
    'side', safe_side,
    'playerId', coalesce(next_player_id, ''),
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_is_related(public.recruiting_posts, text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_side_active_count(public.recruiting_posts, text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_side_reserve_count(public.recruiting_posts, text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_replace_invitation_status(jsonb, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.rankball_jsonb_object_array_remove_value(jsonb, text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_management_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_is_related(public.recruiting_posts, text) to service_role;
grant execute on function public.rankball_recruiting_side_active_count(public.recruiting_posts, text) to service_role;
grant execute on function public.rankball_recruiting_side_reserve_count(public.recruiting_posts, text) to service_role;
grant execute on function public.rankball_recruiting_replace_invitation_status(jsonb, text, text, text, timestamptz) to service_role;
grant execute on function public.rankball_jsonb_object_array_remove_value(jsonb, text) to service_role;
grant execute on function public.rankball_recruiting_management_action(text, jsonb) to service_role;
grant execute on function public.rankball_recruiting_stat_recorder_action(text, text, text, text) to service_role;

create or replace function public.rankball_authoritative_rpc_grant_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with required(function_name, signature) as (
    values
      ('rankball_create_tournament_match_locked', 'public.rankball_create_tournament_match_locked(text,text,text,integer,integer,text)'),
      ('rankball_match_finalize_locked', 'public.rankball_match_finalize_locked(text,text,text)'),
      ('rankball_match_referee_absence_action', 'public.rankball_match_referee_absence_action(text,text,text)'),
      ('rankball_match_result_action', 'public.rankball_match_result_action(text,text,jsonb)'),
      ('rankball_match_resume_approval_action', 'public.rankball_match_resume_approval_action(text,text,jsonb)'),
      ('rankball_match_resume_approval_action_legacy', 'public.rankball_match_resume_approval_action(text,text)'),
      ('rankball_match_room_action', 'public.rankball_match_room_action(text,text,text,jsonb)'),
      ('rankball_recruiting_management_action', 'public.rankball_recruiting_management_action(text,jsonb)'),
      ('rankball_recruiting_stat_recorder_action', 'public.rankball_recruiting_stat_recorder_action(text,text,text,text)'),
      ('rankball_tournament_advance_locked', 'public.rankball_tournament_advance_locked(text)'),
      ('rankball_tournament_match_schedule_action', 'public.rankball_tournament_match_schedule_action(text,text,text,jsonb)'),
      ('rankball_tournament_operation_action', 'public.rankball_tournament_operation_action(text,jsonb)')
  ),
  resolved as (
    select function_name, signature, to_regprocedure(signature) as proc_oid
    from required
  )
  select
    'authoritative_rpc_grant:' || function_name,
    proc_oid is not null
      and coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('anon', proc_oid, 'execute'), false)
      and not coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
    jsonb_build_object(
      'function', function_name,
      'signature', signature,
      'exists', proc_oid is not null,
      'anonExecute', coalesce(has_function_privilege('anon', proc_oid, 'execute'), false),
      'authenticatedExecute', coalesce(has_function_privilege('authenticated', proc_oid, 'execute'), false),
      'serviceRoleExecute', coalesce(has_function_privilege('service_role', proc_oid, 'execute'), false)
    )
  from resolved
  order by function_name;
$$;

revoke all on function public.rankball_authoritative_rpc_grant_health() from public, anon, authenticated;
grant execute on function public.rankball_authoritative_rpc_grant_health() to service_role;

select pg_notify('pgrst', 'reload schema');
