create table if not exists public.profile_match_summaries (
  profile_id text primary key references public.profiles(id) on delete cascade,
  match_count integer not null default 0 check (match_count >= 0),
  win_count integer not null default 0 check (win_count >= 0),
  loss_count integer not null default 0 check (loss_count >= 0),
  draw_count integer not null default 0 check (draw_count >= 0),
  points integer not null default 0 check (points >= 0),
  rebounds integer not null default 0 check (rebounds >= 0),
  assists integer not null default 0 check (assists >= 0),
  steals integer not null default 0 check (steals >= 0),
  blocks integer not null default 0 check (blocks >= 0),
  fouls integer not null default 0 check (fouls >= 0),
  last_match_id text,
  last_match_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists profile_match_summaries_last_match_at_idx
  on public.profile_match_summaries (last_match_at desc);

alter table public.profile_match_summaries enable row level security;

drop policy if exists profile_match_summaries_select_self on public.profile_match_summaries;
create policy profile_match_summaries_select_self
on public.profile_match_summaries
for select
to authenticated
using (
  profile_id = public.current_profile_id()
  or exists (
    select 1
    from public.profiles p
    where p.id = profile_id
      and p.auth_user_id = auth.uid()
  )
);

revoke all on public.profile_match_summaries from anon;
grant select on public.profile_match_summaries to authenticated;
grant all on public.profile_match_summaries to service_role;

create or replace function public.rankball_match_summary_at(
  p_confirmed_at timestamptz,
  p_ended_at timestamptz,
  p_started_at timestamptz,
  p_scheduled_date date,
  p_scheduled_time time,
  p_created_at timestamptz
)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select coalesce(
    p_confirmed_at,
    p_ended_at,
    p_started_at,
    case
      when p_scheduled_date is not null and p_scheduled_time is not null then (p_scheduled_date::text || ' ' || p_scheduled_time::text)::timestamptz
      when p_scheduled_date is not null then p_scheduled_date::timestamptz
      else null
    end,
    p_created_at
  );
$$;

create or replace function public.rankball_rebuild_profile_match_summary(p_profile_id text)
returns public.profile_match_summaries
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  summary_row public.profile_match_summaries%rowtype;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id';
  end if;

  if not exists (select 1 from public.profiles where id = safe_profile_id) then
    raise exception 'profile_not_found';
  end if;

  with participant_matches as (
    select distinct on (m.id)
      m.id as match_id,
      coalesce(nullif(mp.side, ''), 'teamA') as side,
      coalesce(result.score_a, m.score_a, 0) as score_a,
      coalesce(result.score_b, m.score_b, 0) as score_b,
      public.rankball_match_summary_at(
        m.confirmed_at,
        m.ended_at,
        m.started_at,
        m.scheduled_date,
        m.scheduled_time,
        m.created_at
      ) as match_at
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.match_results result on result.match_id = m.id
    where mp.user_id = safe_profile_id
      and m.status = 'confirmed'
    order by m.id, mp.slot_order nulls last
  ),
  scored_matches as (
    select
      participant_matches.*,
      case
        when score_a = score_b then 'draw'
        when side in ('teamB', 'B', 'b') and score_b > score_a then 'win'
        when side not in ('teamB', 'B', 'b') and score_a > score_b then 'win'
        else 'loss'
      end as outcome
    from participant_matches
  ),
  aggregate_row as (
    select
      safe_profile_id as profile_id,
      count(*)::integer as match_count,
      count(*) filter (where outcome = 'win')::integer as win_count,
      count(*) filter (where outcome = 'loss')::integer as loss_count,
      count(*) filter (where outcome = 'draw')::integer as draw_count,
      coalesce(sum(coalesce(stat.points, 0)), 0)::integer as points,
      coalesce(sum(coalesce(stat.rebounds, 0)), 0)::integer as rebounds,
      coalesce(sum(coalesce(stat.assists, 0)), 0)::integer as assists,
      coalesce(sum(coalesce(stat.steals, 0)), 0)::integer as steals,
      coalesce(sum(coalesce(stat.blocks, 0)), 0)::integer as blocks,
      coalesce(sum(coalesce(stat.fouls, 0)), 0)::integer as fouls,
      (array_agg(scored_matches.match_id order by scored_matches.match_at desc nulls last, scored_matches.match_id desc))[1] as last_match_id,
      max(scored_matches.match_at) as last_match_at
    from scored_matches
    left join public.player_match_stats stat
      on stat.match_id = scored_matches.match_id
     and stat.user_id = safe_profile_id
  )
  insert into public.profile_match_summaries (
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    updated_at
  )
  select
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    now()
  from aggregate_row
  on conflict (profile_id) do update set
    match_count = excluded.match_count,
    win_count = excluded.win_count,
    loss_count = excluded.loss_count,
    draw_count = excluded.draw_count,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    fouls = excluded.fouls,
    last_match_id = excluded.last_match_id,
    last_match_at = excluded.last_match_at,
    updated_at = now()
  returning * into summary_row;

  return summary_row;
end;
$$;

revoke all on function public.rankball_rebuild_profile_match_summary(text) from public;
grant execute on function public.rankball_rebuild_profile_match_summary(text) to service_role;

create or replace function public.rankball_refresh_profile_match_summaries_for_match(p_match_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  profile_row record;
  refreshed_count integer := 0;
begin
  if safe_match_id is null then
    return 0;
  end if;

  if not exists (select 1 from public.matches where id = safe_match_id and status = 'confirmed') then
    return 0;
  end if;

  for profile_row in
    select distinct nullif(btrim(user_id), '') as profile_id
    from public.match_players
    where match_id = safe_match_id
      and nullif(btrim(user_id), '') is not null
  loop
    perform public.rankball_rebuild_profile_match_summary(profile_row.profile_id);
    refreshed_count := refreshed_count + 1;
  end loop;

  return refreshed_count;
end;
$$;

revoke all on function public.rankball_refresh_profile_match_summaries_for_match(text) from public;
grant execute on function public.rankball_refresh_profile_match_summaries_for_match(text) to service_role;

create or replace function public.rankball_refresh_all_profile_match_summaries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  refreshed_count integer := 0;
begin
  with participant_matches as (
    select distinct on (mp.user_id, m.id)
      mp.user_id as profile_id,
      m.id as match_id,
      coalesce(nullif(mp.side, ''), 'teamA') as side,
      coalesce(result.score_a, m.score_a, 0) as score_a,
      coalesce(result.score_b, m.score_b, 0) as score_b,
      public.rankball_match_summary_at(
        m.confirmed_at,
        m.ended_at,
        m.started_at,
        m.scheduled_date,
        m.scheduled_time,
        m.created_at
      ) as match_at
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    left join public.match_results result on result.match_id = m.id
    where nullif(btrim(mp.user_id), '') is not null
      and m.status = 'confirmed'
    order by mp.user_id, m.id, mp.slot_order nulls last
  ),
  scored_matches as (
    select
      participant_matches.*,
      case
        when score_a = score_b then 'draw'
        when side in ('teamB', 'B', 'b') and score_b > score_a then 'win'
        when side not in ('teamB', 'B', 'b') and score_a > score_b then 'win'
        else 'loss'
      end as outcome
    from participant_matches
  ),
  aggregate_rows as (
    select
      scored_matches.profile_id,
      count(*)::integer as match_count,
      count(*) filter (where outcome = 'win')::integer as win_count,
      count(*) filter (where outcome = 'loss')::integer as loss_count,
      count(*) filter (where outcome = 'draw')::integer as draw_count,
      coalesce(sum(coalesce(stat.points, 0)), 0)::integer as points,
      coalesce(sum(coalesce(stat.rebounds, 0)), 0)::integer as rebounds,
      coalesce(sum(coalesce(stat.assists, 0)), 0)::integer as assists,
      coalesce(sum(coalesce(stat.steals, 0)), 0)::integer as steals,
      coalesce(sum(coalesce(stat.blocks, 0)), 0)::integer as blocks,
      coalesce(sum(coalesce(stat.fouls, 0)), 0)::integer as fouls,
      (array_agg(scored_matches.match_id order by scored_matches.match_at desc nulls last, scored_matches.match_id desc))[1] as last_match_id,
      max(scored_matches.match_at) as last_match_at
    from scored_matches
    left join public.player_match_stats stat
      on stat.match_id = scored_matches.match_id
     and stat.user_id = scored_matches.profile_id
    group by scored_matches.profile_id
  )
  insert into public.profile_match_summaries (
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    updated_at
  )
  select
    profile_id,
    match_count,
    win_count,
    loss_count,
    draw_count,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    last_match_id,
    last_match_at,
    now()
  from aggregate_rows
  on conflict (profile_id) do update set
    match_count = excluded.match_count,
    win_count = excluded.win_count,
    loss_count = excluded.loss_count,
    draw_count = excluded.draw_count,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    fouls = excluded.fouls,
    last_match_id = excluded.last_match_id,
    last_match_at = excluded.last_match_at,
    updated_at = now();

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.rankball_refresh_all_profile_match_summaries() from public;
grant execute on function public.rankball_refresh_all_profile_match_summaries() to service_role;

create or replace function public.rankball_profile_match_summary_by_match_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match_id text;
begin
  if TG_TABLE_NAME = 'matches' then
    target_match_id := case when TG_OP = 'DELETE' then old.id else new.id end;
  else
    target_match_id := case when TG_OP = 'DELETE' then old.match_id else new.match_id end;
  end if;

  perform public.rankball_refresh_profile_match_summaries_for_match(target_match_id);
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.rankball_profile_match_summary_by_player_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP in ('UPDATE', 'DELETE') and nullif(old.user_id, '') is not null and exists (
    select 1 from public.matches where id = old.match_id and status = 'confirmed'
  ) then
    perform public.rankball_rebuild_profile_match_summary(old.user_id);
  end if;

  if TG_OP in ('INSERT', 'UPDATE') and nullif(new.user_id, '') is not null and exists (
    select 1 from public.matches where id = new.match_id and status = 'confirmed'
  ) then
    perform public.rankball_rebuild_profile_match_summary(new.user_id);
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_profile_match_summary_matches_refresh on public.matches;
create trigger rankball_profile_match_summary_matches_refresh
after insert or update of status, confirmed_at, score_a, score_b on public.matches
for each row execute function public.rankball_profile_match_summary_by_match_trigger();

drop trigger if exists rankball_profile_match_summary_results_refresh on public.match_results;
create trigger rankball_profile_match_summary_results_refresh
after insert or update or delete on public.match_results
for each row execute function public.rankball_profile_match_summary_by_match_trigger();

drop trigger if exists rankball_profile_match_summary_players_refresh on public.match_players;
create trigger rankball_profile_match_summary_players_refresh
after insert or update or delete on public.match_players
for each row execute function public.rankball_profile_match_summary_by_player_trigger();

drop trigger if exists rankball_profile_match_summary_stats_refresh on public.player_match_stats;
create trigger rankball_profile_match_summary_stats_refresh
after insert or update or delete on public.player_match_stats
for each row execute function public.rankball_profile_match_summary_by_player_trigger();

select public.rankball_refresh_all_profile_match_summaries();
