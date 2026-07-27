begin;

alter table public.matches
  add column if not exists dual_score_recorder_side text;

alter table public.matches
  drop constraint if exists matches_dual_score_recorder_side_check;
alter table public.matches
  add constraint matches_dual_score_recorder_side_check
  check (dual_score_recorder_side is null or dual_score_recorder_side in ('teamA', 'teamB')) not valid;
alter table public.matches
  validate constraint matches_dual_score_recorder_side_check;

alter table public.match_results
  add column if not exists score_revision_a integer not null default 0;
alter table public.match_results
  add column if not exists score_revision_b integer not null default 0;
alter table public.match_results
  add column if not exists score_submissions jsonb not null default '{}'::jsonb;

alter table public.match_results
  drop constraint if exists match_results_score_revision_nonnegative_check;
alter table public.match_results
  add constraint match_results_score_revision_nonnegative_check
  check (score_revision_a >= 0 and score_revision_b >= 0) not valid;
alter table public.match_results
  validate constraint match_results_score_revision_nonnegative_check;

create table if not exists public.match_score_events (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  side text not null check (side in ('teamA', 'teamB')),
  actor_profile_id text not null,
  event_type text not null check (event_type in ('increment', 'dispute_accept')),
  requested_delta integer not null,
  score_before integer not null check (score_before >= 0),
  score_after integer not null check (score_after >= 0),
  score_revision integer not null check (score_revision > 0),
  authority_scope text not null check (authority_scope in ('host', 'referee', 'side_recorder', 'dual_side_recorder')),
  dispute_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists match_score_events_match_created_idx
  on public.match_score_events (match_id, created_at, id);

create table if not exists public.match_recorder_takeover_requests (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  side text not null check (side in ('teamA', 'teamB')),
  requested_by text not null,
  expected_recorder_id text not null,
  status text not null default 'open'
    check (status in ('open', 'approved', 'rejected', 'cancelled', 'stale')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution text
);

create unique index if not exists match_recorder_takeover_one_open_side_idx
  on public.match_recorder_takeover_requests (match_id, side)
  where status = 'open';
create index if not exists match_recorder_takeover_match_created_idx
  on public.match_recorder_takeover_requests (match_id, created_at desc, id);

create or replace function public.rankball_guard_no_referee_player_match_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_referee_id text;
begin
  select nullif(btrim(match.referee_id), '')
  into assigned_referee_id
  from public.matches match
  where match.id = new.match_id;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if assigned_referee_id is null then
    raise exception 'no_referee_personal_stats_forbidden' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_no_referee_player_match_stats_guard
  on public.player_match_stats;
create trigger rankball_no_referee_player_match_stats_guard
before insert or update on public.player_match_stats
for each row execute function public.rankball_guard_no_referee_player_match_stats();

create or replace function public.rankball_match_scorekeeper_scope_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  current_match public.matches%rowtype;
  recorder_a text;
  recorder_b text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null or (safe_side is not null and safe_side not in ('teamA', 'teamB')) then
    raise exception 'invalid_match_scorekeeper_scope_request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_host_required' using errcode = '42501';
  end if;
  if nullif(btrim(current_match.referee_id), '') is not null
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or current_match.status not in ('contract', 'agreed') then
    raise exception 'match_scorekeeper_scope_locked' using errcode = '23514';
  end if;

  recorder_a := public.rankball_match_effective_recorder_id(safe_match_id, 'teamA');
  recorder_b := public.rankball_match_effective_recorder_id(safe_match_id, 'teamB');
  if safe_side is not null and ((recorder_a is null) = (recorder_b is null)
     or (safe_side = 'teamA' and recorder_a is null)
     or (safe_side = 'teamB' and recorder_b is null)) then
    raise exception 'match_single_recorder_side_required' using errcode = '23514';
  end if;

  update public.matches
  set dual_score_recorder_side = safe_side,
      rules = case when safe_side is null
        then coalesce(rules, '{}'::jsonb) - 'dualScoreRecorderSide'
        else jsonb_set(
          coalesce(rules, '{}'::jsonb),
          '{dualScoreRecorderSide}',
          to_jsonb(safe_side),
          true
        ) end,
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'setMatchDualScoreRecorderSide',
    'matchId', safe_match_id,
    'sideName', safe_side,
    'recorderId', case safe_side when 'teamA' then recorder_a when 'teamB' then recorder_b end,
    'roleInherited', true,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

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
  if current_match.status not in ('agreed', 'approval', 'disputed')
     or current_match.started_at is null
     or current_match.confirmed_at is not null then
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

create or replace function public.rankball_match_recorder_takeover_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_side text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_request_id uuid;
  current_match public.matches%rowtype;
  current_request public.match_recorder_takeover_requests%rowtype;
  current_recorder_id text;
  current_recorders jsonb := '{}'::jsonb;
  next_recorders jsonb := '{}'::jsonb;
  actor_is_side_reserve boolean := false;
  request_id uuid;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_action is null
     or safe_action not in ('request', 'approve', 'reject', 'cancel')
     or safe_match_id is null
     or safe_side is null
     or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_recorder_takeover_request' using errcode = '22023';
  end if;
  if safe_action <> 'request' then
    begin
      safe_request_id := nullif(btrim(p_request_id), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid_match_recorder_takeover_request_id' using errcode = '22023';
    end;
    if safe_request_id is null then
      raise exception 'match_recorder_takeover_request_id_required' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if nullif(btrim(current_match.referee_id), '') is not null
     or current_match.status <> 'agreed'
     or current_match.started_at is null
     or current_match.ended_at is not null then
    raise exception 'match_recorder_takeover_locked' using errcode = '23514';
  end if;

  current_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);
  actor_is_side_reserve := (
    case when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
      then current_match.reserve_players->safe_side else '[]'::jsonb end
  ) ? safe_actor_id;
  if safe_action = 'request' then
    if current_recorder_id is null
       or not actor_is_side_reserve
       or safe_actor_id = current_recorder_id then
      raise exception 'match_recorder_takeover_request_permission_denied' using errcode = '42501';
    end if;

    update public.match_recorder_takeover_requests
    set status = 'stale',
        resolved_at = now_at,
        resolution = 'recorder_changed'
    where match_id = safe_match_id
      and side = safe_side
      and status = 'open'
      and expected_recorder_id is distinct from current_recorder_id;
    if exists (
      select 1 from public.match_recorder_takeover_requests request
      where request.match_id = safe_match_id
        and request.side = safe_side
        and request.status = 'open'
    ) then
      raise exception 'match_recorder_takeover_request_open' using errcode = '23505';
    end if;


    insert into public.match_recorder_takeover_requests (
      match_id, side, requested_by, expected_recorder_id, status, created_at
    )
    values (
      safe_match_id, safe_side, safe_actor_id, current_recorder_id, 'open', now_at
    )
    returning id into request_id;

    return jsonb_build_object(
      'ok', true,
      'action', 'requestMatchRecorderTakeover',
      'matchId', safe_match_id,
      'sideName', safe_side,
      'requestId', request_id,
      'expectedRecorderId', current_recorder_id,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  select * into current_request
  from public.match_recorder_takeover_requests request
  where request.id = safe_request_id
    and request.match_id = safe_match_id
    and request.side = safe_side
  for update;
  if current_request.id is null or current_request.status <> 'open' then
    raise exception 'match_recorder_takeover_request_not_open' using errcode = 'P0002';
  end if;

  if safe_action = 'cancel' then
    if safe_actor_id <> current_request.requested_by then
      raise exception 'match_recorder_takeover_cancel_permission_denied' using errcode = '42501';
    end if;
    update public.match_recorder_takeover_requests
    set status = 'cancelled', resolved_at = now_at, resolved_by = safe_actor_id,
        resolution = 'requester_cancelled'
    where id = current_request.id and status = 'open';
    return jsonb_build_object('ok', true, 'action', 'cancelMatchRecorderTakeover', 'requestId', current_request.id);
  end if;

  if safe_actor_id <> current_recorder_id
     and safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
    raise exception 'match_recorder_takeover_approval_permission_denied' using errcode = '42501';
  end if;
  if safe_action = 'reject' then
    update public.match_recorder_takeover_requests
    set status = 'rejected', resolved_at = now_at, resolved_by = safe_actor_id,
        resolution = 'rejected'
    where id = current_request.id and status = 'open';
    return jsonb_build_object('ok', true, 'action', 'rejectMatchRecorderTakeover', 'requestId', current_request.id);
  end if;

  if current_request.expected_recorder_id is distinct from current_recorder_id then
    raise exception 'match_recorder_takeover_stale' using errcode = '40001';
  end if;
  if not (
    case when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
      then current_match.reserve_players->safe_side else '[]'::jsonb end
  ) ? current_request.requested_by then
    raise exception 'match_recorder_takeover_requester_not_reserve' using errcode = '23514';
  end if;

  update public.match_recorder_takeover_requests
  set status = 'approved',
      resolved_at = now_at,
      resolved_by = safe_actor_id,
      resolution = 'approved'
  where id = current_request.id
    and status = 'open'
    and expected_recorder_id = current_recorder_id
  returning id into request_id;
  if request_id is null then
    raise exception 'match_recorder_takeover_stale' using errcode = '40001';
  end if;

  current_recorders := case
    when jsonb_typeof(current_match.stat_recorders) = 'object' then current_match.stat_recorders
    when jsonb_typeof(current_match.rules->'statRecorders') = 'object' then current_match.rules->'statRecorders'
    else '{}'::jsonb
  end;
  next_recorders := jsonb_set(
    current_recorders,
    array[safe_side],
    to_jsonb(current_request.requested_by),
    true
  );
  update public.matches
  set stat_recorders = next_recorders,
      rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{statRecorders}', next_recorders, true),
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'approveMatchRecorderTakeover',
    'matchId', safe_match_id,
    'sideName', safe_side,
    'requestId', current_request.id,
    'previousRecorderId', current_recorder_id,
    'recorderId', current_request.requested_by,
    'requestCas', true,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_roster_transition_action_pre_score_policy(text,text,text,text,text,text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_roster_transition_action(text,text,text,text,text,text,text,text)'
    ) is null then
      raise exception 'rankball_match_roster_transition_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_roster_transition_action(
      text, text, text, text, text, text, text, text
    ) rename to rankball_match_roster_transition_action_pre_score_policy;
  end if;
end;
$migration$;

create or replace function public.rankball_match_roster_transition_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_side text,
  p_active_player_id text default null,
  p_reserve_player_id text default null,
  p_next_recorder_id text default null,
  p_reason text default 'operator'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_active_player_id text := nullif(btrim(p_active_player_id), '');
  safe_reserve_player_id text := nullif(btrim(p_reserve_player_id), '');
  safe_reason text := coalesce(nullif(btrim(p_reason), ''), 'operator');
  current_match public.matches%rowtype;
  assigned_referee_id text;
  current_recorder_id text;
  internal_actor_id text;
  internal_reason text;
  final_reason text;
  actor_is_side_reserve boolean := false;
  late_eligible boolean := false;
  result jsonb;
  event_id uuid;
  next_recorder_id text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_action is null
     or safe_action <> 'substituteMatchPlayer'
     or safe_match_id is null
     or safe_side not in ('teamA', 'teamB')
     or safe_active_player_id is null
     or safe_reserve_player_id is null
     or safe_reason not in ('self', 'late', 'injury', 'ejection', 'operator') then
    if safe_action = 'handoffMatchRecorder' then
      raise exception 'match_recorder_takeover_request_required' using errcode = '42501';
    end if;
    raise exception 'invalid_match_roster_transition_request' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.status <> 'agreed'
     or current_match.started_at is null
     or current_match.ended_at is not null then
    raise exception 'match_substitution_not_live' using errcode = '23514';
  end if;

  assigned_referee_id := nullif(btrim(current_match.referee_id), '');
  current_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);
  actor_is_side_reserve := (
    case when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
      then current_match.reserve_players->safe_side else '[]'::jsonb end
  ) ? safe_actor_id
    and safe_actor_id = safe_reserve_player_id;

  if safe_reason = 'self' then
    if not actor_is_side_reserve then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    select exists (
      select 1
      from public.match_attendance_entries entry
      where entry.match_id = safe_match_id
        and entry.player_id = safe_reserve_player_id
        and entry.status = 'late'
        and entry.checked_in_at >= current_match.started_at
    ) into late_eligible;
    final_reason := case when late_eligible then 'late' else 'self' end;
    internal_reason := case when late_eligible then 'late' else 'operator' end;
    internal_actor_id := coalesce(
      assigned_referee_id,
      current_recorder_id,
      nullif(btrim(current_match.created_by), '')
    );
    if internal_actor_id is null then
      raise exception 'match_substitution_operator_missing' using errcode = '42501';
    end if;
  else
    if assigned_referee_id is null
       or safe_actor_id <> assigned_referee_id
       or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    final_reason := safe_reason;
    internal_reason := case when safe_reason = 'injury' then 'operator' else safe_reason end;
    internal_actor_id := safe_actor_id;
  end if;

  result := public.rankball_match_roster_transition_action_pre_score_policy(
    internal_actor_id,
    'substituteMatchPlayer',
    safe_match_id,
    safe_side,
    safe_active_player_id,
    safe_reserve_player_id,
    null,
    internal_reason
  );
  if coalesce((result->>'fallback')::boolean, false)
     or not coalesce((result->>'ok')::boolean, false) then
    return result;
  end if;

  begin
    event_id := nullif(result->>'eventId', '')::uuid;
  exception when invalid_text_representation then
    event_id := null;
  end;
  if event_id is not null then
    update public.match_substitution_events
    set confirmed_by = safe_actor_id,
        reason = final_reason
    where id = event_id
      and match_id = safe_match_id;
  end if;

  next_recorder_id := public.rankball_match_effective_recorder_id(safe_match_id, safe_side);
  update public.match_recorder_takeover_requests
  set status = 'stale',
      resolved_at = clock_timestamp(),
      resolution = 'recorder_changed_by_substitution'
  where match_id = safe_match_id
    and side = safe_side
    and status = 'open'
    and expected_recorder_id is distinct from next_recorder_id;

  return result || jsonb_build_object(
    'actorProfileId', safe_actor_id,
    'reason', final_reason,
    'selfSubstitution', safe_reason = 'self',
    'refereeManaged', safe_reason <> 'self',
    'recorderInheritedByOutgoingActive',
      assigned_referee_id is null
      and current_recorder_id = safe_reserve_player_id
      and next_recorder_id = safe_active_player_id
  );
end;
$$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_result_action_pre_score_policy(text,text,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_result_action(text,text,jsonb)'
    ) is null then
      raise exception 'rankball_match_result_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_result_action(text, text, jsonb)
      rename to rankball_match_result_action_pre_score_policy;
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
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  assigned_referee_id text;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match_result_actor_or_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select nullif(btrim(referee_id), '')
  into assigned_referee_id
  from public.matches
  where id = safe_match_id
  for update;
  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if assigned_referee_id is null then
    if jsonb_typeof(coalesce(p_result->'playerStats', '{}'::jsonb)) = 'object'
       and coalesce(p_result->'playerStats', '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'no_referee_personal_stats_forbidden' using errcode = '42501';
    end if;
    raise exception 'match_score_increment_required' using errcode = '42501';
  end if;
  if safe_actor_id <> assigned_referee_id
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_result_referee_required' using errcode = '42501';
  end if;

  return public.rankball_match_result_action_pre_score_policy(
    safe_actor_id,
    safe_match_id,
    coalesce(p_result, '{}'::jsonb)
  );
end;
$$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_dispute_action_pre_score_policy(text,text,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_dispute_action(text,text,jsonb)'
    ) is null then
      raise exception 'rankball_match_dispute_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_dispute_action(text, text, jsonb)
      rename to rankball_match_dispute_action_pre_score_policy;
  end if;
end;
$migration$;

create or replace function public.rankball_match_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_request jsonb default '{}'::jsonb
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
  requested_side text;
  requested_score integer;
  current_score integer;
  base_revision integer;
  dispute_reason text;
  dispute_id uuid := gen_random_uuid();
  actor_allowed boolean := false;
  dispute_minutes integer;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if nullif(btrim(current_match.referee_id), '') is not null then
    return public.rankball_match_dispute_action_pre_score_policy(
      safe_actor_id,
      safe_match_id,
      coalesce(p_dispute_request, '{}'::jsonb)
    );
  end if;

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;
  if current_result.match_id is null then
    raise exception 'match_result_missing' using errcode = '23514';
  end if;
  if not (
    current_match.status in ('approval', 'disputed')
    or (current_match.status = 'agreed' and current_match.ended_at is not null)
  ) then
    raise exception 'match_not_disputable' using errcode = '23514';
  end if;
  dispute_minutes := public.rankball_normalize_dispute_minutes(current_match.dispute_minutes);
  if current_match.ended_at is null
     or now_at > current_match.ended_at + make_interval(mins => dispute_minutes) then
    raise exception 'match_dispute_window_closed' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.match_players player
    where player.match_id = safe_match_id
      and player.user_id = safe_actor_id
      and player.side in ('teamA', 'teamB')
      and not (
        case when jsonb_typeof(current_match.reserve_players->player.side) = 'array'
          then current_match.reserve_players->player.side else '[]'::jsonb end
      ) ? safe_actor_id
    union all
    select 1 where (
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) ? safe_actor_id
    union all
    select 1 where (
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) ? safe_actor_id
  ) into actor_allowed;
  if not actor_allowed then
    raise exception 'match_dispute_permission_denied' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id
      and dispute.user_id = safe_actor_id
      and dispute.status = 'open'
  ) then
    raise exception 'match_dispute_already_open' using errcode = '23505';
  end if;

  if jsonb_typeof(coalesce(p_dispute_request, '{}'::jsonb)) <> 'object' then
    raise exception 'match_score_dispute_request_invalid' using errcode = '22023';
  end if;
  requested_side := nullif(btrim(p_dispute_request->>'side'), '');
  if requested_side not in ('teamA', 'teamB')
     or coalesce(p_dispute_request->>'requestedScore', '') !~ '^[0-9]+$' then
    raise exception 'match_score_dispute_request_invalid' using errcode = '22023';
  end if;
  requested_score := (p_dispute_request->>'requestedScore')::integer;
  if requested_score < 0 or requested_score > 999 then
    raise exception 'match_score_dispute_request_invalid' using errcode = '22023';
  end if;
  current_score := case when requested_side = 'teamA'
    then current_result.score_a else current_result.score_b end;
  base_revision := case when requested_side = 'teamA'
    then current_result.score_revision_a else current_result.score_revision_b end;
  if requested_score = current_score then
    raise exception 'match_score_dispute_no_change' using errcode = '22023';
  end if;
  dispute_reason := left(coalesce(nullif(btrim(p_dispute_request->>'reason'), ''), 'score correction request'), 500);

  insert into public.match_disputes (
    id, match_id, user_id, reason, request_payload, status, created_at
  ) values (
    dispute_id,
    safe_match_id,
    safe_actor_id,
    dispute_reason,
    jsonb_build_object(
      'kind', 'team_score',
      'side', requested_side,
      'requestedScore', requested_score,
      'currentScore', current_score,
      'baseRevision', base_revision,
      'reason', dispute_reason
    ),
    'open',
    now_at
  );

  update public.matches
  set status = 'disputed',
      dispute_draft_result = coalesce(
        dispute_draft_result,
        jsonb_build_object(
          'scoreA', current_result.score_a,
          'scoreB', current_result.score_b,
          'playerStats', '{}'::jsonb,
          'statSubmissions', '{}'::jsonb,
          'submittedBy', current_result.submitted_by,
          'submittedAt', current_result.submitted_at,
          'updatedAt', now_at
        )
      ),
      dispute_draft_updated_at = coalesce(dispute_draft_updated_at, now_at),
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'disputeMatch',
    'matchId', safe_match_id,
    'disputeId', dispute_id,
    'requestKind', 'team_score',
    'sideName', requested_side,
    'requestedScore', requested_score,
    'baseRevision', base_revision,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

