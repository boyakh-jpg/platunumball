-- Owner-managed rating/trust coefficients with bounded values and atomic audit history.
create table if not exists public.rating_policy (
  id text primary key default 'active',
  version integer not null default 1,
  policy jsonb not null,
  reason text not null default '초기 기본 정책',
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint rating_policy_singleton check (id = 'active'),
  constraint rating_policy_version_positive check (version > 0)
);

alter table public.rating_policy enable row level security;
revoke all on table public.rating_policy from public, anon, authenticated;

create or replace function public.rankball_default_rating_policy()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'playerMmr', jsonb_build_object(
      'resultScalePercent', 100,
      'statScalePercent', 100,
      'deltaCapPercent', 100,
      'modeScalePercent', jsonb_build_object('1v1', 100, '2v2', 100, '3v3', 100, '5v5', 100),
      'integratedScalePercent', jsonb_build_object('1v1', 100, '2v2', 100, '3v3', 100, '5v5', 100)
    ),
    'teamMmr', jsonb_build_object(
      'resultScalePercent', 100,
      'deltaCapPercent', 100
    ),
    'trust', jsonb_build_object(
      'matchCompletionReward', 1,
      'foulGrace', 2,
      'foulPenaltyPer', 1,
      'maxFoulPenalty', 4,
      'candidateRecorderReward', 2,
      'refereeReward', 1,
      'thumbsDelta', 1,
      'refereeAbsencePenalty', 4,
      'falseCourtReportPenalty', 8,
      'closeWithApplicantsPenalty', 2,
      'closeUnreadyPenalty', 2,
      'closeExpiredPenalty', 8,
      'closeWithin6HoursPenalty', 5,
      'closeWithin24HoursPenalty', 3,
      'closeWithin72HoursPenalty', 1,
      'closeShortNoticeDiscount', 2,
      'closeMaxPenalty', 12,
      'repeatedKickThreshold', 3,
      'repeatedKickPenalty', 1
    )
  );
$$;

insert into public.rating_policy (id, version, policy, reason)
values ('active', 1, public.rankball_default_rating_policy(), '초기 기본 정책')
on conflict (id) do nothing;

