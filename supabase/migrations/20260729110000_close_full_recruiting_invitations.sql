-- Close pending player invitations atomically when a recruiting room fills.

create or replace function public.rankball_recruiting_expire_player_invitations_if_full(
  p_post_id text,
  p_invitations jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_post public.recruiting_posts%rowtype;
  participant_capacity integer;
  occupied_count integer;
  next_invitations jsonb;
begin
  select *
  into current_post
  from public.recruiting_posts
  where id = p_post_id
  for update;

  if not found then
    raise exception 'recruiting_post_not_found' using errcode = 'P0002';
  end if;

  participant_capacity := 2 * (
    greatest(1, least(5, coalesce(current_post.side_capacity, 5)))
    + greatest(0, least(3, coalesce(current_post.bench_capacity, 0)))
  );
  occupied_count :=
    public.rankball_recruiting_side_active_count(current_post, 'teamA')
    + public.rankball_recruiting_side_reserve_count(current_post, 'teamA')
    + public.rankball_recruiting_side_active_count(current_post, 'teamB')
    + public.rankball_recruiting_side_reserve_count(current_post, 'teamB');

  if participant_capacity <= 0 or occupied_count < participant_capacity then
    return jsonb_build_object(
      'filled', false,
      'invitations', coalesce(p_invitations, '[]'::jsonb)
    );
  end if;

  update public.notifications notice
  set
    read_at = coalesce(notice.read_at, p_now),
    updated_at = p_now
  where notice.recruiting_post_id = p_post_id
    and notice.read_at is null
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb)) invitation(value)
      where (invitation.value::jsonb)->>'id' = notice.invitation_id
        and (invitation.value::jsonb)->>'role' <> 'referee'
        and coalesce((invitation.value::jsonb)->>'status', 'pending') = 'pending'
    );

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    recruiting_post_id,
    invitation_id,
    payload,
    created_at,
    updated_at
  )
  select
    'notice-recruiting-full-' || substr(md5(p_post_id || ':' || ((invitation.value::jsonb)->>'id')), 1, 24),
    (invitation.value::jsonb)->>'targetUserId',
    (invitation.value::jsonb)->>'targetUserId',
    '방이 마감됐습니다',
    format('%s 방의 정원이 모두 찼습니다. 먼저 수락한 선수만 참가합니다.', current_post.title),
    'orange',
    'recruiting_invitation_closed',
    p_post_id,
    (invitation.value::jsonb)->>'id',
    jsonb_build_object(
      'source', 'recruiting_capacity_full',
      'recruitingPostId', p_post_id,
      'invitationId', (invitation.value::jsonb)->>'id'
    ),
    p_now,
    p_now
  from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb)) invitation(value)
  where (invitation.value::jsonb)->>'role' <> 'referee'
    and coalesce((invitation.value::jsonb)->>'status', 'pending') = 'pending'
    and nullif(btrim((invitation.value::jsonb)->>'targetUserId'), '') is not null
  on conflict (id) do update set
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    payload = excluded.payload,
    read_at = null,
    updated_at = excluded.updated_at;

  select coalesce(
    jsonb_agg(
      case
        when (invitation.value::jsonb)->>'role' <> 'referee'
          and coalesce((invitation.value::jsonb)->>'status', 'pending') = 'pending'
          then invitation.value::jsonb || jsonb_build_object('status', 'expired', 'updatedAt', p_now)
        else invitation.value::jsonb
      end
      order by invitation.ordinality
    ),
    '[]'::jsonb
  )
  into next_invitations
  from jsonb_array_elements(coalesce(p_invitations, '[]'::jsonb))
    with ordinality invitation(value, ordinality);

  return jsonb_build_object(
    'filled', true,
    'invitations', next_invitations
  );
end;
$$;

revoke all on function public.rankball_recruiting_expire_player_invitations_if_full(text, jsonb, timestamptz)
from public, anon, authenticated, service_role;

