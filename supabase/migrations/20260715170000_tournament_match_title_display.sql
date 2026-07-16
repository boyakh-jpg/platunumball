create or replace function public.rankball_create_tournament_match_locked(
  p_tournament_id text,
  p_team_a_id text,
  p_team_b_id text,
  p_round integer,
  p_fixture integer,
  p_preferred_match_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  safe_match_id text;
  team_a_name text;
  team_b_name text;
  match_row jsonb;
  now_at timestamptz := now();
begin
  select * into tournament_row
  from public.tournaments
  where id = nullif(btrim(p_tournament_id), '')
  for update;

  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if nullif(btrim(p_team_a_id), '') is null or nullif(btrim(p_team_b_id), '') is null or p_team_a_id = p_team_b_id then
    raise exception 'invalid_tournament_pairing' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tournament_teams where tournament_id = tournament_row.id and team_id = p_team_a_id and status = 'accepted')
     or not exists (select 1 from public.tournament_teams where tournament_id = tournament_row.id and team_id = p_team_b_id and status = 'accepted') then
    raise exception 'tournament_pairing_team_not_accepted' using errcode = '23514';
  end if;

  safe_match_id := public.rankball_tournament_match_id(tournament_row.id, p_round, p_fixture, p_preferred_match_id);
  if exists (
    select 1 from public.matches
    where tournament_id = tournament_row.id
      and tournament_round = p_round
      and tournament_fixture = p_fixture
      and id <> safe_match_id
  ) then
    raise exception 'tournament_fixture_already_exists' using errcode = '23505';
  end if;

  select name into team_a_name from public.teams where id = p_team_a_id and deleted_at is null;
  select name into team_b_name from public.teams where id = p_team_b_id and deleted_at is null;
  if team_a_name is null or team_b_name is null then
    raise exception 'tournament_team_not_found' using errcode = 'P0002';
  end if;

  match_row := jsonb_build_object(
    'id', safe_match_id,
    'title', case when tournament_row.format = 'tournament' then p_round::text || 'R-' || p_fixture::text else 'L-' || p_fixture::text end || ' · ' || team_a_name || ' vs ' || team_b_name,
    'mode', coalesce(tournament_row.mode, '5v5'),
    'court_id', tournament_row.court_id,
    'court_name', coalesce(tournament_row.court_name, '미정'),
    'visibility', coalesce(tournament_row.visibility, 'private'),
    'status', 'agreed',
    'ranked', coalesce(tournament_row.ranked, true),
    'mmr_limit_mode', coalesce(tournament_row.mmr_limit_mode, 'warn'),
    'trust_feedback', '{}'::jsonb,
    'referee_id', null,
    'former_referee_id', null,
    'referee_trust_min', 90,
    'stat_entry_minutes', 60,
    'dispute_minutes', 30,
    'stat_recorders', '{}'::jsonb,
    'played_player_ids', jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
    'reserve_players', jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
    'promoted_reserve_ids', '{}'::jsonb,
    'attendance', jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb),
    'referee_absence_request', null,
    'dispute_draft_result', null,
    'dispute_draft_updated_at', null,
    'dispute_resolved_at', null,
    'mmr_excluded_player_ids', '[]'::jsonb
  ) || jsonb_build_object(
    'anonymous_players', '{}'::jsonb,
    'tournament_id', tournament_row.id,
    'tournament_format', tournament_row.format,
    'tournament_round', p_round,
    'tournament_fixture', p_fixture,
    'tournament_mmr_policy', tournament_row.mmr_policy,
    'official', coalesce(tournament_row.official, false),
    'pre_registered', true,
    'scheduled_at', '일정 미정',
    'scheduled_date', null,
    'scheduled_time', null,
    'team_a_id', p_team_a_id,
    'team_b_id', p_team_b_id,
    'score_a', 0,
    'score_b', 0,
    'rules', coalesce(tournament_row.rules, '{}'::jsonb) || jsonb_build_object(
      'visibility', tournament_row.visibility,
      'rosterReady', jsonb_build_object('teamA', false, 'teamB', false)
    ),
    'memo', coalesce(nullif(tournament_row.memo, ''), '대회 경기입니다.'),
    'stakes', '대회 경기 MMR 가중치가 적용됩니다.',
    'objection_window', '30분',
    'evidence', '[]'::jsonb,
    'created_by', tournament_row.created_by,
    'created_at', now_at,
    'agreed_at', now_at,
    'started_at', null,
    'ended_at', null,
    'confirmed_at', null,
    'cancelled_at', null,
    'voided_at', null,
    'rating_result', null,
    'team_rating_result', null,
    'updated_at', now_at
  );

  perform public.rankball_persist_match_snapshot(
    match_row,
    '[]'::jsonb,
    null,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    false
  );

  update public.tournaments
  set match_ids = coalesce(match_ids, '[]'::jsonb) || to_jsonb(safe_match_id), updated_at = now_at
  where id = tournament_row.id
    and not coalesce(match_ids, '[]'::jsonb) ? safe_match_id;

  return jsonb_build_object(
    'id', safe_match_id,
    'tournamentId', tournament_row.id,
    'round', p_round,
    'fixture', p_fixture,
    'teamAId', p_team_a_id,
    'teamBId', p_team_b_id,
    'rosterPending', true
  );
end;
$$;

revoke all on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) to service_role;
