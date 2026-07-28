begin;

create or replace function public.rankball_match_clock_controller_eligible(
  p_match_id text,
  p_profile_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.match_players player
    where player.match_id = nullif(btrim(p_match_id), '')
      and player.user_id = nullif(btrim(p_profile_id), '')
  )
  or exists (
    select 1
    from public.matches match_row
    where match_row.id = nullif(btrim(p_match_id), '')
      and (
        (
          case
            when jsonb_typeof(match_row.reserve_players->'teamA') = 'array'
              then match_row.reserve_players->'teamA'
            else '[]'::jsonb
          end
        ) ? nullif(btrim(p_profile_id), '')
        or (
          case
            when jsonb_typeof(match_row.reserve_players->'teamB') = 'array'
              then match_row.reserve_players->'teamB'
            else '[]'::jsonb
          end
        ) ? nullif(btrim(p_profile_id), '')
        or (
          nullif(btrim(match_row.referee_id), '') = nullif(btrim(p_profile_id), '')
          and public.rankball_is_match_referee_eligible(p_profile_id, p_match_id)
        )
      )
  );
$$;

do $migration$
declare
  function_definition text;
  old_text text := $old$    if target_controller_id is null or not exists (
      select 1 from public.match_players player
      where player.match_id = safe_match_id and player.user_id = target_controller_id
    ) then$old$;
  new_text text := $new$    if target_controller_id is null
       or not public.rankball_match_clock_controller_eligible(safe_match_id, target_controller_id) then$new$;
begin
  if to_regprocedure(
    'public.rankball_match_clock_action_pre_optional_clock(text,text,text,jsonb)'
  ) is null then
    raise exception 'match_clock_action_core_missing' using errcode = '55000';
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_match_clock_action_pre_optional_clock(text,text,text,jsonb)'::regprocedure
  );
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'match_clock_controller_policy_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_text, new_text);
  end if;
end;
$migration$;

alter table public.match_score_events
  drop constraint if exists match_score_events_authority_scope_check;
alter table public.match_score_events
  add constraint match_score_events_authority_scope_check
  check (authority_scope in (
    'host',
    'referee',
    'clock_controller',
    'side_recorder',
    'dual_side_recorder'
  )) not valid;
alter table public.match_score_events
  validate constraint match_score_events_authority_scope_check;

