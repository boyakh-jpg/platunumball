begin;

do $migration$
declare
  target record;
  target_oid oid;
  source_sql text;
  fixed_sql text;
begin
  for target in
    select *
    from (values
      (
        'public.rankball_recruiting_room_update_action(text,text,jsonb)',
        'current_post.scheduled_at,',
        'nullif(current_post.scheduled_at, '''')::timestamptz,'
      ),
      (
        'public.rankball_match_room_update_action(text,text,jsonb)',
        'current_match.scheduled_at,',
        'nullif(current_match.scheduled_at, '''')::timestamptz,'
      ),
      (
        'public.rankball_recruiting_close_action(text,text)',
        'current_post.scheduled_at,',
        'nullif(current_post.scheduled_at, '''')::timestamptz,'
      ),
      (
        'public.rankball_match_terminal_action(text,text,text,text)',
        'current_match.scheduled_at,',
        'nullif(current_match.scheduled_at, '''')::timestamptz,'
      )
    ) values_table(signature, old_expression, new_expression)
  loop
    target_oid := to_regprocedure(target.signature)::oid;
    if target_oid is null then
      raise exception 'room_policy_function_missing: %', target.signature;
    end if;

    source_sql := pg_get_functiondef(target_oid);
    fixed_sql := replace(source_sql, target.old_expression, target.new_expression);
    if fixed_sql <> source_sql then
      execute fixed_sql;
    end if;
  end loop;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');

commit;
