begin;

create or replace function public.rankball_match_start_action_pre_server_time(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{"teamA": [], "teamB": []}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  next_attendance jsonb;
  actor_side text;
  actor_side_attendance jsonb;
  next_started_at timestamptz;
  next_agreed_at timestamptz;
  next_rules jsonb;
  scheduled_at_kst timestamptz;
  missing_count integer;
  now_at timestamptz := clock_timestamp();
  qr_attendance_enabled boolean;
begin
  perform p_attendance;
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if coalesce(nullif(current_match.referee_id, ''), current_match.created_by) <> safe_actor_id then
    raise exception 'match_start_permission_denied' using errcode = '42501';
  end if;
  if current_match.status not in ('contract', 'agreed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null
     or exists (select 1 from public.match_results where match_id = safe_match_id) then
    raise exception 'match_not_startable' using errcode = '23514';
  end if;

  qr_attendance_enabled := lower(coalesce(current_match.rules->>'qrAttendanceEnabled', 'false')) = 'true';
  if coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then
      raise exception 'match_schedule_missing' using errcode = '23514';
    end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if qr_attendance_enabled and now_at < scheduled_at_kst - interval '20 minutes' then
      raise exception 'match_not_checkin_time' using errcode = '23514';
    elsif not qr_attendance_enabled and now_at < scheduled_at_kst - interval '10 minutes' then
      raise exception 'match_not_checkin_time' using errcode = '23514';
    end if;
  end if;

  next_attendance := jsonb_build_object(
    'teamA',
    case when jsonb_typeof(current_match.attendance->'teamA') = 'array'
      then current_match.attendance->'teamA' else '[]'::jsonb end,
    'teamB',
    case when jsonb_typeof(current_match.attendance->'teamB') = 'array'
      then current_match.attendance->'teamB' else '[]'::jsonb end
  );

  if not qr_attendance_enabled then
    select side into actor_side
    from (
      select side
      from public.match_players
      where match_id = safe_match_id and user_id = safe_actor_id
      union all
      select side_name
      from (values ('teamA'), ('teamB')) side(side_name)
      where jsonb_typeof(current_match.reserve_players->side.side_name) = 'array'
        and (current_match.reserve_players->side.side_name) ? safe_actor_id
    ) actor_roster
    limit 1;
    if actor_side in ('teamA', 'teamB') then
      select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
      into actor_side_attendance
      from (
        select distinct value
        from (
          select value from jsonb_array_elements_text(next_attendance->actor_side) attendee(value)
          union all
          select safe_actor_id
        ) values_to_attend
        where value is not null and value <> ''
      ) unique_attendees;
      next_attendance := jsonb_set(next_attendance, array[actor_side], actor_side_attendance, true);
    end if;
  end if;

  if qr_attendance_enabled then
    with roster as (
      select side, user_id
      from public.match_players
      where match_id = safe_match_id and side in ('teamA', 'teamB')
      union
      select side.side_name, reserve.value
      from (values ('teamA'), ('teamB')) side(side_name)
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(current_match.reserve_players->side.side_name) = 'array'
          then current_match.reserve_players->side.side_name else '[]'::jsonb end
      ) reserve(value)
    )
    select count(*)
    into missing_count
    from roster
    left join public.match_attendance_entries entry
      on entry.match_id = safe_match_id and entry.player_id = roster.user_id
    where roster.user_id is not null
      and roster.user_id <> ''
      and roster.user_id is distinct from nullif(current_match.referee_id, '')
      and coalesce(entry.status, 'pending') not in ('on_time', 'late');

    if missing_count > 0
       and (scheduled_at_kst is null or now_at < scheduled_at_kst) then
      raise exception 'match_attendance_missing' using errcode = '23514';
    end if;
  else
    with roster as (
      select side, user_id
      from public.match_players
      where match_id = safe_match_id and side in ('teamA', 'teamB')
      union
      select side.side_name, reserve.value
      from (values ('teamA'), ('teamB')) side(side_name)
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(current_match.reserve_players->side.side_name) = 'array'
          then current_match.reserve_players->side.side_name else '[]'::jsonb end
      ) reserve(value)
    )
    select count(*)
    into missing_count
    from roster
    where user_id is not null
      and user_id <> ''
      and not ((next_attendance->side) ? user_id);
    if missing_count > 0 then
      raise exception 'match_attendance_missing' using errcode = '23514';
    end if;
  end if;

  next_started_at := coalesce(
    nullif(btrim(coalesce(p_started_at, '')), '')::timestamptz,
    now_at
  );
  next_agreed_at := coalesce(
    current_match.agreed_at,
    nullif(btrim(coalesce(p_agreed_at, '')), '')::timestamptz,
    next_started_at
  );
  next_rules := jsonb_set(
    coalesce(current_match.rules, '{}'::jsonb),
    '{startedAt}',
    to_jsonb(next_started_at::text),
    true
  );

  update public.matches
  set status = 'agreed',
      agreed_at = next_agreed_at,
      started_at = next_started_at,
      attendance = next_attendance,
      rules = next_rules,
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'startMatch',
    'matchId', safe_match_id,
    'startedAt', next_started_at,
    'agreedAt', next_agreed_at,
    'missingAttendanceCount', missing_count,
    'sqlReducer', true,
    'advisoryLocked', true,
    'serverTimed', true
  );
