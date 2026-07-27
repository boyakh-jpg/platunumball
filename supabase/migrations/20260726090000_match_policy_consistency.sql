begin;

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
          or appointment.ends_at >= case
            when p_through_date is null then now()
            else ((p_through_date + 1)::timestamp at time zone 'Asia/Seoul')
          end
        )
    );
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
      and (
        public.rankball_admin_level_for_profile(nullif(btrim(p_actor_profile_id), ''), 0) >= 80
        or exists (
          select 1
          from public.admin_appointments appointment
          join public.profiles profile_row
            on profile_row.id = appointment.user_id
          where appointment.user_id = nullif(btrim(p_actor_profile_id), '')
            and appointment.role = 'admin'
            and appointment.grade = 'regionManager'
            and appointment.status = 'active'
            and (appointment.starts_at is null or appointment.starts_at <= now())
            and (appointment.ends_at is null or appointment.ends_at >= now())
            and public.rankball_room_feed_region_key(
              coalesce(nullif(appointment.payload->>'region', ''), profile_row.region)
            ) = public.rankball_room_feed_region_key(tournament_row.region)
        )
      )
  );
$$;

create or replace function public.rankball_match_schedule_duration_minutes(p_rules jsonb)
returns integer
language sql
immutable
parallel safe
as $$
  with normalized as (
    select
      greatest(1, least(4, coalesce(nullif(p_rules->>'periodCount', '')::integer, 1))) as period_count,
      greatest(1, least(60, coalesce(
        nullif(p_rules->>'periodMinutes', '')::integer,
        nullif(p_rules->>'timeLimit', '')::integer,
        12
      ))) as period_minutes,
      greatest(0, least(30, coalesce(nullif(p_rules->>'periodBreakMinutes', '')::integer, 2))) as period_break_minutes,
      greatest(0, least(30, coalesce(nullif(p_rules->>'halftimeMinutes', '')::integer, 5))) as halftime_minutes,
      greatest(0, least(20, coalesce(nullif(p_rules->>'overtimeMinutes', '')::integer, 3))) as overtime_minutes
  )
  select greatest(
    15,
    least(
      90,
      period_count * period_minutes
      + case
          when period_count = 4 then period_break_minutes * 2 + halftime_minutes
          when period_count = 2 then halftime_minutes
          else 0
        end
      + overtime_minutes
      + 5
    )
  )
  from normalized;
$$;

create or replace function public.rankball_guard_referee_schedule_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_start timestamptz;
  next_end timestamptz;
begin
  if nullif(btrim(new.referee_id), '') is null
     or new.scheduled_date is null
     or new.scheduled_time is null
     or new.status in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     or new.ended_at is not null then
    return new;
  end if;

  next_start := (new.scheduled_date + new.scheduled_time) at time zone 'Asia/Seoul';
  next_end := next_start + make_interval(
    mins => public.rankball_match_schedule_duration_minutes(coalesce(new.rules, '{}'::jsonb))
  );

  if exists (
    select 1
    from public.matches other_match
    where other_match.id <> new.id
      and other_match.referee_id = new.referee_id
      and other_match.scheduled_date is not null
      and other_match.scheduled_time is not null
      and other_match.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
      and other_match.ended_at is null
      and tstzrange(
        next_start,
        next_end,
        '[)'
      ) && tstzrange(
        (other_match.scheduled_date + other_match.scheduled_time) at time zone 'Asia/Seoul',
        (other_match.scheduled_date + other_match.scheduled_time) at time zone 'Asia/Seoul'
          + make_interval(
              mins => public.rankball_match_schedule_duration_minutes(coalesce(other_match.rules, '{}'::jsonb))
            ),
        '[)'
      )
  ) then
    raise exception 'tournament_referee_schedule_conflict' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists rankball_matches_referee_schedule_overlap_guard on public.matches;
create trigger rankball_matches_referee_schedule_overlap_guard
before insert or update of referee_id, scheduled_date, scheduled_time, rules, status, ended_at
on public.matches
for each row execute function public.rankball_guard_referee_schedule_overlap();

