begin;

alter table public.match_results
  add column if not exists final_submitted_by text,
  add column if not exists final_submitted_at timestamptz;

create index if not exists match_results_final_submitted_at_idx
  on public.match_results (final_submitted_at);

update public.match_results result
set final_submitted_by = coalesce(
      nullif(btrim(result.submitted_by), ''),
      nullif(btrim(match_row.referee_id), ''),
      nullif(btrim(match_row.created_by), '')
    ),
    final_submitted_at = greatest(
      coalesce(result.submitted_at, match_row.ended_at),
      match_row.ended_at
    )
from public.matches match_row
where match_row.id = result.match_id
  and match_row.ended_at is not null
  and match_row.status in ('approval', 'disputed')
  and coalesce(match_row.rules ->> 'recordType', 'standard') not in ('match_record', 'personal_record', 'solo')
  and result.final_submitted_at is null;

update public.matches match_row
set status = 'approval',
    updated_at = clock_timestamp()
where match_row.status = 'agreed'
  and match_row.ended_at is not null
  and coalesce(match_row.rules ->> 'recordType', 'standard') not in ('match_record', 'personal_record', 'solo')
  and exists (
    select 1
    from public.match_results result
    where result.match_id = match_row.id
      and result.final_submitted_at is not null
  );

do $migration$
begin
  if to_regprocedure('public.rankball_match_result_action_pre_explicit_final_submission(text,text,jsonb)') is null
     and to_regprocedure('public.rankball_match_result_action(text,text,jsonb)') is not null then
    alter function public.rankball_match_result_action(text, text, jsonb)
      rename to rankball_match_result_action_pre_explicit_final_submission;
  end if;
end
$migration$;

