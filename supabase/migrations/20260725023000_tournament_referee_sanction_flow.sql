begin;

alter table public.tournaments
  add column if not exists referee_ids jsonb not null default '[]'::jsonb,
  add column if not exists referee_statuses jsonb not null default '{}'::jsonb,
  add column if not exists referee_approvals jsonb not null default '{}'::jsonb,
  add column if not exists sanction_status text not null default 'pending',
  add column if not exists sanction_reviewed_by text,
  add column if not exists sanction_reviewed_at timestamptz,
  add column if not exists sanction_review_note text;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tournaments_sanction_status_check'
      and conrelid = 'public.tournaments'::regclass
  ) then
    alter table public.tournaments
      add constraint tournaments_sanction_status_check
      check (sanction_status in ('pending', 'regional_pending', 'regional_rejected', 'approved', 'community'));
  end if;
end;
$migration$;

create index if not exists tournaments_referee_ids_idx
on public.tournaments using gin (referee_ids);

create or replace function public.rankball_required_tournament_referee_count(p_team_count integer)
returns integer
language sql
immutable
parallel safe
as $$
  select case
    when greatest(coalesce(p_team_count, 0), 0) >= 9 then 4
    when greatest(coalesce(p_team_count, 0), 0) >= 5 then 3
    when greatest(coalesce(p_team_count, 0), 0) >= 2 then 2
    else 0
  end;
$$;

