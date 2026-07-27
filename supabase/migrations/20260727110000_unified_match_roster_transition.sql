begin;

alter table public.match_substitution_events
  drop constraint if exists match_substitution_events_reason_check;
alter table public.match_substitution_events
  add constraint match_substitution_events_reason_check
  check (reason in ('self', 'late', 'injury', 'ejection', 'operator', 'recorder_handoff'));

create or replace function public.rankball_match_roster_transition_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_side text,
  p_active_player_id text default null,
  p_reserve_player_id text default null,
  p_next_recorder_id text default null,
  p_reason text default 'operator'
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
  safe_active_player_id text := nullif(btrim(p_active_player_id), '');
  safe_reserve_player_id text := nullif(btrim(p_reserve_player_id), '');
  safe_next_recorder_id text := nullif(btrim(p_next_recorder_id), '');
  safe_reason text := coalesce(nullif(btrim(p_reason), ''), 'operator');
  assigned_referee_id text;
  current_recorder_id text;
  referee_authorized boolean := false;
  recorder_authorized boolean := false;
  late_eligible boolean := false;
  swapped boolean := false;
  event_active_out_id text;
  event_active_in_id text;
  event_reason text;
  current_match public.matches%rowtype;
  current_recorders jsonb := '{}'::jsonb;
  next_recorders jsonb := '{}'::jsonb;
  handoff_history jsonb := '[]'::jsonb;
  handoff_event jsonb := '{}'::jsonb;
  result jsonb;
  clock_period integer;
  clock_remaining_ms bigint;
  clock_active_elapsed_ms bigint;
  minimum_seconds integer;
  event_id uuid;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_action not in ('handoffMatchRecorder', 'substituteMatchPlayer')
     or safe_match_id is null
     or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_roster_transition_request' using errcode = '22023';
  end if;

  if safe_action = 'substituteMatchPlayer' then
    if safe_active_player_id is null or safe_reserve_player_id is null then
      raise exception 'invalid_match_substitution_request' using errcode = '22023';
    end if;
    if safe_reason not in ('late', 'ejection', 'operator') then
      raise exception 'invalid_match_substitution_reason' using errcode = '22023';
    end if;
  elsif safe_next_recorder_id is null then
    raise exception 'missing_next_recorder' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  current_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);

  if safe_action = 'substituteMatchPlayer' then
    if assigned_referee_id is not null then
      referee_authorized :=
        safe_actor_id = assigned_referee_id
        and public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id);
    else
      recorder_authorized := safe_actor_id = current_recorder_id;
    end if;
    if not referee_authorized and not recorder_authorized then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;

    if safe_reason = 'late' then
      select exists(
        select 1
        from public.match_attendance_entries entry
        where entry.match_id = safe_match_id
          and entry.player_id = safe_reserve_player_id
          and entry.status = 'late'
          and current_match.started_at is not null
          and entry.checked_in_at >= current_match.started_at
      )
      into late_eligible;
      if not late_eligible then
        raise exception 'match_late_substitution_not_eligible' using errcode = '23514';
      end if;
    end if;
  else
    if assigned_referee_id is not null or current_recorder_id is null or safe_actor_id <> current_recorder_id then
      raise exception 'match_recorder_handoff_actor_mismatch' using errcode = '42501';
    end if;
  end if;

  result := public.rankball_match_roster_move_action(
    safe_actor_id,
    safe_action,
    safe_match_id,
    safe_side,
    safe_active_player_id,
    safe_reserve_player_id,
    safe_next_recorder_id
  );
  if coalesce((result->>'fallback')::boolean, false)
     or not coalesce((result->>'ok')::boolean, false) then
    return result;
  end if;

  swapped := coalesce((result->>'swapped')::boolean, false);
  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if safe_action = 'substituteMatchPlayer' then
    event_active_out_id := safe_active_player_id;
    event_active_in_id := safe_reserve_player_id;
    event_reason := safe_reason;

    if assigned_referee_id is null and current_recorder_id = safe_reserve_player_id then
      current_recorders := case
        when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
        when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
        else '{}'::jsonb
      end;
      next_recorders := jsonb_set(
        current_recorders,
        array[safe_side],
        to_jsonb(safe_active_player_id),
        true
      );
      update public.matches
      set stat_recorders = next_recorders,
          rules = jsonb_set(
            coalesce(rules, '{}'::jsonb),
            '{statRecorders}',
            next_recorders,
            true
          ),
          updated_at = now_at
      where id = safe_match_id;
    end if;
  else
    handoff_history := case
      when jsonb_typeof(current_match.rules->'recorderHandoffs') = 'array'
        then current_match.rules->'recorderHandoffs'
      else '[]'::jsonb
    end;
    handoff_event := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'side', safe_side,
      'from', current_recorder_id,
      'to', safe_next_recorder_id,
      'createdAt', now_at
    );
    update public.matches
    set rules = jsonb_set(
          coalesce(rules, '{}'::jsonb) || jsonb_build_object('lastRosterTransitionAt', now_at),
          '{recorderHandoffs}',
          jsonb_build_array(handoff_event) || handoff_history,
          true
        ),
        updated_at = now_at
    where id = safe_match_id;

    if swapped then
      event_active_out_id := nullif(result->>'benchedId', '');
      event_active_in_id := nullif(result->>'activeInId', '');
      event_reason := 'recorder_handoff';
    end if;
  end if;

  if event_active_out_id is not null and event_active_in_id is not null then
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
      event_active_out_id,
      event_active_in_id,
      event_reason,
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
      and player_id = event_active_out_id
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
      event_active_in_id,
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
  end if;

  return result || jsonb_build_object(
    'actorProfileId', safe_actor_id,
    'eventId', event_id,
    'reason', event_reason,
    'clockActiveElapsedMs', clock_active_elapsed_ms,
    'minimumMeaningfulSeconds', minimum_seconds,
    'substitutionEventSaved', event_id is not null,
    'transitionAt', now_at
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
begin
  return public.rankball_match_roster_transition_action(
    p_actor_profile_id,
    'substituteMatchPlayer',
    p_match_id,
    p_side,
    p_active_player_id,
    p_reserve_player_id,
    null,
    p_reason
  );
end;
$$;

revoke all on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) to service_role;

revoke all on function public.rankball_match_substitution_action(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_substitution_action(
  text, text, text, text, text, text
) to service_role;

commit;

select pg_notify('pgrst', 'reload schema');
