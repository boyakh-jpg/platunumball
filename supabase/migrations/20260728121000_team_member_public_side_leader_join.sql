begin;

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure
  );

  old_text := $old$      if current_post.host_join_mode = 'team' then
        if not exists (
          select 1
          from public.team_members member
          where member.team_id = target_team_id
            and member.user_id = safe_actor_id
            and member.role = 'captain'
        ) then
          raise exception 'recruiting_team_captain_required' using errcode = '42501';
        end if;
        payload := (
          payload - 'playerIds' - 'reservePlayerIds' - 'reserve'
        ) || jsonb_build_object(
          'playerIds', jsonb_build_array(safe_actor_id),
          'reservePlayerIds', '[]'::jsonb,
          'reserve', false
        );
      end if;$old$;
  new_text := $new$      if current_post.host_join_mode = 'team' then
        if not exists (
          select 1
          from public.team_members member
          where member.team_id = target_team_id
            and member.user_id = safe_actor_id
        ) then
          raise exception 'recruiting_team_membership_required' using errcode = '42501';
        end if;
        if not coalesce(
          safe_actor_id = any(
            select jsonb_array_elements_text(
              public.rankball_assert_team_event_eligible(
                target_team_id,
                current_post.side_capacity,
                current_post.ranked,
                coalesce(current_post.room_state->>'mmrLimitMode', 'block'),
                coalesce((
                  select team.mmr
                  from public.teams team
                  where team.id = current_post.team_id
                ), 1200),
                coalesce(current_post.room_state->>'mmrRangeMode', 'normal'),
                current_post.allowed_age_groups,
                false
              )->'eligiblePlayerIds'
            )
          ),
          false
        ) then
          raise exception 'recruiting_team_representative_ineligible' using errcode = '23514';
        end if;
        payload := (
          payload - 'playerIds' - 'reservePlayerIds' - 'reserve'
        ) || jsonb_build_object(
          'playerIds', jsonb_build_array(safe_actor_id),
          'reservePlayerIds', '[]'::jsonb,
          'reserve', false
        );
      end if;$new$;

  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'team_member_public_join_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_recruiting_application_event_guard()'::regprocedure
  );

  old_text := $old$    eligibility := public.rankball_assert_team_event_eligible(
      new.team_id, post_row.side_capacity, post_row.ranked, mmr_limit_mode, target_mmr,
      mmr_range_mode, post_row.allowed_age_groups, true
    );
    if new.player_id is distinct from eligibility->>'captainId' then
      raise exception 'team_captain_required' using errcode = '42501';
    end if;$old$;
  new_text := $new$    eligibility := public.rankball_assert_team_event_eligible(
      new.team_id, post_row.side_capacity, post_row.ranked, mmr_limit_mode, target_mmr,
      mmr_range_mode, post_row.allowed_age_groups, false
    );
    if not exists (
      select 1
      from public.team_members member
      where member.team_id = new.team_id
        and member.user_id = new.player_id
    ) then
      raise exception 'recruiting_team_membership_required' using errcode = '42501';
    end if;
    if not (coalesce(eligibility->'eligiblePlayerIds', '[]'::jsonb) ? new.player_id) then
      raise exception 'recruiting_team_representative_ineligible' using errcode = '23514';
    end if;$new$;

  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'team_member_public_application_actor_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  old_text := $old$         post_row.host_join_mode = 'team'
         and new.player_id = eligibility->>'captainId'
         and jsonb_array_length(coalesce(new.player_ids, '[]'::jsonb)) = 1
         and coalesce(new.player_ids, '[]'::jsonb) ? new.player_id$old$;
  new_text := $new$         post_row.host_join_mode = 'team'
         and coalesce(eligibility->'eligiblePlayerIds', '[]'::jsonb) ? new.player_id
         and exists (
           select 1
           from public.team_members member
           where member.team_id = new.team_id
             and member.user_id = new.player_id
         )
         and jsonb_array_length(coalesce(new.player_ids, '[]'::jsonb)) = 1
         and coalesce(new.player_ids, '[]'::jsonb) ? new.player_id$new$;

  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'team_member_public_application_guard_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  execute function_definition;
end;
$migration$;

revoke all on function public.rankball_recruiting_management_action_unguarded(text, jsonb)
from public, anon, authenticated, service_role;

revoke all on function public.rankball_recruiting_application_event_guard()
from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