-- Personal stats are referee-only and never derive or overwrite the team score.
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
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  stat_item record;
  current_stat public.player_match_stats%rowtype;
  stat_side text;
  submissions jsonb := '{}'::jsonb;
  touched_count integer := 0;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null
     or jsonb_typeof(coalesce(p_result, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_result->'playerStats', '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_match_result' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if nullif(btrim(current_match.referee_id), '') is null then
    if coalesce(p_result->'playerStats', '{}'::jsonb) <> '{}'::jsonb then
      raise exception 'no_referee_personal_stats_forbidden' using errcode = '42501';
    end if;
    raise exception 'match_score_increment_required' using errcode = '42501';
  end if;
  if safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_result_referee_required' using errcode = '42501';
  end if;
  if current_match.status not in ('agreed', 'approval', 'disputed')
     or current_match.started_at is null
     or current_match.confirmed_at is not null then
    raise exception 'match_stat_window_closed' using errcode = '23514';
  end if;

  insert into public.match_results (
    match_id, submitted_by, score_a, score_b, stat_submissions,
    score_revision_a, score_revision_b, score_submissions, submitted_at
  ) values (
    safe_match_id, safe_actor_id,
    greatest(0, coalesce(current_match.score_a, 0)),
    greatest(0, coalesce(current_match.score_b, 0)),
    '{}'::jsonb, 0, 0, '{}'::jsonb, now_at
  ) on conflict (match_id) do nothing;

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;
  submissions := coalesce(current_result.stat_submissions, '{}'::jsonb);

  for stat_item in
    select key as player_id, value as stat
    from jsonb_each(coalesce(p_result->'playerStats', '{}'::jsonb))
  loop
    if jsonb_typeof(stat_item.stat) <> 'object'
       or stat_item.stat = '{}'::jsonb
       or exists (
         select 1
         from jsonb_each_text(stat_item.stat) field(field_name, field_value)
         where field_name not in ('points', 'rebounds', 'assists', 'steals', 'blocks', 'fouls')
            or field_value !~ '^[0-9]+$'
            or field_value::integer > 999
       ) then
      raise exception 'invalid_player_stat' using errcode = '22023';
    end if;

    stat_side := public.rankball_match_player_side(safe_match_id, stat_item.player_id, current_match);
    if stat_side is null or not exists (
      select 1
      from public.match_players player
      where player.match_id = safe_match_id
        and player.user_id = stat_item.player_id
        and player.side in ('teamA', 'teamB')
        and not (
          case when jsonb_typeof(current_match.reserve_players->player.side) = 'array'
            then current_match.reserve_players->player.side else '[]'::jsonb end
        ) ? stat_item.player_id
      union all
      select 1 where (
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) ? stat_item.player_id
      union all
      select 1 where (
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) ? stat_item.player_id
    ) then
      raise exception 'stat_player_not_in_match' using errcode = '23514';
    end if;

    current_stat := null;
    select * into current_stat
    from public.player_match_stats
    where match_id = safe_match_id and user_id = stat_item.player_id;

    insert into public.player_match_stats (
      match_id, user_id, recorded_by, record_source,
      points, rebounds, assists, steals, blocks, fouls, updated_at
    ) values (
      safe_match_id, stat_item.player_id, safe_actor_id, 'referee',
      case when stat_item.stat ? 'points' then (stat_item.stat->>'points')::integer else coalesce(current_stat.points, 0) end,
      case when stat_item.stat ? 'rebounds' then (stat_item.stat->>'rebounds')::integer else coalesce(current_stat.rebounds, 0) end,
      case when stat_item.stat ? 'assists' then (stat_item.stat->>'assists')::integer else coalesce(current_stat.assists, 0) end,
      case when stat_item.stat ? 'steals' then (stat_item.stat->>'steals')::integer else coalesce(current_stat.steals, 0) end,
      case when stat_item.stat ? 'blocks' then (stat_item.stat->>'blocks')::integer else coalesce(current_stat.blocks, 0) end,
      case when stat_item.stat ? 'fouls' then (stat_item.stat->>'fouls')::integer else coalesce(current_stat.fouls, 0) end,
      now_at
    ) on conflict (match_id, user_id) do update set
      recorded_by = excluded.recorded_by,
      record_source = excluded.record_source,
      points = excluded.points,
      rebounds = excluded.rebounds,
      assists = excluded.assists,
      steals = excluded.steals,
      blocks = excluded.blocks,
      fouls = excluded.fouls,
      updated_at = excluded.updated_at;

    submissions := jsonb_set(submissions, array[stat_item.player_id], jsonb_build_object(
      'by', safe_actor_id, 'side', stat_side, 'source', 'referee', 'submittedAt', now_at
    ), true);
    touched_count := touched_count + 1;
  end loop;

  if touched_count = 0 then
    raise exception 'match_result_stats_required' using errcode = '22023';
  end if;
  update public.match_results
  set submitted_by = safe_actor_id,
      stat_submissions = submissions,
      submitted_at = coalesce(submitted_at, now_at)
  where match_id = safe_match_id;

  return jsonb_build_object(
    'ok', true, 'action', 'submitMatchResult', 'matchId', safe_match_id,
    'scoreA', current_result.score_a, 'scoreB', current_result.score_b,
    'scoreDerived', false, 'statCount', touched_count,
    'sqlReducer', true, 'advisoryLocked', true
  );
end;
$$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_resolve_dispute_action_pre_score_policy(text,text,text,text)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_resolve_dispute_action(text,text,text,text)'
    ) is null then
      raise exception 'rankball_match_resolve_dispute_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_resolve_dispute_action(text, text, text, text)
      rename to rankball_match_resolve_dispute_action_pre_score_policy;
  end if;
end;
$migration$;

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
  requested_side text;
  requested_score integer;
  requested_player_id text;
  requested_points integer;
  base_revision integer;
  before_score integer;
  next_revision integer;
  open_count integer;
  actual_player boolean := false;
  final_result jsonb := '{}'::jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null or safe_dispute_id is null
     or safe_decision not in ('accepted', 'rejected') then
    raise exception 'invalid_match_dispute_resolution_input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.status <> 'disputed' then
    raise exception 'match_dispute_not_open' using errcode = '23514';
  end if;

  if nullif(btrim(current_match.referee_id), '') is null then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_host_required' using errcode = '42501';
    end if;
  elsif safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_dispute_referee_required' using errcode = '42501';
  end if;

  select * into current_dispute
  from public.match_disputes dispute
  where dispute.match_id = safe_match_id
    and dispute.id::text = safe_dispute_id
    and dispute.status = 'open'
  for update;
  if current_dispute.id is null then
    raise exception 'match_dispute_item_not_open' using errcode = 'P0002';
  end if;

  select * into current_result
  from public.match_results
  where match_id = safe_match_id
  for update;
  if current_result.match_id is null then
    raise exception 'match_result_missing' using errcode = '23514';
  end if;

  if nullif(btrim(current_match.referee_id), '') is null then
    if current_dispute.request_payload->>'kind' is distinct from 'team_score' then
      raise exception 'match_score_dispute_request_invalid' using errcode = '22023';
    end if;
    requested_side := nullif(btrim(current_dispute.request_payload->>'side'), '');
    if requested_side not in ('teamA', 'teamB')
       or coalesce(current_dispute.request_payload->>'requestedScore', '') !~ '^[0-9]+$'
       or coalesce(current_dispute.request_payload->>'baseRevision', '') !~ '^[0-9]+$' then
      raise exception 'match_score_dispute_request_invalid' using errcode = '22023';
    end if;
    requested_score := (current_dispute.request_payload->>'requestedScore')::integer;
    base_revision := (current_dispute.request_payload->>'baseRevision')::integer;
    before_score := case when requested_side = 'teamA'
      then current_result.score_a else current_result.score_b end;
    next_revision := case when requested_side = 'teamA'
      then current_result.score_revision_a else current_result.score_revision_b end;

    if safe_decision = 'accepted' then
      if base_revision <> next_revision then
        raise exception 'match_score_revision_stale' using errcode = '40001';
      end if;
      next_revision := next_revision + 1;
      update public.match_results
      set submitted_by = safe_actor_id,
          score_a = case when requested_side = 'teamA' then requested_score else score_a end,
          score_b = case when requested_side = 'teamB' then requested_score else score_b end,
          score_revision_a = case when requested_side = 'teamA' then next_revision else score_revision_a end,
          score_revision_b = case when requested_side = 'teamB' then next_revision else score_revision_b end,
          score_submissions = jsonb_set(
            coalesce(score_submissions, '{}'::jsonb),
            array[requested_side],
            jsonb_build_object(
              'by', safe_actor_id, 'score', requested_score,
              'revision', next_revision, 'scope', 'host',
              'disputeId', current_dispute.id, 'submittedAt', now_at
            ),
            true
          ),
          submitted_at = now_at
      where match_id = safe_match_id;
      update public.matches
      set score_a = case when requested_side = 'teamA' then requested_score else score_a end,
          score_b = case when requested_side = 'teamB' then requested_score else score_b end,
          updated_at = now_at
      where id = safe_match_id;
      insert into public.match_score_events (
        match_id, side, actor_profile_id, event_type, requested_delta,
        score_before, score_after, score_revision, authority_scope, dispute_id, created_at
      ) values (
        safe_match_id, requested_side, safe_actor_id, 'dispute_accept',
        requested_score - before_score, before_score, requested_score,
        next_revision, 'host', current_dispute.id, now_at
      );
    end if;
  else
    requested_player_id := nullif(btrim(current_dispute.request_payload->>'playerId'), '');
    if requested_player_id is null
       or requested_player_id is distinct from current_dispute.user_id
       or coalesce(current_dispute.request_payload->>'requestedPoints', '') !~ '^[0-9]+$' then
      raise exception 'match_dispute_request_invalid' using errcode = '22023';
    end if;
    requested_points := least(999, (current_dispute.request_payload->>'requestedPoints')::integer);
    if safe_decision = 'accepted' then
      select exists (
        select 1 from public.match_players player
        where player.match_id = safe_match_id
          and player.user_id = requested_player_id
          and player.side in ('teamA', 'teamB')
          and not (
            case when jsonb_typeof(current_match.reserve_players->player.side) = 'array'
              then current_match.reserve_players->player.side else '[]'::jsonb end
          ) ? requested_player_id
        union all
        select 1 where coalesce(current_match.played_player_ids->'teamA', '[]'::jsonb) ? requested_player_id
        union all
        select 1 where coalesce(current_match.played_player_ids->'teamB', '[]'::jsonb) ? requested_player_id
      ) into actual_player;
      if not actual_player then
        raise exception 'match_dispute_player_not_recordable' using errcode = '23514';
      end if;
      insert into public.player_match_stats (
        match_id, user_id, recorded_by, record_source,
        points, rebounds, assists, steals, blocks, fouls, updated_at
      ) values (
        safe_match_id, requested_player_id, safe_actor_id, 'dispute_operator',
        requested_points, 0, 0, 0, 0, 0, now_at
      ) on conflict (match_id, user_id) do update set
        recorded_by = excluded.recorded_by,
        record_source = excluded.record_source,
        points = excluded.points,
        updated_at = excluded.updated_at;
    end if;
  end if;

  update public.match_disputes
  set status = safe_decision,
      resolved_at = now_at,
      resolved_by = safe_actor_id,
      resolution = case when safe_decision = 'accepted'
        then 'request_applied' else 'request_rejected' end
  where id = current_dispute.id;

  select count(*)::integer into open_count
  from public.match_disputes
  where match_id = safe_match_id and status = 'open';
  if open_count = 0 then
    update public.matches
    set status = 'approval',
        dispute_draft_result = null,
        dispute_draft_updated_at = null,
        dispute_resolved_at = now_at,
        updated_at = now_at
    where id = safe_match_id;
    final_result := public.rankball_match_finalize_locked(
      safe_actor_id, safe_match_id, 'resolveMatchDispute'
    );
  else
    update public.matches
    set dispute_draft_updated_at = now_at, updated_at = now_at
    where id = safe_match_id;
  end if;

  return final_result || jsonb_build_object(
    'ok', true, 'action', 'resolveMatchDispute', 'matchId', safe_match_id,
    'disputeId', current_dispute.id, 'decision', safe_decision,
    'openCount', open_count, 'finalized', open_count = 0,
    'sqlReducer', true, 'advisoryLocked', true
  );
end;
$$;

-- Keep the established rating transaction, but remove approval-majority,
-- score-from-PTS, missing-stat, and stat-boost coupling.
do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef(
    'public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure
  ) into function_definition;

  old_text := $old$      if team_a_required = 0 or team_b_required = 0
         or team_a_approvals < team_a_required
         or team_b_approvals < team_b_required then$old$;
  new_text := $new$      if not actor_is_operator and (
        team_a_required = 0 or team_b_required = 0
        or team_a_approvals < team_a_required
        or team_b_approvals < team_b_required
      ) then$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_record_approval_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$      if team_a_count = 0 or team_b_count = 0
         or team_a_approvals < team_a_required
         or team_b_approvals < team_b_required then$old$;
  new_text := $new$      if not actor_is_operator and (
        team_a_count = 0 or team_b_count = 0
        or team_a_approvals < team_a_required
        or team_b_approvals < team_b_required
      ) then$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_approval_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$  if missing_stats > 0 then raise exception 'match_approval_stats_incomplete' using errcode = '23514'; end if;$old$;
  new_text := $new$  if nullif(btrim(current_match.referee_id), '') is not null and missing_stats > 0 then
    raise exception 'match_approval_stats_incomplete' using errcode = '23514';
  end if;$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_missing_stats_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$  if points_a <> result_row.score_a or points_b <> result_row.score_b then
    raise exception 'match_approval_point_mismatch' using errcode = '23514';
  end if;$old$;
  new_text := $new$  -- Team scores are authoritative and independent from personal PTS.
  if false then
    raise exception 'match_approval_point_mismatch' using errcode = '23514';
  end if;$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_point_mismatch_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$    join public.player_match_stats stat
      on stat.match_id = safe_match_id
     and stat.user_id = profile.id
    where current_match.ranked$old$;
  new_text := $new$    left join public.player_match_stats stat
      on stat.match_id = safe_match_id
     and stat.user_id = profile.id
    where current_match.ranked$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_rating_roster_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$    -- Resolve the match snapshot first, then durable membership history; never assume a team role.$old$;
  new_text := $new$    stat_boost := 0;

    -- Resolve the match snapshot first, then durable membership history; never assume a team role.$new$;
  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_stat_boost_shape_changed';
  end if;
  function_definition := replace(function_definition, old_text, new_text);

  execute function_definition;
end;
$migration$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_finalize_locked_pre_score_policy(text,text,text)'
  ) is null then
    alter function public.rankball_match_finalize_locked(text, text, text)
      rename to rankball_match_finalize_locked_pre_score_policy;
  end if;
