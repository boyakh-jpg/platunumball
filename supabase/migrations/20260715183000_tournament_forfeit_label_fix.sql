-- Qualify local score variables without letting PostgreSQL parse the block name as a table alias.
create or replace function public.rankball_tournament_match_forfeit_action(
  p_actor_profile_id text,
  p_tournament_id text,
  p_match_id text,
  p_losing_side text,
  p_reason text default '팀 불참'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
<<tournament_match_forfeit_action>>
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_tournament_id text := nullif(btrim(p_tournament_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_losing_side text := nullif(btrim(p_losing_side), '');
  safe_reason text := left(coalesce(nullif(btrim(p_reason), ''), '팀 불참'), 120);
  current_tournament public.tournaments%rowtype;
  current_match public.matches%rowtype;
  local_start timestamp;
  excluded_player_ids jsonb := '[]'::jsonb;
  winner_team_id text;
  winner_team_name text;
  loser_team_name text;
  score_a integer;
  score_b integer;
  captain_row record;
  notified_count integer := 0;
  now_at timestamptz := now();
begin
  if safe_actor_id is null or safe_tournament_id is null or safe_match_id is null or safe_losing_side not in ('teamA', 'teamB') then
    raise exception 'tournament_forfeit_target_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_tournament from public.tournaments where id = safe_tournament_id for update;
  if current_tournament.id is null then raise exception 'tournament_not_found' using errcode = 'P0002'; end if;
  if current_tournament.created_by <> safe_actor_id then raise exception 'tournament_owner_required' using errcode = '42501'; end if;
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null or current_match.tournament_id is distinct from safe_tournament_id then
    raise exception 'tournament_match_not_found' using errcode = 'P0002';
  end if;
  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or current_match.started_at is not null or current_match.ended_at is not null
     or exists (select 1 from public.match_results result_row where result_row.match_id = safe_match_id) then
    raise exception 'tournament_match_forfeit_locked' using errcode = '23514';
  end if;
  if current_match.scheduled_date is null or current_match.scheduled_time is null then
    raise exception 'tournament_match_schedule_required' using errcode = '23514';
  end if;
  local_start := current_match.scheduled_date + current_match.scheduled_time;
  if local_start > (now_at at time zone 'Asia/Seoul') then
    raise exception 'tournament_match_forfeit_before_start' using errcode = '23514';
  end if;

  score_a := case when safe_losing_side = 'teamA' then 0 else 1 end;
  score_b := case when safe_losing_side = 'teamB' then 0 else 1 end;
  winner_team_id := case when safe_losing_side = 'teamA' then current_match.team_b_id else current_match.team_a_id end;
  select coalesce(jsonb_agg(distinct player_row.user_id), '[]'::jsonb)
  into excluded_player_ids
  from public.match_players player_row
  where player_row.match_id = safe_match_id;

  insert into public.match_results (match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at)
  values (safe_match_id, safe_actor_id, score_a, score_b, '{}'::jsonb, now_at);

  update public.matches
  set status = 'confirmed',
      score_a = tournament_match_forfeit_action.score_a,
      score_b = tournament_match_forfeit_action.score_b,
      mmr_excluded_player_ids = excluded_player_ids,
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'forfeit', jsonb_build_object(
          'losingSide', safe_losing_side,
          'reason', safe_reason,
          'decidedBy', safe_actor_id,
          'decidedAt', now_at,
          'mmrCommitted', false
        )
      ),
      ended_at = now_at,
      confirmed_at = now_at,
      rating_result = null,
      team_rating_result = null,
      updated_at = now_at
  where id = safe_match_id;

  select name into winner_team_name from public.teams where id = winner_team_id;
  select name into loser_team_name from public.teams where id = case when safe_losing_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;

  for captain_row in
    select tm.user_id as captain_id
    from public.team_members tm
    where tm.role = 'captain' and tm.team_id in (current_match.team_a_id, current_match.team_b_id)
  loop
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id,
      discord_event, read_at, payload, created_at, updated_at
    ) values (
      'tournament-forfeit-' || substr(md5(safe_match_id || ':' || captain_row.captain_id), 1, 24),
      captain_row.captain_id,
      captain_row.captain_id,
      '대회 경기 몰수 확정',
      coalesce(winner_team_name, '상대 팀') || ' 1:0 몰수승 · ' || coalesce(loser_team_name, '불참 팀') || ' 불참',
      'match',
      'tournament_match_forfeit',
      safe_match_id,
      'match',
      null,
      jsonb_build_object(
        'targetUserId', captain_row.captain_id,
        'tournamentId', safe_tournament_id,
        'matchId', safe_match_id,
        'losingSide', safe_losing_side,
        'reason', safe_reason,
        'actionRequired', false,
        'homeAction', false,
        'webPath', '/app/tournaments/' || safe_tournament_id
      ),
      now_at,
      now_at
    ) on conflict (id) do update set
      body = excluded.body,
      target_user_id = excluded.target_user_id,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
    notified_count := notified_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'action', 'forfeitTournamentMatch',
    'tournamentId', safe_tournament_id,
    'matchId', safe_match_id,
    'losingSide', safe_losing_side,
    'winnerTeamId', winner_team_id,
    'scoreA', score_a,
    'scoreB', score_b,
    'captainNotificationCount', notified_count,
    'ratingCommitted', false,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_tournament_match_forfeit_action(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_tournament_match_forfeit_action(text, text, text, text, text) to service_role;
