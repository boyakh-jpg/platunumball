begin;

do $migration$
declare
  function_source text;
  old_text text := $old$
    update public.recruiting_posts
    set room_state = jsonb_set(current_room_state, '{invitations}', next_invitations, true), updated_at = now()
    where id = safe_post_id;
$old$;
  new_text text := $new$
    update public.recruiting_posts
    set target_team_id = case
          when coalesce(invitation->>'joinMode', 'player') = 'team'
            and invitation->>'side' = 'teamB'
            and nullif(invitation->>'teamId', '') = current_post.target_team_id
          then null
          else current_post.target_team_id
        end,
        room_state = jsonb_set(current_room_state, '{invitations}', next_invitations, true),
        updated_at = now()
    where id = safe_post_id;
$new$;
begin
  select pg_get_functiondef(
    'public.rankball_recruiting_invitation_decision_action(text,text,text,text)'::regprocedure
  )
  into function_source;

  if position(new_text in function_source) = 0 then
    if position(old_text in function_source) = 0 then
      raise exception 'recruiting_invitation_decline_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_source, old_text, new_text);
  end if;
end;
$migration$;

revoke all on function public.rankball_recruiting_invitation_decision_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_recruiting_invitation_decision_action(text, text, text, text)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
