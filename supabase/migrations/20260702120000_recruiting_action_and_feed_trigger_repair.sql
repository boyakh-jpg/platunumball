-- Repair recruiting invite/accept persistence when a database was migrated from
-- migration files without the latest schema.sql RPC definitions.
-- No data is deleted by this migration.

create or replace function public.rankball_persist_recruiting_snapshot(
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  application_count integer := 0;
  notification_count integer := 0;
begin
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  insert into public.recruiting_posts (
    id, type, title, visibility, player_id, team_id, region, court_id, court_name, mode,
    scheduled_date, scheduled_time, scheduled_at, ranked, official, pre_registered,
    rating_scale, age_restriction, allowed_age_groups, rules, stakes, court_reserved,
    court_fee, spots, target_team_id, referee_id, referee_trust_min, stat_entry_minutes,
    dispute_minutes, room_state, host_join_mode, host_side, host_ready, side_capacity,
    player_ids, position, memo, status, confirmed_at, created_at, updated_at
  )
  select
    id, type, title, visibility, player_id, team_id, region, court_id, court_name, mode,
    scheduled_date, scheduled_time, scheduled_at, ranked, official, pre_registered,
    rating_scale, age_restriction, allowed_age_groups, rules, stakes, court_reserved,
    court_fee, spots, target_team_id, referee_id, referee_trust_min, stat_entry_minutes,
    dispute_minutes, room_state, host_join_mode, host_side, host_ready, side_capacity,
    player_ids, position, memo, status, confirmed_at, created_at, updated_at
  from jsonb_populate_record(null::public.recruiting_posts, p_post_row)
  on conflict (id) do update set
    type = excluded.type,
    title = excluded.title,
    visibility = excluded.visibility,
    player_id = excluded.player_id,
    team_id = excluded.team_id,
    region = excluded.region,
    court_id = excluded.court_id,
    court_name = excluded.court_name,
    mode = excluded.mode,
    scheduled_date = excluded.scheduled_date,
    scheduled_time = excluded.scheduled_time,
    scheduled_at = excluded.scheduled_at,
    ranked = excluded.ranked,
    official = excluded.official,
    pre_registered = excluded.pre_registered,
    rating_scale = excluded.rating_scale,
    age_restriction = excluded.age_restriction,
    allowed_age_groups = excluded.allowed_age_groups,
    rules = excluded.rules,
    stakes = excluded.stakes,
    court_reserved = excluded.court_reserved,
    court_fee = excluded.court_fee,
    spots = excluded.spots,
    target_team_id = excluded.target_team_id,
    referee_id = excluded.referee_id,
    referee_trust_min = excluded.referee_trust_min,
    stat_entry_minutes = excluded.stat_entry_minutes,
    dispute_minutes = excluded.dispute_minutes,
    room_state = excluded.room_state,
    host_join_mode = excluded.host_join_mode,
    host_side = excluded.host_side,
    host_ready = excluded.host_ready,
    side_capacity = excluded.side_capacity,
    player_ids = excluded.player_ids,
    position = excluded.position,
    memo = excluded.memo,
    status = excluded.status,
    confirmed_at = excluded.confirmed_at,
    updated_at = excluded.updated_at;

  delete from public.recruiting_applications where post_id = safe_post_id;

  insert into public.recruiting_applications (
    post_id, player_id, team_id, kind, side, status, reserve, position,
    player_ids, source_team_id, source_entry_id, created_at, updated_at
  )
  select
    post_id, player_id, team_id, kind, side, status, reserve, position,
    player_ids, source_team_id, source_entry_id, created_at, updated_at
  from jsonb_populate_recordset(null::public.recruiting_applications, coalesce(p_application_rows, '[]'::jsonb));
  get diagnostics application_count = row_count;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  )
  select
    id, user_id, target_user_id, title, body, tone, type, match_id,
    recruiting_post_id, invitation_id, discord_event, read_at, payload, created_at, updated_at
  from jsonb_populate_recordset(null::public.notifications, coalesce(p_notification_rows, '[]'::jsonb))
  on conflict (id) do update set
    user_id = excluded.user_id,
    target_user_id = excluded.target_user_id,
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    match_id = excluded.match_id,
    recruiting_post_id = excluded.recruiting_post_id,
    invitation_id = excluded.invitation_id,
    discord_event = excluded.discord_event,
    read_at = excluded.read_at,
    payload = excluded.payload,
    updated_at = excluded.updated_at;
  get diagnostics notification_count = row_count;

  return jsonb_build_object('ok', true, 'postId', safe_post_id, 'applicationCount', application_count, 'notificationCount', notification_count);
