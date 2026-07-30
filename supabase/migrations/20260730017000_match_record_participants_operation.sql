begin;

create or replace function public.rankball_match_record_participants_action(
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
  requested_composition text := nullif(btrim(p_payload->>'composition'), '');
  current_composition text;
  current_match public.matches%rowtype;
  side_capacity integer;
  team_a_player_ids jsonb := '[]'::jsonb;
  team_b_player_ids jsonb := '[]'::jsonb;
  target_ids jsonb := '[]'::jsonb;
  team_a_id text;
  team_b_id text;
  team_a_captain_id text;
  team_b_captain_id text;
  setup_ready boolean := false;
  notification_title text;
  notification_body text;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) <> 'match_record' then
    raise exception 'match_record_room_required' using errcode = '23514';
  end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_record_host_required' using errcode = '42501';
  end if;
  if current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null
     or current_match.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or exists (
       select 1
       from public.match_results result
       where result.match_id = safe_match_id
     ) then
    raise exception 'match_record_setup_locked' using errcode = '23514';
  end if;
  if coalesce(current_match.rules->>'recordSetupReady', 'false') = 'true' then
    raise exception 'match_record_roster_locked' using errcode = '23514';
  end if;

  current_composition := case
    when current_match.rules->>'recordComposition' = 'team' then 'team'
    else 'individual'
  end;
  if requested_composition not in ('individual', 'team')
     or requested_composition <> current_composition then
    raise exception 'match_record_composition_invalid' using errcode = '22023';
  end if;

  side_capacity := greatest(1, least(5, coalesce(
    nullif(current_match.rules->>'sideCapacity', '')::integer,
    nullif(substring(current_match.mode from '^[0-9]+'), '')::integer,
    5
  )));

  if current_composition = 'individual' then
    select coalesce(
      jsonb_agg(selected.player_id order by selected.first_order),
      '[]'::jsonb
    )
    into team_a_player_ids
    from (
      select candidate.player_id, min(candidate.ordinality)::integer as first_order
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(p_payload->'teamAPlayerIds') = 'array'
            then p_payload->'teamAPlayerIds'
          else '[]'::jsonb
        end
      ) with ordinality candidate(player_id, ordinality)
      where exists (
        select 1
        from public.profiles profile
        where profile.id = candidate.player_id
      )
      group by candidate.player_id
    ) selected;

    select coalesce(
      jsonb_agg(selected.player_id order by selected.first_order),
      '[]'::jsonb
    )
    into team_b_player_ids
    from (
      select candidate.player_id, min(candidate.ordinality)::integer as first_order
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(p_payload->'teamBPlayerIds') = 'array'
            then p_payload->'teamBPlayerIds'
          else '[]'::jsonb
        end
      ) with ordinality candidate(player_id, ordinality)
      where exists (
        select 1
        from public.profiles profile
        where profile.id = candidate.player_id
      )
      group by candidate.player_id
    ) selected;

    if jsonb_array_length(team_a_player_ids) <> side_capacity
       or jsonb_array_length(team_b_player_ids) <> side_capacity then
      raise exception 'match_record_roster_exact_capacity_required'
        using errcode = '23514';
    end if;
    if not team_a_player_ids ? safe_actor_id then
      raise exception 'match_record_host_side_required' using errcode = '42501';
    end if;
    if exists (
      select 1
      from jsonb_array_elements_text(team_a_player_ids) player(player_id)
      where team_b_player_ids ? player.player_id
    ) then
      raise exception 'match_roster_cross_side_duplicate' using errcode = '23514';
    end if;

    target_ids := team_a_player_ids || team_b_player_ids;
    setup_ready := true;

    delete from public.match_players
    where match_id = safe_match_id;
    insert into public.match_players (
      match_id,
      team_id,
      user_id,
      side,
      slot_order
    )
    select
      safe_match_id,
      null,
      player.player_id,
      'teamA',
      player.ordinality::integer - 1
    from jsonb_array_elements_text(team_a_player_ids)
      with ordinality player(player_id, ordinality)
    union all
    select
      safe_match_id,
      null,
      player.player_id,
      'teamB',
      player.ordinality::integer - 1
    from jsonb_array_elements_text(team_b_player_ids)
      with ordinality player(player_id, ordinality);
  else
    team_a_id := nullif(btrim(p_payload->>'teamAId'), '');
    team_b_id := nullif(btrim(p_payload->>'teamBId'), '');
    if team_a_id is null
       or team_b_id is null
       or team_a_id = team_b_id
       or not exists (
         select 1
         from public.teams team
         where team.id = team_a_id
           and team.deleted_at is null
       )
       or not exists (
         select 1
         from public.teams team
         where team.id = team_b_id
           and team.deleted_at is null
       ) then
      raise exception 'match_record_team_invalid' using errcode = '23514';
    end if;
    if not exists (
      select 1
      from public.team_members member
      where member.team_id = team_a_id
        and member.user_id = safe_actor_id
    ) then
      raise exception 'match_record_team_member_required' using errcode = '42501';
    end if;

    select member.user_id
    into team_a_captain_id
    from public.team_members member
    where member.team_id = team_a_id
      and member.role = 'captain'
    order by member.user_id
    limit 1;
    select member.user_id
    into team_b_captain_id
    from public.team_members member
    where member.team_id = team_b_id
      and member.role = 'captain'
    order by member.user_id
    limit 1;
    if team_a_captain_id is null
       or team_b_captain_id is null
       or team_a_captain_id = team_b_captain_id then
      raise exception 'match_record_team_captain_required' using errcode = '23514';
    end if;

    team_a_player_ids := jsonb_build_array(team_a_captain_id);
    team_b_player_ids := jsonb_build_array(team_b_captain_id);
    target_ids := team_a_player_ids || team_b_player_ids;

    delete from public.match_players
    where match_id = safe_match_id;
    insert into public.match_players (
      match_id,
      team_id,
      user_id,
      side,
      slot_order
    )
    values
      (safe_match_id, team_a_id, team_a_captain_id, 'teamA', 0),
      (safe_match_id, team_b_id, team_b_captain_id, 'teamB', 0);
  end if;

  delete from public.match_agreements
  where match_id = safe_match_id;
  insert into public.match_agreements (match_id, user_id, side)
  select safe_match_id, player.player_id, 'teamA'
  from jsonb_array_elements_text(team_a_player_ids) player(player_id)
  union all
  select safe_match_id, player.player_id, 'teamB'
  from jsonb_array_elements_text(team_b_player_ids) player(player_id);

  delete from public.match_approvals
  where match_id = safe_match_id;

  update public.matches match_row
  set team_a_id = case
        when current_composition = 'team' then team_a_id
        else null
      end,
      team_b_id = case
        when current_composition = 'team' then team_b_id
        else null
      end,
      played_player_ids = case
        when current_composition = 'individual'
          then jsonb_build_object(
            'teamA', team_a_player_ids,
            'teamB', team_b_player_ids
          )
        else jsonb_build_object('teamA', '[]'::jsonb, 'teamB', '[]'::jsonb)
      end,
      reserve_players = jsonb_build_object(
        'teamA', '[]'::jsonb,
        'teamB', '[]'::jsonb
      ),
      rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
        'recordSetupReady', setup_ready,
        'recordApprovalMode', jsonb_build_object(
          'teamA', 'all',
          'teamB', 'all'
        ),
        'recordApproverIds', case
          when current_composition = 'individual'
            then jsonb_build_object(
              'teamA', team_a_player_ids,
              'teamB', team_b_player_ids
            )
          else jsonb_build_object(
            'teamA', '[]'::jsonb,
            'teamB', '[]'::jsonb
          )
        end,
        'participantAcceptedIds', '[]'::jsonb,
        'rosterReady', jsonb_build_object(
          'teamA', setup_ready,
          'teamB', setup_ready
        ),
        'playedPlayerIds', case
          when current_composition = 'individual'
            then jsonb_build_object(
              'teamA', team_a_player_ids,
              'teamB', team_b_player_ids
            )
          else jsonb_build_object(
            'teamA', '[]'::jsonb,
            'teamB', '[]'::jsonb
          )
        end,
        'reservePlayers', jsonb_build_object(
          'teamA', '[]'::jsonb,
          'teamB', '[]'::jsonb
        )
      ),
      updated_at = now_at
  where match_row.id = safe_match_id;

  notification_title := case
    when current_composition = 'team' then '팀 경기 기록 확인'
    else '경기 기록 확인 요청'
  end;
  notification_body := case
    when current_composition = 'team'
      then current_match.title || ' 경기 기록의 팀 명단을 확인해 주세요.'
    else current_match.title
      || ' 경기 기록에 참가자로 등록됐습니다. 기록 입력 후 최종 확인이 필요합니다.'
  end;

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'stale', true,
        'actionRequired', false,
        'homeAction', false
      ),
      updated_at = now_at
  where match_id = safe_match_id
    and type = 'match_record_setup';

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    match_id,
    discord_event,
    read_at,
    payload,
    created_at,
    updated_at
  )
  select
    'match-record-setup-' || substr(
      md5(safe_match_id || ':' || player.player_id),
      1,
      24
    ),
    player.player_id,
    player.player_id,
    notification_title,
    notification_body,
    'match',
    'match_record_setup',
    safe_match_id,
    'match',
    null,
    jsonb_build_object(
      'targetUserId', player.player_id,
      'fromUserId', safe_actor_id,
      'matchId', safe_match_id,
      'discordEvent', 'match',
      'actionRequired', true,
      'homeAction', true,
      'webPath', '/app/recorder?match=' || safe_match_id
    ),
    now_at,
    now_at
  from jsonb_array_elements_text(target_ids) player(player_id)
  where player.player_id <> safe_actor_id
  on conflict (id) do update
  set title = excluded.title,
      body = excluded.body,
      discord_event = excluded.discord_event,
      read_at = null,
      payload = excluded.payload,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'action', 'setMatchRecordParticipants',
    'matchId', safe_match_id,
    'composition', current_composition,
    'recordSetupReady', setup_ready,
    'teamAPlayerCount', jsonb_array_length(team_a_player_ids),
    'teamBPlayerCount', jsonb_array_length(team_b_player_ids),
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  ('general', 'rankball_match_record_participants_action', 'rankball_match_record_participants_action', 'public.rankball_match_record_participants_action(text,text,jsonb)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

revoke all on function public.rankball_match_record_participants_action(
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.rankball_match_record_participants_action(
  text,
  text,
  jsonb
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
