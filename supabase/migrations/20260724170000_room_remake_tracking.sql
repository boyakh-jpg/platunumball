begin;

create table if not exists public.room_remake_events (
  id text primary key,
  owner_id text not null,
  root_source_type text not null check (root_source_type in ('recruiting', 'match')),
  root_source_id text not null,
  source_post_id text,
  source_match_id text,
  source_title text,
  new_post_id text not null unique,
  sequence integer not null check (sequence > 0),
  warning_level text not null default 'none' check (warning_level in ('none', 'notice', 'review')),
  created_at timestamptz not null default now()
);

create index if not exists room_remake_events_owner_created_idx
  on public.room_remake_events (owner_id, created_at desc);

create index if not exists room_remake_events_root_sequence_idx
  on public.room_remake_events (owner_id, root_source_type, root_source_id, sequence desc);

alter table public.room_remake_events enable row level security;
revoke all on table public.room_remake_events from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.rankball_recruiting_management_action_pre_remake_tracking(text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_management_action(text,jsonb)') is null then
      raise exception 'rankball_recruiting_management_action_missing';
    end if;
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_pre_remake_tracking;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_management_action(
  p_actor_profile_id text,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_variable
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  requested_post_id text := nullif(btrim(p_operation #>> '{draft,remakeSourceId}'), '');
  requested_match_id text := nullif(btrim(p_operation #>> '{draft,remakeSourceMatchId}'), '');
  resolved_post_id text;
  linked_post_id text;
  source_owner_id text;
  source_title text;
  source_terminal boolean := false;
  root_source_type text;
  root_source_id text;
  next_sequence integer := 1;
  warning_level text := 'none';
  new_post_id text;
  result jsonb;
  source_post public.recruiting_posts%rowtype;
  source_match public.matches%rowtype;
  created_post public.recruiting_posts%rowtype;
  previous_event public.room_remake_events%rowtype;
  now_at timestamptz := clock_timestamp();
begin
  if safe_action <> 'createRecruitingPost'
     or (requested_post_id is null and requested_match_id is null) then
    return public.rankball_recruiting_management_action_pre_remake_tracking(
      p_actor_profile_id,
      p_operation
    );
  end if;
  if safe_actor_id is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  if requested_match_id is not null then
    select match_row.* into source_match
    from public.matches match_row
    where match_row.id = requested_match_id;
    if source_match.id is null then
      raise exception 'room_remake_source_not_found' using errcode = 'P0002';
    end if;
    if source_match.created_by is distinct from safe_actor_id then
      raise exception 'room_remake_owner_required' using errcode = '42501';
    end if;
    if source_match.status <> 'cancelled' then
      raise exception 'room_remake_source_not_terminal' using errcode = '23514';
    end if;
    linked_post_id := nullif(btrim(source_match.rules->>'recruitingPostId'), '');
    source_title := coalesce(nullif(btrim(source_match.rules->>'title'), ''), '취소된 경기');
  end if;

  if requested_post_id is not null
     and linked_post_id is not null
     and requested_post_id <> linked_post_id then
    raise exception 'room_remake_source_mismatch' using errcode = '23514';
  end if;
  resolved_post_id := coalesce(requested_post_id, linked_post_id);

  if resolved_post_id is not null then
    select post.* into source_post
    from public.recruiting_posts post
    where post.id = resolved_post_id;
    if source_post.id is null then
      raise exception 'room_remake_source_not_found' using errcode = 'P0002';
    end if;
    source_owner_id := coalesce(
      nullif(btrim(source_post.room_state->>'ownerId'), ''),
      nullif(btrim(source_post.player_id), '')
    );
    if source_owner_id is distinct from safe_actor_id then
      raise exception 'room_remake_owner_required' using errcode = '42501';
    end if;
    source_title := coalesce(nullif(btrim(source_post.title), ''), source_title, '취소된 방');
    source_terminal := source_post.status in ('closed', 'cancelled', 'canceled', 'expired')
      or exists (
        select 1
        from public.matches match_row
        where match_row.rules->>'recruitingPostId' = source_post.id
          and match_row.status = 'cancelled'
      );
    if not source_terminal then
      raise exception 'room_remake_source_not_terminal' using errcode = '23514';
    end if;
  elsif source_match.id is not null then
    source_owner_id := source_match.created_by;
    source_terminal := true;
  else
    raise exception 'room_remake_source_not_found' using errcode = 'P0002';
  end if;

  select event.* into previous_event
  from public.room_remake_events event
  where event.owner_id = safe_actor_id
    and event.new_post_id = resolved_post_id
  order by event.sequence desc
  limit 1;

  if previous_event.id is not null then
    root_source_type := previous_event.root_source_type;
    root_source_id := previous_event.root_source_id;
  elsif resolved_post_id is not null then
    root_source_type := 'recruiting';
    root_source_id := resolved_post_id;
  else
    root_source_type := 'match';
    root_source_id := source_match.id;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('rankball:room-remake'),
    hashtext(safe_actor_id || ':' || root_source_type || ':' || root_source_id)
  );
  select coalesce(max(event.sequence), 0) + 1 into next_sequence
  from public.room_remake_events event
  where event.owner_id = safe_actor_id
    and event.root_source_type = root_source_type
    and event.root_source_id = root_source_id;

  warning_level := case
    when next_sequence >= 3 then 'review'
    when next_sequence = 2 then 'notice'
    else 'none'
  end;

  result := public.rankball_recruiting_management_action_pre_remake_tracking(
    safe_actor_id,
    p_operation
  );
  new_post_id := coalesce(
    nullif(btrim(result->>'postId'), ''),
    nullif(btrim(p_operation->>'preferredPostId'), ''),
    nullif(btrim(p_operation #>> '{draft,id}'), '')
  );
  if new_post_id is null then
    raise exception 'room_remake_new_post_missing' using errcode = 'P0002';
  end if;

  select post.* into created_post
  from public.recruiting_posts post
  where post.id = new_post_id
  for update;
  if created_post.id is null then
    raise exception 'room_remake_new_post_missing' using errcode = 'P0002';
  end if;
  if coalesce(
    nullif(btrim(created_post.room_state->>'ownerId'), ''),
    nullif(btrim(created_post.player_id), '')
  ) is distinct from safe_actor_id then
    raise exception 'room_remake_owner_required' using errcode = '42501';
  end if;

  insert into public.room_remake_events (
    id,
    owner_id,
    root_source_type,
    root_source_id,
    source_post_id,
    source_match_id,
    source_title,
    new_post_id,
    sequence,
    warning_level,
    created_at
  ) values (
    'rre_' || replace(gen_random_uuid()::text, '-', ''),
    safe_actor_id,
    root_source_type,
    root_source_id,
    resolved_post_id,
    requested_match_id,
    source_title,
    new_post_id,
    next_sequence,
    warning_level,
    now_at
  );

  update public.recruiting_posts
  set room_state = coalesce(room_state, '{}'::jsonb) || jsonb_build_object(
        'remakeSourceId', resolved_post_id,
        'remakeSourceMatchId', requested_match_id,
        'remakeRootType', root_source_type,
        'remakeRootId', root_source_id,
        'remakeSequence', next_sequence,
        'remakeCreatedAt', now_at
      ),
      updated_at = now_at
  where id = new_post_id;

  if next_sequence >= 2 then
    insert into public.notifications (
      id,
      user_id,
      target_user_id,
      title,
      body,
      tone,
      type,
      recruiting_post_id,
      payload,
      created_at,
      updated_at
    ) values (
      'notice-room-remake-' || substr(md5(new_post_id), 1, 24),
      safe_actor_id,
      safe_actor_id,
      case when next_sequence >= 3 then '반복 다시 만들기 경고' else '반복 다시 만들기 안내' end,
      case
        when next_sequence >= 3 then
          '같은 설정으로 방을 연속 ' || next_sequence::text || '회 다시 만들었습니다. 반복 취소·재생성은 운영 검토 후 신뢰도가 조정될 수 있습니다.'
        else
          '같은 설정으로 방을 연속 2회 다시 만들었습니다. 3회 이상 반복하면 운영 검토 후 신뢰도가 조정될 수 있습니다.'
      end,
      'orange',
      'room_remake_warning',
      new_post_id,
      jsonb_build_object(
        'targetUserId', safe_actor_id,
        'recruitingPostId', new_post_id,
        'remakeSequence', next_sequence,
        'remakeRootType', root_source_type,
        'remakeRootId', root_source_id,
        'actionRequired', false,
        'skipDiscordSync', true
      ),
      now_at,
      now_at
    ) on conflict (id) do nothing;
  end if;

  perform public.rankball_refresh_recruiting_feed_for_post(new_post_id);
  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'remakeSequence', next_sequence,
    'remakeWarningLevel', warning_level,
    'remakeRootType', root_source_type,
    'remakeRootId', root_source_id
  );
end;
$$;

create or replace function public.rankball_admin_room_remake_stats(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_search text default null,
  p_limit integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_admin_level integer;
  safe_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  safe_limit integer := greatest(1, least(100, coalesce(p_limit, 60)));
  cutoff_at timestamptz := now() - interval '30 days';
  result jsonb;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(
    p_actor_profile_id,
    p_actor_admin_level
  );
  if safe_admin_level < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  with remake_stats as (
    select
      event.owner_id,
      count(*)::integer as room_remake_count,
      count(*) filter (where event.created_at >= cutoff_at)::integer as room_remake_count_30d,
      max(event.sequence)::integer as max_room_remake_sequence,
      max(event.created_at) as last_room_remake_at
    from public.room_remake_events event
    group by event.owner_id
  ),
  filtered as (
    select
      profile.id,
      profile.name,
      coalesce(profile.hashtag, profile.handle, profile.id) as hashtag,
      profile.position,
      profile.region,
      coalesce(profile.trust_score, 80)::integer as trust_score,
      stats.room_remake_count,
      stats.room_remake_count_30d,
      stats.max_room_remake_sequence,
      stats.last_room_remake_at,
      greatest(
        coalesce(profile.updated_at, profile.created_at, 'epoch'::timestamptz),
        stats.last_room_remake_at
      ) as last_activity_at
    from remake_stats stats
    join public.profiles profile on profile.id = stats.owner_id
    where safe_search is null
      or lower(concat_ws(' ', profile.name, profile.hashtag, profile.handle, profile.id, profile.region))
        like '%' || safe_search || '%'
  ),
  paged as (
    select *
    from filtered
    order by max_room_remake_sequence desc, room_remake_count desc, last_room_remake_at desc
    limit safe_limit
  )
  select jsonb_build_object(
    'ok', true,
    'summary', jsonb_build_object(
      'roomRemakeCount', (select coalesce(sum(room_remake_count), 0) from filtered),
      'roomRemakeCount30d', (select coalesce(sum(room_remake_count_30d), 0) from filtered),
      'roomRemakeUsers', (select count(*) from filtered),
      'roomRemakeRepeatUsers', (select count(*) from filtered where max_room_remake_sequence >= 2),
      'roomRemakeReviewUsers', (select count(*) from filtered where max_room_remake_sequence >= 3)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'name', page.name,
        'hashtag', page.hashtag,
        'position', page.position,
        'region', page.region,
        'trustScore', page.trust_score,
        'lastActivityAt', page.last_activity_at,
        'roomRemakeCount', page.room_remake_count,
        'roomRemakeCount30d', page.room_remake_count_30d,
        'maxRoomRemakeSequence', page.max_room_remake_sequence,
        'lastRoomRemakeAt', page.last_room_remake_at,
        'riskScore', 0,
        'riskLevel', 'normal',
        'riskSignals', '[]'::jsonb
      ) order by page.max_room_remake_sequence desc, page.room_remake_count desc, page.last_room_remake_at desc)
      from paged page
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.rankball_recruiting_management_action_pre_remake_tracking(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.rankball_recruiting_management_action(text, jsonb)
  to service_role;
revoke all on function public.rankball_admin_room_remake_stats(text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.rankball_admin_room_remake_stats(text, integer, text, integer)
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
