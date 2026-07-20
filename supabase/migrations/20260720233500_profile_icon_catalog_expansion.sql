alter table public.profile_icon_unlocks
  drop constraint if exists profile_icon_unlocks_icon_key_check;

alter table public.profile_icon_unlocks
  add constraint profile_icon_unlocks_icon_key_check
  check (icon_key ~ '^[0-9]{2,3}-[a-z0-9][a-z0-9-]{0,76}$');

create index if not exists matches_profile_icon_metrics_idx
  on public.matches (status, visibility, mode, tournament_id);

create index if not exists team_invitations_sender_status_idx
  on public.team_invitations (from_user_id, status, id);

create index if not exists court_requests_requester_status_idx
  on public.court_requests (requested_by, status, id);

create index if not exists court_reviews_reviewer_status_idx
  on public.court_reviews (reviewer_id, status, id);

create index if not exists tournaments_creator_status_idx
  on public.tournaments (created_by, status, id);

create index if not exists notifications_recruiting_invite_accept_idx
  on public.notifications (target_user_id, invitation_id)
  where payload->>'source' = 'recruiting_invitation_accept';

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
  team_match_win_count integer := 0;
  night_match_count integer := 0;
  ranked_match_count integer := 0;
  official_match_count integer := 0;
  public_match_count integer := 0;
  private_match_count integer := 0;
  private_team_match_count integer := 0;
  mode_1v1_count integer := 0;
  mode_2v2_count integer := 0;
  mode_3v3_count integer := 0;
  mode_4v4_count integer := 0;
  mode_5v5_count integer := 0;
  pg_appearances integer := 0;
  sg_appearances integer := 0;
  sf_appearances integer := 0;
  pf_appearances integer := 0;
  c_appearances integer := 0;
  double_double_count integer := 0;
  triple_double_count integer := 0;
  mvp_performance_count integer := 0;
  scoring_leader_game_count integer := 0;
  rebound_leader_game_count integer := 0;
  assist_leader_game_count integer := 0;
  steal_leader_game_count integer := 0;
  block_leader_game_count integer := 0;
  referee_count integer := 0;
  recorder_count integer := 0;
  court_contribution_count integer := 0;
  approved_court_count integer := 0;
  court_review_count integer := 0;
  recruiting_invite_accepted_count integer := 0;
  team_invite_accepted_count integer := 0;
  matchmaking_success_count integer := 0;
  reserve_count integer := 0;
  promoted_reserve_count integer := 0;
  tournament_match_count integer := 0;
  tournament_participation_count integer := 0;
  tournament_win_count integer := 0;
  tournament_final_count integer := 0;
  tournament_title_count integer := 0;
  tournament_host_count integer := 0;
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

  with tournament_final_rounds as (
    select
      nullif(btrim(match_row.tournament_id), '') as tournament_id,
      max(match_row.tournament_round) as final_round
    from public.matches match_row
    where match_row.status = 'confirmed'
      and match_row.tournament_format = 'tournament'
      and nullif(btrim(match_row.tournament_id), '') is not null
      and match_row.tournament_round is not null
    group by nullif(btrim(match_row.tournament_id), '')
  ), participant_matches as (
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
      end as scheduled_time_value,
      lower(coalesce(match_row.mode, '')) as mode,
      coalesce(match_row.visibility, 'public') as visibility,
      coalesce(match_row.ranked, false) as ranked,
      coalesce(match_row.official, false) as official,
      nullif(btrim(match_row.team_a_id), '') as team_a_id,
      nullif(btrim(match_row.team_b_id), '') as team_b_id,
      nullif(btrim(match_row.tournament_id), '') as tournament_id,
      match_row.tournament_format,
      match_row.tournament_round,
      tournament_final_rounds.final_round
    from public.match_players match_player
    join public.matches match_row on match_row.id = match_player.match_id
    left join lateral (
      select result.score_a, result.score_b
      from public.match_results result
      where result.match_id = match_row.id
      order by result.submitted_at desc nulls last
      limit 1
    ) result_row on true
    left join tournament_final_rounds
      on tournament_final_rounds.tournament_id = nullif(btrim(match_row.tournament_id), '')
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
    count(*) filter (where team_id is not null and outcome = 'win')::integer,
    count(*) filter (where scheduled_time_value >= time '21:00')::integer,
    count(*) filter (where ranked)::integer,
    count(*) filter (where official)::integer,
    count(*) filter (where visibility = 'public')::integer,
    count(*) filter (where visibility = 'private')::integer,
    count(*) filter (where visibility = 'private' and team_a_id is not null and team_b_id is not null)::integer,
    count(*) filter (where mode = '1v1')::integer,
    count(*) filter (where mode = '2v2')::integer,
    count(*) filter (where mode = '3v3')::integer,
    count(*) filter (where mode = '4v4')::integer,
    count(*) filter (where mode = '5v5')::integer,
    count(*) filter (where position = 'PG')::integer,
    count(*) filter (where position = 'SG')::integer,
    count(*) filter (where position = 'SF')::integer,
    count(*) filter (where position = 'PF')::integer,
    count(*) filter (where position = 'C')::integer,
    count(*) filter (where tournament_id is not null)::integer,
    count(distinct tournament_id) filter (where tournament_id is not null)::integer,
    count(*) filter (where tournament_id is not null and outcome = 'win')::integer,
    count(*) filter (where tournament_format = 'tournament' and tournament_round = final_round)::integer,
    count(*) filter (where tournament_format = 'tournament' and tournament_round = final_round and outcome = 'win')::integer
  into
    close_win_count,
    team_match_count,
    team_match_win_count,
    night_match_count,
    ranked_match_count,
    official_match_count,
    public_match_count,
    private_match_count,
    private_team_match_count,
    mode_1v1_count,
    mode_2v2_count,
    mode_3v3_count,
    mode_4v4_count,
    mode_5v5_count,
    pg_appearances,
    sg_appearances,
    sf_appearances,
    pf_appearances,
    c_appearances,
    tournament_match_count,
    tournament_participation_count,
    tournament_win_count,
    tournament_final_count,
    tournament_title_count
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

  with confirmed_stats as (
    select
      stat.*,
      max(coalesce(stat.points, 0)) over (partition by stat.match_id) as match_max_points,
      max(coalesce(stat.rebounds, 0)) over (partition by stat.match_id) as match_max_rebounds,
      max(coalesce(stat.assists, 0)) over (partition by stat.match_id) as match_max_assists,
      max(coalesce(stat.steals, 0)) over (partition by stat.match_id) as match_max_steals,
      max(coalesce(stat.blocks, 0)) over (partition by stat.match_id) as match_max_blocks
    from public.player_match_stats stat
    join public.matches match_row on match_row.id = stat.match_id
    where match_row.status = 'confirmed'
  )
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
    count(*) filter (where coalesce(stat.points, 0) >= 20 and coalesce(stat.rebounds, 0) + coalesce(stat.assists, 0) >= 10)::integer,
    count(*) filter (where coalesce(stat.points, 0) >= 10 and coalesce(stat.points, 0) = stat.match_max_points)::integer,
    count(*) filter (where coalesce(stat.rebounds, 0) >= 5 and coalesce(stat.rebounds, 0) = stat.match_max_rebounds)::integer,
    count(*) filter (where coalesce(stat.assists, 0) >= 5 and coalesce(stat.assists, 0) = stat.match_max_assists)::integer,
    count(*) filter (where coalesce(stat.steals, 0) >= 2 and coalesce(stat.steals, 0) = stat.match_max_steals)::integer,
    count(*) filter (where coalesce(stat.blocks, 0) >= 2 and coalesce(stat.blocks, 0) = stat.match_max_blocks)::integer
  into
    double_double_count,
    triple_double_count,
    mvp_performance_count,
    scoring_leader_game_count,
    rebound_leader_game_count,
    assist_leader_game_count,
    steal_leader_game_count,
    block_leader_game_count
  from confirmed_stats stat
  where stat.user_id = safe_profile_id;

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
    count(*) filter (where request.status = 'approved')::integer
  into approved_court_count
  from public.court_requests request
  where request.requested_by = safe_profile_id;

  select count(*)::integer
  into court_review_count
  from public.court_reviews review
  where review.reviewer_id = safe_profile_id
    and review.status = 'active';

  court_contribution_count := approved_court_count + court_review_count;

  select count(distinct invitation.id)::integer
  into team_invite_accepted_count
  from public.team_invitations invitation
  where invitation.from_user_id = safe_profile_id
    and invitation.status = 'accepted';

  select count(distinct notification.invitation_id)::integer
  into recruiting_invite_accepted_count
  from public.notifications notification
  where notification.target_user_id = safe_profile_id
    and notification.payload->>'source' = 'recruiting_invitation_accept'
    and nullif(btrim(notification.invitation_id), '') is not null;

  select count(*)::integer
  into matchmaking_success_count
  from public.recruiting_posts post
  where post.confirmed_at is not null
    and (
      post.player_id = safe_profile_id
      or coalesce(post.player_ids, '[]'::jsonb) ? safe_profile_id
      or exists (
        select 1
        from public.recruiting_applications application
        where application.post_id = post.id
          and (
            application.player_id = safe_profile_id
            or coalesce(application.player_ids, '[]'::jsonb) ? safe_profile_id
          )
      )
      or exists (
        select 1
        from jsonb_each(
          case
            when jsonb_typeof(post.room_state->'partyReserves') = 'object' then post.room_state->'partyReserves'
            else '{}'::jsonb
          end
        ) reserve_party(key, player_ids)
        where (
          case when jsonb_typeof(player_ids) = 'array' then player_ids else '[]'::jsonb end
        ) ? safe_profile_id
      )
    );

  select
    count(*) filter (where
      coalesce(match_row.reserve_players->'teamA', '[]'::jsonb) ? safe_profile_id
      or coalesce(match_row.reserve_players->'teamB', '[]'::jsonb) ? safe_profile_id
    )::integer,
    count(*) filter (where
      coalesce(match_row.promoted_reserve_ids->'teamA', '[]'::jsonb) ? safe_profile_id
      or coalesce(match_row.promoted_reserve_ids->'teamB', '[]'::jsonb) ? safe_profile_id
    )::integer
  into reserve_count, promoted_reserve_count
  from public.matches match_row
  where match_row.status = 'confirmed';

  select count(*)::integer
  into tournament_host_count
  from public.tournaments tournament
  where tournament.created_by = safe_profile_id
    and (
      tournament.started_at is not null
      or tournament.status in ('active', 'closed')
    );

  return jsonb_build_object(
    'matchCount', match_count,
    'winCount', win_count,
    'points', points_count,
    'rebounds', rebounds_count,
    'assists', assists_count,
    'steals', steals_count,
    'blocks', blocks_count,
    'stealsBlocks', steals_count + blocks_count,
    'interiorStops', rebounds_count + blocks_count,
    'trustScore', trust_score_value,
    'streak', greatest(current_streak, best_streak),
    'integratedMmr', integrated_mmr,
    'teamCount', team_count,
    'captainCount', captain_count,
    'closeWinCount', close_win_count,
    'teamMatchCount', team_match_count,
    'teamMatchWinCount', team_match_win_count,
    'nightMatchCount', night_match_count,
    'rankedMatchCount', ranked_match_count,
    'officialMatchCount', official_match_count,
    'publicMatchCount', public_match_count,
    'privateMatchCount', private_match_count,
    'privateTeamMatchCount', private_team_match_count,
    'mode1v1Count', mode_1v1_count,
    'mode2v2Count', mode_2v2_count,
    'mode3v3Count', mode_3v3_count,
    'mode4v4Count', mode_4v4_count,
    'mode5v5Count', mode_5v5_count
  ) || jsonb_build_object(
    'pgAppearances', pg_appearances,
    'sgAppearances', sg_appearances,
    'sfAppearances', sf_appearances,
    'pfAppearances', pf_appearances,
    'cAppearances', c_appearances,
    'doubleDoubleCount', double_double_count,
    'tripleDoubleCount', triple_double_count,
    'mvpPerformanceCount', mvp_performance_count,
    'scoringLeaderGameCount', scoring_leader_game_count,
    'reboundLeaderGameCount', rebound_leader_game_count,
    'assistLeaderGameCount', assist_leader_game_count,
    'stealLeaderGameCount', steal_leader_game_count,
    'blockLeaderGameCount', block_leader_game_count,
    'refereeCount', referee_count,
    'recorderCount', recorder_count,
    'courtContributionCount', court_contribution_count,
    'approvedCourtCount', approved_court_count,
    'courtReviewCount', court_review_count,
    'recruitingInviteAcceptedCount', recruiting_invite_accepted_count,
    'teamInviteAcceptedCount', team_invite_accepted_count,
    'matchmakingSuccessCount', matchmaking_success_count,
    'reserveCount', reserve_count,
    'promotedReserveCount', promoted_reserve_count,
    'tournamentMatchCount', tournament_match_count,
    'tournamentParticipationCount', tournament_participation_count,
    'tournamentWinCount', tournament_win_count,
    'tournamentFinalCount', tournament_final_count,
    'tournamentTitleCount', tournament_title_count,
    'tournamentHostCount', tournament_host_count
  );
end;
$$;

revoke all on function public.rankball_profile_icon_metrics(text) from public, anon, authenticated;
grant execute on function public.rankball_profile_icon_metrics(text) to service_role;
