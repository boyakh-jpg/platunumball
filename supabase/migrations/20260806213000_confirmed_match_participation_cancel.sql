begin;

create table if not exists public.match_participation_cancellations (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  player_id text not null references public.profiles(id) on delete cascade,
  side text not null check (side in ('teamA', 'teamB')),
  original_role text not null check (original_role in ('active', 'reserve')),
  reason text not null check (char_length(btrim(reason)) between 5 and 200),
  trust_penalty integer not null default 0 check (trust_penalty between 0 and 15),
  promoted_player_id text references public.profiles(id) on delete set null,
  roster_needs_fill boolean not null default false,
  created_at timestamptz not null default now(),
  unique (match_id, player_id)
);

create index if not exists match_participation_cancellations_match_created_idx
  on public.match_participation_cancellations (match_id, created_at desc);

alter table public.match_participation_cancellations enable row level security;
revoke all on table public.match_participation_cancellations from public, anon, authenticated;
grant select, insert, update, delete on table public.match_participation_cancellations to service_role;

do $$
begin
  if to_regprocedure('public.rankball_default_rating_policy_pre_participation_cancel()') is null then
    alter function public.rankball_default_rating_policy()
      rename to rankball_default_rating_policy_pre_participation_cancel;
  end if;
  if to_regprocedure('public.rankball_normalize_rating_policy_pre_participation_cancel(jsonb)') is null then
    alter function public.rankball_normalize_rating_policy(jsonb)
      rename to rankball_normalize_rating_policy_pre_participation_cancel;
  end if;
end;
$$;

create or replace function public.rankball_default_rating_policy()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_set(
    public.rankball_default_rating_policy_pre_participation_cancel(),
    '{trust}',
    coalesce(public.rankball_default_rating_policy_pre_participation_cancel()->'trust', '{}'::jsonb)
      || jsonb_build_object(
        'participantCancelShortNoticePenalty', 2,
        'participantCancelCheckinPenalty', 4
      ),
    true
  );
$$;

