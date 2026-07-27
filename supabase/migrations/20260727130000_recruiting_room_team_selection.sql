begin;

do $migration$
begin
  if to_regprocedure('public.rankball_recruiting_management_action_pre_room_team_selection(text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_management_action(text,jsonb)') is null then
      raise exception 'rankball_recruiting_management_action_missing';
    end if;
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_pre_room_team_selection;
  end if;
end;
$migration$;

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
  normalized_operation jsonb := coalesce(p_operation, '{}'::jsonb);
  draft jsonb := coalesce(p_operation->'draft', '{}'::jsonb);
  rules jsonb := coalesce(p_operation #> '{draft,rules}', '{}'::jsonb);
  match_intent text;
  match_purpose text;
  mmr_range_mode text;
  mmr_limit_mode text;
  pickup_room boolean := false;
  record_room boolean := false;
  ranked_room boolean := false;
  team_room boolean := false;
  result jsonb;
begin
  if safe_action is distinct from 'createRecruitingPost' then
    return public.rankball_recruiting_management_action_pre_room_team_selection(
      p_actor_profile_id,
      p_operation
    );
  end if;

  match_intent := coalesce(nullif(draft->>'matchIntent', ''), nullif(rules->>'matchIntent', ''));
  match_purpose := coalesce(nullif(draft->>'matchPurpose', ''), nullif(rules->>'matchPurpose', ''));
  pickup_room := match_intent = 'pickup'
    or coalesce(nullif(draft->>'formationMode', ''), nullif(rules->>'formationMode', '')) = 'pickup';
  record_room := match_intent in ('record', 'match_record');
  ranked_room := not record_room and case
    when match_purpose is not null then match_purpose = 'competitive'
    else coalesce((draft->>'ranked')::boolean, true)
  end;
  mmr_range_mode := case
    when coalesce(nullif(draft->>'mmrRangeMode', ''), nullif(rules->>'mmrRangeMode', '')) = 'standard' then 'normal'
    when coalesce(nullif(draft->>'mmrRangeMode', ''), nullif(rules->>'mmrRangeMode', '')) in ('narrow', 'normal', 'wide')
      then coalesce(nullif(draft->>'mmrRangeMode', ''), nullif(rules->>'mmrRangeMode', ''))
    else 'normal'
  end;
  mmr_limit_mode := case when ranked_room and not pickup_room and not record_room then 'block' else 'off' end;
  team_room := not pickup_room
    and not record_room
    and coalesce(nullif(draft->>'hostJoinMode', ''), nullif(rules->>'hostJoinMode', ''), 'team') = 'team';

  rules := rules || jsonb_build_object(
    'ranked', ranked_room,
    'mmrRangeMode', mmr_range_mode,
    'mmrLimitMode', mmr_limit_mode
  );
  draft := draft || jsonb_build_object(
    'ranked', ranked_room,
    'mmrRangeMode', mmr_range_mode,
    'mmrLimitMode', mmr_limit_mode,
    'rules', rules
  );

  if not team_room then
    normalized_operation := jsonb_set(normalized_operation, '{draft}', draft, true);
    return public.rankball_recruiting_management_action_pre_room_team_selection(
      p_actor_profile_id,
      normalized_operation
    );
  end if;

  draft := draft
    - 'teamId'
    - 'teamAId'
    - 'targetTeamId'
    - 'opponentTeamId'
    - 'opponentLeaderId'
    - 'opponentPlayerIds'
    - 'opponentReservePlayerIds'
    || jsonb_build_object(
      'hostJoinMode', 'player',
      'teamOnly', false,
      'playerIds', '[]'::jsonb,
      'invitePlayerIds', '[]'::jsonb,
      'rules', rules || jsonb_build_object('hostJoinMode', 'player', 'teamOnly', false)
    );
  normalized_operation := jsonb_set(normalized_operation, '{draft}', draft, true);
  result := public.rankball_recruiting_management_action_pre_room_team_selection(
    p_actor_profile_id,
    normalized_operation
  );
  safe_post_id := coalesce(safe_post_id, nullif(btrim(result->>'postId'), ''));
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  update public.recruiting_posts
  set type = 'need_team',
      team_id = null,
      target_team_id = null,
      host_join_mode = 'team',
      host_side = 'teamA',
      host_ready = false,
      player_ids = '[]'::jsonb,
      spots = greatest(0, side_capacity * 2),
      ranked = ranked_room,
      rating_scale = case when ranked_room then
        case when mmr_range_mode = 'narrow' then 1.1 when mmr_range_mode = 'wide' then 0.8 else 1 end
        else 1 end,
      rules = coalesce(recruiting_posts.rules, '{}'::jsonb) || jsonb_build_object(
        'hostJoinMode', 'team',
        'teamOnly', true,
        'ranked', ranked_room,
        'mmrRangeMode', mmr_range_mode,
        'mmrLimitMode', mmr_limit_mode
      ),
      room_state = coalesce(recruiting_posts.room_state, '{}'::jsonb) || jsonb_build_object(
        'teamOnly', true,
        'mmrRangeMode', mmr_range_mode,
        'mmrLimitMode', mmr_limit_mode,
        'partyReserves', '{}'::jsonb,
        'partyLeaders', '{}'::jsonb,
        'partySides', '{}'::jsonb
      ),
      updated_at = now()
  where id = safe_post_id;

  perform public.rankball_refresh_recruiting_feed_for_post(safe_post_id);
  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'postId', safe_post_id,
    'teamSelectionPending', true
  );
