-- 사후 기록방 참가자는 본인 확인 후에만 결과를 승인할 수 있다.

create or replace function public.rankball_match_record_participation_action(
  p_actor_profile_id text,
  p_match_id text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  current_match public.matches%rowtype;
  accepted_ids jsonb;
begin
  if safe_actor_id is null or safe_actor_id <> safe_player_id then
    raise exception 'match_record_participation_actor_mismatch' using errcode = '42501';
  end if;

  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));

  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.rules->>'recordType' <> 'match_record'
     or current_match.rules->>'recordSetupReady' <> 'true'
     or current_match.status not in ('agreed', 'approval')
     or current_match.confirmed_at is not null
     or current_match.cancelled_at is not null
     or current_match.voided_at is not null then
    raise exception 'match_record_participation_locked' using errcode = '23514';
  end if;
  if not (
    coalesce(current_match.rules #> '{recordApproverIds,teamA}', '[]'::jsonb) ? safe_player_id
    or coalesce(current_match.rules #> '{recordApproverIds,teamB}', '[]'::jsonb) ? safe_player_id
  ) then
    raise exception 'match_record_participation_not_required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
  into accepted_ids
  from (
    select distinct value
    from jsonb_array_elements_text(
      coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb) || jsonb_build_array(safe_player_id)
    ) accepted(value)
    where nullif(btrim(value), '') is not null
  ) unique_ids;

  update public.matches
  set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{participantAcceptedIds}', accepted_ids, true),
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'confirmMatchRecordParticipation',
    'matchId', safe_match_id,
    'playerId', safe_player_id,
    'sqlReducer', true
  );
end;
$$;

revoke all on function public.rankball_match_record_participation_action(text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_record_participation_action(text, text, text)
to service_role;

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef(
    'public.rankball_match_approval_action(text,text,text,text)'::regprocedure
  ) into function_definition;

  old_text := $old$if current_match.rules->>'recordSetupReady' <> 'true' then
    raise exception 'match_record_setup_required' using errcode = '23514';
  end if;

  with actual_players as ($old$;

  new_text := $new$if current_match.rules->>'recordSetupReady' <> 'true' then
    raise exception 'match_record_setup_required' using errcode = '23514';
  end if;
  if not coalesce(current_match.rules->'participantAcceptedIds', '[]'::jsonb) ? safe_player_id then
    raise exception 'match_record_participation_required' using errcode = '23514';
  end if;

  with actual_players as ($new$;

  if position(old_text in function_definition) = 0 then
    raise exception 'match_record_approval_participation_shape_changed';
  end if;

  execute replace(function_definition, old_text, new_text);
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_rules text;
  new_rules text;
  old_approvals text;
  new_approvals text;
begin
  select pg_get_functiondef(
    'public.rankball_match_record_team_roster_action(text,text,jsonb)'::regprocedure
  ) into function_definition;

  old_rules := $old$'reservePlayers', coalesce(match_row.rules->'reservePlayers', '{}'::jsonb) || jsonb_build_object(safe_side, '[]'::jsonb)
    )$old$;
  new_rules := $new$'reservePlayers', coalesce(match_row.rules->'reservePlayers', '{}'::jsonb) || jsonb_build_object(safe_side, '[]'::jsonb),
      'participantAcceptedIds', '[]'::jsonb
    )$new$;
  old_approvals := $old$delete from public.match_approvals
  where match_id = safe_match_id and side = safe_side;$old$;
  new_approvals := $new$delete from public.match_approvals
  where match_id = safe_match_id;$new$;

  if position(old_rules in function_definition) = 0
     or position(old_approvals in function_definition) = 0 then
    raise exception 'match_record_roster_participation_shape_changed';
  end if;

  execute replace(replace(function_definition, old_rules, new_rules), old_approvals, new_approvals);
end;
$migration$;

select pg_notify('pgrst', 'reload schema');
