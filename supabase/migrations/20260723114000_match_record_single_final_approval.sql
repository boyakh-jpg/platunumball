-- 사후 기록방의 최종 승인은 본인 참가 사실과 결과 확인을 한 번에 처리한다.

do $migration$
declare
  function_definition text;
  next_function_definition text;
  participation_guard text;
  roster_definition text;
  roster_old_text text;
  roster_new_text text;
begin
  select pg_get_functiondef(
    'public.rankball_match_approval_action(text,text,text,text)'::regprocedure
  ) into function_definition;

  participation_guard := $guard$if not coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb) ? safe_player_id then
    raise exception 'match_record_participation_required' using errcode = '23514';
  end if;
  $guard$;

  if position(participation_guard in function_definition) > 0 then
    execute replace(function_definition, participation_guard, '');
  elsif position('match_record_participation_required' in function_definition) > 0 then
    next_function_definition := regexp_replace(
      function_definition,
      E'[[:space:]]*if[[:space:]][^;]*then[[:space:]]*raise exception ''match_record_participation_required''[^;]*;[[:space:]]*end if;[[:space:]]*',
      E'\n'
    );
    if next_function_definition = function_definition
       or position('match_record_participation_required' in next_function_definition) > 0 then
      raise exception 'match_record_single_approval_shape_changed';
    end if;
    execute next_function_definition;
  end if;

  select pg_get_functiondef(
    'public.rankball_match_record_team_roster_action(text,text,jsonb)'::regprocedure
  ) into roster_definition;

  roster_old_text := $old$'recordSetupReady', record_setup_ready,
      'playedPlayerIds',$old$;
  roster_new_text := $new$'recordSetupReady', record_setup_ready,
      'recordApprovalMode', jsonb_build_object('teamA', 'all', 'teamB', 'all'),
      'recordApproverIds', coalesce(match_row.rules->'recordApproverIds', '{}'::jsonb)
        || jsonb_build_object(safe_side, requested_active),
      'participantAcceptedIds', '[]'::jsonb,
      'playedPlayerIds',$new$;

  if position(roster_old_text in roster_definition) > 0 then
    execute replace(roster_definition, roster_old_text, roster_new_text);
  elsif position('''recordApproverIds''' in roster_definition) = 0
        or position('jsonb_build_object(safe_side, requested_active)' in roster_definition) = 0 then
    raise exception 'match_record_roster_approver_shape_changed';
  end if;
end;
$migration$;

update public.matches match_row
set rules = coalesce(match_row.rules, '{}'::jsonb) || jsonb_build_object(
  'recordApprovalMode', jsonb_build_object('teamA', 'all', 'teamB', 'all'),
  'recordApproverIds', jsonb_build_object(
    'teamA', coalesce((
      select jsonb_agg(player.user_id order by player.slot_order)
      from public.match_players player
      where player.match_id = match_row.id
        and player.side = 'teamA'
        and nullif(btrim(player.user_id), '') is not null
    ), '[]'::jsonb),
    'teamB', coalesce((
      select jsonb_agg(player.user_id order by player.slot_order)
      from public.match_players player
      where player.match_id = match_row.id
        and player.side = 'teamB'
        and nullif(btrim(player.user_id), '') is not null
    ), '[]'::jsonb)
  )
)
where match_row.rules->>'recordType' = 'match_record'
  and match_row.rules->>'recordSetupReady' = 'true'
  and match_row.confirmed_at is null
  and match_row.cancelled_at is null
  and match_row.voided_at is null;

select pg_notify('pgrst', 'reload schema');
