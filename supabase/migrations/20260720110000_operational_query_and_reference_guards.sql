-- Keep due notifications, recorder lists, referee authority, and active references authoritative.

alter table public.notifications
  add column if not exists due_at timestamptz;

create or replace function public.rankball_set_notification_due_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_due_at text;
begin
  raw_due_at := coalesce(
    nullif(btrim(new.payload->>'sendAt'), ''),
    nullif(btrim(new.payload->>'dueAt'), '')
  );
  if raw_due_at is not null then
    begin
      new.due_at := raw_due_at::timestamptz;
    exception when others then
      new.due_at := coalesce(new.due_at, new.created_at, now());
    end;
  else
    new.due_at := coalesce(new.due_at, new.created_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_notifications_due_at on public.notifications;
create trigger rankball_notifications_due_at
before insert or update of payload, due_at on public.notifications
for each row execute function public.rankball_set_notification_due_at();

update public.notifications set due_at = null where due_at is null;
alter table public.notifications alter column due_at set default now();
alter table public.notifications alter column due_at set not null;

create index if not exists notifications_target_due_created_idx
  on public.notifications (target_user_id, due_at, created_at desc);
create index if not exists notifications_user_due_created_idx
  on public.notifications (user_id, due_at, created_at desc);

update public.matches
set referee_id = null, updated_at = now()
where referee_id is not null and btrim(referee_id) = '';

alter table public.matches drop constraint if exists matches_referee_id_nonblank_check;
alter table public.matches
  add constraint matches_referee_id_nonblank_check
  check (referee_id is null or btrim(referee_id) <> '') not valid;
alter table public.matches validate constraint matches_referee_id_nonblank_check;

create or replace function public.rankball_is_match_referee_eligible(
  p_profile_id text,
  p_match_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches match_row
    join public.profiles profile on profile.id = nullif(btrim(p_profile_id), '')
    join public.referee_appointments appointment on appointment.user_id = profile.id
    where match_row.id = nullif(btrim(p_match_id), '')
      and nullif(btrim(match_row.referee_id), '') = profile.id
      and appointment.role = 'referee'
      and appointment.grade in ('candidate', 'silver', 'gold', 'platinum', 'official')
      and appointment.status = 'active'
      and (appointment.starts_at is null or appointment.starts_at <= now())
      and (appointment.ends_at is null or appointment.ends_at > now())
      and coalesce(profile.trust_score, 80) >= coalesce(match_row.referee_trust_min, 90)
  );
$$;

do $$
begin
  if to_regprocedure('public.rankball_match_result_action_referee_guard_inner(text,text,jsonb)') is null then
    alter function public.rankball_match_result_action(text, text, jsonb)
      rename to rankball_match_result_action_referee_guard_inner;
  end if;
end;
$$;

create or replace function public.rankball_match_result_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  assigned_referee_id text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match_result_actor_or_match' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select nullif(btrim(referee_id), '') into assigned_referee_id
  from public.matches where id = safe_match_id for update;
  if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_actor_id = assigned_referee_id
     and not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'referee_not_eligible' using errcode = '42501';
  end if;
  return public.rankball_match_result_action_referee_guard_inner(
    safe_actor_id,
    safe_match_id,
    coalesce(p_result, '{}'::jsonb)
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_match_dispute_action_bounded_inner(text,text,jsonb)') is null then
    alter function public.rankball_match_dispute_action(text, text, jsonb)
      rename to rankball_match_dispute_action_bounded_inner;
  end if;
end;
$$;

create or replace function public.rankball_match_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_request jsonb default '""'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  assigned_referee_id text;
  requested_points_text text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then raise exception 'missing_match' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_dispute_request, '{}'::jsonb)) = 'object'
     and nullif(btrim(p_dispute_request->>'playerId'), '') = safe_actor_id then
    requested_points_text := nullif(btrim(p_dispute_request->>'requestedPoints'), '');
    if requested_points_text ~ '^[0-9]+(\.[0-9]+)?$'
       and round(requested_points_text::numeric) > 999 then
      raise exception 'match_stat_value_out_of_range' using errcode = '22023';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select nullif(btrim(referee_id), '') into assigned_referee_id
  from public.matches where id = safe_match_id for update;
  if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_actor_id = assigned_referee_id
     and not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'referee_not_eligible' using errcode = '42501';
  end if;
  return public.rankball_match_dispute_action_bounded_inner(
    safe_actor_id,
    safe_match_id,
    coalesce(p_dispute_request, '""'::jsonb)
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_match_resume_approval_action_referee_guard_inner(text,text,jsonb)') is null then
    alter function public.rankball_match_resume_approval_action(text, text, jsonb)
      rename to rankball_match_resume_approval_action_referee_guard_inner;
  end if;
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
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  assigned_referee_id text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then raise exception 'missing_match_actor' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select nullif(btrim(referee_id), '') into assigned_referee_id
  from public.matches where id = safe_match_id for update;
  if not found then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_actor_id = assigned_referee_id
     and not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'referee_not_eligible' using errcode = '42501';
  end if;
  return public.rankball_match_resume_approval_action_referee_guard_inner(
    safe_actor_id,
    safe_match_id,
    p_result_draft
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_delete_team_reference_guard_inner(text,text,jsonb)') is null then
    alter function public.rankball_delete_team(text, text, jsonb)
      rename to rankball_delete_team_reference_guard_inner;
  end if;
end;
$$;

create or replace function public.rankball_delete_team(
  p_actor_profile_id text,
  p_team_id text,
  p_notifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_team_id text := nullif(btrim(p_team_id), '');
  deleted_at_value timestamptz;
  reducer_result jsonb;
begin
  if safe_actor_id is null then raise exception 'missing_actor_profile_id' using errcode = '42501'; end if;
  if safe_team_id is null then raise exception 'missing_team_id' using errcode = '23502'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:team'), hashtext(safe_team_id));
  select deleted_at into deleted_at_value from public.teams where id = safe_team_id for update;
  if not found then raise exception 'team_not_found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.team_members
    where team_id = safe_team_id and user_id = safe_actor_id and role = 'captain'
  ) and deleted_at_value is null then
    raise exception 'team_delete_permission_denied' using errcode = '42501';
  end if;
  if deleted_at_value is null and (
    exists (
      select 1 from public.matches match_row
      where safe_team_id in (match_row.team_a_id, match_row.team_b_id)
        and match_row.status in ('contract', 'agreed', 'approval', 'disputed')
    )
    or exists (
      select 1
      from public.tournament_teams tournament_team
      join public.tournaments tournament on tournament.id = tournament_team.tournament_id
      where tournament_team.team_id = safe_team_id
        and tournament_team.status in ('invited', 'accepted')
        and tournament.status in ('draft', 'scheduled', 'active')
    )
    or exists (
      select 1 from public.recruiting_posts post
      where post.status = 'open'
        and safe_team_id in (post.team_id, post.target_team_id)
    )
    or exists (
      select 1
      from public.recruiting_applications application
      join public.recruiting_posts post on post.id = application.post_id
      where post.status = 'open'
        and safe_team_id in (application.team_id, application.source_team_id)
    )
  ) then
    raise exception 'team_has_active_references' using errcode = '23514';
  end if;
  reducer_result := public.rankball_delete_team_reference_guard_inner(
    safe_actor_id,
    safe_team_id,
    coalesce(p_notifications, '[]'::jsonb)
  );
  update public.team_invitations
  set status = 'expired', updated_at = now()
  where team_id = safe_team_id and status = 'pending';
  return reducer_result || jsonb_build_object('activeReferencesGuarded', true);
end;
$$;

update public.matches match_row
set tournament_format = tournament.format,
    updated_at = now()
from public.tournaments tournament
where tournament.id = match_row.tournament_id
  and match_row.tournament_format is distinct from tournament.format;

create or replace function public.rankball_tournament_advance_on_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  authoritative_format text;
begin
  if new.tournament_id is not null
     and new.status = 'confirmed'
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.score_a is distinct from new.score_a
       or old.score_b is distinct from new.score_b
     ) then
    select format into authoritative_format
    from public.tournaments where id = new.tournament_id for update;
    if authoritative_format = 'tournament' then
      perform public.rankball_tournament_advance_locked(new.tournament_id);
    elsif authoritative_format = 'league' then
      perform public.rankball_league_finalize_locked(new.tournament_id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.rankball_match_list(
  p_profile_id text,
  p_limit integer default 5,
  p_cursor text default '',
  p_active_only boolean default false
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_profile_id), '') as profile_id,
      greatest(1, least(200, coalesce(p_limit, 5))) as row_limit,
      case
        when coalesce(p_cursor, '') like 'feed:%' and substring(coalesce(p_cursor, '') from 6) ~ '^[0-9]+$'
          then greatest(0, substring(coalesce(p_cursor, '') from 6)::integer)
        else 0
      end as row_offset
  ),
  grouped as (
    select
      feed.entity_id,
      max(feed.sort_at) as sort_at,
      max(feed.status) as status,
      coalesce(
        (
          select card.card_json
          from public.room_feed_cards card
          where card.entity_type = 'match' and card.entity_id = feed.entity_id
          limit 1
        ),
        (array_agg(feed.card_json order by feed.sort_at desc, feed.relation))[1],
        '{}'::jsonb
      ) as card_json,
      jsonb_agg(distinct feed.relation) as relations
    from public.user_room_feed feed, params
    where feed.entity_type = 'match'
      and feed.feed_scope = 'profile'
      and feed.profile_id = params.profile_id
      and feed.is_active = true
      and coalesce(feed.status, '') <> 'closed'
      and (
        not coalesce(p_active_only, false)
        or coalesce(feed.status, '') not in ('confirmed', 'cancelled', 'void', 'closed')
      )
      and feed.relation in ('owner', 'participant', 'referee')
      and exists (
        select 1 from public.matches match_row
        where match_row.id = feed.entity_id
          and coalesce(nullif(match_row.rules->>'recordType', ''), 'match') = 'match'
      )
    group by feed.entity_id
  ),
  paged as (
    select grouped.* from grouped, params
    order by grouped.sort_at desc nulls last, grouped.entity_id desc
    offset (select row_offset from params)
    limit (select row_limit + 1 from params)
  ),
  numbered as (
    select paged.*,
      row_number() over (order by paged.sort_at desc nulls last, paged.entity_id desc) as rn
    from paged
  )
  select jsonb_build_object(
    'rows',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entity_id', numbered.entity_id,
          'sort_at', numbered.sort_at,
          'status', numbered.status,
          'relations', numbered.relations,
          'card_json', numbered.card_json
        ) order by numbered.sort_at desc nulls last, numbered.entity_id desc
      ) filter (where numbered.rn <= (select row_limit from params)),
      '[]'::jsonb
    ),
    'cursor', case
      when count(*) > (select row_limit from params)
        then 'feed:' || ((select row_offset from params) + (select row_limit from params))::text
      else ''
    end,
    'exhausted', count(*) <= (select row_limit from params)
  )
  from numbered, params;
