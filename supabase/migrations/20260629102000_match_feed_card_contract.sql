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
  court_display_name text;
  team_a_name text;
  team_b_name text;
  team_a_players jsonb := '[]'::jsonb;
  team_b_players jsonb := '[]'::jsonb;
  agreements_json jsonb := jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb);
  approvals_json jsonb := jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb);
  disputes_json jsonb := '[]'::jsonb;
  player_stats_json jsonb := '{}'::jsonb;
  result_json jsonb := null;
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

  region_key := public.rankball_room_feed_region_key(match_row.rules->>'region');
  row_sort_at := coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at, now());
  court_display_name := nullif(btrim(match_row.court_name), '');

  if court_display_name is null and match_row.court_id is not null then
    select nullif(btrim(name), '') into court_display_name
    from public.approved_courts
    where id = match_row.court_id
      and coalesce(status, 'active') = 'active';
  end if;

  if court_display_name is null and match_row.court_id is not null and to_regclass('public.courts') is not null then
    execute 'select name from public.courts where id = $1 limit 1'
    into court_display_name
    using match_row.court_id;
    court_display_name := nullif(btrim(court_display_name), '');
  end if;

  if match_row.team_a_id is not null then
    select name into team_a_name
    from public.teams
    where id = match_row.team_a_id;
  end if;

  if match_row.team_b_id is not null then
    select name into team_b_name
    from public.teams
    where id = match_row.team_b_id;
  end if;

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

  select coalesce(jsonb_object_agg(stat.user_id, jsonb_build_object(
    'points', coalesce(stat.points, 0),
    'rebounds', coalesce(stat.rebounds, 0),
    'assists', coalesce(stat.assists, 0),
    'steals', coalesce(stat.steals, 0),
    'blocks', coalesce(stat.blocks, 0),
    'fouls', coalesce(stat.fouls, 0)
  )), '{}'::jsonb)
  into player_stats_json
  from public.player_match_stats stat
  where stat.match_id = match_row.id;

  select jsonb_build_object(
    'scoreA', result.score_a,
    'scoreB', result.score_b,
    'playerStats', player_stats_json,
    'statSubmissions', coalesce(result.stat_submissions, '{}'::jsonb),
    'submittedBy', coalesce(result.submitted_by, ''),
    'submittedAt', result.submitted_at
  )
  into result_json
  from public.match_results result
  where result.match_id = match_row.id
  order by result.submitted_at desc nulls last
  limit 1;

  card_json := jsonb_build_object(
    'id', match_row.id,
    'listCardOnly', true,
    'title', match_row.title,
    'mode', match_row.mode,
    'court', coalesce(court_display_name, '미정'),
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
      'name', coalesce(team_a_name, 'Team A'),
      'players', team_a_players,
      'score', coalesce(match_row.score_a, 0)
    ),
    'teamB', jsonb_build_object(
      'teamId', coalesce(match_row.team_b_id, ''),
      'name', coalesce(team_b_name, 'Team B'),
      'players', team_b_players,
      'score', coalesce(match_row.score_b, 0)
    ),
    'agreements', agreements_json,
    'approvals', approvals_json,
    'disputes', disputes_json,
    'playedPlayerIds', coalesce(match_row.played_player_ids, match_row.rules->'playedPlayerIds', '{}'::jsonb),
    'reservePlayers', coalesce(match_row.reserve_players, match_row.rules->'reservePlayers', '{}'::jsonb),
    'mmrExcludedPlayerIds', coalesce(match_row.mmr_excluded_player_ids, match_row.rules->'mmrExcludedPlayerIds', '[]'::jsonb),
    'anonymousPlayers', coalesce(match_row.anonymous_players, '{}'::jsonb),
    'parties', coalesce(match_row.rules->'parties', '[]'::jsonb),
    'result', result_json,
    'rules', coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
      'playedPlayerIds', coalesce(match_row.played_player_ids, match_row.rules->'playedPlayerIds', '{}'::jsonb),
      'mmrExcludedPlayerIds', coalesce(match_row.mmr_excluded_player_ids, match_row.rules->'mmrExcludedPlayerIds', '[]'::jsonb),
      'statRecorders', coalesce(match_row.stat_recorders, match_row.rules->'statRecorders', '{}'::jsonb)
    ),
    'statRecorders', coalesce(match_row.stat_recorders, match_row.rules->'statRecorders', '{}'::jsonb),
    'statEntryMinutes', coalesce(match_row.stat_entry_minutes, 60),
    'disputeMinutes', coalesce(match_row.dispute_minutes, 30),
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

create or replace function public.rankball_refresh_match_record_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.rankball_refresh_match_feed_for_match(old.match_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.match_id is distinct from new.match_id then
    perform public.rankball_refresh_match_feed_for_match(old.match_id);
  end if;

  perform public.rankball_refresh_match_feed_for_match(new.match_id);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.match_agreements') is not null then
    execute 'drop trigger if exists rankball_match_agreements_feed_refresh on public.match_agreements';
    execute 'create trigger rankball_match_agreements_feed_refresh after insert or update or delete on public.match_agreements for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.match_approvals') is not null then
    execute 'drop trigger if exists rankball_match_approvals_feed_refresh on public.match_approvals';
    execute 'create trigger rankball_match_approvals_feed_refresh after insert or update or delete on public.match_approvals for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;

  if to_regclass('public.match_disputes') is not null then
    execute 'drop trigger if exists rankball_match_disputes_feed_refresh on public.match_disputes';
    execute 'create trigger rankball_match_disputes_feed_refresh after insert or update or delete on public.match_disputes for each row execute function public.rankball_refresh_match_record_feed_dependency_trigger()';
  end if;
end;
$$;

create or replace function public.rankball_feed_trigger_health()
returns table(trigger_name text, event_object_table text)
language sql
security definer
set search_path = public
as $$
  select
    trigger_row.trigger_name::text,
    trigger_row.event_object_table::text
  from information_schema.triggers as trigger_row
  where trigger_row.trigger_schema = 'public'
    and trigger_row.trigger_name = any(array[
      'rankball_recruiting_posts_feed_refresh',
      'rankball_recruiting_applications_feed_refresh',
      'rankball_matches_feed_refresh',
      'rankball_match_players_feed_refresh',
      'rankball_match_agreements_feed_refresh',
      'rankball_match_approvals_feed_refresh',
      'rankball_match_disputes_feed_refresh',
      'rankball_team_members_feed_dependency_refresh',
      'rankball_match_results_feed_refresh',
      'rankball_player_match_stats_feed_refresh',
      'rankball_profiles_feed_dependency_refresh',
      'rankball_teams_feed_dependency_refresh',
      'rankball_approved_courts_feed_dependency_refresh',
      'rankball_courts_feed_dependency_refresh'
    ])
  order by trigger_row.trigger_name;
$$;

revoke all on function public.rankball_feed_trigger_health() from public;
grant execute on function public.rankball_feed_trigger_health() to service_role;

do $$
declare
  row_id text;
begin
  for row_id in
    select id from public.matches
  loop
    perform public.rankball_refresh_match_feed_for_match(row_id);
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');
