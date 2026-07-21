-- Persist concurrent match disputes and resolve each request independently.

alter table public.match_disputes
  add column if not exists request_payload jsonb not null default '{}'::jsonb;

drop index if exists public.match_disputes_one_open_per_match_idx;

create unique index if not exists match_disputes_one_open_per_user_idx
  on public.match_disputes (match_id, user_id)
  where status = 'open';

create index if not exists match_disputes_open_queue_idx
  on public.match_disputes (match_id, created_at, id)
  where status = 'open';

create or replace function public.rankball_match_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_request jsonb default '""'::jsonb
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
  current_result public.match_results%rowtype;
  dispute_reason text;
  requested_player_id text;
  requested_points integer;
  safe_request jsonb := '{}'::jsonb;
  player_stats jsonb := '{}'::jsonb;
  dispute_draft jsonb;
  actor_allowed boolean := false;
  dispute_minutes integer := 15;
  dispute_id uuid := gen_random_uuid();
  host_id text;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_actor_id is null then raise exception 'missing_actor_profile_id' using errcode = '22023'; end if;
  if safe_match_id is null then raise exception 'missing_match' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  select * into current_result from public.match_results where match_id = safe_match_id;
  if current_result.match_id is null then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_result_missing', 'matchId', safe_match_id);
  end if;
  if not (
    current_match.status in ('approval', 'disputed')
    or (current_match.status = 'agreed' and current_match.ended_at is not null)
  ) then
    return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_not_disputable', 'matchId', safe_match_id);
  end if;

  dispute_minutes := case when current_match.dispute_minutes in (10, 15, 20) then current_match.dispute_minutes else 15 end;
  if current_match.ended_at is null or current_match.ended_at + make_interval(mins => dispute_minutes) < now_at then
    raise exception 'match_dispute_window_closed' using errcode = '42501';
  end if;

  select (
    exists (
      select 1 from public.match_players player
      where player.match_id = safe_match_id
        and player.user_id = safe_actor_id
        and player.side in ('teamA', 'teamB')
        and not ((case
          when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
            then current_match.reserve_players -> (player.side)
          else '[]'::jsonb
        end) ? player.user_id)
    )
    or (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamA}') ? safe_actor_id
    or (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamB}') ? safe_actor_id
  ) into actor_allowed;
  if not actor_allowed then raise exception 'match_dispute_permission_denied' using errcode = '42501'; end if;
  if exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id and dispute.user_id = safe_actor_id and dispute.status = 'open'
  ) then
    raise exception 'match_dispute_already_open' using errcode = '23505';
  end if;

  dispute_reason := case
    when jsonb_typeof(coalesce(p_dispute_request, '""'::jsonb)) = 'object' then nullif(btrim(p_dispute_request->>'reason'), '')
    when jsonb_typeof(coalesce(p_dispute_request, '""'::jsonb)) = 'string' then nullif(btrim(p_dispute_request #>> '{}'), '')
    else null
  end;
  dispute_reason := left(coalesce(dispute_reason, '스코어 또는 개인 기록 확인이 필요합니다.'), 500);
  requested_player_id := case
    when jsonb_typeof(coalesce(p_dispute_request, '{}'::jsonb)) = 'object' then nullif(btrim(p_dispute_request->>'playerId'), '')
    else null
  end;
  if requested_player_id = safe_actor_id and coalesce(p_dispute_request->>'requestedPoints', '') ~ '^[0-9]+(\.[0-9]+)?$' then
    requested_points := least(999::numeric, greatest(0::numeric, round((p_dispute_request->>'requestedPoints')::numeric)))::integer;
  else
    requested_player_id := null;
    requested_points := null;
  end if;
  safe_request := jsonb_strip_nulls(jsonb_build_object(
    'reason', dispute_reason,
    'playerId', requested_player_id,
    'requestedPoints', requested_points
  ));

  select coalesce(jsonb_object_agg(stat.user_id, jsonb_build_object(
    'points', greatest(0, coalesce(stat.points, 0)),
    'rebounds', greatest(0, coalesce(stat.rebounds, 0)),
    'assists', greatest(0, coalesce(stat.assists, 0)),
    'steals', greatest(0, coalesce(stat.steals, 0)),
    'blocks', greatest(0, coalesce(stat.blocks, 0)),
    'fouls', greatest(0, coalesce(stat.fouls, 0))
  )), '{}'::jsonb)
  into player_stats
  from public.player_match_stats stat
  where stat.match_id = safe_match_id;

  dispute_draft := coalesce(current_match.dispute_draft_result, jsonb_build_object(
    'scoreA', greatest(0, coalesce(current_result.score_a, 0)),
    'scoreB', greatest(0, coalesce(current_result.score_b, 0)),
    'playerStats', player_stats,
    'statSubmissions', coalesce(current_result.stat_submissions, '{}'::jsonb),
    'submittedBy', current_result.submitted_by,
    'submittedAt', current_result.submitted_at,
    'updatedAt', now_at
  ));

  insert into public.match_disputes (id, match_id, user_id, reason, request_payload, status, created_at)
  values (dispute_id, safe_match_id, safe_actor_id, dispute_reason, safe_request, 'open', now_at);

  update public.matches
  set status = 'disputed', dispute_draft_result = dispute_draft,
      dispute_draft_updated_at = coalesce(dispute_draft_updated_at, now_at), updated_at = now_at
  where id = safe_match_id;

  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
  ) values (
    'n_' || md5('dispute-received' || dispute_id::text || safe_actor_id),
    safe_actor_id, safe_actor_id, '이의제기 접수',
    current_match.title || ' 이의제기가 접수됐습니다. 방장이 건별로 처리합니다.',
    'match', 'match', safe_match_id,
    jsonb_build_object('matchId', safe_match_id, 'disputeId', dispute_id, 'action', 'disputeMatch'), now_at, now_at
  ) on conflict (id) do nothing;

  host_id := nullif(btrim(current_match.created_by), '');
  if host_id is not null and host_id <> safe_actor_id then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
    ) values (
      'n_' || md5('dispute-queue' || dispute_id::text || host_id),
      host_id, host_id, '이의제기 처리 필요',
      current_match.title || ' 이의제기가 처리할 일에 추가됐습니다.',
      'orange', 'match', safe_match_id,
      jsonb_build_object('matchId', safe_match_id, 'disputeId', dispute_id, 'action', 'resolveMatchDispute'), now_at, now_at
    ) on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'action', 'disputeMatch', 'matchId', safe_match_id,
    'disputeId', dispute_id, 'actorProfileId', safe_actor_id,
    'sqlReducer', true, 'advisoryLocked', true
  );
