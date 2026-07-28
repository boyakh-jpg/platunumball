begin;

alter table public.profiles
  add column if not exists placement_match_count smallint not null default 0,
  add column if not exists placement_evidence_weight numeric not null default 0,
  add column if not exists placement_weighted_sum numeric not null default 3000,
  add column if not exists placement_completed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_placement_match_count_check;
alter table public.profiles
  add constraint profiles_placement_match_count_check
  check (placement_match_count between 0 and 5) not valid;
alter table public.profiles
  validate constraint profiles_placement_match_count_check;

alter table public.teams
  add column if not exists roster_mmr numeric,
  add column if not exists performance_adjustment numeric not null default 0;

alter table public.teams
  drop constraint if exists teams_performance_adjustment_check;
alter table public.teams
  add constraint teams_performance_adjustment_check
  check (performance_adjustment between -150 and 150) not valid;
alter table public.teams
  validate constraint teams_performance_adjustment_check;

alter table public.match_player_competitive_snapshots
  add column if not exists integrated_mmr numeric,
  add column if not exists team_id text,
  add column if not exists team_role text;

alter table public.match_player_competitive_snapshots
  drop constraint if exists match_player_competitive_snapshots_team_role_check;
alter table public.match_player_competitive_snapshots
  add constraint match_player_competitive_snapshots_team_role_check
  check (team_role is null or team_role in ('captain', 'regular', 'mercenary')) not valid;
alter table public.match_player_competitive_snapshots
  validate constraint match_player_competitive_snapshots_team_role_check;

