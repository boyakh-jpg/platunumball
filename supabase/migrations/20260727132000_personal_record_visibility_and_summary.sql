-- Personal records may be public on their owner's profile, but remain separate
-- from official match summaries, rating, and achievement metrics.

alter table public.match_record_participants
  add column if not exists record_type text not null default 'match';
alter table public.match_record_participants
  add column if not exists visibility text not null default 'private';
alter table public.match_record_participants
  add column if not exists owner_profile_id text;

create or replace function public.rankball_match_record_participant_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  archive_match jsonb := '{}'::jsonb;
begin
  select coalesce(archive_row.payload->'match', '{}'::jsonb)
  into archive_match
  from public.match_record_archives archive_row
  where archive_row.match_id = new.match_id;

  new.record_type := lower(coalesce(nullif(btrim(archive_match->'rules'->>'recordType'), ''), 'match'));
  new.visibility := case
    when lower(coalesce(
      nullif(btrim(archive_match->>'visibility'), ''),
      nullif(btrim(archive_match->'rules'->>'visibility'), ''),
      'private'
    )) = 'public' then 'public'
    else 'private'
  end;
  new.owner_profile_id := nullif(btrim(archive_match->>'created_by'), '');
  return new;
end;
$$;

revoke all on function public.rankball_match_record_participant_metadata() from public, anon, authenticated;
grant execute on function public.rankball_match_record_participant_metadata() to service_role;

drop trigger if exists rankball_match_record_participant_metadata_refresh on public.match_record_participants;
create trigger rankball_match_record_participant_metadata_refresh
before insert or update
on public.match_record_participants
for each row execute function public.rankball_match_record_participant_metadata();

update public.match_record_participants participant
set
  record_type = lower(coalesce(
    nullif(btrim(archive_row.payload->'match'->'rules'->>'recordType'), ''),
    'match'
  )),
  visibility = case
    when lower(coalesce(
      nullif(btrim(archive_row.payload->'match'->>'visibility'), ''),
      nullif(btrim(archive_row.payload->'match'->'rules'->>'visibility'), ''),
      'private'
    )) = 'public' then 'public'
    else 'private'
  end,
  owner_profile_id = nullif(btrim(archive_row.payload->'match'->>'created_by'), '')
from public.match_record_archives archive_row
where archive_row.match_id = participant.match_id;

create index if not exists match_record_participants_profile_personal_visibility_idx
  on public.match_record_participants (
    profile_id,
    record_type,
    visibility,
    record_date desc,
    occurred_at desc,
    match_id
  );

