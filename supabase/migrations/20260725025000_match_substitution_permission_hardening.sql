-- Keep live substitution authority with the assigned eligible referee or the
-- effective same-side recorder when the match has no referee. The room host
-- does not gain substitution authority from created_by alone.

begin;

create or replace function public.rankball_match_effective_recorder_id(
  p_match_id text,
  p_side text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  current_match public.matches%rowtype;
  side_player_ids text[] := array[]::text[];
  side_reserve_ids text[] := array[]::text[];
  current_recorders jsonb := '{}'::jsonb;
  requested_recorder_id text := '';
  first_reserve_id text := '';
begin
  if safe_match_id is null or safe_side not in ('teamA', 'teamB') then
    return null;
  end if;

  select *
  into current_match
  from public.matches
  where id = safe_match_id;

  if not found then
    return null;
  end if;

  select coalesce(array_agg(mp.user_id order by mp.slot_order, mp.user_id), array[]::text[])
  into side_player_ids
  from public.match_players mp
  where mp.match_id = safe_match_id
    and mp.side = safe_side
    and mp.user_id is not null
    and mp.user_id <> '';

  select coalesce(array_agg(reserve.value order by reserve.ordinality), array[]::text[])
  into side_reserve_ids
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
        then current_match.reserve_players->safe_side
      else '[]'::jsonb
    end
  ) with ordinality as reserve(value, ordinality);

  current_recorders := case
    when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
    when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
    else '{}'::jsonb
  end;
  requested_recorder_id := coalesce(current_recorders->>safe_side, '');
  first_reserve_id := coalesce(side_reserve_ids[1], '');

  return nullif(
    case
      when requested_recorder_id <> '' and requested_recorder_id = any(side_reserve_ids)
        then requested_recorder_id
      when first_reserve_id <> '' then first_reserve_id
      when requested_recorder_id <> '' and requested_recorder_id = any(side_player_ids)
        then requested_recorder_id
      else ''
    end,
    ''
  );
end;
$$;

do $migration$
declare
  source_definition text;
  inner_definition text;
begin
  if to_regprocedure(
    'public.rankball_match_roster_move_action_pre_substitution_permission(text,text,text,text,text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'
    ) is null then
      raise exception 'rankball_match_roster_move_action_missing'
        using errcode = '42883';
    end if;

    source_definition := pg_get_functiondef(
      'public.rankball_match_roster_move_action(text,text,text,text,text,text,text)'::regprocedure
    );
    inner_definition := replace(
      source_definition,
      'CREATE OR REPLACE FUNCTION public.rankball_match_roster_move_action(',
      'CREATE OR REPLACE FUNCTION public.rankball_match_roster_move_action_pre_substitution_permission('
    );

    if inner_definition = source_definition then
      raise exception 'rankball_match_roster_move_action_shape_changed'
        using errcode = '55000';
    end if;

    execute inner_definition;
  end if;
end;
$migration$;

create or replace function public.rankball_match_roster_move_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_side text,
  p_active_player_id text default null,
  p_reserve_player_id text default null,
  p_next_recorder_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  current_match public.matches%rowtype;
  assigned_referee_id text;
  effective_recorder_id text;
  referee_authorized boolean := false;
  recorder_authorized boolean := false;
begin
  if safe_action = 'substituteMatchPlayer' then
    if safe_actor_id is null then
      raise exception 'missing_actor_profile_id' using errcode = '22023';
    end if;
    if safe_match_id is null then
      raise exception 'missing_match' using errcode = '22023';
    end if;
    if safe_side not in ('teamA', 'teamB') then
      raise exception 'invalid_match_side' using errcode = '22023';
    end if;

    select *
    into current_match
    from public.matches
    where id = safe_match_id
    for update;

    if not found then
      raise exception 'match_not_found' using errcode = '22023';
    end if;

    assigned_referee_id := nullif(btrim(current_match.referee_id), '');
    if assigned_referee_id is not null then
      referee_authorized :=
        safe_actor_id = assigned_referee_id
        and public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id);
    elsif assigned_referee_id is null then
      effective_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);
      recorder_authorized := safe_actor_id = effective_recorder_id;
    end if;

    if not referee_authorized and not recorder_authorized then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
  end if;

  return public.rankball_match_roster_move_action_pre_substitution_permission(
    safe_actor_id,
    safe_action,
    safe_match_id,
    safe_side,
    nullif(btrim(p_active_player_id), ''),
    nullif(btrim(p_reserve_player_id), ''),
    nullif(btrim(p_next_recorder_id), '')
  );
end;
$$;