do $migration$
declare
  function_definition text;
  old_declarations text := $old$  recorder_a text;
  recorder_b text;$old$;
  new_declarations text := $new$  recorder_a text;
  recorder_b text;
  clock_controller_id text;
  game_clock_enabled boolean := true;$new$;
  old_authorization text := $old$  recorder_a := public.rankball_match_effective_recorder_id(safe_match_id, 'teamA');
  recorder_b := public.rankball_match_effective_recorder_id(safe_match_id, 'teamB');
  if (current_match.dual_score_recorder_side = 'teamA' and recorder_b is not null)
     or (current_match.dual_score_recorder_side = 'teamB' and recorder_a is not null) then
    update public.matches
    set dual_score_recorder_side = null,
        rules = coalesce(rules, '{}'::jsonb) - 'dualScoreRecorderSide',
        updated_at = now_at
    where id = safe_match_id;
    current_match.dual_score_recorder_side := null;
  end if;

  if nullif(btrim(current_match.referee_id), '') is not null then
    if safe_actor_id <> nullif(btrim(current_match.referee_id), '')
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_score_referee_required' using errcode = '42501';
    end if;
    can_score_a := true;
    can_score_b := true;
    authority_a := 'referee';
    authority_b := 'referee';
  elsif safe_actor_id = nullif(btrim(current_match.created_by), '') then
    can_score_a := true;
    can_score_b := true;
    authority_a := 'host';
    authority_b := 'host';
  else
    if current_match.status <> 'agreed' or current_match.ended_at is not null then
      raise exception 'match_score_recorder_not_live' using errcode = '42501';
    end if;

    can_score_a := safe_actor_id = recorder_a;
    can_score_b := safe_actor_id = recorder_b;
    authority_a := case when can_score_a then 'side_recorder' end;
    authority_b := case when can_score_b then 'side_recorder' end;
    if current_match.dual_score_recorder_side = 'teamA' and safe_actor_id = recorder_a then
      can_score_b := true;
      authority_a := 'dual_side_recorder';
      authority_b := 'dual_side_recorder';
    elsif current_match.dual_score_recorder_side = 'teamB' and safe_actor_id = recorder_b then
      can_score_a := true;
      authority_a := 'dual_side_recorder';
      authority_b := 'dual_side_recorder';
    end if;
  end if;$old$;
  new_authorization text := $new$  game_clock_enabled :=
    lower(coalesce(current_match.rules->>'recordType', '')) not in ('match_record', 'personal_record')
    and lower(coalesce(current_match.rules->>'gameClockEnabled', 'true')) <> 'false';
  select session.controller_id
  into clock_controller_id
  from public.match_clock_sessions session
  where session.match_id = safe_match_id
  limit 1;

  if current_match.dual_score_recorder_side is not null
     or current_match.rules ? 'dualScoreRecorderSide' then
    update public.matches
    set dual_score_recorder_side = null,
        rules = coalesce(rules, '{}'::jsonb) - 'dualScoreRecorderSide',
        updated_at = now_at
    where id = safe_match_id;
    current_match.dual_score_recorder_side := null;
  end if;

  if nullif(btrim(current_match.referee_id), '') is not null then
    if safe_actor_id = nullif(btrim(current_match.referee_id), '')
       and public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      can_score_a := true;
      can_score_b := true;
      authority_a := 'referee';
      authority_b := 'referee';
    elsif game_clock_enabled
          and safe_actor_id = nullif(btrim(clock_controller_id), '')
          and public.rankball_match_clock_controller_eligible(safe_match_id, safe_actor_id) then
      can_score_a := true;
      can_score_b := true;
      authority_a := 'clock_controller';
      authority_b := 'clock_controller';
    else
      raise exception 'match_score_referee_required' using errcode = '42501';
    end if;
  elsif game_clock_enabled
        and safe_actor_id = nullif(btrim(clock_controller_id), '')
        and public.rankball_match_clock_controller_eligible(safe_match_id, safe_actor_id) then
    can_score_a := true;
    can_score_b := true;
    authority_a := 'clock_controller';
    authority_b := 'clock_controller';
  elsif not game_clock_enabled
        and safe_actor_id = nullif(btrim(current_match.created_by), '') then
    can_score_a := true;
    can_score_b := true;
    authority_a := 'host';
    authority_b := 'host';
  else
    raise exception 'match_score_increment_permission_denied' using errcode = '42501';
  end if;$new$;
