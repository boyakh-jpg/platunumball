-- The host's final queue decision confirms the match immediately.
-- Participant reapproval is not required after every open dispute is resolved.

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure
  );

  if position('match_dispute_host_required' in function_definition) = 0 then
    old_text := $old$  -- Dispute resolution remains the documented current-referee-or-host exception to reapproval.
  if current_match.status = 'disputed' then
    if not actor_is_operator then
      raise exception 'match_dispute_operator_required' using errcode = '42501';
    end if;
  else$old$;
    new_text := $new$  -- The last queue decision is the host's final ruling. It does not create a new approval round.
  if current_match.status = 'disputed' then
    if p_action = 'resolveMatchDispute' then
      if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '') then
        raise exception 'match_dispute_host_required' using errcode = '42501';
      end if;
      if exists (
        select 1
        from public.match_disputes dispute
        where dispute.match_id = safe_match_id
          and dispute.status = 'open'
      ) then
        raise exception 'match_dispute_items_open' using errcode = '23514';
      end if;
    elsif not actor_is_operator then
      raise exception 'match_dispute_operator_required' using errcode = '42501';
    end if;
  else$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_dispute_finalize_guard_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
    execute function_definition;
  end if;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_resolve_dispute_action(text,text,text,text)'::regprocedure
  );

  if position('''reapprovalRequired'', false' in function_definition) = 0 then
    old_text := $old$  decision_label text;
  now_at timestamptz := now();$old$;
    new_text := $new$  decision_label text;
  tournament_lock_id text;
  finalize_result jsonb := '{}'::jsonb;
  now_at timestamptz := now();$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_dispute_finalize_declaration_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;$old$;
    new_text := $new$  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  select nullif(btrim(match.tournament_id), '') into tournament_lock_id
  from public.matches match
  where match.id = safe_match_id;
  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(tournament_lock_id));
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match from public.matches where id = safe_match_id for update;$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_dispute_finalize_lock_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    delete from public.match_approvals where match_id = safe_match_id;

    update public.matches
    set status = 'approval', score_a = result_score_a, score_b = result_score_b,
        dispute_draft_result = null, dispute_draft_updated_at = null,
        dispute_resolved_at = now_at, updated_at = now_at
    where id = safe_match_id;$old$;
    new_text := $new$    update public.matches
    set status = 'disputed', score_a = result_score_a, score_b = result_score_b,
        dispute_draft_result = working_draft, dispute_draft_updated_at = now_at,
        dispute_resolved_at = now_at, updated_at = now_at
    where id = safe_match_id;$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_dispute_finalize_status_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$  ) on conflict (id) do nothing;

  if open_count = 0 then
    insert into public.notifications ($old$;
    new_text := $new$  ) on conflict (id) do nothing;

  if open_count = 0 then
    finalize_result := public.rankball_match_finalize_locked(
      safe_actor_id,
      safe_match_id,
      'resolveMatchDispute'
    );
  end if;

  if open_count = 0 then
    insert into public.notifications ($new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_dispute_finalize_call_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$      recipient_id, recipient_id, '결과 재승인 필요',
      current_match.title || ' 이의제기 처리가 끝났습니다. 변경된 결과를 다시 승인해 주세요.',
      'orange', 'match', safe_match_id,
      jsonb_build_object('matchId', safe_match_id, 'action', 'approveMatch'), now_at, now_at$old$;
    new_text := $new$      recipient_id, recipient_id, '경기 확정 완료',
      current_match.title || ' 이의제기를 모두 판정해 결과가 확정됐습니다. 불복은 신고로 접수해 주세요.',
      'match', 'match', safe_match_id,
      jsonb_build_object('matchId', safe_match_id, 'action', 'viewMatch'), now_at, now_at$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_dispute_finalize_notification_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$  return jsonb_build_object(
    'ok', true, 'action', 'resolveMatchDispute', 'matchId', safe_match_id,
    'disputeId', current_dispute.id, 'decision', safe_decision,
    'openCount', open_count, 'reapprovalRequired', open_count = 0,
    'sqlReducer', true, 'advisoryLocked', true
  );$old$;
    new_text := $new$  return jsonb_build_object(
    'ok', true, 'action', 'resolveMatchDispute', 'matchId', safe_match_id,
    'disputeId', current_dispute.id, 'decision', safe_decision,
    'openCount', open_count, 'reapprovalRequired', false,
    'finalized', open_count = 0,
    'sqlReducer', true, 'advisoryLocked', true
  ) || finalize_result;$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'match_dispute_finalize_return_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    execute function_definition;
  end if;
end;
$migration$;

revoke all on function public.rankball_match_finalize_locked_concurrency_inner(text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_resolve_dispute_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_resolve_dispute_action(text, text, text, text)
to service_role;

select pg_notify('pgrst', 'reload schema');
