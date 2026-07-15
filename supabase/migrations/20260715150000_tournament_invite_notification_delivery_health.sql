-- Keep tournament team invitations visible on web and queued for Discord opt-in captains.

create or replace function public.rankball_sync_tournament_invitation_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_title text;
  team_name text;
  captain_row record;
  notice_id text;
  delivery_id text;
  title_text text := '대회 팀 초대';
  body_text text;
  web_path text;
  now_at timestamptz := now();
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  web_path := '/app/tournaments/' || new.tournament_id;

  if new.status = 'invited' then
    select title into tournament_title
    from public.tournaments
    where id = new.tournament_id;

    select name into team_name
    from public.teams
    where id = new.team_id and deleted_at is null;

    body_text := coalesce(tournament_title, '대회') || '에 ' || coalesce(team_name, '팀') || ' 팀이 초대되었습니다. 팀장 승인이 필요합니다.';

    for captain_row in
      select
        team_member.user_id,
        nullif(btrim(profile.discord_user_id), '') as discord_user_id,
        coalesce(profile.app_settings, '{}'::jsonb) as app_settings
      from public.team_members team_member
      join public.profiles profile on profile.id = team_member.user_id
      where team_member.team_id = new.team_id
        and team_member.role = 'captain'
    loop
      notice_id := 'tournament-invite-' || md5(new.tournament_id || ':' || new.team_id || ':' || captain_row.user_id);

      insert into public.notifications (
        id, user_id, target_user_id, title, body, tone, type, discord_event,
        read_at, payload, created_at, updated_at
      ) values (
        notice_id,
        captain_row.user_id,
        captain_row.user_id,
        title_text,
        body_text,
        'match',
        'tournament_invite',
        'approval',
        null,
        jsonb_build_object(
          'id', notice_id,
          'targetUserId', captain_row.user_id,
          'tournamentId', new.tournament_id,
          'teamId', new.team_id,
          'actionRequired', true,
          'homeAction', true,
          'webPath', web_path
        ),
        now_at,
        now_at
      )
      on conflict (id) do update set
        user_id = excluded.user_id,
        target_user_id = excluded.target_user_id,
        title = excluded.title,
        body = excluded.body,
        tone = excluded.tone,
        type = excluded.type,
        discord_event = excluded.discord_event,
        read_at = null,
        payload = excluded.payload,
        updated_at = excluded.updated_at;

      if captain_row.discord_user_id is not null
        and coalesce((captain_row.app_settings #>> '{notificationChannels,discord,enabled}')::boolean, false)
        and coalesce((captain_row.app_settings #>> '{notificationChannels,discord,events,approval}')::boolean, true) then
        delivery_id := 'discord-tournament-invite-' || md5(notice_id || ':' || captain_row.user_id);

        insert into public.discord_notification_deliveries (
          id, notification_id, target_user_id, discord_user_id, event, status,
          payload, queued_at, send_at, sent_at, failed_at, last_error, created_at, updated_at
        ) values (
          delivery_id,
          notice_id,
          captain_row.user_id,
          captain_row.discord_user_id,
          'approval',
          'queued',
          jsonb_build_object(
            'id', delivery_id,
            'notificationId', notice_id,
            'targetUserId', captain_row.user_id,
            'discordUserId', captain_row.discord_user_id,
            'event', 'approval',
            'tournamentId', new.tournament_id,
            'teamId', new.team_id,
            'title', title_text,
            'body', body_text,
            'webPath', web_path,
            'status', 'queued',
            'queuedAt', now_at,
            'sendAt', now_at,
            'actions', jsonb_build_array(jsonb_build_object(
              'id', 'openTournament',
              'label', '대회 보기',
              'style', 'primary',
              'customId', 'rankball:tournament:' || new.tournament_id
            ))
          ),
          now_at,
          now_at,
          null,
          null,
          null,
          now_at,
          now_at
        )
        on conflict (id) do update set
          notification_id = excluded.notification_id,
          target_user_id = excluded.target_user_id,
          discord_user_id = excluded.discord_user_id,
          event = excluded.event,
          status = 'queued',
          payload = excluded.payload,
          send_at = excluded.send_at,
          failed_at = null,
          last_error = null,
          updated_at = excluded.updated_at
        where public.discord_notification_deliveries.sent_at is null;
      end if;
    end loop;
  else
    update public.notifications
    set read_at = coalesce(read_at, now_at),
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'actionRequired', false,
          'homeAction', false,
          'resolvedStatus', new.status
        ),
        updated_at = now_at
    where type = 'tournament_invite'
      and payload->>'tournamentId' = new.tournament_id
      and payload->>'teamId' = new.team_id;

    update public.discord_notification_deliveries
    set status = 'cancelled',
        last_error = 'tournament_invite_resolved',
        updated_at = now_at
    where status = 'queued'
      and sent_at is null
      and notification_id in (
        select id
        from public.notifications
        where type = 'tournament_invite'
          and payload->>'tournamentId' = new.tournament_id
          and payload->>'teamId' = new.team_id
      );
  end if;

  return new;
end;
$$;

drop trigger if exists rankball_tournament_invitation_notification_trigger on public.tournament_teams;
create trigger rankball_tournament_invitation_notification_trigger
after insert or update of status on public.tournament_teams
for each row execute function public.rankball_sync_tournament_invitation_notification();

insert into public.notifications (
  id, user_id, target_user_id, title, body, tone, type, discord_event,
  read_at, payload, created_at, updated_at
)
select
  'tournament-invite-' || md5(tt.tournament_id || ':' || tt.team_id || ':' || tm.user_id),
  tm.user_id,
  tm.user_id,
  '대회 팀 초대',
  coalesce(t.title, '대회') || '에 ' || coalesce(team.name, '팀') || ' 팀이 초대되었습니다. 팀장 승인이 필요합니다.',
  'match',
  'tournament_invite',
  'approval',
  null,
  jsonb_build_object(
    'id', 'tournament-invite-' || md5(tt.tournament_id || ':' || tt.team_id || ':' || tm.user_id),
    'targetUserId', tm.user_id,
    'tournamentId', tt.tournament_id,
    'teamId', tt.team_id,
    'actionRequired', true,
    'homeAction', true,
    'webPath', '/app/tournaments/' || tt.tournament_id
  ),
  tt.created_at,
  now()
from public.tournament_teams tt
join public.tournaments t on t.id = tt.tournament_id
join public.teams team on team.id = tt.team_id and team.deleted_at is null
join public.team_members tm on tm.team_id = tt.team_id and tm.role = 'captain'
where tt.status = 'invited'
  and t.status = 'draft'
on conflict (id) do update set
  user_id = excluded.user_id,
  target_user_id = excluded.target_user_id,
  title = excluded.title,
  body = excluded.body,
  tone = excluded.tone,
  type = excluded.type,
  discord_event = excluded.discord_event,
  read_at = null,
  payload = excluded.payload,
  updated_at = excluded.updated_at;

insert into public.discord_notification_deliveries (
  id, notification_id, target_user_id, discord_user_id, event, status,
  payload, queued_at, send_at, sent_at, failed_at, last_error, created_at, updated_at
)
select
  'discord-tournament-invite-' || md5(notification.id || ':' || notification.target_user_id),
  notification.id,
  notification.target_user_id,
  profile.discord_user_id,
  'approval',
  'queued',
  jsonb_build_object(
    'id', 'discord-tournament-invite-' || md5(notification.id || ':' || notification.target_user_id),
    'notificationId', notification.id,
    'targetUserId', notification.target_user_id,
    'discordUserId', profile.discord_user_id,
    'event', 'approval',
    'tournamentId', notification.payload->>'tournamentId',
    'teamId', notification.payload->>'teamId',
    'title', notification.title,
    'body', notification.body,
    'webPath', notification.payload->>'webPath',
    'status', 'queued',
    'queuedAt', now(),
    'sendAt', now(),
    'actions', jsonb_build_array(jsonb_build_object(
      'id', 'openTournament',
      'label', '대회 보기',
      'style', 'primary',
      'customId', 'rankball:tournament:' || (notification.payload->>'tournamentId')
    ))
  ),
  now(),
  now(),
  null,
  null,
  null,
  now(),
  now()
from public.notifications notification
join public.profiles profile on profile.id = notification.target_user_id
where notification.type = 'tournament_invite'
  and notification.read_at is null
  and nullif(btrim(profile.discord_user_id), '') is not null
  and coalesce((coalesce(profile.app_settings, '{}'::jsonb) #>> '{notificationChannels,discord,enabled}')::boolean, false)
  and coalesce((coalesce(profile.app_settings, '{}'::jsonb) #>> '{notificationChannels,discord,events,approval}')::boolean, true)
on conflict (id) do update set
  notification_id = excluded.notification_id,
  target_user_id = excluded.target_user_id,
  discord_user_id = excluded.discord_user_id,
  event = excluded.event,
  status = 'queued',
  payload = excluded.payload,
  send_at = excluded.send_at,
  failed_at = null,
  last_error = null,
  updated_at = excluded.updated_at
where public.discord_notification_deliveries.sent_at is null;

create or replace function public.rankball_tournament_invitation_health()
returns table(check_name text, ok boolean, detail jsonb)
language sql
security definer
set search_path = public
as $$
  with invited_captains as (
    select tt.tournament_id, tt.team_id, tm.user_id
    from public.tournament_teams tt
    join public.tournaments t on t.id = tt.tournament_id
    join public.team_members tm on tm.team_id = tt.team_id and tm.role = 'captain'
    where tt.status = 'invited'
      and t.status = 'draft'
  ),
  missing_notifications as (
    select invited.*
    from invited_captains invited
    where not exists (
      select 1
      from public.notifications notification
      where notification.type = 'tournament_invite'
        and notification.target_user_id = invited.user_id
        and notification.read_at is null
        and notification.payload->>'tournamentId' = invited.tournament_id
        and notification.payload->>'teamId' = invited.team_id
        and coalesce((notification.payload->>'actionRequired')::boolean, false)
        and coalesce((notification.payload->>'homeAction')::boolean, false)
    )
  ),
  discord_targets as (
    select invited.*, profile.discord_user_id
    from invited_captains invited
    join public.profiles profile on profile.id = invited.user_id
    where nullif(btrim(profile.discord_user_id), '') is not null
      and coalesce((coalesce(profile.app_settings, '{}'::jsonb) #>> '{notificationChannels,discord,enabled}')::boolean, false)
      and coalesce((coalesce(profile.app_settings, '{}'::jsonb) #>> '{notificationChannels,discord,events,approval}')::boolean, true)
  ),
  missing_discord_deliveries as (
    select target.*
    from discord_targets target
    where not exists (
      select 1
      from public.notifications notification
      join public.discord_notification_deliveries delivery on delivery.notification_id = notification.id
      where notification.type = 'tournament_invite'
        and notification.target_user_id = target.user_id
        and notification.payload->>'tournamentId' = target.tournament_id
        and notification.payload->>'teamId' = target.team_id
        and delivery.target_user_id = target.user_id
        and delivery.discord_user_id = target.discord_user_id
        and delivery.event = 'approval'
        and delivery.status <> 'cancelled'
    )
  ),
  checks as (
    select
      'tournament_invitation_trigger'::text as check_name,
      exists (
        select 1
        from pg_trigger
        where tgrelid = 'public.tournament_teams'::regclass
          and tgname = 'rankball_tournament_invitation_notification_trigger'
          and not tgisinternal
          and tgenabled <> 'D'
      ) as ok,
      jsonb_build_object('trigger', 'rankball_tournament_invitation_notification_trigger') as detail
    union all
    select
      'tournament_invitation_function',
      to_regprocedure('public.rankball_sync_tournament_invitation_notification()') is not null,
      jsonb_build_object('function', 'rankball_sync_tournament_invitation_notification')
    union all
    select
      'tournament_invitation_notifications_complete',
      not exists (select 1 from missing_notifications),
      jsonb_build_object('missingCount', (select count(*) from missing_notifications))
    union all
    select
      'tournament_invitation_discord_deliveries_complete',
      not exists (select 1 from missing_discord_deliveries),
      jsonb_build_object('missingCount', (select count(*) from missing_discord_deliveries))
  )
  select check_name, ok, detail
  from checks
  order by check_name;
$$;

revoke all on function public.rankball_sync_tournament_invitation_notification() from public;
revoke all on function public.rankball_sync_tournament_invitation_notification() from anon;
revoke all on function public.rankball_sync_tournament_invitation_notification() from authenticated;
grant execute on function public.rankball_sync_tournament_invitation_notification() to service_role;

revoke all on function public.rankball_tournament_invitation_health() from public;
revoke all on function public.rankball_tournament_invitation_health() from anon;
revoke all on function public.rankball_tournament_invitation_health() from authenticated;
grant execute on function public.rankball_tournament_invitation_health() to service_role;

select pg_notify('pgrst', 'reload schema');
