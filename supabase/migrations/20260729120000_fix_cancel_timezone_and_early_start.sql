begin;

create or replace function public.rankball_scheduled_at_kst(p_value text)
returns timestamptz
language plpgsql
immutable
set search_path = public
as $$
declare
  safe_value text := nullif(btrim(p_value), '');
begin
  if safe_value is null then
    return null;
  end if;
  if safe_value ~* '(z|[+-][0-9]{2}:?[0-9]{2})$' then
    return safe_value::timestamptz;
  end if;
  return safe_value::timestamp at time zone 'Asia/Seoul';
exception
  when others then
    return null;
end;
$$;

revoke all on function public.rankball_scheduled_at_kst(text)
from public, anon, authenticated, service_role;

do $patch$
declare
  target record;
  function_def text;
begin
  for target in
    select *
    from (values
      (
        'public.rankball_recruiting_close_action(text,text)',
        'nullif(current_post.scheduled_at, '''')::timestamptz',
        'public.rankball_scheduled_at_kst(current_post.scheduled_at)'
      ),
      (
        'public.rankball_match_terminal_action(text,text,text,text)',
        'nullif(current_match.scheduled_at, '''')::timestamptz',
        'public.rankball_scheduled_at_kst(current_match.scheduled_at)'
      )
    ) values_table(signature, old_fragment, new_fragment)
  loop
    if to_regprocedure(target.signature) is null then
      raise exception 'room_cancel_policy_function_missing: %', target.signature;
    end if;
    function_def := pg_get_functiondef(to_regprocedure(target.signature));
    if strpos(function_def, target.new_fragment) > 0 then
      continue;
    end if;
    if strpos(function_def, target.old_fragment) = 0 then
      raise exception 'room_cancel_policy_schedule_shape_changed: %', target.signature;
    end if;
    execute replace(function_def, target.old_fragment, target.new_fragment);
  end loop;
end;
$patch$;

do $patch$
declare
  signature text;
  start_signature text;
  function_def text;
  old_fragment text := 'if now() < scheduled_at_kst then';
  new_fragment text := 'if now() < scheduled_at_kst - interval ''10 minutes'' then';
begin
  start_signature := case
    when to_regprocedure(
      'public.rankball_match_start_action_pre_server_time(text,text,text,text,jsonb)'
    ) is not null
      then 'public.rankball_match_start_action_pre_server_time(text,text,text,text,jsonb)'
    else 'public.rankball_match_start_action(text,text,text,text,jsonb)'
  end;
  foreach signature in array array[
    'public.rankball_match_checkin_action(text,text,text,text)',
    start_signature
  ]
  loop
    if to_regprocedure(signature) is null then
      raise exception 'match_checkin_window_function_missing: %', signature;
    end if;
    function_def := pg_get_functiondef(to_regprocedure(signature));
    if strpos(function_def, new_fragment) > 0 then
      continue;
    end if;
    if strpos(function_def, old_fragment) = 0 then
      raise exception 'match_checkin_window_shape_changed: %', signature;
    end if;
    execute replace(function_def, old_fragment, new_fragment);
  end loop;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');

commit;
