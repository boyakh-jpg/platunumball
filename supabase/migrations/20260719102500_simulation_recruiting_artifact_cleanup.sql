create or replace function public.rankball_cleanup_simulation_recruiting_artifacts(p_limit integer default 250)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_limit integer := greatest(1, least(coalesce(p_limit, 250), 500));
  simulation_post_ids text[] := array[]::text[];
  simulation_notification_ids text[] := array[]::text[];
  deleted_posts integer := 0;
  deleted_notifications integer := 0;
  deleted_discord_deliveries integer := 0;
  remaining_posts integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:simulation-recruiting-cleanup'));

  select coalesce(array_agg(id), array[]::text[])
  into simulation_post_ids
  from (
    select post.id
    from public.recruiting_posts post
    where post.id like 'sim_q\_%' escape '\'
    order by post.created_at nulls first, post.id
    limit safe_limit
  ) batch;

  if cardinality(simulation_post_ids) > 0 then
    perform set_config('rankball.skip_derived_refresh', 'on', true);

    select coalesce(array_agg(notification.id), array[]::text[])
    into simulation_notification_ids
    from public.notifications notification
    where notification.recruiting_post_id = any(simulation_post_ids)
       or notification.payload->>'recruitingPostId' = any(simulation_post_ids);

    delete from public.discord_notification_deliveries delivery
    where delivery.notification_id = any(simulation_notification_ids)
       or delivery.payload->>'notificationId' = any(simulation_notification_ids)
       or delivery.payload->>'recruitingPostId' = any(simulation_post_ids);
    get diagnostics deleted_discord_deliveries = row_count;

    delete from public.notifications notification
    where notification.id = any(simulation_notification_ids)
       or notification.recruiting_post_id = any(simulation_post_ids)
       or notification.payload->>'recruitingPostId' = any(simulation_post_ids);
    get diagnostics deleted_notifications = row_count;

    delete from public.room_chat_messages
    where room_type = 'recruiting' and room_id = any(simulation_post_ids);

    delete from public.room_discord_links
    where room_type = 'recruiting' and room_id = any(simulation_post_ids);

    delete from public.user_room_feed
    where entity_type = 'recruiting' and entity_id = any(simulation_post_ids);

    delete from public.room_feed_cards
    where entity_type = 'recruiting' and entity_id = any(simulation_post_ids);

    delete from public.recruiting_applications
    where post_id = any(simulation_post_ids);

    delete from public.recruiting_posts
    where id = any(simulation_post_ids);
    get diagnostics deleted_posts = row_count;

    perform set_config('rankball.skip_derived_refresh', 'off', true);
  end if;

  select count(*)
  into remaining_posts
  from public.recruiting_posts post
  where post.id like 'sim_q\_%' escape '\';

  return jsonb_build_object(
    'ok', remaining_posts = 0,
    'deletedPosts', deleted_posts,
    'deletedNotifications', deleted_notifications,
    'deletedDiscordDeliveries', deleted_discord_deliveries,
    'remainingPosts', remaining_posts
  );
end;
$$;

revoke all on function public.rankball_cleanup_simulation_recruiting_artifacts(integer) from public, anon, authenticated;
grant execute on function public.rankball_cleanup_simulation_recruiting_artifacts(integer) to service_role;
