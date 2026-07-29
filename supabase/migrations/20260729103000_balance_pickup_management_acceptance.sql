-- Apply the side-neutral pickup policy to the authoritative management RPC.

do $patch$
declare
  function_def text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure)
  into function_def;

  old_fragment := $old$      safe_side := case when payload->>'side' = 'teamA' then 'teamA' else 'teamB' end;
      reserve := coalesce((payload->>'reserve')::boolean, false);$old$;
  new_fragment := $new$      if coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then
        safe_side := null;
        reserve := false;
      else
        safe_side := case when payload->>'side' = 'teamA' then 'teamA' else 'teamB' end;
        reserve := coalesce((payload->>'reserve')::boolean, false);
      end if;$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action pickup invite shape changed';
  end if;

  old_fragment := $old$    safe_side := case when invitation->>'side' = 'teamA' then 'teamA' else 'teamB' end;
    reserve := coalesce((invitation->>'reserve')::boolean, false);$old$;
  new_fragment := $new$    safe_side := case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup'
        then public.rankball_recruiting_pickup_best_side(safe_post_id)
      when invitation->>'side' = 'teamA' then 'teamA'
      else 'teamB'
    end;
    reserve := case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then false
      else coalesce((invitation->>'reserve')::boolean, false)
    end;$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action pickup acceptance shape changed';
  end if;

  execute function_def;
end;
$patch$;
