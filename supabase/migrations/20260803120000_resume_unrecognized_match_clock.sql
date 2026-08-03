begin;

do $migration$
declare
  function_definition text;
  old_resume text := $old$  elsif safe_action = 'resume' then
    if session_row.controller_id <> safe_actor_id
      or session_row.status <> 'paused'
      or session_row.period_remaining_ms <= 0
    then
      raise exception 'match_clock_resume_forbidden' using errcode = '42501';
    end if;
    session_row.status := 'running';
    session_row.last_resumed_at := server_now;$old$;
  new_resume text := $new$  elsif safe_action = 'resume' then
    if session_row.controller_id <> safe_actor_id
      or session_row.status not in ('paused', 'ended')
      or session_row.period_remaining_ms <= 0
      or (
        session_row.status = 'ended'
        and (
          current_match.ended_at is not null
          or (
            session_row.started_within_window
            and session_row.active_elapsed_ms >= minimum_active_ms
          )
        )
      )
    then
      raise exception 'match_clock_resume_forbidden' using errcode = '42501';
    end if;
    session_row.status := 'running';
    session_row.clock_ended_at := null;
    session_row.last_resumed_at := server_now;$new$;
begin
  if to_regprocedure(
    'public.rankball_match_clock_action_pre_optional_clock(text,text,text,jsonb)'
  ) is null then
    raise exception 'match_clock_action_core_missing' using errcode = '55000';
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_match_clock_action_pre_optional_clock(text,text,text,jsonb)'::regprocedure
  );
  if position(new_resume in function_definition) = 0 then
    if position(old_resume in function_definition) = 0 then
      raise exception 'match_clock_resume_policy_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_resume, new_resume);
  end if;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');

commit;
