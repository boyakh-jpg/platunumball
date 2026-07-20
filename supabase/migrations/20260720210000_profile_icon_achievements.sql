alter table public.match_players
  add column if not exists position text;

update public.match_players match_player
set position = upper(profile.position)
from public.profiles profile
where profile.id = match_player.user_id
  and nullif(btrim(match_player.position), '') is null
  and upper(coalesce(profile.position, '')) in ('PG', 'SG', 'SF', 'PF', 'C');

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'match_players_position_check') then
    alter table public.match_players
      add constraint match_players_position_check
      check (position is null or position in ('PG', 'SG', 'SF', 'PF', 'C'));
  end if;
end $$;

create or replace function public.rankball_snapshot_match_player_position()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  profile_position text;
begin
  if upper(coalesce(new.position, '')) in ('PG', 'SG', 'SF', 'PF', 'C') then
    new.position := upper(new.position);
    return new;
  end if;

  select upper(position) into profile_position
  from public.profiles
  where id = new.user_id;

  new.position := case
    when profile_position in ('PG', 'SG', 'SF', 'PF', 'C') then profile_position
    else null
  end;
  return new;
end;
$$;

drop trigger if exists rankball_match_players_position_snapshot on public.match_players;
create trigger rankball_match_players_position_snapshot
before insert or update of user_id, position
on public.match_players
for each row execute function public.rankball_snapshot_match_player_position();

create index if not exists match_players_user_position_match_idx
  on public.match_players (user_id, position, match_id);

create table if not exists public.profile_icon_unlocks (
  profile_id text not null references public.profiles(id) on delete cascade,
  icon_key text not null,
  unlocked_at timestamptz not null default now(),
  progress_snapshot jsonb not null default '{}'::jsonb,
  primary key (profile_id, icon_key),
  constraint profile_icon_unlocks_icon_key_check
    check (icon_key ~ '^[0-9]{2}-[a-z0-9][a-z0-9-]{0,76}$')
);

create index if not exists profile_icon_unlocks_profile_unlocked_idx
  on public.profile_icon_unlocks (profile_id, unlocked_at desc, icon_key);

alter table public.profile_icon_unlocks enable row level security;

drop policy if exists profile_icon_unlocks_select_self on public.profile_icon_unlocks;
create policy profile_icon_unlocks_select_self
on public.profile_icon_unlocks
for select
to authenticated
using (
  profile_id = public.current_profile_id()
  or exists (
    select 1
    from public.profiles profile
    where profile.id = profile_id
      and profile.auth_user_id = auth.uid()
  )
);

revoke all on public.profile_icon_unlocks from anon, authenticated;
grant select on public.profile_icon_unlocks to authenticated;
grant all on public.profile_icon_unlocks to service_role;

insert into public.profile_icon_unlocks (profile_id, icon_key, progress_snapshot)
select profile.id, default_icon.icon_key, jsonb_build_object('source', 'default')
from public.profiles profile
cross join unnest(array[
  '01-first-bucket',
  '02-court-rookie',
  '03-laced-up',
  '04-ready-whistle',
  '05-playbook'
]) as default_icon(icon_key)
on conflict (profile_id, icon_key) do nothing;

