create table if not exists public.match_player_competitive_snapshots (
  match_id text not null references public.matches(id) on delete cascade,
  profile_id text not null references public.profiles(id) on delete cascade,
  side text not null,
  age_group text not null,
  mode_mmr numeric,
  mmr_eligible boolean not null default false,
  snapshot_source text not null default 'pre_finalize',
  snapshotted_at timestamptz not null default now(),
  primary key (match_id, profile_id),
  constraint match_player_competitive_snapshots_side_check
    check (side in ('teamA', 'teamB')),
  constraint match_player_competitive_snapshots_age_group_check
    check (age_group in ('junior', 'rising', 'open')),
  constraint match_player_competitive_snapshots_mode_mmr_check
    check (mode_mmr is null or mode_mmr >= 0),
  constraint match_player_competitive_snapshots_source_check
    check (snapshot_source in ('pre_finalize', 'legacy_backfill'))
);

create index if not exists match_player_competitive_snapshots_profile_match_idx
  on public.match_player_competitive_snapshots (profile_id, match_id);

create index if not exists match_player_competitive_snapshots_match_side_idx
  on public.match_player_competitive_snapshots (match_id, side, age_group);

alter table public.match_player_competitive_snapshots enable row level security;
revoke all on public.match_player_competitive_snapshots from public, anon, authenticated;
grant all on public.match_player_competitive_snapshots to service_role;

create or replace function public.rankball_profile_age_group_at(
  p_profile_id text,
  p_at_date date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when profile.birth_year between 1900 and extract(year from coalesce(p_at_date, current_date))::integer then
      case
        when extract(year from coalesce(p_at_date, current_date))::integer - profile.birth_year <= 12 then 'junior'
        when extract(year from coalesce(p_at_date, current_date))::integer - profile.birth_year <= 19 then 'rising'
        else 'open'
      end
    when lower(coalesce(nullif(btrim(profile.age_group), ''), 'open')) in ('junior', 'rising', 'open')
      then lower(coalesce(nullif(btrim(profile.age_group), ''), 'open'))
    else 'open'
  end
  from public.profiles profile
  where profile.id = nullif(btrim(p_profile_id), '')
$$;

revoke all on function public.rankball_profile_age_group_at(text, date) from public, anon, authenticated;
grant execute on function public.rankball_profile_age_group_at(text, date) to service_role;

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
      0 as source_priority
    from public.match_players match_player
    where match_player.match_id = safe_match_id
      and match_player.side in ('teamA', 'teamB')
      and nullif(btrim(match_player.user_id), '') is not null
    union all
    select played.value, 'teamA', 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA'
        else '[]'::jsonb
      end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union all
    select played.value, 'teamB', 1
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB'
        else '[]'::jsonb
      end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  ), actual_players as (
    select distinct on (profile_id) profile_id, side
    from actual_candidates
    order by profile_id, source_priority
  )
  insert into public.match_player_competitive_snapshots (
    match_id,
    profile_id,
    side,
    age_group,
    mode_mmr,
    mmr_eligible,
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
    coalesce(current_match.ranked, false)
      and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id,
    'pre_finalize',
    now()
  from actual_players actual_player
  join public.profiles profile on profile.id = actual_player.profile_id
  on conflict (match_id, profile_id) do nothing;
end;
$$;

revoke all on function public.rankball_snapshot_match_competitive(text) from public, anon, authenticated;
grant execute on function public.rankball_snapshot_match_competitive(text) to service_role;

do $migration$
declare
  function_definition text;
  old_return text := $old$  return public.rankball_match_finalize_locked_concurrency_inner(safe_actor_id, safe_match_id, p_action);$old$;
  new_return text := $new$  perform public.rankball_snapshot_match_competitive(safe_match_id);
  return public.rankball_match_finalize_locked_concurrency_inner(safe_actor_id, safe_match_id, p_action);$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_finalize_locked(text,text,text)'::regprocedure
  );

  if position('perform public.rankball_snapshot_match_competitive(safe_match_id);' in function_definition) = 0 then
    if position(old_return in function_definition) = 0 then
      raise exception 'rankball_match_finalize_snapshot_hook_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_return, new_return);
    execute function_definition;
  end if;
end;
$migration$;

revoke all on function public.rankball_match_finalize_locked(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text) to service_role;

