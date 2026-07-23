begin;

create or replace function public.rankball_match_swap_pickup_players(
  p_actor_profile_id text,
  p_match_id text,
  p_first_player_id text,
  p_second_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  first_player_id text := nullif(btrim(p_first_player_id), '');
  second_player_id text := nullif(btrim(p_second_player_id), '');
  current_match public.matches%rowtype;
  first_side text;
  second_side text;
  first_slot_order integer;
  second_slot_order integer;
  first_reserve boolean := false;
  second_reserve boolean := false;
  first_attended boolean := false;
  second_attended boolean := false;
  reserves jsonb;
  next_attendance jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null or first_player_id is null or second_player_id is null then
    raise exception 'pickup_swap_player_required' using errcode = '22023';
  end if;
  if first_player_id = second_player_id then
    raise exception 'pickup_swap_distinct_players_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
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

  reserves := case
    when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players
    else jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb)
  end;
  next_attendance := case
    when jsonb_typeof(current_match.attendance) = 'object' then current_match.attendance
    else jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb)
  end;

  select player.side, player.slot_order
  into first_side, first_slot_order
  from public.match_players player
  where player.match_id = safe_match_id and player.user_id = first_player_id
  limit 1;
  if first_side is null then
    first_side := case
      when coalesce(reserves->'teamA', '[]'::jsonb) ? first_player_id then 'teamA'
      when coalesce(reserves->'teamB', '[]'::jsonb) ? first_player_id then 'teamB'
      else null
    end;
    first_reserve := first_side is not null;
  end if;

  select player.side, player.slot_order
  into second_side, second_slot_order
  from public.match_players player
  where player.match_id = safe_match_id and player.user_id = second_player_id
  limit 1;
  if second_side is null then
    second_side := case
      when coalesce(reserves->'teamA', '[]'::jsonb) ? second_player_id then 'teamA'
      when coalesce(reserves->'teamB', '[]'::jsonb) ? second_player_id then 'teamB'
      else null
    end;
    second_reserve := second_side is not null;
  end if;

  if first_side is null or second_side is null then
    raise exception 'match_player_not_found' using errcode = 'P0002';
  end if;
  if first_side = second_side then
    raise exception 'pickup_swap_cross_side_required' using errcode = '23514';
  end if;

  first_attended := coalesce(next_attendance->first_side, '[]'::jsonb) ? first_player_id;
  second_attended := coalesce(next_attendance->second_side, '[]'::jsonb) ? second_player_id;
  if not first_attended or not second_attended then
    raise exception 'pickup_attendance_incomplete' using errcode = '23514';
  end if;

  if not first_reserve and not second_reserve then
    update public.match_players
    set side = case
          when user_id = first_player_id then second_side
          else first_side
        end,
        slot_order = case
          when user_id = first_player_id then second_slot_order
          else first_slot_order
        end,
        team_id = null
    where match_id = safe_match_id
      and user_id in (first_player_id, second_player_id);
  elsif not first_reserve and second_reserve then
    update public.match_players
    set user_id = second_player_id,
        team_id = null
    where match_id = safe_match_id and user_id = first_player_id;
  elsif first_reserve and not second_reserve then
    update public.match_players
    set user_id = first_player_id,
        team_id = null
    where match_id = safe_match_id and user_id = second_player_id;
  end if;

  select jsonb_build_object(
    'teamA',
    coalesce((
      select jsonb_agg(
        case
          when item.value = first_player_id then second_player_id
          when item.value = second_player_id then first_player_id
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements_text(
        case when jsonb_typeof(reserves->'teamA') = 'array' then reserves->'teamA' else '[]'::jsonb end
      ) with ordinality item(value, ordinality)
    ), '[]'::jsonb),
    'teamB',
    coalesce((
      select jsonb_agg(
        case
          when item.value = first_player_id then second_player_id
          when item.value = second_player_id then first_player_id
          else item.value
        end
        order by item.ordinality
      )
      from jsonb_array_elements_text(
        case when jsonb_typeof(reserves->'teamB') = 'array' then reserves->'teamB' else '[]'::jsonb end
      ) with ordinality item(value, ordinality)
    ), '[]'::jsonb)
  ) into reserves;

  next_attendance := jsonb_build_object(
    'teamA',
    coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements_text(
        case when jsonb_typeof(next_attendance->'teamA') = 'array' then next_attendance->'teamA' else '[]'::jsonb end
      ) with ordinality item(value, ordinality)
      where item.value not in (first_player_id, second_player_id)
    ), '[]'::jsonb)
      || case when second_side = 'teamA' then jsonb_build_array(first_player_id) else '[]'::jsonb end
      || case when first_side = 'teamA' then jsonb_build_array(second_player_id) else '[]'::jsonb end,
    'teamB',
    coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements_text(
        case when jsonb_typeof(next_attendance->'teamB') = 'array' then next_attendance->'teamB' else '[]'::jsonb end
      ) with ordinality item(value, ordinality)
      where item.value not in (first_player_id, second_player_id)
    ), '[]'::jsonb)
      || case when second_side = 'teamB' then jsonb_build_array(first_player_id) else '[]'::jsonb end
      || case when first_side = 'teamB' then jsonb_build_array(second_player_id) else '[]'::jsonb end
  );

  update public.match_players
  set team_id = null
  where match_id = safe_match_id;

  update public.match_agreements
  set side = case
    when user_id = first_player_id then second_side
    when user_id = second_player_id then first_side
    else side
  end
  where match_id = safe_match_id
    and user_id in (first_player_id, second_player_id);

  update public.match_approvals
  set side = case
    when user_id = first_player_id then second_side
    when user_id = second_player_id then first_side
    else side
  end
  where match_id = safe_match_id
    and user_id in (first_player_id, second_player_id);

  update public.matches
  set team_a_id = null,
      team_b_id = null,
      reserve_players = reserves,
      attendance = next_attendance,
      rules = (coalesce(rules, '{}'::jsonb) - 'sideAssignmentConfirmedAt' - 'sideAssignmentConfirmedBy')
        || jsonb_build_object('sideAssignmentStatus', 'pending'),
      agreed_at = null,
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'firstPlayerId', first_player_id,
    'secondPlayerId', second_player_id,
    'sideAssignmentStatus', 'pending'
  );
end;
$$;

revoke all on function public.rankball_match_swap_pickup_players(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_swap_pickup_players(text, text, text, text) to service_role;

commit;
