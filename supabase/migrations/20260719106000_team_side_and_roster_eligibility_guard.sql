-- Keep team players on their assigned side and validate every selected roster member.

do $$
begin
  if to_regprocedure('public.rankball_match_room_action_unguarded(text,text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_room_action(text,text,text,jsonb)') is null then
      raise exception 'rankball_match_room_action_missing';
    end if;
    alter function public.rankball_match_room_action(text, text, text, jsonb)
      rename to rankball_match_room_action_unguarded;
  end if;
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
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_player_id text := nullif(btrim(p_payload->>'playerId'), '');
  current_match public.matches%rowtype;
  current_side text;
  target_side text;
  current_team_id text;
  reserve_a boolean := false;
  reserve_b boolean := false;
begin
  if p_action = 'setMatchRoomPlayerPlacement' and safe_match_id is not null and safe_player_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
    select * into current_match from public.matches where id = safe_match_id for update;
    if current_match.id is not null then
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
  end if;

  return public.rankball_match_room_action_unguarded(
    p_actor_profile_id,
    p_match_id,
    p_action,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_recruiting_management_action_unguarded(text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_management_action(text,jsonb)') is null then
      raise exception 'rankball_recruiting_management_action_missing';
    end if;
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_unguarded;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_management_action(
  p_actor_profile_id text,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  safe_post_id text := coalesce(
    nullif(btrim(p_operation->>'preferredPostId'), ''),
    nullif(btrim(p_operation->>'postId'), ''),
    nullif(btrim(p_operation #>> '{draft,id}'), '')
  );
  safe_entry_id text := nullif(btrim(p_operation->>'entryId'), '');
  current_post public.recruiting_posts%rowtype;
  application_row public.recruiting_applications%rowtype;
  target_team_id text;
  expected_side text;
  requested_side text;
  selected_active jsonb := '[]'::jsonb;
  selected_reserve jsonb := '[]'::jsonb;
  seen_ids jsonb := '[]'::jsonb;
  candidate_id text;
  target_mmr numeric := 1200;
  mmr_range_mode text;
  mmr_limit_mode text;
  allowed_age_groups jsonb := '[]'::jsonb;
begin
  if safe_action not in ('detachRecruitingPartyPlayer', 'setRecruitingTeamPartyRoster') then
    return public.rankball_recruiting_management_action_unguarded(p_actor_profile_id, p_operation);
  end if;
  if safe_post_id is null or safe_entry_id is null then
    return public.rankball_recruiting_management_action_unguarded(p_actor_profile_id, p_operation);
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
  select * into current_post from public.recruiting_posts where id = safe_post_id for update;
  if current_post.id is null then
    return public.rankball_recruiting_management_action_unguarded(p_actor_profile_id, p_operation);
  end if;

  if safe_entry_id = 'host' then
    target_team_id := current_post.team_id;
    expected_side := coalesce(
      current_post.room_state #>> array['partySides', safe_entry_id],
      current_post.host_side
    );
  elsif safe_entry_id like 'team:%' then
    target_team_id := nullif(btrim(substring(safe_entry_id from 6)), '');
    select * into application_row
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.team_id = target_team_id
      and application.kind = 'team'
    order by application.created_at
    limit 1
    for update;
    expected_side := coalesce(
      current_post.room_state #>> array['partySides', safe_entry_id],
      application_row.side
    );
  end if;

  if safe_action = 'detachRecruitingPartyPlayer' then
    requested_side := case
      when coalesce(p_operation #>> '{placement,side}', p_operation->>'sideName') in ('teamA', 'teamB')
        then coalesce(p_operation #>> '{placement,side}', p_operation->>'sideName')
      else expected_side
    end;
    if target_team_id is not null and expected_side in ('teamA', 'teamB') and requested_side is distinct from expected_side then
      raise exception 'recruiting_party_side_locked' using errcode = '23514';
    end if;
    return public.rankball_recruiting_management_action_unguarded(p_actor_profile_id, p_operation);
  end if;

  if target_team_id is null then
    raise exception 'recruiting_team_not_found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_operation #> '{roster,playerIds}', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_operation #> '{roster,reservePlayerIds}', '[]'::jsonb)) <> 'array' then
    raise exception 'invalid_recruiting_team_roster' using errcode = '22023';
  end if;
  selected_active := coalesce(p_operation #> '{roster,playerIds}', '[]'::jsonb);
  selected_reserve := coalesce(p_operation #> '{roster,reservePlayerIds}', '[]'::jsonb);
  if jsonb_array_length(selected_active) > greatest(1, least(5, coalesce(current_post.side_capacity, 5))) then
    raise exception 'recruiting_side_full' using errcode = '23514';
  end if;
  if jsonb_array_length(selected_reserve) > 2 then
    raise exception 'recruiting_reserve_full' using errcode = '23514';
  end if;

  if current_post.team_id is not null then
    select coalesce(team.mmr, 1200) into target_mmr
    from public.teams team
    where team.id = current_post.team_id and team.deleted_at is null;
    if target_mmr is null then
      raise exception 'recruiting_host_team_not_found' using errcode = 'P0002';
    end if;
  elsif current_post.player_id is not null then
    target_mmr := coalesce(public.rankball_event_profile_mmr(current_post.player_id), 1200);
  end if;
  mmr_range_mode := coalesce(
    nullif(current_post.room_state->>'mmrRangeMode', ''),
    nullif(current_post.rules->>'mmrRangeMode', ''),
    'narrow'
  );
  mmr_limit_mode := coalesce(
    nullif(current_post.room_state->>'mmrLimitMode', ''),
    nullif(current_post.rules->>'mmrLimitMode', ''),
    'block'
  );
  allowed_age_groups := case
    when jsonb_typeof(current_post.allowed_age_groups) = 'array' then current_post.allowed_age_groups
    else '[]'::jsonb
  end;
  if jsonb_array_length(allowed_age_groups) = 0
     and coalesce(nullif(lower(current_post.age_restriction), ''), 'any') <> 'any' then
    select coalesce(jsonb_agg(age_group), '[]'::jsonb) into allowed_age_groups
    from unnest(string_to_array(lower(current_post.age_restriction), '_')) age_group
    where age_group in ('junior', 'rising', 'open');
  end if;

  for candidate_id in
    select value from jsonb_array_elements_text(selected_active || selected_reserve) candidate(value)
  loop
    if nullif(btrim(candidate_id), '') is null then
      raise exception 'invalid_recruiting_team_roster' using errcode = '22023';
    end if;
    if seen_ids ? candidate_id then
      raise exception 'recruiting_party_roster_duplicate' using errcode = '23514';
    end if;
    seen_ids := seen_ids || to_jsonb(candidate_id);
    if not exists (
      select 1 from public.team_members member
      where member.team_id = target_team_id and member.user_id = candidate_id
    ) then
      raise exception 'recruiting_team_roster_not_member' using errcode = '42501';
    end if;
    if not public.rankball_event_profile_eligible(
      candidate_id,
      current_post.ranked,
      mmr_limit_mode,
      target_mmr,
      mmr_range_mode,
      allowed_age_groups
    ) then
      raise exception 'team_roster_player_ineligible' using errcode = '23514';
    end if;
  end loop;

  return public.rankball_recruiting_management_action_unguarded(p_actor_profile_id, p_operation);
end;
$$;

revoke all on function public.rankball_match_room_action_unguarded(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action_unguarded(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_room_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_management_action(text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_room_action(text, text, text, jsonb) to service_role;
grant execute on function public.rankball_recruiting_management_action(text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
