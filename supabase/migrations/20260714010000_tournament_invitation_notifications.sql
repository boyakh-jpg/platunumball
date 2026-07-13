-- Surface tournament team invitations to the invited captain on web action surfaces.

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
  notification_id text;
  now_at timestamptz := now();
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if new.status = 'invited' then
    select title into tournament_title
    from public.tournaments
    where id = new.tournament_id;

    select name into team_name
    from public.teams
    where id = new.team_id and deleted_at is null;

    for captain_row in
      select user_id
      from public.team_members
      where team_id = new.team_id and role = 'captain'
    loop
      notification_id := 'tournament-invite-' || md5(new.tournament_id || ':' || new.team_id || ':' || captain_row.user_id);
      insert into public.notifications (
        id, user_id, target_user_id, title, body, tone, type, discord_event,
        read_at, payload, created_at, updated_at
      ) values (
        notification_id,
        captain_row.user_id,
        captain_row.user_id,
        '대회 팀 초대',
        coalesce(tournament_title, '대회') || '에 ' || coalesce(team_name, '내 팀') || ' 팀이 초대되었습니다. 팀장 승인이 필요합니다.',
        'match',
        'tournament_invite',
        'approval',
        null,
        jsonb_build_object(
          'tournamentId', new.tournament_id,
          'teamId', new.team_id,
          'actionRequired', true,
          'homeAction', true,
          'webPath', '/app/tournaments/' || new.tournament_id
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
  t.title || '에 ' || team.name || ' 팀이 초대되었습니다. 팀장 승인이 필요합니다.',
  'match',
  'tournament_invite',
  'approval',
  null,
  jsonb_build_object(
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
where tt.status = 'invited' and t.status = 'draft'
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

revoke all on function public.rankball_sync_tournament_invitation_notification() from public, anon, authenticated;
grant execute on function public.rankball_sync_tournament_invitation_notification() to service_role;

select pg_notify('pgrst', 'reload schema');