create or replace function public.rankball_tournament_referee_eligible(
  p_profile_id text,
  p_through_date date default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    nullif(btrim(p_profile_id), '') is not null
    and exists (
      select 1
      from public.profiles profile_row
      where profile_row.id = nullif(btrim(p_profile_id), '')
        and coalesce(profile_row.trust_score, 0) >= 90
    )
    and exists (
      select 1
      from public.referee_appointments appointment
      where appointment.user_id = nullif(btrim(p_profile_id), '')
        and appointment.role = 'referee'
        and appointment.grade in ('candidate', 'silver', 'gold', 'platinum', 'official')
        and coalesce(appointment.status, 'active') not in (
          'pending', 'rejected', 'revoked', 'expired', 'suspended', 'blocked'
        )
        and (appointment.starts_at is null or appointment.starts_at <= now())
        and (
          appointment.ends_at is null
          or appointment.ends_at::date >= coalesce(p_through_date, current_date)
        )
    );
$$;

create or replace function public.rankball_tournament_referee_affiliated(
  p_tournament_id text,
  p_team_id text,
  p_referee_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  snapshot_member_ids jsonb := '[]'::jsonb;
begin
  if nullif(btrim(p_tournament_id), '') is null
     or nullif(btrim(p_team_id), '') is null
     or nullif(btrim(p_referee_id), '') is null then
    return true;
  end if;

  if exists (
    select 1
    from public.team_members member_row
    where member_row.team_id = p_team_id
      and member_row.user_id = p_referee_id
  ) then
    return true;
  end if;

  select coalesce(
    tournament_row.rules #> array[
      'teamRosterSnapshot',
      'teams',
      p_team_id,
      'representativeMemberIds'
    ],
    '[]'::jsonb
  )
  into snapshot_member_ids
  from public.tournaments tournament_row
  where tournament_row.id = p_tournament_id;

  return coalesce(snapshot_member_ids, '[]'::jsonb) ? p_referee_id;
end;
$$;

create or replace function public.rankball_tournament_referee_coverage_ready(
  p_tournament_id text,
  p_require_accepted boolean default true
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  pair_row record;
begin
  select *
  into tournament_row
  from public.tournaments
  where id = nullif(btrim(p_tournament_id), '');

  if tournament_row.id is null then
    return false;
  end if;

  for pair_row in
    select left_team.team_id as team_a_id, right_team.team_id as team_b_id
    from public.tournament_teams left_team
    join public.tournament_teams right_team
      on right_team.tournament_id = left_team.tournament_id
     and right_team.seed_order > left_team.seed_order
     and right_team.status <> 'declined'
    where left_team.tournament_id = tournament_row.id
      and left_team.status <> 'declined'
  loop
    if not exists (
      select 1
      from jsonb_array_elements_text(coalesce(tournament_row.referee_ids, '[]'::jsonb)) referee(referee_id)
      where (
          not coalesce(p_require_accepted, true)
          or coalesce(tournament_row.referee_statuses->>referee.referee_id, 'invited') = 'accepted'
        )
        and public.rankball_tournament_referee_eligible(referee.referee_id, tournament_row.end_date)
        and not public.rankball_tournament_referee_affiliated(
          tournament_row.id,
          pair_row.team_a_id,
          referee.referee_id
        )
        and not public.rankball_tournament_referee_affiliated(
          tournament_row.id,
          pair_row.team_b_id,
          referee.referee_id
        )
    ) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

create or replace function public.rankball_tournament_approval_ready(p_tournament_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  active_team_count integer := 0;
  accepted_referee_count integer := 0;
begin
  select *
  into tournament_row
  from public.tournaments
  where id = nullif(btrim(p_tournament_id), '');

  if tournament_row.id is null then
    return false;
  end if;

  select count(*)
  into active_team_count
  from public.tournament_teams team_row
  where team_row.tournament_id = tournament_row.id
    and team_row.status <> 'declined';

  if active_team_count < 2 or exists (
    select 1
    from public.tournament_teams team_row
    where team_row.tournament_id = tournament_row.id
      and team_row.status <> 'declined'
      and team_row.status <> 'accepted'
  ) then
    return false;
  end if;

  select count(*)
  into accepted_referee_count
  from jsonb_array_elements_text(coalesce(tournament_row.referee_ids, '[]'::jsonb)) referee(referee_id)
  where coalesce(tournament_row.referee_statuses->>referee.referee_id, 'invited') = 'accepted'
    and public.rankball_tournament_referee_eligible(referee.referee_id, tournament_row.end_date);

  return accepted_referee_count >= public.rankball_required_tournament_referee_count(active_team_count)
    and public.rankball_tournament_referee_coverage_ready(tournament_row.id, true);
end;
$$;

create or replace function public.rankball_notify_tournament_referee_invite(
  p_tournament_id text,
  p_referee_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_title text;
  now_at timestamptz := now();
begin
  select title
  into tournament_title
  from public.tournaments
  where id = p_tournament_id;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, discord_event,
    read_at, payload, created_at, updated_at
  ) values (
    'tournament-referee-invite-' || md5(p_tournament_id || ':' || p_referee_id),
    p_referee_id,
    p_referee_id,
    '대회 심판 초대',
    coalesce(tournament_title, '대회') || ' 심판으로 초대되었습니다. 참여 승인이 필요합니다.',
    'match',
    'tournament_referee_invite',
    'approval',
    null,
    jsonb_build_object(
      'tournamentId', p_tournament_id,
      'actionRequired', true,
      'homeAction', true,
      'webPath', '/app/tournaments/' || p_tournament_id
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
end;
$$;

create or replace function public.rankball_notify_tournament_region_review(p_tournament_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  manager_row record;
  now_at timestamptz := now();
begin
  select *
  into tournament_row
  from public.tournaments
  where id = p_tournament_id;

  if tournament_row.id is null then
    return;
  end if;

  for manager_row in
    select distinct appointment.user_id
    from public.admin_appointments appointment
    where appointment.role = 'admin'
      and appointment.grade in ('regionManager', 'senior', 'owner')
      and appointment.status = 'active'
      and (appointment.starts_at is null or appointment.starts_at <= now_at)
      and (appointment.ends_at is null or appointment.ends_at >= now_at)
  loop
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, discord_event,
      read_at, payload, created_at, updated_at
    ) values (
      'tournament-region-review-' || md5(tournament_row.id || ':' || manager_row.user_id),
      manager_row.user_id,
      manager_row.user_id,
      '대회 지역 승인 요청',
      tournament_row.title || '의 팀장·심판 승인이 완료되었습니다. 공식 대회 여부를 검토해 주세요.',
      'match',
      'tournament_region_review',
      'approval',
      null,
      jsonb_build_object(
        'tournamentId', tournament_row.id,
        'actionRequired', true,
        'homeAction', true,
        'webPath', '/app/tournaments/' || tournament_row.id
      ),
      now_at,
      now_at
    )
    on conflict (id) do update set
      read_at = null,
      payload = excluded.payload,
      body = excluded.body,
      updated_at = excluded.updated_at;
  end loop;
end;
$$;

create or replace function public.rankball_refresh_tournament_sanction_status(p_tournament_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  next_status text;
  now_at timestamptz := now();
begin
  select *
  into tournament_row
  from public.tournaments
  where id = nullif(btrim(p_tournament_id), '')
  for update;

  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if tournament_row.status <> 'draft'
     or coalesce(tournament_row.rules->>'governanceVersion', '') <> '2'
     or tournament_row.sanction_status in ('approved', 'community') then
    return tournament_row.sanction_status;
  end if;

  next_status := case
    when public.rankball_tournament_approval_ready(tournament_row.id)
      and tournament_row.sanction_status = 'regional_rejected' then 'regional_rejected'
    when public.rankball_tournament_approval_ready(tournament_row.id) then 'regional_pending'
    else 'pending'
  end;

  if next_status is distinct from tournament_row.sanction_status then
    update public.tournaments
    set sanction_status = next_status,
        sanction_reviewed_by = null,
        sanction_reviewed_at = null,
        sanction_review_note = null,
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('sanctionStatus', next_status),
        updated_at = now_at
    where id = tournament_row.id;
  end if;

  if next_status = 'regional_pending'
     and tournament_row.sanction_status is distinct from 'regional_pending' then
    perform public.rankball_notify_tournament_region_review(tournament_row.id);
  end if;

  return next_status;
end;
$$;

create or replace function public.rankball_tournament_region_manager_allowed(
  p_actor_profile_id text,
  p_tournament_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tournaments tournament_row
    where tournament_row.id = nullif(btrim(p_tournament_id), '')
  )
  and public.rankball_admin_level_for_profile(nullif(btrim(p_actor_profile_id), ''), 0) >= 60;
$$;

create or replace function public.rankball_assign_neutral_tournament_referee(
  p_tournament_id text,
  p_match_id text,
  p_referee_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_tournament_id text := nullif(btrim(p_tournament_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  preferred_referee_id text := nullif(btrim(p_referee_id), '');
  tournament_row public.tournaments%rowtype;
  match_row public.matches%rowtype;
  selected_referee_id text;
  now_at timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(coalesce(safe_tournament_id, '')));
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));

  select *
  into tournament_row
  from public.tournaments
  where id = safe_tournament_id
  for update;
  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;

  select *
  into match_row
  from public.matches
  where id = safe_match_id
    and tournament_id = tournament_row.id
  for update;
  if match_row.id is null then
    raise exception 'tournament_match_not_found' using errcode = 'P0002';
  end if;
  if match_row.started_at is not null or match_row.ended_at is not null
     or match_row.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed') then
    raise exception 'tournament_match_referee_locked' using errcode = '23514';
  end if;

  if preferred_referee_id is not null then
    if not coalesce(tournament_row.referee_ids, '[]'::jsonb) ? preferred_referee_id
       or coalesce(tournament_row.referee_statuses->>preferred_referee_id, 'invited') <> 'accepted'
       or not public.rankball_tournament_referee_eligible(preferred_referee_id, tournament_row.end_date) then
      raise exception 'tournament_referee_not_eligible' using errcode = '23514';
    end if;
    if public.rankball_tournament_referee_affiliated(tournament_row.id, match_row.team_a_id, preferred_referee_id)
       or public.rankball_tournament_referee_affiliated(tournament_row.id, match_row.team_b_id, preferred_referee_id) then
      raise exception 'tournament_referee_not_neutral' using errcode = '23514';
    end if;
    if match_row.scheduled_date is not null
       and match_row.scheduled_time is not null
       and exists (
         select 1
         from public.matches other_match
         where other_match.id <> match_row.id
           and other_match.referee_id = preferred_referee_id
           and other_match.scheduled_date = match_row.scheduled_date
           and other_match.scheduled_time = match_row.scheduled_time
           and other_match.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
           and other_match.ended_at is null
       ) then
      raise exception 'tournament_referee_schedule_conflict' using errcode = '23514';
    end if;
    selected_referee_id := preferred_referee_id;
  else
    select referee.referee_id
    into selected_referee_id
    from jsonb_array_elements_text(coalesce(tournament_row.referee_ids, '[]'::jsonb)) referee(referee_id)
    where coalesce(tournament_row.referee_statuses->>referee.referee_id, 'invited') = 'accepted'
      and public.rankball_tournament_referee_eligible(referee.referee_id, tournament_row.end_date)
      and not public.rankball_tournament_referee_affiliated(tournament_row.id, match_row.team_a_id, referee.referee_id)
      and not public.rankball_tournament_referee_affiliated(tournament_row.id, match_row.team_b_id, referee.referee_id)
      and (
        match_row.scheduled_date is null
        or match_row.scheduled_time is null
        or not exists (
          select 1
          from public.matches other_match
          where other_match.id <> match_row.id
            and other_match.referee_id = referee.referee_id
            and other_match.scheduled_date = match_row.scheduled_date
            and other_match.scheduled_time = match_row.scheduled_time
            and other_match.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
            and other_match.ended_at is null
        )
      )
    order by (
      select count(*)
      from public.matches assigned_match
      where assigned_match.tournament_id = tournament_row.id
        and assigned_match.referee_id = referee.referee_id
    ), referee.referee_id
    limit 1;
  end if;

  if selected_referee_id is null then
    raise exception 'tournament_neutral_referee_coverage_required' using errcode = '23514';
  end if;

  update public.matches
  set referee_id = selected_referee_id,
      updated_at = now_at
  where id = match_row.id;

  return jsonb_build_object(
    'ok', true,
    'tournamentId', tournament_row.id,
    'matchId', match_row.id,
    'refereeId', selected_referee_id
  );
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_tournament_operation_action_pre_referee_sanction(text,jsonb)') is null then
    if to_regprocedure('public.rankball_tournament_operation_action(text,jsonb)') is null then
      raise exception 'rankball_tournament_operation_action_missing';
    end if;
    alter function public.rankball_tournament_operation_action(text, jsonb)
      rename to rankball_tournament_operation_action_pre_referee_sanction;
  end if;
end;
$migration$;

create or replace function public.rankball_tournament_operation_action(
  p_actor_profile_id text,
  p_operation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_operation->>'action'), '');
  draft jsonb := coalesce(p_operation->'draft', '{}'::jsonb);
  safe_tournament_id text := coalesce(
    nullif(btrim(p_operation->>'preferredTournamentId'), ''),
    nullif(btrim(p_operation->>'tournamentId'), ''),
    nullif(btrim(draft->>'id'), '')
  );
  safe_team_id text := nullif(btrim(p_operation->>'teamId'), '');
  safe_referee_id text := nullif(btrim(p_operation->>'refereeId'), '');
  referee_ids jsonb := '[]'::jsonb;
  referee_statuses jsonb := '{}'::jsonb;
  referee_approvals jsonb := '{}'::jsonb;
  referee_count integer := 0;
  active_team_count integer := 0;
  invalid_referee_id text;
  actor_representative_team_id text;
  tournament_row public.tournaments%rowtype;
  legacy_result jsonb := '{}'::jsonb;
  assignment_result jsonb := '{}'::jsonb;
  now_at timestamptz := now();
  sanction_status text;
  note_text text := left(coalesce(nullif(btrim(p_operation->>'note'), ''), ''), 500);
  referee_row record;
begin
  if safe_actor_id is null or not exists (select 1 from public.profiles where id = safe_actor_id) then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;

  if safe_action = 'createTournament' then
    legacy_result := public.rankball_tournament_operation_action_pre_referee_sanction(
      safe_actor_id,
      p_operation
    );
    safe_tournament_id := coalesce(
      nullif(legacy_result->>'tournamentId', ''),
      safe_tournament_id
    );

    select *
    into tournament_row
    from public.tournaments
    where id = safe_tournament_id
    for update;
    if tournament_row.id is null then
      raise exception 'tournament_not_found' using errcode = 'P0002';
    end if;
    if not public.rankball_tournament_referee_eligible(safe_actor_id, tournament_row.end_date) then
      raise exception 'tournament_organizer_referee_required' using errcode = '23514';
    end if;

    select coalesce(jsonb_agg(referee_id order by ordinality), '[]'::jsonb), count(*)
    into referee_ids, referee_count
    from (
      select referee_id, min(ordinality) as ordinality
      from jsonb_array_elements_text(
        coalesce(draft->'refereeIds', draft->'tournamentRefereeIds', '[]'::jsonb)
      ) with ordinality referee(referee_id, ordinality)
      where nullif(btrim(referee_id), '') is not null
      group by referee_id
    ) normalized_referees;

    select count(*)
    into active_team_count
    from public.tournament_teams
    where tournament_id = tournament_row.id
      and status <> 'declined';

    if referee_count < public.rankball_required_tournament_referee_count(active_team_count) then
      raise exception 'tournament_referee_pool_insufficient' using errcode = '23514';
    end if;

    select referee.referee_id
    into invalid_referee_id
    from jsonb_array_elements_text(referee_ids) referee(referee_id)
    where not public.rankball_tournament_referee_eligible(referee.referee_id, tournament_row.end_date)
    limit 1;
    if invalid_referee_id is not null then
      raise exception 'tournament_referee_not_eligible' using errcode = '23514';
    end if;

    select coalesce(jsonb_object_agg(
      referee.referee_id,
      case when referee.referee_id = safe_actor_id then 'accepted' else 'invited' end
    ), '{}'::jsonb)
    into referee_statuses
    from jsonb_array_elements_text(referee_ids) referee(referee_id);

    if referee_ids ? safe_actor_id then
      referee_approvals := jsonb_build_object(
        safe_actor_id,
        jsonb_build_object('by', safe_actor_id, 'approvedAt', now_at)
      );
    end if;

    update public.tournaments
    set official = false,
        referee_ids = referee_ids,
        referee_statuses = referee_statuses,
        referee_approvals = referee_approvals,
        sanction_status = 'pending',
        sanction_reviewed_by = null,
        sanction_reviewed_at = null,
        sanction_review_note = null,
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'governanceVersion', 2,
          'sanctionStatus', 'pending',
          'sanctionFactor', 1,
          'ratingScale', 1
        ),
        updated_at = now_at
    where id = tournament_row.id;

    if not public.rankball_tournament_referee_coverage_ready(tournament_row.id, false) then
      raise exception 'tournament_neutral_referee_coverage_required' using errcode = '23514';
    end if;

    for referee_row in
      select referee_id
      from jsonb_array_elements_text(referee_ids) referee(referee_id)
      where referee_id <> safe_actor_id
    loop
      perform public.rankball_notify_tournament_referee_invite(
        tournament_row.id,
        referee_row.referee_id
      );
    end loop;

    return coalesce(legacy_result, '{}'::jsonb) || jsonb_build_object(
      'refereeCount', referee_count,
      'requiredRefereeCount', public.rankball_required_tournament_referee_count(active_team_count),
      'sanctionStatus', 'pending',
      'governanceVersion', 2
    );
  end if;

  if safe_tournament_id is null then
    raise exception 'missing_tournament_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(safe_tournament_id));
  select *
  into tournament_row
  from public.tournaments
  where id = safe_tournament_id
  for update;
  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;

  if coalesce(tournament_row.rules->>'governanceVersion', '') <> '2' then
    if safe_action = 'approveTournamentTeam' then
      return public.rankball_tournament_operation_action_pre_referee_sanction(
        safe_actor_id,
        p_operation
      );
    end if;
    raise exception 'tournament_governance_not_enabled' using errcode = '23514';
  end if;

  if safe_action = 'approveTournamentTeam' then
    if tournament_row.status <> 'draft' then
      raise exception 'tournament_not_approvable' using errcode = '23514';
    end if;
    if safe_team_id is null or not exists (
      select 1
      from public.tournament_teams
      where tournament_id = tournament_row.id
        and team_id = safe_team_id
    ) then
      raise exception 'tournament_team_not_found' using errcode = 'P0002';
    end if;
    if not exists (
      select 1
      from public.team_members
      where team_id = safe_team_id
        and user_id = safe_actor_id
        and role = 'captain'
    ) then
      raise exception 'tournament_team_captain_required' using errcode = '42501';
    end if;
    actor_representative_team_id := public.rankball_profile_representative_team_id(safe_actor_id);
    if actor_representative_team_id is distinct from safe_team_id then
      raise exception 'tournament_team_representative_required' using errcode = '23514';
    end if;
    if not (
      coalesce(
        tournament_row.rules #> array['teamRosterSnapshot', 'teams'],
        '{}'::jsonb
      ) ? safe_team_id
    ) then
      raise exception 'tournament_team_snapshot_missing' using errcode = '23514';
    end if;

    update public.tournament_teams
    set status = 'accepted',
        approved_by = safe_actor_id,
        approved_at = now_at
    where tournament_id = tournament_row.id
      and team_id = safe_team_id;

    sanction_status := public.rankball_refresh_tournament_sanction_status(tournament_row.id);
    return jsonb_build_object(
      'ok', true,
      'action', safe_action,
      'tournamentId', tournament_row.id,
      'teamId', safe_team_id,
      'sanctionStatus', sanction_status,
      'createdMatches', '[]'::jsonb,
      'tournamentSqlReducer', true,
      'governanceVersion', 2
    );
  end if;

  if safe_action in ('approveTournamentReferee', 'declineTournamentReferee') then
    if tournament_row.status not in ('draft', 'active') then
      raise exception 'tournament_referee_response_locked' using errcode = '23514';
    end if;
    if not coalesce(tournament_row.referee_ids, '[]'::jsonb) ? safe_actor_id
       or coalesce(tournament_row.referee_statuses->>safe_actor_id, 'invited') not in ('invited', 'accepted') then
      raise exception 'tournament_referee_invite_required' using errcode = '42501';
    end if;

    if safe_action = 'approveTournamentReferee' then
      if not public.rankball_tournament_referee_eligible(safe_actor_id, tournament_row.end_date) then
        raise exception 'tournament_referee_not_eligible' using errcode = '23514';
      end if;
      update public.tournaments
      set referee_statuses = jsonb_set(
            coalesce(referee_statuses, '{}'::jsonb),
            array[safe_actor_id],
            to_jsonb('accepted'::text),
            true
          ),
          referee_approvals = jsonb_set(
            coalesce(referee_approvals, '{}'::jsonb),
            array[safe_actor_id],
            jsonb_build_object('by', safe_actor_id, 'approvedAt', now_at),
            true
          ),
          updated_at = now_at
      where id = tournament_row.id;
    else
      update public.tournaments
      set referee_statuses = jsonb_set(
            coalesce(referee_statuses, '{}'::jsonb),
            array[safe_actor_id],
            to_jsonb('declined'::text),
            true
          ),
          referee_approvals = coalesce(referee_approvals, '{}'::jsonb) - safe_actor_id,
          updated_at = now_at
      where id = tournament_row.id;
      update public.matches
      set referee_id = null,
          updated_at = now_at
      where tournament_id = tournament_row.id
        and referee_id = safe_actor_id
        and started_at is null
        and ended_at is null
        and status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed');
    end if;

    update public.notifications
    set read_at = coalesce(read_at, now_at),
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'actionRequired', false,
          'homeAction', false,
          'resolvedStatus', case when safe_action = 'approveTournamentReferee' then 'accepted' else 'declined' end
        ),
        updated_at = now_at
    where type = 'tournament_referee_invite'
      and target_user_id = safe_actor_id
      and payload->>'tournamentId' = tournament_row.id;

    sanction_status := case
      when tournament_row.status = 'draft'
        then public.rankball_refresh_tournament_sanction_status(tournament_row.id)
      else tournament_row.sanction_status
    end;
    return jsonb_build_object(
      'ok', true,
      'action', safe_action,
      'tournamentId', tournament_row.id,
      'refereeId', safe_actor_id,
      'sanctionStatus', sanction_status,
      'createdMatches', '[]'::jsonb,
      'tournamentSqlReducer', true
    );
  end if;

  if safe_action = 'inviteTournamentReferee' then
    if tournament_row.created_by <> safe_actor_id then
      raise exception 'tournament_owner_required' using errcode = '42501';
    end if;
    if tournament_row.status not in ('draft', 'active') then
      raise exception 'tournament_referee_invite_locked' using errcode = '23514';
    end if;
    if safe_referee_id is null
       or not public.rankball_tournament_referee_eligible(safe_referee_id, tournament_row.end_date) then
      raise exception 'tournament_referee_not_eligible' using errcode = '23514';
    end if;
    if coalesce(tournament_row.referee_ids, '[]'::jsonb) ? safe_referee_id
       and coalesce(tournament_row.referee_statuses->>safe_referee_id, 'invited') = 'accepted' then
      raise exception 'tournament_referee_already_accepted' using errcode = '23514';
    end if;

    update public.tournaments
    set referee_ids = case
          when coalesce(referee_ids, '[]'::jsonb) ? safe_referee_id then referee_ids
          else coalesce(referee_ids, '[]'::jsonb) || to_jsonb(safe_referee_id)
        end,
        referee_statuses = jsonb_set(
          coalesce(referee_statuses, '{}'::jsonb),
          array[safe_referee_id],
          to_jsonb('invited'::text),
          true
        ),
        referee_approvals = coalesce(referee_approvals, '{}'::jsonb) - safe_referee_id,
        sanction_status = case when status = 'draft' then 'pending' else sanction_status end,
        sanction_reviewed_by = case when status = 'draft' then null else sanction_reviewed_by end,
        sanction_reviewed_at = case when status = 'draft' then null else sanction_reviewed_at end,
        sanction_review_note = case when status = 'draft' then null else sanction_review_note end,
        updated_at = now_at
    where id = tournament_row.id;

    perform public.rankball_notify_tournament_referee_invite(tournament_row.id, safe_referee_id);
    sanction_status := case
      when tournament_row.status = 'draft'
        then public.rankball_refresh_tournament_sanction_status(tournament_row.id)
      else tournament_row.sanction_status
    end;
    return jsonb_build_object(
      'ok', true,
      'action', safe_action,
      'tournamentId', tournament_row.id,
      'refereeId', safe_referee_id,
      'sanctionStatus', sanction_status,
      'createdMatches', '[]'::jsonb,
      'tournamentSqlReducer', true
    );
  end if;

  if safe_action in ('approveTournamentRegion', 'rejectTournamentRegion', 'startCommunityTournament') then
    if tournament_row.status <> 'draft' then
      raise exception 'tournament_sanction_locked' using errcode = '23514';
    end if;

    sanction_status := public.rankball_refresh_tournament_sanction_status(tournament_row.id);
    select *
    into tournament_row
    from public.tournaments
    where id = safe_tournament_id
    for update;

    if not public.rankball_tournament_approval_ready(tournament_row.id) then
      raise exception 'tournament_approval_not_ready' using errcode = '23514';
    end if;
    if not public.rankball_tournament_referee_eligible(tournament_row.created_by, tournament_row.end_date) then
      raise exception 'tournament_organizer_referee_required' using errcode = '23514';
    end if;

    if safe_action in ('approveTournamentRegion', 'rejectTournamentRegion')
       and not public.rankball_tournament_region_manager_allowed(safe_actor_id, tournament_row.id) then
      raise exception 'tournament_region_manager_required' using errcode = '42501';
    end if;
    if safe_action = 'startCommunityTournament' and tournament_row.created_by <> safe_actor_id then
      raise exception 'tournament_owner_required' using errcode = '42501';
    end if;

    if safe_action = 'rejectTournamentRegion' then
      update public.tournaments
      set official = false,
          sanction_status = 'regional_rejected',
          sanction_reviewed_by = safe_actor_id,
          sanction_reviewed_at = now_at,
          sanction_review_note = note_text,
          rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
            'sanctionStatus', 'regional_rejected'
          ),
          updated_at = now_at
      where id = tournament_row.id;

      update public.notifications
      set read_at = coalesce(read_at, now_at),
          payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
            'actionRequired', false,
            'homeAction', false,
            'resolvedStatus', 'regional_rejected'
          ),
          updated_at = now_at
      where type = 'tournament_region_review'
        and payload->>'tournamentId' = tournament_row.id;

      insert into public.notifications (
        id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
      ) values (
        'tournament-region-rejected-' || md5(tournament_row.id || ':' || now_at::text),
        tournament_row.created_by,
        tournament_row.created_by,
        '대회 지역 비승인',
        tournament_row.title || '은 지역 비승인 대회로 개최할 수 있습니다. 필수 심판 조건은 그대로 유지됩니다.',
        'match',
        'tournament',
        jsonb_build_object(
          'tournamentId', tournament_row.id,
          'webPath', '/app/tournaments/' || tournament_row.id
        ),
        now_at,
        now_at
      );

      return jsonb_build_object(
        'ok', true,
        'action', safe_action,
        'tournamentId', tournament_row.id,
        'sanctionStatus', 'regional_rejected',
        'createdMatches', '[]'::jsonb,
        'tournamentSqlReducer', true
      );
    end if;

    if safe_action = 'approveTournamentRegion' then
      update public.tournaments
      set official = true,
          sanction_status = 'approved',
          sanction_reviewed_by = safe_actor_id,
          sanction_reviewed_at = now_at,
          sanction_review_note = note_text,
          rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
            'sanctionStatus', 'approved',
            'sanctionFactor', 1,
            'ratingScale', 1
          ),
          updated_at = now_at
      where id = tournament_row.id;
    else
      if tournament_row.sanction_status not in ('regional_pending', 'regional_rejected') then
        raise exception 'tournament_region_review_required' using errcode = '23514';
      end if;
      update public.tournaments
      set official = false,
          sanction_status = 'community',
          rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
            'sanctionStatus', 'community',
            'sanctionFactor', 0.8,
            'ratingScale', 0.8
          ),
          updated_at = now_at
      where id = tournament_row.id;
    end if;

    actor_representative_team_id := public.rankball_profile_representative_team_id(tournament_row.created_by);
    legacy_result := public.rankball_tournament_operation_action_pre_referee_sanction(
      tournament_row.created_by,
      jsonb_build_object(
        'action', 'approveTournamentTeam',
        'tournamentId', tournament_row.id,
        'teamId', actor_representative_team_id,
        'preferredMatchIds', coalesce(p_operation->'preferredMatchIds', '[]'::jsonb)
      )
    );

    update public.notifications
    set read_at = coalesce(read_at, now_at),
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'actionRequired', false,
          'homeAction', false,
          'resolvedStatus', case when safe_action = 'approveTournamentRegion' then 'approved' else 'community' end
        ),
        updated_at = now_at
    where type = 'tournament_region_review'
      and payload->>'tournamentId' = tournament_row.id;

    return coalesce(legacy_result, '{}'::jsonb) || jsonb_build_object(
      'action', safe_action,
      'sanctionStatus', case when safe_action = 'approveTournamentRegion' then 'approved' else 'community' end,
      'official', safe_action = 'approveTournamentRegion',
      'ratingScale', case when safe_action = 'approveTournamentRegion' then 1 else 0.8 end,
      'governanceVersion', 2
    );
  end if;

  if safe_action = 'assignTournamentMatchReferee' then
    if tournament_row.created_by <> safe_actor_id then
      raise exception 'tournament_owner_required' using errcode = '42501';
    end if;
    assignment_result := public.rankball_assign_neutral_tournament_referee(
      tournament_row.id,
      nullif(btrim(p_operation->>'matchId'), ''),
      safe_referee_id
    );
    return assignment_result || jsonb_build_object(
      'action', safe_action,
      'createdMatches', '[]'::jsonb,
      'tournamentSqlReducer', true
    );
  end if;

  raise exception 'unsupported_tournament_operation' using errcode = '22023';
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_create_tournament_match_locked_pre_referee_sanction(text,text,text,integer,integer,text)') is null then
    if to_regprocedure('public.rankball_create_tournament_match_locked(text,text,text,integer,integer,text)') is null then
      raise exception 'rankball_create_tournament_match_locked_missing';
    end if;
    alter function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text)
      rename to rankball_create_tournament_match_locked_pre_referee_sanction;
  end if;
