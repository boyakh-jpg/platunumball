create or replace function public.rankball_match_finalize_locked(
  p_actor_profile_id text,
  p_match_id text,
  p_action text default 'approveMatch'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  result_row public.match_results%rowtype;
  final_score_a integer;
  final_score_b integer;
  actual_a numeric;
  actual_b numeric;
  side_a_avg numeric := 1200;
  side_b_avg numeric := 1200;
  quality numeric;
  mode_weight numeric;
  integrated_weight numeric;
  mode_cap numeric;
  integrated_cap numeric;
  rating_changes jsonb := '[]'::jsonb;
  team_changes jsonb := '{}'::jsonb;
  profile_ids jsonb := '[]'::jsonb;
  team_ids jsonb := '[]'::jsonb;
  player record;
  current_rating numeric;
  current_integrated numeric;
  expected numeric;
  k_factor numeric;
  mode_delta numeric;
  stat_boost numeric;
  source_factor numeric;
  result_factor numeric;
  mercenary_factor numeric;
  integrated_delta numeric;
  next_ratings jsonb;
  player_actual numeric;
  player_opponent numeric;
  player_team_mmr numeric;
  player_role text;
  player_result text;
  trust_delta integer;
  team_row record;
  opponent_team_avg numeric;
  team_delta numeric;
  team_actual numeric;
  now_at timestamptz := now();
  missing_stats integer;
  points_a integer;
  points_b integer;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'matchId', safe_match_id, 'alreadyConfirmed', true, 'ratingAtomic', true, 'sqlReducer', true);
  end if;
  if current_match.status not in ('approval', 'disputed') then raise exception 'match_finalization_locked' using errcode = '23514'; end if;
  if current_match.status = 'disputed' and not public.rankball_match_is_operator(current_match, safe_actor_id) then
    raise exception 'match_dispute_operator_required' using errcode = '42501';
  end if;

  if current_match.status = 'disputed' then
    if current_match.dispute_draft_result is null then raise exception 'match_dispute_draft_missing' using errcode = '23514'; end if;
    delete from public.player_match_stats where match_id = safe_match_id;
    insert into public.player_match_stats (match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at)
    select safe_match_id, item.key, safe_actor_id, 'dispute_operator',
      coalesce((item.value->>'points')::integer, 0), coalesce((item.value->>'rebounds')::integer, 0),
      coalesce((item.value->>'assists')::integer, 0), coalesce((item.value->>'steals')::integer, 0),
      coalesce((item.value->>'blocks')::integer, 0), coalesce((item.value->>'fouls')::integer, 0), now_at
    from jsonb_each(coalesce(current_match.dispute_draft_result->'playerStats', '{}'::jsonb)) item;
    insert into public.match_results (match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at)
    values (
      safe_match_id, safe_actor_id,
      coalesce((current_match.dispute_draft_result->>'scoreA')::integer, 0),
      coalesce((current_match.dispute_draft_result->>'scoreB')::integer, 0),
      coalesce(current_match.dispute_draft_result->'statSubmissions', '{}'::jsonb), now_at
    ) on conflict (match_id) do update set
      submitted_by = excluded.submitted_by, score_a = excluded.score_a, score_b = excluded.score_b,
      stat_submissions = excluded.stat_submissions, submitted_at = excluded.submitted_at;
  end if;

  select * into result_row from public.match_results where match_id = safe_match_id for update;
  if result_row.match_id is null then raise exception 'match_result_missing' using errcode = '23514'; end if;

  select count(*) into missing_stats
  from (
    select distinct player_id
    from (
      select user_id as player_id from public.match_players where match_id = safe_match_id
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb))
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb))
    ) players
  ) expected_players
  where not exists (select 1 from public.player_match_stats stat where stat.match_id = safe_match_id and stat.user_id = expected_players.player_id);
  if missing_stats > 0 then raise exception 'match_approval_stats_incomplete' using errcode = '23514'; end if;

  select
    coalesce(sum(stat.points) filter (where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamA'), 0),
    coalesce(sum(stat.points) filter (where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamB'), 0)
  into points_a, points_b
  from public.player_match_stats stat where stat.match_id = safe_match_id;
  if points_a <> result_row.score_a or points_b <> result_row.score_b then
    raise exception 'match_approval_point_mismatch' using errcode = '23514';
  end if;

  final_score_a := result_row.score_a;
  final_score_b := result_row.score_b;
  actual_a := case when final_score_a = final_score_b then 0.5 when final_score_a > final_score_b then 1 else 0 end;
  actual_b := 1 - actual_a;
  mode_weight := case current_match.mode when '1v1' then 0.78 when '2v2' then 0.9 when '3v3' then 1 else 1.12 end;
  integrated_weight := case current_match.mode when '1v1' then 0.25 when '2v2' then 0.45 when '3v3' then 0.85 else 1.35 end;
  mode_cap := case current_match.mode when '1v1' then 25 when '2v2' then 28 when '3v3' then 32 else case when current_match.official then 50 else 40 end end;
  integrated_cap := case current_match.mode when '1v1' then 8 when '2v2' then 14 when '3v3' then 25 else case when current_match.official then 55 else 45 end end;
  quality := least(2.05, greatest(0,
    (case when not current_match.ranked then 0.18 when current_match.official and coalesce(current_match.evidence, '[]'::jsonb) <> '[]'::jsonb then 1.5 when current_match.official then 1.35 when coalesce(current_match.evidence, '[]'::jsonb) <> '[]'::jsonb then 1.15 when current_match.pre_registered then 1 else 0.7 end)
    * (case when not current_match.pre_registered then 0.7 when current_match.scheduled_date is null then 1 when current_match.scheduled_date::timestamp - current_match.created_at >= interval '3 days' then 1.15 when current_match.scheduled_date::timestamp - current_match.created_at >= interval '1 day' then 1.1 when current_match.scheduled_date::timestamp - current_match.created_at >= interval '30 minutes' then 1 else 0.7 end)
    * (case when coalesce(current_match.evidence, '[]'::jsonb) <> '[]'::jsonb then 1.2 else 1 end)
    * (case when current_match.tournament_id is null then 1 when current_match.tournament_format = 'tournament' then 1.18 else 1.12 end)
    * greatest(0.2, least(1.15, coalesce((current_match.rules->>'ratingScale')::numeric, 1)))
  ));

  select coalesce(avg(coalesce((profile.ratings #>> array['modes', current_match.mode])::numeric, (profile.ratings->>'integrated')::numeric, 1200)), 1200)
  into side_a_avg
  from public.profiles profile
  where profile.id in (
    select distinct player_id from (
      select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamA'
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb))
    ) players
  ) and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;
  select coalesce(avg(coalesce((profile.ratings #>> array['modes', current_match.mode])::numeric, (profile.ratings->>'integrated')::numeric, 1200)), 1200)
  into side_b_avg
  from public.profiles profile
  where profile.id in (
    select distinct player_id from (
      select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamB'
      union all select value from jsonb_array_elements_text(coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb))
    ) players
  ) and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;

  if not current_match.ranked then
    update public.profiles profile
    set
      trust_score = greatest(0, least(
        100,
        coalesce(profile.trust_score, 80) + 1 - least(4, greatest(0, coalesce(stat.fouls, 0) - 2))
      )),
      updated_at = now_at
    from public.player_match_stats stat
    where stat.match_id = safe_match_id
      and stat.user_id = profile.id
      and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id;
  end if;

  for player in
    select profile.*, public.rankball_match_player_side(safe_match_id, profile.id, current_match) as side,
      stat.points, stat.rebounds, stat.assists, stat.steals, stat.blocks, stat.fouls, stat.record_source,
      mp.team_id
    from public.profiles profile
    join public.player_match_stats stat on stat.match_id = safe_match_id and stat.user_id = profile.id
    left join public.match_players mp on mp.match_id = safe_match_id and mp.user_id = profile.id
    where current_match.ranked
      and not coalesce(current_match.mmr_excluded_player_ids, '[]'::jsonb) ? profile.id
    for update of profile
  loop
    current_integrated := coalesce((player.ratings->>'integrated')::numeric, 1200);
    current_rating := coalesce((player.ratings #>> array['modes', current_match.mode])::numeric, current_integrated);
    player_actual := case when player.side = 'teamA' then actual_a else actual_b end;
    player_opponent := case when player.side = 'teamA' then side_b_avg else side_a_avg end;
    player_team_mmr := case when player.side = 'teamA' then side_a_avg else side_b_avg end;
    expected := 1 / (1 + power(10::numeric, (player_opponent - player_team_mmr) / 400));
    k_factor := case when current_rating < 1000 then 34 when current_rating < 1400 then 30 when current_rating < 1700 then 26 when current_rating < 1900 then 22 else 18 end;
    mode_delta := greatest(-mode_cap, least(mode_cap,
      k_factor * (player_actual - expected) * mode_weight * quality * greatest(0.86, least(1.1, 0.82 + coalesce(player.trust_score, 80) / 400.0))
    ));
    source_factor := case player.record_source when 'referee' then 1 when 'candidate_recorder' then 0.72 when 'player' then 0.5 else 1 end;
    result_factor := case when player_actual = 1 then 1 when player_actual = 0 then 0.55 else 0.75 end;
    stat_boost := round(greatest(-0.8, least(2.2,
      coalesce(player.points, 0) * 0.035 + coalesce(player.rebounds, 0) * 0.055 + coalesce(player.assists, 0) * 0.055 + coalesce(player.steals, 0) * 0.08 + coalesce(player.blocks, 0) * 0.08
    )) * result_factor * source_factor, 1);
    player_role := coalesce((select role from public.team_members where team_id = player.team_id and user_id = player.id limit 1), 'regular');
    mercenary_factor := case when player_role <> 'mercenary' then 1 when current_integrated >= coalesce((select mmr from public.teams where id = player.team_id), player_team_mmr) + 140 then 0.62 when current_integrated <= coalesce((select mmr from public.teams where id = player.team_id), player_team_mmr) - 140 then 0.96 else 0.82 end;
    mode_delta := round(greatest(-48, least(48, (mode_delta + stat_boost) * mercenary_factor)), 1);
    integrated_delta := round(greatest(-integrated_cap, least(integrated_cap, mode_delta * integrated_weight)), 1);
    player_result := case when player_actual = 1 then 'win' when player_actual = 0 then 'loss' else 'draw' end;
    trust_delta := 1 - least(4, greatest(0, coalesce(player.fouls, 0) - 2));
    next_ratings := jsonb_set(
      jsonb_set(
        jsonb_set(coalesce(player.ratings, '{}'::jsonb), '{modes}', coalesce(player.ratings->'modes', '{}'::jsonb), true),
        '{integrated}',
        to_jsonb(greatest(0, round(current_integrated + integrated_delta))),
        true
      ),
      array['modes', current_match.mode],
      to_jsonb(greatest(0, round(current_rating + mode_delta))),
      true
    );
    update public.profiles
    set ratings = next_ratings,
        trust_score = greatest(0, least(100, coalesce(trust_score, 80) + trust_delta)),
        streak = case when player_result = 'win' then greatest(1, coalesce(streak, 0) + 1) when player_result = 'loss' then least(-1, coalesce(streak, 0) - 1) else coalesce(streak, 0) end,
        updated_at = now_at
    where id = player.id;
    rating_changes := rating_changes || jsonb_build_object(
      'playerId', player.id, 'side', player.side, 'modeDelta', mode_delta, 'integratedDelta', integrated_delta,
      'statBoost', stat_boost, 'mercenaryFactor', mercenary_factor, 'result', player_result
    );
    profile_ids := profile_ids || to_jsonb(player.id);
  end loop;

  update public.profiles profile
  set trust_score = greatest(0, least(100, coalesce(profile.trust_score, 80) + reward.delta)), updated_at = now_at
  from (
    select recorder_id, sum(delta)::integer as delta
    from (
      select value->>'by' as recorder_id, 2 as delta
      from jsonb_each(coalesce(result_row.stat_submissions, '{}'::jsonb))
      where value->>'source' = 'candidate_recorder' and nullif(value->>'by', '') is not null
      union all select current_match.referee_id, 1 where current_match.referee_id is not null
    ) rewards
    group by recorder_id
  ) reward
  where profile.id = reward.recorder_id;

  for team_row in
    select team.*, side
    from public.teams team
    join (
      select distinct team_id, side from public.match_players where match_id = safe_match_id and team_id is not null
    ) groups on groups.team_id = team.id
    where current_match.ranked
      and team.deleted_at is null
    for update of team
  loop
    team_actual := case when team_row.side = 'teamA' then actual_a else actual_b end;
    select coalesce(avg(mmr), 1200) into opponent_team_avg
    from public.teams
    where id in (select distinct team_id from public.match_players where match_id = safe_match_id and side <> team_row.side and team_id is not null);
    team_delta := round(greatest(-34, least(34, 24 * (team_actual - (1 / (1 + power(10::numeric, (opponent_team_avg - team_row.mmr) / 400)))) * quality)), 1);
    update public.teams
    set mmr = round(coalesce(mmr, 1200) + team_delta),
        wins = coalesce(wins, 0) + case when team_actual = 1 then 1 else 0 end,
        losses = coalesce(losses, 0) + case when team_actual = 0 then 1 else 0 end,
        updated_at = now_at
    where id = team_row.id;
    team_changes := jsonb_set(team_changes, array[team_row.id], to_jsonb(team_delta), true);
    team_ids := team_ids || to_jsonb(team_row.id);
  end loop;

  update public.matches
  set status = 'confirmed',
      score_a = final_score_a,
      score_b = final_score_b,
      rating_result = rating_changes,
      team_rating_result = jsonb_build_object(
        'teamA', coalesce((select sum((value #>> '{}')::numeric) from jsonb_each(team_changes) entry(key, value) where key in (select distinct team_id from public.match_players where match_id = safe_match_id and side = 'teamA' and team_id is not null)), 0),
        'teamB', coalesce((select sum((value #>> '{}')::numeric) from jsonb_each(team_changes) entry(key, value) where key in (select distinct team_id from public.match_players where match_id = safe_match_id and side = 'teamB' and team_id is not null)), 0),
        'teams', team_changes
      ),
      confirmed_at = now_at,
      dispute_draft_result = null,
      dispute_draft_updated_at = null,
      dispute_resolved_at = case when current_match.status = 'disputed' then now_at else dispute_resolved_at end,
      updated_at = now_at
  where id = safe_match_id;

  delete from public.match_approvals where match_id = safe_match_id;
  insert into public.notifications (id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at)
  values (
    'match-confirmed-' || substr(md5(safe_match_id || ':' || now_at::text), 1, 24),
    safe_actor_id, safe_actor_id, '경기 확정',
    current_match.title || case when current_match.ranked then ' 결과가 티어와 랭킹에 반영됐습니다.' else ' 결과가 공식 기록으로 확정됐습니다.' end,
    case when current_match.ranked then 'tier' else 'match' end,
    'match', safe_match_id, jsonb_build_object('matchId', safe_match_id), now_at, now_at
  ) on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true, 'action', p_action, 'matchId', safe_match_id, 'ratingResult', rating_changes,
    'teamRatingResult', team_changes, 'profileIds', profile_ids, 'teamIds', team_ids,
    'ratingAtomic', true, 'sqlReducer', true, 'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_finalize_locked(text, text, text) from public;
revoke all on function public.rankball_match_finalize_locked(text, text, text) from anon;
revoke all on function public.rankball_match_finalize_locked(text, text, text) from authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
