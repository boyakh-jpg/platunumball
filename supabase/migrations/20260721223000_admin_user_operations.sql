create index if not exists recruiting_posts_owner_created_idx
  on public.recruiting_posts (
    (coalesce(nullif(room_state->>'ownerId', ''), nullif(player_id, ''))),
    created_at desc
  );

create index if not exists reports_player_target_status_created_idx
  on public.reports (target_id, status, created_at desc)
  where type = 'player';

create index if not exists reports_type_created_idx
  on public.reports (type, created_at desc);

create index if not exists admin_audit_log_target_type_created_idx
  on public.admin_audit_log (target_user_id, type, created_at desc);

create or replace function public.rankball_admin_user_operations(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_limit integer default 30,
  p_offset integer default 0,
  p_search text default null,
  p_risk_only boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_admin_level integer;
  safe_limit integer := greatest(1, least(60, coalesce(p_limit, 30)));
  safe_offset integer := greatest(0, least(10000, coalesce(p_offset, 0)));
  safe_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  cutoff_at timestamptz := now() - interval '30 days';
  result jsonb;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  with room_stats as (
    select
      coalesce(nullif(post.room_state->>'ownerId', ''), nullif(post.player_id, '')) as user_id,
      count(*)::integer as room_count_30d,
      count(*) filter (where post.status = 'closed')::integer as closed_room_count_30d,
      max(coalesce(post.updated_at, post.created_at)) as last_room_at
    from public.recruiting_posts post
    where post.created_at >= cutoff_at
      and coalesce(nullif(post.room_state->>'ownerId', ''), nullif(post.player_id, '')) is not null
    group by coalesce(nullif(post.room_state->>'ownerId', ''), nullif(post.player_id, ''))
  ),
  match_stats as (
    select
      player.user_id,
      count(distinct player.match_id) filter (
        where coalesce(match_row.started_at, match_row.agreed_at, match_row.created_at) >= cutoff_at
      )::integer as match_count_30d,
      count(distinct player.match_id) filter (
        where match_row.status = 'cancelled'
          and coalesce(match_row.cancelled_at, match_row.updated_at, match_row.created_at) >= cutoff_at
      )::integer as cancelled_match_count_30d,
      max(coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at)) as last_match_at
    from public.match_players player
    join public.matches match_row on match_row.id = player.match_id
    where coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at) >= cutoff_at
    group by player.user_id
  ),
  chat_stats as (
    select
      message.user_id,
      count(*)::integer as message_count_30d,
      max(message.created_at) as last_message_at
    from public.room_chat_messages message
    where message.created_at >= cutoff_at
    group by message.user_id
  ),
  filed_report_stats as (
    select
      report.user_id,
      count(*)::integer as filed_report_count_30d,
      max(report.created_at) as last_report_at
    from public.reports report
    where report.created_at >= cutoff_at
      and report.user_id is not null
    group by report.user_id
  ),
  raw_received_reports as (
    select report.id, report.target_id as user_id, report.status, report.created_at
    from public.reports report
    where report.type = 'player'
      and report.target_id is not null
      and (report.created_at >= cutoff_at or report.status = 'open')
    union
    select report.id, target.value as user_id, report.status, report.created_at
    from public.reports report
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(report.reported_user_ids) = 'array' then report.reported_user_ids else '[]'::jsonb end
    ) target(value)
    where report.type = 'player'
      and (report.created_at >= cutoff_at or report.status = 'open')
  ),
  received_report_stats as (
    select
      received.user_id,
      count(*) filter (where received.created_at >= cutoff_at)::integer as received_report_count_30d,
      count(*) filter (where received.status = 'open')::integer as open_report_count,
      max(received.created_at) as last_received_report_at
    from raw_received_reports received
    where nullif(btrim(received.user_id), '') is not null
    group by received.user_id
  ),
  discipline_stats as (
    select
      action.user_id,
      count(*)::integer as active_sanction_count,
      max(action.ends_at) filter (where action.type = 'suspension') as full_suspension_until,
      max(action.ends_at) filter (where action.type = 'public_room_suspension') as public_room_suspension_until
    from public.admin_disciplinary_actions action
    where action.status not in ('revoked', 'expired')
      and (action.starts_at is null or action.starts_at <= now())
      and (action.ends_at is null or action.ends_at >= now())
    group by action.user_id
  ),
  warning_stats as (
    select
      audit.target_user_id as user_id,
      count(*)::integer as warning_count_30d,
      max(audit.created_at) as last_warning_at
    from public.admin_audit_log audit
    where audit.type = 'manual_user_warning'
      and audit.created_at >= cutoff_at
    group by audit.target_user_id
  ),
  base as (
    select
      profile.id,
      profile.name,
      coalesce(profile.hashtag, profile.handle, profile.id) as hashtag,
      profile.position,
      profile.region,
      coalesce(profile.trust_score, 80)::integer as trust_score,
      profile.created_at,
      coalesce(summary.match_count, 0)::integer as total_match_count,
      coalesce(room.room_count_30d, 0)::integer as room_count_30d,
      coalesce(room.closed_room_count_30d, 0)::integer as closed_room_count_30d,
      coalesce(match_activity.match_count_30d, 0)::integer as match_count_30d,
      coalesce(match_activity.cancelled_match_count_30d, 0)::integer as cancelled_match_count_30d,
      coalesce(chat.message_count_30d, 0)::integer as message_count_30d,
      coalesce(filed.filed_report_count_30d, 0)::integer as filed_report_count_30d,
      coalesce(received.received_report_count_30d, 0)::integer as received_report_count_30d,
      coalesce(received.open_report_count, 0)::integer as open_report_count,
      coalesce(discipline.active_sanction_count, 0)::integer as active_sanction_count,
      discipline.full_suspension_until,
      discipline.public_room_suspension_until,
      coalesce(warning.warning_count_30d, 0)::integer as warning_count_30d,
      greatest(
        coalesce(profile.updated_at, profile.created_at, 'epoch'::timestamptz),
        coalesce(summary.last_match_at, 'epoch'::timestamptz),
        coalesce(room.last_room_at, 'epoch'::timestamptz),
        coalesce(match_activity.last_match_at, 'epoch'::timestamptz),
        coalesce(chat.last_message_at, 'epoch'::timestamptz),
        coalesce(filed.last_report_at, 'epoch'::timestamptz)
      ) as last_activity_at
    from public.profiles profile
    left join public.profile_match_summaries summary on summary.profile_id = profile.id
    left join room_stats room on room.user_id = profile.id
    left join match_stats match_activity on match_activity.user_id = profile.id
    left join chat_stats chat on chat.user_id = profile.id
    left join filed_report_stats filed on filed.user_id = profile.id
    left join received_report_stats received on received.user_id = profile.id
    left join discipline_stats discipline on discipline.user_id = profile.id
    left join warning_stats warning on warning.user_id = profile.id
  ),
  scored as (
    select
      raw.*,
      case
        when raw.risk_score >= 60 then 'high'
        when raw.risk_score >= 30 then 'review'
        when raw.risk_score >= 10 then 'watch'
        else 'normal'
      end as risk_level,
      array_remove(array[
        case when raw.active_sanction_count > 0 then 'active_discipline' end,
        case when raw.open_report_count >= 3 then 'repeated_open_reports' when raw.open_report_count >= 1 then 'open_report' end,
        case when raw.received_report_count_30d >= 5 then 'repeated_received_reports' when raw.received_report_count_30d >= 2 then 'received_reports' end,
        case when raw.trust_score < 50 then 'very_low_trust' when raw.trust_score < 70 then 'low_trust' end,
        case when raw.cancelled_match_count_30d >= 3 then 'repeated_cancelled_matches' end,
        case when raw.room_count_30d >= 20 then 'high_room_creation' end,
        case when raw.filed_report_count_30d >= 15 then 'high_report_filing' end
      ]::text[], null) as risk_signals
    from (
      select
        base.*,
        (
          case when base.active_sanction_count > 0 then 50 else 0 end
          + case when base.open_report_count >= 3 then 30 when base.open_report_count >= 1 then 15 else 0 end
          + case when base.received_report_count_30d >= 5 then 20 when base.received_report_count_30d >= 2 then 10 else 0 end
          + case when base.trust_score < 50 then 25 when base.trust_score < 70 then 10 else 0 end
          + case when base.cancelled_match_count_30d >= 3 then 20 else 0 end
          + case when base.room_count_30d >= 20 then 10 else 0 end
          + case when base.filed_report_count_30d >= 15 then 10 else 0 end
        )::integer as risk_score
      from base
    ) raw
  ),
  filtered as (
    select *
    from scored
    where (safe_search is null or lower(concat_ws(' ', name, hashtag, id, region)) like '%' || safe_search || '%')
      and (not coalesce(p_risk_only, true) or risk_score >= 10)
  ),
  paged as (
    select *
    from filtered
    order by risk_score desc, last_activity_at desc, id
    limit safe_limit
    offset safe_offset
  )
  select jsonb_build_object(
    'ok', true,
    'summary', jsonb_build_object(
      'totalUsers', (select count(*) from scored),
      'activeUsers30d', (select count(*) from scored where last_activity_at >= cutoff_at),
      'signalUsers', (select count(*) from scored where risk_score >= 10),
      'reviewUsers', (select count(*) from scored where risk_score >= 30),
      'activeSanctionUsers', (select count(*) from scored where active_sanction_count > 0),
      'newUsers30d', (select count(*) from scored where created_at >= cutoff_at),
      'warningCount30d', (select coalesce(sum(warning_count_30d), 0) from scored)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page.id,
        'name', page.name,
        'hashtag', page.hashtag,
        'position', page.position,
        'region', page.region,
        'trustScore', page.trust_score,
        'createdAt', page.created_at,
        'lastActivityAt', page.last_activity_at,
        'totalMatchCount', page.total_match_count,
        'roomCount30d', page.room_count_30d,
        'closedRoomCount30d', page.closed_room_count_30d,
        'matchCount30d', page.match_count_30d,
        'cancelledMatchCount30d', page.cancelled_match_count_30d,
        'messageCount30d', page.message_count_30d,
        'filedReportCount30d', page.filed_report_count_30d,
        'receivedReportCount30d', page.received_report_count_30d,
        'openReportCount', page.open_report_count,
        'activeSanctionCount', page.active_sanction_count,
        'fullSuspensionUntil', page.full_suspension_until,
        'publicRoomSuspensionUntil', page.public_room_suspension_until,
        'warningCount30d', page.warning_count_30d,
        'riskScore', page.risk_score,
        'riskLevel', page.risk_level,
        'riskSignals', to_jsonb(page.risk_signals)
      ) order by page.risk_score desc, page.last_activity_at desc, page.id)
      from paged page
    ), '[]'::jsonb),
    'page', jsonb_build_object(
      'limit', safe_limit,
      'offset', safe_offset,
      'total', (select count(*) from filtered),
      'nextOffset', case
        when safe_offset + (select count(*) from paged) < (select count(*) from filtered)
          then safe_offset + (select count(*) from paged)
        else null
      end,
      'hasMore', safe_offset + (select count(*) from paged) < (select count(*) from filtered)
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.rankball_commit_admin_manual_user_action(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_target_user_id text,
  p_action_type text,
  p_duration_days integer default 3,
  p_reason text default null,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
  safe_admin_level integer;
  target_admin_level integer;
  safe_target_user_id text := nullif(btrim(p_target_user_id), '');
  safe_action_type text := nullif(btrim(p_action_type), '');
  safe_duration integer := coalesce(p_duration_days, 3);
  safe_reason text := nullif(btrim(p_reason), '');
  safe_message text := nullif(btrim(p_message), '');
  disciplinary_type text;
  disciplinary_id text;
  audit_id text := 'aa_' || replace(gen_random_uuid()::text, '-', '');
  notification_id text := 'n_' || replace(gen_random_uuid()::text, '-', '');
  action_ends_at timestamptz;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if safe_target_user_id is null then
    raise exception 'target_user_required' using errcode = '23502';
  end if;
  if safe_target_user_id = p_actor_profile_id then
    raise exception 'self_admin_action_denied' using errcode = '42501';
  end if;
  if safe_action_type not in ('warning', 'publicRoomSuspend', 'suspendTarget') then
    raise exception 'unsupported_admin_user_action' using errcode = '22023';
  end if;
  if safe_reason is null or char_length(safe_reason) not between 4 and 300 then
    raise exception 'admin_user_action_reason_required' using errcode = '22023';
  end if;
  if safe_message is null or char_length(safe_message) not between 4 and 500 then
    raise exception 'admin_user_action_message_required' using errcode = '22023';
  end if;
  if safe_action_type <> 'warning' and safe_duration not in (3, 7, 14, 28, 42, 56, 168, 280) then
    raise exception 'invalid_suspension_duration' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:admin-user-action'), hashtext(safe_target_user_id));
  perform 1 from public.profiles where id = safe_target_user_id for update;
  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  target_admin_level := public.rankball_admin_level_for_profile(safe_target_user_id, 0);
  if target_admin_level > 0 and target_admin_level >= safe_admin_level then
    raise exception 'admin_target_protected' using errcode = '42501';
  end if;

  if safe_action_type <> 'warning' then
    disciplinary_type := case when safe_action_type = 'publicRoomSuspend' then 'public_room_suspension' else 'suspension' end;
    disciplinary_id := 'ad_' || replace(gen_random_uuid()::text, '-', '');
    action_ends_at := now_ts + make_interval(days => safe_duration);

    insert into public.admin_disciplinary_actions (
      id,
      user_id,
      type,
      action_type,
      status,
      created_by,
      starts_at,
      ends_at,
      payload,
      created_at,
      updated_at
    ) values (
      disciplinary_id,
      safe_target_user_id,
      disciplinary_type,
      safe_action_type,
      'active',
      p_actor_profile_id,
      now_ts,
      action_ends_at,
      jsonb_build_object(
        'id', disciplinary_id,
        'userId', safe_target_user_id,
        'type', disciplinary_type,
        'actionType', safe_action_type,
        'reason', safe_reason,
        'startsAt', now_ts,
        'endsAt', action_ends_at,
        'durationDays', safe_duration,
        'createdAt', now_ts,
        'createdBy', p_actor_profile_id,
        'status', 'active',
        'source', 'manual_user_operation'
      ),
      now_ts,
      now_ts
    );
  end if;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    target_user_id,
    created_by,
    payload,
    created_at
  ) values (
    audit_id,
    case when safe_action_type = 'warning' then 'manual_user_warning' else 'manual_user_sanction' end,
    'committed',
    safe_target_user_id,
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', case when safe_action_type = 'warning' then 'manual_user_warning' else 'manual_user_sanction' end,
      'status', 'committed',
      'actionType', safe_action_type,
      'disciplinaryActionId', disciplinary_id,
      'targetUserId', safe_target_user_id,
      'durationDays', case when safe_action_type = 'warning' then null else safe_duration end,
      'reason', safe_reason,
      'message', safe_message,
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id,
      'sourceReportId', null
    ),
    now_ts
  );

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  ) values (
    notification_id,
    safe_target_user_id,
    safe_target_user_id,
    case
      when safe_action_type = 'warning' then '운영 경고 안내'
      when safe_action_type = 'publicRoomSuspend' then '공개방 이용 제한 안내'
      else '서비스 이용 제한 안내'
    end,
    safe_message,
    'orange',
    case when safe_action_type = 'warning' then 'admin_warning' else 'disciplinary' end,
    jsonb_build_object(
      'source', 'admin_manual_user_action',
      'actionType', safe_action_type,
      'auditLogId', audit_id,
      'disciplinaryActionId', disciplinary_id,
      'durationDays', case when safe_action_type = 'warning' then null else safe_duration end,
      'endsAt', action_ends_at
    ),
    now_ts,
    now_ts
  );

  return jsonb_build_object(
    'ok', true,
    'actionType', safe_action_type,
    'targetUserId', safe_target_user_id,
    'auditLogId', audit_id,
    'disciplinaryActionId', disciplinary_id,
    'notificationId', notification_id,
    'endsAt', action_ends_at
  );
end;
$$;

revoke all on function public.rankball_admin_user_operations(text, integer, integer, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.rankball_commit_admin_manual_user_action(text, integer, text, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.rankball_admin_user_operations(text, integer, integer, integer, text, boolean) to service_role;
grant execute on function public.rankball_commit_admin_manual_user_action(text, integer, text, text, integer, text, text) to service_role;

do $migration$
declare
  function_definition text;
  old_text text := $old$      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),$old$;
  new_text text := $new$      ('rankball_admin_user_operations', 'public.rankball_admin_user_operations(text,integer,integer,integer,text,boolean)'),
      ('rankball_commit_admin_disciplinary_action', 'public.rankball_commit_admin_disciplinary_action(text,integer,text,text,text,integer,text)'),
      ('rankball_commit_admin_manual_user_action', 'public.rankball_commit_admin_manual_user_action(text,integer,text,text,integer,text,text)'),$new$;
begin
  function_definition := pg_get_functiondef('public.rankball_rpc_grant_health()'::regprocedure);
  if position(old_text in function_definition) = 0 then
    raise exception 'admin_user_operations_rpc_health_shape_changed';
  end if;
  execute replace(function_definition, old_text, new_text);
end;
$migration$;

select pg_notify('pgrst', 'reload schema');