create or replace function public.rankball_guard_referee_live_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.started_at is null
     or (tg_op = 'UPDATE' and old.started_at is not null)
     or nullif(btrim(new.referee_id), '') is null then
    return new;
  end if;

  if exists (
    select 1
    from public.matches other_match
    where other_match.id <> new.id
      and other_match.referee_id = new.referee_id
      and other_match.started_at is not null
      and other_match.ended_at is null
      and other_match.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
  ) then
    raise exception 'referee_active_match_conflict' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists rankball_matches_referee_live_overlap_guard on public.matches;
create trigger rankball_matches_referee_live_overlap_guard
before insert or update of started_at, referee_id, status, ended_at
on public.matches
for each row execute function public.rankball_guard_referee_live_overlap();

create or replace function public.rankball_guard_governed_tournament_referee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.tournament_id is not null
     and new.started_at is null
     and new.ended_at is null
     and new.status not in ('confirmed', 'cancelled', 'void', 'voided', 'closed')
     and (
       (old.referee_id is not null and new.referee_id is null)
       or new.referee_absence_request is distinct from old.referee_absence_request
     )
     and exists (
       select 1
       from public.tournaments tournament_row
       where tournament_row.id = old.tournament_id
         and coalesce(tournament_row.rules->>'governanceVersion', '') = '2'
     ) then
    raise exception 'tournament_referee_replacement_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_matches_governed_referee_guard on public.matches;
create trigger rankball_matches_governed_referee_guard
before update of referee_id, referee_absence_request on public.matches
for each row execute function public.rankball_guard_governed_tournament_referee();

create or replace function public.rankball_guard_active_tournament_referee_decline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active'
     and exists (
       select 1
       from jsonb_each_text(coalesce(old.referee_statuses, '{}'::jsonb)) old_status(referee_id, status)
       where old_status.status = 'accepted'
         and coalesce(new.referee_statuses->>old_status.referee_id, 'invited') <> 'accepted'
     ) then
    raise exception 'active_tournament_referee_decline_locked' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_tournaments_active_referee_decline_guard on public.tournaments;
create trigger rankball_tournaments_active_referee_decline_guard
before update of referee_statuses on public.tournaments
for each row execute function public.rankball_guard_active_tournament_referee_decline();

create or replace function public.rankball_sync_match_play_intervals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  minimum_play_excluded jsonb := '[]'::jsonb;
  next_excluded jsonb := '[]'::jsonb;
  next_rules jsonb := '{}'::jsonb;
  start_active_elapsed_ms bigint;
  end_active_elapsed_ms bigint;