create or replace function public.rankball_policy_value(
  p_policy jsonb,
  p_path text[],
  p_fallback numeric,
  p_min numeric,
  p_max numeric
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select greatest(
    p_min,
    least(p_max, coalesce(nullif(p_policy #>> p_path, '')::numeric, p_fallback))
  );
$$;

create or replace function public.rankball_normalize_rating_policy(p_policy jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object(
    'playerMmr', jsonb_build_object(
      'resultScalePercent', public.rankball_policy_value(p_policy, array['playerMmr', 'resultScalePercent'], 100, 25, 200),
      'statScalePercent', public.rankball_policy_value(p_policy, array['playerMmr', 'statScalePercent'], 100, 0, 200),
      'deltaCapPercent', public.rankball_policy_value(p_policy, array['playerMmr', 'deltaCapPercent'], 100, 50, 150),
      'modeScalePercent', jsonb_build_object(
        '1v1', public.rankball_policy_value(p_policy, array['playerMmr', 'modeScalePercent', '1v1'], 100, 50, 150),
        '2v2', public.rankball_policy_value(p_policy, array['playerMmr', 'modeScalePercent', '2v2'], 100, 50, 150),
        '3v3', public.rankball_policy_value(p_policy, array['playerMmr', 'modeScalePercent', '3v3'], 100, 50, 150),
        '5v5', public.rankball_policy_value(p_policy, array['playerMmr', 'modeScalePercent', '5v5'], 100, 50, 150)
      ),
      'integratedScalePercent', jsonb_build_object(
        '1v1', public.rankball_policy_value(p_policy, array['playerMmr', 'integratedScalePercent', '1v1'], 100, 50, 150),
        '2v2', public.rankball_policy_value(p_policy, array['playerMmr', 'integratedScalePercent', '2v2'], 100, 50, 150),
        '3v3', public.rankball_policy_value(p_policy, array['playerMmr', 'integratedScalePercent', '3v3'], 100, 50, 150),
        '5v5', public.rankball_policy_value(p_policy, array['playerMmr', 'integratedScalePercent', '5v5'], 100, 50, 150)
      )
    ),
    'teamMmr', jsonb_build_object(
      'resultScalePercent', public.rankball_policy_value(p_policy, array['teamMmr', 'resultScalePercent'], 100, 25, 200),
      'deltaCapPercent', public.rankball_policy_value(p_policy, array['teamMmr', 'deltaCapPercent'], 100, 50, 150)
    ),
    'trust', jsonb_build_object(
      'matchCompletionReward', public.rankball_policy_value(p_policy, array['trust', 'matchCompletionReward'], 1, 0, 5),
      'foulGrace', public.rankball_policy_value(p_policy, array['trust', 'foulGrace'], 2, 0, 6),
      'foulPenaltyPer', public.rankball_policy_value(p_policy, array['trust', 'foulPenaltyPer'], 1, 0, 5),
      'maxFoulPenalty', public.rankball_policy_value(p_policy, array['trust', 'maxFoulPenalty'], 4, 0, 15),
      'candidateRecorderReward', public.rankball_policy_value(p_policy, array['trust', 'candidateRecorderReward'], 2, 0, 5),
      'refereeReward', public.rankball_policy_value(p_policy, array['trust', 'refereeReward'], 1, 0, 5),
      'thumbsDelta', public.rankball_policy_value(p_policy, array['trust', 'thumbsDelta'], 1, 0, 5),
      'refereeAbsencePenalty', public.rankball_policy_value(p_policy, array['trust', 'refereeAbsencePenalty'], 4, 0, 15),
      'falseCourtReportPenalty', public.rankball_policy_value(p_policy, array['trust', 'falseCourtReportPenalty'], 8, 0, 20),
      'closeWithApplicantsPenalty', public.rankball_policy_value(p_policy, array['trust', 'closeWithApplicantsPenalty'], 2, 0, 10),
      'closeUnreadyPenalty', public.rankball_policy_value(p_policy, array['trust', 'closeUnreadyPenalty'], 2, 0, 10),
      'closeExpiredPenalty', public.rankball_policy_value(p_policy, array['trust', 'closeExpiredPenalty'], 8, 0, 15),
      'closeWithin6HoursPenalty', public.rankball_policy_value(p_policy, array['trust', 'closeWithin6HoursPenalty'], 5, 0, 15),
      'closeWithin24HoursPenalty', public.rankball_policy_value(p_policy, array['trust', 'closeWithin24HoursPenalty'], 3, 0, 15),
      'closeWithin72HoursPenalty', public.rankball_policy_value(p_policy, array['trust', 'closeWithin72HoursPenalty'], 1, 0, 15),
      'closeShortNoticeDiscount', public.rankball_policy_value(p_policy, array['trust', 'closeShortNoticeDiscount'], 2, 0, 10),
      'closeMaxPenalty', public.rankball_policy_value(p_policy, array['trust', 'closeMaxPenalty'], 12, 0, 20),
      'repeatedKickThreshold', public.rankball_policy_value(p_policy, array['trust', 'repeatedKickThreshold'], 3, 2, 10),
      'repeatedKickPenalty', public.rankball_policy_value(p_policy, array['trust', 'repeatedKickPenalty'], 1, 0, 10)
    )
  );
$$;

create or replace function public.rankball_active_rating_policy()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select policy from public.rating_policy where id = 'active'),
    public.rankball_default_rating_policy()
  );
$$;

create or replace function public.rankball_rating_policy_number(
  p_path text[],
  p_fallback numeric,
  p_min numeric,
  p_max numeric
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.rankball_policy_value(
    public.rankball_active_rating_policy(),
    p_path,
    p_fallback,
    p_min,
    p_max
  );
$$;

create or replace function public.rankball_get_rating_policy(
  p_actor_profile_id text,
  p_actor_admin_level integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  policy_row public.rating_policy%rowtype;
  history jsonb := '[]'::jsonb;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 100 then
    raise exception 'owner_permission_required' using errcode = '42501';
  end if;

  select * into policy_row from public.rating_policy where id = 'active';
  select coalesce(jsonb_agg(recent.entry order by recent.created_at desc), '[]'::jsonb)
  into history
  from (
    select jsonb_build_object(
      'id', audit.id,
      'version', coalesce((audit.payload->>'version')::integer, 0),
      'reason', audit.payload->>'reason',
      'createdBy', audit.created_by,
      'createdAt', audit.created_at
    ) as entry, audit.created_at
    from public.admin_audit_log audit
    where audit.type = 'rating_policy_update'
    order by audit.created_at desc
    limit 8
  ) recent;

  return jsonb_build_object(
    'ok', true,
    'policy', coalesce(policy_row.policy, public.rankball_default_rating_policy()),
    'defaults', public.rankball_default_rating_policy(),
    'version', coalesce(policy_row.version, 1),
    'reason', policy_row.reason,
    'updatedBy', policy_row.updated_by,
    'updatedAt', policy_row.updated_at,
    'history', history
  );
end;
$$;

create or replace function public.rankball_update_rating_policy(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_expected_version integer,
  p_policy jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.rating_policy%rowtype;
  normalized_policy jsonb;
  safe_reason text := nullif(btrim(p_reason), '');
  next_version integer;
  now_at timestamptz := now();
  audit_id text;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 100 then
    raise exception 'owner_permission_required' using errcode = '42501';
  end if;
  if safe_reason is null or char_length(safe_reason) < 4 or char_length(safe_reason) > 160 then
    raise exception 'rating_policy_reason_required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_policy) <> 'object' then
    raise exception 'invalid_rating_policy' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  select * into current_row from public.rating_policy where id = 'active' for update;
  if current_row.id is null then
    raise exception 'rating_policy_missing' using errcode = 'P0002';
  end if;
  if p_expected_version is null or p_expected_version <> current_row.version then
    raise exception 'rating_policy_stale_version' using errcode = '40001';
  end if;

  normalized_policy := public.rankball_normalize_rating_policy(p_policy);
  if normalized_policy <> p_policy then
    raise exception 'invalid_rating_policy' using errcode = '22023';
  end if;

  next_version := current_row.version + 1;
  update public.rating_policy
  set
    version = next_version,
    policy = normalized_policy,
    reason = safe_reason,
    updated_by = p_actor_profile_id,
    updated_at = now_at
  where id = 'active';

  audit_id := 'aa_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.admin_audit_log (
    id, type, status, created_by, payload, created_at
  ) values (
    audit_id,
    'rating_policy_update',
    'committed',
    p_actor_profile_id,
    jsonb_build_object(
      'version', next_version,
      'reason', safe_reason,
      'before', current_row.policy,
      'after', normalized_policy
    ),
    now_at
  );

  return public.rankball_get_rating_policy(p_actor_profile_id, p_actor_admin_level);
end;
$$;

create or replace function public.rankball_match_auto_finalize_action(
  p_match_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  now_at timestamptz := coalesce(p_now, now());
  current_match public.matches%rowtype;
  tournament_lock_id text;
  operator_id text;
begin
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  select nullif(btrim(match.tournament_id), '') into tournament_lock_id
  from public.matches match where match.id = safe_match_id;
  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(tournament_lock_id));
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status = 'confirmed' and current_match.rating_result is not null then
    return jsonb_build_object('ok', true, 'matchId', safe_match_id, 'alreadyConfirmed', true, 'ratingAtomic', true);
  end if;
  if current_match.status <> 'approval'
     or current_match.ended_at is null
     or current_match.dispute_draft_result is not null
     or current_match.confirmed_at is not null
     or current_match.rating_result is not null then
    raise exception 'match_auto_finalization_locked' using errcode = '23514';
  end if;
  if now_at <= current_match.ended_at + make_interval(mins => greatest(1, least(60, coalesce(current_match.dispute_minutes, 30)))) then
    raise exception 'match_auto_finalization_not_due' using errcode = '23514';
  end if;
  if not exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_result_missing' using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select player.user_id, player.side
      from public.match_players player
      where player.match_id = safe_match_id and player.side in ('teamA', 'teamB') and nullif(btrim(player.user_id), '') is not null
      union
      select played.value, 'teamA'
      from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end) played(value)
      union
      select played.value, 'teamB'
      from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end) played(value)
    ) actual_players
    group by user_id
    having count(distinct side) > 1
  ) then
    raise exception 'match_actual_roster_ambiguous' using errcode = '23514';
  end if;

  insert into public.match_approvals (match_id, user_id, side)
  select safe_match_id, actual_player.user_id, actual_player.side
  from (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id and player.side in ('teamA', 'teamB') and nullif(btrim(player.user_id), '') is not null
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end) played(value)
    where nullif(btrim(played.value), '') is not null
  ) actual_player
  on conflict (match_id, user_id) do update set side = excluded.side;

  operator_id := coalesce(
    nullif(btrim(current_match.referee_id), ''),
    nullif(btrim(current_match.created_by), ''),
    (select player.user_id from public.match_players player where player.match_id = safe_match_id order by player.slot_order, player.user_id limit 1)
  );
  if operator_id is null then raise exception 'match_auto_finalization_operator_missing' using errcode = '23514'; end if;

  return public.rankball_match_finalize_locked(operator_id, safe_match_id, 'autoConfirmMatch');