do $patch$
declare
  function_def text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure)
  into function_def;

  old_fragment := $old$    if reserve and reserve_count >= bench_capacity then
      invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'expired', now_at);
      update public.recruiting_posts
      set room_state = jsonb_set(management.room_state, '{invitations}', invitations, true), updated_at = now_at
      where id = safe_post_id;
      update public.notifications notice
      set read_at = coalesce(read_at, now_at), updated_at = now_at
      where notice.recruiting_post_id = safe_post_id
        and notice.invitation_id = management.invitation_id
        and notice.target_user_id = safe_actor_id;
      return jsonb_build_object(
        'ok', true,
        'action', safe_action,
        'postId', safe_post_id,
        'invitationExpired', true,
        'reason', 'recruiting_reserve_full',
        'sqlReducer', true,
        'advisoryLocked', true
      );
    end if;$old$;
  new_fragment := $new$    if reserve and reserve_count >= bench_capacity then
      payload := public.rankball_recruiting_expire_player_invitations_if_full(safe_post_id, invitations, now_at);
      if coalesce((payload->>'filled')::boolean, false) then
        invitations := coalesce(payload->'invitations', invitations);
      else
        invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'expired', now_at);
      end if;
      update public.recruiting_posts
      set room_state = jsonb_set(
            management.room_state
              || case
                when coalesce((payload->>'filled')::boolean, false)
                  then jsonb_build_object('playerCapacityFilledAt', now_at)
                else '{}'::jsonb
              end,
            '{invitations}',
            invitations,
            true
          ),
          updated_at = now_at
      where id = safe_post_id;
      update public.notifications notice
      set read_at = coalesce(read_at, now_at), updated_at = now_at
      where notice.recruiting_post_id = safe_post_id
        and notice.invitation_id = management.invitation_id
        and notice.target_user_id = safe_actor_id
        and notice.id not like 'notice-recruiting-full-%';
      return jsonb_build_object(
        'ok', false,
        'action', safe_action,
        'postId', safe_post_id,
        'invitationExpired', true,
        'reason', case
          when coalesce((payload->>'filled')::boolean, false) then 'recruiting_player_capacity_full'
          else 'recruiting_reserve_full'
        end,
        'message', case
          when coalesce((payload->>'filled')::boolean, false) then '방이 마감됐습니다. 먼저 수락한 선수만 참가합니다.'
          else '해당 후보 자리가 이미 찼습니다.'
        end,
        'sqlReducer', true,
        'advisoryLocked', true
      );
    end if;$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action full rejection shape changed';
  end if;

  old_fragment := $old$    invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'accepted', now_at);
    update public.recruiting_posts set room_state = jsonb_set(management.room_state, '{invitations}', invitations, true), updated_at = now_at where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sideName', safe_side, 'reserve', reserve, 'sqlReducer', true, 'advisoryLocked', true);$old$;
  new_fragment := $new$    invitations := public.rankball_recruiting_replace_invitation_status(invitations, invitation_id, safe_actor_id, 'accepted', now_at);
    payload := public.rankball_recruiting_expire_player_invitations_if_full(safe_post_id, invitations, now_at);
    invitations := coalesce(payload->'invitations', invitations);
    update public.recruiting_posts
    set room_state = jsonb_set(
          management.room_state
            || case
              when coalesce((payload->>'filled')::boolean, false)
                then jsonb_build_object('playerCapacityFilledAt', now_at)
              else '{}'::jsonb
            end,
          '{invitations}',
          invitations,
          true
        ),
        updated_at = now_at
    where id = safe_post_id;
    return jsonb_build_object('ok', true, 'action', safe_action, 'postId', safe_post_id, 'sideName', safe_side, 'reserve', reserve, 'roomFilled', coalesce((payload->>'filled')::boolean, false), 'sqlReducer', true, 'advisoryLocked', true);$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_management_action full acceptance shape changed';
  end if;

  execute function_def;
end;
$patch$;
