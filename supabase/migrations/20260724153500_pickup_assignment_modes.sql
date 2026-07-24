begin;

create or replace function public.rankball_match_generate_pickup_assignment(
  p_actor_profile_id text,
  p_match_id text,
  p_assignment_mode text default ''
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
  assignment_mode text;
  side_capacity integer;
  bench_capacity integer;
  side_total_capacity integer;
  assignment_revision integer;
  participant_ids text[];
  attendance_ids text[];
  ordered_ids text[];
  active_a text[] := array[]::text[];
  active_b text[] := array[]::text[];
  reserve_a text[] := array[]::text[];
  reserve_b text[] := array[]::text[];
  count_a integer := 0;
  count_b integer := 0;
  mmr_a numeric := 0;
  mmr_b numeric := 0;
  player_id text;
  player_mmr numeric;
  target_side text;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then raise exception 'match_id_required' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select match.* into current_match
  from public.matches match
  where match.id = safe_match_id
  for update;

  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
     and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
    raise exception 'match_room_operator_required' using errcode = '42501';
  end if;
  if current_match.status not in ('contract', 'agreed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id)
     or coalesce(current_match.rules->>'sideAssignmentStatus', 'pending') = 'confirmed' then
    raise exception 'pickup_side_assignment_locked' using errcode = '23514';
  end if;
  if coalesce(current_match.rules->>'formationMode', '') <> 'pickup'
     and coalesce(current_match.rules->>'matchIntent', '') <> 'pickup' then
    raise exception 'pickup_room_required' using errcode = '23514';
  end if;

  assignment_mode := coalesce(
    nullif(btrim(p_assignment_mode), ''),
    nullif(current_match.rules->>'pickupTeamAssignmentMode', ''),
    'manual'
  );
  if assignment_mode not in ('random', 'mmr_balanced') then
    raise exception 'pickup_automatic_assignment_mode_required' using errcode = '23514';
  end if;

  side_capacity := case
    when coalesce(current_match.rules->>'sideCapacity', '') ~ '^[0-9]+$'
      then (current_match.rules->>'sideCapacity')::integer
    when coalesce(current_match.mode, '') ~ '^[0-9]+v[0-9]+$'
      then substring(current_match.mode from '^[0-9]+')::integer
    else 5
  end;
  bench_capacity := case
    when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-3]$'
      then (current_match.rules->>'benchCapacity')::integer
    else 0
  end;
  if side_capacity not in (1, 2, 3, 5) then
    raise exception 'unsupported_match_mode' using errcode = '23514';
  end if;
  side_total_capacity := side_capacity + bench_capacity;
  assignment_revision := case
    when coalesce(current_match.rules->>'sideAssignmentRevision', '') ~ '^[0-9]+$'
      then (current_match.rules->>'sideAssignmentRevision')::integer + 1
    else 1
  end;

  with participant(profile_id) as (
    select player.user_id
    from public.match_players player
    where player.match_id = safe_match_id and player.side in ('teamA', 'teamB')
    union
    select reserve.value
    from jsonb_each(
      case when jsonb_typeof(current_match.reserve_players) = 'object'
        then current_match.reserve_players else '{}'::jsonb end
    ) reserve_side(side_name, player_ids)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(reserve_side.player_ids) = 'array'
        then reserve_side.player_ids else '[]'::jsonb end
    ) reserve(value)
    where reserve_side.side_name in ('teamA', 'teamB')
  )
  select coalesce(array_agg(distinct profile_id order by profile_id), array[]::text[])
  into participant_ids
  from participant
  where nullif(btrim(profile_id), '') is not null;

  if cardinality(participant_ids) < side_capacity * 2 then
    raise exception 'pickup_side_assignment_incomplete' using errcode = '23514';
  end if;
  if cardinality(participant_ids) > side_total_capacity * 2 then
    raise exception 'pickup_participant_capacity_exceeded' using errcode = '23514';
  end if;

  with attended(profile_id) as (
    select attendee.value
    from jsonb_each(
      case when jsonb_typeof(current_match.attendance) = 'object'
        then current_match.attendance else '{}'::jsonb end
    ) attendance_side(side_name, player_ids)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(attendance_side.player_ids) = 'array'
        then attendance_side.player_ids else '[]'::jsonb end
    ) attendee(value)
    where attendance_side.side_name in ('teamA', 'teamB')
  )
  select coalesce(array_agg(distinct profile_id order by profile_id), array[]::text[])
  into attendance_ids
  from attended;

  if exists (
    select 1 from unnest(participant_ids) participant(profile_id)
    where not participant.profile_id = any(attendance_ids)
  ) then
    raise exception 'pickup_attendance_incomplete' using errcode = '23514';
  end if;

  if assignment_mode = 'random' then
    select array_agg(profile_id order by md5(safe_match_id || ':' || assignment_revision::text || ':' || profile_id))
    into ordered_ids
    from unnest(participant_ids) participant(profile_id);
  else
    select array_agg(
      profile_id
      order by coalesce(public.rankball_event_profile_mmr(profile_id), 1200) desc,
        md5(safe_match_id || ':' || assignment_revision::text || ':' || profile_id)
    )
    into ordered_ids
    from unnest(participant_ids) participant(profile_id);
  end if;

  foreach player_id in array ordered_ids loop
    player_mmr := coalesce(public.rankball_event_profile_mmr(player_id), 1200);
    if count_a >= side_total_capacity then
      target_side := 'teamB';
    elsif count_b >= side_total_capacity then
      target_side := 'teamA';
    elsif assignment_mode = 'random' then
      target_side := case when count_a <= count_b then 'teamA' else 'teamB' end;
    else
      target_side := case
        when count_a = count_b and mmr_a = mmr_b
          then case when count_a <= count_b then 'teamA' else 'teamB' end
        when mmr_a <= mmr_b then 'teamA'
        else 'teamB'
      end;
    end if;

    if target_side = 'teamA' then
      if count_a < side_capacity then active_a := array_append(active_a, player_id);
      else reserve_a := array_append(reserve_a, player_id);
      end if;
      count_a := count_a + 1;
      mmr_a := mmr_a + player_mmr;
    else
      if count_b < side_capacity then active_b := array_append(active_b, player_id);
      else reserve_b := array_append(reserve_b, player_id);
      end if;
      count_b := count_b + 1;
      mmr_b := mmr_b + player_mmr;
    end if;
  end loop;

  if cardinality(active_a) <> side_capacity or cardinality(active_b) <> side_capacity then
    raise exception 'pickup_side_assignment_incomplete' using errcode = '23514';
  end if;

  update public.match_players player
  set side = case when player.user_id = any(active_a) then 'teamA' else 'teamB' end,
      slot_order = case
        when player.user_id = any(active_a) then array_position(active_a, player.user_id)
        else array_position(active_b, player.user_id)
      end,
      team_id = null
  where player.match_id = safe_match_id
    and player.user_id = any(active_a || active_b);

  delete from public.match_players player
  where player.match_id = safe_match_id
    and not player.user_id = any(active_a || active_b);

  insert into public.match_players (match_id, team_id, user_id, side, slot_order)
  select safe_match_id, null, player.profile_id, 'teamA', player.slot_order::integer
  from unnest(active_a) with ordinality player(profile_id, slot_order)
  where not exists (
    select 1 from public.match_players existing
    where existing.match_id = safe_match_id and existing.user_id = player.profile_id
  )
  union all
  select safe_match_id, null, player.profile_id, 'teamB', player.slot_order::integer
  from unnest(active_b) with ordinality player(profile_id, slot_order)
  where not exists (
    select 1 from public.match_players existing
    where existing.match_id = safe_match_id and existing.user_id = player.profile_id
  );

  update public.match_agreements agreement
  set side = case when agreement.user_id = any(active_a || reserve_a) then 'teamA' else 'teamB' end
  where agreement.match_id = safe_match_id
    and agreement.user_id = any(participant_ids);

  update public.match_approvals approval
  set side = case when approval.user_id = any(active_a || reserve_a) then 'teamA' else 'teamB' end
  where approval.match_id = safe_match_id
    and approval.user_id = any(participant_ids);

  update public.matches
  set team_a_id = null,
      team_b_id = null,
      reserve_players = jsonb_build_object(
        'teamA', to_jsonb(reserve_a),
        'teamB', to_jsonb(reserve_b)
      ),
      attendance = jsonb_build_object(
        'teamA', to_jsonb(active_a || reserve_a),
        'teamB', to_jsonb(active_b || reserve_b)
      ),
      rules = (coalesce(rules, '{}'::jsonb) - 'sideAssignmentConfirmedAt' - 'sideAssignmentConfirmedBy')
        || jsonb_build_object(
          'pickupTeamAssignmentMode', assignment_mode,
          'sideAssignmentStatus', 'draft',
          'sideAssignmentGeneratedAt', now_at,
          'sideAssignmentGeneratedBy', safe_actor_id,
          'sideAssignmentRevision', assignment_revision
        ),
      agreed_at = null,
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'assignmentMode', assignment_mode,
    'sideAssignmentStatus', 'draft',
    'sideAssignmentRevision', assignment_revision,
    'teamAPlayerIds', to_jsonb(active_a),
    'teamBPlayerIds', to_jsonb(active_b),
    'teamAReserveIds', to_jsonb(reserve_a),
    'teamBReserveIds', to_jsonb(reserve_b),
    'teamAMmr', mmr_a,
    'teamBMmr', mmr_b
  );
end;
$$;

revoke all on function public.rankball_match_generate_pickup_assignment(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_generate_pickup_assignment(text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