end;
$$;

create or replace function public.rankball_recruiting_team_event_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  host_mmr numeric;
  mmr_range_mode text;
  mmr_limit_mode text;
  host_result jsonb;
  target_result jsonb;
  captain_id text;
  require_target_invitation boolean := false;
begin
  if new.status <> 'open' or new.host_join_mode <> 'team' then
    return new;
  end if;

  if new.team_id is null then
    if new.target_team_id is not null
       or jsonb_array_length(case when jsonb_typeof(new.player_ids) = 'array' then new.player_ids else '[]'::jsonb end) > 0 then
      raise exception 'recruiting_team_selection_pending_shape_invalid' using errcode = '23514';
    end if;
    return new;
  end if;

  select coalesce(team.mmr, 1200) into host_mmr
  from public.teams team
  where team.id = new.team_id and team.deleted_at is null;
  if host_mmr is null then
    raise exception 'recruiting_host_team_not_found' using errcode = 'P0002';
  end if;

  mmr_range_mode := case
    when coalesce(nullif(new.room_state->>'mmrRangeMode', ''), nullif(new.rules->>'mmrRangeMode', '')) = 'standard' then 'normal'
    when coalesce(nullif(new.room_state->>'mmrRangeMode', ''), nullif(new.rules->>'mmrRangeMode', '')) in ('narrow', 'normal', 'wide')
      then coalesce(nullif(new.room_state->>'mmrRangeMode', ''), nullif(new.rules->>'mmrRangeMode', ''))
    else 'normal'
  end;
  mmr_limit_mode := case when new.ranked then 'block' else 'off' end;
  new.room_state := coalesce(new.room_state, '{}'::jsonb) || jsonb_build_object(
    'mmrRangeMode', mmr_range_mode,
    'mmrLimitMode', mmr_limit_mode,
    'teamOnly', true
  );
  new.rules := coalesce(new.rules, '{}'::jsonb) || jsonb_build_object(
    'mmrRangeMode', mmr_range_mode,
    'mmrLimitMode', mmr_limit_mode,
    'teamOnly', true,
    'hostJoinMode', 'team'
  );

  host_result := public.rankball_assert_team_event_eligible(
    new.team_id,
    new.side_capacity,
    new.ranked,
    mmr_limit_mode,
    host_mmr,
    mmr_range_mode,
    new.allowed_age_groups,
    true
  );
  captain_id := host_result->>'captainId';
  if new.player_id is distinct from captain_id then
    raise exception 'team_captain_required' using errcode = '42501';
  end if;

  if new.visibility = 'public' and new.target_team_id is not null then
    raise exception 'public_team_room_side_b_direct_selection_not_allowed' using errcode = '23514';
  end if;
  if new.visibility = 'private' and new.target_team_id is not null then
    if new.target_team_id = new.team_id then
      raise exception 'recruiting_team_duplicate' using errcode = '23514';
    end if;
    target_result := public.rankball_assert_team_event_eligible(
      new.target_team_id,
      new.side_capacity,
      new.ranked,
      mmr_limit_mode,
      host_mmr,
      mmr_range_mode,
      new.allowed_age_groups,
      true
    );
    captain_id := target_result->>'captainId';
    require_target_invitation := tg_op = 'INSERT';
    if tg_op = 'UPDATE' then
      require_target_invitation := new.target_team_id is distinct from old.target_team_id;
    end if;
    if require_target_invitation and not exists (
      select 1
      from jsonb_array_elements(case when jsonb_typeof(new.room_state->'invitations') = 'array'
        then new.room_state->'invitations' else '[]'::jsonb end) invitation(value)
      where invitation.value->>'teamId' = new.target_team_id
        and invitation.value->>'targetUserId' = captain_id
        and invitation.value->>'joinMode' = 'team'
        and coalesce(invitation.value->>'side', 'teamB') = 'teamB'
        and coalesce(invitation.value->>'status', 'pending') = 'pending'
    ) then
      raise exception 'recruiting_opponent_captain_required' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.rankball_recruiting_team_selection_application_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  post_row public.recruiting_posts%rowtype;