create or replace function public.rankball_normalize_rating_policy(p_policy jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_set(
    jsonb_set(
      public.rankball_normalize_rating_policy_pre_participation_cancel(p_policy),
      '{trust,participantCancelShortNoticePenalty}',
      to_jsonb(public.rankball_policy_value(p_policy, array['trust', 'participantCancelShortNoticePenalty'], 2, 0, 10)),
      true
    ),
    '{trust,participantCancelCheckinPenalty}',
    to_jsonb(public.rankball_policy_value(p_policy, array['trust', 'participantCancelCheckinPenalty'], 4, 0, 15)),
    true
  );
$$;

update public.rating_policy
set policy = public.rankball_normalize_rating_policy(policy),
    version = version + 1,
    reason = '확정 경기 참가 취소 정책 추가',
    updated_at = now()
where id = 'active'
  and (
    not (policy->'trust' ? 'participantCancelShortNoticePenalty')
    or not (policy->'trust' ? 'participantCancelCheckinPenalty')
  );

create or replace function public.rankball_match_participation_cancel_action(
  p_actor_profile_id text,
  p_match_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_reason text := nullif(btrim(p_reason), '');
  current_match public.matches%rowtype;
  actor_name text;
  safe_side text;
  original_role text;
  side_capacity integer;
  active_count integer;
  next_reserve_players jsonb;
  next_attendance jsonb;
  next_promoted_reserve_ids jsonb;
  promoted_player_id text;
  promoted_team_id text;
  scheduled_at timestamptz;
  checkin_open_at timestamptz;
  checkin_open boolean := false;
  hours_until numeric;
  trust_penalty integer := 0;
  shortage_a boolean := false;
  shortage_b boolean := false;
  shortage_sides jsonb := '[]'::jsonb;
  next_rules jsonb;
  next_parties jsonb := '[]'::jsonb;
  party jsonb;
  party_players jsonb;
  party_reserves jsonb;
  party_roster jsonb;
  party_leader text;
  event_id uuid := gen_random_uuid();
  notification_target_ids text[] := array[]::text[];
  notification_prefix text;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if safe_reason is null or char_length(safe_reason) < 5 or char_length(safe_reason) > 200 then
    raise exception 'match_participation_cancel_reason_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.tournament_id is not null
     or coalesce(current_match.rules->>'recordType', 'match') <> 'match'
     or current_match.status not in ('contract', 'agreed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id)
  then
    raise exception 'match_participation_cancel_locked' using errcode = '23514';
  end if;

  select player.side into safe_side
  from public.match_players player
  where player.match_id = safe_match_id and player.user_id = safe_actor_id
  order by player.slot_order
  limit 1;
  if safe_side is not null then
    original_role := 'active';
  elsif coalesce(current_match.reserve_players->'teamA', '[]'::jsonb) ? safe_actor_id then
    safe_side := 'teamA';
    original_role := 'reserve';
  elsif coalesce(current_match.reserve_players->'teamB', '[]'::jsonb) ? safe_actor_id then
    safe_side := 'teamB';
    original_role := 'reserve';
  else
    raise exception 'match_participant_not_found' using errcode = 'P0002';
  end if;

  select coalesce(nullif(profile.name, ''), '참가자') into actor_name
  from public.profiles profile where profile.id = safe_actor_id;

  side_capacity := greatest(1, least(5, case
    when coalesce(current_match.rules->>'sideCapacity', '') ~ '^[1-5]$'
      then (current_match.rules->>'sideCapacity')::integer
    when coalesce(current_match.rules->>'onCourtCount', '') ~ '^[1-5]$'
      then (current_match.rules->>'onCourtCount')::integer
    when coalesce(current_match.mode, '') ~ '^[1-5]v[1-5]$'
      then substring(current_match.mode from '^([1-5])')::integer
    else 5
  end));

  scheduled_at := coalesce(
    nullif(current_match.scheduled_at, '')::timestamptz,
    case when current_match.scheduled_date is not null and current_match.scheduled_time is not null
      then (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul'
      else null end
  );
  checkin_open_at := case when scheduled_at is null then now_at else scheduled_at - (
    case when coalesce((current_match.rules->>'qrAttendanceEnabled')::boolean, false)
      then interval '20 minutes' else interval '10 minutes' end
  ) end;
  checkin_open := coalesce(current_match.rules->>'timingType', '') = 'instant'
    or scheduled_at is null
    or now_at >= checkin_open_at;
  hours_until := case when scheduled_at is null then 0 else extract(epoch from (scheduled_at - now_at)) / 3600 end;
  trust_penalty := case
    when checkin_open then public.rankball_rating_policy_number(
      array['trust', 'participantCancelCheckinPenalty'], 4, 0, 15
    )::integer
    when hours_until <= 4 then public.rankball_rating_policy_number(
      array['trust', 'participantCancelShortNoticePenalty'], 2, 0, 10
    )::integer
    else 0
  end;

  next_reserve_players := jsonb_build_object(
    'teamA', coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements_text(coalesce(current_match.reserve_players->'teamA', '[]'::jsonb)) with ordinality item(value, ordinality)
      where item.value <> safe_actor_id
    ), '[]'::jsonb),
    'teamB', coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements_text(coalesce(current_match.reserve_players->'teamB', '[]'::jsonb)) with ordinality item(value, ordinality)
      where item.value <> safe_actor_id
    ), '[]'::jsonb)
  );
  next_attendance := jsonb_build_object(
    'teamA', coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements_text(coalesce(current_match.attendance->'teamA', '[]'::jsonb)) with ordinality item(value, ordinality)
      where item.value <> safe_actor_id
    ), '[]'::jsonb),
    'teamB', coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements_text(coalesce(current_match.attendance->'teamB', '[]'::jsonb)) with ordinality item(value, ordinality)
      where item.value <> safe_actor_id
    ), '[]'::jsonb)
  );
  next_promoted_reserve_ids := coalesce(current_match.promoted_reserve_ids, jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb));

  delete from public.match_players
  where match_id = safe_match_id and user_id = safe_actor_id;

  if original_role = 'active' then
    select reserve.value into promoted_player_id
    from jsonb_array_elements_text(coalesce(next_reserve_players->safe_side, '[]'::jsonb)) with ordinality reserve(value, ordinality)
    where not checkin_open or exists (
      select 1 from public.match_attendance_entries entry
      where entry.match_id = safe_match_id
        and entry.player_id = reserve.value
        and entry.status in ('on_time', 'late')
    )
    order by reserve.ordinality
    limit 1;

    if promoted_player_id is not null then
      next_reserve_players := jsonb_set(next_reserve_players, array[safe_side], coalesce((
        select jsonb_agg(item.value order by item.ordinality)
        from jsonb_array_elements_text(coalesce(next_reserve_players->safe_side, '[]'::jsonb)) with ordinality item(value, ordinality)
        where item.value <> promoted_player_id
      ), '[]'::jsonb), true);
      select nullif(party_item->>'teamId', '') into promoted_team_id
      from jsonb_array_elements(coalesce(current_match.rules->'parties', '[]'::jsonb)) party_item
      where coalesce(party_item->'players', '[]'::jsonb) ? promoted_player_id
         or coalesce(party_item->'reserves', '[]'::jsonb) ? promoted_player_id
      limit 1;
      promoted_team_id := coalesce(
        promoted_team_id,
        case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end
      );
      insert into public.match_players (match_id, team_id, user_id, side, slot_order)
      values (
        safe_match_id,
        promoted_team_id,
        promoted_player_id,
        safe_side,
        (select count(*) from public.match_players player where player.match_id = safe_match_id and player.side = safe_side)
      );
      next_promoted_reserve_ids := jsonb_set(
        next_promoted_reserve_ids,
        array[safe_side],
        coalesce(next_promoted_reserve_ids->safe_side, '[]'::jsonb) || to_jsonb(promoted_player_id),
        true
      );
    end if;
  end if;

  for party in select item.value from jsonb_array_elements(coalesce(current_match.rules->'parties', '[]'::jsonb)) item(value)
  loop
    party_players := coalesce((
      select jsonb_agg(player.value order by player.ordinality)
      from jsonb_array_elements_text(coalesce(party->'players', '[]'::jsonb)) with ordinality player(value, ordinality)
      where player.value <> safe_actor_id and player.value <> coalesce(promoted_player_id, '')
    ), '[]'::jsonb);
    party_reserves := coalesce((
      select jsonb_agg(player.value order by player.ordinality)
      from jsonb_array_elements_text(coalesce(party->'reserves', '[]'::jsonb)) with ordinality player(value, ordinality)
      where player.value <> safe_actor_id and player.value <> coalesce(promoted_player_id, '')
    ), '[]'::jsonb);
    if promoted_player_id is not null and (
      coalesce(party->'players', '[]'::jsonb) ? promoted_player_id
      or coalesce(party->'reserves', '[]'::jsonb) ? promoted_player_id
    ) then
      party_players := party_players || to_jsonb(promoted_player_id);
    end if;
    party_roster := party_players || party_reserves;
    if jsonb_array_length(party_roster) > 0 then
      party_leader := coalesce(nullif(party->>'partyLeaderId', ''), nullif(party->>'leaderId', ''), nullif(party->>'playerId', ''));
      if party_leader is null or not party_roster ? party_leader then
        party_leader := party_roster->>0;
      end if;
      next_parties := next_parties || jsonb_build_array(
        (party - 'players' - 'reserves' - 'partyLeaderId') || jsonb_build_object(
          'players', party_players,
          'reserves', party_reserves,
          'partyLeaderId', party_leader,
          'reserve', coalesce((party->>'reserve')::boolean, false) and jsonb_array_length(party_players) = 0
        )
      );
    end if;
  end loop;

  select count(*) into active_count from public.match_players where match_id = safe_match_id and side = 'teamA';
  shortage_a := active_count < side_capacity;
  select count(*) into active_count from public.match_players where match_id = safe_match_id and side = 'teamB';
  shortage_b := active_count < side_capacity;
  shortage_sides := case
    when shortage_a and shortage_b then jsonb_build_array('teamA', 'teamB')
    when shortage_a then jsonb_build_array('teamA')
    when shortage_b then jsonb_build_array('teamB')
    else '[]'::jsonb
  end;

  next_rules := coalesce(current_match.rules, '{}'::jsonb) || jsonb_build_object(
    'parties', next_parties,
    'rosterNeedsFill', shortage_a or shortage_b,
    'rosterNeedsFillSides', shortage_sides,
    'participationCancelledIds', coalesce(current_match.rules->'participationCancelledIds', '[]'::jsonb) || to_jsonb(safe_actor_id),
    'ruleAcknowledgedIds', coalesce((
      select jsonb_agg(item.value order by item.ordinality)
      from jsonb_array_elements_text(coalesce(current_match.rules->'ruleAcknowledgedIds', '[]'::jsonb)) with ordinality item(value, ordinality)
      where item.value <> safe_actor_id
    ), '[]'::jsonb),
    'lastParticipationCancellation', jsonb_build_object(
      'playerId', safe_actor_id,
      'side', safe_side,
      'reason', safe_reason,
      'trustPenalty', trust_penalty,
      'cancelledAt', now_at
    )
  );
  if coalesce(current_match.rules->>'formationMode', '') = 'pickup'
     or coalesce(current_match.rules->>'matchIntent', '') = 'pickup' then
    next_rules := next_rules || jsonb_build_object(
      'sideAssignmentStatus', 'draft',
      'sideAssignmentConfirmedAt', null,
      'sideAssignmentConfirmedBy', null
    );
  end if;

  update public.matches
  set reserve_players = next_reserve_players,
      promoted_reserve_ids = next_promoted_reserve_ids,
      attendance = next_attendance,
      status = 'agreed',
      agreed_at = null,
      rules = next_rules,
      updated_at = now_at
  where id = safe_match_id;

  delete from public.match_agreements where match_id = safe_match_id and user_id = safe_actor_id;
  delete from public.match_approvals where match_id = safe_match_id and user_id = safe_actor_id;
  delete from public.match_attendance_entries where match_id = safe_match_id and player_id = safe_actor_id;

  if trust_penalty > 0 then
    update public.profiles
    set trust_score = greatest(0, coalesce(trust_score, 80) - trust_penalty),
        updated_at = now_at
    where id = safe_actor_id;
  end if;

  insert into public.match_participation_cancellations (
    id, match_id, player_id, side, original_role, reason, trust_penalty,
    promoted_player_id, roster_needs_fill, created_at
  ) values (
    event_id, safe_match_id, safe_actor_id, safe_side, original_role, safe_reason,
    trust_penalty, promoted_player_id, shortage_a or shortage_b, now_at
  );

  select coalesce(array_agg(distinct recipient_id), array[]::text[])
  into notification_target_ids
  from (
    select safe_actor_id as recipient_id
    union all select current_match.created_by
    union all select current_match.referee_id
    union all select player.user_id from public.match_players player
      where player.match_id = safe_match_id and player.side = safe_side
    union all select reserve.value from jsonb_array_elements_text(coalesce(next_reserve_players->safe_side, '[]'::jsonb)) reserve(value)
  ) recipients
  where nullif(btrim(recipient_id), '') is not null;

  notification_prefix := 'match-participation-cancelled-' || event_id::text;
  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type,
    match_id, payload, created_at, updated_at
  )
  select
    'notice-' || notification_prefix || '-' || safe_match_id || '-' || recipient_id,
    recipient_id,
    recipient_id,
    case when recipient_id = safe_actor_id then '참가 취소 완료' else '확정 경기 참가 취소' end,
    case
      when recipient_id = safe_actor_id and trust_penalty > 0
        then '확정 경기 참가를 취소해 신뢰도 ' || trust_penalty::text || '점이 감소했습니다.'
      when shortage_a or shortage_b
        then actor_name || '님이 참가를 취소했습니다. 출전 인원을 보충해 주세요.'
      else actor_name || '님이 참가를 취소했습니다. 변경된 명단을 확인해 주세요.'
    end,
    case when shortage_a or shortage_b then 'orange' else 'match' end,
    'match_participation_cancelled',
    safe_match_id,
    jsonb_build_object(
      'matchId', safe_match_id,
      'targetUserId', recipient_id,
      'cancelledPlayerId', safe_actor_id,
      'side', safe_side,
      'trustPenalty', trust_penalty,
      'promotedPlayerId', promoted_player_id,
      'rosterNeedsFill', shortage_a or shortage_b,
      'actionRequired', recipient_id = current_match.created_by and (shortage_a or shortage_b),
      'homeAction', recipient_id = current_match.created_by and (shortage_a or shortage_b),
      'skipDiscordSync', true
    ),
    now_at,
    now_at
  from unnest(notification_target_ids) recipient(recipient_id)
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'action', 'cancelMatchParticipation',
    'matchId', safe_match_id,
    'eventId', event_id,
    'actorProfileId', safe_actor_id,
    'actorName', actor_name,
    'side', safe_side,
    'originalRole', original_role,
    'trustPenalty', trust_penalty,
    'promotedPlayerId', promoted_player_id,
    'rosterNeedsFill', shortage_a or shortage_b,
    'rosterNeedsFillSides', shortage_sides,
    'notificationTargetIds', to_jsonb(notification_target_ids),
    'sqlReducer', true
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_match_terminal_action_pre_participation_shortage(text,text,text,text)') is null then
    alter function public.rankball_match_terminal_action(text, text, text, text)
      rename to rankball_match_terminal_action_pre_participation_shortage;
  end if;
