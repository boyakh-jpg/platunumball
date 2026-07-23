begin;

create or replace function public.rankball_match_confirm_pickup_assignment(
  p_actor_profile_id text,
  p_match_id text,
  p_rotation_mode text default 'manual',
  p_rotation_interval_minutes integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_rotation_mode text := case when p_rotation_mode in ('period', 'interval', 'manual') then p_rotation_mode else 'manual' end;
  safe_rotation_minutes integer := case when p_rotation_interval_minutes in (3, 5, 7, 10) then p_rotation_interval_minutes else 5 end;
  current_match public.matches%rowtype;
  side_capacity integer;
  active_a integer;
  active_b integer;
  missing_attendance boolean;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
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
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'pickup_side_assignment_locked' using errcode = '23514';
  end if;
  if coalesce(current_match.rules->>'formationMode', '') <> 'pickup'
     and coalesce(current_match.rules->>'matchIntent', '') <> 'pickup' then
    raise exception 'pickup_room_required' using errcode = '23514';
  end if;

  side_capacity := greatest(1, least(5, coalesce(
    (current_match.rules->>'sideCapacity')::integer,
    substring(current_match.mode from '^[0-9]+')::integer,
    5
  )));
  select
    count(*) filter (where player.side = 'teamA'),
    count(*) filter (where player.side = 'teamB')
  into active_a, active_b
  from public.match_players player
  where player.match_id = safe_match_id and player.side in ('teamA', 'teamB');
  if active_a <> side_capacity or active_b <> side_capacity then
    raise exception 'pickup_side_assignment_incomplete' using errcode = '23514';
  end if;

  select exists (
    select 1
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and not (coalesce(current_match.attendance -> player.side, '[]'::jsonb) ? player.user_id)
    union all
    select 1
    from jsonb_each(coalesce(current_match.reserve_players, '{}'::jsonb)) reserve_side(side_name, player_ids)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(reserve_side.player_ids) = 'array' then reserve_side.player_ids else '[]'::jsonb end
    ) reserve_player(player_id)
    where reserve_side.side_name in ('teamA', 'teamB')
      and not (coalesce(current_match.attendance -> reserve_side.side_name, '[]'::jsonb) ? reserve_player.player_id)
  ) into missing_attendance;
  if missing_attendance then
    raise exception 'pickup_attendance_incomplete' using errcode = '23514';
  end if;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'sideAssignmentStatus', 'confirmed',
        'sideAssignmentConfirmedAt', now_at,
        'sideAssignmentConfirmedBy', safe_actor_id,
        'rotationMode', safe_rotation_mode,
        'rotationIntervalMinutes', case when safe_rotation_mode = 'interval' then safe_rotation_minutes else null end
      ),
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'sideAssignmentStatus', 'confirmed',
    'rotationMode', safe_rotation_mode,
    'rotationIntervalMinutes', case when safe_rotation_mode = 'interval' then safe_rotation_minutes else null end
  );
end;
$$;

revoke all on function public.rankball_match_confirm_pickup_assignment(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.rankball_match_confirm_pickup_assignment(text, text, text, integer) to service_role;

commit;
