begin;

alter table public.match_results
  add column if not exists result_revision integer not null default 0;

alter table public.player_match_stats
  add column if not exists turnovers integer not null default 0;

alter table public.match_results
  drop constraint if exists match_results_result_revision_nonnegative;
alter table public.match_results
  add constraint match_results_result_revision_nonnegative
  check (result_revision >= 0);

alter table public.player_match_stats
  drop constraint if exists player_match_stats_turnovers_nonnegative;
alter table public.player_match_stats
  add constraint player_match_stats_turnovers_nonnegative
  check (turnovers between 0 and 999);

create or replace function public.rankball_match_actual_player_ids(
  p_match_id text
)
returns table(player_id text)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select *
    from public.matches
    where id = nullif(btrim(p_match_id), '')
  ),
  played as (
    select distinct played_id as player_id
    from target match,
    lateral jsonb_array_elements_text(
      case when jsonb_typeof(match.played_player_ids->'teamA') = 'array'
        then match.played_player_ids->'teamA' else '[]'::jsonb end
      ||
      case when jsonb_typeof(match.played_player_ids->'teamB') = 'array'
        then match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(played_id)
    where not coalesce(match.anonymous_players, '{}'::jsonb) ? played_id
  ),
  active_roster as (
    select distinct player.user_id as player_id
    from target match
    join public.match_players player on player.match_id = match.id
    where player.side in ('teamA', 'teamB')
      and not (
        case when jsonb_typeof(match.reserve_players->player.side) = 'array'
          then match.reserve_players->player.side else '[]'::jsonb end
      ) ? player.user_id
      and not coalesce(match.anonymous_players, '{}'::jsonb) ? player.user_id
  )
  select player_id from played
  union
  select player_id from active_roster
  where not exists (select 1 from played);
$$;

create or replace function public.rankball_match_overlap_conflict(
  p_match_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  candidate public.matches%rowtype;
  candidate_start timestamptz;
  candidate_end timestamptz;
  conflict jsonb;
begin
  select * into candidate
  from public.matches
  where id = nullif(btrim(p_match_id), '');

  if candidate.id is null
     or lower(coalesce(candidate.rules->>'recordType', '')) in ('personal_record', 'solo')
     or candidate.status in ('cancelled', 'void')
     or candidate.cancelled_at is not null
     or candidate.voided_at is not null then
    return null;
  end if;

  candidate_start := case
    when candidate.started_at is not null then candidate.started_at
    when lower(coalesce(candidate.rules->>'recordType', '')) = 'match_record'
      and candidate.ended_at is not null then candidate.ended_at - interval '30 minutes'
    else null
  end;
  candidate_end := case
    when lower(coalesce(candidate.rules->>'recordType', '')) = 'match_record'
      and candidate_start is not null then candidate_start + interval '30 minutes'
    when candidate.ended_at is not null then candidate.ended_at
    when candidate.started_at is not null then clock_timestamp()
    else null
  end;
  if candidate_start is null or candidate_end is null or candidate_end <= candidate_start then
    return null;
  end if;

  select jsonb_build_object(
    'matchId', existing.id,
    'title', existing.title,
    'startedAt', existing_range.started_at,
    'endedAt', existing_range.ended_at,
    'playerId', candidate_player.player_id
  )
  into conflict
  from public.rankball_match_actual_player_ids(candidate.id) candidate_player
  join public.matches existing
    on existing.id <> candidate.id
   and existing.status not in ('cancelled', 'void')
   and existing.cancelled_at is null
   and existing.voided_at is null
   and lower(coalesce(existing.rules->>'recordType', '')) not in ('personal_record', 'solo')
  join lateral (
    select
      case
        when existing.started_at is not null then existing.started_at
        when lower(coalesce(existing.rules->>'recordType', '')) = 'match_record'
          and existing.ended_at is not null then existing.ended_at - interval '30 minutes'
        else null
      end as started_at,
      case
        when lower(coalesce(existing.rules->>'recordType', '')) = 'match_record'
          and coalesce(existing.started_at, existing.ended_at - interval '30 minutes') is not null
          then coalesce(existing.started_at, existing.ended_at - interval '30 minutes') + interval '30 minutes'
        when existing.ended_at is not null then existing.ended_at
        when existing.started_at is not null then clock_timestamp()
        else null
      end as ended_at
  ) existing_range on true
  join public.rankball_match_actual_player_ids(existing.id) existing_player
    on existing_player.player_id = candidate_player.player_id
  where existing_range.started_at is not null
    and existing_range.ended_at is not null
    and existing_range.started_at < candidate_end
    and candidate_start < existing_range.ended_at
  order by existing_range.started_at, existing.id
  limit 1;

  return conflict;
end;
$$;

create or replace function public.rankball_assert_match_no_player_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match_id text := case when tg_op = 'DELETE' then old.match_id else new.match_id end;
  conflict jsonb;
begin
  if tg_op = 'UPDATE'
     and old.ended_at is null
     and new.ended_at is not null
     and new.confirmed_at is null
     and lower(coalesce(new.rules->>'recordType', '')) <> 'match_record' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:player-overlap'));
  conflict := public.rankball_match_overlap_conflict(target_match_id);
  if conflict is not null then
    raise exception 'match_player_time_overlap:%', conflict::text using errcode = '23P01';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.rankball_assert_match_row_no_player_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('rankball:player-overlap'));
  conflict := public.rankball_match_overlap_conflict(new.id);
  if conflict is not null then
    raise exception 'match_player_time_overlap:%', conflict::text using errcode = '23P01';
  end if;
  return new;
end;
$$;

create or replace function public.rankball_normalize_match_record_time()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if lower(coalesce(new.rules->>'recordType', '')) = 'match_record'
     and new.started_at is not null then
    new.ended_at := new.started_at + interval '30 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_match_record_time_guard on public.matches;
create trigger rankball_match_record_time_guard
before insert or update of started_at, ended_at, rules on public.matches
for each row execute function public.rankball_normalize_match_record_time();

drop trigger if exists rankball_match_player_overlap_guard on public.match_players;
create constraint trigger rankball_match_player_overlap_guard
after insert or update or delete on public.match_players
deferrable initially deferred
for each row execute function public.rankball_assert_match_no_player_overlap();

drop trigger if exists rankball_match_row_overlap_guard on public.matches;
create constraint trigger rankball_match_row_overlap_guard
after insert or update of started_at, ended_at, confirmed_at, cancelled_at, voided_at, status, played_player_ids, reserve_players, anonymous_players
on public.matches
deferrable initially deferred
for each row execute function public.rankball_assert_match_row_no_player_overlap();

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_start_action_pre_server_time(text,text,text,text,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_start_action(text,text,text,text,jsonb)'
    ) is null then
      raise exception 'rankball_match_start_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_start_action(text, text, text, text, jsonb)
      rename to rankball_match_start_action_pre_server_time;
  end if;
end;
$migration$;

create or replace function public.rankball_match_start_action(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{}'::jsonb
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.rankball_match_start_action_pre_server_time(
    p_actor_profile_id,
    p_match_id,
    clock_timestamp()::text,
    p_agreed_at,
    p_attendance
  );
$$;

create or replace function public.rankball_match_end_action(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_ended_at text default null
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
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform p_started_at;
  perform p_ended_at;
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
  if safe_actor_id is distinct from coalesce(nullif(current_match.referee_id, ''), current_match.created_by) then
    raise exception 'match_end_permission_denied' using errcode = '42501';
  end if;
  if current_match.status <> 'agreed' or current_match.ended_at is not null then
    raise exception 'match_not_endable' using errcode = '23514';
  end if;
  if current_match.started_at is null or now_at <= current_match.started_at then
    raise exception 'match_time_range_invalid' using errcode = '22023';
  end if;

  update public.matches
  set ended_at = now_at,
      rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{startedAt}', to_jsonb(current_match.started_at::text), true),
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'endMatch',
    'matchId', safe_match_id,
    'startedAt', current_match.started_at,
    'endedAt', now_at,
    'sqlReducer', true,
    'advisoryLocked', true,
    'serverTimed', true
  );
end;
$$;

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
  request jsonb := coalesce(p_dispute_request, '{}'::jsonb);
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  current_stat public.player_match_stats%rowtype;
  request_kind text;
  request_reason text;
  requested_stats jsonb;
  requested_score_a integer;
  requested_score_b integer;
  base_revision integer;
  dispute_id uuid := gen_random_uuid();
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null or jsonb_typeof(request) <> 'object' then
    raise exception 'match_dispute_request_invalid' using errcode = '22023';
  end if;
  request_kind := nullif(btrim(request->>'kind'), '');
  request_reason := nullif(btrim(request->>'reason'), '');
  if request_reason is null or char_length(request_reason) > 500
     or coalesce(request->>'baseRevision', '') !~ '^[0-9]+$' then
    raise exception 'match_dispute_request_invalid' using errcode = '22023';
  end if;
  base_revision := (request->>'baseRevision')::integer;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  select * into current_result from public.match_results where match_id = safe_match_id for update;
  if current_result.match_id is null then raise exception 'match_result_missing' using errcode = '23514'; end if;
  if current_match.confirmed_at is not null or current_match.cancelled_at is not null or current_match.voided_at is not null
     or current_match.status not in ('agreed', 'approval', 'disputed')
     or current_match.ended_at is null
     or now_at > current_match.ended_at + make_interval(mins => public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)) then
    raise exception 'match_dispute_window_closed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.rankball_match_actual_player_ids(safe_match_id) player
    where player.player_id = safe_actor_id
  ) then
    raise exception 'match_dispute_player_not_actual' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.match_disputes
    where match_id = safe_match_id and user_id = safe_actor_id and status = 'open'
  ) then
    raise exception 'match_dispute_already_open' using errcode = '23505';
  end if;
  if base_revision <> greatest(
    current_result.result_revision,
    current_result.score_revision_a,
    current_result.score_revision_b
  ) then
    raise exception 'match_result_revision_stale' using errcode = '40001';
  end if;

  if nullif(btrim(current_match.referee_id), '') is null then
    if request_kind <> 'team_scores'
       or coalesce(request->>'requestedScoreA', '') !~ '^[0-9]+$'
       or coalesce(request->>'requestedScoreB', '') !~ '^[0-9]+$' then
      raise exception 'match_score_dispute_request_invalid' using errcode = '22023';
    end if;
    requested_score_a := (request->>'requestedScoreA')::integer;
    requested_score_b := (request->>'requestedScoreB')::integer;
    if requested_score_a not between 0 and 999
       or requested_score_b not between 0 and 999
       or (requested_score_a = current_result.score_a and requested_score_b = current_result.score_b) then
      raise exception 'match_score_dispute_request_invalid' using errcode = '22023';
    end if;
    request := request || jsonb_build_object(
      'currentScoreA', current_result.score_a,
      'currentScoreB', current_result.score_b
    );
  else
    if request_kind <> 'player_stats'
       or nullif(btrim(request->>'playerId'), '') is distinct from safe_actor_id
       or jsonb_typeof(request->'requestedStats') <> 'object' then
      raise exception 'match_stat_dispute_request_invalid' using errcode = '22023';
    end if;
    requested_stats := request->'requestedStats';
    if jsonb_object_length(requested_stats) <> 7
       or not requested_stats ?& array['points','rebounds','assists','steals','blocks','turnovers','fouls']
       or exists (
         select 1 from jsonb_each_text(requested_stats) field
         where field.key not in ('points','rebounds','assists','steals','blocks','turnovers','fouls')
            or field.value !~ '^[0-9]+$'
            or field.value::integer > 999
       ) then
      raise exception 'match_stat_dispute_request_invalid' using errcode = '22023';
    end if;
    select * into current_stat
    from public.player_match_stats
    where match_id = safe_match_id and user_id = safe_actor_id;
    if requested_stats = jsonb_build_object(
      'points', coalesce(current_stat.points, 0),
      'rebounds', coalesce(current_stat.rebounds, 0),
      'assists', coalesce(current_stat.assists, 0),
      'steals', coalesce(current_stat.steals, 0),
      'blocks', coalesce(current_stat.blocks, 0),
      'turnovers', coalesce(current_stat.turnovers, 0),
      'fouls', coalesce(current_stat.fouls, 0)
    ) then
      raise exception 'match_stat_dispute_no_change' using errcode = '22023';
    end if;
    request := request || jsonb_build_object(
      'currentStats', jsonb_build_object(
        'points', coalesce(current_stat.points, 0),
        'rebounds', coalesce(current_stat.rebounds, 0),
        'assists', coalesce(current_stat.assists, 0),
        'steals', coalesce(current_stat.steals, 0),
        'blocks', coalesce(current_stat.blocks, 0),
        'turnovers', coalesce(current_stat.turnovers, 0),
        'fouls', coalesce(current_stat.fouls, 0)
      )
    );
  end if;

  insert into public.match_disputes (
    id, match_id, user_id, reason, request_payload, status, created_at
  ) values (
    dispute_id, safe_match_id, safe_actor_id, request_reason, request, 'open', now_at
  );
  update public.matches
  set status = 'disputed', updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'disputeMatch',
    'matchId', safe_match_id,
    'disputeId', dispute_id,
    'requestKind', request_kind,
    'baseRevision', base_revision,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

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
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_dispute_id text := nullif(btrim(p_dispute_id), '');
  safe_decision text := lower(nullif(btrim(p_decision), ''));
  safe_reason text := nullif(btrim(p_resolution_reason), '');
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  current_dispute public.match_disputes%rowtype;
  requested_stats jsonb;
  request_kind text;
  base_revision integer;
  next_score_a integer;
  next_score_b integer;
  next_revision integer;
  remaining_open integer;
  before_result jsonb;
  after_result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null or safe_dispute_id is null
     or safe_decision not in ('accepted', 'rejected')
     or safe_reason is null or char_length(safe_reason) > 500 then
    raise exception 'invalid_match_dispute_resolution_input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if nullif(btrim(current_match.referee_id), '') is null then
    if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
      raise exception 'match_dispute_host_required' using errcode = '42501';
    end if;
  elsif safe_actor_id <> nullif(btrim(current_match.referee_id), '')
     or not public.rankball_is_match_referee_eligible(safe_actor_id, safe_match_id) then
    raise exception 'match_dispute_referee_required' using errcode = '42501';
  end if;

  select * into current_dispute
  from public.match_disputes
  where match_id = safe_match_id and id::text = safe_dispute_id and status = 'open'
  for update;
  if current_dispute.id is null then raise exception 'match_dispute_item_not_open' using errcode = 'P0002'; end if;
  select * into current_result from public.match_results where match_id = safe_match_id for update;
  if current_result.match_id is null then raise exception 'match_result_missing' using errcode = '23514'; end if;

  request_kind := current_dispute.request_payload->>'kind';
  base_revision := (current_dispute.request_payload->>'baseRevision')::integer;
  before_result := jsonb_build_object(
    'scoreA', current_result.score_a,
    'scoreB', current_result.score_b,
    'revision', greatest(
      current_result.result_revision,
      current_result.score_revision_a,
      current_result.score_revision_b
    )
  );

  if safe_decision = 'accepted' then
    if base_revision <> greatest(
      current_result.result_revision,
      current_result.score_revision_a,
      current_result.score_revision_b
    ) then
      raise exception 'match_result_revision_stale' using errcode = '40001';
    end if;
    next_revision := greatest(
      current_result.result_revision,
      current_result.score_revision_a,
      current_result.score_revision_b
    ) + 1;
    if request_kind = 'team_scores' and nullif(btrim(current_match.referee_id), '') is null then
      next_score_a := (current_dispute.request_payload->>'requestedScoreA')::integer;
      next_score_b := (current_dispute.request_payload->>'requestedScoreB')::integer;
    elsif request_kind = 'player_stats' and nullif(btrim(current_match.referee_id), '') is not null then
      requested_stats := current_dispute.request_payload->'requestedStats';
      insert into public.player_match_stats (
        match_id, user_id, recorded_by, record_source,
        points, rebounds, assists, steals, blocks, turnovers, fouls, updated_at
      ) values (
        safe_match_id,
        current_dispute.user_id,
        safe_actor_id,
        'referee',
        (requested_stats->>'points')::integer,
        (requested_stats->>'rebounds')::integer,
        (requested_stats->>'assists')::integer,
        (requested_stats->>'steals')::integer,
        (requested_stats->>'blocks')::integer,
        (requested_stats->>'turnovers')::integer,
        (requested_stats->>'fouls')::integer,
        now_at
      ) on conflict (match_id, user_id) do update set
        recorded_by = excluded.recorded_by,
        record_source = excluded.record_source,
        points = excluded.points,
        rebounds = excluded.rebounds,
        assists = excluded.assists,
        steals = excluded.steals,
        blocks = excluded.blocks,
        turnovers = excluded.turnovers,
        fouls = excluded.fouls,
        updated_at = excluded.updated_at;

      select
        coalesce(sum(stat.points) filter (
          where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamA'
        ), 0)::integer,
        coalesce(sum(stat.points) filter (
          where public.rankball_match_player_side(safe_match_id, stat.user_id, current_match) = 'teamB'
        ), 0)::integer
      into next_score_a, next_score_b
      from public.player_match_stats stat
      where stat.match_id = safe_match_id
        and exists (
          select 1 from public.rankball_match_actual_player_ids(safe_match_id) actual
          where actual.player_id = stat.user_id
        );
    else
      raise exception 'match_dispute_request_kind_mismatch' using errcode = '22023';
    end if;

    update public.match_results
    set submitted_by = safe_actor_id,
        score_a = next_score_a,
        score_b = next_score_b,
        result_revision = next_revision,
        score_revision_a = score_revision_a + 1,
        score_revision_b = score_revision_b + 1,
        submitted_at = coalesce(submitted_at, now_at)
    where match_id = safe_match_id;
    update public.matches
    set score_a = next_score_a, score_b = next_score_b, updated_at = now_at
    where id = safe_match_id;
  else
    next_score_a := current_result.score_a;
    next_score_b := current_result.score_b;
    next_revision := greatest(
      current_result.result_revision,
      current_result.score_revision_a,
      current_result.score_revision_b
    );
  end if;

  after_result := jsonb_build_object(
    'scoreA', next_score_a,
    'scoreB', next_score_b,
    'revision', next_revision
  );
  update public.match_disputes
  set status = safe_decision,
      resolved_at = now_at,
      resolved_by = safe_actor_id,
      resolution = case when safe_decision = 'accepted' then 'request_applied' else 'request_rejected' end,
      resolution_reason = safe_reason,
      resolution_audit = jsonb_build_object(
        'handledBy', safe_actor_id,
        'handledAt', now_at,
        'decision', safe_decision,
        'previousResult', before_result,
        'requested', current_dispute.request_payload,
        'nextResult', after_result
      )
  where id = current_dispute.id;

  select count(*) into remaining_open
  from public.match_disputes
  where match_id = safe_match_id and status = 'open';
  update public.matches
  set status = case when remaining_open = 0 then 'approval' else 'disputed' end,
      dispute_resolved_at = case when remaining_open = 0 then now_at else dispute_resolved_at end,
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'resolveMatchDispute',
    'matchId', safe_match_id,
    'disputeId', safe_dispute_id,
    'decision', safe_decision,
    'remainingOpen', remaining_open,
    'result', after_result,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