end;
$$;

create or replace function public.rankball_match_terminal_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_reason text := nullif(btrim(p_reason), '');
  current_match public.matches%rowtype;
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  if nullif(btrim(p_action), '') <> 'cancelMatch' then
    return public.rankball_match_terminal_action_pre_participation_shortage(
      p_actor_profile_id, p_action, p_match_id, p_reason
    );
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if coalesce((current_match.rules->>'rosterNeedsFill')::boolean, false) is not true then
    return public.rankball_match_terminal_action_pre_participation_shortage(
      p_actor_profile_id, p_action, p_match_id, p_reason
    );
  end if;
  if safe_reason is null or char_length(safe_reason) < 5 or char_length(safe_reason) > 200 then
    raise exception 'match_cancellation_reason_required' using errcode = '22023';
  end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_cancel_permission_denied' using errcode = '42501';
  end if;

  result := public.rankball_match_terminal_action_pre_cancel_policy(
    safe_actor_id, 'cancelMatch', safe_match_id, safe_reason
  );
  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'cancellationReason', safe_reason,
        'cancelledBy', safe_actor_id,
        'cancelPenalty', 0,
        'cancelPenaltyWaived', true,
        'cancelWaiverReason', 'participant_shortage'
      ),
      updated_at = now_at
  where id = safe_match_id and status = 'cancelled';

  update public.notifications
  set body = body || E'\n취소 사유: ' || safe_reason,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('cancellationReason', safe_reason),
      updated_at = now_at
  where match_id = safe_match_id
    and type = 'match_cancelled'
    and position('취소 사유:' in coalesce(body, '')) = 0;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    discord_event, read_at, payload, created_at, updated_at
  )
  select
    'notice-match-cancelled-' || safe_match_id || '-' || cancelled_player.profile_id,
    cancelled_player.profile_id,
    cancelled_player.profile_id,
    '경기 취소',
    format('%s 경기방이 취소됐습니다.%s취소 사유: %s', current_match.title, E'\n', safe_reason),
    'match',
    'match_cancelled',
    safe_match_id,
    'match',
    null,
    jsonb_build_object(
      'matchId', safe_match_id,
      'targetUserId', cancelled_player.profile_id,
      'targetStatus', 'cancelled',
      'targetUnavailable', true,
      'action', 'cancelMatch',
      'actionRequired', false,
      'homeAction', false,
      'skipDiscordSync', true,
      'source', 'participant_shortage_cancel'
    ),
    now_at,
    now_at
  from (
    select distinct value as profile_id
    from jsonb_array_elements_text(coalesce(current_match.rules->'participationCancelledIds', '[]'::jsonb)) item(value)
  ) cancelled_player
  where nullif(btrim(cancelled_player.profile_id), '') is not null
  on conflict (id) do update
  set body = excluded.body,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'cancellationReason', safe_reason,
    'penalty', 0,
    'penaltyWaived', true,
    'waiverReason', 'participant_shortage'
  );
end;
$$;

revoke all on function public.rankball_default_rating_policy_pre_participation_cancel() from public, anon, authenticated, service_role;
revoke all on function public.rankball_normalize_rating_policy_pre_participation_cancel(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_default_rating_policy() from public, anon, authenticated;
revoke all on function public.rankball_normalize_rating_policy(jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_participation_cancel_action(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_terminal_action_pre_participation_shortage(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_terminal_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_default_rating_policy() to service_role;
grant execute on function public.rankball_normalize_rating_policy(jsonb) to service_role;
grant execute on function public.rankball_match_participation_cancel_action(text, text, text) to service_role;
grant execute on function public.rankball_match_terminal_action(text, text, text, text) to service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values ('general', 'rankball_match_participation_cancel_action', 'rankball_match_participation_cancel_action', 'public.rankball_match_participation_cancel_action(text,text,text)', 'active', true)
on conflict (contract_scope, contract_name) do update set
  function_name = excluded.function_name,
  signature = excluded.signature,
  lifecycle = excluded.lifecycle,
  service_role_execute = excluded.service_role_execute,
  updated_at = clock_timestamp();

select pg_notify('pgrst', 'reload schema');

commit;
