create or replace function public.rankball_refresh_recruiting_feed_for_post(p_post_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
  owner_id text;
  region_key text;
  row_sort_at timestamptz;
  card_json jsonb;
  application_cards jsonb := '[]'::jsonb;
  court_snapshot jsonb;
  court_region text;
  player_value text;
  application_row record;
  invitation_row jsonb;
begin
  update public.user_room_feed
  set is_active = false, updated_at = now()
  where entity_type = 'recruiting'
    and entity_id = p_post_id
    and is_active = true;

  select *
  into post_row
  from public.recruiting_posts
  where id = p_post_id;

  if not found then
    return;
  end if;

  row_sort_at := coalesce(post_row.updated_at, post_row.created_at, now());
  owner_id := coalesce(nullif(post_row.room_state->>'ownerId', ''), nullif(post_row.player_id, ''));
  court_snapshot := public.rankball_court_snapshot(post_row.court_id, post_row.court_name, post_row.region);
  court_region := nullif(btrim(court_snapshot->>'region'), '');
  region_key := public.rankball_room_feed_region_key(coalesce(court_region, post_row.region));

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'kind', coalesce(app.kind, 'player'),
        'joinMode', coalesce(app.kind, 'player'),
        'teamId', app.team_id,
        'playerId', app.player_id,
        'side', coalesce(app.side, 'teamB'),
        'status', coalesce(app.status, 'waiting'),
        'reserve', coalesce(app.reserve, false),
        'playerIds', coalesce(app.player_ids, '[]'::jsonb),
        'sourceTeamId', app.source_team_id,
        'sourceEntryId', app.source_entry_id
      )
      order by coalesce(app.updated_at, app.created_at) desc, app.player_id
    ),
    '[]'::jsonb
  )
  into application_cards
  from public.recruiting_applications app
  where app.post_id = post_row.id;

  card_json := jsonb_build_object(
    'id', post_row.id,
    'listCardOnly', true,
    'type', post_row.type,
    'title', post_row.title,
    'visibility', coalesce(post_row.visibility, 'public'),
    'region', coalesce(court_region, post_row.region),
    'courtId', post_row.court_id,
    'mode', post_row.mode,
    'scheduledDate', post_row.scheduled_date,
    'scheduledTime', case when post_row.scheduled_time is null then '' else left(post_row.scheduled_time::text, 5) end,
    'scheduledAt', case
      when post_row.room_state->>'timingType' = 'instant' then '즉시'
      when post_row.scheduled_date is not null and post_row.scheduled_time is not null then post_row.scheduled_date::text || ' ' || left(post_row.scheduled_time::text, 5)
      when post_row.scheduled_date is not null then post_row.scheduled_date::text
      else coalesce(post_row.scheduled_at::text, '미정')
    end,
    'timingType', case when post_row.room_state->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
    'ranked', coalesce(post_row.ranked, true),
    'official', coalesce(post_row.official, false),
    'preRegistered', coalesce(post_row.pre_registered, true),
    'ratingScale', coalesce(post_row.rating_scale, 1),
    'ageRestriction', coalesce(post_row.age_restriction, 'open'),
    'allowedAgeGroups', coalesce(post_row.allowed_age_groups, '[]'::jsonb),
    'spots', post_row.spots,
    'teamId', post_row.team_id,
    'targetTeamId', post_row.target_team_id,
    'refereeWanted', coalesce(post_row.room_state->'refereeWanted', to_jsonb(nullif(post_row.referee_id, '') is not null)),
    'refereeId', coalesce(post_row.referee_id, ''),
    'roomState', jsonb_build_object(
      'ownerId', owner_id,
      'teamOnly', coalesce(post_row.room_state->'teamOnly', 'false'::jsonb),
      'timingType', case when post_row.room_state->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
      'hostReserve', coalesce(post_row.room_state->'hostReserve', 'false'::jsonb),
      'refereeWanted', coalesce(post_row.room_state->'refereeWanted', to_jsonb(nullif(post_row.referee_id, '') is not null)),
      'invitations', coalesce(post_row.room_state->'invitations', '[]'::jsonb),
      'partyLeaders', coalesce(post_row.room_state->'partyLeaders', '{}'::jsonb),
      'partyReserves', coalesce(post_row.room_state->'partyReserves', '{}'::jsonb),
      'reserveReady', coalesce(post_row.room_state->'reserveReady', '{}'::jsonb),
      'pinnedReservePlayers', coalesce(post_row.room_state->'pinnedReservePlayers', '{}'::jsonb),
      'slotPositions', coalesce(post_row.room_state->'slotPositions', '{}'::jsonb),
      'approvalModeA', coalesce(post_row.room_state->>'approvalModeA', 'leader'),
      'approvalModeB', coalesce(post_row.room_state->>'approvalModeB', 'leader')
    ),
    'teamOnly', coalesce((post_row.room_state->>'teamOnly')::boolean, false),
    'hostJoinMode', post_row.host_join_mode,
    'hostSide', post_row.host_side,
    'hostReady', coalesce(post_row.host_ready, false),
    'sideCapacity', post_row.side_capacity,
    'playerIds', coalesce(post_row.player_ids, '[]'::jsonb),
    'position', post_row.position,
    'playerId', post_row.player_id,
    'status', post_row.status,
    'createdAt', post_row.created_at,
    'updatedAt', post_row.updated_at,
    'applicants', application_cards
  );

  if post_row.status = 'open' and coalesce(post_row.visibility, 'public') = 'public' then
    perform public.rankball_upsert_room_feed(
      '*',
      'recruiting',
      post_row.id,
      'region_public',
      region_key,
      post_row.status,
      coalesce(post_row.visibility, 'public'),
      row_sort_at,
      card_json
    );
  end if;

  if post_row.status <> 'open' then
    return;
  end if;

  if owner_id is not null then
    perform public.rankball_upsert_room_feed(owner_id, 'recruiting', post_row.id, 'owner', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
  end if;

  if nullif(post_row.player_id, '') is not null and post_row.player_id is distinct from owner_id then
    perform public.rankball_upsert_room_feed(post_row.player_id, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
  end if;

  for player_value in
    select value
    from jsonb_array_elements_text(coalesce(post_row.player_ids, '[]'::jsonb))
  loop
    if nullif(player_value, '') is not null and player_value is distinct from owner_id then
      perform public.rankball_upsert_room_feed(player_value, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
    end if;
  end loop;

  for player_value in
    select profile_id
    from public.rankball_room_state_participant_ids(post_row.room_state)
  loop
    if nullif(player_value, '') is not null and player_value is distinct from owner_id then
      perform public.rankball_upsert_room_feed(player_value, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
    end if;
  end loop;

  if nullif(post_row.referee_id, '') is not null then
    perform public.rankball_upsert_room_feed(post_row.referee_id, 'recruiting', post_row.id, 'referee', region_key, post_row.status, coalesce(post_row.visibility, 'public'), row_sort_at, card_json);
  end if;

  for application_row in
    select *
    from public.recruiting_applications
    where post_id = post_row.id
  loop
    if nullif(application_row.player_id, '') is not null then
      perform public.rankball_upsert_room_feed(application_row.player_id, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), coalesce(application_row.updated_at, application_row.created_at, row_sort_at), card_json);
    end if;

    for player_value in
      select value
      from jsonb_array_elements_text(coalesce(application_row.player_ids, '[]'::jsonb))
    loop
      if nullif(player_value, '') is not null then
        perform public.rankball_upsert_room_feed(player_value, 'recruiting', post_row.id, 'participant', region_key, post_row.status, coalesce(post_row.visibility, 'public'), coalesce(application_row.updated_at, application_row.created_at, row_sort_at), card_json);
      end if;
    end loop;
  end loop;

  for invitation_row in
    select value
    from jsonb_array_elements(coalesce(post_row.room_state->'invitations', '[]'::jsonb))
  loop
    if coalesce(invitation_row->>'status', 'pending') = 'pending' and nullif(invitation_row->>'targetUserId', '') is not null then
      perform public.rankball_upsert_room_feed(
        invitation_row->>'targetUserId',
        'recruiting',
        post_row.id,
        'invited',
        region_key,
        post_row.status,
        coalesce(post_row.visibility, 'public'),
        coalesce(nullif(invitation_row->>'updatedAt', '')::timestamptz, nullif(invitation_row->>'createdAt', '')::timestamptz, row_sort_at),
        card_json
      );
    end if;
  end loop;
end;
$$;

create or replace function public.rankball_refresh_match_feed_for_match(p_match_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
  region_key text;
  row_sort_at timestamptz;
  card_json jsonb;
  court_snapshot jsonb;
  court_region text;
  team_a_players jsonb := '[]'::jsonb;
  team_b_players jsonb := '[]'::jsonb;
  agreements_json jsonb := jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb);
  approvals_json jsonb := jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb);
  disputes_json jsonb := '[]'::jsonb;
  player_row record;
begin
  update public.user_room_feed
  set is_active = false, updated_at = now()
  where entity_type = 'match'
    and entity_id = p_match_id
    and is_active = true;

  select *
  into match_row
  from public.matches
  where id = p_match_id;

  if not found then
    return;
  end if;

  row_sort_at := coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at, now());
  court_snapshot := public.rankball_court_snapshot(match_row.court_id, match_row.court_name, match_row.rules->>'region');
  court_region := nullif(btrim(court_snapshot->>'region'), '');
  region_key := public.rankball_room_feed_region_key(coalesce(court_region, match_row.rules->>'region'));

  select
    coalesce(jsonb_agg(mp.user_id order by mp.slot_order, mp.user_id) filter (where mp.side = 'teamA'), '[]'::jsonb),
    coalesce(jsonb_agg(mp.user_id order by mp.slot_order, mp.user_id) filter (where mp.side = 'teamB'), '[]'::jsonb)
  into team_a_players, team_b_players
  from public.match_players mp
  where mp.match_id = match_row.id;

  select jsonb_build_object(
    'teamA', coalesce(jsonb_agg(agreement.user_id order by agreement.user_id) filter (where agreement.side = 'teamA'), '[]'::jsonb),
    'teamB', coalesce(jsonb_agg(agreement.user_id order by agreement.user_id) filter (where agreement.side = 'teamB'), '[]'::jsonb)
  )
  into agreements_json
  from public.match_agreements agreement
  where agreement.match_id = match_row.id;

  select jsonb_build_object(
    'teamA', coalesce(jsonb_agg(approval.user_id order by approval.user_id) filter (where approval.side = 'teamA'), '[]'::jsonb),
    'teamB', coalesce(jsonb_agg(approval.user_id order by approval.user_id) filter (where approval.side = 'teamB'), '[]'::jsonb)
  )
  into approvals_json
  from public.match_approvals approval
  where approval.match_id = match_row.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', dispute.id,
    'by', dispute.user_id,
    'reason', dispute.reason,
    'createdAt', dispute.created_at
  ) order by dispute.created_at desc nulls last), '[]'::jsonb)
  into disputes_json
  from public.match_disputes dispute
  where dispute.match_id = match_row.id;

  card_json := jsonb_build_object(
    'id', match_row.id,
    'listCardOnly', true,
    'title', match_row.title,
    'mode', match_row.mode,
    'courtId', match_row.court_id,
    'visibility', coalesce(match_row.visibility, match_row.rules->>'visibility', 'public'),
    'scheduledDate', match_row.scheduled_date,
    'scheduledTime', case when match_row.scheduled_time is null then '' else left(match_row.scheduled_time::text, 5) end,
    'scheduledAt', case
      when match_row.rules->>'timingType' = 'instant' then '즉시'
      when match_row.scheduled_date is not null and match_row.scheduled_time is not null then match_row.scheduled_date::text || ' ' || left(match_row.scheduled_time::text, 5)
      when match_row.scheduled_date is not null then match_row.scheduled_date::text
      else coalesce(match_row.scheduled_at::text, '미정')
    end,
    'timingType', case when match_row.rules->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
    'status', coalesce(match_row.status, 'contract'),
    'official', coalesce(match_row.official, false),
    'preRegistered', coalesce(match_row.pre_registered, false),
    'ranked', coalesce(match_row.ranked, true),
    'refereeId', coalesce(match_row.referee_id, ''),
    'formerRefereeId', coalesce(match_row.former_referee_id, ''),
    'refereeWanted', coalesce(match_row.referee_id, '') <> '' or coalesce((match_row.rules->>'refereeWanted')::boolean, false),
    'createdBy', coalesce(match_row.created_by, ''),
    'recruitingPostId', coalesce(match_row.rules->>'recruitingPostId', ''),
    'tournamentId', coalesce(match_row.tournament_id, ''),
    'teamA', jsonb_build_object(
      'teamId', coalesce(match_row.team_a_id, ''),
      'players', team_a_players,
      'score', coalesce(match_row.score_a, 0)
    ),
    'teamB', jsonb_build_object(
      'teamId', coalesce(match_row.team_b_id, ''),
      'players', team_b_players,
      'score', coalesce(match_row.score_b, 0)
    ),
    'agreements', agreements_json,
    'approvals', approvals_json,
    'disputes', disputes_json,
    'parties', coalesce(match_row.rules->'parties', '[]'::jsonb),
    'createdAt', match_row.created_at,
    'agreedAt', match_row.agreed_at,
    'startedAt', match_row.started_at,
    'endedAt', match_row.ended_at,
    'confirmedAt', match_row.confirmed_at,
    'cancelledAt', match_row.cancelled_at,
    'voidedAt', match_row.voided_at,
    'updatedAt', coalesce(match_row.updated_at, match_row.created_at)
  );

  if nullif(match_row.created_by, '') is not null then
    perform public.rankball_upsert_room_feed(match_row.created_by, 'match', match_row.id, 'owner', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
  end if;

  if nullif(match_row.referee_id, '') is not null then
    perform public.rankball_upsert_room_feed(match_row.referee_id, 'match', match_row.id, 'referee', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
  end if;

  if nullif(match_row.former_referee_id, '') is not null then
    perform public.rankball_upsert_room_feed(match_row.former_referee_id, 'match', match_row.id, 'referee', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
  end if;

  for player_row in
    select user_id
    from public.match_players
    where match_id = match_row.id
  loop
    if nullif(player_row.user_id, '') is not null then
      perform public.rankball_upsert_room_feed(player_row.user_id, 'match', match_row.id, 'participant', region_key, match_row.status, match_row.visibility, row_sort_at, card_json);
    end if;
  end loop;
end;
$$;

drop index if exists public.user_room_feed_profile_idx;
drop index if exists public.user_room_feed_region_idx;
drop index if exists public.user_room_feed_profile_relation_idx;
drop index if exists public.user_room_feed_scope_public_idx;
drop index if exists public.user_room_feed_scope_profile_idx;

create index if not exists user_room_feed_active_public_idx
  on public.user_room_feed (entity_type, region_key, status, sort_at desc, entity_id desc)
  where feed_scope = 'public' and relation = 'region_public' and is_active = true;

create index if not exists user_room_feed_active_profile_idx
  on public.user_room_feed (entity_type, profile_id, relation, status, sort_at desc, entity_id desc)
  where feed_scope = 'profile' and is_active = true;

create index if not exists user_room_feed_entity_idx
  on public.user_room_feed (entity_type, entity_id);

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null then
    for row_id in select id from public.recruiting_posts loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null then
    for row_id in select id from public.matches loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;

  update public.user_room_feed
  set
    card_json = jsonb_build_object(
      'id', entity_id,
      'listCardOnly', true,
      'status', status,
      'updatedAt', updated_at
    ),
    updated_at = now()
  where is_active = false;
end;
$$;

select pg_notify('pgrst', 'reload schema');
