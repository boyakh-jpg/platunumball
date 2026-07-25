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

  old_text := $old$      if target_team_id is null or not exists (
        select 1 from public.team_members where team_id = target_team_id and user_id = safe_actor_id
      ) then raise exception 'recruiting_team_membership_required' using errcode = '42501'; end if;$old$;
  new_text := $new$      if target_team_id is null or not exists (
        select 1 from public.team_members where team_id = target_team_id and user_id = safe_actor_id
      ) then raise exception 'recruiting_team_membership_required' using errcode = '42501'; end if;
      if current_post.host_join_mode = 'team' then
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
      end if;$new$;
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'public_team_representative_join_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  old_text := $old$      if exists (
        select 1 from public.recruiting_applications
        where post_id = safe_post_id and team_id = target_team_id and side <> safe_side
      ) then raise exception 'recruiting_team_side_conflict' using errcode = '23514'; end if;$old$;
  new_text := $new$      if exists (
        select 1 from public.recruiting_applications
        where post_id = safe_post_id and team_id = target_team_id and side <> safe_side
      ) then raise exception 'recruiting_team_side_conflict' using errcode = '23514'; end if;
      if current_post.host_join_mode = 'team' then
        if safe_side = current_post.host_side or exists (
          select 1
          from public.recruiting_applications application
          where application.post_id = safe_post_id
            and application.side = safe_side
            and application.kind = 'team'
            and application.team_id is distinct from target_team_id
        ) then
          raise exception 'recruiting_team_side_occupied' using errcode = '23514';
        end if;
      end if;$new$;
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'public_team_representative_side_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
  end if;

  execute function_definition;
end;
$migration$;

revoke all on function public.rankball_recruiting_management_action_unguarded(text, jsonb)
from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