end;
$$;

revoke all on function public.rankball_persist_recruiting_snapshot(jsonb, jsonb, jsonb) from public;
grant execute on function public.rankball_persist_recruiting_snapshot(jsonb, jsonb, jsonb) to service_role;

create or replace function public.rankball_recruiting_action(
  p_actor_profile_id text,
  p_action text,
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := coalesce(nullif(btrim(p_action), ''), 'sync');
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  expected_updated_at timestamptz := coalesce(p_expected_updated_at, nullif(p_post_row->>'__expectedUpdatedAt', '')::timestamptz);
  current_updated_at timestamptz;
  persist_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  if safe_action = 'setRecruitingSlotPosition' and p_post_row ? '__operation' then
    return public.rankball_recruiting_slot_position_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,playerId}',
      p_post_row #>> '{__operation,position}'
    );
  end if;

  if safe_action = 'interestRecruitingPost' and p_post_row ? '__operation' then
    return public.rankball_recruiting_interest_player_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,application,joinMode}',
      p_post_row #>> '{__operation,application,teamId}',
      p_post_row #>> '{__operation,application,side}',
      case when lower(coalesce(p_post_row #>> '{__operation,application,reserve}', 'false')) = 'true' then true else false end,
      p_post_row #>> '{__operation,application,position}'
    );
  end if;

  if safe_action = 'setRecruitingApplicantPlacement' and p_post_row ? '__operation' then
    return public.rankball_recruiting_applicant_placement_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,playerId}',
      p_post_row #>> '{__operation,placement,side}',
      case when lower(coalesce(p_post_row #>> '{__operation,placement,reserve}', 'false')) = 'true' then true else false end
    );
  end if;

  if safe_action = 'cancelRecruitingParticipation' and p_post_row ? '__operation' then
    return public.rankball_recruiting_cancel_participation_action(
      safe_actor_id,
      safe_post_id
    );
  end if;

  select updated_at
  into current_updated_at
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if expected_updated_at is not null and current_updated_at is not null and current_updated_at <> expected_updated_at then
    raise exception 'recruiting_stale_snapshot' using errcode = '40001';
  end if;

  persist_result := public.rankball_persist_recruiting_snapshot(
    p_post_row - '__expectedUpdatedAt',
    p_application_rows,
    p_notification_rows
  );

  return persist_result || jsonb_build_object(
    'action', safe_action,
    'actorProfileId', safe_actor_id
  );
end;
$$;

drop function if exists public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb);
revoke all on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) from public;
grant execute on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) to service_role;

do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_trigger()') is not null then
    execute 'drop trigger if exists rankball_recruiting_posts_feed_refresh on public.recruiting_posts';
    execute 'create trigger rankball_recruiting_posts_feed_refresh after insert or update or delete on public.recruiting_posts for each row execute function public.rankball_refresh_recruiting_feed_trigger()';
  end if;

  if to_regclass('public.recruiting_applications') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_application_feed_trigger()') is not null then
    execute 'drop trigger if exists rankball_recruiting_applications_feed_refresh on public.recruiting_applications';
    execute 'create trigger rankball_recruiting_applications_feed_refresh after insert or update or delete on public.recruiting_applications for each row execute function public.rankball_refresh_recruiting_application_feed_trigger()';
  end if;

  if to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null
    and to_regclass('public.recruiting_posts') is not null then
    for row_id in
      select id
      from public.recruiting_posts
      where status = 'open'
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
