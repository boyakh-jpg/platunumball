-- Require fresh post-dispute approvals and exclude reserve-only players from finalization.

alter table public.match_approvals
  add column if not exists approved_at timestamptz not null default now();

create index if not exists match_approvals_match_approved_at_idx
  on public.match_approvals (match_id, approved_at desc);

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef(
    'public.rankball_match_approval_action_concurrency_inner(text,text,text,text)'::regprocedure
  ) into function_definition;

  old_text := $old$insert into public.match_approvals (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;$old$;
  new_text := $new$insert into public.match_approvals (match_id, user_id, side, approved_at)
  values (safe_match_id, safe_player_id, safe_side, now())
  on conflict (match_id, user_id) do update set
    side = excluded.side,
    approved_at = excluded.approved_at;$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_approval_timestamp_insert_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$where approval.match_id = safe_match_id;$old$;
  new_text := $new$where approval.match_id = safe_match_id
    and approval.approved_at >= coalesce(current_match.dispute_resolved_at, '-infinity'::timestamptz);$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_approval_timestamp_count_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$and nullif(btrim(player.user_id), '') is not null$old$;
  new_text := $new$and nullif(btrim(player.user_id), '') is not null
      and not (
        (case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id
      )$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_approval_active_roster_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  execute function_definition;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef(
    'public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure
  ) into function_definition;

  old_text := $old$where approval.match_id = safe_match_id;$old$;
  new_text := $new$where approval.match_id = safe_match_id
      and approval.approved_at >= coalesce(current_match.dispute_resolved_at, '-infinity'::timestamptz);$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_timestamp_count_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$and nullif(btrim(player.user_id), '') is not null$old$;
  new_text := $new$and nullif(btrim(player.user_id), '') is not null
      and not (
        (case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id
      )$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_active_roster_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$and nullif(btrim(match_player.user_id), '') is not null$old$;
  new_text := $new$and nullif(btrim(match_player.user_id), '') is not null
        and not (
          (case when jsonb_typeof(current_match.reserve_players -> (match_player.side)) = 'array'
            then current_match.reserve_players -> (match_player.side) else '[]'::jsonb end) ? match_player.user_id
        )$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_rating_roster_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamA'$old$;
  new_text := $new$select user_id as player_id from public.match_players
      where match_id = safe_match_id and side = 'teamA'
        and not ((case when jsonb_typeof(current_match.reserve_players->'teamA') = 'array'
          then current_match.reserve_players->'teamA' else '[]'::jsonb end) ? user_id)$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_team_a_mmr_roster_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$select user_id as player_id from public.match_players where match_id = safe_match_id and side = 'teamB'$old$;
  new_text := $new$select user_id as player_id from public.match_players
      where match_id = safe_match_id and side = 'teamB'
        and not ((case when jsonb_typeof(current_match.reserve_players->'teamB') = 'array'
          then current_match.reserve_players->'teamB' else '[]'::jsonb end) ? user_id)$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_team_b_mmr_roster_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  execute function_definition;
end;
$migration$;

create or replace function public.rankball_match_resume_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result_draft jsonb
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
  draft_stats jsonb;
  result_score_a integer := 0;
  result_score_b integer := 0;
  resolved_at timestamptz := now();
  tournament_lock_id text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  select nullif(btrim(match.tournament_id), '') into tournament_lock_id
  from public.matches match where match.id = safe_match_id;
  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(tournament_lock_id));
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status <> 'disputed' then
    raise exception 'match_resume_approval_locked' using errcode = '23514';
  end if;
  if safe_actor_id is distinct from coalesce(
    nullif(btrim(current_match.referee_id), ''),
    nullif(btrim(current_match.created_by), '')
  ) then
    raise exception 'match_dispute_operator_required' using errcode = '42501';
  end if;

  if p_result_draft is not null and p_result_draft <> 'null'::jsonb then
    perform public.rankball_match_result_action(safe_actor_id, safe_match_id, p_result_draft);
    select * into current_match from public.matches where id = safe_match_id for update;
  end if;
  if current_match.dispute_draft_result is null then
    raise exception 'match_dispute_draft_missing' using errcode = '23514';
  end if;
  draft_stats := coalesce(current_match.dispute_draft_result->'playerStats', '{}'::jsonb);

  with actual_players as (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and not (
        (case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id
      )
    union
    select played.value, 'teamA' from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    union
    select played.value, 'teamB' from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
  )
  select
    coalesce(sum(coalesce((draft_stats -> (player.user_id) ->> 'points')::integer, 0)) filter (where player.side = 'teamA'), 0)::integer,
    coalesce(sum(coalesce((draft_stats -> (player.user_id) ->> 'points')::integer, 0)) filter (where player.side = 'teamB'), 0)::integer
  into result_score_a, result_score_b
  from actual_players player;

  with actual_players as (
    select player.user_id
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and not (
        (case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id
      )
    union
    select played.value from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    union
    select played.value from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
  )
  insert into public.player_match_stats (
    match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at
  )
  select
    safe_match_id, item.key, safe_actor_id, 'dispute_operator',
    coalesce((item.value->>'points')::integer, 0),
    coalesce((item.value->>'rebounds')::integer, 0),
    coalesce((item.value->>'assists')::integer, 0),
    coalesce((item.value->>'steals')::integer, 0),
    coalesce((item.value->>'blocks')::integer, 0),
    coalesce((item.value->>'fouls')::integer, 0),
    resolved_at
  from jsonb_each(draft_stats) item
  join actual_players player on player.user_id = item.key
  on conflict (match_id, user_id) do update set
    recorded_by = excluded.recorded_by,
    record_source = excluded.record_source,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    fouls = excluded.fouls,
    updated_at = excluded.updated_at;

  insert into public.match_results (
    match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at
  ) values (
    safe_match_id,
    safe_actor_id,
    result_score_a,
    result_score_b,
    coalesce(current_match.dispute_draft_result->'statSubmissions', '{}'::jsonb),
    resolved_at
  ) on conflict (match_id) do update set
    submitted_by = excluded.submitted_by,
    score_a = excluded.score_a,
    score_b = excluded.score_b,
    stat_submissions = excluded.stat_submissions,
    submitted_at = excluded.submitted_at;

  update public.matches
  set status = 'approval',
      score_a = result_score_a,
      score_b = result_score_b,
      dispute_resolved_at = resolved_at,
      updated_at = resolved_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'resumeMatchApproval',
    'matchId', safe_match_id,
    'finalized', false,
    'reapprovalRequired', true,
    'scoreA', result_score_a,
    'scoreB', result_score_b,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_resume_approval_action(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_match_resume_approval_action(text, text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');
