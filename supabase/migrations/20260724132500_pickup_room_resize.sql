begin;

do $$
begin
  if to_regprocedure('public.rankball_recruiting_room_update_action_pre_pickup_resize(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_room_update_action(text,text,jsonb)') is null then
      raise exception 'rankball_recruiting_room_update_action_missing';
    end if;
    alter function public.rankball_recruiting_room_update_action(text, text, jsonb)
      rename to rankball_recruiting_room_update_action_pre_pickup_resize;
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
  pickup_room boolean := false;
  next_side_capacity integer;
  next_bench_capacity integer;
  participant_count integer := 0;
  host_present boolean := false;
  active_application_capacity integer := 0;
  next_invitations jsonb := '[]'::jsonb;
  next_pinned_reserves jsonb := '{}'::jsonb;
  next_room_state jsonb := '{}'::jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'invalid_room_update_patch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.*
  into current_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;

  if current_post.id is null then
    raise exception 'recruiting_post_not_found' using errcode = 'P0002';
  end if;

  pickup_room := coalesce(current_post.rules->>'formationMode', '') = 'pickup'
    or coalesce(current_post.rules->>'matchIntent', '') = 'pickup';
  if not pickup_room then
    return public.rankball_recruiting_room_update_action_pre_pickup_resize(
      safe_actor_id,
      safe_post_id,
      patch
    );
  end if;

  if current_post.status <> 'open' or current_post.confirmed_at is not null then
    raise exception 'recruiting_room_edit_locked' using errcode = '23514';
  end if;
  if current_post.player_id is distinct from safe_actor_id then
    raise exception 'recruiting_owner_required' using errcode = '42501';
  end if;

  if patch ? 'sideCapacity' and coalesce(patch->>'sideCapacity', '') !~ '^[0-9]+$' then
    raise exception 'invalid_side_capacity' using errcode = '22023';
  end if;
  next_side_capacity := coalesce((patch->>'sideCapacity')::integer, current_post.side_capacity);
  if next_side_capacity not in (1, 2, 3, 5) then
    raise exception 'unsupported_match_mode' using errcode = '23514';
  end if;

  if patch ? 'benchCapacity' and coalesce(patch->>'benchCapacity', '') !~ '^[0-3]$' then
    raise exception 'invalid_bench_capacity' using errcode = '22023';
  end if;
  next_bench_capacity := coalesce((patch->>'benchCapacity')::integer, current_post.bench_capacity);

  if exists (
    select 1
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and (
        application.kind <> 'player'
        or application.team_id is not null
        or jsonb_array_length(
          case when jsonb_typeof(application.player_ids) = 'array'
            then application.player_ids
            else '[]'::jsonb
          end
        ) > 0
        or application.player_id = current_post.player_id
      )
  ) then
    raise exception 'pickup_roster_shape_invalid' using errcode = '23514';
  end if;

  select count(distinct participant.player_id)::integer
  into participant_count
  from (
    select current_post.player_id as player_id
    union all
    select application.player_id
    from public.recruiting_applications application
    where application.post_id = safe_post_id
  ) participant
  where nullif(btrim(participant.player_id), '') is not null;

  if participant_count > (next_side_capacity + next_bench_capacity) * 2 then
    raise exception 'pickup_participant_capacity_below_pool' using errcode = '23514';
  end if;

  host_present := nullif(btrim(current_post.player_id), '') is not null;
  active_application_capacity := next_side_capacity * 2 - case when host_present then 1 else 0 end;

  with ordered_applications as (
    select
      application.post_id,
      application.player_id,
      application.kind,
      row_number() over (
        order by application.created_at, application.player_id, application.kind
      )::integer as slot_number
    from public.recruiting_applications application
    where application.post_id = safe_post_id
  )
  update public.recruiting_applications application
  set side = case
        when ordered.slot_number <= active_application_capacity then
          case
            when host_present then
              case
                when mod(ordered.slot_number, 2) = 1
                  then case when current_post.host_side = 'teamB' then 'teamA' else 'teamB' end
                else case when current_post.host_side = 'teamB' then 'teamB' else 'teamA' end
              end
            when mod(ordered.slot_number, 2) = 1 then 'teamA'
            else 'teamB'
          end
        when mod(ordered.slot_number - active_application_capacity, 2) = 1 then 'teamA'
        else 'teamB'
      end,
      reserve = ordered.slot_number > active_application_capacity,
      updated_at = now_at
  from ordered_applications ordered
  where application.post_id = ordered.post_id
    and application.player_id = ordered.player_id
    and application.kind = ordered.kind;

  select coalesce(jsonb_object_agg(reserve_side.side, reserve_side.player_ids), '{}'::jsonb)
  into next_pinned_reserves
  from (
    select
      application.side,
      jsonb_agg(to_jsonb(application.player_id) order by application.created_at, application.player_id) as player_ids
    from public.recruiting_applications application
    where application.post_id = safe_post_id
      and application.reserve = true
    group by application.side
  ) reserve_side;

  select coalesce(jsonb_agg(
    case
      when coalesce(invitation.value->>'role', 'player') = 'referee' then invitation.value
      else (invitation.value - 'teamId') || jsonb_build_object(
        'joinMode', 'player',
        'reserve', false
      )
    end
    order by invitation.ordinality
  ), '[]'::jsonb)
  into next_invitations
  from jsonb_array_elements(
    case when jsonb_typeof(current_post.room_state->'invitations') = 'array'
      then current_post.room_state->'invitations'
      else '[]'::jsonb
    end
  ) with ordinality invitation(value, ordinality);

  next_room_state := coalesce(current_post.room_state, '{}'::jsonb) || jsonb_build_object(
    'hostReserve', false,
    'partyLeaders', '{}'::jsonb,
    'partySides', '{}'::jsonb,
    'partyReserves', '{}'::jsonb,
    'pinnedReservePlayers', next_pinned_reserves,
    'invitations', next_invitations
  );

  update public.recruiting_posts
  set room_state = next_room_state,
      updated_at = now_at
  where id = safe_post_id;

  return public.rankball_recruiting_room_update_action_pre_pickup_resize(
    safe_actor_id,
    safe_post_id,
    patch
  );
end;
$$;

revoke all on function public.rankball_recruiting_room_update_action_pre_pickup_resize(text, text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_room_update_action(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_recruiting_room_update_action(text, text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
