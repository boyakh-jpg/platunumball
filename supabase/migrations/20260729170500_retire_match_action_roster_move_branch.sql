begin;

-- The service no longer sends recorder handoff or the old substitution action
-- through rankball_match_action. Remove only that obsolete dispatch branch
-- before retiring its external reducer entry point.
do $migration$
declare
  function_signature text :=
    'public.rankball_match_action(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)';
  function_def text;
  patched_def text;
  obsolete_branch text := $branch$
  if safe_action in ('handoffMatchRecorder', 'substituteMatchPlayer') and p_match_row ? '__operation' then
    branch_result := public.rankball_match_roster_move_action(
      safe_actor_id,
      safe_action,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,activePlayerId}',
      p_match_row #>> '{__operation,reservePlayerId}',
      p_match_row #>> '{__operation,nextRecorderId}'
    );
    if not coalesce((branch_result->>'fallback')::boolean, false) then
      return branch_result;
    end if;
  end if;
$branch$;
begin
  if to_regprocedure(function_signature) is null then
    raise exception 'match_action_function_missing: %', function_signature
      using errcode = '42883';
  end if;

  function_def := pg_get_functiondef(to_regprocedure(function_signature));
  if position('rankball_match_roster_move_action(' in function_def) = 0 then
    if position(
      'handoffMatchRecorder' in function_def
    ) > 0 or position(
      'substituteMatchPlayer' in function_def
    ) > 0 then
      raise exception 'retired_match_action_branch_shape_changed'
        using errcode = '23514';
    end if;
    return;
  end if;

  if position(obsolete_branch in function_def) = 0 then
    raise exception 'retired_match_action_branch_shape_changed'
      using errcode = '23514';
  end if;

  patched_def := replace(function_def, obsolete_branch, '');
  execute patched_def;

  if position(
    'rankball_match_roster_move_action('
    in pg_get_functiondef(to_regprocedure(function_signature))
  ) > 0 then
    raise exception 'retired_match_action_branch_still_present'
      using errcode = '23514';
  end if;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');

commit;