create or replace function public.rankball_profile_icon_metrics(p_profile_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  match_count integer := 0;
  win_count integer := 0;
  points_count integer := 0;
  rebounds_count integer := 0;
  assists_count integer := 0;
  steals_count integer := 0;
  blocks_count integer := 0;
  trust_score_value integer := 0;
  best_streak integer := 0;
  current_streak integer := 0;
  integrated_mmr integer := 0;
  team_count integer := 0;
  captain_count integer := 0;
  close_win_count integer := 0;
  team_match_count integer := 0;
  night_match_count integer := 0;
  pg_appearances integer := 0;
  sg_appearances integer := 0;
  sf_appearances integer := 0;
  pf_appearances integer := 0;
  c_appearances integer := 0;
  double_double_count integer := 0;
  triple_double_count integer := 0;
  mvp_performance_count integer := 0;
  referee_count integer := 0;
  recorder_count integer := 0;
  court_contribution_count integer := 0;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id' using errcode = '22023';
  end if;

  select
    coalesce(summary.match_count, 0),
    coalesce(summary.win_count, 0),
    coalesce(summary.points, 0),
    coalesce(summary.rebounds, 0),
    coalesce(summary.assists, 0),
    coalesce(summary.steals, 0),
    coalesce(summary.blocks, 0),
    coalesce(profile.trust_score, 0),
    coalesce(profile.streak, 0),
    case
      when coalesce(profile.ratings->>'integrated', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then round((profile.ratings->>'integrated')::numeric)::integer
      else 0
    end
  into
    match_count,
    win_count,
    points_count,
    rebounds_count,
    assists_count,
    steals_count,
    blocks_count,
    trust_score_value,
    current_streak,
    integrated_mmr
  from public.profiles profile
  left join public.profile_match_summaries summary on summary.profile_id = profile.id
  where profile.id = safe_profile_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  with participant_matches as (
    select distinct on (match_row.id)
      match_row.id,
      match_player.position,
      match_player.team_id,
      coalesce(nullif(match_player.side, ''), 'teamA') as side,
      coalesce(result_row.score_a, match_row.score_a, 0) as score_a,
      coalesce(result_row.score_b, match_row.score_b, 0) as score_b,
      public.rankball_match_summary_at(
        match_row.confirmed_at,
        match_row.ended_at,
        match_row.started_at,
        match_row.scheduled_date,
        match_row.scheduled_time,
        match_row.created_at
      ) as match_at,
      case
        when nullif(match_row.scheduled_time::text, '') is not null
          then nullif(match_row.scheduled_time::text, '')::time
        else null
      end as scheduled_time_value
    from public.match_players match_player
    join public.matches match_row on match_row.id = match_player.match_id
    left join lateral (
      select result.score_a, result.score_b
      from public.match_results result
      where result.match_id = match_row.id
      order by result.submitted_at desc nulls last
      limit 1
    ) result_row on true
    where match_player.user_id = safe_profile_id
      and match_row.status = 'confirmed'
    order by match_row.id, match_player.slot_order nulls last
  ), outcomes as (
    select participant_matches.*,
      case
        when score_a = score_b then 'draw'
        when side in ('teamB', 'B', 'b') and score_b > score_a then 'win'
        when side not in ('teamB', 'B', 'b') and score_a > score_b then 'win'
        else 'loss'
      end as outcome
    from participant_matches
  )
  select
    count(*) filter (where outcome = 'win' and abs(score_a - score_b) <= 2)::integer,
    count(*) filter (where team_id is not null)::integer,
    count(*) filter (where scheduled_time_value >= time '21:00')::integer,
    count(*) filter (where position = 'PG')::integer,
    count(*) filter (where position = 'SG')::integer,
    count(*) filter (where position = 'SF')::integer,
    count(*) filter (where position = 'PF')::integer,
    count(*) filter (where position = 'C')::integer
  into
    close_win_count,
    team_match_count,
    night_match_count,
    pg_appearances,
    sg_appearances,
    sf_appearances,
    pf_appearances,
    c_appearances
  from outcomes;

  with participant_matches as (
    select distinct on (match_row.id)
      match_row.id,
      coalesce(nullif(match_player.side, ''), 'teamA') as side,
      coalesce(result_row.score_a, match_row.score_a, 0) as score_a,
      coalesce(result_row.score_b, match_row.score_b, 0) as score_b,
      public.rankball_match_summary_at(
        match_row.confirmed_at,
        match_row.ended_at,
        match_row.started_at,
        match_row.scheduled_date,
        match_row.scheduled_time,
        match_row.created_at
      ) as match_at
    from public.match_players match_player
    join public.matches match_row on match_row.id = match_player.match_id
    left join lateral (
      select result.score_a, result.score_b
      from public.match_results result
      where result.match_id = match_row.id
      order by result.submitted_at desc nulls last
      limit 1
    ) result_row on true
    where match_player.user_id = safe_profile_id
      and match_row.status = 'confirmed'
    order by match_row.id, match_player.slot_order nulls last
  ), ordered_outcomes as (
    select participant_matches.*,
      case
        when score_a = score_b then false
        when side in ('teamB', 'B', 'b') then score_b > score_a
        else score_a > score_b
      end as won
    from participant_matches
  ), grouped_outcomes as (
    select ordered_outcomes.*,
      sum(case when won then 0 else 1 end) over (order by match_at nulls first, id) as streak_group
    from ordered_outcomes
  ), streak_lengths as (
    select count(*) filter (where won)::integer as streak_length
    from grouped_outcomes
    group by streak_group
  )
  select coalesce(max(streak_length), 0) into best_streak
  from streak_lengths;

  select
    count(*) filter (where
      (case when coalesce(stat.points, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.rebounds, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.assists, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.steals, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.blocks, 0) >= 10 then 1 else 0 end) >= 2
    )::integer,
    count(*) filter (where
      (case when coalesce(stat.points, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.rebounds, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.assists, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.steals, 0) >= 10 then 1 else 0 end)
      + (case when coalesce(stat.blocks, 0) >= 10 then 1 else 0 end) >= 3
    )::integer,
    count(*) filter (where coalesce(stat.points, 0) >= 20 and coalesce(stat.rebounds, 0) + coalesce(stat.assists, 0) >= 10)::integer
  into double_double_count, triple_double_count, mvp_performance_count
  from public.player_match_stats stat
  join public.matches match_row on match_row.id = stat.match_id
  where stat.user_id = safe_profile_id
    and match_row.status = 'confirmed';

  select
    count(*)::integer,
    count(*) filter (where role = 'captain')::integer
  into team_count, captain_count
  from public.team_members
  where user_id = safe_profile_id;

  select count(distinct match_row.id)::integer
  into referee_count
  from public.matches match_row
  where match_row.status = 'confirmed'
    and safe_profile_id in (match_row.referee_id, match_row.former_referee_id);

  select count(distinct match_row.id)::integer
  into recorder_count
  from public.matches match_row
  where match_row.status = 'confirmed'
    and (
      coalesce(match_row.stat_recorders, '{}'::jsonb)->>'teamA' = safe_profile_id
      or coalesce(match_row.stat_recorders, '{}'::jsonb)->>'teamB' = safe_profile_id
      or coalesce(match_row.rules->'statRecorders', '{}'::jsonb)->>'teamA' = safe_profile_id
      or coalesce(match_row.rules->'statRecorders', '{}'::jsonb)->>'teamB' = safe_profile_id
    );

  select
    coalesce((select count(*) from public.court_reviews review where review.reviewer_id = safe_profile_id and review.status = 'active'), 0)
    + coalesce((select count(*) from public.court_requests request where request.requested_by = safe_profile_id and request.status = 'approved'), 0)
  into court_contribution_count;

  return jsonb_build_object(
    'matchCount', match_count,
    'winCount', win_count,
    'points', points_count,
    'rebounds', rebounds_count,
    'assists', assists_count,
    'stealsBlocks', steals_count + blocks_count,
    'interiorStops', rebounds_count + blocks_count,
    'trustScore', trust_score_value,
    'streak', greatest(current_streak, best_streak),
    'integratedMmr', integrated_mmr,
    'teamCount', team_count,
    'captainCount', captain_count,
    'closeWinCount', close_win_count,
    'teamMatchCount', team_match_count,
    'nightMatchCount', night_match_count,
    'pgAppearances', pg_appearances,
    'sgAppearances', sg_appearances,
    'sfAppearances', sf_appearances,
    'pfAppearances', pf_appearances,
    'cAppearances', c_appearances,
    'doubleDoubleCount', double_double_count,
    'tripleDoubleCount', triple_double_count,
    'mvpPerformanceCount', mvp_performance_count,
    'refereeCount', referee_count,
    'recorderCount', recorder_count,
    'courtContributionCount', court_contribution_count
  );
end;
$$;

create or replace function public.rankball_save_profile_icon_settings(
  p_actor_profile_id text,
  p_avatar_source text,
  p_avatar_icon_key text,
  p_avatar_color text,
  p_border_enabled boolean,
  p_border_color text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
  safe_source text := lower(btrim(coalesce(p_avatar_source, 'initial')));
  safe_icon_key text := lower(btrim(coalesce(p_avatar_icon_key, '')));
  safe_avatar_color text := lower(btrim(coalesce(p_avatar_color, '#58d2c0')));
  safe_border_color text := lower(btrim(coalesce(p_border_color, '#58d2c0')));
  now_at timestamptz := clock_timestamp();
begin
  select * into current_profile
  from public.profiles
  where id = p_actor_profile_id
  for update;

  if current_profile.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  if safe_source not in ('initial', 'discord', 'icon') then
    raise exception 'invalid_profile_emblem_source' using errcode = '22023';
  end if;
  if safe_avatar_color !~ '^#[0-9a-f]{6}$' or safe_border_color !~ '^#[0-9a-f]{6}$' then
    raise exception 'invalid_emblem_color' using errcode = '22023';
  end if;
  if safe_source = 'discord' and (
    coalesce(current_profile.discord_connection->>'status', '') <> 'linked'
    or nullif(current_profile.discord_avatar_url, '') is null
  ) then
    raise exception 'discord_avatar_unavailable' using errcode = '22023';
  end if;
  if safe_source = 'icon' and not exists (
    select 1
    from public.profile_icon_unlocks unlocked
    where unlocked.profile_id = current_profile.id
      and unlocked.icon_key = safe_icon_key
  ) then
    raise exception 'profile_icon_unavailable' using errcode = '22023';
  end if;

  update public.profiles
  set
    avatar_source = safe_source,
    avatar_icon_key = case when safe_source = 'icon' then safe_icon_key else avatar_icon_key end,
    avatar_color = safe_avatar_color,
    avatar_border_enabled = coalesce(p_border_enabled, false),
    avatar_border_color = safe_border_color,
    avatar_updated_at = now_at,
    updated_at = now_at
  where id = current_profile.id
  returning * into current_profile;

  return jsonb_build_object(
    'ok', true,
    'profileId', current_profile.id,
    'avatarSource', current_profile.avatar_source,
    'avatarIconKey', current_profile.avatar_icon_key,
    'avatarColor', current_profile.avatar_color,
    'avatarBorderEnabled', current_profile.avatar_border_enabled,
    'avatarBorderColor', current_profile.avatar_border_color,
    'avatarUpdatedAt', current_profile.avatar_updated_at
  );
end;
$$;

create or replace function public.rankball_select_profile_icon(
  p_actor_profile_id text,
  p_icon_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.profiles%rowtype;
begin
  select * into current_profile
  from public.profiles
  where id = p_actor_profile_id;

  if current_profile.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  return public.rankball_save_profile_icon_settings(
    current_profile.id,
    'icon',
    p_icon_key,
    current_profile.avatar_color,
    current_profile.avatar_border_enabled,
    current_profile.avatar_border_color
  );
end;
$$;

revoke all on function public.rankball_profile_icon_metrics(text) from public, anon, authenticated;
grant execute on function public.rankball_profile_icon_metrics(text) to service_role;
revoke all on function public.rankball_save_profile_icon_settings(text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.rankball_save_profile_icon_settings(text, text, text, text, boolean, text) to service_role;
revoke all on function public.rankball_select_profile_icon(text, text) from public, anon, authenticated;
grant execute on function public.rankball_select_profile_icon(text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