with confirmed_matches as (
  select
    match_row.*,
    coalesce(
      match_row.scheduled_date,
      match_row.started_at::date,
      match_row.ended_at::date,
      match_row.confirmed_at::date,
      match_row.created_at::date,
      current_date
    ) as event_date
  from public.matches match_row
  where match_row.status = 'confirmed'
), actual_candidates as (
  select
    confirmed_match.id as match_id,
    confirmed_match.event_date,
    match_player.user_id as profile_id,
    match_player.side,
    0 as source_priority
  from confirmed_matches confirmed_match
  join public.match_players match_player on match_player.match_id = confirmed_match.id
  where match_player.side in ('teamA', 'teamB')
    and nullif(btrim(match_player.user_id), '') is not null
  union all
  select
    confirmed_match.id,
    confirmed_match.event_date,
    played.value,
    'teamA',
    1
  from confirmed_matches confirmed_match
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(confirmed_match.played_player_ids->'teamA') = 'array'
        then confirmed_match.played_player_ids->'teamA'
      else '[]'::jsonb
    end
  ) played(value)
  where nullif(btrim(played.value), '') is not null
  union all
  select
    confirmed_match.id,
    confirmed_match.event_date,
    played.value,
    'teamB',
    1
  from confirmed_matches confirmed_match
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(confirmed_match.played_player_ids->'teamB') = 'array'
        then confirmed_match.played_player_ids->'teamB'
      else '[]'::jsonb
    end
  ) played(value)
  where nullif(btrim(played.value), '') is not null
), actual_players as (
  select distinct on (match_id, profile_id)
    match_id,
    event_date,
    profile_id,
    side
  from actual_candidates
  order by match_id, profile_id, source_priority
)
insert into public.match_player_competitive_snapshots (
  match_id,
  profile_id,
  side,
  age_group,
  mode_mmr,
  mmr_eligible,
  snapshot_source,
  snapshotted_at
)
select
  actual_player.match_id,
  profile.id,
  actual_player.side,
  public.rankball_profile_age_group_at(profile.id, actual_player.event_date),
  null,
  false,
  'legacy_backfill',
  now()
from actual_players actual_player
join public.profiles profile on profile.id = actual_player.profile_id
on conflict (match_id, profile_id) do nothing;

