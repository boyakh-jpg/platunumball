-- Enforce match mutation discipline, explicit room operators, and active-player stat targets.

create or replace function public.rankball_assert_match_actor_active(
  p_actor_profile_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  now_at timestamptz := now();
begin
  if safe_actor_id is null or not exists (
    select 1 from public.profiles profile where profile.id = safe_actor_id
  ) then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.admin_disciplinary_actions action
    where action.user_id = safe_actor_id
      and action.status = 'active'
      and coalesce(action.starts_at, now_at) <= now_at
      and (action.ends_at is null or action.ends_at > now_at)
  ) then
    raise exception 'profile_discipline_blocked' using errcode = '42501';
  end if;

  return true;
end;
$$;

create or replace function public.rankball_match_room_action(
  p_actor_profile_id text,
  p_match_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_player_id text := nullif(btrim(p_payload->>'playerId'), '');
  current_match public.matches%rowtype;
  current_side text;
  target_side text;
  current_team_id text;
  reserve_a boolean := false;
  reserve_b boolean := false;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);

  if p_action in ('updateMatchRoomRules', 'setMatchRoomPlayerPlacement', 'removeMatchRoomPlayer')
     and safe_match_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
    select * into current_match from public.matches where id = safe_match_id for update;
    if current_match.id is not null
       and safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
       and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
      raise exception 'match_room_operator_required' using errcode = '42501';
    end if;
  end if;

  if p_action = 'setMatchRoomPlayerPlacement'
     and current_match.id is not null
     and safe_player_id is not null then
    select player.side into current_side
    from public.match_players player
    where player.match_id = safe_match_id and player.user_id = safe_player_id
    order by player.slot_order
    limit 1;

    if current_side is null then
      reserve_a := coalesce(current_match.reserve_players->'teamA', '[]'::jsonb) ? safe_player_id;
      reserve_b := coalesce(current_match.reserve_players->'teamB', '[]'::jsonb) ? safe_player_id;
      if reserve_a and reserve_b then
        raise exception 'match_roster_cross_side_duplicate' using errcode = '23514';
      end if;
      current_side := case when reserve_a then 'teamA' when reserve_b then 'teamB' else null end;
    end if;

    current_team_id := case
      when current_side = 'teamA' then current_match.team_a_id
      when current_side = 'teamB' then current_match.team_b_id
      else null
    end;
    target_side := case
      when p_payload #>> '{placement,side}' in ('teamA', 'teamB') then p_payload #>> '{placement,side}'
      else current_side
    end;
    if current_team_id is not null and target_side is distinct from current_side then
      raise exception 'match_team_side_locked' using errcode = '23514';
    end if;
  end if;

  return public.rankball_match_room_action_unguarded(
    safe_actor_id,
    safe_match_id,
    p_action,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_match_result_action_roster_unguarded(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_result_action(text,text,jsonb)') is null then
      raise exception 'rankball_match_result_action_missing';
    end if;
    alter function public.rankball_match_result_action(text, text, jsonb)
      rename to rankball_match_result_action_roster_unguarded;
  end if;
end;
$$;

create or replace function public.rankball_match_result_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result jsonb
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
  reducer_result jsonb;
  result_score_a integer := 0;
  result_score_b integer := 0;
  invalid_target boolean := false;
  ambiguous_roster boolean := false;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match_result_actor_or_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  with actual_players as (
    select player.side, player.user_id
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and not (
        case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end
      ) ? player.user_id
    union
    select 'teamA', played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    union
    select 'teamB', played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
  )
  select exists (
    select 1 from actual_players group by user_id having count(distinct side) > 1
  ) into ambiguous_roster;

  if ambiguous_roster then
    raise exception 'match_actual_roster_ambiguous' using errcode = '23514';
  end if;

  with actual_players as (
    select player.user_id
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and not (
        case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end
      ) ? player.user_id
    union
    select played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    union
    select played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
  )
  select exists (
    select 1
    from jsonb_object_keys(coalesce(p_result->'playerStats', '{}'::jsonb)) target(player_id)
    where not exists (select 1 from actual_players player where player.user_id = target.player_id)
  ) into invalid_target;

  if invalid_target then
    raise exception 'stat_player_not_in_match' using errcode = '23514';
  end if;

  reducer_result := public.rankball_match_result_action_roster_unguarded(
    safe_actor_id,
    safe_match_id,
    coalesce(p_result, '{}'::jsonb)
  );

  if current_match.status = 'disputed' then
    with actual_players as (
      select player.side, player.user_id
      from public.match_players player
      where player.match_id = safe_match_id
        and player.side in ('teamA', 'teamB')
        and not (
          case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
            then current_match.reserve_players -> (player.side) else '[]'::jsonb end
        ) ? player.user_id
      union
      select 'teamA', played.value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      union
      select 'teamB', played.value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
    ), draft as (
      select coalesce(dispute_draft_result->'playerStats', '{}'::jsonb) as stats
      from public.matches where id = safe_match_id
    )
    select
      coalesce(sum(coalesce((draft.stats -> (player.user_id) ->> 'points')::integer, 0)) filter (where player.side = 'teamA'), 0)::integer,
      coalesce(sum(coalesce((draft.stats -> (player.user_id) ->> 'points')::integer, 0)) filter (where player.side = 'teamB'), 0)::integer
    into result_score_a, result_score_b
    from actual_players player cross join draft;

    update public.matches
    set dispute_draft_result = coalesce(dispute_draft_result, '{}'::jsonb)
          || jsonb_build_object('scoreA', result_score_a, 'scoreB', result_score_b),
        updated_at = now()
    where id = safe_match_id;
  else
    with actual_players as (
      select player.side, player.user_id
      from public.match_players player
      where player.match_id = safe_match_id
        and player.side in ('teamA', 'teamB')
        and not (
          case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
            then current_match.reserve_players -> (player.side) else '[]'::jsonb end
        ) ? player.user_id
      union
      select 'teamA', played.value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      union
      select 'teamB', played.value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
    )
    select
      coalesce(sum(coalesce(stat.points, 0)) filter (where player.side = 'teamA'), 0)::integer,
      coalesce(sum(coalesce(stat.points, 0)) filter (where player.side = 'teamB'), 0)::integer
    into result_score_a, result_score_b
    from actual_players player
    left join public.player_match_stats stat
      on stat.match_id = safe_match_id and stat.user_id = player.user_id;

    update public.match_results
    set score_a = result_score_a, score_b = result_score_b
    where match_id = safe_match_id;
    update public.matches
    set score_a = result_score_a, score_b = result_score_b, updated_at = now()
    where id = safe_match_id;
  end if;

  return reducer_result || jsonb_build_object(
    'scoreA', result_score_a,
    'scoreB', result_score_b,
    'activeRosterGuarded', true
  );
end;
$$;

revoke all on function public.rankball_assert_match_actor_active(text) from public, anon, authenticated;
revoke all on function public.rankball_match_room_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_result_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_result_action_roster_unguarded(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_assert_match_actor_active(text) to service_role;
grant execute on function public.rankball_match_room_action(text, text, text, jsonb) to service_role;
grant execute on function public.rankball_match_result_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_result_action_roster_unguarded(text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
