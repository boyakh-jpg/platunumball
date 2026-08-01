begin;

create table if not exists public.seasons (
  id text primary key,
  name text not null default '',
  subtitle text not null default '',
  starts_at date,
  ends_at date,
  active boolean not null default false,
  regions jsonb not null default '[]'::jsonb,
  promotion_line integer not null default 4,
  rules jsonb not null default '[]'::jsonb
);

alter table public.seasons add column if not exists id text;
alter table public.seasons add column if not exists name text default '';
alter table public.seasons add column if not exists subtitle text default '';
alter table public.seasons add column if not exists starts_at date;
alter table public.seasons add column if not exists ends_at date;
alter table public.seasons add column if not exists active boolean default false;
alter table public.seasons add column if not exists regions jsonb default '[]'::jsonb;
alter table public.seasons add column if not exists promotion_line integer default 4;
alter table public.seasons add column if not exists rules jsonb default '[]'::jsonb;

insert into public.seasons (
  id,
  name,
  subtitle,
  starts_at,
  ends_at,
  active
)
select
  'season-zero',
  'Season Zero',
  '지역 래더와 승인 시스템을 검증하는 프리시즌',
  date '2026-05-31',
  date '2026-08-31',
  true
where not exists (
  select 1 from public.seasons where id = 'season-zero'
);

alter table public.seasons enable row level security;
drop policy if exists seasons_read_all on public.seasons;
create policy seasons_read_all
  on public.seasons
  for select
  to public
  using (true);
grant select on table public.seasons to anon, authenticated, service_role;

create index if not exists match_record_participants_record_date_idx
  on public.match_record_participants (record_date, profile_id, match_id);

create index if not exists match_record_teams_record_date_idx
  on public.match_record_teams (record_date, team_id, match_id);

