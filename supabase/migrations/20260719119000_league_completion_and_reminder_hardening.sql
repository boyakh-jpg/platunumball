create or replace function public.rankball_league_finalize_locked(p_tournament_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tournament_row public.tournaments%rowtype;
  expected_match_count integer := 0;
  stored_match_count integer := 0;
  confirmed_match_count integer := 0;
  tied_match_count integer := 0;
  champion_id text;
  champion_name text;
  standings jsonb := '[]'::jsonb;
  completed_at timestamptz := now();
  recipient_row record;
  notification_id text;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(coalesce(p_tournament_id, '')));

  select *
  into tournament_row
  from public.tournaments
  where id = p_tournament_id
  for update;

  if tournament_row.id is null or tournament_row.format <> 'league' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'league_not_found');
  end if;

  if tournament_row.status = 'closed' and nullif(tournament_row.bracket->>'championTeamId', '') is not null then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'alreadyClosed', true,
      'tournamentId', tournament_row.id,
      'championTeamId', tournament_row.bracket->>'championTeamId'
    );
  end if;

  if tournament_row.status <> 'active' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'league_not_active');
  end if;

  expected_match_count := jsonb_array_length(coalesce(tournament_row.match_ids, '[]'::jsonb));
  if expected_match_count <= 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'league_has_no_fixtures');
  end if;

  select
    count(match_row.id),
    count(match_row.id) filter (where match_row.status = 'confirmed'),
    count(match_row.id) filter (
      where match_row.status = 'confirmed'
        and coalesce(match_row.score_a, 0) = coalesce(match_row.score_b, 0)
    )
  into stored_match_count, confirmed_match_count, tied_match_count
  from jsonb_array_elements_text(tournament_row.match_ids) fixture(match_id)
  left join public.matches match_row
    on match_row.id = fixture.match_id
   and match_row.tournament_id = tournament_row.id;

  if stored_match_count <> expected_match_count or confirmed_match_count <> expected_match_count or tied_match_count > 0 then
    return jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'league_fixtures_incomplete',
      'expectedMatchCount', expected_match_count,
      'storedMatchCount', stored_match_count,
      'confirmedMatchCount', confirmed_match_count,
      'tiedMatchCount', tied_match_count
    );
  end if;

  with fixture_results as (
    select
      match_row.team_a_id,
      match_row.team_b_id,
      coalesce(match_row.score_a, 0) as score_a,
      coalesce(match_row.score_b, 0) as score_b
    from jsonb_array_elements_text(tournament_row.match_ids) fixture(match_id)
    join public.matches match_row
      on match_row.id = fixture.match_id
     and match_row.tournament_id = tournament_row.id
     and match_row.status = 'confirmed'
  ), standings_rows as (
    select
      tournament_team.team_id,
      coalesce(team.name, tournament_team.team_id) as team_name,
      count(fixture_result.team_a_id) filter (
        where fixture_result.team_a_id = tournament_team.team_id
           or fixture_result.team_b_id = tournament_team.team_id
      )::integer as played,
      count(fixture_result.team_a_id) filter (
        where (fixture_result.team_a_id = tournament_team.team_id and fixture_result.score_a > fixture_result.score_b)
           or (fixture_result.team_b_id = tournament_team.team_id and fixture_result.score_b > fixture_result.score_a)
      )::integer as wins,
      count(fixture_result.team_a_id) filter (
        where (fixture_result.team_a_id = tournament_team.team_id and fixture_result.score_a < fixture_result.score_b)
           or (fixture_result.team_b_id = tournament_team.team_id and fixture_result.score_b < fixture_result.score_a)
      )::integer as losses,
      coalesce(sum(
        case
          when fixture_result.team_a_id = tournament_team.team_id then fixture_result.score_a
          when fixture_result.team_b_id = tournament_team.team_id then fixture_result.score_b
          else 0
        end
      ), 0)::integer as points_for,
      coalesce(sum(
        case
          when fixture_result.team_a_id = tournament_team.team_id then fixture_result.score_b
          when fixture_result.team_b_id = tournament_team.team_id then fixture_result.score_a
          else 0
        end
      ), 0)::integer as points_against
    from public.tournament_teams tournament_team
    left join public.teams team
      on team.id = tournament_team.team_id
     and team.deleted_at is null
    left join fixture_results fixture_result
      on fixture_result.team_a_id = tournament_team.team_id
      or fixture_result.team_b_id = tournament_team.team_id
    where tournament_team.tournament_id = tournament_row.id
      and tournament_team.status = 'accepted'
    group by tournament_team.team_id, team.name
  ), ranked_rows as (
    select
      standings_row.*,
      standings_row.points_for - standings_row.points_against as point_diff,
      row_number() over (
        order by
          standings_row.wins desc,
          standings_row.points_for - standings_row.points_against desc,
          standings_row.points_for desc,
          standings_row.team_name asc,
          standings_row.team_id asc
      ) as rank
    from standings_rows standings_row
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank', ranked_row.rank,
          'teamId', ranked_row.team_id,
          'teamName', ranked_row.team_name,
          'played', ranked_row.played,
          'wins', ranked_row.wins,
          'losses', ranked_row.losses,
          'pointsFor', ranked_row.points_for,
          'pointsAgainst', ranked_row.points_against,
          'pointDiff', ranked_row.point_diff
        )
        order by ranked_row.rank
      ),
      '[]'::jsonb
    ),
    max(ranked_row.team_id) filter (where ranked_row.rank = 1),
    max(ranked_row.team_name) filter (where ranked_row.rank = 1)
  into standings, champion_id, champion_name
  from ranked_rows ranked_row;

  if champion_id is null then
    return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'league_has_no_accepted_teams');
  end if;

  update public.tournaments
  set status = 'closed',
      bracket = coalesce(bracket, '{}'::jsonb) || jsonb_build_object(
        'championTeamId', champion_id,
        'completedAt', completed_at,
        'standings', standings
      ),
      updated_at = completed_at
  where id = tournament_row.id;

  for recipient_row in
    select distinct recipient.user_id
    from (
      select tournament_row.created_by as user_id
      union all
      select team_member.user_id
      from public.tournament_teams tournament_team
      join public.team_members team_member
        on team_member.team_id = tournament_team.team_id
       and team_member.role = 'captain'
      where tournament_team.tournament_id = tournament_row.id
        and tournament_team.status = 'accepted'
    ) recipient
    where nullif(btrim(recipient.user_id), '') is not null
  loop
    notification_id := 'tournament-complete-' || substr(md5(tournament_row.id || ':' || recipient_row.user_id), 1, 24);
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, discord_event,
      read_at, payload, created_at, updated_at
    ) values (
      notification_id,
      recipient_row.user_id,
      recipient_row.user_id,
      '리그 종료',
      tournament_row.title || ' 우승팀은 ' || coalesce(champion_name, champion_id) || '입니다.',
      'match',
      'tournament_completed',
      'match',
      null,
      jsonb_build_object(
        'tournamentId', tournament_row.id,
        'teamId', champion_id,
        'actionRequired', false,
        'homeAction', false
      ),
      completed_at,
      completed_at
    )
    on conflict (id) do nothing;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'closed', true,
    'tournamentId', tournament_row.id,
    'championTeamId', champion_id,
    'completedAt', completed_at,
    'standings', standings
  );
end;
$$;

create or replace function public.rankball_tournament_advance_on_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tournament_id is not null
     and new.status = 'confirmed'
     and (
       tg_op = 'INSERT'
       or old.status is distinct from new.status
       or old.score_a is distinct from new.score_a
       or old.score_b is distinct from new.score_b
     ) then
    if new.tournament_format = 'tournament' then
      perform public.rankball_tournament_advance_locked(new.tournament_id);
    elsif new.tournament_format = 'league' then
      perform public.rankball_league_finalize_locked(new.tournament_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_tournament_advance_on_match_trigger on public.matches;
create trigger rankball_tournament_advance_on_match_trigger
after insert or update of status, score_a, score_b on public.matches
for each row execute function public.rankball_tournament_advance_on_match();

revoke all on function public.rankball_league_finalize_locked(text) from public, anon, authenticated;
grant execute on function public.rankball_league_finalize_locked(text) to service_role;

revoke all on function public.rankball_tournament_advance_on_match() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