end;
$$;

revoke all on function public.rankball_default_rating_policy() from public, anon, authenticated;
revoke all on function public.rankball_policy_value(jsonb, text[], numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.rankball_normalize_rating_policy(jsonb) from public, anon, authenticated;
revoke all on function public.rankball_active_rating_policy() from public, anon, authenticated;
revoke all on function public.rankball_rating_policy_number(text[], numeric, numeric, numeric) from public, anon, authenticated;
revoke all on function public.rankball_get_rating_policy(text, integer) from public, anon, authenticated;
revoke all on function public.rankball_update_rating_policy(text, integer, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.rankball_match_auto_finalize_action(text, timestamptz) from public, anon, authenticated;
grant execute on function public.rankball_get_rating_policy(text, integer) to service_role;
grant execute on function public.rankball_update_rating_policy(text, integer, integer, jsonb, text) to service_role;
grant execute on function public.rankball_match_auto_finalize_action(text, timestamptz) to service_role;

do $migration$
declare
  function_definition text;
  old_text text := $old$values
      ('rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)')$old$;
  new_text text := $new$values
      ('rankball_get_rating_policy', 'public.rankball_get_rating_policy(text,integer)'),
      ('rankball_update_rating_policy', 'public.rankball_update_rating_policy(text,integer,integer,jsonb,text)'),
      ('rankball_match_auto_finalize_action', 'public.rankball_match_auto_finalize_action(text,timestamp with time zone)'),
      ('rankball_approve_court_request', 'public.rankball_approve_court_request(text,integer,text)')$new$;
begin
  function_definition := pg_get_functiondef('public.rankball_rpc_grant_health()'::regprocedure);
  if position(old_text in function_definition) = 0 then
    raise exception 'rating_policy_rpc_health_shape_changed';
  end if;
  execute replace(function_definition, old_text, new_text);
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_text text := $old$('admin_disciplinary_actions')$old$;
  new_text text := $new$('admin_disciplinary_actions'),
      ('rating_policy')$new$;
  occurrence_count integer;
begin
  function_definition := pg_get_functiondef('public.rankball_rls_policy_health()'::regprocedure);
  occurrence_count := (length(function_definition) - length(replace(function_definition, old_text, ''))) / length(old_text);
  if occurrence_count <> 4 then
    raise exception 'rating_policy_rls_health_shape_changed';
  end if;
  execute replace(function_definition, old_text, new_text);
end;
$migration$;

-- Patch the current authoritative reducers in place. Every replacement is shape-guarded.
do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef('public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure);

  old_text := $old$mode_weight := case current_match.mode when '1v1' then 0.78 when '2v2' then 0.9 when '3v3' then 1 else 1.12 end;$old$;
  new_text := $new$mode_weight := (case current_match.mode when '1v1' then 0.78 when '2v2' then 0.9 when '3v3' then 1 else 1.12 end)
    * public.rankball_rating_policy_number(array['playerMmr', 'resultScalePercent'], 100, 25, 200) / 100
    * public.rankball_rating_policy_number(array['playerMmr', 'modeScalePercent', case when current_match.mode in ('1v1', '2v2', '3v3', '5v5') then current_match.mode else '5v5' end], 100, 50, 150) / 100;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_mode_weight_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$integrated_weight := case current_match.mode when '1v1' then 0.25 when '2v2' then 0.45 when '3v3' then 0.85 else 1.35 end;$old$;
  new_text := $new$integrated_weight := (case current_match.mode when '1v1' then 0.25 when '2v2' then 0.45 when '3v3' then 0.85 else 1.35 end)
    * public.rankball_rating_policy_number(array['playerMmr', 'integratedScalePercent', case when current_match.mode in ('1v1', '2v2', '3v3', '5v5') then current_match.mode else '5v5' end], 100, 50, 150) / 100;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_integrated_weight_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$mode_cap := case current_match.mode when '1v1' then 25 when '2v2' then 28 when '3v3' then 32 else case when current_match.official then 50 else 40 end end;$old$;
  new_text := $new$mode_cap := (case current_match.mode when '1v1' then 25 when '2v2' then 28 when '3v3' then 32 else case when current_match.official then 50 else 40 end end)
    * public.rankball_rating_policy_number(array['playerMmr', 'deltaCapPercent'], 100, 50, 150) / 100;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_mode_cap_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$integrated_cap := case current_match.mode when '1v1' then 8 when '2v2' then 14 when '3v3' then 25 else case when current_match.official then 55 else 45 end end;$old$;
  new_text := $new$integrated_cap := (case current_match.mode when '1v1' then 8 when '2v2' then 14 when '3v3' then 25 else case when current_match.official then 55 else 45 end end)
    * public.rankball_rating_policy_number(array['playerMmr', 'deltaCapPercent'], 100, 50, 150) / 100;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_integrated_cap_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$coalesce(player.points, 0) * 0.035 + coalesce(player.rebounds, 0) * 0.055 + coalesce(player.assists, 0) * 0.055 + coalesce(player.steals, 0) * 0.08 + coalesce(player.blocks, 0) * 0.08$old$;
  new_text := $new$(coalesce(player.points, 0) * 0.035 + coalesce(player.rebounds, 0) * 0.055 + coalesce(player.assists, 0) * 0.055 + coalesce(player.steals, 0) * 0.08 + coalesce(player.blocks, 0) * 0.08)
      * public.rankball_rating_policy_number(array['playerMmr', 'statScalePercent'], 100, 0, 200) / 100$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_stat_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$mode_delta := round(greatest(-48, least(48, (mode_delta + stat_boost) * mercenary_factor)), 1);$old$;
  new_text := $new$mode_delta := round(greatest(
      -48 * public.rankball_rating_policy_number(array['playerMmr', 'deltaCapPercent'], 100, 50, 150) / 100,
      least(48 * public.rankball_rating_policy_number(array['playerMmr', 'deltaCapPercent'], 100, 50, 150) / 100, (mode_delta + stat_boost) * mercenary_factor)
    ), 1);$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_outer_cap_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$trust_delta := 1 - least(4, greatest(0, coalesce(player.fouls, 0) - 2));$old$;
  new_text := $new$trust_delta := public.rankball_rating_policy_number(array['trust', 'matchCompletionReward'], 1, 0, 5)::integer
      - least(
          public.rankball_rating_policy_number(array['trust', 'maxFoulPenalty'], 4, 0, 15)::integer,
          greatest(0, coalesce(player.fouls, 0) - public.rankball_rating_policy_number(array['trust', 'foulGrace'], 2, 0, 6)::integer)
            * public.rankball_rating_policy_number(array['trust', 'foulPenaltyPer'], 1, 0, 5)::integer
        );$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_trust_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$coalesce(profile.trust_score, 80) + 1 - least(4, greatest(0, coalesce(stat.fouls, 0) - 2))$old$;
  new_text := $new$coalesce(profile.trust_score, 80)
          + public.rankball_rating_policy_number(array['trust', 'matchCompletionReward'], 1, 0, 5)::integer
          - least(
              public.rankball_rating_policy_number(array['trust', 'maxFoulPenalty'], 4, 0, 15)::integer,
              greatest(0, coalesce(stat.fouls, 0) - public.rankball_rating_policy_number(array['trust', 'foulGrace'], 2, 0, 6)::integer)
                * public.rankball_rating_policy_number(array['trust', 'foulPenaltyPer'], 1, 0, 5)::integer
            )$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_unranked_trust_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$select value->>'by' as recorder_id, 2 as delta$old$;
  new_text := $new$select value->>'by' as recorder_id, public.rankball_rating_policy_number(array['trust', 'candidateRecorderReward'], 2, 0, 5)::integer as delta$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_recorder_reward_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$union all select current_match.referee_id, 1 where current_match.referee_id is not null$old$;
  new_text := $new$union all select current_match.referee_id, public.rankball_rating_policy_number(array['trust', 'refereeReward'], 1, 0, 5)::integer where current_match.referee_id is not null$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_referee_reward_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);

  old_text := $old$team_delta := round(greatest(-34, least(34, 24 * (team_actual - (1 / (1 + power(10::numeric, (opponent_team_avg - team_row.mmr) / 400)))) * quality)), 1);$old$;
  new_text := $new$team_delta := round(greatest(
      -34 * public.rankball_rating_policy_number(array['teamMmr', 'deltaCapPercent'], 100, 50, 150) / 100,
      least(
        34 * public.rankball_rating_policy_number(array['teamMmr', 'deltaCapPercent'], 100, 50, 150) / 100,
        24 * public.rankball_rating_policy_number(array['teamMmr', 'resultScalePercent'], 100, 25, 200) / 100
          * (team_actual - (1 / (1 + power(10::numeric, (opponent_team_avg - team_row.mmr) / 400)))) * quality
      )
    ), 1);$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_finalize_team_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  execute function_definition;

  function_definition := pg_get_functiondef('public.rankball_match_thumbs_action(text,text,jsonb)'::regprocedure);
  old_text := $old$coalesce(trust_score, 80) + 1$old$;
  new_text := $new$coalesce(trust_score, 80) + public.rankball_rating_policy_number(array['trust', 'thumbsDelta'], 1, 0, 5)::integer$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_thumbs_reward_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$coalesce(trust_score, 80) - 1$old$;
  new_text := $new$coalesce(trust_score, 80) - public.rankball_rating_policy_number(array['trust', 'thumbsDelta'], 1, 0, 5)::integer$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_thumbs_rollback_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  execute function_definition;

  function_definition := pg_get_functiondef('public.rankball_match_referee_absence_action(text,text,text)'::regprocedure);
  old_text := $old$coalesce(trust_score, 80) - 4$old$;
  new_text := $new$coalesce(trust_score, 80) - public.rankball_rating_policy_number(array['trust', 'refereeAbsencePenalty'], 4, 0, 15)::integer$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_referee_absence_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  execute function_definition;

  function_definition := pg_get_functiondef('public.rankball_recruiting_close_action(text,text)'::regprocedure);
  old_text := $old$penalty := case when application_count > 0 then 2 else 0 end;$old$;
  new_text := $new$penalty := case when application_count > 0 then public.rankball_rating_policy_number(array['trust', 'closeWithApplicantsPenalty'], 2, 0, 10)::integer else 0 end;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_close_applicant_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$penalty := penalty + 2;$old$;
  new_text := $new$penalty := penalty + public.rankball_rating_policy_number(array['trust', 'closeUnreadyPenalty'], 2, 0, 10)::integer;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_close_unready_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$when hours_until < 0 then 8
      when hours_until <= 6 then 5
      when hours_until <= 24 then 3
      when hours_until <= 72 then 1$old$;
  new_text := $new$when hours_until < 0 then public.rankball_rating_policy_number(array['trust', 'closeExpiredPenalty'], 8, 0, 15)::integer
      when hours_until <= 6 then public.rankball_rating_policy_number(array['trust', 'closeWithin6HoursPenalty'], 5, 0, 15)::integer
      when hours_until <= 24 then public.rankball_rating_policy_number(array['trust', 'closeWithin24HoursPenalty'], 3, 0, 15)::integer
      when hours_until <= 72 then public.rankball_rating_policy_number(array['trust', 'closeWithin72HoursPenalty'], 1, 0, 15)::integer$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_close_time_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$penalty := greatest(0, penalty - 2);$old$;
  new_text := $new$penalty := greatest(0, penalty - public.rankball_rating_policy_number(array['trust', 'closeShortNoticeDiscount'], 2, 0, 10)::integer);$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_close_discount_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$penalty := least(12, penalty);$old$;
  new_text := $new$penalty := least(public.rankball_rating_policy_number(array['trust', 'closeMaxPenalty'], 12, 0, 20)::integer, penalty);$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_close_cap_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  execute function_definition;

  function_definition := pg_get_functiondef('public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure);
  old_text := $old$trust_required := case when active_count + 1 >= 3 then 1 else 0 end;$old$;
  new_text := $new$trust_required := case
      when active_count + 1 >= public.rankball_rating_policy_number(array['trust', 'repeatedKickThreshold'], 3, 2, 10)::integer
        then public.rankball_rating_policy_number(array['trust', 'repeatedKickPenalty'], 1, 0, 10)::integer
      else 0
    end;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_kick_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  execute function_definition;

  function_definition := pg_get_functiondef('public.rankball_report_court_request(text,text,text)'::regprocedure);
  old_text := $old$next_trust integer;$old$;
  new_text := $new$next_trust integer;
  trust_penalty integer := public.rankball_rating_policy_number(array['trust', 'falseCourtReportPenalty'], 8, 0, 20)::integer;$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_court_declare_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$coalesce(trust_score, 80) - 8$old$;
  new_text := $new$coalesce(trust_score, 80) - trust_penalty$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_court_penalty_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$'trustPenalty', 8$old$;
  new_text := $new$'trustPenalty', trust_penalty$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_court_payload_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  old_text := $old$'허위 구장 신고로 신뢰도 8점이 차감되었습니다. 현재 '$old$;
  new_text := $new$'허위 구장 신고로 신뢰도 ' || trust_penalty::text || '점이 차감되었습니다. 현재 '$new$;
  if position(old_text in function_definition) = 0 then raise exception 'rating_policy_court_notice_shape_changed'; end if;
  function_definition := replace(function_definition, old_text, new_text);
  execute function_definition;
end;
$migration$;

-- Serialize policy changes against rating finalization.
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
  tournament_lock_id text;
  team_mmr_snapshot jsonb := '{}'::jsonb;
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'missing_match_actor' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  select nullif(btrim(match.tournament_id), '') into tournament_lock_id
  from public.matches match where match.id = safe_match_id;
  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(tournament_lock_id));
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  perform profile.id
  from public.profiles profile
  where profile.id in (
    select distinct player_id from (
      select player.user_id as player_id from public.match_players player
      where player.match_id = safe_match_id and nullif(btrim(player.user_id), '') is not null
      union all
      select played.value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array' then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value) where nullif(btrim(played.value), '') is not null
      union all
      select played.value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array' then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value) where nullif(btrim(played.value), '') is not null
    ) actual_profiles
  )
  order by profile.id
  for update;

  perform team.id
  from public.teams team
  where team.id in (
    select distinct team_id from (
      select player.team_id from public.match_players player
      where player.match_id = safe_match_id and nullif(btrim(player.team_id), '') is not null
      union all select current_match.team_a_id
      union all select current_match.team_b_id
    ) actual_teams
    where nullif(btrim(team_id), '') is not null
  )
  order by team.id
  for update;

  select coalesce(jsonb_object_agg(team.id, coalesce(team.mmr, 1200)), '{}'::jsonb)
  into team_mmr_snapshot
  from public.teams team
  where team.id in (
    select distinct player.team_id from public.match_players player
    where player.match_id = safe_match_id and nullif(btrim(player.team_id), '') is not null
  );
  perform set_config('rankball.team_mmr_snapshot', team_mmr_snapshot::text, true);

  return public.rankball_match_finalize_locked_concurrency_inner(safe_actor_id, safe_match_id, p_action);
end;
$$;

revoke all on function public.rankball_match_finalize_locked(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