do $migration$
begin
  if to_regprocedure(
    'public.rankball_match_result_action_pre_turnovers(text,text,jsonb)'
  ) is null then
    if to_regprocedure(
      'public.rankball_match_result_action(text,text,jsonb)'
    ) is null then
      raise exception 'rankball_match_result_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_result_action(text, text, jsonb)
      rename to rankball_match_result_action_pre_turnovers;
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
  safe_result jsonb := coalesce(p_result, '{}'::jsonb);
  sanitized_stats jsonb := '{}'::jsonb;
  stat_item record;
  result jsonb;
  turnover_value integer;
begin
  if jsonb_typeof(coalesce(safe_result->'playerStats', '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_match_result' using errcode = '22023';
  end if;
  for stat_item in
    select key as player_id, value as stat
    from jsonb_each(coalesce(safe_result->'playerStats', '{}'::jsonb))
  loop
    if jsonb_typeof(stat_item.stat) <> 'object'
       or coalesce(stat_item.stat->>'turnovers', '0') !~ '^[0-9]+$'
       or (stat_item.stat->>'turnovers')::integer > 999 then
      raise exception 'invalid_player_stat' using errcode = '22023';
    end if;
    sanitized_stats := jsonb_set(
      sanitized_stats,
      array[stat_item.player_id],
      stat_item.stat - 'turnovers',
      true
    );
  end loop;

  result := public.rankball_match_result_action_pre_turnovers(
    p_actor_profile_id,
    p_match_id,
    jsonb_set(safe_result, '{playerStats}', sanitized_stats, true)
  );

  for stat_item in
    select key as player_id, value as stat
    from jsonb_each(coalesce(safe_result->'playerStats', '{}'::jsonb))
  loop
    turnover_value := coalesce((stat_item.stat->>'turnovers')::integer, 0);
    update public.player_match_stats
    set turnovers = turnover_value
    where match_id = nullif(btrim(p_match_id), '')
      and user_id = stat_item.player_id;
  end loop;
  return result || jsonb_build_object('turnoversSaved', true);
end;
$$;

create or replace function public.rankball_match_overlap_policy_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ok',
      exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'match_results' and column_name = 'result_revision'
      )
      and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'player_match_stats' and column_name = 'turnovers'
      )
      and to_regprocedure('public.rankball_match_actual_player_ids(text)') is not null
      and to_regprocedure('public.rankball_match_overlap_conflict(text)') is not null
      and exists (
        select 1 from pg_trigger
        where tgname = 'rankball_match_player_overlap_guard' and not tgisinternal
      )
      and exists (
        select 1 from pg_trigger
        where tgname = 'rankball_match_row_overlap_guard' and not tgisinternal
      )
      and exists (
        select 1 from pg_trigger
        where tgname = 'rankball_match_record_time_guard' and not tgisinternal
      )
      and not has_function_privilege(
        'service_role',
        'public.rankball_match_postgame_roster_action(text,text,text,text,text,text)',
        'EXECUTE'
      ),
    'recordDurationMinutes', 30,
    'overlapScope', 'actual_players'
  );
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_match_postgame_roster_action(text,text,text,text,text,text)') is not null then
    execute 'revoke all on function public.rankball_match_postgame_roster_action(text,text,text,text,text,text) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb)') is not null then
    execute 'revoke all on function public.rankball_match_late_player_action(text,text,text,text,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated, service_role';
  end if;
end;
$migration$;

revoke all on function public.rankball_match_actual_player_ids(text) from public, anon, authenticated;
grant execute on function public.rankball_match_actual_player_ids(text) to service_role;
revoke all on function public.rankball_match_overlap_conflict(text) from public, anon, authenticated;
grant execute on function public.rankball_match_overlap_conflict(text) to service_role;
revoke all on function public.rankball_match_start_action(text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_start_action(text,text,text,text,jsonb) to service_role;
revoke all on function public.rankball_match_end_action(text,text,text,text) from public, anon, authenticated;
grant execute on function public.rankball_match_end_action(text,text,text,text) to service_role;
revoke all on function public.rankball_match_dispute_action(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_dispute_action(text,text,jsonb) to service_role;
revoke all on function public.rankball_match_resolve_dispute_action(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.rankball_match_resolve_dispute_action(text,text,text,text,text) to service_role;
revoke all on function public.rankball_match_result_action(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_result_action(text,text,jsonb) to service_role;
revoke all on function public.rankball_match_overlap_policy_health() from public, anon, authenticated;
grant execute on function public.rankball_match_overlap_policy_health() to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
