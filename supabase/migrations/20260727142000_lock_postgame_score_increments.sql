-- General no-referee score buttons are live-only. Referees and initial match-record entry are explicit exceptions.
create or replace function public.rankball_match_score_increment_action(
  p_actor_profile_id text,
  p_match_id text,
  p_delta_a integer default 0,
  p_delta_b integer default 0,
  p_expected_revision_a integer default null,
  p_expected_revision_b integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  delta_a integer := coalesce(p_delta_a, 0);
  delta_b integer := coalesce(p_delta_b, 0);
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  recorder_a text;
  recorder_b text;
  can_score_a boolean := false;
  can_score_b boolean := false;
  authority_a text;
  authority_b text;
  before_a integer;
  before_b integer;
  after_a integer;
  after_b integer;
  next_revision_a integer;
  next_revision_b integer;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null
     or (delta_a = 0 and delta_b = 0)
     or abs(delta_a) > 3
     or abs(delta_b) > 3 then
    raise exception 'invalid_match_score_increment' using errcode = '22023';
  end if;
  if (delta_a <> 0 and p_expected_revision_a is null)
     or (delta_b <> 0 and p_expected_revision_b is null) then
    raise exception 'match_score_revision_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.started_at is null
     or current_match.confirmed_at is not null
     or not (
       (
         current_match.status = 'agreed'
         and current_match.ended_at is null
       )
       or (
         current_match.status in ('agreed', 'approval')
         and current_match.ended_at is not null
         and nullif(btrim(current_match.referee_id), '') is not null
         and safe_actor_id = nullif(btrim(current_match.referee_id), '')
         and public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id)
       )
       or (
         current_match.status = 'agreed'
         and current_match.ended_at is not null
         and coalesce(current_match.rules->>'recordType', '') = 'match_record'
         and coalesce(current_match.rules->>'recordSetupReady', 'false') = 'true'
         and safe_actor_id = nullif(btrim(current_match.created_by), '')
       )
     ) then
    raise exception 'match_score_update_locked' using errcode = '23514';
  end if;

  recorder_a := public.rankball_match_effective_recorder_id(safe_match_id, 'teamA');
  recorder_b := public.rankball_match_effective_recorder_id(safe_match_id, 'teamB');
  if (current_match.dual_score_recorder_side = 'teamA' and recorder_b is not null)
     or (current_match.dual_score_recorder_side = 'teamB' and recorder_a is not null) then
    update public.matches
    set dual_score_recorder_side = null,
        rules = coalesce(rules, '{}'::jsonb) - 'dualScoreRecorderSide',
        updated_at = now_at
    where id = safe_match_id;
    current_match.dual_score_recorder_side := null;
  end if;

  if nullif(btrim(current_match.referee_id), '') is not null then
    if safe_actor_id <> nullif(btrim(current_match.referee_id), '')
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_score_referee_required' using errcode = '42501';
    end if;
    can_score_a := true;
    can_score_b := true;
    authority_a := 'referee';
    authority_b := 'referee';
  elsif safe_actor_id = nullif(btrim(current_match.created_by), '') then
    can_score_a := true;
    can_score_b := true;
    authority_a := 'host';
    authority_b := 'host';
  else
    if current_match.status <> 'agreed' or current_match.ended_at is not null then
      raise exception 'match_score_recorder_not_live' using errcode = '42501';
    end if;

    can_score_a := safe_actor_id = recorder_a;
    can_score_b := safe_actor_id = recorder_b;
    authority_a := case when can_score_a then 'side_recorder' end;
    authority_b := case when can_score_b then 'side_recorder' end;
    if current_match.dual_score_recorder_side = 'teamA' and safe_actor_id = recorder_a then
      can_score_b := true;
      authority_a := 'dual_side_recorder';
      authority_b := 'dual_side_recorder';
    elsif current_match.dual_score_recorder_side = 'teamB' and safe_actor_id = recorder_b then
      can_score_a := true;
      authority_a := 'dual_side_recorder';
      authority_b := 'dual_side_recorder';
    end if;
  end if;

  if (delta_a <> 0 and not can_score_a) or (delta_b <> 0 and not can_score_b) then
    raise exception 'match_score_increment_permission_denied' using errcode = '42501';
  end if;

  insert into public.match_results (
    match_id,
    submitted_by,
    score_a,
    score_b,
    stat_submissions,
    score_revision_a,
    score_revision_b,
    score_submissions,
    submitted_at
  )
  values (
    safe_match_id,
    safe_actor_id,
    greatest(0, coalesce(current_match.score_a, 0)),
    greatest(0, coalesce(current_match.score_b, 0)),
    '{}'::jsonb,
    0,
    0,
    '{}'::jsonb,
    now_at
  )
  on conflict (match_id) do nothing;

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;

  before_a := greatest(0, coalesce(current_result.score_a, 0));
  before_b := greatest(0, coalesce(current_result.score_b, 0));
  after_a := before_a + delta_a;
  after_b := before_b + delta_b;
  if after_a < 0 or after_b < 0 or after_a > 999 or after_b > 999 then
    raise exception 'match_score_increment_out_of_range' using errcode = '22023';
  end if;
  if delta_a <> 0
     and p_expected_revision_a is not null
     and p_expected_revision_a <> current_result.score_revision_a then
    raise exception 'match_score_revision_stale' using errcode = '40001';
  end if;
  if delta_b <> 0
     and p_expected_revision_b is not null
     and p_expected_revision_b <> current_result.score_revision_b then
    raise exception 'match_score_revision_stale' using errcode = '40001';
  end if;

  next_revision_a := current_result.score_revision_a + case when delta_a <> 0 then 1 else 0 end;
  next_revision_b := current_result.score_revision_b + case when delta_b <> 0 then 1 else 0 end;

  update public.match_results
  set submitted_by = safe_actor_id,
      score_a = after_a,
      score_b = after_b,
      score_revision_a = next_revision_a,
      score_revision_b = next_revision_b,
      score_submissions =
        case when delta_a <> 0 then
          jsonb_set(
            coalesce(score_submissions, '{}'::jsonb),
            '{teamA}',
            jsonb_build_object(
              'by', safe_actor_id,
              'score', after_a,
              'revision', next_revision_a,
              'scope', authority_a,
              'submittedAt', now_at
            ),
            true
          )
        else coalesce(score_submissions, '{}'::jsonb) end
        ||
        case when delta_b <> 0 then
          jsonb_build_object(
            'teamB',
            jsonb_build_object(
              'by', safe_actor_id,
              'score', after_b,
              'revision', next_revision_b,
              'scope', authority_b,
              'submittedAt', now_at
            )
          )
        else '{}'::jsonb end,
      submitted_at = now_at
  where match_id = safe_match_id;

  update public.matches
  set score_a = after_a,
      score_b = after_b,
      updated_at = now_at
  where id = safe_match_id;

  if delta_a <> 0 then
    insert into public.match_score_events (
      match_id, side, actor_profile_id, event_type, requested_delta,
      score_before, score_after, score_revision, authority_scope, created_at
    ) values (
      safe_match_id, 'teamA', safe_actor_id, 'increment', delta_a,
      before_a, after_a, next_revision_a, authority_a, now_at
    );
  end if;
  if delta_b <> 0 then
    insert into public.match_score_events (
      match_id, side, actor_profile_id, event_type, requested_delta,
      score_before, score_after, score_revision, authority_scope, created_at
    ) values (
      safe_match_id, 'teamB', safe_actor_id, 'increment', delta_b,
      before_b, after_b, next_revision_b, authority_b, now_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', 'incrementMatchScore',
    'matchId', safe_match_id,
    'scoreA', after_a,
    'scoreB', after_b,
    'scoreRevisionA', next_revision_a,
    'scoreRevisionB', next_revision_b,
    'scoreAtomic', true,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_score_increment_action(
  text, text, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.rankball_match_score_increment_action(
  text, text, integer, integer, integer, integer
) to service_role;
