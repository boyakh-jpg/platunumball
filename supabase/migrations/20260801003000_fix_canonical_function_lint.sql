begin;

do $migration$
declare
  function_definition text;
  old_fragment text;
  new_fragment text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_dispute_action(text,text,jsonb)'::regprocedure
  );
  old_fragment := 'if jsonb_object_length(requested_stats) <> 7';
  new_fragment := 'if (select count(*) from jsonb_object_keys(requested_stats)) <> 7';
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'match_dispute_stats_shape_guard_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_tournament_operation_action(text,jsonb)'::regprocedure
  );
  old_fragment := $$sanction_status = case when status = 'draft' then 'pending' else sanction_status end,$$;
  new_fragment := $$sanction_status = case when tournament_row.status = 'draft' then 'pending' else tournament_row.sanction_status end,$$;
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'tournament_sanction_status_assignment_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$migration$;

alter function public.rankball_apply_room_rule_patch_pre_qr_attendance(jsonb, jsonb, text) stable;
alter function public.rankball_apply_room_rule_patch_pre_room_equipment(jsonb, jsonb, text) stable;
alter function public.rankball_apply_room_rule_patch_pre_duration_limit(jsonb, jsonb, text) stable;
alter function public.rankball_import_safe_date(text) stable;
alter function public.rankball_scheduled_at_kst(text) stable;

select pg_notify('pgrst', 'reload schema');

commit;
