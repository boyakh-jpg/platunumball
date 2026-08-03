begin;

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
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_result jsonb := coalesce(p_result, '{}'::jsonb);
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  core_result jsonb;
  next_score_a integer;
  next_score_b integer;
  before_score_a integer;
  before_score_b integer;
  next_revision_a integer;
  next_revision_b integer;
  now_at timestamptz := clock_timestamp();
begin
  core_result := public.rankball_match_result_action_pre_referee_score_sync(
    safe_actor_id,
    safe_match_id,
    safe_result
  );

  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null
     or coalesce(current_match.rules->>'recordType', '') in ('match_record', 'personal_record')
     or safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    return core_result;
  end if;

  select
    coalesce(sum(coalesce(stat.points, 0)) filter (
      where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamA'
    ), 0)::integer,
    coalesce(sum(coalesce(stat.points, 0)) filter (
      where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamB'
    ), 0)::integer
  into next_score_a, next_score_b
  from public.player_match_stats stat
  join public.rankball_match_actual_player_ids(safe_match_id) actual
    on actual.player_id = stat.user_id
  where stat.match_id = safe_match_id;

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;
  if current_result.match_id is null then
    raise exception 'match_result_not_found' using errcode = 'P0002';
  end if;

  before_score_a := greatest(0, coalesce(current_result.score_a, 0));
  before_score_b := greatest(0, coalesce(current_result.score_b, 0));
  next_revision_a := coalesce(current_result.score_revision_a, 0)
    + case when next_score_a <> before_score_a then 1 else 0 end;
  next_revision_b := coalesce(current_result.score_revision_b, 0)
    + case when next_score_b <> before_score_b then 1 else 0 end;

  update public.match_results
  set
    submitted_by = safe_actor_id,
    score_a = next_score_a,
    score_b = next_score_b,
    score_revision_a = next_revision_a,
    score_revision_b = next_revision_b,
    score_submissions = coalesce(score_submissions, '{}'::jsonb)
      || case when next_score_a <> before_score_a then jsonb_build_object(
        'teamA', jsonb_build_object(
          'by', safe_actor_id,
          'score', next_score_a,
          'revision', next_revision_a,
          'scope', 'referee_points',
          'submittedAt', now_at
        )
      ) else '{}'::jsonb end
      || case when next_score_b <> before_score_b then jsonb_build_object(
        'teamB', jsonb_build_object(
          'by', safe_actor_id,
          'score', next_score_b,
          'revision', next_revision_b,
          'scope', 'referee_points',
          'submittedAt', now_at
        )
      ) else '{}'::jsonb end,
    submitted_at = now_at
  where match_id = safe_match_id;

  update public.matches
  set score_a = next_score_a,
      score_b = next_score_b,
      updated_at = now_at
  where id = safe_match_id;

  if next_score_a <> before_score_a then
    insert into public.match_score_events (
      match_id, side, actor_profile_id, event_type, requested_delta,
      score_before, score_after, score_revision, authority_scope, created_at
    ) values (
      safe_match_id, 'teamA', safe_actor_id, 'increment',
      next_score_a - before_score_a, before_score_a, next_score_a,
      next_revision_a, 'referee', now_at
    );
  end if;
  if next_score_b <> before_score_b then
    insert into public.match_score_events (
      match_id, side, actor_profile_id, event_type, requested_delta,
      score_before, score_after, score_revision, authority_scope, created_at
    ) values (
      safe_match_id, 'teamB', safe_actor_id, 'increment',
      next_score_b - before_score_b, before_score_b, next_score_b,
      next_revision_b, 'referee', now_at
    );
  end if;

  return coalesce(core_result, '{}'::jsonb) || jsonb_build_object(
    'scoreA', next_score_a,
    'scoreB', next_score_b,
    'scoreRevisionA', next_revision_a,
    'scoreRevisionB', next_revision_b,
    'scoreSynced', true,
    'scoreSource', 'referee_points'
  );
end;
$$;

revoke all on function public.rankball_match_result_action(text, text, jsonb)
from public, anon, authenticated;
grant execute on function public.rankball_match_result_action(text, text, jsonb)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
