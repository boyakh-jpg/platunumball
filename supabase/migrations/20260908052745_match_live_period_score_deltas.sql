begin;

-- A missing historical split must never be guessed from the latest total.
create or replace function public.rankball_match_period_scores_after_delta(
  p_period_scores jsonb,
  p_rules jsonb,
  p_clock jsonb,
  p_before_a integer,
  p_before_b integer,
  p_after_a integer,
  p_after_b integer
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  labels text[];
  period_count integer;
  period_index integer;
  overtime_count integer;
  target_index integer;
  item jsonb;
  output jsonb := '[]'::jsonb;
  score_a bigint;
  score_b bigint;
  sum_a integer := 0;
  sum_b integer := 0;
  item_index integer := 0;
begin
  if p_before_a = p_after_a and p_before_b = p_after_b then
    return coalesce(p_period_scores, '[]'::jsonb);
  end if;
  if p_before_a is null or p_before_b is null or p_after_a is null or p_after_b is null
     or least(p_before_a, p_before_b, p_after_a, p_after_b) < 0
     or coalesce(p_rules->>'periodCount', '') not in ('1', '2', '4')
     or coalesce(p_clock->>'status', '') not in ('running', 'paused', 'break')
     or coalesce(p_clock->>'currentPeriod', '') !~ '^[1-4]$'
     or coalesce(p_clock->>'overtimeCount', '') !~ '^[0-9]{1,6}$'
     or jsonb_typeof(p_period_scores) is distinct from 'array' then
    return '[]'::jsonb;
  end if;
  period_count := (p_rules->>'periodCount')::integer;
  period_index := (p_clock->>'currentPeriod')::integer;
  overtime_count := (p_clock->>'overtimeCount')::integer;
  labels := case period_count
    when 4 then array['1Q', '2Q', '3Q', '4Q', 'OT']
    when 2 then array['1H', '2H', 'OT']
    else array['REG', 'OT']
  end;
  if period_index > period_count
     or (overtime_count > 0 and period_index <> period_count) then
    return '[]'::jsonb;
  end if;
  target_index := case when overtime_count > 0 then period_count + 1 else period_index end;
  if jsonb_array_length(p_period_scores) > target_index then
    return '[]'::jsonb;
  end if;
  for item in select value from jsonb_array_elements(p_period_scores) loop
    item_index := item_index + 1;
    if upper(coalesce(item->>'label', '')) <> labels[item_index]
       or coalesce(item->>'scoreA', '') !~ '^[0-9]{1,3}$'
       or coalesce(item->>'scoreB', '') !~ '^[0-9]{1,3}$' then
      return '[]'::jsonb;
    end if;
    sum_a := sum_a + (item->>'scoreA')::integer;
    sum_b := sum_b + (item->>'scoreB')::integer;
  end loop;
  if sum_a <> p_before_a or sum_b <> p_before_b then
    return '[]'::jsonb;
  end if;
  for item_index in 1..target_index loop
    item := p_period_scores->(item_index - 1);
    score_a := coalesce((item->>'scoreA')::integer, 0);
    score_b := coalesce((item->>'scoreB')::integer, 0);
    if item_index = target_index then
      score_a := score_a + p_after_a::bigint - p_before_a;
      score_b := score_b + p_after_b::bigint - p_before_b;
    end if;
    if score_a not between 0 and 999 or score_b not between 0 and 999 then
      return '[]'::jsonb;
    end if;
    output := output || jsonb_build_array(jsonb_build_object(
      'label', labels[item_index], 'scoreA', score_a, 'scoreB', score_b
    ));
  end loop;
  return output;
end;
$$;

revoke all on function public.rankball_match_period_scores_after_delta(jsonb, jsonb, jsonb, integer, integer, integer, integer)
from public, anon, authenticated, service_role;

-- Keep the existing authority/revision/audit owners and add the split to their
-- score UPDATE, so the stale-split trigger sees the new total and split together.
do $patch$
declare
  function_sql text;
  target_function regprocedure;
  anchor text;
  replacement text;
begin
  target_function := 'public.rankball_match_score_increment_pre_live_authority(text,text,integer,integer,integer,integer)'::regprocedure;
  function_sql := pg_get_functiondef(target_function);
  anchor := E'      score_b = after_b,\n      score_revision_a = next_revision_a,';
  replacement := $replacement$      score_b = after_b,
      period_scores = case
        when after_a = before_a and after_b = before_b then current_result.period_scores
        when current_match.ended_at is null then coalesce((
          select public.rankball_match_period_scores_after_delta(
            current_result.period_scores, current_match.rules,
            jsonb_build_object('currentPeriod', session.current_period,
              'overtimeCount', session.overtime_count, 'status', session.status),
            before_a, before_b, after_a, after_b
          ) from public.match_clock_sessions session where session.match_id = safe_match_id
        ), '[]'::jsonb)
        else '[]'::jsonb
      end,
      score_revision_a = next_revision_a,$replacement$;
  if position(anchor in function_sql) = 0
     or position('rankball_match_period_scores_after_delta' in function_sql) > 0 then
    raise exception 'match_live_period_score_increment_owner_mismatch';
  end if;
  execute replace(function_sql, anchor, replacement);

  target_function := 'public.rankball_match_result_action_pre_period_scores(text,text,jsonb)'::regprocedure;
  function_sql := pg_get_functiondef(target_function);
  anchor := E'    score_b = next_score_b,\n    score_revision_a = next_revision_a,';
  replacement := $replacement$    score_b = next_score_b,
    period_scores = case
      when next_score_a = before_score_a and next_score_b = before_score_b then current_result.period_scores
      when current_match.ended_at is null then coalesce((
        select public.rankball_match_period_scores_after_delta(
          current_result.period_scores, current_match.rules,
          jsonb_build_object('currentPeriod', session.current_period,
            'overtimeCount', session.overtime_count, 'status', session.status),
          before_score_a, before_score_b, next_score_a, next_score_b
        ) from public.match_clock_sessions session where session.match_id = safe_match_id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end,
    score_revision_a = next_revision_a,$replacement$;
  if position(anchor in function_sql) = 0
     or position('rankball_match_period_scores_after_delta' in function_sql) > 0
     or position('from public.player_match_stats stat' in function_sql) = 0 then
    raise exception 'match_live_period_referee_points_owner_mismatch';
  end if;
  execute replace(function_sql, anchor, replacement);

  target_function := 'public.rankball_match_result_action_pre_explicit_final_submission(text,text,jsonb)'::regprocedure;
  function_sql := pg_get_functiondef(target_function);
  anchor := $anchor$  if jsonb_typeof(safe_result->'periodScores') <> 'array' then$anchor$;
  replacement := $replacement$  -- During play, only the score owner may derive the split from the clock.
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.ended_at is null
     and coalesce(current_match.rules->>'recordType', 'standard') not in ('match_record', 'personal_record', 'solo') then
    return coalesce(core_result, '{}'::jsonb) || jsonb_build_object(
      'periodScores', coalesce((select period_scores from public.match_results where match_id = safe_match_id), '[]'::jsonb)
    );
  end if;
  if jsonb_typeof(safe_result->'periodScores') <> 'array' then$replacement$;
  if position(anchor in function_sql) = 0
     or position('rankball_match_result_action_pre_period_scores' in function_sql) = 0 then
    raise exception 'match_live_period_submission_owner_mismatch';
  end if;
  execute replace(function_sql, anchor, replacement);
end;
$patch$;

-- Transactional smoke checks: an unexpected helper result aborts the migration.
do $$
begin
  if public.rankball_match_period_scores_after_delta(
    '[]', '{"periodCount":4}', '{"status":"running","currentPeriod":1,"overtimeCount":0}', 0, 0, 2, 0
  ) <> '[{"label":"1Q","scoreA":2,"scoreB":0}]'::jsonb then
    raise exception 'match_live_period_initial_score_failed';
  end if;
  if public.rankball_match_period_scores_after_delta(
    '[]', '{"periodCount":4}', '{"status":"running","currentPeriod":2,"overtimeCount":0}', 5, 0, 7, 0
  ) <> '[]'::jsonb then
    raise exception 'match_live_period_legacy_deferral_failed';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
commit;