end;
$migration$;

create or replace function public.rankball_create_tournament_match_locked(
  p_tournament_id text,
  p_team_a_id text,
  p_team_b_id text,
  p_round integer,
  p_fixture integer,
  p_preferred_match_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  match_row public.matches%rowtype;
  legacy_result jsonb;
  assignment_result jsonb;
begin
  select *
  into tournament_row
  from public.tournaments
  where id = nullif(btrim(p_tournament_id), '')
  for update;
  if tournament_row.id is null then
    raise exception 'tournament_not_found' using errcode = 'P0002';
  end if;
  if coalesce(tournament_row.rules->>'governanceVersion', '') = '2'
     and tournament_row.sanction_status not in ('approved', 'community') then
    raise exception 'tournament_sanction_required' using errcode = '23514';
  end if;

  legacy_result := public.rankball_create_tournament_match_locked_pre_referee_sanction(
    p_tournament_id,
    p_team_a_id,
    p_team_b_id,
    p_round,
    p_fixture,
    p_preferred_match_id
  );

  if coalesce(tournament_row.rules->>'governanceVersion', '') <> '2' then
    return legacy_result;
  end if;

  select *
  into match_row
  from public.matches
  where id = legacy_result->>'id'
  for update;
  assignment_result := public.rankball_assign_neutral_tournament_referee(
    tournament_row.id,
    match_row.id,
    match_row.referee_id
  );

  return coalesce(legacy_result, '{}'::jsonb) || jsonb_build_object(
    'refereeId', assignment_result->>'refereeId'
  );
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_tournament_match_schedule_action_pre_referee_sanction(text,text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_tournament_match_schedule_action(text,text,text,jsonb)') is null then
      raise exception 'rankball_tournament_match_schedule_action_missing';
    end if;
    alter function public.rankball_tournament_match_schedule_action(text, text, text, jsonb)
      rename to rankball_tournament_match_schedule_action_pre_referee_sanction;
  end if;
end;
$migration$;

create or replace function public.rankball_tournament_match_schedule_action(
  p_actor_profile_id text,
  p_tournament_id text,
  p_match_id text,
  p_schedule jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  match_row public.matches%rowtype;
  legacy_result jsonb;
begin
  legacy_result := public.rankball_tournament_match_schedule_action_pre_referee_sanction(
    p_actor_profile_id,
    p_tournament_id,
    p_match_id,
    p_schedule
  );

  select *
  into tournament_row
  from public.tournaments
  where id = nullif(btrim(p_tournament_id), '');
  if coalesce(tournament_row.rules->>'governanceVersion', '') <> '2' then
    return legacy_result;
  end if;

  select *
  into match_row
  from public.matches
  where id = nullif(btrim(p_match_id), '')
    and tournament_id = tournament_row.id;
  if match_row.referee_id is null then
    raise exception 'tournament_referee_required' using errcode = '23514';
  end if;
  if not coalesce(tournament_row.referee_ids, '[]'::jsonb) ? match_row.referee_id
     or coalesce(tournament_row.referee_statuses->>match_row.referee_id, 'invited') <> 'accepted'
     or not public.rankball_tournament_referee_eligible(match_row.referee_id, tournament_row.end_date) then
    raise exception 'tournament_referee_required' using errcode = '23514';
  end if;
  if public.rankball_tournament_referee_affiliated(
       tournament_row.id,
       match_row.team_a_id,
       match_row.referee_id
     )
     or public.rankball_tournament_referee_affiliated(
       tournament_row.id,
       match_row.team_b_id,
       match_row.referee_id
     ) then
    raise exception 'tournament_referee_not_neutral' using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.matches other_match
    where other_match.id <> match_row.id
      and other_match.referee_id = match_row.referee_id
      and other_match.scheduled_date = match_row.scheduled_date
      and other_match.scheduled_time = match_row.scheduled_time
      and other_match.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
      and other_match.ended_at is null
  ) then
    raise exception 'tournament_referee_schedule_conflict' using errcode = '23514';
  end if;

  return legacy_result || jsonb_build_object('refereeId', match_row.referee_id);
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_match_start_action_guarded_pre_tournament_referee(text,text,text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_start_action_guarded(text,text,text,text,jsonb)') is null then
      raise exception 'rankball_match_start_action_guarded_missing';
    end if;
    alter function public.rankball_match_start_action_guarded(text, text, text, text, jsonb)
      rename to rankball_match_start_action_guarded_pre_tournament_referee;
  end if;
end;
$migration$;

create or replace function public.rankball_match_start_action_guarded(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
  tournament_row public.tournaments%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(p_match_id, '')));
  select *
  into match_row
  from public.matches
  where id = nullif(btrim(p_match_id), '')
  for update;
  if match_row.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if match_row.tournament_id is not null then
    select *
    into tournament_row
    from public.tournaments
    where id = match_row.tournament_id;

    if coalesce(tournament_row.rules->>'governanceVersion', '') = '2' then
      if tournament_row.sanction_status not in ('approved', 'community') then
        raise exception 'tournament_sanction_required' using errcode = '23514';
      end if;
      if match_row.referee_id is null
         or not coalesce(tournament_row.referee_ids, '[]'::jsonb) ? match_row.referee_id
         or coalesce(tournament_row.referee_statuses->>match_row.referee_id, 'invited') <> 'accepted'
         or not public.rankball_tournament_referee_eligible(match_row.referee_id, tournament_row.end_date) then
        raise exception 'tournament_referee_required' using errcode = '23514';
      end if;
      if public.rankball_tournament_referee_affiliated(
           tournament_row.id,
           match_row.team_a_id,
           match_row.referee_id
         )
         or public.rankball_tournament_referee_affiliated(
           tournament_row.id,
           match_row.team_b_id,
           match_row.referee_id
         ) then
        raise exception 'tournament_referee_not_neutral' using errcode = '23514';
      end if;
    end if;
  end if;

  return public.rankball_match_start_action_guarded_pre_tournament_referee(
    p_actor_profile_id,
    p_match_id,
    p_started_at,
    p_agreed_at,
    p_attendance
  );
end;
$$;

create or replace function public.rankball_can_read_private_tournament(target_tournament_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_id text := public.current_profile_id();
  owner_id text;
  is_public boolean;
  referee_ids jsonb := '[]'::jsonb;
  allowed boolean := false;
begin
  select created_by, visibility = 'public', coalesce(tournaments.referee_ids, '[]'::jsonb)
  into owner_id, is_public, referee_ids
  from public.tournaments
  where id = target_tournament_id;

  if not found then
    return false;
  end if;
  if is_public or public.current_is_admin(30) then
    return true;
  end if;
  if profile_id is null then
    return false;
  end if;
  if owner_id = profile_id or referee_ids ? profile_id then
    return true;
  end if;
  if exists (
    select 1
    from public.tournament_teams tt
    where tt.tournament_id = target_tournament_id
      and tt.approved_by = profile_id
  ) then
    return true;
  end if;

  if to_regclass('public.team_members') is not null then
    execute '
      select exists (
        select 1
        from public.tournament_teams tt
        join public.team_members tm on tm.team_id = tt.team_id
        where tt.tournament_id = $1
          and tm.user_id = $2
      )
    '
    into allowed
    using target_tournament_id, profile_id;
  end if;

  return allowed;
end;
$$;

revoke all on function public.rankball_required_tournament_referee_count(integer) from public, anon, authenticated;
revoke all on function public.rankball_tournament_referee_eligible(text, date) from public, anon, authenticated;
revoke all on function public.rankball_tournament_referee_affiliated(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_referee_coverage_ready(text, boolean) from public, anon, authenticated;
revoke all on function public.rankball_tournament_approval_ready(text) from public, anon, authenticated;
revoke all on function public.rankball_notify_tournament_referee_invite(text, text) from public, anon, authenticated;
revoke all on function public.rankball_notify_tournament_region_review(text) from public, anon, authenticated;
revoke all on function public.rankball_refresh_tournament_sanction_status(text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_region_manager_allowed(text, text) from public, anon, authenticated;
revoke all on function public.rankball_assign_neutral_tournament_referee(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_operation_action_pre_referee_sanction(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_tournament_operation_action(text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_create_tournament_match_locked_pre_referee_sanction(text, text, text, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) from public, anon, authenticated;
revoke all on function public.rankball_tournament_match_schedule_action_pre_referee_sanction(text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_start_action_guarded_pre_tournament_referee(text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_can_read_private_tournament(text) from public, anon;

grant execute on function public.rankball_tournament_operation_action(text, jsonb) to service_role;
grant execute on function public.rankball_create_tournament_match_locked(text, text, text, integer, integer, text) to service_role;
grant execute on function public.rankball_tournament_match_schedule_action(text, text, text, jsonb) to service_role;
grant execute on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) to service_role;
grant execute on function public.rankball_can_read_private_tournament(text) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