create or replace function public.rankball_profile_icon_verified_metrics(p_profile_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  base_metrics jsonb;
  hosted_match_count integer := 0;
  distinct_court_count integer := 0;
  distinct_teammate_count integer := 0;
  distinct_opponent_count integer := 0;
  accepted_invite_count integer := 0;
  community_service_count integer := 0;
  position_variety_count integer := 0;
  junior_vs_rising_count integer := 0;
  junior_vs_open_count integer := 0;
  rising_vs_junior_count integer := 0;
  rising_vs_open_count integer := 0;
  open_vs_junior_count integer := 0;
  open_vs_rising_count integer := 0;
  age_underdog_win_count integer := 0;
  mmr_underdog_win_count integer := 0;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id' using errcode = '22023';
  end if;

  base_metrics := public.rankball_profile_icon_metrics(safe_profile_id)
    - 'points'
    - 'rebounds'
    - 'assists'
    - 'steals'
    - 'blocks'
    - 'stealsBlocks'
    - 'interiorStops'
    - 'doubleDoubleCount'
    - 'tripleDoubleCount'
    - 'mvpPerformanceCount'
    - 'scoringLeaderGameCount'
    - 'reboundLeaderGameCount'
    - 'assistLeaderGameCount'
    - 'stealLeaderGameCount'
    - 'blockLeaderGameCount';

  select count(*)::integer
  into hosted_match_count
  from public.matches match_row
  where match_row.created_by = safe_profile_id
    and match_row.status = 'confirmed';

  select count(distinct nullif(btrim(match_row.court_id), ''))::integer
  into distinct_court_count
  from public.match_players self_player
  join public.matches match_row on match_row.id = self_player.match_id
  where self_player.user_id = safe_profile_id
    and match_row.status = 'confirmed'
    and nullif(btrim(match_row.court_id), '') is not null;

  select count(distinct peer_player.user_id)::integer
  into distinct_teammate_count
  from public.match_players self_player
  join public.matches match_row on match_row.id = self_player.match_id
  join public.match_players peer_player on peer_player.match_id = self_player.match_id
  where self_player.user_id = safe_profile_id
    and match_row.status = 'confirmed'
    and nullif(btrim(peer_player.user_id), '') is not null
    and peer_player.user_id <> safe_profile_id
    and (
      case
        when lower(coalesce(nullif(self_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    ) = (
      case
        when lower(coalesce(nullif(peer_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    );

  select count(distinct peer_player.user_id)::integer
  into distinct_opponent_count
  from public.match_players self_player
  join public.matches match_row on match_row.id = self_player.match_id
  join public.match_players peer_player on peer_player.match_id = self_player.match_id
  where self_player.user_id = safe_profile_id
    and match_row.status = 'confirmed'
    and nullif(btrim(peer_player.user_id), '') is not null
    and peer_player.user_id <> safe_profile_id
    and (
      case
        when lower(coalesce(nullif(self_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    ) <> (
      case
        when lower(coalesce(nullif(peer_player.side, ''), 'teamA')) in ('teamb', 'b') then 'B'
        else 'A'
      end
    );

  with own_matches as (
    select
      own_snapshot.match_id,
      own_snapshot.side,
      own_snapshot.age_group,
      own_snapshot.mmr_eligible,
      match_row.ranked,
      coalesce(result_row.score_a, match_row.score_a, 0) as score_a,
      coalesce(result_row.score_b, match_row.score_b, 0) as score_b
    from public.match_player_competitive_snapshots own_snapshot
    join public.matches match_row on match_row.id = own_snapshot.match_id
    left join lateral (
      select result.score_a, result.score_b
      from public.match_results result
      where result.match_id = match_row.id
      order by result.submitted_at desc nulls last
      limit 1
    ) result_row on true
    where own_snapshot.profile_id = safe_profile_id
      and match_row.status = 'confirmed'
  ), competitive_matches as (
    select
      own_match.*,
      case
        when own_match.score_a = own_match.score_b then 'draw'
        when own_match.side = 'teamB' and own_match.score_b > own_match.score_a then 'win'
        when own_match.side = 'teamA' and own_match.score_a > own_match.score_b then 'win'
        else 'loss'
      end as outcome,
      exists (
        select 1
        from public.match_player_competitive_snapshots opponent
        where opponent.match_id = own_match.match_id
          and opponent.side <> own_match.side
          and opponent.age_group = 'junior'
      ) as has_junior_opponent,
      exists (
        select 1
        from public.match_player_competitive_snapshots opponent
        where opponent.match_id = own_match.match_id
          and opponent.side <> own_match.side
          and opponent.age_group = 'rising'
      ) as has_rising_opponent,
      exists (
        select 1
        from public.match_player_competitive_snapshots opponent
        where opponent.match_id = own_match.match_id
          and opponent.side <> own_match.side
          and opponent.age_group = 'open'
      ) as has_open_opponent,
      exists (
        select 1
        from public.match_player_competitive_snapshots opponent
        where opponent.match_id = own_match.match_id
          and opponent.side <> own_match.side
          and case opponent.age_group when 'junior' then 1 when 'rising' then 2 else 3 end
            > case own_match.age_group when 'junior' then 1 when 'rising' then 2 else 3 end
      ) as has_higher_age_opponent,
      (
        select avg(team_member.mode_mmr)
        from public.match_player_competitive_snapshots team_member
        where team_member.match_id = own_match.match_id
          and team_member.side = own_match.side
          and team_member.mmr_eligible
          and team_member.mode_mmr is not null
      ) as own_team_mmr,
      (
        select avg(opponent.mode_mmr)
        from public.match_player_competitive_snapshots opponent
        where opponent.match_id = own_match.match_id
          and opponent.side <> own_match.side
          and opponent.mmr_eligible
          and opponent.mode_mmr is not null
      ) as opponent_team_mmr
    from own_matches own_match
  )
  select
    count(*) filter (where age_group = 'junior' and has_rising_opponent)::integer,
    count(*) filter (where age_group = 'junior' and has_open_opponent)::integer,
    count(*) filter (where age_group = 'rising' and has_junior_opponent)::integer,
    count(*) filter (where age_group = 'rising' and has_open_opponent)::integer,
    count(*) filter (where age_group = 'open' and has_junior_opponent)::integer,
    count(*) filter (where age_group = 'open' and has_rising_opponent)::integer,
    count(*) filter (
      where ranked
        and outcome = 'win'
        and has_higher_age_opponent
    )::integer,
    count(*) filter (
      where ranked
        and outcome = 'win'
        and mmr_eligible
        and own_team_mmr is not null
        and opponent_team_mmr is not null
        and own_team_mmr + 200 <= opponent_team_mmr
    )::integer
  into
    junior_vs_rising_count,
    junior_vs_open_count,
    rising_vs_junior_count,
    rising_vs_open_count,
    open_vs_junior_count,
    open_vs_rising_count,
    age_underdog_win_count,
    mmr_underdog_win_count
  from competitive_matches;

  accepted_invite_count :=
    coalesce((base_metrics->>'recruitingInviteAcceptedCount')::integer, 0)
    + coalesce((base_metrics->>'teamInviteAcceptedCount')::integer, 0);

  community_service_count :=
    coalesce((base_metrics->>'refereeCount')::integer, 0)
    + coalesce((base_metrics->>'recorderCount')::integer, 0);

  position_variety_count :=
    case when coalesce((base_metrics->>'pgAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'sgAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'sfAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'pfAppearances')::integer, 0) > 0 then 1 else 0 end
    + case when coalesce((base_metrics->>'cAppearances')::integer, 0) > 0 then 1 else 0 end;

  return base_metrics || jsonb_build_object(
    'hostedMatchCount', hosted_match_count,
    'distinctCourtCount', distinct_court_count,
    'distinctTeammateCount', distinct_teammate_count,
    'distinctOpponentCount', distinct_opponent_count,
    'acceptedInviteCount', accepted_invite_count,
    'communityServiceCount', community_service_count,
    'positionVarietyCount', position_variety_count,
    'juniorVsRisingCount', junior_vs_rising_count,
    'juniorVsOpenCount', junior_vs_open_count,
    'risingVsJuniorCount', rising_vs_junior_count,
    'risingVsOpenCount', rising_vs_open_count,
    'openVsJuniorCount', open_vs_junior_count,
    'openVsRisingCount', open_vs_rising_count,
    'ageUnderdogWinCount', age_underdog_win_count,
    'mmrUnderdogWinCount', mmr_underdog_win_count
  );
end;
$$;

revoke all on function public.rankball_profile_icon_verified_metrics(text) from public, anon, authenticated;
grant execute on function public.rankball_profile_icon_verified_metrics(text) to service_role;

select pg_notify('pgrst', 'reload schema');