create or replace function public.rankball_match_player_team_role(
  p_match_id text,
  p_profile_id text,
  p_team_id text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
  resolved_role text;
begin
  if nullif(btrim(p_team_id), '') is null then
    return null;
  end if;

  select * into current_match
  from public.matches
  where id = nullif(btrim(p_match_id), '');

  select case
    when member.value->>'role' in ('mercenary', 'guest') then 'mercenary'
    when member.value->>'role' in ('captain', 'regular') then member.value->>'role'
    else null
  end
  into resolved_role
  from jsonb_array_elements(
    case
      when jsonb_typeof(current_match.rules #> array['teamRosterSnapshot', 'teams', p_team_id, 'members']) = 'array'
        then current_match.rules #> array['teamRosterSnapshot', 'teams', p_team_id, 'members']
      else '[]'::jsonb
    end
  ) member(value)
  where member.value->>'userId' = p_profile_id
  limit 1;

  if resolved_role is null then
    select case
      when team_member.role in ('mercenary', 'guest') then 'mercenary'
      when team_member.role in ('captain', 'regular') then team_member.role
      else null
    end
    into resolved_role
    from public.team_members team_member
    where team_member.team_id = p_team_id
      and team_member.user_id = p_profile_id
    limit 1;
  end if;

  if resolved_role is null then
    select case
      when invitation.role in ('mercenary', 'guest') then 'mercenary'
      when invitation.role = 'regular' then 'regular'
      else null
    end
    into resolved_role
    from public.team_invitations invitation
    where invitation.team_id = p_team_id
      and invitation.target_user_id = p_profile_id
      and invitation.status = 'accepted'
    order by invitation.updated_at desc, invitation.id desc
    limit 1;
  end if;

  return resolved_role;
end;
$$;

revoke all on function public.rankball_match_player_team_role(text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_player_team_role(text, text, text)
  to service_role;

create or replace function public.rankball_snapshot_match_competitive(p_match_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  event_date date;
  safe_mode text;
begin
  if safe_match_id is null then
    raise exception 'missing_match_id' using errcode = '22023';
  end if;

  select * into current_match
  from public.matches
  where id = safe_match_id;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  event_date := coalesce(
    current_match.scheduled_date,
    current_match.started_at::date,
    current_match.ended_at::date,
    current_match.created_at::date,
    current_date
  );
  safe_mode := coalesce(nullif(btrim(current_match.mode), ''), '5v5');

  with actual_candidates as (
    select
      match_player.user_id as profile_id,
      match_player.side,
      coalesce(
        match_player.team_id,
        case match_player.side
          when 'teamA' then current_match.team_a_id
          when 'teamB' then current_match.team_b_id
        end
      ) as team_id,
      0 as source_priority
    from public.match_players match_player
    where match_player.match_id = safe_match_id
      and match_player.side in ('teamA', 'teamB')
      and nullif(btrim(match_player.user_id), '') is not null
    union all
    select played.value, 'teamA', current_match.team_a_id, 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA'
        else '[]'::jsonb
      end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union all
    select played.value, 'teamB', current_match.team_b_id, 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB'
        else '[]'::jsonb
      end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  ), actual_players as (
    select distinct on (profile_id) profile_id, side, team_id
    from actual_candidates
    order by profile_id, source_priority
  )
  insert into public.match_player_competitive_snapshots (
    match_id,
    profile_id,
    side,
    age_group,
    mode_mmr,
    integrated_mmr,
    mmr_eligible,
    team_id,
    team_role,
    snapshot_source,
    snapshotted_at
  )
  select
    safe_match_id,
    profile.id,
    actual_player.side,
    public.rankball_profile_age_group_at(profile.id, event_date),
    case
      when coalesce(profile.ratings #>> array['modes', safe_mode], '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (profile.ratings #>> array['modes', safe_mode])::numeric
      when coalesce(profile.ratings->>'integrated', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (profile.ratings->>'integrated')::numeric
      else 1200::numeric
    end,
    case
      when coalesce(profile.ratings->>'integrated', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (profile.ratings->>'integrated')::numeric
      else 1200::numeric
    end,
    coalesce(current_match.ranked, false)
      and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id,
    actual_player.team_id,
    public.rankball_match_player_team_role(
      safe_match_id,
      profile.id,
      actual_player.team_id
    ),
    'pre_finalize',
    now()
  from actual_players actual_player
  join public.profiles profile on profile.id = actual_player.profile_id
  on conflict (match_id, profile_id) do update
  set
    side = excluded.side,
    age_group = excluded.age_group,
    mode_mmr = excluded.mode_mmr,
    integrated_mmr = excluded.integrated_mmr,
    mmr_eligible = excluded.mmr_eligible,
    team_id = excluded.team_id,
    team_role = excluded.team_role,
    snapshot_source = excluded.snapshot_source,
    snapshotted_at = excluded.snapshotted_at;
end;
$$;

revoke all on function public.rankball_snapshot_match_competitive(text)
  from public, anon, authenticated;
grant execute on function public.rankball_snapshot_match_competitive(text)
  to service_role;

create or replace function public.rankball_team_roster_mmr(p_team_id text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with top_regulars as (
    select coalesce(
      case
        when coalesce(profile.ratings->>'integrated', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (profile.ratings->>'integrated')::numeric
      end,
      1200
    ) as mmr
    from public.team_members member
    join public.profiles profile on profile.id = member.user_id
    where member.team_id = nullif(btrim(p_team_id), '')
      and member.role in ('captain', 'regular')
    order by mmr desc, member.user_id
    limit 5
  )
  select coalesce(round(avg(mmr)), 1200)
  from top_regulars
$$;

revoke all on function public.rankball_team_roster_mmr(text)
  from public, anon, authenticated;
grant execute on function public.rankball_team_roster_mmr(text)
  to service_role;

create or replace function public.rankball_refresh_team_mmr(p_team_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  next_roster_mmr numeric;
begin
  if nullif(btrim(p_team_id), '') is null then
    return;
  end if;
  next_roster_mmr := public.rankball_team_roster_mmr(p_team_id);
  update public.teams
  set
    roster_mmr = next_roster_mmr,
    performance_adjustment = greatest(-150, least(150, coalesce(performance_adjustment, 0))),
    mmr = round(
      next_roster_mmr
      + greatest(-150, least(150, coalesce(performance_adjustment, 0)))
    ),
    updated_at = now()
  where id = p_team_id
    and deleted_at is null;
end;
$$;

revoke all on function public.rankball_refresh_team_mmr(text)
  from public, anon, authenticated;
grant execute on function public.rankball_refresh_team_mmr(text)
  to service_role;

create or replace function public.rankball_refresh_team_mmr_on_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.rankball_refresh_team_mmr(old.team_id);
  end if;
  if tg_op <> 'DELETE' then
    perform public.rankball_refresh_team_mmr(new.team_id);
  end if;
  return null;
end;
$$;

drop trigger if exists rankball_team_members_refresh_roster_mmr
  on public.team_members;
create trigger rankball_team_members_refresh_roster_mmr
after insert or update of team_id, user_id, role or delete
on public.team_members
for each row execute function public.rankball_refresh_team_mmr_on_membership();

with ranked_history as (
  select distinct
    change.value->>'playerId' as profile_id,
    match_row.id as match_id,
    match_row.mode,
    coalesce(match_row.confirmed_at, match_row.ended_at, match_row.updated_at, match_row.created_at) as confirmed_at
  from public.matches match_row
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(match_row.rating_result) = 'array' then match_row.rating_result
      else '[]'::jsonb
    end
  ) change(value)
  where match_row.status = 'confirmed'
    and match_row.ranked = true
    and nullif(btrim(change.value->>'playerId'), '') is not null
), ordered_history as (
  select
    ranked_history.*,
    row_number() over (
      partition by profile_id
      order by confirmed_at, match_id
    ) as placement_number
  from ranked_history
), placement_summary as (
  select
    profile_id,
    least(5, count(*))::smallint as match_count,
    max(confirmed_at) filter (where placement_number = 5) as completed_at
  from ordered_history
  group by profile_id
), mode_summary as (
  select
    profile_id,
    jsonb_object_agg(mode, mode_count) as mode_counts
  from (
    select profile_id, mode, count(*)::integer as mode_count
    from ranked_history
    group by profile_id, mode
  ) counted
  group by profile_id
), normalized as (
  select
    profile.id,
    coalesce(summary.match_count, 0)::smallint as match_count,
    coalesce(summary.completed_at, null) as completed_at,
    coalesce(mode_summary.mode_counts, '{}'::jsonb) as mode_counts,
    coalesce(
      case
        when coalesce(profile.ratings->>'integrated', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (profile.ratings->>'integrated')::numeric
      end,
      1200
    ) as current_mmr
  from public.profiles profile
  left join placement_summary summary on summary.profile_id = profile.id
  left join mode_summary on mode_summary.profile_id = profile.id
)
update public.profiles profile
set
  placement_match_count = normalized.match_count,
  placement_evidence_weight = normalized.match_count,
  placement_weighted_sum = normalized.current_mmr * (2.5 + normalized.match_count),
  placement_completed_at = normalized.completed_at,
  ratings = jsonb_set(
    coalesce(profile.ratings, jsonb_build_object('integrated', normalized.current_mmr, 'modes', '{}'::jsonb)),
    '{placement}',
    jsonb_build_object(
      'matchCount', normalized.match_count,
      'target', 5,
      'completed', normalized.match_count >= 5,
      'completedAt', normalized.completed_at,
      'evidenceWeight', normalized.match_count,
      'weightedTotal', normalized.current_mmr * (2.5 + normalized.match_count),
      'modeCounts', normalized.mode_counts
    ),
    true
  ),
  updated_at = now()
from normalized
where profile.id = normalized.id;

update public.teams team
set
  roster_mmr = public.rankball_team_roster_mmr(team.id),
  performance_adjustment = greatest(
    -150,
    least(150, coalesce(team.mmr, 1200) - public.rankball_team_roster_mmr(team.id))
  ),
  mmr = round(
    public.rankball_team_roster_mmr(team.id)
    + greatest(
      -150,
      least(150, coalesce(team.mmr, 1200) - public.rankball_team_roster_mmr(team.id))
    )
  ),
  updated_at = now()
where team.deleted_at is null;

create or replace function public.rankball_match_rating_scale(p_rules jsonb, p_ranked boolean)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_ranked, false) = false then 0
    when coalesce(p_rules->>'mmrRangeRatingScale', '') ~ '^[0-9]+([.][0-9]+)?$'
      or coalesce(p_rules->>'pickupAssignmentRatingScale', '') ~ '^[0-9]+([.][0-9]+)?$'
      then greatest(
        0.2,
        least(
          1.5,
          case
            when coalesce(p_rules->>'mmrRangeRatingScale', '') ~ '^[0-9]+([.][0-9]+)?$'
              then (p_rules->>'mmrRangeRatingScale')::numeric
            else 1
          end
          * case
            when coalesce(p_rules->>'pickupAssignmentRatingScale', '') ~ '^[0-9]+([.][0-9]+)?$'
              then (p_rules->>'pickupAssignmentRatingScale')::numeric
            else 1
          end
        )
      )
    when coalesce(p_rules->>'ratingScale', '') ~ '^[0-9]+([.][0-9]+)?$'
      then greatest(0.2, least(1.5, (p_rules->>'ratingScale')::numeric))
    else 1
  end
$$;

create or replace function public.rankball_apply_placement_and_team_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_row record;
  profile_row public.profiles%rowtype;
  side_size integer;
  teammate_mmr_total numeric;
  opponent_mmr numeric;
  actual numeric;
  sample_mmr numeric;
  sample_weight numeric;
  next_count smallint;
  next_evidence_weight numeric;
  next_weighted_sum numeric;
  next_integrated numeric;
  next_ratings jsonb;
  next_rating_result jsonb;
  safe_mode text := coalesce(nullif(btrim(new.mode), ''), '5v5');
  team_entry record;
  team_row public.teams%rowtype;
  raw_team_delta numeric;
  regular_ratio numeric;
  applied_team_delta numeric;
  next_performance numeric;
  next_roster numeric;
  next_team_changes jsonb := '{}'::jsonb;
  next_team_a_delta numeric := 0;
  next_team_b_delta numeric := 0;
  team_side text;
begin
  if new.status <> 'confirmed'
     or old.status = 'confirmed'
     or coalesce(new.ranked, false) = false then
    return new;
  end if;

  sample_weight := public.rankball_match_rating_scale(new.rules, new.ranked);
  next_rating_result := case
    when jsonb_typeof(new.rating_result) = 'array' then new.rating_result
    else '[]'::jsonb
  end;

  for snapshot_row in
    select *
    from public.match_player_competitive_snapshots snapshot
    where snapshot.match_id = new.id
      and snapshot.mmr_eligible
    order by snapshot.profile_id
  loop
    select * into profile_row
    from public.profiles
    where id = snapshot_row.profile_id
    for update;

    if profile_row.id is null
       or coalesce(profile_row.placement_match_count, 0) >= 5 then
      continue;
    end if;

    select
      count(*)::integer,
      coalesce(sum(coalesce(teammate.integrated_mmr, teammate.mode_mmr, 1200))
        filter (where teammate.profile_id <> snapshot_row.profile_id), 0)
    into side_size, teammate_mmr_total
    from public.match_player_competitive_snapshots teammate
    where teammate.match_id = new.id
      and teammate.side = snapshot_row.side
      and teammate.mmr_eligible;

    select coalesce(avg(coalesce(opponent.integrated_mmr, opponent.mode_mmr, 1200)), 1200)
    into opponent_mmr
    from public.match_player_competitive_snapshots opponent
    where opponent.match_id = new.id
      and opponent.side <> snapshot_row.side
      and opponent.mmr_eligible;

    actual := case
      when coalesce(new.score_a, 0) = coalesce(new.score_b, 0) then 0.5
      when snapshot_row.side = 'teamA' and coalesce(new.score_a, 0) > coalesce(new.score_b, 0) then 1
      when snapshot_row.side = 'teamB' and coalesce(new.score_b, 0) > coalesce(new.score_a, 0) then 1
      else 0
    end;
    sample_mmr := greatest(
      600,
      least(
        2000,
        greatest(1, coalesce(side_size, 1)) * coalesce(opponent_mmr, 1200)
          - coalesce(teammate_mmr_total, 0)
          + case when actual = 1 then 200 when actual = 0 then -200 else 0 end
      )
    );
    next_count := least(5, coalesce(profile_row.placement_match_count, 0) + 1);
    next_evidence_weight := coalesce(profile_row.placement_evidence_weight, 0) + sample_weight;
    next_weighted_sum := coalesce(profile_row.placement_weighted_sum, 3000) + sample_mmr * sample_weight;
    next_integrated := round(next_weighted_sum / (2.5 + next_evidence_weight));
    if next_count >= 5 then
      next_integrated := greatest(800, least(1799, next_integrated));
    else
      next_integrated := greatest(600, least(2000, next_integrated));
    end if;

    next_ratings := jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(profile_row.ratings, jsonb_build_object('integrated', 1200, 'modes', '{}'::jsonb)),
          '{integrated}',
          to_jsonb(next_integrated),
          true
        ),
        array['modes', safe_mode],
        to_jsonb(next_integrated),
        true
      ),
      '{placement}',
      jsonb_build_object(
        'matchCount', next_count,
        'target', 5,
        'completed', next_count >= 5,
        'completedAt', case when next_count >= 5 then coalesce(new.confirmed_at, now()) else null end,
        'evidenceWeight', next_evidence_weight,
        'weightedTotal', next_weighted_sum,
        'modeCounts',
          coalesce(profile_row.ratings #> '{placement,modeCounts}', '{}'::jsonb)
          || jsonb_build_object(
            safe_mode,
            coalesce(
              case
                when coalesce(profile_row.ratings #>> array['placement', 'modeCounts', safe_mode], '') ~ '^[0-9]+$'
                  then (profile_row.ratings #>> array['placement', 'modeCounts', safe_mode])::integer
              end,
              0
            ) + 1
          )
      ),
      true
    );

    update public.profiles
    set
      ratings = next_ratings,
      placement_match_count = next_count,
      placement_evidence_weight = next_evidence_weight,
      placement_weighted_sum = next_weighted_sum,
      placement_completed_at = case
        when next_count >= 5 then coalesce(new.confirmed_at, now())
        else null
      end,
      updated_at = now()
    where id = profile_row.id;

    select coalesce(jsonb_agg(
      case
        when change.value->>'playerId' = profile_row.id then
          change.value
          || jsonb_build_object(
            'modeDelta', next_integrated - coalesce(snapshot_row.mode_mmr, snapshot_row.integrated_mmr, 1200),
            'integratedDelta', next_integrated - coalesce(snapshot_row.integrated_mmr, 1200),
            'statBoost', 0,
            'placement', jsonb_build_object(
              'countBefore', next_count - 1,
              'countAfter', next_count,
              'sampleMmr', sample_mmr,
              'weight', sample_weight,
              'integratedBefore', coalesce(snapshot_row.integrated_mmr, 1200),
              'integratedAfter', next_integrated
            )
          )
        else change.value
      end
      order by change.ordinality
    ), '[]'::jsonb)
    into next_rating_result
    from jsonb_array_elements(next_rating_result)
      with ordinality as change(value, ordinality);
  end loop;

  new.rating_result := next_rating_result;

  for team_entry in
    select entry.key as team_id, entry.value
    from jsonb_each(
      case
        when jsonb_typeof(new.team_rating_result->'teams') = 'object'
          then new.team_rating_result->'teams'
        else '{}'::jsonb
      end
    ) entry
    order by entry.key
  loop
    select * into team_row
    from public.teams
    where id = team_entry.team_id
    for update;
    if team_row.id is null then
      continue;
    end if;

    raw_team_delta := coalesce(
      case
        when jsonb_typeof(team_entry.value) = 'number'
          then (team_entry.value #>> '{}')::numeric
        when coalesce(team_entry.value->>'delta', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (team_entry.value->>'delta')::numeric
      end,
      0
    );
    select case
      when count(*) = 0 then 0
      else count(*) filter (
        where snapshot.team_role in ('captain', 'regular')
      )::numeric / count(*)::numeric
    end
    into regular_ratio
    from public.match_player_competitive_snapshots snapshot
    where snapshot.match_id = new.id
      and snapshot.team_id = team_entry.team_id
      and snapshot.mmr_eligible;

    applied_team_delta := round(raw_team_delta * coalesce(regular_ratio, 0), 1);
    next_roster := public.rankball_team_roster_mmr(team_row.id);
    next_performance := greatest(
      -150,
      least(150, coalesce(team_row.performance_adjustment, 0) + applied_team_delta)
    );
    update public.teams
    set
      roster_mmr = next_roster,
      performance_adjustment = next_performance,
      mmr = round(next_roster + next_performance),
      updated_at = now()
    where id = team_row.id;

    select snapshot.side
    into team_side
    from public.match_player_competitive_snapshots snapshot
    where snapshot.match_id = new.id
      and snapshot.team_id = team_row.id
    limit 1;
    if team_side = 'teamA' then
      next_team_a_delta := next_team_a_delta + applied_team_delta;
    elsif team_side = 'teamB' then
      next_team_b_delta := next_team_b_delta + applied_team_delta;
    end if;

    next_team_changes := jsonb_set(
      next_team_changes,
      array[team_row.id],
      jsonb_build_object(
        'delta', applied_team_delta,
        'rawDelta', raw_team_delta,
        'regularRatio', coalesce(regular_ratio, 0),
        'rosterMmr', next_roster,
        'performanceBefore', coalesce(team_row.performance_adjustment, 0),
        'performanceAfter', next_performance,
        'mmrBefore', coalesce(team_row.roster_mmr, next_roster)
          + coalesce(team_row.performance_adjustment, 0),
        'mmrAfter', next_roster + next_performance
      ),
      true
    );
  end loop;

  if next_team_changes <> '{}'::jsonb then
    new.team_rating_result := jsonb_build_object(
      'teamA', next_team_a_delta,
      'teamB', next_team_b_delta,
      'teams', next_team_changes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_matches_apply_placement_and_team_rating
  on public.matches;
create trigger rankball_matches_apply_placement_and_team_rating
before update of status, rating_result, team_rating_result
on public.matches
for each row execute function public.rankball_apply_placement_and_team_rating();

do $migration$
begin
  if to_regprocedure(
    'public.rankball_commit_match_rating_pre_placement_model(text,text,jsonb,jsonb,jsonb,jsonb,timestamptz)'
  ) is null then
    alter function public.rankball_commit_match_rating(
      text, text, jsonb, jsonb, jsonb, jsonb, timestamptz
    ) rename to rankball_commit_match_rating_pre_placement_model;
  end if;
end;
$migration$;

create or replace function public.rankball_commit_match_rating(
  p_match_id text,
  p_actor_profile_id text,
  p_rating_result jsonb,
  p_team_rating_result jsonb,
  p_profile_updates jsonb default '[]'::jsonb,
  p_team_updates jsonb default '[]'::jsonb,
  p_confirmed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  match_ranked boolean;
begin
  select ranked into match_ranked
  from public.matches
  where id = nullif(btrim(p_match_id), '');

  if coalesce(match_ranked, false)
     and (
       jsonb_array_length(coalesce(p_rating_result, '[]'::jsonb)) > 0
       or jsonb_array_length(coalesce(p_profile_updates, '[]'::jsonb)) > 0
       or jsonb_array_length(coalesce(p_team_updates, '[]'::jsonb)) > 0
     ) then
    raise exception 'ranked_rating_locked_finalizer_required' using errcode = '42501';
  end if;

  return public.rankball_commit_match_rating_pre_placement_model(
    p_match_id,
    p_actor_profile_id,
    p_rating_result,
    p_team_rating_result,
    p_profile_updates,
    p_team_updates,
    p_confirmed_at
  );
end;
$$;

revoke all on function public.rankball_commit_match_rating(
  text, text, jsonb, jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.rankball_commit_match_rating(
  text, text, jsonb, jsonb, jsonb, jsonb, timestamptz
) to service_role;
revoke all on function public.rankball_commit_match_rating_pre_placement_model(
  text, text, jsonb, jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated, service_role;

do $migration$
declare
  function_definition text;
  old_text text := $old$greatest(0.2, least(1.15, coalesce((current_match.rules->>'ratingScale')::numeric, 1)))$old$;
  new_text text := $new$greatest(0.2, least(1.5, coalesce((current_match.rules->>'ratingScale')::numeric, 1)))$new$;
begin
  select pg_get_functiondef(
    'public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure
  ) into function_definition;
  if position(old_text in function_definition) > 0 then
    execute replace(function_definition, old_text, new_text);
  elsif position(new_text in function_definition) = 0 then
    raise exception 'match_finalize_rating_scale_shape_changed';
  end if;
end;
$migration$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_generate_pickup_assignment_pre_rating_scale_split(text,text,text)'
  ) is null then
    alter function public.rankball_match_generate_pickup_assignment(text, text, text)
      rename to rankball_match_generate_pickup_assignment_pre_rating_scale_split;
  end if;
end;
$migration$;

create or replace function public.rankball_match_generate_pickup_assignment(
  p_actor_profile_id text,
  p_match_id text,
  p_assignment_mode text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before_match public.matches%rowtype;
  result jsonb;
  range_scale numeric;
  assignment_scale numeric;
  combined_scale numeric;
begin
  select * into before_match
  from public.matches
  where id = nullif(btrim(p_match_id), '');

  result := public.rankball_match_generate_pickup_assignment_pre_rating_scale_split(
    p_actor_profile_id,
    p_match_id,
    p_assignment_mode
  );
  range_scale := case
    when coalesce(before_match.rules->>'mmrRangeRatingScale', '') ~ '^[0-9]+([.][0-9]+)?$'
      then (before_match.rules->>'mmrRangeRatingScale')::numeric
    when coalesce(before_match.rules->>'ratingScale', '') ~ '^[0-9]+([.][0-9]+)?$'
      then (before_match.rules->>'ratingScale')::numeric
    else 1
  end;
  assignment_scale := case
    when p_assignment_mode = 'manual' then 0.9
    when p_assignment_mode = 'mmr_balanced' then 1.1
    else 1
  end;
  combined_scale := case
    when before_match.ranked = false then 0
    else range_scale * assignment_scale
  end;

  update public.matches
  set
    rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
      'mmrRangeRatingScale', range_scale,
      'pickupAssignmentRatingScale', assignment_scale,
      'ratingScale', combined_scale
    ),
    updated_at = now()
  where id = p_match_id;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'ratingScale', combined_scale,
    'mmrRangeRatingScale', range_scale,
    'pickupAssignmentRatingScale', assignment_scale
  );
end;
$$;

revoke all on function public.rankball_match_generate_pickup_assignment(text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_generate_pickup_assignment(text, text, text)
  to service_role;
revoke all on function public.rankball_match_generate_pickup_assignment_pre_rating_scale_split(text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_generate_pickup_assignment_pre_rating_scale_split(text, text, text)
  to service_role;

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
              when coalesce((new.rules ->> 'gameClockEnabled')::boolean, false) = false
                   and play_interval.started_at is not null then
                greatest(
                  0,
                  extract(epoch from (
                    coalesce(play_interval.ended_at, new.ended_at)
                    - play_interval.started_at
                  ))
                )
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
    set
      mmr_excluded_player_ids = next_excluded,
      rules = next_rules,
      updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

create or replace view public.public_profiles as
select
  id,
  name,
  handle,
  hashtag,
  position,
  region,
  region_sido,
  region_district,
  trust_score,
  streak,
  avatar_color,
  ratings,
  age_group,
  age_group_checked_season,
  onboarding_complete,
  updated_at,
  avatar_key,
  avatar_source,
  avatar_updated_at,
  avatar_border_enabled,
  avatar_border_color,
  discord_avatar_url,
  avatar_icon_key,
  affiliation_id,
  avatar_background_enabled,
  placement_match_count
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
