begin;

do $$
begin
  if to_regprocedure('public.rankball_match_generate_pickup_assignment_pre_reroll(text,text,text)') is null then
    if to_regprocedure('public.rankball_match_generate_pickup_assignment(text,text,text)') is null then
      raise exception 'rankball_match_generate_pickup_assignment_missing';
    end if;
    alter function public.rankball_match_generate_pickup_assignment(text, text, text)
      rename to rankball_match_generate_pickup_assignment_pre_reroll;
  end if;
end;
$$;

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
  assignment_mode text := nullif(btrim(p_assignment_mode), '');
  base_mode text;
  base_actor_id text;
  current_match public.matches%rowtype;
  participant_ids text[] := array[]::text[];
  attendance_ids text[] := array[]::text[];
  absent_ids text[] := array[]::text[];
  used_by_ids text[] := array[]::text[];
  next_used_by_ids text[] := array[]::text[];
  side_capacity integer;
  bench_capacity integer;
  assignment_revision integer := 0;
  reroll_count integer := 0;
  next_reroll_count integer := 0;
  actor_is_operator boolean := false;
  actor_attended boolean := false;
  reroll boolean := false;
  actor_trust integer := 0;
  actor_name text := '참가자';
  rating_scale numeric := 0;
  reserve_a jsonb := '[]'::jsonb;
  reserve_b jsonb := '[]'::jsonb;
  base_result jsonb := '{}'::jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then raise exception 'match_id_required' using errcode = '22023'; end if;
  if assignment_mode not in ('manual', 'random', 'mmr_balanced') then
    raise exception 'invalid_pickup_assignment_mode' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select match.* into current_match
  from public.matches match
  where match.id = safe_match_id
  for update;

  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
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

  actor_is_operator := safe_actor_id = nullif(btrim(current_match.created_by), '')
    or safe_actor_id = nullif(btrim(current_match.referee_id), '');
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
  assignment_revision := case
    when coalesce(current_match.rules->>'sideAssignmentRevision', '') ~ '^[0-9]+$'
      then (current_match.rules->>'sideAssignmentRevision')::integer
    else 0
  end;
  reroll_count := case
    when coalesce(current_match.rules->>'pickupRerollCount', '') ~ '^[0-9]+$'
      then (current_match.rules->>'pickupRerollCount')::integer
    else 0
  end;

  with participant(profile_id) as (
    select player.user_id
    from public.match_players player
    where player.match_id = safe_match_id and player.side in ('teamA', 'teamB')
    union
    select reserve.value
    from jsonb_each(case when jsonb_typeof(current_match.reserve_players) = 'object'
      then current_match.reserve_players else '{}'::jsonb end) reserve_side(side_name, player_ids)
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(reserve_side.player_ids) = 'array'
      then reserve_side.player_ids else '[]'::jsonb end) reserve(value)
    where reserve_side.side_name in ('teamA', 'teamB')
  ),
  attended(profile_id) as (
    select attendee.value
    from jsonb_each(case when jsonb_typeof(current_match.attendance) = 'object'
      then current_match.attendance else '{}'::jsonb end) attendance_side(side_name, player_ids)
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(attendance_side.player_ids) = 'array'
      then attendance_side.player_ids else '[]'::jsonb end) attendee(value)
    where attendance_side.side_name in ('teamA', 'teamB')
  )
  select
    coalesce(array_agg(distinct participant.profile_id order by participant.profile_id), array[]::text[]),
    coalesce(array_agg(distinct participant.profile_id order by participant.profile_id)
      filter (where attended.profile_id is not null), array[]::text[])
  into participant_ids, attendance_ids
  from participant
  left join attended on attended.profile_id = participant.profile_id
  where nullif(btrim(participant.profile_id), '') is not null;

  if cardinality(attendance_ids) < side_capacity * 2 then
    raise exception 'pickup_checked_in_players_insufficient' using errcode = '23514';
  end if;
  if cardinality(attendance_ids) > (side_capacity + bench_capacity) * 2 then
    raise exception 'pickup_participant_capacity_exceeded' using errcode = '23514';
  end if;

  actor_attended := safe_actor_id = any(attendance_ids);
  reroll := assignment_revision > 0 and assignment_mode in ('random', 'mmr_balanced');
  if assignment_revision = 0 and not actor_is_operator then
    raise exception 'match_room_operator_required' using errcode = '42501';
  end if;
  if assignment_revision > 0 and assignment_mode = 'manual' and not actor_is_operator then
    raise exception 'match_room_operator_required' using errcode = '42501';
  end if;
  if reroll and not actor_is_operator and not actor_attended then
    raise exception 'pickup_reroll_participant_required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct used.value order by used.value), array[]::text[])
  into used_by_ids
  from jsonb_array_elements_text(case
    when jsonb_typeof(current_match.rules->'pickupRerollUserIds') = 'array'
      then current_match.rules->'pickupRerollUserIds'
    else '[]'::jsonb
  end) used(value);

  if reroll then
    if reroll_count >= 2 then raise exception 'pickup_reroll_limit_reached' using errcode = '23514'; end if;
    if safe_actor_id = any(used_by_ids) then raise exception 'pickup_reroll_user_limit_reached' using errcode = '23514'; end if;
    select coalesce(profile.trust_score, 80), coalesce(nullif(profile.name, ''), '참가자')
    into actor_trust, actor_name
    from public.profiles profile
    where profile.id = safe_actor_id
    for update;
    if actor_trust < 1 then raise exception 'pickup_reroll_trust_required' using errcode = '23514'; end if;
    next_used_by_ids := used_by_ids || safe_actor_id;
    next_reroll_count := reroll_count + 1;
  else
    next_used_by_ids := used_by_ids;
    next_reroll_count := reroll_count;
  end if;

  select coalesce(array_agg(profile_id order by profile_id), array[]::text[])
  into absent_ids
  from unnest(participant_ids) participant(profile_id)
  where not participant.profile_id = any(attendance_ids);

  select coalesce(jsonb_agg(reserve.value), '[]'::jsonb)
  into reserve_a
  from jsonb_array_elements_text(case when jsonb_typeof(current_match.reserve_players->'teamA') = 'array'
    then current_match.reserve_players->'teamA' else '[]'::jsonb end) reserve(value)
  where reserve.value = any(attendance_ids);

  select coalesce(jsonb_agg(reserve.value), '[]'::jsonb)
  into reserve_b
  from jsonb_array_elements_text(case when jsonb_typeof(current_match.reserve_players->'teamB') = 'array'
    then current_match.reserve_players->'teamB' else '[]'::jsonb end) reserve(value)
  where reserve.value = any(attendance_ids);

  delete from public.match_players player
  where player.match_id = safe_match_id and not player.user_id = any(attendance_ids);
  delete from public.match_agreements agreement
  where agreement.match_id = safe_match_id and not agreement.user_id = any(attendance_ids);
  delete from public.match_approvals approval
  where approval.match_id = safe_match_id and not approval.user_id = any(attendance_ids);

  update public.matches
  set reserve_players = jsonb_build_object('teamA', reserve_a, 'teamB', reserve_b),
      updated_at = now_at
  where id = safe_match_id;

  base_mode := case when assignment_mode = 'manual' then 'random' else assignment_mode end;
  base_actor_id := case when actor_is_operator then safe_actor_id else current_match.created_by end;
  base_result := public.rankball_match_generate_pickup_assignment_pre_reroll(
    base_actor_id,
    safe_match_id,
    base_mode
  );

  rating_scale := case
    when current_match.ranked = false then 0
    when assignment_mode = 'manual' then 0.9
    when assignment_mode = 'mmr_balanced' then 1.1
    else 1
  end;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'pickupTeamAssignmentMode', assignment_mode,
        'sideAssignmentGeneratedBy', safe_actor_id,
        'pickupRerollUserIds', to_jsonb(next_used_by_ids),
        'pickupRerollCount', next_reroll_count,
        'pickupAbsentPlayerIds', to_jsonb(absent_ids),
        'ratingScale', rating_scale
      ),
      updated_at = now_at
  where id = safe_match_id;

  if reroll then
    update public.profiles
    set trust_score = greatest(0, coalesce(trust_score, 80) - 1),
        updated_at = now_at
    where id = safe_actor_id;

    if nullif(current_match.rules->>'recruitingPostId', '') is not null then
      update public.recruiting_posts post
      set room_state = jsonb_set(
            coalesce(post.room_state, '{}'::jsonb),
            '{chatMessages}',
            (case when jsonb_typeof(post.room_state->'chatMessages') = 'array'
              then post.room_state->'chatMessages' else '[]'::jsonb end)
              || jsonb_build_array(jsonb_build_object(
                'id', 'pickup-reroll-' || substr(md5(safe_match_id || ':' || now_at::text), 1, 20),
                'userId', safe_actor_id,
                'body', actor_name || '님이 신뢰도 1점을 사용해 '
                  || case when assignment_mode = 'mmr_balanced' then 'MMR 균형' else '완전 랜덤' end
                  || ' 배치를 다시 실행했습니다.',
                'createdAt', now_at,
                'system', true
              )),
            true
          ),
          updated_at = now_at
      where post.id = current_match.rules->>'recruitingPostId';
    end if;
  end if;

  return coalesce(base_result, '{}'::jsonb) || jsonb_build_object(
    'assignmentMode', assignment_mode,
    'ratingScale', rating_scale,
    'reroll', reroll,
    'rerollCount', next_reroll_count,
    'rerollRemaining', greatest(0, 2 - next_reroll_count),
    'trustPenalty', case when reroll then 1 else 0 end,
    'checkedInPlayerIds', to_jsonb(attendance_ids),
    'absentPlayerIds', to_jsonb(absent_ids)
  );
end;
$$;

revoke all on function public.rankball_match_generate_pickup_assignment(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_generate_pickup_assignment(text, text, text) to service_role;

comment on function public.rankball_match_generate_pickup_assignment(text, text, text)
  is 'Builds pickup sides from checked-in players and enforces two paid automatic rerolls, once per user.';

select pg_notify('pgrst', 'reload schema');

commit;