end;
$migration$;

create or replace function public.rankball_match_finalize_locked(
  p_actor_profile_id text,
  p_match_id text,
  p_action text default 'finalizeMatch'
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
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if nullif(btrim(current_match.referee_id), '') is null then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_finalize_host_required' using errcode = '42501';
    end if;
  elsif safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_finalize_referee_required' using errcode = '42501';
  end if;
  if current_match.status = 'agreed' and current_match.ended_at is not null then
    insert into public.match_results (
      match_id, submitted_by, score_a, score_b, stat_submissions,
      score_revision_a, score_revision_b, score_submissions, submitted_at
    ) values (
      safe_match_id,
      safe_actor_id,
      greatest(0, coalesce(current_match.score_a, 0)),
      greatest(0, coalesce(current_match.score_b, 0)),
      '{}'::jsonb,
      0,
      0,
      '{}'::jsonb,
      clock_timestamp()
    ) on conflict (match_id) do nothing;
    update public.matches
    set status = 'approval', updated_at = clock_timestamp()
    where id = safe_match_id
      and status = 'agreed'
      and ended_at is not null;
    current_match.status := 'approval';
  end if;

  if current_match.status = 'disputed'
     or exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id and dispute.status = 'open'
  ) then
    raise exception 'match_dispute_resolution_required' using errcode = '23514';
  end if;

  return public.rankball_match_finalize_locked_pre_score_policy(
    safe_actor_id, safe_match_id, coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );
