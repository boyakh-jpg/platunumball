create or replace function public.rankball_slim_room_feed_card(
  p_entity_type text,
  p_card_json jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  card jsonb := coalesce(p_card_json, '{}'::jsonb);
  room_state jsonb := '{}'::jsonb;
  app_row jsonb;
  side_capacity integer := 5;
  host_side text := 'teamA';
  host_join_mode text := 'player';
  host_count integer := 0;
  party_count integer := 0;
  player_ids_count integer := 0;
  app_side text;
  app_count integer;
  app_reserve boolean;
  app_status text;
  team_a_filled integer := 0;
  team_b_filled integer := 0;
  team_a_projected integer := 0;
  team_b_projected integer := 0;
  team_a_confirmation integer := 0;
  team_b_confirmation integer := 0;
  team_a_count integer := 0;
  team_b_count integer := 0;
begin
  if jsonb_typeof(card) <> 'object' then
    return '{}'::jsonb;
  end if;

  if p_entity_type = 'recruiting' then
    room_state := case when jsonb_typeof(card->'roomState') = 'object' then card->'roomState' else '{}'::jsonb end;
    side_capacity := case
      when coalesce(card->>'sideCapacity', '') ~ '^[0-9]+$' then greatest(1, least(5, (card->>'sideCapacity')::integer))
      else 5
    end;
    host_side := case when card->>'hostSide' = 'teamB' then 'teamB' else 'teamA' end;
    host_join_mode := case when card->>'hostJoinMode' = 'team' and nullif(card->>'teamId', '') is not null then 'team' else 'player' end;
    player_ids_count := case when jsonb_typeof(card->'playerIds') = 'array' then jsonb_array_length(card->'playerIds') else 0 end;
    host_count := case
      when host_join_mode = 'team' then least(side_capacity, greatest(player_ids_count, case when nullif(card->>'playerId', '') is not null or nullif(card->>'ownerId', '') is not null then 1 else 0 end))
      when nullif(card->>'playerId', '') is not null or nullif(card->>'ownerId', '') is not null then 1
      else 0
    end;

    if host_join_mode = 'team' then
      party_count := party_count + 1;
    end if;

    if coalesce(room_state->>'hostReserve', 'false') in ('true', '1') then
      if coalesce(card->>'hostReady', 'true') in ('true', '1') then
        if host_side = 'teamA' then
          team_a_projected := team_a_projected + host_count;
          team_a_confirmation := team_a_confirmation + host_count;
        else
          team_b_projected := team_b_projected + host_count;
          team_b_confirmation := team_b_confirmation + host_count;
        end if;
      end if;
    elsif host_side = 'teamA' then
      team_a_filled := team_a_filled + host_count;
      team_a_projected := team_a_projected + host_count;
      team_a_confirmation := team_a_confirmation + host_count;
    else
      team_b_filled := team_b_filled + host_count;
      team_b_projected := team_b_projected + host_count;
      team_b_confirmation := team_b_confirmation + host_count;
    end if;

    for app_row in
      select value
      from jsonb_array_elements(case when jsonb_typeof(card->'applicants') = 'array' then card->'applicants' else '[]'::jsonb end)
    loop
      app_side := case when app_row->>'side' = 'teamA' then 'teamA' else 'teamB' end;
      app_count := case
        when coalesce(app_row->>'kind', app_row->>'joinMode') = 'team' then greatest(1, case when jsonb_typeof(app_row->'playerIds') = 'array' then jsonb_array_length(app_row->'playerIds') else 0 end)
        else 1
      end;
      app_reserve := coalesce(app_row->>'reserve', 'false') in ('true', '1');
      app_status := coalesce(app_row->>'status', 'waiting');
      if coalesce(app_row->>'kind', app_row->>'joinMode') = 'team' then
        party_count := party_count + 1;
      end if;

      if app_side = 'teamA' then
        if app_reserve then
          if app_status in ('ready', 'confirmed') then
            team_a_projected := team_a_projected + app_count;
            team_a_confirmation := team_a_confirmation + app_count;
          end if;
        else
          team_a_filled := team_a_filled + app_count;
          team_a_projected := team_a_projected + app_count;
          team_a_confirmation := team_a_confirmation + app_count;
        end if;
      else
        if app_reserve then
          if app_status in ('ready', 'confirmed') then
            team_b_projected := team_b_projected + app_count;
            team_b_confirmation := team_b_confirmation + app_count;
          end if;
        else
          team_b_filled := team_b_filled + app_count;
          team_b_projected := team_b_projected + app_count;
          team_b_confirmation := team_b_confirmation + app_count;
        end if;
      end if;
    end loop;

    team_a_filled := least(side_capacity, team_a_filled);
    team_b_filled := least(side_capacity, team_b_filled);
    team_a_projected := least(side_capacity, greatest(team_a_filled, team_a_projected));
    team_b_projected := least(side_capacity, greatest(team_b_filled, team_b_projected));
    team_a_confirmation := least(side_capacity, greatest(team_a_projected, team_a_confirmation));
    team_b_confirmation := least(side_capacity, greatest(team_b_projected, team_b_confirmation));

    return jsonb_strip_nulls(jsonb_build_object(
      'id', card->>'id',
      'listCardOnly', true,
      'type', card->>'type',
      'title', card->>'title',
      'visibility', coalesce(card->>'visibility', 'public'),
      'region', card->>'region',
      'courtId', card->>'courtId',
      'mode', card->>'mode',
      'scheduledDate', card->>'scheduledDate',
      'scheduledTime', card->>'scheduledTime',
      'scheduledAt', card->>'scheduledAt',
      'timingType', card->>'timingType',
      'ranked', card->'ranked',
      'official', card->'official',
      'preRegistered', card->'preRegistered',
      'ratingScale', card->'ratingScale',
      'rules', jsonb_strip_nulls(jsonb_build_object(
        'targetScore', card->'rules'->'targetScore',
        'timeLimit', card->'rules'->'timeLimit',
        'winByTwo', card->'rules'->'winByTwo',
        'ball', card->'rules'->'ball'
      )),
      'teamId', card->>'teamId',
      'targetTeamId', card->>'targetTeamId',
      'refereeWanted', card->'refereeWanted',
      'refereeId', card->>'refereeId',
      'ownerId', coalesce(card->>'ownerId', room_state->>'ownerId', card->>'playerId'),
      'playerId', coalesce(card->>'playerId', card->>'ownerId', room_state->>'ownerId'),
      'hostJoinMode', host_join_mode,
      'hostSide', host_side,
      'hostReady', card->'hostReady',
      'sideCapacity', side_capacity,
      'teamOnly', coalesce(card->'teamOnly', room_state->'teamOnly'),
      'status', card->>'status',
      'createdAt', card->>'createdAt',
      'updatedAt', card->>'updatedAt',
      'listCounts', jsonb_build_object(
        'teamA', jsonb_build_object(
          'filled', team_a_filled,
          'projectedFilled', team_a_projected,
          'confirmationProjectedFilled', team_a_confirmation,
          'capacity', side_capacity
        ),
        'teamB', jsonb_build_object(
          'filled', team_b_filled,
          'projectedFilled', team_b_projected,
          'confirmationProjectedFilled', team_b_confirmation,
          'capacity', side_capacity
        ),
        'filled', team_a_filled + team_b_filled,
        'projectedFilled', team_a_projected + team_b_projected,
        'capacity', side_capacity * 2,
        'partyCount', party_count
      )
    ));
  end if;

  if p_entity_type = 'match' then
    team_a_count := case when jsonb_typeof(card->'teamA'->'players') = 'array' then jsonb_array_length(card->'teamA'->'players') else 0 end;
    team_b_count := case when jsonb_typeof(card->'teamB'->'players') = 'array' then jsonb_array_length(card->'teamB'->'players') else 0 end;

    return jsonb_strip_nulls(jsonb_build_object(
      'id', card->>'id',
      'listCardOnly', true,
      'title', card->>'title',
      'mode', card->>'mode',
      'courtId', card->>'courtId',
      'visibility', coalesce(card->>'visibility', 'public'),
      'scheduledDate', card->>'scheduledDate',
      'scheduledTime', card->>'scheduledTime',
      'scheduledAt', card->>'scheduledAt',
      'timingType', card->>'timingType',
      'status', card->>'status',
      'official', card->'official',
      'preRegistered', card->'preRegistered',
      'ranked', card->'ranked',
      'refereeId', card->>'refereeId',
      'formerRefereeId', card->>'formerRefereeId',
      'refereeWanted', card->'refereeWanted',
      'createdBy', card->>'createdBy',
      'recruitingPostId', card->>'recruitingPostId',
      'tournamentId', card->>'tournamentId',
      'rules', jsonb_strip_nulls(jsonb_build_object(
        'targetScore', card->'rules'->'targetScore',
        'timeLimit', card->'rules'->'timeLimit',
        'winByTwo', card->'rules'->'winByTwo',
        'ball', card->'rules'->'ball'
      )),
      'teamA', jsonb_strip_nulls(jsonb_build_object(
        'teamId', card->'teamA'->>'teamId',
        'score', card->'teamA'->'score',
        'count', team_a_count
      )),
      'teamB', jsonb_strip_nulls(jsonb_build_object(
        'teamId', card->'teamB'->>'teamId',
        'score', card->'teamB'->'score',
        'count', team_b_count
      )),
      'createdAt', card->>'createdAt',
      'agreedAt', card->>'agreedAt',
      'startedAt', card->>'startedAt',
      'endedAt', card->>'endedAt',
      'confirmedAt', card->>'confirmedAt',
      'cancelledAt', card->>'cancelledAt',
      'voidedAt', card->>'voidedAt',
      'updatedAt', card->>'updatedAt'
    ));
  end if;

  return jsonb_strip_nulls(card);
end;
$$;

create or replace function public.rankball_upsert_room_feed_card(
  p_entity_type text,
  p_entity_id text,
  p_card_json jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.room_feed_cards (
    entity_type,
    entity_id,
    card_json,
    updated_at
  )
  values (
    p_entity_type,
    p_entity_id,
    public.rankball_slim_room_feed_card(p_entity_type, coalesce(p_card_json, '{}'::jsonb)),
    now()
  )
  on conflict (entity_type, entity_id)
  do update set
    card_json = excluded.card_json,
    updated_at = now();
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in select id from public.recruiting_posts loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null
    and to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
    for row_id in select id from public.matches loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;

  update public.room_feed_cards
  set
    card_json = public.rankball_slim_room_feed_card(entity_type, card_json),
    updated_at = now()
  where card_json <> public.rankball_slim_room_feed_card(entity_type, card_json);

  update public.user_room_feed
  set card_json = '{}'::jsonb
  where card_json <> '{}'::jsonb;
end;
$$;

select pg_notify('pgrst', 'reload schema');
