do $$
begin
  if to_regprocedure('public.rankball_recruiting_room_update_action_pre_edit_once(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_room_update_action(text,text,jsonb)') is null then
      raise exception 'rankball_recruiting_room_update_action_missing';
    end if;
    alter function public.rankball_recruiting_room_update_action(text, text, jsonb)
      rename to rankball_recruiting_room_update_action_pre_edit_once;
  end if;

  if to_regprocedure('public.rankball_match_room_update_action_pre_edit_once(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_room_update_action(text,text,jsonb)') is null then
      raise exception 'rankball_match_room_update_action_missing';
    end if;
    alter function public.rankball_match_room_update_action(text, text, jsonb)
      rename to rankball_match_room_update_action_pre_edit_once;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_room_update_action(
  p_actor_profile_id text,
  p_post_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  current_post public.recruiting_posts%rowtype;
  result jsonb;
  edited_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
    raise exception 'room_update_no_changes' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;

  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;
  if current_post.player_id is distinct from safe_actor_id then
    raise exception 'recruiting_owner_required' using errcode = '42501';
  end if;
  if (
    case
      when coalesce(current_post.room_state->>'roomEditCount', '') ~ '^[0-9]+$'
        then (current_post.room_state->>'roomEditCount')::integer
      else 0
    end
  ) >= 1 then
    raise exception 'room_edit_limit_reached' using errcode = '23514';
  end if;

  result := public.rankball_recruiting_room_update_action_pre_edit_once(
    safe_actor_id,
    safe_post_id,
    patch
  );

  update public.recruiting_posts
  set room_state = coalesce(room_state, '{}'::jsonb) || jsonb_build_object(
        'roomEditCount', 1,
        'roomEditedAt', edited_at,
        'roomEditedBy', safe_actor_id
      ),
      updated_at = edited_at
  where id = safe_post_id;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'roomEditCount', 1,
    'roomEditedAt', edited_at
  );
end;
$$;

create or replace function public.rankball_match_room_update_action(
  p_actor_profile_id text,
  p_match_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  current_match public.matches%rowtype;
  result jsonb;
  edited_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if jsonb_typeof(patch) <> 'object' or patch = '{}'::jsonb then
    raise exception 'room_update_no_changes' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select match.* into current_match
  from public.matches match
  where match.id = safe_match_id
  for update;

  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
     and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
    raise exception 'match_room_operator_required' using errcode = '42501';
  end if;
  if (
    case
      when coalesce(current_match.rules->>'roomEditCount', '') ~ '^[0-9]+$'
        then (current_match.rules->>'roomEditCount')::integer
      else 0
    end
  ) >= 1 then
    raise exception 'room_edit_limit_reached' using errcode = '23514';
  end if;

  result := public.rankball_match_room_update_action_pre_edit_once(
    safe_actor_id,
    safe_match_id,
    patch
  );

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'roomEditCount', 1,
        'roomEditedAt', edited_at,
        'roomEditedBy', safe_actor_id
      ),
      updated_at = edited_at
  where id = safe_match_id;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'roomEditCount', 1,
    'roomEditedAt', edited_at
  );
end;
$$;

revoke all on function public.rankball_recruiting_room_update_action(text, text, jsonb) from public;
revoke all on function public.rankball_match_room_update_action(text, text, jsonb) from public;
grant execute on function public.rankball_recruiting_room_update_action(text, text, jsonb) to authenticated, service_role;
grant execute on function public.rankball_match_room_update_action(text, text, jsonb) to authenticated, service_role;

comment on function public.rankball_recruiting_room_update_action(text, text, jsonb)
  is 'Applies the only allowed recruiting-room edit and records its consumption atomically.';
comment on function public.rankball_match_room_update_action(text, text, jsonb)
  is 'Applies the only allowed confirmed-match room edit and records its consumption atomically.';
