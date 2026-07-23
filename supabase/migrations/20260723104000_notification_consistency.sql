-- Keep app notifications canonical, ordered and linked to optional Discord delivery rows.

create or replace function public.rankball_mark_notifications_read_action(
  p_profile_id text,
  p_notification_id text default null,
  p_all boolean default false,
  p_read_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  safe_notification_id text := nullif(btrim(p_notification_id), '');
  safe_read_at timestamptz := coalesce(p_read_at, now());
  notification_ids jsonb := '[]'::jsonb;
  affected_count integer := 0;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id' using errcode = '22023';
  end if;
  if not coalesce(p_all, false) and safe_notification_id is null then
    raise exception 'missing_notification_id' using errcode = '22023';
  end if;

  with updated as (
    update public.notifications notification
    set
      read_at = coalesce(notification.read_at, safe_read_at),
      updated_at = safe_read_at
    where (
        notification.user_id = safe_profile_id
        or notification.target_user_id = safe_profile_id
      )
      and notification.due_at <= safe_read_at
      and (
        (coalesce(p_all, false) and notification.read_at is null)
        or (not coalesce(p_all, false) and notification.id = safe_notification_id)
      )
    returning notification.id
  )
  select coalesce(jsonb_agg(updated.id order by updated.id), '[]'::jsonb), count(*)::integer
  into notification_ids, affected_count
  from updated;

  return jsonb_build_object(
    'ok', true,
    'all', coalesce(p_all, false),
    'count', affected_count,
    'notificationIds', notification_ids,
    'readAt', safe_read_at
  );
end;
$$;

revoke all on function public.rankball_mark_notifications_read_action(text, text, boolean, timestamptz)
from public, anon, authenticated;
grant execute on function public.rankball_mark_notifications_read_action(text, text, boolean, timestamptz)
to service_role;

create or replace function public.rankball_create_match_terminal_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  notice_prefix text;
  notice_title text;
  notice_body text;
  notice_type text;
  notice_action text;
  notice_tone text := 'match';
  now_at timestamptz := now();
begin
  if lower(coalesce(old.status, '')) = lower(coalesce(new.status, '')) then
    return new;
  end if;
  if lower(coalesce(new.status, '')) not in ('cancelled', 'canceled', 'void', 'voided') then
    return new;
  end if;
  if lower(coalesce(new.status, '')) in ('cancelled', 'canceled')
     and coalesce(new.rules->>'recordType', '') = 'solo' then
    return new;
  end if;

  if lower(coalesce(new.status, '')) in ('cancelled', 'canceled') then
    notice_prefix := 'match-cancelled';
    notice_type := 'match_cancelled';
    notice_action := 'cancelMatch';
    notice_title := case
      when coalesce(new.rules->>'recordType', '') = 'match_record' then '기록 취소'
      else '경기 취소'
    end;
    notice_body := case
      when coalesce(new.rules->>'recordType', '') = 'match_record' then format('%s 기록이 취소됐습니다.', new.title)
      else format('%s 경기방이 취소됐습니다.', new.title)
    end;
  else
    notice_prefix := 'match-voided';
    notice_type := 'match_voided';
    notice_action := 'voidMatch';
    notice_title := '경기 무효 처리';
    notice_tone := 'orange';
    notice_body := format(
      '%s 경기가 무효 처리됐습니다.%s',
      new.title,
      case when nullif(btrim(new.void_reason), '') is null then '' else ' 사유: ' || new.void_reason end
    );
  end if;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id,
    discord_event, read_at, payload, created_at, updated_at
  )
  select
    'notice-' || notice_prefix || '-' || new.id || '-' || recipient.profile_id,
    recipient.profile_id,
    recipient.profile_id,
    notice_title,
    notice_body,
    notice_tone,
    notice_type,
    new.id,
    'match',
    null,
    jsonb_build_object(
      'matchId', new.id,
      'targetUserId', recipient.profile_id,
      'targetStatus', new.status,
      'targetUnavailable', true,
      'action', notice_action,
      'actionRequired', false,
      'homeAction', false,
      'skipDiscordSync', true,
      'source', 'match_terminal_status_trigger'
    ),
    now_at,
    now_at
  from (
    select distinct nullif(btrim(candidate.profile_id), '') as profile_id
    from (
      select new.created_by as profile_id
      union all select new.referee_id
      union all select new.former_referee_id
      union all select player.user_id from public.match_players player where player.match_id = new.id
      union all
      select reserve_player.profile_id
      from jsonb_each(
        case when jsonb_typeof(new.reserve_players) = 'object' then new.reserve_players else '{}'::jsonb end
      ) reserve_side
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(reserve_side.value) = 'array' then reserve_side.value else '[]'::jsonb end
      ) reserve_player(profile_id)
      union all
      select played_player.profile_id
      from jsonb_each(
        case when jsonb_typeof(new.played_player_ids) = 'object' then new.played_player_ids else '{}'::jsonb end
      ) played_side
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(played_side.value) = 'array' then played_side.value else '[]'::jsonb end
      ) played_player(profile_id)
      union all
      select attendee.profile_id
      from jsonb_each(
        case when jsonb_typeof(new.attendance) = 'object' then new.attendance else '{}'::jsonb end
      ) attendance_side
      cross join lateral jsonb_array_elements_text(
        case when jsonb_typeof(attendance_side.value) = 'array' then attendance_side.value else '[]'::jsonb end
      ) attendee(profile_id)
    ) candidate
  ) recipient
  where recipient.profile_id is not null
  on conflict (id) do update
  set
    title = excluded.title,
    body = excluded.body,
    tone = excluded.tone,
    type = excluded.type,
    target_user_id = excluded.target_user_id,
    discord_event = excluded.discord_event,
    payload = excluded.payload,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists matches_create_terminal_notifications on public.matches;
