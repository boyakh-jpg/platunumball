-- Persist match-record team rosters with the same readiness rules as the server reducer.

create or replace function public.rankball_match_record_team_roster_action(
  p_actor_profile_id text,
  p_match_id text,
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
  safe_side text := case when p_payload->>'sideName' = 'teamB' then 'teamB' else 'teamA' end;
  other_side text;
  side_team_id text;
  leader_id text;
  side_capacity integer;
  requested_active jsonb := '[]'::jsonb;
  requested_count integer := 0;
  previous_active jsonb := '[]'::jsonb;
  other_side_ready boolean := false;
  record_setup_ready boolean := false;
  current_match public.matches%rowtype;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  if jsonb_array_length(
    case when jsonb_typeof(p_payload #> '{roster,reservePlayerIds}') = 'array'
      then p_payload #> '{roster,reservePlayerIds}' else '[]'::jsonb end
  ) > 0 then
    raise exception 'match_record_reserve_not_allowed' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if coalesce(current_match.rules->>'recordType', '') <> 'match_record'
     or coalesce(current_match.rules->>'recordComposition', '') <> 'team' then
    raise exception 'match_record_team_room_required' using errcode = '23514';
  end if;
  if current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or current_match.confirmed_at is not null
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_room_edit_locked' using errcode = '23514';
  end if;

  other_side := case when safe_side = 'teamA' then 'teamB' else 'teamA' end;
  side_team_id := case when safe_side = 'teamA' then current_match.team_a_id else current_match.team_b_id end;
  if side_team_id is null then
    raise exception 'match_record_team_missing' using errcode = '23514';
  end if;

  select member.user_id into leader_id
  from public.team_members member
  where member.team_id = side_team_id and member.role = 'captain'
  order by member.user_id
  limit 1;
  if leader_id is null or leader_id <> safe_actor_id then
    raise exception 'match_side_captain_required' using errcode = '42501';
  end if;

  side_capacity := greatest(1, least(5, coalesce(
    nullif(current_match.rules->>'sideCapacity', '')::integer,
    nullif(substring(current_match.mode from '^[0-9]+'), '')::integer,
    5
  )));
  select
    coalesce(jsonb_agg(selected.user_id order by selected.first_order), '[]'::jsonb),
    count(*)
  into requested_active, requested_count
  from (
    select candidate.user_id, min(candidate.ordinality) as first_order
    from jsonb_array_elements_text(
      case when jsonb_typeof(p_payload #> '{roster,playerIds}') = 'array'
        then p_payload #> '{roster,playerIds}' else '[]'::jsonb end
    ) with ordinality candidate(user_id, ordinality)
    where exists (
      select 1 from public.team_members member
      where member.team_id = side_team_id and member.user_id = candidate.user_id
    )
      and not exists (
        select 1 from public.match_players player
        where player.match_id = safe_match_id
          and player.side = other_side
          and player.user_id = candidate.user_id
      )
      and not (
        case when jsonb_typeof(current_match.reserve_players->other_side) = 'array'
          then current_match.reserve_players->other_side else '[]'::jsonb end
      ) ? candidate.user_id
    group by candidate.user_id
  ) selected;

  if requested_count <> side_capacity then
    raise exception 'match_record_roster_exact_capacity_required' using errcode = '23514';
  end if;
  if not requested_active ? leader_id then
    raise exception 'match_side_leader_required' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(player.user_id), '[]'::jsonb)
  into previous_active
  from public.match_players player
  where player.match_id = safe_match_id and player.side = safe_side;

  delete from public.match_players
  where match_id = safe_match_id and side = safe_side;
  insert into public.match_players (match_id, team_id, user_id, side, slot_order)
  select safe_match_id, side_team_id, player.user_id, safe_side, player.ordinality::integer - 1
  from jsonb_array_elements_text(requested_active) with ordinality player(user_id, ordinality);

  other_side_ready := coalesce(current_match.rules #>> array['rosterReady', other_side], 'false') = 'true';
  record_setup_ready := other_side_ready;
  update public.matches match_row
  set
    played_player_ids = coalesce(match_row.played_player_ids, '{}'::jsonb)
      || jsonb_build_object(safe_side, requested_active),
    reserve_players = coalesce(match_row.reserve_players, '{}'::jsonb)
      || jsonb_build_object(safe_side, '[]'::jsonb),
    rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
      'rosterReady', coalesce(match_row.rules->'rosterReady', '{}'::jsonb) || jsonb_build_object(safe_side, true),
      'rosterReadyAt', coalesce(match_row.rules->'rosterReadyAt', '{}'::jsonb) || jsonb_build_object(safe_side, now_at),
      'recordSetupReady', record_setup_ready,
      'playedPlayerIds', coalesce(match_row.rules->'playedPlayerIds', '{}'::jsonb) || jsonb_build_object(safe_side, requested_active),
      'reservePlayers', coalesce(match_row.rules->'reservePlayers', '{}'::jsonb) || jsonb_build_object(safe_side, '[]'::jsonb)
    ),
    updated_at = now_at
  where match_row.id = safe_match_id;

  delete from public.match_approvals
  where match_id = safe_match_id and side = safe_side;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
  )
  select
    'n_' || md5('match-record-roster:' || safe_match_id || ':' || safe_side || ':' || player.user_id || ':' || now_at::text),
    player.user_id,
    player.user_id,
    '팀 경기 기록 명단',
    current_match.title || ' ' || case when safe_side = 'teamA' then 'A사이드' else 'B사이드' end || ' 출전 명단에 등록됐습니다. 기록을 확인해 주세요.',
    'match',
    'match_record_roster',
    safe_match_id,
    jsonb_build_object(
      'matchId', safe_match_id,
      'discordEvent', 'match',
      'webPath', '/app/recorder?match=' || safe_match_id
    ),
    now_at,
    now_at
  from jsonb_array_elements_text(requested_active) player(user_id)
  where player.user_id <> safe_actor_id and not (previous_active ? player.user_id)
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'action', 'setMatchRecordTeamRoster',
    'matchId', safe_match_id,
    'sideName', safe_side,
    'rosterReady', true,
    'recordSetupReady', record_setup_ready,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_record_team_roster_action(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_match_record_team_roster_action(text, text, jsonb)
to service_role;

create or replace function public.rankball_match_team_roster_action(
  p_actor_profile_id text,
  p_match_id text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_id text;
  record_type text;
begin
  select match_row.tournament_id, match_row.rules->>'recordType'
  into tournament_id, record_type
  from public.matches match_row
  where match_row.id = nullif(btrim(p_match_id), '');

  if tournament_id is not null then
    return public.rankball_tournament_match_roster_action(p_actor_profile_id, p_match_id, p_payload);
  end if;
  if record_type = 'match_record' then
    return public.rankball_match_record_team_roster_action(p_actor_profile_id, p_match_id, p_payload);
  end if;
  return public.rankball_match_room_action(p_actor_profile_id, p_match_id, 'setMatchRecordTeamRoster', p_payload);
end;
$$;

revoke all on function public.rankball_match_team_roster_action(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_match_team_roster_action(text, text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');
