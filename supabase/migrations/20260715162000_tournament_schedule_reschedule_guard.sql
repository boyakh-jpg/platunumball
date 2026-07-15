create or replace function public.rankball_tournament_match_schedule_action(
  p_actor_profile_id text,
  p_tournament_id text,
  p_match_id text,
  p_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
<<tournament_match_schedule_action>>
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_tournament_id text := nullif(btrim(p_tournament_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  schedule_date date;
  schedule_time time;
  current_tournament public.tournaments%rowtype;
  current_match public.matches%rowtype;
  captain_row record;
  notified_count integer := 0;
  now_at timestamptz := now();
begin
  if safe_actor_id is null or safe_tournament_id is null or safe_match_id is null then
    raise exception 'tournament_schedule_target_missing' using errcode = '22023';
  end if;
  schedule_date := nullif(btrim(p_schedule->>'scheduledDate'), '')::date;
  schedule_time := nullif(btrim(p_schedule->>'scheduledTime'), '')::time;
  if schedule_date is null or schedule_time is null or schedule_date < current_date or schedule_date > current_date + 365 then
    raise exception 'invalid_tournament_match_schedule' using errcode = '23514';
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
  if current_match.status in ('cancelled', 'void', 'voided', 'closed') or current_match.started_at is not null or current_match.ended_at is not null then
    raise exception 'tournament_match_schedule_locked' using errcode = '23514';
  end if;

  update public.matches
  set scheduled_date = tournament_match_schedule_action.schedule_date,
      scheduled_time = tournament_match_schedule_action.schedule_time,
      scheduled_at = tournament_match_schedule_action.schedule_date::text || ' ' || left(tournament_match_schedule_action.schedule_time::text, 5),
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('rosterReady', jsonb_build_object('teamA', false, 'teamB', false)),
      updated_at = now_at
  where id = safe_match_id;

  for captain_row in
    select tm.user_id as captain_id, tm.team_id,
      case when tm.team_id = current_match.team_a_id then 'teamA' else 'teamB' end as side_name
    from public.team_members tm
    where tm.role = 'captain' and tm.team_id in (current_match.team_a_id, current_match.team_b_id)
  loop
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id,
      discord_event, read_at, payload, created_at, updated_at
    ) values (
      'tournament-schedule-' || substr(md5(safe_match_id || ':' || captain_row.captain_id), 1, 24),
      captain_row.captain_id,
      captain_row.captain_id,
      '대회 경기 일정 확정',
      schedule_date::text || ' ' || left(schedule_time::text, 5) || ' 경기의 출전·후보 명단을 구성하세요.',
      'match',
      'tournament_match_schedule',
      safe_match_id,
      'match',
      null,
      jsonb_build_object(
        'targetUserId', captain_row.captain_id,
        'tournamentId', safe_tournament_id,
        'matchId', safe_match_id,
        'teamId', captain_row.team_id,
        'sideName', captain_row.side_name,
        'actionRequired', true,
        'homeAction', true,
        'webPath', '/app/matches?match=' || safe_match_id
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
    'action', 'updateTournamentMatchSchedule',
    'tournamentId', safe_tournament_id,
    'matchId', safe_match_id,
    'scheduledDate', schedule_date,
    'scheduledTime', left(schedule_time::text, 5),
    'captainNotificationCount', notified_count,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) to service_role;
