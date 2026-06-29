create or replace function public.rankball_feed_trigger_health()
returns table(trigger_name text, event_object_table text)
language sql
security definer
set search_path = public
as $$
  select
    trigger_row.trigger_name::text,
    trigger_row.event_object_table::text
  from information_schema.triggers as trigger_row
  where trigger_row.trigger_schema = 'public'
    and trigger_row.trigger_name = any(array[
      'rankball_recruiting_posts_feed_refresh',
      'rankball_recruiting_applications_feed_refresh',
      'rankball_matches_feed_refresh',
      'rankball_match_players_feed_refresh',
      'rankball_team_members_feed_dependency_refresh',
      'rankball_match_results_feed_refresh',
      'rankball_player_match_stats_feed_refresh',
      'rankball_profiles_feed_dependency_refresh',
      'rankball_teams_feed_dependency_refresh',
      'rankball_approved_courts_feed_dependency_refresh',
      'rankball_courts_feed_dependency_refresh'
    ])
  order by trigger_row.trigger_name;
$$;

revoke all on function public.rankball_feed_trigger_health() from public;
grant execute on function public.rankball_feed_trigger_health() to service_role;

create or replace function public.rankball_match_action(
  p_actor_profile_id text,
  p_action text,
  p_match_row jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := coalesce(nullif(btrim(p_action), ''), 'sync');
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  expected_updated_at timestamptz := nullif(p_match_row->>'__expectedUpdatedAt', '')::timestamptz;
  current_updated_at timestamptz;
  persist_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  if safe_action = 'agreeMatch' and p_match_row ? '__operation' then
    return public.rankball_match_agree_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
  end if;

  if safe_action = 'checkInMatchPlayer' and p_match_row ? '__operation' then
    return public.rankball_match_checkin_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
  end if;

  if safe_action = 'startMatch' and p_match_row ? '__operation' then
    return public.rankball_match_start_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{agreed_at}',
      coalesce(p_match_row->'attendance', '{}'::jsonb)
    );
  end if;

  if safe_action = 'endMatch' and p_match_row ? '__operation' then
    return public.rankball_match_end_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{ended_at}'
    );
  end if;

  select updated_at
  into current_updated_at
  from public.matches
  where id = safe_match_id
  for update;

  if expected_updated_at is not null and current_updated_at is not null and current_updated_at <> expected_updated_at then
    raise exception 'match_stale_snapshot' using errcode = '40001';
  end if;

  persist_result := public.rankball_persist_match_snapshot(
    p_match_row - '__expectedUpdatedAt',
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    p_dispute_rows,
    p_notification_rows,
    p_replace_result
  );

  return persist_result || jsonb_build_object(
    'action', safe_action,
    'actorProfileId', safe_actor_id
  );
end;
$$;

revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
grant execute on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
