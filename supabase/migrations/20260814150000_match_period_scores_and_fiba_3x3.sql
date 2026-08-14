begin;

alter table public.match_results
  add column if not exists period_scores jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.match_results'::regclass
      and conname = 'match_results_period_scores_check'
  ) then
    alter table public.match_results
      add constraint match_results_period_scores_check
      check (jsonb_typeof(period_scores) = 'array' and jsonb_array_length(period_scores) <= 5);
  end if;
end;
$$;

do $patch$
declare
  function_def text;
  old_columns constant text :=
    'match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at';
  new_columns constant text :=
    'match_id, submitted_by, score_a, score_b, period_scores, stat_submissions, submitted_at';
  old_select constant text :=
    'select match_id, submitted_by, score_a, score_b, stat_submissions, submitted_at';
  new_select constant text :=
    'select match_id, submitted_by, score_a, score_b, coalesce(period_scores, ''[]''::jsonb), stat_submissions, submitted_at';
  old_update constant text :=
    'score_b = excluded.score_b,' || chr(10) || '      stat_submissions = excluded.stat_submissions,';
  new_update constant text :=
    'score_b = excluded.score_b,' || chr(10) || '      period_scores = excluded.period_scores,' || chr(10) || '      stat_submissions = excluded.stat_submissions,';
begin
  if to_regprocedure('public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)') is null then
    raise exception 'rankball_persist_match_snapshot_missing' using errcode = '42883';
  end if;
  function_def := pg_get_functiondef(
    to_regprocedure('public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)')
  );
  function_def := replace(function_def, chr(13) || chr(10), chr(10));
  if strpos(function_def, new_columns) = 0 then
    if strpos(function_def, old_columns) = 0 or strpos(function_def, old_select) = 0 or strpos(function_def, old_update) = 0 then
      raise exception 'rankball_persist_match_snapshot_shape_changed' using errcode = '23514';
    end if;
    function_def := replace(function_def, old_select, new_select);
    function_def := replace(function_def, old_columns, new_columns);
    function_def := replace(function_def, old_update, new_update);
    execute function_def;
  end if;
end;
$patch$;

do $migration$
begin
  if to_regprocedure('public.rankball_match_result_action_pre_period_scores(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_result_action(text,text,jsonb)') is null then
      raise exception 'rankball_match_result_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_result_action(text, text, jsonb)
      rename to rankball_match_result_action_pre_period_scores;
  end if;
end;
$migration$;

create or replace function public.rankball_match_result_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_result jsonb := coalesce(p_result, '{}'::jsonb);
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  core_result jsonb;
  period_item jsonb;
  normalized_period_scores jsonb := '[]'::jsonb;
  allowed_labels text[];
  period_index integer := 0;
  score_a_sum integer := 0;
  score_b_sum integer := 0;
begin
  if jsonb_typeof(safe_result) <> 'object' then
    raise exception 'invalid_match_result' using errcode = '22023';
  end if;

  core_result := public.rankball_match_result_action_pre_period_scores(
    p_actor_profile_id,
    safe_match_id,
    safe_result - 'periodScores'
  );

  if not (safe_result ? 'periodScores') then
    return core_result;
  end if;
  if jsonb_typeof(safe_result->'periodScores') <> 'array' then
    raise exception 'invalid_match_period_scores' using errcode = '22023';
  end if;

  select * into current_match from public.matches where id = safe_match_id for update;
  select * into current_result from public.match_results where match_id = safe_match_id for update;
  if current_match.id is null or current_result.match_id is null then
    raise exception 'match_result_not_found' using errcode = 'P0002';
  end if;

  allowed_labels := case coalesce(current_match.rules->>'periodCount', '')
    when '2' then array['1H', '2H', 'OT']
    when '1' then array['REG', 'OT']
    else array['1Q', '2Q', '3Q', '4Q', 'OT']
  end;
  if jsonb_array_length(safe_result->'periodScores') > cardinality(allowed_labels) then
    raise exception 'invalid_match_period_scores' using errcode = '22023';
  end if;

  for period_item in select value from jsonb_array_elements(safe_result->'periodScores') loop
    period_index := period_index + 1;
    if jsonb_typeof(period_item) <> 'object'
       or nullif(btrim(period_item->>'label'), '') is distinct from allowed_labels[period_index]
       or coalesce(period_item->>'scoreA', '') !~ '^[0-9]{1,3}$'
       or coalesce(period_item->>'scoreB', '') !~ '^[0-9]{1,3}$' then
      raise exception 'invalid_match_period_scores' using errcode = '22023';
    end if;
    score_a_sum := score_a_sum + (period_item->>'scoreA')::integer;
    score_b_sum := score_b_sum + (period_item->>'scoreB')::integer;
    normalized_period_scores := normalized_period_scores || jsonb_build_array(jsonb_build_object(
      'label', allowed_labels[period_index],
      'scoreA', (period_item->>'scoreA')::integer,
      'scoreB', (period_item->>'scoreB')::integer
    ));
  end loop;

  if period_index > 0 and (
    score_a_sum <> current_result.score_a or score_b_sum <> current_result.score_b
  ) then
    raise exception 'match_period_score_total_mismatch' using errcode = '23514';
  end if;

  update public.match_results
  set period_scores = normalized_period_scores
  where match_id = safe_match_id;

  return coalesce(core_result, '{}'::jsonb) || jsonb_build_object(
    'periodScores', normalized_period_scores
  );
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_match_resolve_dispute_action_pre_period_scores(text,text,text,text,text)') is null then
    if to_regprocedure('public.rankball_match_resolve_dispute_action(text,text,text,text,text)') is null then
      raise exception 'rankball_match_resolve_dispute_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_resolve_dispute_action(text, text, text, text, text)
      rename to rankball_match_resolve_dispute_action_pre_period_scores;
  end if;
end;
$migration$;

create or replace function public.rankball_match_resolve_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_id text,
  p_decision text,
  p_resolution_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  before_score_a integer;
  before_score_b integer;
  after_score_a integer;
  after_score_b integer;
  core_result jsonb;
  cleared boolean := false;
begin
  select score_a, score_b into before_score_a, before_score_b
  from public.match_results where match_id = safe_match_id;

  core_result := public.rankball_match_resolve_dispute_action_pre_period_scores(
    p_actor_profile_id,
    safe_match_id,
    p_dispute_id,
    p_decision,
    p_resolution_reason
  );

  select score_a, score_b into after_score_a, after_score_b
  from public.match_results where match_id = safe_match_id;
  if lower(coalesce(p_decision, '')) = 'accepted'
     and (after_score_a is distinct from before_score_a or after_score_b is distinct from before_score_b) then
    update public.match_results set period_scores = '[]'::jsonb where match_id = safe_match_id;
    cleared := true;
  end if;

  return coalesce(core_result, '{}'::jsonb) || jsonb_build_object('periodScoresCleared', cleared);
end;
$$;

revoke all on function public.rankball_match_result_action(text, text, jsonb)
from public, anon, authenticated;
revoke all on function public.rankball_match_result_action_pre_period_scores(text, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.rankball_match_result_action(text, text, jsonb)
to service_role;

revoke all on function public.rankball_match_resolve_dispute_action(text, text, text, text, text)
from public, anon, authenticated;
revoke all on function public.rankball_match_resolve_dispute_action_pre_period_scores(text, text, text, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.rankball_match_resolve_dispute_action(text, text, text, text, text)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