end;
$$;

do $patch$
declare
  signature text;
  function_def text;
begin
  foreach signature in array array[
    'public.rankball_match_attendance_qr_action(text,text)',
    'public.rankball_match_attendance_resize_action(text,text)',
    'public.rankball_match_checkin_action(text,text,text,text)'
  ]
  loop
    if to_regprocedure(signature) is null then
      raise exception 'match_attendance_policy_function_missing: %', signature using errcode = '42883';
    end if;
    function_def := pg_get_functiondef(to_regprocedure(signature));
    if strpos(function_def, 'interval ''20 minutes''') = 0 then
      if strpos(function_def, 'interval ''10 minutes''') = 0 then
        raise exception 'match_attendance_window_shape_changed: %', signature using errcode = '23514';
      end if;
      execute replace(function_def, 'interval ''10 minutes''', 'interval ''20 minutes''');
    end if;
  end loop;
end;
$patch$;

do $patch$
declare
  function_signature text := 'public.rankball_match_attendance_qr_action(text,text)';
  function_def text;
  old_capacity_guard text := 'if reserve_count >= 3 then';
  new_capacity_guard text := $guard$if reserve_count >= (case
      when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-3]$'
        then (current_match.rules->>'benchCapacity')::integer
      else 3
    end) then$guard$;
  old_rules text := $old$next_rules := coalesce(current_match.rules, '{}'::jsonb) || jsonb_build_object(
    'benchCapacity',
    greatest(
      coalesce(nullif(current_match.rules->>'benchCapacity', '')::integer, 0),
      jsonb_array_length(next_reserves)
    ),
    'attendanceStatusUpdatedAt', now()
  );$old$;
  new_rules text := $new$next_rules := coalesce(current_match.rules, '{}'::jsonb) || jsonb_build_object(
    'attendanceStatusUpdatedAt', clock_timestamp()
  );$new$;
begin
  function_def := pg_get_functiondef(to_regprocedure(function_signature));
  if strpos(function_def, new_capacity_guard) = 0 then
    if strpos(function_def, old_capacity_guard) = 0 then
      raise exception 'match_late_reserve_capacity_shape_changed' using errcode = '23514';
    end if;
    function_def := replace(function_def, old_capacity_guard, new_capacity_guard);
  end if;
  if strpos(function_def, new_rules) = 0 then
    if strpos(function_def, old_rules) = 0 then
      raise exception 'match_late_reserve_rules_shape_changed' using errcode = '23514';
    end if;
    function_def := replace(function_def, old_rules, new_rules);
  end if;
  execute function_def;
end;
$patch$;

do $patch$
declare
  function_signature text := 'public.rankball_match_checkin_action(text,text,text,text)';
  function_def text;
  old_fragment text := $old$  update public.matches
  set attendance = jsonb_set(current_attendance, array[safe_side], next_side_attendance, true), updated_at = now()
  where id = safe_match_id;
  return jsonb_build_object$old$;
  new_fragment text := $new$  update public.matches
  set attendance = jsonb_set(current_attendance, array[safe_side], next_side_attendance, true), updated_at = now()
  where id = safe_match_id;
  update public.match_attendance_entries
  set status = 'on_time',
      method = 'operator',
      checked_in_at = coalesce(checked_in_at, clock_timestamp()),
      updated_at = clock_timestamp()
  where match_id = safe_match_id
    and player_id = safe_player_id
    and status = 'pending';
  return jsonb_build_object$new$;
begin
  function_def := pg_get_functiondef(to_regprocedure(function_signature));
  if strpos(function_def, new_fragment) = 0 then
    if strpos(function_def, old_fragment) = 0 then
      raise exception 'match_checkin_attendance_entry_shape_changed' using errcode = '23514';
    end if;
    execute replace(function_def, old_fragment, new_fragment);
  end if;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');

commit;
