create or replace function public.rankball_cleanup_room_feed(p_now timestamptz default now())
returns table(scope text, affected_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := coalesce(p_now, now());
  local_now timestamp := timezone('Asia/Seoul', coalesce(p_now, now()));
  changed_count integer := 0;
begin
  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  where feed.is_active = true
    and feed.entity_type = 'recruiting'
    and not exists (
      select 1
      from public.recruiting_posts post
      where post.id = feed.entity_id
    );
  get diagnostics changed_count = row_count;
  scope := 'recruiting_orphan';
  affected_count := changed_count;
  return next;

  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  from public.recruiting_posts post
  where feed.is_active = true
    and feed.entity_type = 'recruiting'
    and feed.entity_id = post.id
    and (
      coalesce(feed.status, '') in ('closed', 'cancelled')
      or coalesce(post.status, '') in ('closed', 'cancelled')
      or (
        coalesce(post.status, '') = 'open'
        and (
          (
            (
              lower(btrim(coalesce(post.scheduled_at, ''))) in ('instant', '즉시')
              or lower(btrim(coalesce(post.room_state->>'timingType', ''))) = 'instant'
            )
            and coalesce(post.created_at, now_ts) <= now_ts - interval '120 minutes'
          )
          or (
            post.scheduled_date is not null
            and (post.scheduled_date::timestamp + coalesce(post.scheduled_time, time '00:00')) < local_now
          )
        )
      )
    );
  get diagnostics changed_count = row_count;
  scope := 'recruiting_expired';
  affected_count := changed_count;
  return next;

  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  where feed.is_active = true
    and feed.entity_type = 'match'
    and not exists (
      select 1
      from public.matches match_row
      where match_row.id = feed.entity_id
    );
  get diagnostics changed_count = row_count;
  scope := 'match_orphan';
  affected_count := changed_count;
  return next;

  update public.user_room_feed feed
  set is_active = false, updated_at = now()
  from public.matches match_row
  where feed.is_active = true
    and feed.entity_type = 'match'
    and feed.entity_id = match_row.id
    and (
      coalesce(feed.status, '') = 'closed'
      or coalesce(match_row.status, '') = 'closed'
    );
  get diagnostics changed_count = row_count;
  scope := 'match_closed';
  affected_count := changed_count;
  return next;
end;
$$;

revoke all on function public.rankball_cleanup_room_feed(timestamptz) from public;
grant execute on function public.rankball_cleanup_room_feed(timestamptz) to service_role;

select pg_notify('pgrst', 'reload schema');
