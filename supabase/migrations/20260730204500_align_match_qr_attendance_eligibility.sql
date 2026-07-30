begin;

do $patch$
declare
  function_signature text;
  function_def text;
  old_fragment constant text :=
    'if (current_match.visibility <> ''public'' and current_match.tournament_id is null)';
  new_fragment constant text :=
    'if (current_match.visibility not in (''public'', ''private'') and current_match.tournament_id is null)';
  old_resize_fragment constant text :=
    'if current_match.visibility <> ''public''';
  new_resize_fragment constant text :=
    'if current_match.visibility not in (''public'', ''private'')';
  old_record_fragment constant text :=
    'or coalesce(nullif(current_match.rules->>''recordType'', ''''), ''match'') <> ''match''';
  new_record_fragment constant text :=
    'or coalesce(nullif(current_match.rules->>''recordType'', ''''), ''match'') = ''match_record''';
  record_pattern constant text :=
    $pattern$coalesce\([[:space:]]*nullif\([[:space:]]*current_match\.rules[[:space:]]*->[>][[:space:]]*'recordType'(?:::[a-z]+)?[[:space:]]*,[[:space:]]*''(?:::[a-z]+)?[[:space:]]*\)[[:space:]]*,[[:space:]]*'match'(?:::[a-z]+)?[[:space:]]*\)[[:space:]]*<>[[:space:]]*'match'(?:::[a-z]+)?$pattern$;
  patched_def text;
begin
  foreach function_signature in array array[
    'public.rankball_match_attendance_qr_action(text,text)',
    'public.rankball_match_attendance_resize_action(text,text)'
  ]
  loop
    if to_regprocedure(function_signature) is null then
      raise exception 'match_attendance_qr_function_missing: %', function_signature
        using errcode = '42883';
    end if;
    function_def := pg_get_functiondef(to_regprocedure(function_signature));
    if function_signature = 'public.rankball_match_attendance_qr_action(text,text)' then
      if strpos(function_def, new_fragment) = 0 and strpos(function_def, old_fragment) = 0 then
        raise exception 'match_attendance_qr_eligibility_shape_changed: %', function_signature
          using errcode = '23514';
      end if;
      function_def := replace(function_def, old_fragment, new_fragment);
    else
      if strpos(function_def, new_resize_fragment) = 0 and strpos(function_def, old_resize_fragment) = 0 then
        raise exception 'match_attendance_qr_eligibility_shape_changed: %', function_signature
          using errcode = '23514';
      end if;
      function_def := replace(function_def, old_resize_fragment, new_resize_fragment);
    end if;
    if strpos(function_def, 'match_record') = 0 then
      patched_def := regexp_replace(function_def, record_pattern, new_record_fragment);
      if patched_def = function_def then
        raise exception 'match_attendance_qr_record_type_shape_changed: %', function_signature
          using errcode = '23514';
      end if;
      function_def := patched_def;
    end if;
    execute function_def;
  end loop;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');

commit;
