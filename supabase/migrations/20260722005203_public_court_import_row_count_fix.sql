do $migration$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.rankball_import_public_courts(text,text,text,jsonb,boolean)'::regprocedure
  )
  into function_definition;

  if function_definition is null then
    raise exception 'rankball_import_public_courts_row_count_signature_changed';
  end if;

  function_definition := regexp_replace(function_definition, '(input_)+row_count', 'input_row_count', 'g');

  if function_definition !~ E'\n[[:space:]]+(?:input_)?row_count integer;' then
    raise exception 'rankball_import_public_courts_row_count_signature_changed';
  end if;

  function_definition := replace(function_definition, E'\n  row_count integer;', E'\n  input_row_count integer;');
  function_definition := replace(function_definition, E'\n  row_count := jsonb_array_length(p_rows);', E'\n  input_row_count := jsonb_array_length(p_rows);');
  function_definition := replace(function_definition, E'\n  if row_count < 1 or row_count > 50 then', E'\n  if input_row_count < 1 or input_row_count > 50 then');
  function_definition := replace(function_definition, '''rowCount'', row_count,', '''rowCount'', input_row_count,');
  function_definition := replace(function_definition, '''readyCount'', row_count,', '''readyCount'', input_row_count,');
  function_definition := replace(
    function_definition,
    'safe_batch_id, safe_source_file, safe_source_sha256, ''applying'', row_count, 0,',
    'safe_batch_id, safe_source_file, safe_source_sha256, ''applying'', input_row_count, 0,'
  );
  function_definition := replace(function_definition, '''requestedRows'', row_count', '''requestedRows'', input_row_count');

  if function_definition ~ E'\n[[:space:]]+row_count integer;'
    or function_definition ~ E'\n[[:space:]]+row_count := jsonb_array_length\\(p_rows\\);'
    or function_definition ~ E'\n[[:space:]]+if row_count < 1 or row_count > 50 then'
    or position('''rowCount'', row_count,' in function_definition) > 0
    or position('''readyCount'', row_count,' in function_definition) > 0
    or position('safe_batch_id, safe_source_file, safe_source_sha256, ''applying'', row_count, 0,' in function_definition) > 0
    or position('''requestedRows'', row_count' in function_definition) > 0 then
    raise exception 'rankball_import_public_courts_row_count_rewrite_incomplete';
  end if;

  execute function_definition;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');
