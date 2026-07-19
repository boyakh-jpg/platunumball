-- Keep feed cache writes server-only and serialize rating commits consistently.
revoke all on function public.rankball_upsert_room_feed_card(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_upsert_room_feed_card(text, text, jsonb)
to service_role;

revoke all on function public.rankball_upsert_room_feed(
  text, text, text, text, text, text, text, timestamptz, jsonb
)
from public, anon, authenticated;
grant execute on function public.rankball_upsert_room_feed(
  text, text, text, text, text, text, text, timestamptz, jsonb
)
to service_role;

do $migration$
declare
  function_definition text;
  old_team_average text := $old$
    select coalesce(avg(mmr), 1200) into opponent_team_avg
    from public.teams
    where id in (select distinct team_id from public.match_players where match_id = safe_match_id and side <> team_row.side and team_id is not null);
$old$;
  new_team_average text := $new$
    select coalesce(avg(coalesce(
      (
        coalesce(
          nullif(current_setting('rankball.team_mmr_snapshot', true), '')::jsonb,
          '{}'::jsonb
        ) ->> opponent.team_id
      )::numeric,
      1200
    )), 1200) into opponent_team_avg
    from (
      select distinct team_id
      from public.match_players
      where match_id = safe_match_id
        and side <> team_row.side
        and team_id is not null
    ) opponent;
$new$;
begin
  if to_regprocedure('public.rankball_match_finalize_locked(text,text,text)') is null then
    raise exception 'rankball_match_finalize_locked_missing' using errcode = '42883';
  end if;

  if to_regprocedure('public.rankball_match_finalize_locked_concurrency_inner(text,text,text)') is null then
    function_definition := pg_get_functiondef(
      'public.rankball_match_finalize_locked(text,text,text)'::regprocedure
    );
    function_definition := replace(
      function_definition,
      'CREATE OR REPLACE FUNCTION public.rankball_match_finalize_locked(',
      'CREATE OR REPLACE FUNCTION public.rankball_match_finalize_locked_concurrency_inner('
    );
    if position(old_team_average in function_definition) = 0 then
      raise exception 'rankball_match_finalize_team_average_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_team_average, new_team_average);
    execute function_definition;
  end if;

  if to_regprocedure('public.rankball_match_approval_action_concurrency_inner(text,text,text,text)') is null then
    function_definition := pg_get_functiondef(
      'public.rankball_match_approval_action(text,text,text,text)'::regprocedure
    );
    function_definition := replace(
      function_definition,
      'CREATE OR REPLACE FUNCTION public.rankball_match_approval_action(',
      'CREATE OR REPLACE FUNCTION public.rankball_match_approval_action_concurrency_inner('
    );
    execute function_definition;
  end if;

  if to_regprocedure('public.rankball_match_resume_approval_action_concurrency_inner(text,text,jsonb)') is null then
    function_definition := pg_get_functiondef(
      'public.rankball_match_resume_approval_action(text,text,jsonb)'::regprocedure
    );
    function_definition := replace(
      function_definition,
      'CREATE OR REPLACE FUNCTION public.rankball_match_resume_approval_action(',
      'CREATE OR REPLACE FUNCTION public.rankball_match_resume_approval_action_concurrency_inner('
    );
    execute function_definition;
  end if;
end;
$migration$;

revoke all on function public.rankball_match_finalize_locked_concurrency_inner(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_approval_action_concurrency_inner(text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_resume_approval_action_concurrency_inner(text, text, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.rankball_match_finalize_locked(
  p_actor_profile_id text,
  p_match_id text,
  p_action text default 'approveMatch'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  tournament_lock_id text;
  team_mmr_snapshot jsonb := '{}'::jsonb;
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  select nullif(btrim(match.tournament_id), '')
  into tournament_lock_id
  from public.matches match
  where match.id = safe_match_id;

  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('rankball:tournament'),
      hashtext(tournament_lock_id)
    );
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select *
  into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  perform profile.id
  from public.profiles profile
  where profile.id in (
    select distinct player_id
    from (
      select player.user_id as player_id
      from public.match_players player
      where player.match_id = safe_match_id
        and nullif(btrim(player.user_id), '') is not null
      union all
      select played.value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
            then current_match.played_player_ids->'teamA'
          else '[]'::jsonb
        end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
      union all
      select played.value
      from jsonb_array_elements_text(
        case
          when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
            then current_match.played_player_ids->'teamB'
          else '[]'::jsonb
        end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
    ) actual_profiles
  )
  order by profile.id
  for update;

  perform team.id
  from public.teams team
  where team.id in (
    select distinct team_id
    from (
      select player.team_id
      from public.match_players player
      where player.match_id = safe_match_id
        and nullif(btrim(player.team_id), '') is not null
      union all select current_match.team_a_id
      union all select current_match.team_b_id
    ) actual_teams
    where nullif(btrim(team_id), '') is not null
  )
  order by team.id
  for update;

  select coalesce(
    jsonb_object_agg(team.id, coalesce(team.mmr, 1200)),
    '{}'::jsonb
  )
  into team_mmr_snapshot
  from public.teams team
  where team.id in (
    select distinct player.team_id
    from public.match_players player
    where player.match_id = safe_match_id
      and nullif(btrim(player.team_id), '') is not null
  );
  perform set_config('rankball.team_mmr_snapshot', team_mmr_snapshot::text, true);

  return public.rankball_match_finalize_locked_concurrency_inner(
    safe_actor_id,
    safe_match_id,
    p_action
  );
end;
$$;

create or replace function public.rankball_match_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  tournament_lock_id text;
begin
  select nullif(btrim(match.tournament_id), '')
  into tournament_lock_id
  from public.matches match
  where match.id = safe_match_id;

  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('rankball:tournament'),
      hashtext(tournament_lock_id)
    );
  end if;

  return public.rankball_match_approval_action_concurrency_inner(
    p_actor_profile_id,
    p_match_id,
    p_side,
    p_player_id
  );
end;
$$;

create or replace function public.rankball_match_resume_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result_draft jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  tournament_lock_id text;
begin
  select nullif(btrim(match.tournament_id), '')
  into tournament_lock_id
  from public.matches match
  where match.id = safe_match_id;

  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('rankball:tournament'),
      hashtext(tournament_lock_id)
    );
  end if;

  return public.rankball_match_resume_approval_action_concurrency_inner(
    p_actor_profile_id,
    p_match_id,
    p_result_draft
  );
end;
$$;

revoke all on function public.rankball_match_finalize_locked(text, text, text)
from public, anon, authenticated;
revoke all on function public.rankball_match_approval_action(text, text, text, text)
from public, anon, authenticated;
revoke all on function public.rankball_match_resume_approval_action(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text)
to service_role;
grant execute on function public.rankball_match_approval_action(text, text, text, text)
to service_role;
grant execute on function public.rankball_match_resume_approval_action(text, text, jsonb)
to service_role;

create or replace function public.rankball_prune_terminal_room_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_terminal boolean := false;
begin
  if tg_table_name = 'matches' then
    is_terminal := lower(coalesce(new.status, '')) in (
      'cancelled', 'canceled', 'void', 'voided', 'closed'
    );
  elsif tg_table_name = 'recruiting_posts' then
    is_terminal := lower(coalesce(new.status, '')) in (
      'cancelled', 'canceled', 'closed', 'expired'
    );
  end if;

  if not is_terminal
     or lower(coalesce(old.status, '')) = lower(coalesce(new.status, '')) then
    return new;
  end if;

  delete from public.discord_notification_deliveries delivery
  where (
      (
        (tg_table_name = 'matches' and delivery.payload->>'matchId' = new.id)
        or (
          tg_table_name = 'recruiting_posts'
          and coalesce(
            delivery.payload->>'recruitingPostId',
            delivery.payload->>'postId'
          ) = new.id
        )
      )
      and not public.rankball_is_terminal_room_notice(
        delivery.event,
        delivery.payload->>'title',
        delivery.event,
        delivery.payload
      )
    )
    or exists (
      select 1
      from public.notifications notification
      where (
          (tg_table_name = 'matches' and notification.match_id = new.id)
          or (
            tg_table_name = 'recruiting_posts'
            and notification.recruiting_post_id = new.id
          )
        )
        and not public.rankball_is_terminal_room_notice(
          notification.type,
          notification.title,
          notification.discord_event,
          notification.payload
        )
        and (
          delivery.notification_id = notification.id
          or delivery.payload->>'notificationId' = notification.id
        )
    );

  delete from public.notifications notification
  where (
      (tg_table_name = 'matches' and notification.match_id = new.id)
      or (
        tg_table_name = 'recruiting_posts'
        and notification.recruiting_post_id = new.id
      )
    )
    and not public.rankball_is_terminal_room_notice(
      notification.type,
      notification.title,
      notification.discord_event,
      notification.payload
    );

  return new;
end;
$$;

revoke all on function public.rankball_prune_terminal_room_notifications()
from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
