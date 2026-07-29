begin;

do $patch$
declare
  function_signature text := 'public.rankball_match_attendance_qr_action(text,text)';
  function_def text;
  patched_def text;
begin
  if to_regprocedure(function_signature) is null then
    raise exception 'match_attendance_qr_function_missing' using errcode = '42883';
  end if;
  function_def := pg_get_functiondef(to_regprocedure(function_signature));
  if strpos(
    function_def,
    'if (current_match.visibility <> ''public'' and current_match.tournament_id is null)'
  ) = 0 then
    patched_def := regexp_replace(
      function_def,
      'if current_match\.visibility <> ''public''[[:space:]]+or current_match\.tournament_id is not null',
      'if (current_match.visibility <> ''public'' and current_match.tournament_id is null)'
    );
    if patched_def = function_def then
      raise exception 'match_attendance_qr_eligibility_shape_changed' using errcode = '23514';
    end if;
    execute patched_def;
  end if;
end;
$patch$;

update public.matches
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{qrAttendanceEnabled}', 'true'::jsonb, true),
    updated_at = clock_timestamp()
where tournament_id is not null
  and status in ('contract', 'agreed')
  and ended_at is null
  and cancelled_at is null
  and voided_at is null
  and coalesce(nullif(rules->>'recordType', ''), 'match') = 'match'
  and lower(coalesce(rules->>'gameClockEnabled', 'true')) = 'true'
  and lower(coalesce(rules->>'qrAttendanceEnabled', 'false')) <> 'true';

select pg_notify('pgrst', 'reload schema');

commit;