create or replace function public.rankball_season_rankings(
  p_actor_profile_id text,
  p_season_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_season_id text := nullif(btrim(p_season_id), '');
  season_row public.seasons%rowtype;
  result_payload jsonb;
begin
  if safe_actor_id is null or not exists (select 1 from public.profiles where id = safe_actor_id) then
    raise exception 'profile_not_found' using errcode = '42501';
  end if;

  select season.*
  into season_row
  from public.seasons season
  where (safe_season_id is not null and season.id = safe_season_id)
     or (safe_season_id is null and season.active)
  order by season.starts_at desc nulls last, season.id
  limit 1;

  if not found then
    raise exception 'season_not_found';
  end if;

  with blocked_profiles as (
    select blocked.profile_id
    from public.profiles actor
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(actor.app_settings->'blockedUserIds') = 'array'
          then actor.app_settings->'blockedUserIds'
        else '[]'::jsonb
      end
    ) blocked(profile_id)
    where actor.id = safe_actor_id
  ), season_archives as (
    select archive.match_id, archive.payload
    from public.match_record_archives archive
    where archive.is_active
      and archive.record_date between season_row.starts_at and season_row.ends_at
  ), player_aggregate as (
    select
      participant.profile_id,
      count(*)::integer as played,
      count(*) filter (where participant.outcome = 'win')::integer as wins,
      count(*) filter (where participant.outcome = 'loss')::integer as losses,
      round(coalesce(sum((
        select coalesce(sum(
          case
            when change.value->>'integratedDelta' ~ '^-?[0-9]+(\.[0-9]+)?$'
              then (change.value->>'integratedDelta')::numeric
            else 0
          end
        ), 0)
        from jsonb_array_elements(
          case
            when jsonb_typeof(archive.payload #> '{match,rating_result}') = 'array'
              then archive.payload #> '{match,rating_result}'
            else '[]'::jsonb
          end
        ) change(value)
        where coalesce(change.value->>'playerId', change.value->>'player_id') = participant.profile_id
      )), 0))::integer as delta,
      coalesce(sum(case when participant.stats->>'points' ~ '^[0-9]+$' then (participant.stats->>'points')::integer else 0 end), 0)::integer as points,
      coalesce(sum(case when participant.stats->>'rebounds' ~ '^[0-9]+$' then (participant.stats->>'rebounds')::integer else 0 end), 0)::integer as rebounds,
      coalesce(sum(case when participant.stats->>'assists' ~ '^[0-9]+$' then (participant.stats->>'assists')::integer else 0 end), 0)::integer as assists
    from public.match_record_participants participant
    join season_archives archive on archive.match_id = participant.match_id
    group by participant.profile_id
  ), player_rows as (
    select
      to_jsonb(profile) as profile,
      jsonb_build_object(
        'regionRanking', coalesce(settings.app_settings #>> '{privacy,regionRanking}', 'true') <> 'false'
      ) as privacy,
      coalesce(aggregate.played, 0) as season_played,
      coalesce(aggregate.wins, 0) as season_wins,
      coalesce(aggregate.losses, 0) as season_losses,
      coalesce(aggregate.delta, 0) as season_delta,
      jsonb_build_object(
        'points', coalesce(aggregate.points, 0),
        'rebounds', coalesce(aggregate.rebounds, 0),
        'assists', coalesce(aggregate.assists, 0)
      ) as season_stats,
      (
        case
          when profile.ratings->>'integrated' ~ '^-?[0-9]+(\.[0-9]+)?$'
            then (profile.ratings->>'integrated')::numeric
          else 1200
        end
        + coalesce(aggregate.wins, 0) * 12
        - coalesce(aggregate.losses, 0) * 6
        + coalesce(aggregate.delta, 0)
      ) as season_score
    from public.public_profiles profile
    join public.profiles settings on settings.id = profile.id
    left join player_aggregate aggregate on aggregate.profile_id = profile.id
    where profile.id = safe_actor_id
       or not exists (select 1 from blocked_profiles blocked where blocked.profile_id = profile.id)
  ), team_aggregate as (
    select
      team_record.team_id,
      count(*)::integer as played,
      count(*) filter (where team_record.outcome = 'win')::integer as wins,
      count(*) filter (where team_record.outcome = 'loss')::integer as losses,
      round(coalesce(sum(
        case
          when coalesce(
            archive.payload #>> array['match', 'team_rating_result', 'teams', team_record.team_id, 'delta'],
            archive.payload #>> array['match', 'team_rating_result', 'teams', team_record.team_id],
            archive.payload #>> array['match', 'team_rating_result', team_record.side]
          ) ~ '^-?[0-9]+(\.[0-9]+)?$'
            then coalesce(
              archive.payload #>> array['match', 'team_rating_result', 'teams', team_record.team_id, 'delta'],
              archive.payload #>> array['match', 'team_rating_result', 'teams', team_record.team_id],
              archive.payload #>> array['match', 'team_rating_result', team_record.side]
            )::numeric
          else 0
        end
      ), 0))::integer as delta
    from public.match_record_teams team_record
    join season_archives archive on archive.match_id = team_record.match_id
    group by team_record.team_id
  ), team_rows as (
    select
      to_jsonb(team) as team,
      coalesce(aggregate.played, 0) as season_played,
      coalesce(aggregate.wins, 0) as season_wins,
      coalesce(aggregate.losses, 0) as season_losses,
      coalesce(aggregate.delta, 0) as season_delta,
      coalesce(team.mmr, 1200)
        + coalesce(aggregate.wins, 0) * 16
        - coalesce(aggregate.losses, 0) * 8
        + coalesce(aggregate.delta, 0) as season_score
    from public.teams team
    left join team_aggregate aggregate on aggregate.team_id = team.id
    where team.deleted_at is null
  )
  select jsonb_build_object(
    'season', jsonb_build_object(
      'id', season_row.id,
      'name', season_row.name,
      'subtitle', season_row.subtitle,
      'startsAt', season_row.starts_at,
      'endsAt', season_row.ends_at,
      'active', season_row.active,
      'promotionLine', season_row.promotion_line
    ),
    'players', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.season_score desc, row_data.profile->>'id')
      from player_rows row_data
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(row_data) order by row_data.season_score desc, row_data.team->>'id')
      from team_rows row_data
    ), '[]'::jsonb)
  )
  into result_payload;

  return result_payload;
end;
$$;

insert into public.rankball_rpc_contract_registry (
  contract_scope,
  contract_name,
  function_name,
  signature,
  lifecycle,
  service_role_execute
)
values
  ('general', 'rankball_season_rankings', 'rankball_season_rankings', 'public.rankball_season_rankings(text,text)', 'active', true)
on conflict (contract_scope, contract_name) do update
set function_name = excluded.function_name,
    signature = excluded.signature,
    lifecycle = excluded.lifecycle,
    service_role_execute = excluded.service_role_execute,
    updated_at = clock_timestamp();

revoke all on function public.rankball_season_rankings(text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_season_rankings(text, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
