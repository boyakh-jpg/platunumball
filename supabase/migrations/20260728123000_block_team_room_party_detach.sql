begin;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_recruiting_management_action_pre_team_detach_guard(text,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.rankball_recruiting_management_action(text,jsonb)'
    ) is null then
      raise exception 'rankball_recruiting_management_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_pre_team_detach_guard;
  end if;
end;
$migration$;

create or replace function public.rankball_recruiting_management_action(
  p_actor_profile_id text,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  safe_post_id text := nullif(btrim(p_operation->>'postId'), '');
  post_row public.recruiting_posts%rowtype;
begin
  if safe_action = 'detachRecruitingPartyPlayer' and safe_post_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('rankball:recruiting'),
      hashtext(safe_post_id)
    );
    select *
    into post_row
    from public.recruiting_posts
    where id = safe_post_id
    for update;

    if post_row.id is not null
       and (
         post_row.host_join_mode = 'team'
         or lower(coalesce(post_row.room_state->>'teamOnly', 'false')) = 'true'
       ) then
      raise exception 'team_room_party_detach_forbidden' using errcode = '23514';
    end if;
  end if;

  return public.rankball_recruiting_management_action_pre_team_detach_guard(
    p_actor_profile_id,
    p_operation
  );
end;
$$;

revoke all on function public.rankball_recruiting_management_action_pre_team_detach_guard(text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action(text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_recruiting_management_action(text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