end;
$$;

-- Automatic finalization cannot choose the required authority role.
create or replace function public.rankball_match_auto_finalize_action(
  p_match_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform nullif(btrim(p_match_id), '');
  perform p_now;
  raise exception 'match_auto_finalization_locked' using errcode = '42501';
end;
$$;

alter table public.profile_match_summaries
  add column if not exists stat_match_count integer not null default 0;

alter table public.profile_match_summaries
  drop constraint if exists profile_match_summaries_stat_match_count_check;
alter table public.profile_match_summaries
  add constraint profile_match_summaries_stat_match_count_check
  check (stat_match_count >= 0 and stat_match_count <= match_count) not valid;
alter table public.profile_match_summaries
  validate constraint profile_match_summaries_stat_match_count_check;

-- Participation count includes score-only matches; stat count includes only
-- confirmed matches that actually have a referee-entered stat row.
do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
  target_function regprocedure;
begin
  foreach target_function in array array[
    'public.rankball_rebuild_profile_match_summary(text)'::regprocedure,
    'public.rankball_refresh_all_profile_match_summaries()'::regprocedure
  ] loop
    select pg_get_functiondef(target_function) into function_definition;

    old_text := $old$      m.id as match_id,
      coalesce(nullif(mp.side, ''), 'teamA') as side,$old$;
    new_text := $new$      m.id as match_id,
      nullif(btrim(m.referee_id), '') as referee_id,
      coalesce(nullif(mp.side, ''), 'teamA') as side,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'profile_match_summary_referee_shape_changed: %', target_function;
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    left join public.player_match_stats stat
      on stat.match_id = scored_matches.match_id$old$;
    new_text := $new$    left join public.player_match_stats stat
      on stat.match_id = scored_matches.match_id
     and scored_matches.referee_id is not null
     and stat.record_source in ('referee', 'dispute_operator')$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'profile_match_summary_official_stat_shape_changed: %', target_function;
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$      count(*)::integer as match_count,
      count(*) filter (where outcome = 'win')::integer as win_count,$old$;
    new_text := $new$      count(*)::integer as match_count,
      count(distinct stat.match_id)::integer as stat_match_count,
      count(*) filter (where outcome = 'win')::integer as win_count,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'profile_match_summary_aggregate_shape_changed: %', target_function;
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    profile_id,
    match_count,
    win_count,$old$;
    new_text := $new$    profile_id,
    match_count,
    stat_match_count,
    win_count,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'profile_match_summary_column_shape_changed: %', target_function;
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    match_count = excluded.match_count,
    win_count = excluded.win_count,$old$;
    new_text := $new$    match_count = excluded.match_count,
    stat_match_count = excluded.stat_match_count,
    win_count = excluded.win_count,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'profile_match_summary_upsert_shape_changed: %', target_function;
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    execute function_definition;
  end loop;
end;
$migration$;

select public.rankball_refresh_all_profile_match_summaries();

create or replace function public.rankball_match_score_operation_policy_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with checks as (
    select jsonb_build_object(
      'dualScoreRecorderSide', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'matches'
          and column_name = 'dual_score_recorder_side'
      ),
      'scoreRevisionA', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_revision_a'
      ),
      'scoreRevisionB', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_revision_b'
      ),
      'scoreSubmissions', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results'
          and column_name = 'score_submissions'
      ),
      'statMatchCount', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'profile_match_summaries'
          and column_name = 'stat_match_count'
      ),
      'scoreEvents', to_regclass('public.match_score_events') is not null,
      'takeoverRequests', to_regclass('public.match_recorder_takeover_requests') is not null,
      'scoreRpc', to_regprocedure(
        'public.rankball_match_score_increment_action(text,text,integer,integer,integer,integer)'
      ) is not null,
      'takeoverRpc', to_regprocedure(
        'public.rankball_match_recorder_takeover_action(text,text,text,text,text)'
      ) is not null,
      'statGuard', exists (
        select 1 from pg_trigger
        where tgname = 'rankball_no_referee_player_match_stats_guard' and not tgisinternal
      )
    ) as value
  )
  select jsonb_build_object(
    'ok', not exists (
      select 1 from checks, jsonb_each(checks.value) item
      where item.value <> 'true'::jsonb
    ),
    'checks', checks.value
  )
  from checks;
