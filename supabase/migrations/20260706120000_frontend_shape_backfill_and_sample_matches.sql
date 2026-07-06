-- Backfill rows to the same shape produced by the frontend save flow.
-- Also adds a small idempotent sample set: old personal records and upcoming matches.

do $$
declare
  row_id text;
begin
  if to_regclass('public.profiles') is not null then
    update public.profiles
    set
      handle = coalesce(nullif(btrim(handle), ''), nullif(btrim(hashtag), ''), id),
      hashtag = coalesce(nullif(btrim(hashtag), ''), nullif(btrim(handle), ''), id),
      trust_score = coalesce(trust_score, 80),
      ratings = coalesce(ratings, '{"integrated":1200,"modes":{}}'::jsonb),
      streak = coalesce(streak, 0),
      app_settings = coalesce(app_settings, '{}'::jsonb),
      updated_at = now()
    where nullif(btrim(handle), '') is null
      or nullif(btrim(hashtag), '') is null
      or trust_score is null
      or ratings is null
      or streak is null
      or app_settings is null;

    update public.profiles
    set
      birth_year = coalesce(birth_year, 2000),
      age_group = coalesce(nullif(btrim(age_group), ''), 'open'),
      age_group_checked_season = coalesce(nullif(btrim(age_group_checked_season), ''), '2026-h1'),
      onboarding_complete = true,
      handle_locked_at = coalesce(handle_locked_at, created_at, now()),
      birth_year_locked_at = coalesce(birth_year_locked_at, created_at, now()),
      updated_at = now()
    where test_login_id is not null
      and (
        birth_year is null
        or nullif(btrim(age_group), '') is null
        or nullif(btrim(age_group_checked_season), '') is null
        or onboarding_complete is distinct from true
        or handle_locked_at is null
        or birth_year_locked_at is null
      );
  end if;

  if to_regclass('public.matches') is not null then
    update public.matches
    set
      rules = coalesce(rules, '{}'::jsonb),
      trust_feedback = coalesce(trust_feedback, '{}'::jsonb),
      stat_recorders = coalesce(stat_recorders, '{}'::jsonb),
      played_player_ids = coalesce(played_player_ids, '{}'::jsonb),
      reserve_players = coalesce(reserve_players, '{}'::jsonb),
      promoted_reserve_ids = coalesce(promoted_reserve_ids, '{}'::jsonb),
      attendance = coalesce(attendance, '{"teamA":[],"teamB":[]}'::jsonb),
      mmr_excluded_player_ids = coalesce(mmr_excluded_player_ids, '[]'::jsonb),
      anonymous_players = coalesce(anonymous_players, '{}'::jsonb),
      evidence = coalesce(evidence, '[]'::jsonb),
      updated_at = coalesce(updated_at, created_at, now())
    where rules is null
      or trust_feedback is null
      or stat_recorders is null
      or played_player_ids is null
      or reserve_players is null
      or promoted_reserve_ids is null
      or attendance is null
      or mmr_excluded_player_ids is null
      or anonymous_players is null
      or evidence is null
      or updated_at is null;

    update public.matches
    set
      scheduled_at = case
        when scheduled_date is not null and scheduled_time is not null then scheduled_date::text || ' ' || left(scheduled_time::text, 5)
        when scheduled_date is not null then scheduled_date::text
        else scheduled_at
      end,
      updated_at = now()
    where nullif(btrim(coalesce(scheduled_at, '')), '') is null
      and scheduled_date is not null;

    update public.matches
    set
      visibility = 'private',
      ranked = false,
      mmr_limit_mode = 'off',
      referee_id = null,
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'recordType', 'solo',
        'visibility', 'private',
        'ratingScale', 0,
        'statRecorders', coalesce(stat_recorders, '{}'::jsonb),
        'playedPlayerIds', coalesce(played_player_ids, '{}'::jsonb),
        'mmrExcludedPlayerIds', coalesce(mmr_excluded_player_ids, '[]'::jsonb)
      ),
      updated_at = now()
    where coalesce(rules->>'recordType', '') = 'solo'
      and (
        visibility is distinct from 'private'
        or ranked is distinct from false
        or mmr_limit_mode is distinct from 'off'
        or referee_id is not null
        or rules->>'visibility' is distinct from 'private'
      );
  end if;

  if to_regclass('public.recruiting_posts') is not null then
    update public.recruiting_posts
    set
      allowed_age_groups = coalesce(allowed_age_groups, '[]'::jsonb),
      rules = coalesce(rules, '{}'::jsonb),
      player_ids = case when jsonb_typeof(coalesce(player_ids, '[]'::jsonb)) = 'array' then coalesce(player_ids, '[]'::jsonb) else '[]'::jsonb end,
      room_state = jsonb_build_object(
        'ownerId', coalesce(nullif(coalesce(room_state->>'ownerId', ''), ''), player_id),
        'timingType', coalesce(nullif(coalesce(room_state->>'timingType', ''), ''), case when scheduled_date is null and scheduled_time is null then 'instant' else 'scheduled' end),
        'partyReserves', '{}'::jsonb,
        'partyLeaders', '{}'::jsonb,
        'invitations', '[]'::jsonb,
        'hostReserve', false,
        'chatMessages', '[]'::jsonb,
        'kickLog', '[]'::jsonb,
        'reserveReady', '{}'::jsonb,
        'pinnedReservePlayers', '{}'::jsonb,
        'slotPositions', '{}'::jsonb,
        'statRecorders', '{}'::jsonb,
        'refereeWanted', referee_id is not null
      ) || case when jsonb_typeof(coalesce(room_state, '{}'::jsonb)) = 'object' then coalesce(room_state, '{}'::jsonb) else '{}'::jsonb end,
      updated_at = coalesce(updated_at, created_at, now())
    where allowed_age_groups is null
      or rules is null
      or player_ids is null
      or jsonb_typeof(coalesce(player_ids, '[]'::jsonb)) <> 'array'
      or room_state is null
      or jsonb_typeof(room_state) <> 'object'
      or room_state->'partyReserves' is null
      or room_state->'partyLeaders' is null
      or room_state->'invitations' is null
      or room_state->'chatMessages' is null
      or room_state->'kickLog' is null
      or room_state->'reserveReady' is null
      or room_state->'pinnedReservePlayers' is null
      or room_state->'slotPositions' is null
      or room_state->'statRecorders' is null
      or updated_at is null;
  end if;

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
end;
$$;

