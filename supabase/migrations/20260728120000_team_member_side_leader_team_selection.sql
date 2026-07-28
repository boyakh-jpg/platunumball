begin;

do $$
declare
  function_source text;
  old_text text := $old$
    eligibility := public.rankball_assert_team_event_eligible(
      safe_team_id,
      post_row.side_capacity,
      post_row.ranked,
      mmr_limit_mode,
      coalesce(team_row.mmr, 1200),
      mmr_range_mode,
      post_row.allowed_age_groups,
      true
    );
    captain_id := eligibility->>'captainId';
    if captain_id is distinct from safe_actor_id then
      raise exception 'team_captain_required' using errcode = '42501';
    end if;
$old$;
  new_text text := $new$
    eligibility := public.rankball_assert_team_event_eligible(
      safe_team_id,
      post_row.side_capacity,
      post_row.ranked,
      mmr_limit_mode,
      coalesce(team_row.mmr, 1200),
      mmr_range_mode,
      post_row.allowed_age_groups,
      false
    );
    captain_id := eligibility->>'captainId';
    if not exists (
      select 1
      from public.team_members member
      where member.team_id = safe_team_id
        and member.user_id = safe_actor_id
    ) then
      raise exception 'recruiting_team_member_required' using errcode = '42501';
    end if;
    if not (coalesce(eligibility->'eligiblePlayerIds', '[]'::jsonb) ? safe_actor_id) then
      raise exception 'recruiting_team_representative_ineligible' using errcode = '42501';
    end if;
$new$;
begin
  select pg_get_functiondef(
    'public.rankball_recruiting_set_room_team_action(text,text,text,text)'::regprocedure
  )
  into function_source;

  if function_source is null or position(old_text in function_source) = 0 then
    raise exception 'rankball_recruiting_set_room_team_action_shape_changed';
  end if;

  execute replace(function_source, old_text, new_text);
end;
$$;

revoke all on function public.rankball_recruiting_set_room_team_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_recruiting_set_room_team_action(text, text, text, text)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
