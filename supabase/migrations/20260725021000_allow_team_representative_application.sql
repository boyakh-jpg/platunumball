begin;

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_recruiting_application_event_guard()'::regprocedure
  );

  old_text := $old$    if coalesce((post_row.room_state->>'teamOnly')::boolean, post_row.host_join_mode = 'team')
       and jsonb_array_length(coalesce(new.player_ids, '[]'::jsonb)) < post_row.side_capacity then
      raise exception 'team_eligible_roster_insufficient' using errcode = '23514';
    end if;$old$;
  new_text := $new$    if coalesce((post_row.room_state->>'teamOnly')::boolean, post_row.host_join_mode = 'team')
       and jsonb_array_length(coalesce(new.player_ids, '[]'::jsonb)) < post_row.side_capacity
       and not (
         post_row.host_join_mode = 'team'
         and new.player_id = eligibility->>'captainId'
         and jsonb_array_length(coalesce(new.player_ids, '[]'::jsonb)) = 1
         and coalesce(new.player_ids, '[]'::jsonb) ? new.player_id
       ) then
      raise exception 'team_eligible_roster_insufficient' using errcode = '23514';
    end if;$new$;

  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'team_representative_application_guard_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_text, new_text);
  end if;
end;
$migration$;

revoke all on function public.rankball_recruiting_application_event_guard()
from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