$$;

create or replace function public.rankball_recorder_match_list(
  p_profile_id text,
  p_limit integer default 50,
  p_cursor text default '',
  p_admin boolean default false
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_profile_id), '') as profile_id,
      greatest(1, least(200, coalesce(p_limit, 50))) as row_limit,
      case
        when coalesce(p_cursor, '') like 'mine:%' and substring(coalesce(p_cursor, '') from 6) ~ '^[0-9]+$'
          then greatest(0, substring(coalesce(p_cursor, '') from 6)::integer)
        else 0
      end as row_offset
  ),
  eligible as (
    select match_row.id, coalesce(match_row.updated_at, match_row.created_at) as sort_at
    from public.matches match_row, params
    where match_row.status in ('agreed', 'approval', 'disputed')
      and (
        coalesce(p_admin, false)
        or match_row.created_by = params.profile_id
        or nullif(btrim(match_row.referee_id), '') = params.profile_id
        or nullif(btrim(match_row.former_referee_id), '') = params.profile_id
        or exists (
          select 1 from public.match_players player
          where player.match_id = match_row.id and player.user_id = params.profile_id
        )
        or jsonb_path_exists(coalesce(match_row.stat_recorders, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', params.profile_id))
        or jsonb_path_exists(coalesce(match_row.rules->'statRecorders', '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', params.profile_id))
        or jsonb_path_exists(coalesce(match_row.reserve_players, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', params.profile_id))
        or jsonb_path_exists(coalesce(match_row.played_player_ids, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', params.profile_id))
        or exists (
          select 1 from public.match_results result
          where result.match_id = match_row.id
            and (
              result.submitted_by = params.profile_id
              or coalesce(result.stat_submissions, '{}'::jsonb) ? params.profile_id
              or jsonb_path_exists(coalesce(result.stat_submissions, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', params.profile_id))
            )
        )
        or exists (
          select 1 from public.player_match_stats stat
          where stat.match_id = match_row.id and stat.user_id = params.profile_id
        )
      )
  ),
  paged as (
    select eligible.* from eligible, params
    order by eligible.sort_at desc nulls last, eligible.id desc
    offset (select row_offset from params)
    limit (select row_limit + 1 from params)
  ),
  numbered as (
    select paged.*,
      row_number() over (order by paged.sort_at desc nulls last, paged.id desc) as rn
    from paged
  )
  select jsonb_build_object(
    'ids', coalesce(
      jsonb_agg(numbered.id order by numbered.sort_at desc nulls last, numbered.id desc)
        filter (where numbered.rn <= (select row_limit from params)),
      '[]'::jsonb
    ),
    'cursor', case
      when count(*) > (select row_limit from params)
        then 'mine:' || ((select row_offset from params) + (select row_limit from params))::text
      else ''
    end,
    'exhausted', count(*) <= (select row_limit from params)
  )
  from numbered, params;
$$;

create index if not exists matches_recorder_status_updated_idx
  on public.matches (status, updated_at desc)
  where status in ('agreed', 'approval', 'disputed');
create index if not exists match_results_submitted_by_match_idx
  on public.match_results (submitted_by, match_id)
  where submitted_by is not null;
create index if not exists player_match_stats_user_match_idx
  on public.player_match_stats (user_id, match_id);

revoke all on function public.rankball_set_notification_due_at() from public, anon, authenticated;
revoke all on function public.rankball_is_match_referee_eligible(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_result_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_result_action_referee_guard_inner(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_dispute_action_bounded_inner(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_resume_approval_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_resume_approval_action_referee_guard_inner(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_delete_team(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_delete_team_reference_guard_inner(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_list(text, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.rankball_recorder_match_list(text, integer, text, boolean) from public, anon, authenticated;

grant execute on function public.rankball_is_match_referee_eligible(text, text) to service_role;
grant execute on function public.rankball_match_result_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_resume_approval_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_delete_team(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_list(text, integer, text, boolean) to service_role;
grant execute on function public.rankball_recorder_match_list(text, integer, text, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