end;
$$;

create or replace function public.rankball_match_resolve_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_id text,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_dispute_id text := nullif(btrim(p_dispute_id), '');
  safe_decision text := lower(nullif(btrim(p_decision), ''));
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  current_dispute public.match_disputes%rowtype;
  working_draft jsonb;
  player_stats jsonb := '{}'::jsonb;
  stat_submissions jsonb := '{}'::jsonb;
  requested_player_id text;
  requested_points integer;
  actor_stats jsonb;
  actual_player boolean := false;
  result_score_a integer := 0;
  result_score_b integer := 0;
  open_count integer := 0;
  decision_label text;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_actor_id is null or safe_match_id is null or safe_dispute_id is null then
    raise exception 'missing_match_dispute_resolution_input' using errcode = '22023';
  end if;
  if safe_decision not in ('accepted', 'rejected') then
    raise exception 'match_dispute_decision_invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status <> 'disputed' then raise exception 'match_dispute_not_open' using errcode = '23514'; end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_host_required' using errcode = '42501';
  end if;

  select * into current_dispute
  from public.match_disputes dispute
  where dispute.match_id = safe_match_id and dispute.id::text = safe_dispute_id and dispute.status = 'open'
  for update;
  if current_dispute.id is null then raise exception 'match_dispute_item_not_open' using errcode = 'P0002'; end if;

  select * into current_result from public.match_results where match_id = safe_match_id for update;
  if current_result.match_id is null then raise exception 'match_result_missing' using errcode = '23514'; end if;
  select coalesce(jsonb_object_agg(stat.user_id, jsonb_build_object(
    'points', greatest(0, coalesce(stat.points, 0)), 'rebounds', greatest(0, coalesce(stat.rebounds, 0)),
    'assists', greatest(0, coalesce(stat.assists, 0)), 'steals', greatest(0, coalesce(stat.steals, 0)),
    'blocks', greatest(0, coalesce(stat.blocks, 0)), 'fouls', greatest(0, coalesce(stat.fouls, 0))
  )), '{}'::jsonb)
  into player_stats from public.player_match_stats stat where stat.match_id = safe_match_id;
  stat_submissions := coalesce(current_result.stat_submissions, '{}'::jsonb);
  working_draft := coalesce(current_match.dispute_draft_result, jsonb_build_object(
    'scoreA', greatest(0, coalesce(current_result.score_a, 0)),
    'scoreB', greatest(0, coalesce(current_result.score_b, 0)),
    'playerStats', player_stats, 'statSubmissions', stat_submissions,
    'submittedBy', current_result.submitted_by, 'submittedAt', current_result.submitted_at
  ));

  if safe_decision = 'accepted' then
    requested_player_id := nullif(btrim(current_dispute.request_payload->>'playerId'), '');
    if requested_player_id is not null or nullif(btrim(current_dispute.request_payload->>'requestedPoints'), '') is not null then
      if requested_player_id is distinct from current_dispute.user_id
         or coalesce(current_dispute.request_payload->>'requestedPoints', '') !~ '^[0-9]+$' then
        raise exception 'match_dispute_request_invalid' using errcode = '22023';
      end if;
      requested_points := least(999, greatest(0, (current_dispute.request_payload->>'requestedPoints')::integer));
      select exists (
        select 1 from public.match_players player
        where player.match_id = safe_match_id and player.user_id = requested_player_id
          and player.side in ('teamA', 'teamB')
          and not ((case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array' then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id)
        union all
        select 1 where (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamA}') ? requested_player_id
          or (coalesce(current_match.played_player_ids, '{}'::jsonb) #> '{teamB}') ? requested_player_id
      ) into actual_player;
      if not actual_player then raise exception 'match_dispute_player_not_recordable' using errcode = '23514'; end if;

      player_stats := coalesce(working_draft->'playerStats', '{}'::jsonb);
      actor_stats := coalesce(player_stats->requested_player_id, '{}'::jsonb);
      player_stats := jsonb_set(player_stats, array[requested_player_id], jsonb_set(actor_stats, '{points}', to_jsonb(requested_points), true), true);

      with actual_players as (
        select player.user_id, player.side from public.match_players player
        where player.match_id = safe_match_id and player.side in ('teamA', 'teamB')
          and not ((case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array' then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id)
        union
        select value, 'teamA' from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end)
        union
        select value, 'teamB' from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end)
      )
      select
        coalesce(sum(coalesce((player_stats->player.user_id->>'points')::integer, 0)) filter (where player.side = 'teamA'), 0)::integer,
        coalesce(sum(coalesce((player_stats->player.user_id->>'points')::integer, 0)) filter (where player.side = 'teamB'), 0)::integer
      into result_score_a, result_score_b from actual_players player;
      working_draft := jsonb_set(jsonb_set(jsonb_set(working_draft, '{playerStats}', player_stats, true), '{scoreA}', to_jsonb(result_score_a), true), '{scoreB}', to_jsonb(result_score_b), true)
        || jsonb_build_object('updatedAt', now_at);
    end if;
  end if;

  update public.match_disputes
  set status = safe_decision, resolved_at = now_at, resolved_by = safe_actor_id,
      resolution = case when safe_decision = 'accepted' then 'request_applied' else 'request_rejected' end
  where id = current_dispute.id;
  select count(*)::integer into open_count from public.match_disputes where match_id = safe_match_id and status = 'open';

  if open_count > 0 then
    update public.matches
    set dispute_draft_result = working_draft, dispute_draft_updated_at = now_at, updated_at = now_at
    where id = safe_match_id;
  else
    player_stats := coalesce(working_draft->'playerStats', '{}'::jsonb);
    with actual_players as (
      select player.user_id from public.match_players player
      where player.match_id = safe_match_id and player.side in ('teamA', 'teamB')
        and not ((case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array' then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id)
      union
      select value from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end)
      union
      select value from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end)
    )
    insert into public.player_match_stats (
      match_id, user_id, recorded_by, record_source, points, rebounds, assists, steals, blocks, fouls, updated_at
    )
    select safe_match_id, item.key, safe_actor_id, 'dispute_operator',
      coalesce((item.value->>'points')::integer, 0), coalesce((item.value->>'rebounds')::integer, 0),
      coalesce((item.value->>'assists')::integer, 0), coalesce((item.value->>'steals')::integer, 0),
      coalesce((item.value->>'blocks')::integer, 0), coalesce((item.value->>'fouls')::integer, 0), now_at
    from jsonb_each(player_stats) item join actual_players player on player.user_id = item.key
    on conflict (match_id, user_id) do update set
      recorded_by = excluded.recorded_by, record_source = excluded.record_source, points = excluded.points,
      rebounds = excluded.rebounds, assists = excluded.assists, steals = excluded.steals,
      blocks = excluded.blocks, fouls = excluded.fouls, updated_at = excluded.updated_at;

    result_score_a := greatest(0, coalesce((working_draft->>'scoreA')::integer, current_result.score_a, 0));
    result_score_b := greatest(0, coalesce((working_draft->>'scoreB')::integer, current_result.score_b, 0));
    insert into public.match_results (match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at)
    values (safe_match_id, safe_actor_id, result_score_a, result_score_b, coalesce(working_draft->'statSubmissions', stat_submissions), now_at)
    on conflict (match_id) do update set
      submitted_by = excluded.submitted_by, score_a = excluded.score_a, score_b = excluded.score_b,
      stat_submissions = excluded.stat_submissions, submitted_at = excluded.submitted_at;

    delete from public.match_approvals where match_id = safe_match_id;

    update public.matches
    set status = 'approval', score_a = result_score_a, score_b = result_score_b,
        dispute_draft_result = null, dispute_draft_updated_at = null,
        dispute_resolved_at = now_at, updated_at = now_at
    where id = safe_match_id;
  end if;

  decision_label := case when safe_decision = 'accepted' then '가결' else '부결' end;
  insert into public.notifications (
    id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
  ) values (
    'n_' || md5('dispute-decision' || current_dispute.id::text || safe_decision),
    current_dispute.user_id, current_dispute.user_id, '이의제기 ' || decision_label,
    current_match.title || ' 이의제기가 ' || decision_label || '됐습니다.',
    'match', 'match', safe_match_id,
    jsonb_build_object('matchId', safe_match_id, 'disputeId', current_dispute.id, 'decision', safe_decision), now_at, now_at
  ) on conflict (id) do nothing;

  if open_count = 0 then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, match_id, payload, created_at, updated_at
    )
    select 'n_' || md5('dispute-complete' || safe_match_id || recipient_id || now_at::text),
      recipient_id, recipient_id, '결과 재승인 필요',
      current_match.title || ' 이의제기 처리가 끝났습니다. 변경된 결과를 다시 승인해 주세요.',
      'orange', 'match', safe_match_id,
      jsonb_build_object('matchId', safe_match_id, 'action', 'approveMatch'), now_at, now_at
    from (
      select distinct recipient_id from (
        select current_match.created_by as recipient_id
        union all select current_match.referee_id
        union all select player.user_id from public.match_players player where player.match_id = safe_match_id
      ) recipients where nullif(btrim(recipient_id), '') is not null
    ) targets
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'action', 'resolveMatchDispute', 'matchId', safe_match_id,
    'disputeId', current_dispute.id, 'decision', safe_decision,
    'openCount', open_count, 'reapprovalRequired', open_count = 0,
    'sqlReducer', true, 'advisoryLocked', true
  );
end;
$$;

-- Legacy clients may still send the old bulk-reject action. Resolve only the
-- oldest queue item so one request can never close another participant's item.
create or replace function public.rankball_match_reject_dispute_action(
  p_actor_profile_id text,
  p_match_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  oldest_dispute_id text;
begin
  select dispute.id::text into oldest_dispute_id
  from public.match_disputes dispute
  where dispute.match_id = nullif(btrim(p_match_id), '') and dispute.status = 'open'
  order by dispute.created_at, dispute.id
  limit 1;
  if oldest_dispute_id is null then
    raise exception 'match_dispute_item_not_open' using errcode = 'P0002';
  end if;
  return public.rankball_match_resolve_dispute_action(
    p_actor_profile_id,
    p_match_id,
    oldest_dispute_id,
    'rejected'
  );
end;
$$;

-- Bulk draft acceptance is incompatible with parallel requests. New clients
-- must identify one queue item through rankball_match_resolve_dispute_action.
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
begin
  perform public.rankball_assert_match_actor_active(nullif(btrim(p_actor_profile_id), ''));
  if nullif(btrim(p_match_id), '') is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;
  perform jsonb_typeof(coalesce(p_result_draft, '{}'::jsonb));
  raise exception 'match_dispute_item_required' using errcode = '22023';
end;
$$;

revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_resolve_dispute_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_reject_dispute_action(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_resume_approval_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_resolve_dispute_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_reject_dispute_action(text, text) to service_role;
grant execute on function public.rankball_match_resume_approval_action(text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
