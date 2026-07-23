-- Use record-specific cancellation copy without replacing the terminal reducer body.

do $$
declare
  target_function regprocedure := coalesce(
    to_regprocedure('public.rankball_match_terminal_action_legacy_inner(text,text,text)'),
    to_regprocedure('public.rankball_match_terminal_action(text,text,text)')
  );
  function_definition text;
  patched_definition text;
begin
  if target_function is null then
    raise exception 'rankball_match_terminal_action_missing';
  end if;

  select pg_get_functiondef(target_function) into function_definition;
  if position('then ''기록 취소''' in function_definition) > 0 then
    return;
  end if;

  patched_definition := regexp_replace(
    function_definition,
    $pattern$notification_title\s*:=\s*'[^']*';\s*notification_body\s*:=\s*format\('%s [^']*', current_match\.title\);$pattern$,
    $replacement$notification_title := case
      when coalesce(current_match.rules->>'recordType', '') = 'match_record' then '기록 취소'
      else '경기 취소'
    end;
    notification_body := case
      when coalesce(current_match.rules->>'recordType', '') = 'match_record' then format('%s 기록이 취소됐습니다.', current_match.title)
      else format('%s 경기방이 취소됐습니다.', current_match.title)
    end;$replacement$
  );

  if patched_definition = function_definition then
    raise exception 'rankball_match_terminal_action_cancel_copy_patch_failed';
  end if;

  execute patched_definition;
end;
$$;

select pg_notify('pgrst', 'reload schema');
