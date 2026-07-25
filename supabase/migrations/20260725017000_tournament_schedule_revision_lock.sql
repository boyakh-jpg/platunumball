do $$
begin
  if to_regprocedure('public.rankball_tournament_match_schedule_action_unrestricted(text,text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_tournament_match_schedule_action(text,text,text,jsonb)') is null then
      raise exception 'rankball_tournament_match_schedule_action_missing';
    end if;
    alter function public.rankball_tournament_match_schedule_action(text, text, text, jsonb)
      rename to rankball_tournament_match_schedule_action_unrestricted;
  end if;
end
$$;

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
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_tournament_id text := nullif(btrim(p_tournament_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_schedule jsonb := coalesce(p_schedule, '{}'::jsonb);
  safe_court_id text;
  schedule_date date;
  schedule_time time;
  current_tournament public.tournaments%rowtype;
  current_match public.matches%rowtype;
  had_schedule boolean := false;
  schedule_changed boolean := false;
  lineup_submitted boolean := false;
  revision_count integer := 0;
  now_at timestamptz := now();
  result jsonb;
begin
  if safe_actor_id is null or safe_tournament_id is null or safe_match_id is null then
    raise exception 'tournament_schedule_target_missing' using errcode = '22023';
  end if;

  begin
    schedule_date := nullif(btrim(safe_schedule->>'scheduledDate'), '')::date;
    schedule_time := nullif(btrim(safe_schedule->>'scheduledTime'), '')::time;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      raise exception 'invalid_tournament_match_schedule' using errcode = '23514';
  end;
  if schedule_date is null or schedule_time is null or schedule_date < current_date or schedule_date > current_date + 365 then
    raise exception 'invalid_tournament_match_schedule' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_tournament
  from public.tournaments
  where id = safe_tournament_id
  for update;
  if current_tournament.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if current_tournament.created_by <> safe_actor_id then
    raise exception 'tournament_owner_required' using errcode = '42501';
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null or current_match.tournament_id is distinct from safe_tournament_id then
    raise exception 'tournament_match_not_found' using errcode = 'P0002';
  end if;
  if current_match.status in ('cancelled', 'void', 'voided', 'closed', 'confirmed')
     or current_match.started_at is not null
     or current_match.ended_at is not null then
    raise exception 'tournament_match_schedule_locked' using errcode = '23514';
  end if;

  safe_court_id := coalesce(
    nullif(btrim(safe_schedule->>'courtId'), ''),
    current_match.court_id,
    current_tournament.court_id
  );
  had_schedule := current_match.scheduled_date is not null and current_match.scheduled_time is not null;
  schedule_changed := current_match.scheduled_date is distinct from schedule_date
    or current_match.scheduled_time is distinct from schedule_time
    or current_match.court_id is distinct from safe_court_id;

  revision_count := case
    when coalesce(current_match.rules->>'tournamentScheduleRevisionCount', '') ~ '^[0-9]+$'
      then (current_match.rules->>'tournamentScheduleRevisionCount')::integer
    else 0
  end;

  if not schedule_changed then
    return jsonb_build_object(
      'ok', true,
      'action', 'updateTournamentMatchSchedule',
      'tournamentId', safe_tournament_id,
      'matchId', safe_match_id,
      'scheduledDate', current_match.scheduled_date,
      'scheduledTime', left(current_match.scheduled_time::text, 5),
      'courtId', current_match.court_id,
      'courtName', current_match.court_name,
      'scheduleRevisionCount', revision_count,
      'idempotent', true,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  lineup_submitted := coalesce(current_match.rules#>>'{rosterReady,teamA}', 'false') = 'true'
    or coalesce(current_match.rules#>>'{rosterReady,teamB}', 'false') = 'true';
  if had_schedule and lineup_submitted then
    raise exception 'tournament_schedule_lineup_submitted' using errcode = '23514';
  end if;
  if had_schedule and revision_count >= 1 then
    raise exception 'tournament_schedule_revision_limit' using errcode = '23514';
  end if;

  result := public.rankball_tournament_match_schedule_action_unrestricted(
    safe_actor_id,
    safe_tournament_id,
    safe_match_id,
    safe_schedule
  );

  revision_count := revision_count + case when had_schedule then 1 else 0 end;
  update public.matches match_row
  set rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'tournamentScheduleRevisionCount', revision_count,
        'tournamentScheduleSetAt', coalesce(
          match_row.rules->'tournamentScheduleSetAt',
          to_jsonb(now_at)
        ),
        'tournamentScheduleUpdatedAt', case
          when had_schedule then to_jsonb(now_at)
          else 'null'::jsonb
        end
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'scheduleRevisionCount', revision_count,
    'scheduleChanged', true,
    'initialSchedule', not had_schedule
  );
end
$$;

revoke all on function public.rankball_tournament_match_schedule_action_unrestricted(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) to service_role;

notify pgrst, 'reload schema';
