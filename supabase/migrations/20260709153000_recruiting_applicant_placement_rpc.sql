-- Ensures the applicant placement SQL reducer exists in migration history.
-- No data is deleted by this migration.

create or replace function public.rankball_recruiting_applicant_placement_action(
  p_actor_profile_id text,
  p_post_id text,
  p_player_id text,
  p_side text default null,
  p_reserve boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_player_id text := coalesce(nullif(btrim(p_player_id), ''), safe_actor_id);
  safe_side text := nullif(btrim(p_side), '');
  safe_reserve boolean := coalesce(p_reserve, false);
  current_post public.recruiting_posts%rowtype;
  current_room_state jsonb;
  current_application public.recruiting_applications%rowtype;
  side_capacity integer;
  active_count integer := 0;
  reserve_count integer := 0;
  next_pinned_reserve_players jsonb;
  next_stat_recorders jsonb;
  side_pinned_ids jsonb;
  next_room_state jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;
  if safe_player_id is null or safe_player_id <> safe_actor_id then
    raise exception 'recruiting_applicant_placement_permission_denied' using errcode = '42501';
  end if;

  select *
  into current_post
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = '22023';
  end if;
  if current_post.status = 'closed' then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'recruiting_room_closed', 'postId', safe_post_id);
  end if;

  current_room_state := coalesce(current_post.room_state, '{}'::jsonb);

  select *
  into current_application
  from public.recruiting_applications
  where post_id = safe_post_id
    and player_id = safe_player_id
    and kind = 'player'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'unsupported_host_or_team_placement', 'postId', safe_post_id);
  end if;

  if current_application.player_id <> safe_actor_id and not (coalesce(current_application.player_ids, '[]'::jsonb) ? safe_actor_id) then
    raise exception 'recruiting_applicant_placement_permission_denied' using errcode = '42501';
  end if;

  if safe_side is null or safe_side not in ('teamA', 'teamB') then
    safe_side := current_application.side;
  end if;

  if (
    (current_post.host_join_mode = 'team' or current_post.team_id is not null)
    and (coalesce(current_post.visibility, 'public') = 'private' or current_room_state->>'teamOnly' = 'true')
    and safe_side <> current_application.side
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'team_side_locked', 'postId', safe_post_id);
  end if;

  side_capacity := greatest(1, least(5, coalesce(current_post.side_capacity, 5)));

  if not safe_reserve then
    select coalesce(sum(player_count), 0)::integer
    into active_count
    from (
      select case
        when current_post.host_side = safe_side and current_post.host_join_mode = 'player' and current_post.player_id is not null then 1
        when current_post.host_side = safe_side and current_post.host_join_mode <> 'player' then jsonb_array_length(case when jsonb_typeof(coalesce(current_post.player_ids, '[]'::jsonb)) = 'array' then coalesce(current_post.player_ids, '[]'::jsonb) else '[]'::jsonb end)
        else 0
      end as player_count

      union all

      select case
        when application.kind = 'team' then greatest(1, jsonb_array_length(case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end))
        else 1
      end as player_count
      from public.recruiting_applications application
      where application.post_id = safe_post_id
        and application.player_id <> safe_player_id
        and application.side = safe_side
        and application.reserve = false
    ) active_rows;

    if active_count + 1 > side_capacity then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'side_capacity_requires_replay', 'postId', safe_post_id);
    end if;
  end if;

  select coalesce(jsonb_object_agg(key, filtered_ids), '{}'::jsonb)
  into next_pinned_reserve_players
  from (
    select
      key,
      coalesce(jsonb_agg(to_jsonb(value)) filter (where value is not null and value <> safe_player_id), '[]'::jsonb) as filtered_ids
    from jsonb_each(
      case when jsonb_typeof(current_room_state->'pinnedReservePlayers') = 'object'
        then current_room_state->'pinnedReservePlayers'
        else '{}'::jsonb
      end
    ) entry(key, raw_ids)
    left join lateral jsonb_array_elements_text(
      case when jsonb_typeof(raw_ids) = 'array' then raw_ids else '[]'::jsonb end
    ) ids(value) on true
    group by key
  ) cleaned
  where jsonb_array_length(filtered_ids) > 0;

  select coalesce(jsonb_object_agg(key, to_jsonb(value)), '{}'::jsonb)
  into next_stat_recorders
  from jsonb_each_text(
    case when jsonb_typeof(current_room_state->'statRecorders') = 'object'
      then current_room_state->'statRecorders'
      else '{}'::jsonb
    end
  ) entry(key, value)
  where value <> safe_player_id;

  if safe_reserve then
    select count(*)::integer
    into reserve_count
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.player_id <> safe_player_id
      and application.side = safe_side
      and application.reserve = true;

    side_pinned_ids := case
      when jsonb_typeof(next_pinned_reserve_players->safe_side) = 'array' then next_pinned_reserve_players->safe_side
      else '[]'::jsonb
    end;

    if greatest(reserve_count, jsonb_array_length(side_pinned_ids)) >= 2 and not (side_pinned_ids ? safe_player_id) then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'reserve_limit_requires_replay', 'postId', safe_post_id);
    end if;

    select coalesce(jsonb_agg(to_jsonb(value)), '[]'::jsonb)
    into side_pinned_ids
    from (
      select distinct value
      from (
        select value from jsonb_array_elements_text(side_pinned_ids) ids(value)
        union all
        select safe_player_id
      ) values_to_pin
      where value is not null
    ) distinct_values;

    next_pinned_reserve_players := jsonb_set(next_pinned_reserve_players, array[safe_side], side_pinned_ids, true);
  end if;

  next_room_state := current_room_state;
  next_room_state := jsonb_set(next_room_state, '{pinnedReservePlayers}', coalesce(next_pinned_reserve_players, '{}'::jsonb), true);
  next_room_state := jsonb_set(next_room_state, '{statRecorders}', coalesce(next_stat_recorders, '{}'::jsonb), true);

  update public.recruiting_applications
  set
    side = safe_side,
    reserve = safe_reserve,
    status = 'waiting',
    updated_at = now()
  where post_id = safe_post_id
    and player_id = safe_player_id
    and kind = 'player';

  update public.recruiting_posts
  set
    room_state = next_room_state,
    updated_at = now()
  where id = safe_post_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setRecruitingApplicantPlacement',
    'postId', safe_post_id,
    'playerId', safe_player_id,
    'side', safe_side,
    'reserve', safe_reserve,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_applicant_placement_action(text, text, text, text, boolean) from public;
grant execute on function public.rankball_recruiting_applicant_placement_action(text, text, text, text, boolean) to service_role;
