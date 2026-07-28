begin;

do $migration$
declare
  function_definition text;
  old_text text := $old$  host_result := public.rankball_assert_team_event_eligible(
    new.team_id,
    new.side_capacity,
    new.ranked,
    mmr_limit_mode,
    host_mmr,
    mmr_range_mode,
    new.allowed_age_groups,
    true
  );
  captain_id := host_result->>'captainId';
  if new.player_id is distinct from captain_id then
    raise exception 'team_captain_required' using errcode = '42501';
  end if;$old$;
  new_text text := $new$  host_result := public.rankball_assert_team_event_eligible(
    new.team_id,
    new.side_capacity,
    new.ranked,
    mmr_limit_mode,
    host_mmr,
    mmr_range_mode,
    new.allowed_age_groups,
    false
  );
  captain_id := host_result->>'captainId';
  if not exists (
    select 1
    from public.team_members member
    where member.team_id = new.team_id
      and member.user_id = new.player_id
  ) then
    raise exception 'recruiting_team_membership_required' using errcode = '42501';
  end if;
  if not (coalesce(host_result->'eligiblePlayerIds', '[]'::jsonb) ? new.player_id) then
    raise exception 'recruiting_team_representative_ineligible' using errcode = '23514';
  end if;$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_recruiting_team_event_guard()'::regprocedure
  );

  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'team_member_room_post_guard_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  execute function_definition;
end;
$migration$;

revoke all on function public.rankball_recruiting_team_event_guard()
from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
