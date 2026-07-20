create or replace function public.rankball_related_active_match_list(
  p_profile_id text,
  p_limit integer default 50,
  p_include_team_schedule boolean default false
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_profile_id), '') as profile_id,
      greatest(1, least(80, coalesce(p_limit, 50))) as row_limit
  ),
  member_teams as (
    select member.team_id, member.role
    from public.team_members member, params
    where member.user_id = params.profile_id
  ),
  related as (
    select
      match_row.id,
      coalesce(match_row.updated_at, match_row.created_at) as sort_at,
      (
        match_row.created_by = params.profile_id
        or nullif(btrim(match_row.referee_id), '') = params.profile_id
        or nullif(btrim(match_row.former_referee_id), '') = params.profile_id
        or exists (
          select 1
          from public.match_players player
          where player.match_id = match_row.id
            and player.user_id = params.profile_id
        )
        or jsonb_path_exists(
          coalesce(match_row.stat_recorders, '{}'::jsonb),
          '$.** ? (@ == $profileId)',
          jsonb_build_object('profileId', params.profile_id)
        )
        or jsonb_path_exists(
          coalesce(match_row.rules->'statRecorders', '{}'::jsonb),
          '$.** ? (@ == $profileId)',
          jsonb_build_object('profileId', params.profile_id)
        )
        or jsonb_path_exists(
          coalesce(match_row.rules->'playedPlayerIds', '{}'::jsonb),
          '$.** ? (@ == $profileId)',
          jsonb_build_object('profileId', params.profile_id)
        )
        or jsonb_path_exists(
          coalesce(match_row.rules->'reservePlayers', '{}'::jsonb),
          '$.** ? (@ == $profileId)',
          jsonb_build_object('profileId', params.profile_id)
        )
        or jsonb_path_exists(
          coalesce(match_row.reserve_players, '{}'::jsonb),
          '$.** ? (@ == $profileId)',
          jsonb_build_object('profileId', params.profile_id)
        )
        or jsonb_path_exists(
          coalesce(match_row.played_player_ids, '{}'::jsonb),
          '$.** ? (@ == $profileId)',
          jsonb_build_object('profileId', params.profile_id)
        )
      ) as direct_actor,
      (
        match_row.tournament_id is not null
        and exists (
          select 1
          from member_teams member
          where member.role = 'captain'
            and member.team_id in (match_row.team_a_id, match_row.team_b_id)
        )
      ) as captain_tournament,
      (
        coalesce(p_include_team_schedule, false)
        and exists (
          select 1
          from member_teams member
          where member.team_id in (match_row.team_a_id, match_row.team_b_id)
        )
      ) as member_team
    from public.matches match_row, params
    where params.profile_id is not null
      and match_row.status not in ('confirmed', 'closed', 'cancelled', 'canceled', 'void', 'voided')
      and coalesce(nullif(match_row.rules->>'recordType', ''), 'match') = 'match'
  ),
  eligible as (
    select related.*
    from related
    where related.direct_actor or related.captain_tournament or related.member_team
  ),
  paged as (
    select eligible.*
    from eligible, params
    order by eligible.sort_at desc nulls last, eligible.id desc
    limit (select row_limit + 1 from params)
  ),
  numbered as (
    select
      paged.*,
      row_number() over (order by paged.sort_at desc nulls last, paged.id desc) as rn
    from paged
  )
  select jsonb_build_object(
    'rows', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', numbered.id,
          'directActor', numbered.direct_actor,
          'captainTournament', numbered.captain_tournament,
          'memberTeam', numbered.member_team
        ) order by numbered.sort_at desc nulls last, numbered.id desc
      ) filter (where numbered.rn <= (select row_limit from params)),
      '[]'::jsonb
    ),
    'exhausted', count(*) <= (select row_limit from params)
  )
  from numbered, params;
$$;

create index if not exists match_players_user_match_idx
  on public.match_players (user_id, match_id);

create index if not exists team_members_user_team_role_idx
  on public.team_members (user_id, team_id, role);

create index if not exists matches_active_updated_idx
  on public.matches (updated_at desc, id desc)
  where status not in ('confirmed', 'closed', 'cancelled', 'canceled', 'void', 'voided');

revoke all on function public.rankball_related_active_match_list(text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.rankball_related_active_match_list(text, integer, boolean)
  to service_role;

select pg_notify('pgrst', 'reload schema');
