begin;

-- Explicit final approval for a live match belongs to the room host.
do $migration$
declare
  function_definition text;
  old_authority text := $old$  if nullif(btrim(current_match.referee_id), '') is null then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_finalize_host_required' using errcode = '42501';
    end if;
  elsif safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_finalize_referee_required' using errcode = '42501';
  end if;$old$;
  new_authority text := $new$  if lower(coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')) = 'finalizematch' then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_finalize_host_required' using errcode = '42501';
    end if;
  elsif nullif(btrim(current_match.referee_id), '') is null then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_finalize_host_required' using errcode = '42501';
    end if;
  elsif safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_finalize_referee_required' using errcode = '42501';
  end if;$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_finalize_locked(text,text,text)'::regprocedure
  );
  if position(new_authority in function_definition) = 0 then
    if position(old_authority in function_definition) = 0 then
      raise exception 'match_finalize_authority_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_authority, new_authority);
  end if;
end;
$migration$;

-- The inner finalizer still distinguishes operator-driven live finalization from
-- match_record participant approval. Treat only an explicit live finalize action
-- by the host as operator authority.
do $migration$
declare
  function_definition text;
  old_operator text := $old$  actor_is_operator := coalesce(
    safe_actor_id = coalesce(
      nullif(btrim(current_match.referee_id), ''),
      nullif(btrim(current_match.created_by), '')
    ),
    false
  );$old$;
  new_operator text := $new$  actor_is_operator := coalesce(
    (
      lower(coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')) = 'finalizematch'
      and lower(coalesce(current_match.rules->>'recordType', 'match')) not in ('match_record', 'personal_record')
      and safe_actor_id = nullif(btrim(current_match.created_by), '')
    )
    or safe_actor_id = coalesce(
      nullif(btrim(current_match.referee_id), ''),
      nullif(btrim(current_match.created_by), '')
    ),
    false
  );$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure
  );
  if position(new_operator in function_definition) = 0 then
    if position(old_operator in function_definition) = 0 then
      raise exception 'match_finalize_operator_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_operator, new_operator);
  end if;
end;
$migration$;

-- A dispute decision is a host action. Resolving the last queue item returns the
-- match to approval; it never bypasses the explicit final-confirmation action.
do $migration$
declare
  function_definition text;
  old_authority text := $old$  if nullif(btrim(current_match.referee_id), '') is null then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_host_required' using errcode = '42501';
    end if;
  elsif safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_dispute_referee_required' using errcode = '42501';
  end if;$old$;
  new_authority text := $new$  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_dispute_host_required' using errcode = '42501';
  end if;$new$;
  old_finalize text := $old$    final_result := public.rankball_match_finalize_locked(
      safe_actor_id, safe_match_id, 'resolveMatchDispute'
    );$old$;
  old_return text := $old$    'openCount', open_count, 'finalized', open_count = 0,
    'sqlReducer', true, 'advisoryLocked', true$old$;
  new_return text := $new$    'openCount', open_count, 'finalized', false,
    'sqlReducer', true, 'advisoryLocked', true$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_resolve_dispute_action(text,text,text,text)'::regprocedure
  );
  if position(new_authority in function_definition) = 0 then
    if position(old_authority in function_definition) = 0 then
      raise exception 'match_dispute_authority_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_authority, new_authority);
  end if;
  if position(old_finalize in function_definition) > 0 then
    function_definition := replace(function_definition, old_finalize, '');
  end if;
  if position(new_return in function_definition) = 0 then
    if position(old_return in function_definition) = 0 then
      raise exception 'match_dispute_return_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_return, new_return);
  end if;
  execute function_definition;
end;
$migration$;

-- Keep match_record approval isolated and retire participant approval for
-- ordinary live matches.
do $migration$
declare
  function_definition text;
  old_general_approval text := $old$  if record_type is distinct from 'match_record' then
    return public.rankball_match_approval_action_concurrency_inner(
      p_actor_profile_id,
      p_match_id,
      p_side,
      p_player_id
    );
  end if;$old$;
  new_general_approval text := $new$  if record_type is distinct from 'match_record' then
    raise exception 'general_match_participant_approval_retired' using errcode = '42501';
  end if;$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_approval_action(text,text,text,text)'::regprocedure
  );
  if position(new_general_approval in function_definition) = 0 then
    if position(old_general_approval in function_definition) = 0 then
      raise exception 'match_approval_type_guard_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_general_approval, new_general_approval);
  end if;
end;
$migration$;

-- Keep old rows readable while rejecting direct new injury/recorder-handoff rows.
alter table public.match_substitution_events
  drop constraint if exists match_substitution_events_reason_check;
alter table public.match_substitution_events
  add constraint match_substitution_events_reason_check
  check (reason in ('self', 'late', 'ejection', 'operator')) not valid;

revoke all on function public.rankball_match_scorekeeper_scope_action(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_recorder_takeover_action(text, text, text, text, text)
from public, anon, authenticated, service_role;

revoke all on function public.rankball_match_finalize_locked_concurrency_inner(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_finalize_locked(text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text)
to service_role;
revoke all on function public.rankball_match_resolve_dispute_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_resolve_dispute_action(text, text, text, text)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