begin
  if to_regprocedure(
    'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)'
  ) is null then
    raise exception 'match_score_increment_action_missing' using errcode = '55000';
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)'::regprocedure
  );
  if position(new_declarations in function_definition) = 0 then
    if position(old_declarations in function_definition) = 0 then
      raise exception 'match_score_declaration_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_declarations, new_declarations);
  end if;
  if position(new_authorization in function_definition) = 0 then
    if position(old_authorization in function_definition) = 0 then
      raise exception 'match_score_authorization_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_authorization, new_authorization);
  end if;
  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_declarations text := $old$  current_recorder_id text;
  internal_actor_id text;$old$;
  new_declarations text := $new$  current_recorder_id text;
  internal_actor_id text;$new$;
  old_action_guard text := $old$  if safe_action is null
     or safe_action <> 'substituteMatchPlayer'$old$;
  new_action_guard text := $new$  if safe_action is null
     or safe_action <> 'substituteMatchPlayer'$new$;
  old_permission text := $old$  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  current_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);
  actor_is_side_reserve := (
    case when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
      then current_match.reserve_players->safe_side else '[]'::jsonb end
  ) ? safe_actor_id
    and safe_actor_id = safe_reserve_player_id;

  if safe_reason = 'self' then
    if not actor_is_side_reserve then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    select exists (
      select 1
      from public.match_attendance_entries entry
      where entry.match_id = safe_match_id
        and entry.player_id = safe_reserve_player_id
        and entry.status = 'late'
        and entry.checked_in_at >= current_match.started_at
    ) into late_eligible;
    final_reason := case when late_eligible then 'late' else 'self' end;
    internal_reason := case when late_eligible then 'late' else 'operator' end;
    internal_actor_id := coalesce(
      assigned_referee_id,
      current_recorder_id,
      nullif(btrim(current_match.created_by), '')
    );
    if internal_actor_id is null then
      raise exception 'match_substitution_operator_missing' using errcode = '42501';
    end if;
  else
    if assigned_referee_id is null
       or safe_actor_id <> assigned_referee_id
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    final_reason := safe_reason;
    internal_reason := case when safe_reason = 'injury' then 'operator' else safe_reason end;
    internal_actor_id := safe_actor_id;
  end if;$old$;
  new_permission text := $new$  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  actor_is_side_reserve := (
    case when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
      then current_match.reserve_players->safe_side else '[]'::jsonb end
  ) ? safe_actor_id
    and safe_actor_id = safe_reserve_player_id;

  if safe_reason = 'self' then
    if not actor_is_side_reserve then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    select exists (
      select 1
      from public.match_attendance_entries entry
      where entry.match_id = safe_match_id
        and entry.player_id = safe_reserve_player_id
        and entry.status = 'late'
        and entry.checked_in_at >= current_match.started_at
    ) into late_eligible;
    final_reason := case when late_eligible then 'late' else 'self' end;
    internal_reason := case when late_eligible then 'late' else 'operator' end;
    internal_actor_id := coalesce(
      assigned_referee_id,
      nullif(btrim(current_match.created_by), '')
    );
    if internal_actor_id is null then
      raise exception 'match_substitution_operator_missing' using errcode = '42501';
    end if;
  else
    if assigned_referee_id is null
       or safe_actor_id <> assigned_referee_id
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    final_reason := safe_reason;
    internal_reason := case when safe_reason = 'injury' then 'operator' else safe_reason end;
    internal_actor_id := safe_actor_id;
  end if;
  $new$;
  old_move_call text := $old$  result := public.rankball_match_roster_transition_action_pre_score_policy(
    internal_actor_id,$old$;
  new_move_call text := $new$  result := public.rankball_match_roster_transition_action_pre_score_policy(
    internal_actor_id,$new$;
  old_recorder_transfer text := $old$  next_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);
  update public.match_recorder_takeover_requests
  set status = 'stale',
      resolved_at = clock_timestamp(),
      resolution = 'recorder_changed_by_substitution'
  where match_id = safe_match_id
    and side = safe_side
    and status = 'open'
    and expected_recorder_id is distinct from next_recorder_id;

  return result || jsonb_build_object(
    'actorProfileId', safe_actor_id,
    'reason', final_reason,
    'selfSubstitution', safe_reason = 'self',
    'refereeManaged', safe_reason <> 'self',
    'recorderInheritedByOutgoingActive',
      assigned_referee_id is null
      and current_recorder_id = safe_reserve_player_id
      and next_recorder_id = safe_active_player_id
  );$old$;
  new_recorder_transfer text := $new$  return result || jsonb_build_object(
    'actorProfileId', safe_actor_id,
    'reason', final_reason,
    'selfSubstitution', safe_reason = 'self',
    'refereeManaged', safe_reason <> 'self'
  );$new$;
begin
  if to_regprocedure(
    'public.rankball_match_roster_transition_action(text,text,text,text,text,text,text,text)'
  ) is null then
    raise exception 'match_roster_transition_action_missing' using errcode = '55000';
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_match_roster_transition_action(text,text,text,text,text,text,text,text)'::regprocedure
  );
  if position(new_declarations in function_definition) = 0 then
    if position(old_declarations in function_definition) = 0 then
      raise exception 'match_substitution_declaration_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_declarations, new_declarations);
  end if;
  if position(new_action_guard in function_definition) = 0 then
    if position(old_action_guard in function_definition) = 0 then
      raise exception 'match_substitution_action_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_action_guard, new_action_guard);
  end if;
  if position(new_permission in function_definition) = 0 then
    if position(old_permission in function_definition) = 0 then
      raise exception 'match_substitution_permission_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_permission, new_permission);
  end if;
  if position(new_move_call in function_definition) = 0 then
    if position(old_move_call in function_definition) = 0 then
      raise exception 'match_substitution_move_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_move_call, new_move_call);
  end if;
  if position(new_recorder_transfer in function_definition) = 0 then
    if position(old_recorder_transfer in function_definition) = 0 then
      raise exception 'match_substitution_recorder_tail_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_recorder_transfer, new_recorder_transfer);
  end if;
  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_permission text := $old$  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  current_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);

  if safe_action = 'substituteMatchPlayer' then
    if assigned_referee_id is not null then
      referee_authorized :=
        safe_actor_id = assigned_referee_id
        and public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id);
    else
      recorder_authorized := safe_actor_id = current_recorder_id;
    end if;
    if not referee_authorized and not recorder_authorized then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;

    if safe_reason = 'late' then
      select exists(
        select 1
        from public.match_attendance_entries entry
        where entry.match_id = safe_match_id
          and entry.player_id = safe_reserve_player_id
          and entry.status = 'late'
          and current_match.started_at is not null
          and entry.checked_in_at >= current_match.started_at
      )
      into late_eligible;
      if not late_eligible then
        raise exception 'match_late_substitution_not_eligible' using errcode = '23514';
      end if;
    end if;
  else
    if assigned_referee_id is not null or current_recorder_id is null or safe_actor_id <> current_recorder_id then
      raise exception 'match_recorder_handoff_actor_mismatch' using errcode = '42501';
    end if;
  end if;$old$;
  new_permission text := $new$  assigned_referee_id := nullif(btrim(current_match.referee_id), '');

  if safe_action <> 'substituteMatchPlayer' then
    raise exception 'match_recorder_flow_retired' using errcode = '42501';
  end if;
  if assigned_referee_id is not null then
    referee_authorized :=
      safe_actor_id = assigned_referee_id
      and public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id);
  else
    recorder_authorized := safe_actor_id = nullif(btrim(current_match.created_by), '');
  end if;
  if not referee_authorized and not recorder_authorized then
    raise exception 'match_substitution_permission_denied' using errcode = '42501';
  end if;

  if safe_reason = 'late' then
    select exists(
      select 1
      from public.match_attendance_entries entry
      where entry.match_id = safe_match_id
        and entry.player_id = safe_reserve_player_id
        and entry.status = 'late'
        and current_match.started_at is not null
        and entry.checked_in_at >= current_match.started_at
    )
    into late_eligible;
    if not late_eligible then
      raise exception 'match_late_substitution_not_eligible' using errcode = '23514';
    end if;
  end if;$new$;
  old_move_call text := $old$  result := public.rankball_match_roster_move_action(
    safe_actor_id,$old$;
  new_move_call text := $new$  result := public.rankball_match_roster_move_action_pre_substitution_permission(
    safe_actor_id,$new$;
  old_recorder_transfer text := $old$
    if assigned_referee_id is null and current_recorder_id = safe_reserve_player_id then
      current_recorders := case
        when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
        when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
        else '{}'::jsonb
      end;
      next_recorders := jsonb_set(
        current_recorders,
        array[safe_side],
        to_jsonb(safe_active_player_id),
        true
      );
      update public.matches
      set stat_recorders = next_recorders,
          rules = jsonb_set(
            coalesce(rules, '{}'::jsonb),
            '{statRecorders}',
            next_recorders,
            true
          ),
          updated_at = now_at
      where id = safe_match_id;
    end if;$old$;
begin
  if to_regprocedure(
    'public.rankball_match_roster_transition_action_pre_score_policy(text,text,text,text,text,text,text,text)'
  ) is null then
    raise exception 'match_roster_transition_inner_missing' using errcode = '55000';
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_match_roster_transition_action_pre_score_policy(text,text,text,text,text,text,text,text)'::regprocedure
  );
  if position(new_permission in function_definition) = 0 then
    if position(old_permission in function_definition) = 0 then
      raise exception 'match_substitution_inner_permission_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_permission, new_permission);
  end if;
  if position(new_move_call in function_definition) = 0 then
    if position(old_move_call in function_definition) = 0 then
      raise exception 'match_substitution_inner_move_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_move_call, new_move_call);
  end if;
  if position(old_recorder_transfer in function_definition) = 0 then
    raise exception 'match_substitution_inner_recorder_shape_changed' using errcode = '55000';
  end if;
  function_definition := replace(function_definition, old_recorder_transfer, '');
  execute function_definition;
end;
$migration$;

revoke all on function public.rankball_match_clock_controller_eligible(text, text)
from public, anon, authenticated;

revoke all on function public.rankball_match_clock_action(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_match_clock_action(text, text, text, jsonb)
to service_role;

revoke all on function public.rankball_match_score_increment_action(
  text, text, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.rankball_match_score_increment_action(
  text, text, integer, integer, integer, integer
) to service_role;

revoke all on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.rankball_match_roster_transition_action(
  text, text, text, text, text, text, text, text
) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
