-- Retain inactive feed indexes and stale list cards for 30 days, then purge them.
create index if not exists user_room_feed_inactive_retention_idx
  on public.user_room_feed (updated_at, entity_type, entity_id)
  where is_active = false;

create index if not exists room_feed_cards_retention_idx
  on public.room_feed_cards (updated_at, entity_type, entity_id);

create or replace function public.rankball_cleanup_room_feed(p_now timestamptz default now())
returns table(scope text, affected_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := coalesce(p_now, now());
  local_now timestamp := timezone('Asia/Seoul', coalesce(p_now, now()));
  retention_cutoff timestamptz := coalesce(p_now, now()) - interval '30 days';
  changed_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:room-feed-cleanup'));

  update public.user_room_feed feed
  set is_active = false, updated_at = now_ts
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
  set is_active = false, updated_at = now_ts
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
  set is_active = false, updated_at = now_ts
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
  set is_active = false, updated_at = now_ts
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

  delete from public.user_room_feed feed
  where feed.is_active = false
    and feed.updated_at < retention_cutoff;
  get diagnostics changed_count = row_count;
  scope := 'inactive_feed_deleted';
  affected_count := changed_count;
  return next;

  delete from public.room_feed_cards card
  where card.updated_at < retention_cutoff
    and not exists (
      select 1
      from public.user_room_feed feed
      where feed.entity_type = card.entity_type
        and feed.entity_id = card.entity_id
        and feed.is_active = true
    )
    and coalesce((
      select max(feed.updated_at)
      from public.user_room_feed feed
      where feed.entity_type = card.entity_type
        and feed.entity_id = card.entity_id
    ), card.updated_at) < retention_cutoff;
  get diagnostics changed_count = row_count;
  scope := 'stale_card_deleted';
  affected_count := changed_count;
  return next;
end;
$$;

revoke all on function public.rankball_cleanup_room_feed(timestamptz) from public;
revoke all on function public.rankball_cleanup_room_feed(timestamptz) from anon;
revoke all on function public.rankball_cleanup_room_feed(timestamptz) from authenticated;
grant execute on function public.rankball_cleanup_room_feed(timestamptz) to service_role;

select pg_notify('pgrst', 'reload schema');
