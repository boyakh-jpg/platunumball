create or replace function public.rankball_recruiting_side_party_join_action(
  p_actor_profile_id text,
  p_post_id text,
  p_team_id text,
  p_side text,
  p_entry_id text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
  application_row public.recruiting_applications%rowtype;
  safe_actor_id text := nullif(btrim(coalesce(p_actor_profile_id, '')), '');
  safe_post_id text := nullif(btrim(coalesce(p_post_id, '')), '');
  safe_team_id text := nullif(btrim(coalesce(p_team_id, '')), '');
  safe_side text := case when p_side = 'teamA' then 'teamA' when p_side = 'teamB' then 'teamB' else null end;
  safe_entry_id text := nullif(btrim(coalesce(p_entry_id, '')), '');
  target_player_ids jsonb := '[]'::jsonb;
  next_room_state jsonb := '{}'::jsonb;
  next_party_reserves jsonb := '{}'::jsonb;
  next_target_reserves jsonb := '[]'::jsonb;
  side_active_count integer := 0;
  side_reserve_count integer := 0;
  joined_as text := 'active';
begin
  if safe_actor_id is null or safe_post_id is null or safe_team_id is null or safe_side is null then
    raise exception 'recruiting_side_party_join_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  select * into post_row
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if post_row.id is null then
    raise exception 'recruiting_post_not_found' using errcode = 'P0002';
  end if;
  if post_row.status <> 'open' or post_row.confirmed_at is not null then
    raise exception 'recruiting_room_not_mutable' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.team_members
    where team_id = safe_team_id and user_id = safe_actor_id
  ) then
    raise exception 'recruiting_team_membership_required' using errcode = '42501';
  end if;

  next_room_state := coalesce(post_row.room_state, '{}'::jsonb);
  next_party_reserves := case
    when jsonb_typeof(next_room_state->'partyReserves') = 'object' then next_room_state->'partyReserves'
    else '{}'::jsonb
  end;

  if safe_entry_id = 'host' then
    if post_row.team_id is distinct from safe_team_id or post_row.host_side is distinct from safe_side then
      raise exception 'recruiting_party_target_not_found' using errcode = 'P0002';
    end if;
    target_player_ids := coalesce(post_row.player_ids, '[]'::jsonb);
  elsif safe_entry_id = 'team:' || safe_team_id then
    select * into application_row
    from public.recruiting_applications
    where post_id = safe_post_id
      and team_id = safe_team_id
      and kind = 'team'
      and side = safe_side
    order by created_at
    limit 1
    for update;
    if application_row.post_id is null then
      raise exception 'recruiting_party_target_not_found' using errcode = 'P0002';
    end if;
    target_player_ids := coalesce(application_row.player_ids, '[]'::jsonb);
  else
    raise exception 'recruiting_party_target_not_found' using errcode = 'P0002';
  end if;

  next_target_reserves := case
    when jsonb_typeof(next_party_reserves->safe_entry_id) = 'array' then next_party_reserves->safe_entry_id
    else '[]'::jsonb
  end;
  if target_player_ids ? safe_actor_id or next_target_reserves ? safe_actor_id then
    return jsonb_build_object(
      'ok', true,
      'action', 'joinRecruitingSideParty',
      'postId', safe_post_id,
      'entryId', safe_entry_id,
      'placement', case when next_target_reserves ? safe_actor_id then 'reserve' else 'active' end,
      'alreadyJoined', true,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  if (
    post_row.host_side <> safe_side
    and (coalesce(post_row.player_ids, '[]'::jsonb) ? safe_actor_id or coalesce(next_party_reserves->'host', '[]'::jsonb) ? safe_actor_id)
  ) or exists (
    select 1
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.side <> safe_side
      and (
        application.player_id = safe_actor_id
        or coalesce(application.player_ids, '[]'::jsonb) ? safe_actor_id
        or coalesce(next_party_reserves->('team:' || application.team_id), '[]'::jsonb) ? safe_actor_id
      )
  ) then
    raise exception 'recruiting_team_side_conflict' using errcode = '23514';
  end if;

  delete from public.recruiting_applications
  where post_id = safe_post_id
    and kind = 'player'
    and player_id = safe_actor_id
    and side = safe_side;

  side_active_count := case
    when post_row.host_side = safe_side then jsonb_array_length(coalesce(post_row.player_ids, '[]'::jsonb))
    else 0
  end;
  select side_active_count + coalesce(sum(
    case
      when application.kind = 'team' then jsonb_array_length(coalesce(application.player_ids, '[]'::jsonb))
      when application.reserve then 0
      else 1
    end
  ), 0)
  into side_active_count
  from public.recruiting_applications application
  where application.post_id = safe_post_id and application.side = safe_side;

  side_reserve_count := jsonb_array_length(next_target_reserves);
  select side_reserve_count + coalesce(sum(
    case
      when application.kind = 'team' and 'team:' || application.team_id <> safe_entry_id
        then jsonb_array_length(coalesce(next_party_reserves->('team:' || application.team_id), '[]'::jsonb))
      when application.kind = 'player' and application.reserve then 1
      else 0
    end
  ), 0)
  into side_reserve_count
  from public.recruiting_applications application
  where application.post_id = safe_post_id and application.side = safe_side;

  if side_active_count < post_row.side_capacity then
    target_player_ids := target_player_ids || to_jsonb(safe_actor_id);
    next_target_reserves := next_target_reserves - safe_actor_id;
  else
    if side_reserve_count >= 2 then
      raise exception 'recruiting_reserve_limit' using errcode = '23514';
    end if;
    joined_as := 'reserve';
    next_target_reserves := next_target_reserves || to_jsonb(safe_actor_id);
  end if;

  if jsonb_array_length(next_target_reserves) > 0 then
    next_party_reserves := jsonb_set(next_party_reserves, array[safe_entry_id], next_target_reserves, true);
  else
    next_party_reserves := next_party_reserves - safe_entry_id;
  end if;
  next_room_state := jsonb_set(next_room_state, '{partyReserves}', next_party_reserves, true);

  if safe_entry_id = 'host' then
    update public.recruiting_posts
    set player_ids = target_player_ids,
        room_state = next_room_state,
        updated_at = now()
    where id = safe_post_id;
  else
    update public.recruiting_applications
    set player_ids = target_player_ids,
        status = 'ready',
        updated_at = now()
    where post_id = application_row.post_id
      and player_id = application_row.player_id
      and kind = application_row.kind;
    update public.recruiting_posts
    set room_state = next_room_state,
        updated_at = now()
    where id = safe_post_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'joinRecruitingSideParty',
    'postId', safe_post_id,
    'entryId', safe_entry_id,
    'placement', joined_as,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_side_party_join_action(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_side_party_join_action(text, text, text, text, text) to service_role;