create trigger matches_create_terminal_notifications
after update of status on public.matches
for each row
execute function public.rankball_create_match_terminal_notifications();

create or replace function public.rankball_suppress_legacy_match_terminal_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient_id text := coalesce(nullif(btrim(new.target_user_id), ''), nullif(btrim(new.user_id), ''));
  notice_prefix text;
  canonical_id text;
begin
  if new.match_id is null or recipient_id is null or new.id not like 'n\_%' escape '\' then
    return new;
  end if;
  if coalesce(new.payload->>'action', '') = 'cancelMatch'
     and coalesce(new.payload->>'source', '') = 'match_terminal_action' then
    notice_prefix := 'match-cancelled';
  elsif coalesce(new.payload->>'action', '') = 'voidMatch' then
    notice_prefix := 'match-voided';
  else
    return new;
  end if;

  canonical_id := 'notice-' || notice_prefix || '-' || new.match_id || '-' || recipient_id;
  if exists (select 1 from public.notifications notification where notification.id = canonical_id) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_suppress_legacy_match_terminal on public.notifications;
create trigger notifications_suppress_legacy_match_terminal
before insert on public.notifications
for each row
execute function public.rankball_suppress_legacy_match_terminal_notification();

-- Preserve existing rows but hide already duplicated legacy terminal notices.
update public.notifications legacy
set
  payload = coalesce(legacy.payload, '{}'::jsonb) || jsonb_build_object(
    'supersededBy', canonical.id,
    'skipDiscordSync', true
  ),
  read_at = coalesce(legacy.read_at, now()),
  updated_at = now()
from public.notifications canonical
where legacy.id <> canonical.id
  and legacy.match_id = canonical.match_id
  and coalesce(legacy.target_user_id, legacy.user_id) = coalesce(canonical.target_user_id, canonical.user_id)
  and (
    (coalesce(legacy.payload->>'action', '') = 'cancelMatch' and canonical.type = 'match_cancelled')
    or (coalesce(legacy.payload->>'action', '') = 'voidMatch' and canonical.type = 'match_voided')
  );

-- Older match delivery rows used their own id as notification_id. Relink when the app notice exists.
update public.discord_notification_deliveries delivery
set
  notification_id = 'notice-' || substring(delivery.id from 9),
  payload = coalesce(delivery.payload, '{}'::jsonb) || jsonb_build_object(
    'notificationId', 'notice-' || substring(delivery.id from 9)
  ),
  updated_at = now()
where delivery.id like 'discord-match-%'
  and delivery.notification_id is distinct from 'notice-' || substring(delivery.id from 9)
  and exists (
    select 1
    from public.notifications notification
    where notification.id = 'notice-' || substring(delivery.id from 9)
  )
  and not exists (
    select 1
    from public.discord_notification_deliveries other
    where other.id <> delivery.id
      and other.notification_id = 'notice-' || substring(delivery.id from 9)
      and other.target_user_id = delivery.target_user_id
  );

revoke all on function public.rankball_create_match_terminal_notifications() from public, anon, authenticated;
revoke all on function public.rankball_suppress_legacy_match_terminal_notification() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
