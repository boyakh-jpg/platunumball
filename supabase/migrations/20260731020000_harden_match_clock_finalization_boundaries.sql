begin;

do $patch$
declare
  function_definition text;
  old_guard constant text := $old$if clock_timestamp() < submitted_at + interval '3 minutes' then$old$;
  new_guard constant text := $new$if clock_timestamp() < greatest(submitted_at, current_match.ended_at) + interval '3 minutes' then$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_finalize_locked(text,text,text,boolean)'::regprocedure
  );
  if position(new_guard in function_definition) = 0 then
    if position(old_guard in function_definition) = 0 then
      raise exception 'match_manual_finalization_window_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_guard, new_guard);
  end if;
end;
$patch$;

do $patch$
declare
  function_definition text;
  old_guard constant text := $old$if now_at < result_row.submitted_at + make_interval($old$;
  new_guard constant text := $new$if now_at < greatest(result_row.submitted_at, current_match.ended_at) + make_interval($new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_auto_finalize_action(text,timestamptz)'::regprocedure
  );
  if position(new_guard in function_definition) = 0 then
    if position(old_guard in function_definition) = 0 then
      raise exception 'match_auto_finalization_window_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_guard, new_guard);
  end if;
end;
$patch$;

do $patch$
declare
  function_signature text;
  function_definition text;
  old_guard constant text := $old$event.action = 'endClock'$old$;
  new_guard constant text := $new$event.action in ('endClock', 'matchEnd')$new$;
begin
  foreach function_signature in array array[
    'public.rankball_match_clock_rating_factor(text,text)',
    'public.rankball_match_clock_action(text,text,text,jsonb)'
  ]
  loop
    function_definition := pg_get_functiondef(function_signature::regprocedure);
    if position(new_guard in function_definition) = 0 then
      if position(old_guard in function_definition) = 0 then
        raise exception 'match_clock_explicit_end_shape_changed: %', function_signature using errcode = '55000';
      end if;
      execute replace(function_definition, old_guard, new_guard);
    end if;
  end loop;
end;
$patch$;

do $patch$
declare
  function_definition text;
  old_guard constant text := $old$  if coalesce(nullif(current_match.referee_id, ''), current_match.created_by) <> safe_actor_id then
    raise exception 'match_start_permission_denied' using errcode = '42501';
  end if;$old$;
  new_guard constant text := $new$  if coalesce(nullif(current_match.referee_id, ''), current_match.created_by) <> safe_actor_id then
    raise exception 'match_start_permission_denied' using errcode = '42501';
  end if;
  if nullif(btrim(current_match.referee_id), '') is not null
     and not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_referee_qualification_required' using errcode = '23514';
  end if;$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_start_action_pre_server_time(text,text,text,text,jsonb)'::regprocedure
  );
  if position('match_referee_qualification_required' in function_definition) = 0 then
    if position(old_guard in function_definition) = 0 then
      raise exception 'match_start_referee_guard_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_guard, new_guard);
  end if;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');

commit;