do $$
declare
  actor_id text;
  actor_name text;
  court_id text;
  court_name text;
  court_region text;
  other_ids text[];
  seed_index integer;
  seed_match_id text;
  seed_date date;
  seed_time time := '20:00'::time;
  seed_mode text;
  seed_capacity integer;
  score_a integer;
  score_b integer;
  team_a_played jsonb;
  team_b_played jsonb;
  anonymous_players jsonb;
  excluded_players jsonb;
  rules_json jsonb;
  stat_submissions jsonb;
  created_at timestamptz;
  team_a_ids text[];
  team_b_ids text[];
  scheduled_date date;
  team_a_names jsonb;
  team_b_names jsonb;
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.matches') is null
    or to_regclass('public.match_players') is null
    or to_regclass('public.match_results') is null
    or to_regclass('public.player_match_stats') is null
    or to_regclass('public.match_agreements') is null
    or to_regclass('public.match_approvals') is null then
    return;
  end if;

  select p.id, p.name
  into actor_id, actor_name
  from public.profiles p
  order by
    case
      when p.test_login_id = 'rankball-001' then 0
      when lower(coalesce(p.handle, '')) in ('boyakh', '#boyakh', 'rb001pg', '#rb001pg') then 1
      when lower(coalesce(p.hashtag, '')) in ('boyakh', '#boyakh', 'rb001pg', '#rb001pg') then 1
      when p.auth_user_id is not null then 2
      else 3
    end,
    p.created_at nulls last,
    p.id
  limit 1;

  select c.id, c.name, coalesce(nullif(c.region, ''), nullif(c.region_key, ''), 'seoul:mapo')
  into court_id, court_name, court_region
  from public.courts c
  where nullif(c.id, '') is not null
    and nullif(c.name, '') is not null
  order by case when coalesce(c.region_key, c.region, '') like 'seoul:%' then 0 else 1 end,
    c.created_at nulls last,
    c.id
  limit 1;

  if court_id is null and to_regclass('public.approved_courts') is not null then
    select c.id, c.name, coalesce(nullif(c.region_key, ''), 'seoul:mapo')
    into court_id, court_name, court_region
    from public.approved_courts c
    where coalesce(c.status, 'active') = 'active'
      and nullif(c.id, '') is not null
      and nullif(c.name, '') is not null
    order by case when coalesce(c.region_key, '') like 'seoul:%' then 0 else 1 end,
      c.created_at nulls last,
      c.id
    limit 1;
  end if;

  if actor_id is null or court_id is null then
    return;
  end if;

  select array_agg(id order by sort_order, id)
  into other_ids
  from (
    select p.id,
      case when p.test_login_id is not null then 0 when p.auth_user_id is not null then 1 else 2 end as sort_order
    from public.profiles p
    where p.id <> actor_id
    order by sort_order, p.created_at nulls last, p.id
    limit 12
  ) ranked_profiles;

  for seed_index in 1..3 loop
    seed_match_id := 'm_seed_personal_archive_' || seed_index::text;
    seed_date := (current_date - interval '8 months' + ((seed_index - 1) * interval '9 days'))::date;
    created_at := (seed_date::text || ' ' || seed_time::text)::timestamptz;

    if seed_index = 1 then
      seed_mode := '1v1';
      score_a := 21;
      score_b := 17;
      team_a_played := jsonb_build_array(actor_id);
      team_b_played := jsonb_build_array(seed_match_id || '_b1');
      anonymous_players := jsonb_build_object(
        seed_match_id || '_b1', jsonb_build_object('id', seed_match_id || '_b1', 'name', 'Anonymous 1', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb))
      );
    elsif seed_index = 2 then
      seed_mode := '3v3';
      score_a := 15;
      score_b := 21;
      team_a_played := jsonb_build_array(actor_id, seed_match_id || '_a2', seed_match_id || '_a3');
      team_b_played := jsonb_build_array(seed_match_id || '_b1', seed_match_id || '_b2', seed_match_id || '_b3');
      anonymous_players := jsonb_build_object(
        seed_match_id || '_a2', jsonb_build_object('id', seed_match_id || '_a2', 'name', 'Anonymous 1', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_a3', jsonb_build_object('id', seed_match_id || '_a3', 'name', 'Anonymous 2', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b1', jsonb_build_object('id', seed_match_id || '_b1', 'name', 'Anonymous 3', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b2', jsonb_build_object('id', seed_match_id || '_b2', 'name', 'Anonymous 4', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b3', jsonb_build_object('id', seed_match_id || '_b3', 'name', 'Anonymous 5', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb))
      );
    else
      seed_mode := '5v5';
      score_a := 32;
      score_b := 29;
      team_a_played := jsonb_build_array(actor_id, seed_match_id || '_a2', seed_match_id || '_a3', seed_match_id || '_a4', seed_match_id || '_a5');
      team_b_played := jsonb_build_array(seed_match_id || '_b1', seed_match_id || '_b2', seed_match_id || '_b3', seed_match_id || '_b4', seed_match_id || '_b5');
      anonymous_players := jsonb_build_object(
        seed_match_id || '_a2', jsonb_build_object('id', seed_match_id || '_a2', 'name', 'Anonymous 1', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_a3', jsonb_build_object('id', seed_match_id || '_a3', 'name', 'Anonymous 2', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_a4', jsonb_build_object('id', seed_match_id || '_a4', 'name', 'Anonymous 3', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_a5', jsonb_build_object('id', seed_match_id || '_a5', 'name', 'Anonymous 4', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b1', jsonb_build_object('id', seed_match_id || '_b1', 'name', 'Anonymous 5', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b2', jsonb_build_object('id', seed_match_id || '_b2', 'name', 'Anonymous 6', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b3', jsonb_build_object('id', seed_match_id || '_b3', 'name', 'Anonymous 7', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b4', jsonb_build_object('id', seed_match_id || '_b4', 'name', 'Anonymous 8', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb)),
        seed_match_id || '_b5', jsonb_build_object('id', seed_match_id || '_b5', 'name', 'Anonymous 9', 'position', 'FREE', 'anonymous', true, 'participationLabel', 'Personal record', 'club', 'Personal record', 'avatarColor', '#64748b', 'trustScore', '-', 'ratings', jsonb_build_object('integrated', 0, 'modes', '{}'::jsonb))
      );
    end if;

    excluded_players := (
      select jsonb_agg(value)
      from (
        select value from jsonb_array_elements(team_a_played)
        union all
        select value from jsonb_array_elements(team_b_played)
      ) all_players
    );
    stat_submissions := jsonb_build_object(actor_id, jsonb_build_object('by', actor_id, 'source', 'host_postgame', 'submittedAt', created_at));
    select coalesce(jsonb_agg(coalesce(anonymous_players->value->>'name', case when value = actor_id then coalesce(actor_name, 'Me') else value end)), '[]'::jsonb)
    into team_a_names
    from jsonb_array_elements_text(team_a_played) as ids(value);
    select coalesce(jsonb_agg(coalesce(anonymous_players->value->>'name', value)), '[]'::jsonb)
    into team_b_names
    from jsonb_array_elements_text(team_b_played) as ids(value);
    rules_json := jsonb_build_object(
      'recordType', 'solo',
      'timingType', 'scheduled',
      'visibility', 'private',
      'region', court_region,
      'ratingScale', 0,
      'statRecorders', '{}'::jsonb,
      'playedPlayerIds', jsonb_build_object('teamA', team_a_played, 'teamB', team_b_played),
      'mmrExcludedPlayerIds', excluded_players,
      'recordSummary', jsonb_build_object(
        'mode', seed_mode,
        'teamAName', 'My side',
        'teamBName', 'Opponent',
        'teamAPlayers', team_a_names,
        'teamBPlayers', team_b_names
      )
    );

    insert into public.matches (
      id, title, mode, court_id, court_name, visibility, status, ranked, mmr_limit_mode,
      trust_feedback, referee_id, former_referee_id, referee_trust_min, stat_entry_minutes,
      dispute_minutes, stat_recorders, played_player_ids, reserve_players, promoted_reserve_ids,
      attendance, referee_absence_request, dispute_draft_result, dispute_draft_updated_at,
      dispute_resolved_at, mmr_excluded_player_ids, anonymous_players, tournament_id,
      tournament_format, tournament_round, tournament_fixture, tournament_mmr_policy,
      official, pre_registered, scheduled_at, scheduled_date, scheduled_time, team_a_id,
      team_b_id, score_a, score_b, rules, memo, stakes, objection_window, evidence,
      created_by, created_at, agreed_at, started_at, ended_at, confirmed_at, cancelled_at,
      voided_at, rating_result, team_rating_result, updated_at
    )
    values (
      seed_match_id, 'Personal archive ' || seed_index::text, seed_mode, court_id, court_name, 'private', 'confirmed', false, 'off',
      '{}'::jsonb, null, null, 90, 60,
      120, '{}'::jsonb, jsonb_build_object('teamA', team_a_played, 'teamB', team_b_played), '{}'::jsonb, '{}'::jsonb,
      jsonb_build_object('teamA', team_a_played, 'teamB', team_b_played), null, null, null,
      null, excluded_players, anonymous_players, null,
      null, null, null, null,
      false, false, seed_date::text || ' ' || left(seed_time::text, 5), seed_date, seed_time, null,
      null, score_a, score_b, rules_json, '8 month old personal record sample', 'MMR excluded', 'none', '[]'::jsonb,
      actor_id, created_at, created_at, created_at, created_at + interval '1 hour', created_at + interval '1 hour', null,
      null, '[]'::jsonb, '{"teamA":0,"teamB":0,"teams":{}}'::jsonb, now()
    )
    on conflict (id) do nothing;

    insert into public.match_players (match_id, team_id, user_id, side, slot_order)
    select seed_match_id, null, actor_id, 'teamA', 0
    where not exists (
      select 1 from public.match_players where match_id = seed_match_id and user_id = actor_id
    );

    insert into public.match_results (match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at)
    values (seed_match_id, actor_id, score_a, score_b, stat_submissions, created_at + interval '1 hour')
    on conflict (match_id) do nothing;

    insert into public.player_match_stats (match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at)
    values (seed_match_id, actor_id, actor_id, 'host_postgame', greatest(score_a - 3, 0), 4 + seed_index, 3 + seed_index, seed_index, 0, seed_index, created_at + interval '1 hour')
    on conflict (match_id, user_id) do nothing;

    insert into public.match_agreements (match_id, user_id, side)
    values (seed_match_id, actor_id, 'teamA')
    on conflict (match_id, user_id) do nothing;

    insert into public.match_approvals (match_id, user_id, side)
    values (seed_match_id, actor_id, 'teamA')
    on conflict (match_id, user_id) do nothing;

    if to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
      perform public.rankball_refresh_match_feed_for_match(seed_match_id);
    end if;
    if to_regprocedure('public.rankball_refresh_profile_match_summaries_for_match(text)') is not null then
      perform public.rankball_refresh_profile_match_summaries_for_match(seed_match_id);
    end if;
  end loop;

  for seed_index in 1..4 loop
    seed_capacity := case seed_index when 1 then 1 when 2 then 2 when 3 then 3 else 5 end;
    if coalesce(array_length(other_ids, 1), 0) < (seed_capacity * 2 - 1) then
      continue;
    end if;

    seed_match_id := 'm_seed_upcoming_' || seed_index::text;
    seed_mode := seed_capacity::text || 'v' || seed_capacity::text;
    scheduled_date := current_date + (seed_index * 3);
    team_a_ids := array[actor_id];
    if seed_capacity > 1 then
      team_a_ids := team_a_ids || other_ids[1:(seed_capacity - 1)];
    end if;
    team_b_ids := other_ids[seed_capacity:(seed_capacity * 2 - 1)];
    created_at := now() - (seed_index * interval '5 minutes');

    rules_json := jsonb_build_object(
      'timingType', 'scheduled',
      'visibility', 'private',
      'region', court_region,
      'targetScore', 21,
      'timeLimit', 12,
      'ball', 'size 7',
      'attackRule', 'possession changes',
      'foulRule', 'stop on foul',
      'mmrRangeMode', 'wide',
      'ratingScale', case when seed_index in (3, 4) then 1 else 0 end,
      'statRecorders', '{}'::jsonb,
      'recordSummary', jsonb_build_object(
        'teamAName', 'A side',
        'teamBName', 'B side'
      )
    );

    insert into public.matches (
      id, title, mode, court_id, court_name, visibility, status, ranked, mmr_limit_mode,
      trust_feedback, referee_id, former_referee_id, referee_trust_min, stat_entry_minutes,
      dispute_minutes, stat_recorders, played_player_ids, reserve_players, promoted_reserve_ids,
      attendance, referee_absence_request, dispute_draft_result, dispute_draft_updated_at,
      dispute_resolved_at, mmr_excluded_player_ids, anonymous_players, tournament_id,
      tournament_format, tournament_round, tournament_fixture, tournament_mmr_policy,
      official, pre_registered, scheduled_at, scheduled_date, scheduled_time, team_a_id,
      team_b_id, score_a, score_b, rules, memo, stakes, objection_window, evidence,
      created_by, created_at, agreed_at, started_at, ended_at, confirmed_at, cancelled_at,
      voided_at, rating_result, team_rating_result, updated_at
    )
    values (
      seed_match_id, 'Upcoming match sample ' || seed_index::text, seed_mode, court_id, court_name, 'private', 'agreed', seed_index in (3, 4), 'block',
      '{}'::jsonb, null, null, 90, 60,
      120, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
      '{"teamA":[],"teamB":[]}'::jsonb, null, null, null,
      null, '[]'::jsonb, '{}'::jsonb, null,
      null, null, null, null,
      false, true, scheduled_date::text || ' 20:00', scheduled_date, '20:00'::time, null,
      null, 0, 0, rules_json, 'Frontend creation flow upcoming match sample', '', '30 minutes', '[]'::jsonb,
      actor_id, created_at, created_at, null, null, null, null,
      null, null, null, now()
    )
    on conflict (id) do nothing;

    insert into public.match_players (match_id, team_id, user_id, side, slot_order)
    select seed_match_id, null, player_id, 'teamA', ordinality::integer - 1
    from unnest(team_a_ids) with ordinality as players(player_id, ordinality)
    where not exists (
      select 1 from public.match_players mp where mp.match_id = seed_match_id and mp.user_id = players.player_id
    );

    insert into public.match_players (match_id, team_id, user_id, side, slot_order)
    select seed_match_id, null, player_id, 'teamB', ordinality::integer - 1
    from unnest(team_b_ids) with ordinality as players(player_id, ordinality)
    where not exists (
      select 1 from public.match_players mp where mp.match_id = seed_match_id and mp.user_id = players.player_id
    );

    insert into public.match_agreements (match_id, user_id, side)
    select seed_match_id, player_id, 'teamA'
    from unnest(team_a_ids) as players(player_id)
    on conflict (match_id, user_id) do nothing;

    insert into public.match_agreements (match_id, user_id, side)
    select seed_match_id, player_id, 'teamB'
    from unnest(team_b_ids) as players(player_id)
    on conflict (match_id, user_id) do nothing;

    insert into public.match_approvals (match_id, user_id, side)
    select seed_match_id, player_id, 'teamA'
    from unnest(team_a_ids) as players(player_id)
    on conflict (match_id, user_id) do nothing;

    insert into public.match_approvals (match_id, user_id, side)
    select seed_match_id, player_id, 'teamB'
    from unnest(team_b_ids) as players(player_id)
    on conflict (match_id, user_id) do nothing;

    if to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
      perform public.rankball_refresh_match_feed_for_match(seed_match_id);
    end if;
  end loop;
end;
$$;