$$;

alter table public.match_score_events enable row level security;
alter table public.match_recorder_takeover_requests enable row level security;
revoke all on public.match_score_events from public, anon, authenticated;
revoke all on public.match_recorder_takeover_requests from public, anon, authenticated;
grant all on public.match_score_events to service_role;
grant all on public.match_recorder_takeover_requests to service_role;

revoke all on function public.rankball_match_result_action_pre_score_policy(text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_resolve_dispute_action_pre_score_policy(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_finalize_locked_pre_score_policy(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_roster_transition_action_pre_score_policy(text, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_roster_move_action(text, text, text, text, text, text, text)
  from service_role;
revoke all on function public.rankball_match_substitution_action(text, text, text, text, text, text)
  from service_role;

revoke all on function public.rankball_match_scorekeeper_scope_action(text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_match_score_increment_action(text, text, integer, integer, integer, integer)
  from public, anon, authenticated;
revoke all on function public.rankball_match_recorder_takeover_action(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_match_roster_transition_action(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_guard_no_referee_player_match_stats()
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_result_action(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.rankball_match_resolve_dispute_action(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_match_finalize_locked(text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_match_score_operation_policy_health()
  from public, anon, authenticated;

grant execute on function public.rankball_match_scorekeeper_scope_action(text, text, text) to service_role;
grant execute on function public.rankball_match_score_increment_action(text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.rankball_match_recorder_takeover_action(text, text, text, text, text) to service_role;
grant execute on function public.rankball_match_roster_transition_action(text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.rankball_match_result_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_resolve_dispute_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_finalize_locked(text, text, text) to service_role;
grant execute on function public.rankball_match_score_operation_policy_health() to service_role;

-- Participant approvals remain visible, but can no longer finalize through a
-- function OID that predates the authority-only wrapper.
do $migration$
declare
  function_definition text;
  old_text text := $old$  return public.rankball_match_finalize_locked(safe_actor_id, safe_match_id, 'approveMatch');$old$;
  new_text text := $new$  return jsonb_build_object(
    'ok', true,
    'action', 'approveMatch',
    'matchId', safe_match_id,
    'sqlReducer', true,
    'finalized', false,
    'authorityFinalizationRequired', true
  );$new$;
  target_function regprocedure;
begin
  foreach target_function in array array[
    'public.rankball_match_approval_action_concurrency_inner(text,text,text,text)'::regprocedure,
    'public.rankball_match_approval_action(text,text,text,text)'::regprocedure
  ] loop
    select pg_get_functiondef(target_function) into function_definition;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_approval_finalize_shape_changed: %', target_function;
    end if;
    execute replace(function_definition, old_text, new_text);
  end loop;
end;
$migration$;

-- rankball_match_resume_approval_action(text,text) was removed by 20260725010000.
-- No grant remains to revoke.
-- rankball_match_resume_approval_action(text,text,jsonb) was removed by 20260725010000.
-- No grant remains to revoke.
-- rankball_match_reject_dispute_action was removed by 20260725010000.
-- No grant remains to revoke.

select pg_notify('pgrst', 'reload schema');
commit;