begin
  if new.started_at is not null
     and (case when tg_op = 'INSERT' then true else old.started_at is null end) then
    start_active_elapsed_ms := public.rankball_match_clock_effective_elapsed_ms(new.id, new.started_at);
    insert into public.match_play_intervals (
      match_id,
      player_id,
      side,
      started_at,
      started_active_elapsed_ms
    )
    select
      new.id,
      player.user_id,
      player.side,
      new.started_at,
      start_active_elapsed_ms
    from public.match_players player
    where player.match_id = new.id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    on conflict (match_id, player_id) where ended_at is null do nothing;
  end if;

  if new.ended_at is not null
     and (case when tg_op = 'INSERT' then true else old.ended_at is null end) then
    end_active_elapsed_ms := public.rankball_match_clock_effective_elapsed_ms(new.id, new.ended_at);
    update public.match_play_intervals
    set ended_at = greatest(started_at, new.ended_at),
        ended_active_elapsed_ms = case
          when end_active_elapsed_ms is null then ended_active_elapsed_ms
          when started_active_elapsed_ms is null then end_active_elapsed_ms
          else greatest(started_active_elapsed_ms, end_active_elapsed_ms)
        end,
        updated_at = now()
    where match_id = new.id and ended_at is null;

    select coalesce(jsonb_agg(to_jsonb(player_id)), '[]'::jsonb)
    into minimum_play_excluded
    from (
      select event.player_id
      from (
        select
          active_in_player_id as player_id,
          max(minimum_meaningful_seconds) as minimum_seconds
        from public.match_substitution_events
        where match_id = new.id
        group by active_in_player_id
      ) event
      left join lateral (
        select coalesce(
          sum(
            case
              when play_interval.started_active_elapsed_ms is not null
                   and coalesce(
                     play_interval.ended_active_elapsed_ms,
                     end_active_elapsed_ms
                   ) is not null then
                greatest(
                  0,
                  coalesce(
                    play_interval.ended_active_elapsed_ms,
                    end_active_elapsed_ms
                  ) - play_interval.started_active_elapsed_ms
                )::numeric / 1000
              else 0
            end
          ),
          0
        ) as played_seconds
        from public.match_play_intervals play_interval
        where play_interval.match_id = new.id
          and play_interval.player_id = event.player_id
      ) play_time on true
      where play_time.played_seconds < event.minimum_seconds
    ) under_minimum;

    select coalesce(jsonb_agg(to_jsonb(player_id)), '[]'::jsonb)
    into next_excluded
    from (
      select distinct player_id
      from (
        select value as player_id
        from jsonb_array_elements_text(
          case when jsonb_typeof(new.mmr_excluded_player_ids) = 'array'
            then new.mmr_excluded_player_ids else '[]'::jsonb end
        ) current_excluded(value)
        union all
        select value as player_id
        from jsonb_array_elements_text(minimum_play_excluded) minimum_excluded(value)
      ) combined
      where nullif(btrim(player_id), '') is not null
    ) unique_excluded;

    next_rules := jsonb_set(
      jsonb_set(
        coalesce(new.rules, '{}'::jsonb),
        '{minimumPlayExcludedPlayerIds}',
        minimum_play_excluded,
        true
      ),
      '{mmrExcludedPlayerIds}',
      next_excluded,
      true
    );
    update public.matches
    set mmr_excluded_player_ids = next_excluded,
        rules = next_rules,
        updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_match_auto_finalize_action_pre_record_window(text,timestamptz)') is null then
    if to_regprocedure('public.rankball_match_auto_finalize_action(text,timestamptz)') is null then
      raise exception 'rankball_match_auto_finalize_action_missing';
    end if;
    alter function public.rankball_match_auto_finalize_action(text, timestamptz)
      rename to rankball_match_auto_finalize_action_pre_record_window;
  end if;
end;
$migration$;