create or replace function public.rankball_match_substitution_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_active_player_id text,
  p_reserve_player_id text,
  p_reason text default 'operator'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_active_player_id text := nullif(btrim(p_active_player_id), '');
  safe_reserve_player_id text := nullif(btrim(p_reserve_player_id), '');
  safe_reason text := coalesce(nullif(btrim(p_reason), ''), 'operator');
  assigned_referee_id text;
  effective_recorder_id text;
  roster_move_actor_id text;
  actor_is_side_reserve boolean := false;
  manager_authorized boolean := false;
  self_substitution boolean := false;
  late_eligible boolean := false;
  result jsonb;
  current_match public.matches%rowtype;
  clock_period integer;
  clock_remaining_ms bigint;
  clock_active_elapsed_ms bigint;
  minimum_seconds integer;
  event_id uuid;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null
     or safe_side not in ('teamA', 'teamB')
     or safe_active_player_id is null
     or safe_reserve_player_id is null then
    raise exception 'invalid_match_substitution_request' using errcode = '22023';
  end if;
  if safe_reason not in ('self', 'late', 'injury', 'ejection', 'operator') then
    raise exception 'invalid_match_substitution_reason' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  actor_is_side_reserve := (
    case
      when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
        then current_match.reserve_players->safe_side
      else '[]'::jsonb
    end
  ) ? safe_actor_id
    and safe_actor_id = safe_reserve_player_id;

  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  if assigned_referee_id is not null then
    manager_authorized :=
      safe_actor_id = assigned_referee_id
      and public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id);
  elsif assigned_referee_id is null then
    effective_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);
    manager_authorized := safe_actor_id = effective_recorder_id;
  end if;

  self_substitution := safe_reason = 'self';
  if self_substitution then
    if not actor_is_side_reserve then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;

    if manager_authorized then
      roster_move_actor_id := safe_actor_id;
    elsif assigned_referee_id is not null then
      roster_move_actor_id := assigned_referee_id;
    elsif assigned_referee_id is null and effective_recorder_id is not null then
      roster_move_actor_id := effective_recorder_id;
    else
      raise exception 'match_substitution_operator_missing' using errcode = '42501';
    end if;
  else
    if not manager_authorized then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    roster_move_actor_id := safe_actor_id;
  end if;

  select exists(
    select 1
    from public.match_attendance_entries entry
    where entry.match_id = safe_match_id
      and entry.player_id = safe_reserve_player_id
      and entry.status = 'late'
      and current_match.started_at is not null
      and entry.checked_in_at >= current_match.started_at
  ) into late_eligible;
  if safe_reason = 'late' and not late_eligible then
    raise exception 'match_late_substitution_not_eligible' using errcode = '23514';
  end if;
  if self_substitution then
    safe_reason := case when late_eligible then 'late' else 'self' end;
  end if;

  if self_substitution then
    result := public.rankball_match_roster_move_action_pre_substitution_permission(
      roster_move_actor_id,
      'substituteMatchPlayer',
      safe_match_id,
      safe_side,
      safe_active_player_id,
      safe_reserve_player_id,
      null
    );
  else
    result := public.rankball_match_roster_move_action(
      roster_move_actor_id,
      'substituteMatchPlayer',
      safe_match_id,
      safe_side,
      safe_active_player_id,
      safe_reserve_player_id,
      null
    );
  end if;
  if coalesce((result->>'fallback')::boolean, false)
     or not coalesce((result->>'ok')::boolean, false) then
    return result;
  end if;

  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  minimum_seconds := greatest(
    60,
    least(
      180,
      round(
        coalesce(nullif(current_match.rules->>'periodCount', '')::numeric, 1)
        * coalesce(nullif(current_match.rules->>'periodMinutes', '')::numeric, 12)
        * 60
        * 0.1
      )::integer
    )
  );
  select session.current_period, session.period_remaining_ms
  into clock_period, clock_remaining_ms
  from public.match_clock_sessions session
  where session.match_id = safe_match_id
  limit 1;
  clock_active_elapsed_ms := public.rankball_match_clock_effective_elapsed_ms(
    safe_match_id,
    now_at
  );

  insert into public.match_substitution_events (
    match_id,
    side,
    active_out_player_id,
    active_in_player_id,
    reason,
    confirmed_by,
    clock_period,
    clock_remaining_ms,
    clock_active_elapsed_ms,
    minimum_meaningful_seconds,
    created_at
  )
  values (
    safe_match_id,
    safe_side,
    safe_active_player_id,
    safe_reserve_player_id,
    safe_reason,
    safe_actor_id,
    clock_period,
    clock_remaining_ms,
    clock_active_elapsed_ms,
    minimum_seconds,
    now_at
  )
  returning id into event_id;

  update public.match_play_intervals
  set ended_at = greatest(started_at, now_at),
      ended_active_elapsed_ms = case
        when clock_active_elapsed_ms is null then ended_active_elapsed_ms
        when started_active_elapsed_ms is null then clock_active_elapsed_ms
        else greatest(started_active_elapsed_ms, clock_active_elapsed_ms)
      end,
      updated_at = now_at
  where match_id = safe_match_id
    and player_id = safe_active_player_id
    and ended_at is null;
  insert into public.match_play_intervals (
    match_id,
    player_id,
    side,
    started_at,
    started_active_elapsed_ms
  )
  values (
    safe_match_id,
    safe_reserve_player_id,
    safe_side,
    now_at,
    clock_active_elapsed_ms
  )
  on conflict (match_id, player_id) where ended_at is null do nothing;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'minimumMeaningfulPlaySeconds', minimum_seconds,
        'lastSubstitutionEventId', event_id,
        'lastSubstitutionAt', now_at
      ),
      updated_at = now_at
  where id = safe_match_id;

  return result || jsonb_build_object(
    'actorProfileId', safe_actor_id,
    'eventId', event_id,
    'reason', safe_reason,
    'clockActiveElapsedMs', clock_active_elapsed_ms,
    'minimumMeaningfulSeconds', minimum_seconds,
    'substitutionEventSaved', true
  );
end;
$$;

revoke all on function public.rankball_match_effective_recorder_id(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_roster_move_action_pre_substitution_permission(
  text, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_roster_move_action(
  text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.rankball_match_substitution_action(
  text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.rankball_match_roster_move_action(
  text, text, text, text, text, text, text
) to service_role;
grant execute on function public.rankball_match_substitution_action(
  text, text, text, text, text, text
) to service_role;

commit;

select pg_notify('pgrst', 'reload schema');
