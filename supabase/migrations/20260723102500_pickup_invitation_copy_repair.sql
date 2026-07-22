-- Legacy pickup invitations were created as team-party invitations.
-- Keep their action state, but remove the stale party wording from user-facing alerts.

update public.notifications notification
set body = replace(
      notification.body,
      '파티장 초대장이 도착했습니다.',
      '개인 참가 초대장이 도착했습니다.'
    ),
    payload = (coalesce(notification.payload, '{}'::jsonb) - 'teamId')
      || jsonb_build_object('joinMode', 'player'),
    updated_at = now()
from public.recruiting_posts post
where post.id = notification.recruiting_post_id
  and post.rules->>'matchIntent' = 'pickup'
  and notification.invitation_id is not null
  and notification.body like '%파티장 초대장이 도착했습니다.%';

select pg_notify('pgrst', 'reload schema');