create table if not exists public.profile_personal_record_summaries (
  profile_id text primary key references public.profiles(id) on delete cascade,
  record_count integer not null default 0 check (record_count >= 0),
  win_count integer not null default 0 check (win_count >= 0),
  loss_count integer not null default 0 check (loss_count >= 0),
  draw_count integer not null default 0 check (draw_count >= 0),
  stat_count integer not null default 0 check (stat_count >= 0),
  points integer not null default 0 check (points >= 0),
  rebounds integer not null default 0 check (rebounds >= 0),
  assists integer not null default 0 check (assists >= 0),
  steals integer not null default 0 check (steals >= 0),
  blocks integer not null default 0 check (blocks >= 0),
  fouls integer not null default 0 check (fouls >= 0),
  public_record_count integer not null default 0 check (public_record_count >= 0),
  public_win_count integer not null default 0 check (public_win_count >= 0),
  public_loss_count integer not null default 0 check (public_loss_count >= 0),
  public_draw_count integer not null default 0 check (public_draw_count >= 0),
  public_stat_count integer not null default 0 check (public_stat_count >= 0),
  public_points integer not null default 0 check (public_points >= 0),
  public_rebounds integer not null default 0 check (public_rebounds >= 0),
  public_assists integer not null default 0 check (public_assists >= 0),
  public_steals integer not null default 0 check (public_steals >= 0),
  public_blocks integer not null default 0 check (public_blocks >= 0),
  public_fouls integer not null default 0 check (public_fouls >= 0),
  last_record_id text,
  last_record_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.profile_personal_record_summaries enable row level security;
revoke all on public.profile_personal_record_summaries from public, anon, authenticated;
grant all on public.profile_personal_record_summaries to service_role;

create or replace function public.rankball_rebuild_personal_record_summary(p_profile_id text)
returns public.profile_personal_record_summaries
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  summary_row public.profile_personal_record_summaries%rowtype;
begin
  if safe_profile_id is null then
    raise exception 'missing_profile_id' using errcode = '22023';
  end if;
  if not exists (select 1 from public.profiles where id = safe_profile_id) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  with personal_matches as (
    select
      match_row.id as match_id,
      case when lower(coalesce(match_row.visibility, match_row.rules->>'visibility', 'private')) = 'public'
        then 'public' else 'private' end as visibility,
      coalesce(result_row.score_a, match_row.score_a, 0) as score_for,
      coalesce(result_row.score_b, match_row.score_b, 0) as score_against,
      public.rankball_match_summary_at(
        match_row.confirmed_at,
        match_row.ended_at,
        match_row.started_at,
        match_row.scheduled_date,
        match_row.scheduled_time,
        match_row.created_at
      ) as record_at,
      stat_row.match_id as stat_match_id,
      coalesce(stat_row.points, 0) as points,
      coalesce(stat_row.rebounds, 0) as rebounds,
      coalesce(stat_row.assists, 0) as assists,
      coalesce(stat_row.steals, 0) as steals,
      coalesce(stat_row.blocks, 0) as blocks,
      coalesce(stat_row.fouls, 0) as fouls
    from public.matches match_row
    left join public.match_results result_row on result_row.match_id = match_row.id
    left join public.player_match_stats stat_row
      on stat_row.match_id = match_row.id
     and stat_row.user_id = safe_profile_id
    where match_row.created_by = safe_profile_id
      and match_row.status = 'confirmed'
      and lower(coalesce(nullif(btrim(match_row.rules->>'recordType'), ''), 'match')) in ('solo', 'personal_record')
  ), aggregate_row as (
    select
      safe_profile_id as profile_id,
      count(*)::integer as record_count,
      count(*) filter (where score_for > score_against)::integer as win_count,
      count(*) filter (where score_for < score_against)::integer as loss_count,
      count(*) filter (where score_for = score_against)::integer as draw_count,
      count(stat_match_id)::integer as stat_count,
      coalesce(sum(points), 0)::integer as points,
      coalesce(sum(rebounds), 0)::integer as rebounds,
      coalesce(sum(assists), 0)::integer as assists,
      coalesce(sum(steals), 0)::integer as steals,
      coalesce(sum(blocks), 0)::integer as blocks,
      coalesce(sum(fouls), 0)::integer as fouls,
      count(*) filter (where visibility = 'public')::integer as public_record_count,
      count(*) filter (where visibility = 'public' and score_for > score_against)::integer as public_win_count,
      count(*) filter (where visibility = 'public' and score_for < score_against)::integer as public_loss_count,
      count(*) filter (where visibility = 'public' and score_for = score_against)::integer as public_draw_count,
      count(stat_match_id) filter (where visibility = 'public')::integer as public_stat_count,
      coalesce(sum(points) filter (where visibility = 'public'), 0)::integer as public_points,
      coalesce(sum(rebounds) filter (where visibility = 'public'), 0)::integer as public_rebounds,
      coalesce(sum(assists) filter (where visibility = 'public'), 0)::integer as public_assists,
      coalesce(sum(steals) filter (where visibility = 'public'), 0)::integer as public_steals,
      coalesce(sum(blocks) filter (where visibility = 'public'), 0)::integer as public_blocks,
      coalesce(sum(fouls) filter (where visibility = 'public'), 0)::integer as public_fouls,
      (array_agg(match_id order by record_at desc nulls last, match_id desc))[1] as last_record_id,
      max(record_at) as last_record_at
    from personal_matches
  )
  insert into public.profile_personal_record_summaries (
    profile_id, record_count, win_count, loss_count, draw_count, stat_count,
    points, rebounds, assists, steals, blocks, fouls,
    public_record_count, public_win_count, public_loss_count, public_draw_count, public_stat_count,
    public_points, public_rebounds, public_assists, public_steals, public_blocks, public_fouls,
    last_record_id, last_record_at, updated_at
  )
  select
    profile_id, record_count, win_count, loss_count, draw_count, stat_count,
    points, rebounds, assists, steals, blocks, fouls,
    public_record_count, public_win_count, public_loss_count, public_draw_count, public_stat_count,
    public_points, public_rebounds, public_assists, public_steals, public_blocks, public_fouls,
    last_record_id, last_record_at, now()
  from aggregate_row
  on conflict (profile_id) do update set
    record_count = excluded.record_count,
    win_count = excluded.win_count,
    loss_count = excluded.loss_count,
    draw_count = excluded.draw_count,
    stat_count = excluded.stat_count,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    fouls = excluded.fouls,
    public_record_count = excluded.public_record_count,
    public_win_count = excluded.public_win_count,
    public_loss_count = excluded.public_loss_count,
    public_draw_count = excluded.public_draw_count,
    public_stat_count = excluded.public_stat_count,
    public_points = excluded.public_points,
    public_rebounds = excluded.public_rebounds,
    public_assists = excluded.public_assists,
    public_steals = excluded.public_steals,
    public_blocks = excluded.public_blocks,
    public_fouls = excluded.public_fouls,
    last_record_id = excluded.last_record_id,
    last_record_at = excluded.last_record_at,
    updated_at = now()
  returning * into summary_row;

  return summary_row;
end;
$$;

revoke all on function public.rankball_rebuild_personal_record_summary(text) from public, anon, authenticated;
grant execute on function public.rankball_rebuild_personal_record_summary(text) to service_role;

create or replace function public.rankball_personal_record_summary_match_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP in ('UPDATE', 'DELETE') and nullif(btrim(old.created_by), '') is not null then
    perform public.rankball_rebuild_personal_record_summary(old.created_by);
  end if;
  if TG_OP in ('INSERT', 'UPDATE') and nullif(btrim(new.created_by), '') is not null then
    perform public.rankball_rebuild_personal_record_summary(new.created_by);
  end if;
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.rankball_personal_record_summary_child_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match_id text := case when TG_OP = 'DELETE' then old.match_id else new.match_id end;
  owner_profile_id text;
begin
  select created_by into owner_profile_id from public.matches where id = target_match_id;
  if nullif(btrim(owner_profile_id), '') is not null then
    perform public.rankball_rebuild_personal_record_summary(owner_profile_id);
  end if;
  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_personal_record_summary_matches_refresh on public.matches;
create trigger rankball_personal_record_summary_matches_refresh
after insert or update of status, confirmed_at, score_a, score_b, visibility, rules, created_by or delete
on public.matches
for each row execute function public.rankball_personal_record_summary_match_trigger();

drop trigger if exists rankball_personal_record_summary_results_refresh on public.match_results;
create trigger rankball_personal_record_summary_results_refresh
after insert or update or delete on public.match_results
for each row execute function public.rankball_personal_record_summary_child_trigger();

drop trigger if exists rankball_personal_record_summary_stats_refresh on public.player_match_stats;
create trigger rankball_personal_record_summary_stats_refresh
after insert or update or delete on public.player_match_stats
for each row execute function public.rankball_personal_record_summary_child_trigger();

-- Official profile summaries must never count self-authored personal records.
do $migration$
declare
  function_definition text;
  target_function regprocedure;
  old_text text := $old$      and m.status = 'confirmed'$old$;
  new_text text := $new$      and m.status = 'confirmed'
      and lower(coalesce(nullif(btrim(m.rules->>'recordType'), ''), 'match')) not in ('solo', 'personal_record')$new$;
begin
  foreach target_function in array array[
    'public.rankball_rebuild_profile_match_summary(text)'::regprocedure,
    'public.rankball_refresh_all_profile_match_summaries()'::regprocedure
  ] loop
    select pg_get_functiondef(target_function) into function_definition;
    if position(new_text in function_definition) = 0 then
      if position(old_text in function_definition) = 0 then
        raise exception 'profile_match_summary_personal_filter_shape_changed: %', target_function;
      end if;
      function_definition := replace(function_definition, old_text, new_text);
      execute function_definition;
    end if;
  end loop;
end;
$migration$;

-- Achievement metrics use only official/general matches, never self-authored personal records.
do $migration$
declare
  function_definition text;
  old_text text := $old$match_row.status = 'confirmed'$old$;
  new_text text := $new$match_row.status = 'confirmed'
    and lower(coalesce(nullif(btrim(match_row.rules->>'recordType'), ''), 'match')) not in ('solo', 'personal_record')$new$;
begin
  select pg_get_functiondef('public.rankball_profile_icon_metrics(text)'::regprocedure)
  into function_definition;
  if position(new_text in function_definition) = 0 then
    if position(old_text in function_definition) = 0 then
      raise exception 'profile_icon_metrics_personal_filter_shape_changed';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
    execute function_definition;
  end if;
end;
$migration$;

create or replace function public.rankball_is_match_actor(target_match_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_id text := public.current_profile_id();
begin
  if public.current_is_admin(30) then return true; end if;
  if profile_id is null then return false; end if;
  if exists (
    select 1 from public.matches match_row
    where match_row.id = target_match_id
      and lower(coalesce(match_row.visibility, match_row.rules->>'visibility', 'private')) = 'private'
      and lower(coalesce(nullif(btrim(match_row.rules->>'recordType'), ''), 'match')) in ('solo', 'personal_record')
  ) then
    return exists (
      select 1 from public.matches match_row
      where match_row.id = target_match_id and match_row.created_by = profile_id
    );
  end if;
  if exists (
    select 1 from public.matches match_row
    where match_row.id = target_match_id and profile_id in (match_row.created_by, match_row.referee_id, match_row.former_referee_id)
  ) then return true; end if;
  if exists (
    select 1 from public.match_players match_player
    where match_player.match_id = target_match_id and match_player.user_id = profile_id
  ) then return true; end if;
  if exists (
    select 1
    from public.matches match_row
    join public.team_members team_member on team_member.team_id in (match_row.team_a_id, match_row.team_b_id)
    where match_row.id = target_match_id and match_row.tournament_id is not null
      and team_member.user_id = profile_id and team_member.role = 'captain'
  ) then return true; end if;
  if exists (
    select 1 from public.matches match_row
    where match_row.id = target_match_id and (
      jsonb_path_exists(coalesce(match_row.reserve_players, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
      or jsonb_path_exists(coalesce(match_row.played_player_ids, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
      or jsonb_path_exists(coalesce(match_row.stat_recorders, '{}'::jsonb), '$.** ? (@ == $profileId)', jsonb_build_object('profileId', profile_id))
    )
  ) then return true; end if;
  return false;
end;
$$;

select public.rankball_rebuild_profile_match_summary(profile_row.id)
from public.profiles profile_row;

select public.rankball_rebuild_personal_record_summary(profile_row.id)
from public.profiles profile_row;

select public.rankball_refresh_all_match_record_archives();
select pg_notify('pgrst', 'reload schema');