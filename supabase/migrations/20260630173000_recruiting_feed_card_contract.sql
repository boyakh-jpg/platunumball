-- Refresh recruiting feed cards with roster/application fields used by thin list endpoints.
-- Safe backfill only: no destructive data removal.

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
  court_display_name text;
  host_name text;
  host_team_name text;
  target_team_name text;
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

  region_key := public.rankball_room_feed_region_key(post_row.region);
  row_sort_at := coalesce(post_row.updated_at, post_row.created_at, now());
  owner_id := coalesce(nullif(post_row.room_state->>'ownerId', ''), nullif(post_row.player_id, ''));
  court_display_name := nullif(btrim(post_row.court_name), '');

  if court_display_name is null and post_row.court_id is not null then
    select nullif(btrim(name), '') into court_display_name
    from public.approved_courts
    where id = post_row.court_id
      and coalesce(status, 'active') = 'active';
  end if;

  if court_display_name is null and post_row.court_id is not null and to_regclass('public.courts') is not null then
    execute 'select name from public.courts where id = $1 limit 1'
    into court_display_name
    using post_row.court_id;
    court_display_name := nullif(btrim(court_display_name), '');
  end if;

  if owner_id is not null then
    select name into host_name
    from public.public_profiles
    where id = owner_id;
  end if;

  if post_row.team_id is not null then
    select name into host_team_name
    from public.teams
    where id = post_row.team_id;
  end if;

  if post_row.target_team_id is not null then
    select name into target_team_name
    from public.teams
    where id = post_row.target_team_id;
  end if;

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
        'position', app.position,
        'playerIds', coalesce(app.player_ids, '[]'::jsonb),
        'sourceTeamId', app.source_team_id,
        'sourceEntryId', app.source_entry_id,
        'createdAt', app.created_at,
        'updatedAt', app.updated_at
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
    'region', post_row.region,
    'court', coalesce(court_display_name, '誘몄젙'),
    'hostName', host_name,
    'hostTeamName', host_team_name,
    'targetTeamName', target_team_name,
    'mode', post_row.mode,
    'scheduledDate', post_row.scheduled_date,
    'scheduledTime', case when post_row.scheduled_time is null then '' else left(post_row.scheduled_time::text, 5) end,
    'scheduledAt', case
      when post_row.room_state->>'timingType' = 'instant' then '利됱떆'
      when post_row.scheduled_date is not null and post_row.scheduled_time is not null then post_row.scheduled_date::text || ' ' || left(post_row.scheduled_time::text, 5)
      when post_row.scheduled_date is not null then post_row.scheduled_date::text
      else coalesce(post_row.scheduled_at::text, '誘몄젙')
    end,
    'timingType', case when post_row.room_state->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
    'ranked', coalesce(post_row.ranked, true),
    'official', coalesce(post_row.official, false),
    'preRegistered', coalesce(post_row.pre_registered, true),
    'ratingScale', coalesce(post_row.rating_scale, 1),
    'ageRestriction', coalesce(post_row.age_restriction, 'open'),
    'allowedAgeGroups', coalesce(post_row.allowed_age_groups, '[]'::jsonb),
    'rules', coalesce(post_row.rules, '{}'::jsonb),
    'stakes', coalesce(post_row.stakes, ''),
    'spots', post_row.spots,
    'teamId', post_row.team_id,
    'targetTeamId', post_row.target_team_id,
    'refereeWanted', coalesce(post_row.room_state->'refereeWanted', to_jsonb(nullif(post_row.referee_id, '') is not null)),
    'refereeId', coalesce(post_row.referee_id, ''),
    'refereeTrustMin', coalesce(post_row.referee_trust_min, 90),
    'statEntryMinutes', coalesce(post_row.stat_entry_minutes, 60),
    'disputeMinutes', coalesce(post_row.dispute_minutes, 30),
    'roomState', jsonb_build_object(
      'ownerId', owner_id,
      'teamOnly', coalesce(post_row.room_state->'teamOnly', 'false'::jsonb),
      'timingType', case when post_row.room_state->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
      'hostReserve', coalesce(post_row.room_state->'hostReserve', 'false'::jsonb),
      'refereeWanted', coalesce(post_row.room_state->'refereeWanted', to_jsonb(nullif(post_row.referee_id, '') is not null)),
      'invitations', coalesce(post_row.room_state->'invitations', '[]'::jsonb),
      'mmrRangeMode', coalesce(post_row.room_state->>'mmrRangeMode', 'narrow'),
      'partyLeaders', coalesce(post_row.room_state->'partyLeaders', '{}'::jsonb),
      'partyReserves', coalesce(post_row.room_state->'partyReserves', '{}'::jsonb),
      'reserveReady', coalesce(post_row.room_state->'reserveReady', '{}'::jsonb),
      'pinnedReservePlayers', coalesce(post_row.room_state->'pinnedReservePlayers', '{}'::jsonb),
      'slotPositions', coalesce(post_row.room_state->'slotPositions', '{}'::jsonb),
      'statRecorders', coalesce(post_row.room_state->'statRecorders', '{}'::jsonb),
      'ruleRevision', coalesce(post_row.room_state->'ruleRevision', '0'::jsonb),
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
    'memo', post_row.memo,
    'status', post_row.status,
    'confirmedAt', post_row.confirmed_at,
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


do $$
declare
  row_id text;
begin
  for row_id in
    select id
    from public.recruiting_posts
    where status = 'open'
  loop
    perform public.rankball_refresh_recruiting_feed_for_post(row_id);
  end loop;
end;
$$;