begin
  select post.* into post_row
  from public.recruiting_posts post
  where post.id = new.post_id;
  if post_row.status = 'open'
     and post_row.host_join_mode = 'team'
     and post_row.team_id is null then
    raise exception 'recruiting_host_team_selection_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_recruiting_team_selection_application_guard_trigger
on public.recruiting_applications;
create trigger rankball_recruiting_team_selection_application_guard_trigger
before insert or update on public.recruiting_applications
for each row execute function public.rankball_recruiting_team_selection_application_guard();

create or replace function public.rankball_recruiting_set_room_team_action(
  p_actor_profile_id text,
  p_post_id text,
  p_side text,
  p_team_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_team_id text := nullif(btrim(p_team_id), '');
  post_row public.recruiting_posts%rowtype;
  team_row public.teams%rowtype;
  host_team public.teams%rowtype;
  eligibility jsonb;
  captain_id text;
  mmr_range_mode text;
  mmr_limit_mode text;
  safe_room_state jsonb;
  invitations jsonb;
  invitation jsonb;
  invitation_id text;
  now_at timestamptz := clock_timestamp();
begin
  if safe_actor_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;
  if safe_team_id is null then
    raise exception 'recruiting_team_required' using errcode = '22023';
  end if;
  if safe_side is null or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_recruiting_team_side' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));
  select post.* into post_row
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;
  if post_row.id is null then
    raise exception 'recruiting_post_not_found' using errcode = 'P0002';
  end if;
  if post_row.status <> 'open' or post_row.confirmed_at is not null then
    raise exception 'recruiting_room_not_open' using errcode = '23514';
  end if;
  if post_row.host_join_mode <> 'team'
     or not coalesce((post_row.room_state->>'teamOnly')::boolean, false) then
    raise exception 'recruiting_team_room_required' using errcode = '23514';
  end if;
  if coalesce(nullif(post_row.room_state->>'ownerId', ''), post_row.player_id) is distinct from safe_actor_id then
    raise exception 'recruiting_owner_required' using errcode = '42501';
  end if;

  select team.* into team_row
  from public.teams team
  where team.id = safe_team_id and team.deleted_at is null;
  if team_row.id is null then
    raise exception 'recruiting_team_not_found' using errcode = 'P0002';
  end if;

  safe_room_state := coalesce(post_row.room_state, '{}'::jsonb);
  mmr_range_mode := case
    when coalesce(nullif(safe_room_state->>'mmrRangeMode', ''), nullif(post_row.rules->>'mmrRangeMode', '')) = 'standard' then 'normal'
    when coalesce(nullif(safe_room_state->>'mmrRangeMode', ''), nullif(post_row.rules->>'mmrRangeMode', '')) in ('narrow', 'normal', 'wide')
      then coalesce(nullif(safe_room_state->>'mmrRangeMode', ''), nullif(post_row.rules->>'mmrRangeMode', ''))
    else 'normal'
  end;
  mmr_limit_mode := case when post_row.ranked then 'block' else 'off' end;

  if safe_side = 'teamA' then
    if post_row.team_id is not null then
      raise exception 'recruiting_room_team_already_selected' using errcode = '23514';
    end if;
    if post_row.target_team_id = safe_team_id then
      raise exception 'recruiting_team_duplicate' using errcode = '23514';
    end if;
    eligibility := public.rankball_assert_team_event_eligible(
      safe_team_id,
      post_row.side_capacity,
      post_row.ranked,
      mmr_limit_mode,
      coalesce(team_row.mmr, 1200),
      mmr_range_mode,
      post_row.allowed_age_groups,
      true
    );
    captain_id := eligibility->>'captainId';
    if captain_id is distinct from safe_actor_id then
      raise exception 'team_captain_required' using errcode = '42501';
    end if;

    update public.recruiting_posts
    set team_id = safe_team_id,
        player_ids = jsonb_build_array(safe_actor_id),
        host_ready = false,
        spots = greatest(0, side_capacity * 2 - 1),
        rating_scale = case when ranked then
          case when mmr_range_mode = 'narrow' then 1.1 when mmr_range_mode = 'wide' then 0.8 else 1 end
          else 1 end,
        room_state = safe_room_state || jsonb_build_object(
          'mmrRangeMode', mmr_range_mode,
          'mmrLimitMode', mmr_limit_mode,
          'partyLeaders', coalesce(safe_room_state->'partyLeaders', '{}'::jsonb) || jsonb_build_object('host', safe_actor_id),
          'partySides', coalesce(safe_room_state->'partySides', '{}'::jsonb) || jsonb_build_object('host', 'teamA')
        ),
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'mmrRangeMode', mmr_range_mode,
          'mmrLimitMode', mmr_limit_mode
        ),
        updated_at = now_at
    where id = safe_post_id;
  else
    if post_row.visibility <> 'private' then
      raise exception 'public_team_room_side_b_direct_selection_not_allowed' using errcode = '23514';
    end if;
    if post_row.team_id is null then
      raise exception 'recruiting_host_team_selection_required' using errcode = '23514';
    end if;
    if post_row.target_team_id is not null then
      raise exception 'recruiting_room_team_already_selected' using errcode = '23514';
    end if;
    if post_row.team_id = safe_team_id then
      raise exception 'recruiting_team_duplicate' using errcode = '23514';
    end if;
    select team.* into host_team
    from public.teams team
    where team.id = post_row.team_id and team.deleted_at is null;
    if host_team.id is null then
      raise exception 'recruiting_host_team_not_found' using errcode = 'P0002';
    end if;
    eligibility := public.rankball_assert_team_event_eligible(
      safe_team_id,
      post_row.side_capacity,
      post_row.ranked,
      mmr_limit_mode,
      coalesce(host_team.mmr, 1200),
      mmr_range_mode,
      post_row.allowed_age_groups,
      true
    );
    captain_id := eligibility->>'captainId';
    if captain_id is null then
      raise exception 'team_captain_required' using errcode = '42501';
    end if;

    invitation_id := 'inv_' || substr(md5(safe_post_id || ':teamB:' || safe_team_id || ':' || captain_id), 1, 24);
    invitation := jsonb_build_object(
      'id', invitation_id,
      'role', 'player',
      'targetUserId', captain_id,
      'fromUserId', safe_actor_id,
      'teamId', safe_team_id,
      'joinMode', 'team',
      'side', 'teamB',
      'reserve', false,
      'status', 'pending',
      'createdAt', now_at,
      'updatedAt', now_at
    );
    invitations := case when jsonb_typeof(safe_room_state->'invitations') = 'array'
      then safe_room_state->'invitations' else '[]'::jsonb end;

    update public.recruiting_posts
    set target_team_id = safe_team_id,
        room_state = safe_room_state || jsonb_build_object(
          'mmrRangeMode', mmr_range_mode,
          'mmrLimitMode', mmr_limit_mode,
          'invitations', invitations || invitation
        ),
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'mmrRangeMode', mmr_range_mode,
          'mmrLimitMode', mmr_limit_mode
        ),
        updated_at = now_at
    where id = safe_post_id;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      recruiting_post_id, invitation_id, payload, created_at, updated_at
    ) values (
      'notice-recruiting-team-selection-' || safe_post_id || '-' || substr(md5(safe_team_id), 1, 16),
      captain_id,
      captain_id,
      U&'\B9E4\CE58\BC29 \CD08\B300',
      post_row.title || U&' B\C0AC\C774\B4DC \D300 \CD08\B300\AC00 \B3C4\CC29\D588\C2B5\B2C8\B2E4.',
      'match',
      'recruiting_invitation',
      safe_post_id,
      invitation_id,
      invitation || jsonb_build_object(
        'targetUserId', captain_id,
        'recruitingPostId', safe_post_id,
        'invitationId', invitation_id,
        'actionRequired', true
      ),
      now_at,
      now_at
    ) on conflict (id) do update set
      target_user_id = excluded.target_user_id,
      title = excluded.title,
      body = excluded.body,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  end if;

  perform public.rankball_refresh_recruiting_feed_for_post(safe_post_id);
  return jsonb_build_object(
    'ok', true,
    'action', 'setRecruitingRoomTeam',
    'postId', safe_post_id,
    'side', safe_side,
    'teamId', safe_team_id,
    'captainId', captain_id,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_recruiting_management_action_pre_room_team_selection(text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action(text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_recruiting_management_action(text, jsonb)
to service_role;
revoke all on function public.rankball_recruiting_set_room_team_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_recruiting_set_room_team_action(text, text, text, text)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