create or replace function public.rankball_match_auto_finalize_action(
  p_match_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  now_at timestamptz := coalesce(p_now, now());
  current_match public.matches%rowtype;
  result_submitted_at timestamptz;
begin
  select *
  into current_match
  from public.matches
  where id = safe_match_id;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if current_match.rules->>'recordType' = 'match_record' then
    select coalesce(result.submitted_at, current_match.updated_at, current_match.ended_at)
    into result_submitted_at
    from public.match_results result
    where result.match_id = safe_match_id;

    if result_submitted_at is null
       or now_at < result_submitted_at + make_interval(
         mins => public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)
       ) then
      raise exception 'match_auto_finalization_not_due' using errcode = '23514';
    end if;
  end if;

  return public.rankball_match_auto_finalize_action_pre_record_window(safe_match_id, now_at);
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_recruiting_management_action_pre_pickup_competitive(text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_management_action(text,jsonb)') is null then
      raise exception 'rankball_recruiting_management_action_missing';
    end if;
    alter function public.rankball_recruiting_management_action(text, jsonb)
      rename to rankball_recruiting_management_action_pre_pickup_competitive;
  end if;
end;
$migration$;

create or replace function public.rankball_recruiting_management_action(
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
  safe_post_id text := coalesce(
    nullif(btrim(p_operation->>'preferredPostId'), ''),
    nullif(btrim(p_operation->>'postId'), ''),
    nullif(btrim(p_operation #>> '{draft,id}'), '')
  );
  safe_invitation_id text := nullif(btrim(p_operation->>'invitationId'), '');
  normalized_operation jsonb := coalesce(p_operation, '{}'::jsonb);
  normalized_draft jsonb;
  normalized_invite jsonb;
  normalized_application jsonb;
  current_post public.recruiting_posts%rowtype;
  next_invitations jsonb;
  pickup_room boolean := false;
  pickup_competitive boolean := false;
begin
  if safe_post_id is not null then
    select post.* into current_post
    from public.recruiting_posts post
    where post.id = safe_post_id;
    pickup_room := current_post.id is not null and current_post.rules->>'matchIntent' = 'pickup';
  elsif safe_action = 'createRecruitingPost' then
    pickup_room := coalesce(
      normalized_operation #>> '{draft,matchIntent}',
      normalized_operation #>> '{draft,rules,matchIntent}'
    ) = 'pickup';
  end if;

  if not pickup_room then
    return public.rankball_recruiting_management_action_pre_pickup_competitive(p_actor_profile_id, p_operation);
  end if;

  if safe_action in (
    'joinRecruitingSideParty',
    'setRecruitingPartyPlayerPlacement',
    'setRecruitingPartyPlayerReserve',
    'setRecruitingTeamPartyRoster',
    'detachRecruitingPartyPlayer',
    'removeRecruitingPartyPlayer'
  ) then
    raise exception 'pickup_party_not_allowed' using errcode = '23514';
  end if;

  if safe_action = 'createRecruitingPost' then
    normalized_draft := coalesce(normalized_operation->'draft', '{}'::jsonb);
    pickup_competitive := coalesce(
      normalized_draft->>'matchPurpose',
      normalized_draft #>> '{rules,matchPurpose}',
      'friendly'
    ) = 'competitive';
    normalized_draft := normalized_draft
      - 'teamId'
      - 'targetTeamId'
      || jsonb_build_object(
        'hostJoinMode', 'player',
        'teamOnly', false,
        'ranked', pickup_competitive,
        'official', false,
        'playerIds', '[]'::jsonb,
        'rules', coalesce(normalized_draft->'rules', '{}'::jsonb) || jsonb_build_object(
          'matchIntent', 'pickup',
          'matchPurpose', case when pickup_competitive then 'competitive' else 'friendly' end,
          'formationMode', 'pickup',
          'hostJoinMode', 'player',
          'teamOnly', false,
          'ranked', pickup_competitive,
          'official', false,
          'playingTimePolicy', 'equal_rotation',
          'lineupSelectionPolicy', 'no_fixed_starter'
        )
      );
    normalized_operation := jsonb_set(normalized_operation, '{draft}', normalized_draft, true);
  elsif safe_action = 'inviteRecruitingPlayers' then
    normalized_invite := (coalesce(normalized_operation->'invite', '{}'::jsonb) - 'teamId')
      || jsonb_build_object('joinMode', 'player');
    normalized_operation := jsonb_set(normalized_operation, '{invite}', normalized_invite, true);
  elsif safe_action = 'interestRecruitingPost' then
    normalized_application := (coalesce(normalized_operation->'application', '{}'::jsonb) - 'teamId')
      || jsonb_build_object('joinMode', 'player');
    normalized_operation := jsonb_set(normalized_operation, '{application}', normalized_application, true)
      || jsonb_build_object('joinMode', 'player');
  elsif safe_action in ('acceptRecruitingInvitation', 'declineRecruitingInvitation')
    and safe_invitation_id is not null
    and safe_actor_id is not null
  then
    select coalesce(jsonb_agg(
      case
        when invitation.value->>'id' = safe_invitation_id
          and invitation.value->>'targetUserId' = safe_actor_id
          and coalesce(invitation.value->>'role', 'player') <> 'referee'
        then (invitation.value - 'teamId') || jsonb_build_object('joinMode', 'player')
        else invitation.value
      end
      order by invitation.ordinality
    ), '[]'::jsonb)
    into next_invitations
    from jsonb_array_elements(
      case when jsonb_typeof(current_post.room_state->'invitations') = 'array'
        then current_post.room_state->'invitations'
        else '[]'::jsonb
      end
    ) with ordinality invitation(value, ordinality);

    update public.recruiting_posts
    set room_state = jsonb_set(coalesce(room_state, '{}'::jsonb), '{invitations}', next_invitations, true),
        updated_at = now()
    where id = safe_post_id;
  end if;

  return public.rankball_recruiting_management_action_pre_pickup_competitive(
    p_actor_profile_id,
    normalized_operation
  );
end;
$$;

revoke all on function public.rankball_match_record_participation_action(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_auto_finalize_action_pre_record_window(text, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_auto_finalize_action(text, timestamptz)
from public, anon, authenticated;
grant execute on function public.rankball_match_auto_finalize_action(text, timestamptz)
to service_role;
revoke all on function public.rankball_recruiting_management_action_pre_pickup_competitive(text, jsonb)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_management_action(text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_recruiting_management_action(text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