-- 이름이 바뀐 구형 구현은 wrapper 내부 전용이다. 직접 호출하면 final marker 검증을 우회한다.
revoke all on function public.rankball_match_result_action_pre_explicit_final_submission(text, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.rankball_match_result_action(
  p_actor_profile_id text,
  p_match_id text,
  p_result jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_result jsonb := coalesce(p_result, '{}'::jsonb);
  match_row public.matches%rowtype;
  result_row public.match_results%rowtype;
  core_result jsonb;
  score_a_value integer;
  score_b_value integer;
  period_item jsonb;
  normalized_period_scores jsonb := '[]'::jsonb;
  allowed_labels text[];
  period_index integer := 0;
  period_score_a_sum integer := 0;
  period_score_b_sum integer := 0;
  submitted_at_value timestamptz := clock_timestamp();
  is_standard_match boolean;
  is_explicit_final_submission boolean := coalesce(safe_result ->> 'finalSubmission', 'false') = 'true';
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'actor_id and match_id are required';
  end if;

  if jsonb_typeof(safe_result) <> 'object' then
    raise exception 'result must be a JSON object';
  end if;

  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform pg_advisory_xact_lock(hashtextextended(safe_match_id, 0));

  select *
    into match_row
  from public.matches
  where id = safe_match_id
  for update;

  if not found then
    raise exception 'match not found';
  end if;

  select *
    into result_row
  from public.match_results
  where match_id = safe_match_id
  for update;

  is_standard_match := coalesce(match_row.rules ->> 'recordType', 'standard')
    not in ('match_record', 'personal_record', 'solo');

  if is_explicit_final_submission and (
       not is_standard_match
       or match_row.status is distinct from 'agreed'
       or match_row.ended_at is null
       or result_row.final_submitted_at is not null
     ) then
    raise exception 'final result submission is not allowed in the current match phase';
  end if;

  if is_standard_match
     and match_row.status = 'agreed'
     and match_row.ended_at is not null
     and result_row.final_submitted_at is null
     and not is_explicit_final_submission then
    raise exception 'explicit final result submission is required';
  end if;

  if is_explicit_final_submission
     and is_standard_match
     and match_row.status = 'agreed'
     and match_row.ended_at is not null
     and result_row.final_submitted_at is null
     and nullif(btrim(match_row.referee_id), '') is null then
    if safe_actor_id is distinct from match_row.created_by then
      raise exception 'only the host can submit a no-referee final result';
    end if;

    if coalesce(safe_result ->> 'scoreA', '') !~ '^[0-9]{1,3}$'
       or coalesce(safe_result ->> 'scoreB', '') !~ '^[0-9]{1,3}$' then
      raise exception 'canonical final scores are required';
    end if;

    score_a_value := (safe_result ->> 'scoreA')::integer;
    score_b_value := (safe_result ->> 'scoreB')::integer;

    if score_a_value is distinct from match_row.score_a
       or score_b_value is distinct from match_row.score_b then
      raise exception 'the no-referee final result must match the canonical score';
    end if;

    if safe_result ? 'periodScores' then
      if jsonb_typeof(safe_result -> 'periodScores') <> 'array' then
        raise exception 'invalid_match_period_scores' using errcode = '22023';
      end if;

      allowed_labels := case coalesce(match_row.rules ->> 'periodCount', '')
        when '2' then array['1H', '2H', 'OT']
        when '1' then array['REG', 'OT']
        else array['1Q', '2Q', '3Q', '4Q', 'OT']
      end;
      if jsonb_array_length(safe_result -> 'periodScores') > cardinality(allowed_labels) then
        raise exception 'invalid_match_period_scores' using errcode = '22023';
      end if;

      for period_item in select value from jsonb_array_elements(safe_result -> 'periodScores') loop
        period_index := period_index + 1;
        if jsonb_typeof(period_item) <> 'object'
           or nullif(btrim(period_item ->> 'label'), '') is distinct from allowed_labels[period_index]
           or coalesce(period_item ->> 'scoreA', '') !~ '^[0-9]{1,3}$'
           or coalesce(period_item ->> 'scoreB', '') !~ '^[0-9]{1,3}$' then
          raise exception 'invalid_match_period_scores' using errcode = '22023';
        end if;
        period_score_a_sum := period_score_a_sum + (period_item ->> 'scoreA')::integer;
        period_score_b_sum := period_score_b_sum + (period_item ->> 'scoreB')::integer;
        normalized_period_scores := normalized_period_scores || jsonb_build_array(jsonb_build_object(
          'label', allowed_labels[period_index],
          'scoreA', (period_item ->> 'scoreA')::integer,
          'scoreB', (period_item ->> 'scoreB')::integer
        ));
      end loop;

      if period_index > 0 and (
        period_score_a_sum <> match_row.score_a or period_score_b_sum <> match_row.score_b
      ) then
        raise exception 'match_period_score_total_mismatch' using errcode = '23514';
      end if;
    else
      normalized_period_scores := coalesce(result_row.period_scores, '[]'::jsonb);
    end if;

    insert into public.match_results (
      match_id,
      submitted_by,
      score_a,
      score_b,
      period_scores,
      stat_submissions,
      submitted_at,
      final_submitted_by,
      final_submitted_at
    ) values (
      safe_match_id,
      safe_actor_id,
      match_row.score_a,
      match_row.score_b,
      normalized_period_scores,
      coalesce(result_row.stat_submissions, '{}'::jsonb),
      coalesce(result_row.submitted_at, submitted_at_value),
      safe_actor_id,
      submitted_at_value
    )
    on conflict (match_id) do update
    set submitted_by = excluded.submitted_by,
        score_a = excluded.score_a,
        score_b = excluded.score_b,
        period_scores = excluded.period_scores,
        final_submitted_by = excluded.final_submitted_by,
        final_submitted_at = excluded.final_submitted_at;

    delete from public.match_approvals
    where match_id = safe_match_id;

    update public.matches
    set status = 'approval',
        updated_at = submitted_at_value
    where id = safe_match_id;

    return jsonb_build_object(
      'ok', true,
      'status', 'approval',
      'matchId', safe_match_id,
      'submittedBy', safe_actor_id,
      'submittedAt', coalesce(result_row.submitted_at, submitted_at_value),
      'finalSubmittedBy', safe_actor_id,
      'finalSubmittedAt', submitted_at_value,
      'scoreA', match_row.score_a,
      'scoreB', match_row.score_b,
      'periodScores', normalized_period_scores
    );
  end if;

  core_result := public.rankball_match_result_action_pre_explicit_final_submission(
    safe_actor_id,
    safe_match_id,
    safe_result - 'finalSubmission'
  );

  if is_explicit_final_submission
     and is_standard_match
     and match_row.status = 'agreed'
     and match_row.ended_at is not null
     and result_row.final_submitted_at is null then
    update public.match_results
    set final_submitted_by = safe_actor_id,
        final_submitted_at = submitted_at_value
    where match_id = safe_match_id
      and final_submitted_at is null;

    update public.matches
    set status = 'approval',
        updated_at = submitted_at_value
    where id = safe_match_id;

    core_result := coalesce(core_result, '{}'::jsonb) || jsonb_build_object(
      'status', 'approval',
      'finalSubmittedBy', safe_actor_id,
      'finalSubmittedAt', submitted_at_value
    );
  end if;

  return core_result;
end
$function$;

revoke all on function public.rankball_match_result_action(text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.rankball_match_result_action(text, text, jsonb) to service_role;

create or replace function public.rankball_recorder_match_page(
  p_profile_id text,
  p_limit integer default 40,
  p_cursor text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  safe_profile_id text := nullif(btrim(p_profile_id), '');
  safe_limit integer := greatest(1, least(coalesce(p_limit, 40), 80));
  safe_cursor text := nullif(btrim(p_cursor), '');
  cursor_payload text;
  cursor_separator integer;
  cursor_created_at timestamptz;
  cursor_id text;
  selected_ids text[];
  selected_created_ats timestamptz[];
  page_ids text[];
  has_more boolean;
begin
  if safe_profile_id is null then
    raise exception 'profile_id is required';
  end if;

  perform public.rankball_assert_match_actor_active(safe_profile_id);

  -- 배포 전환 중 첫 페이지용 구형 cursor만 허용하고, 다음 페이지는 immutable keyset을 쓴다.
  if safe_cursor is not null and safe_cursor <> 'mine:0' then
    if left(safe_cursor, 5) <> 'play:' then
      raise exception 'invalid recorder cursor';
    end if;
    cursor_payload := substring(safe_cursor from 6);
    cursor_separator := strpos(cursor_payload, '|');
    if cursor_separator <= 1 or cursor_separator >= length(cursor_payload) then
      raise exception 'invalid recorder cursor';
    end if;
    begin
      cursor_created_at := left(cursor_payload, cursor_separator - 1)::timestamptz;
    exception when others then
      raise exception 'invalid recorder cursor';
    end;
    cursor_id := nullif(substring(cursor_payload from cursor_separator + 1), '');
    if cursor_id is null then
      raise exception 'invalid recorder cursor';
    end if;
  end if;

  select
    coalesce(array_agg(page.id order by page.sort_at desc, page.id desc), array[]::text[]),
    coalesce(array_agg(page.sort_at order by page.sort_at desc, page.id desc), array[]::timestamptz[])
    into selected_ids, selected_created_ats
  from (
    select
      match_row.id,
      coalesce(match_row.created_at, '-infinity'::timestamptz) as sort_at
    from public.matches match_row
    left join public.match_results result on result.match_id = match_row.id
    where (
        match_row.created_by = safe_profile_id
        or match_row.referee_id = safe_profile_id
        or exists (
          select 1
          from public.match_players player
          where player.match_id = match_row.id
            and player.user_id = safe_profile_id
        )
        or coalesce(match_row.played_player_ids -> 'teamA', '[]'::jsonb) ? safe_profile_id
        or coalesce(match_row.played_player_ids -> 'teamB', '[]'::jsonb) ? safe_profile_id
        or coalesce(match_row.reserve_players -> 'teamA', '[]'::jsonb) ? safe_profile_id
        or coalesce(match_row.reserve_players -> 'teamB', '[]'::jsonb) ? safe_profile_id
      )
      and coalesce(match_row.rules ->> 'recordType', 'standard') not in ('personal_record', 'solo')
      and match_row.status in ('agreed', 'approval', 'disputed')
      and (
        (
          match_row.status = 'disputed'
          and exists (
            select 1
            from public.match_disputes dispute
            where dispute.match_id = match_row.id
              and dispute.status = 'open'
          )
        )
        or (match_row.started_at is not null and match_row.ended_at is null)
        or (match_row.ended_at is not null and result.final_submitted_at is null)
        or (
          result.final_submitted_at is not null
          and match_row.status in ('approval', 'disputed')
          and (
            exists (
              select 1
              from public.match_disputes dispute
              where dispute.match_id = match_row.id
                and dispute.status = 'open'
            )
            or clock_timestamp() <= greatest(match_row.ended_at, result.final_submitted_at)
              + make_interval(
                  mins => case
                    when match_row.dispute_minutes in (10, 15, 20) then match_row.dispute_minutes
                    else 15
                  end
                )
          )
        )
        or (
          match_row.status in ('approval', 'disputed')
          and result.final_submitted_at is null
        )
      )
      and (
        cursor_created_at is null
        or coalesce(match_row.created_at, '-infinity'::timestamptz) < cursor_created_at
        or (
          coalesce(match_row.created_at, '-infinity'::timestamptz) = cursor_created_at
          and match_row.id < cursor_id
        )
      )
    order by coalesce(match_row.created_at, '-infinity'::timestamptz) desc, match_row.id desc
    limit safe_limit + 1
  ) page;

  has_more := cardinality(selected_ids) > safe_limit;
  page_ids := selected_ids[1:least(cardinality(selected_ids), safe_limit)];

  return jsonb_build_object(
    'ids', to_jsonb(coalesce(page_ids, array[]::text[])),
    'cursor', case when has_more then
      'play:' || selected_created_ats[safe_limit]::text || '|' || selected_ids[safe_limit]
      else null
    end,
    'exhausted', not has_more
  );
end
$function$;

revoke all on function public.rankball_recorder_match_page(text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.rankball_recorder_match_page(text, integer, text) to service_role;

-- 결과 행 생성 시각이 아니라 명시적 최종 제출 시각부터 확정 창을 계산한다.
do $patch$
declare
  function_definition text;
  old_result_guard constant text := $old$or not exists (select 1 from public.match_results result where result.match_id = safe_match_id) then$old$;
  new_result_guard constant text := $new$or not exists (
       select 1 from public.match_results result
       where result.match_id = safe_match_id
         and result.final_submitted_at is not null
     ) then$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_no_dispute_action(text,text)'::regprocedure
  );
  if position(new_result_guard in function_definition) = 0 then
    if position(old_result_guard in function_definition) = 0 then
      raise exception 'match_no_dispute_final_submission_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_result_guard, new_result_guard);
  end if;
end;
$patch$;

do $patch$
declare
  function_definition text;
  old_select constant text := $old$select result.submitted_at into submitted_at$old$;
  new_select constant text := $new$select result.final_submitted_at into submitted_at$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_finalize_locked(text,text,text,boolean)'::regprocedure
  );
  if position(new_select in function_definition) = 0 then
    if position(old_select in function_definition) = 0 then
      raise exception 'match_manual_finalize_final_submission_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_select, new_select);
  end if;
end;
$patch$;

do $patch$
declare
  function_definition text;
  old_window constant text := $old$greatest(result_row.submitted_at, current_match.ended_at)$old$;
  new_window constant text := $new$greatest(result_row.final_submitted_at, current_match.ended_at)$new$;
  old_lock_guard constant text := $old$or current_match.rating_result is not null then$old$;
  new_lock_guard constant text := $new$or current_match.rating_result is not null
     or result_row.final_submitted_at is null then$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_auto_finalize_action(text,timestamptz)'::regprocedure
  );
  if position(new_window in function_definition) = 0 then
    if position(old_window in function_definition) = 0 then
      raise exception 'match_auto_finalize_final_submission_window_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_window, new_window);
  end if;
  if position('or result_row.final_submitted_at is null then' in function_definition) = 0 then
    if position(old_lock_guard in function_definition) = 0 then
      raise exception 'match_auto_finalize_final_submission_guard_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_lock_guard, new_lock_guard);
  end if;
  execute function_definition;
end;
$patch$;

select pg_notify('pgrst', 'reload schema');

commit;
