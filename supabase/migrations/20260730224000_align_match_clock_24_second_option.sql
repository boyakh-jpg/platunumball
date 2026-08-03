begin;

alter table public.match_clock_sessions
  drop constraint if exists match_clock_sessions_shot_clock_check;

update public.match_clock_sessions
set shot_clock_seconds = 24,
    shot_remaining_ms = least(shot_remaining_ms, 24000),
    updated_at = clock_timestamp()
where shot_clock_seconds = 35;

alter table public.match_clock_sessions
  add constraint match_clock_sessions_shot_clock_check
  check (shot_clock_seconds in (0, 24, 30, 60))
  not valid;

alter table public.match_clock_sessions
  validate constraint match_clock_sessions_shot_clock_check;

do $migration$
declare
  function_definition text;
  old_text text := $old$    if next_shot_seconds not in (0, 30, 35, 60) then$old$;
  new_text text := $new$    if next_shot_seconds not in (0, 24, 30, 60) then$new$;
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
      raise exception 'match_clock_shot_option_policy_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_text, new_text);
  end if;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');

commit;
