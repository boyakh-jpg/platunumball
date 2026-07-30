-- Repair the two cancellation-policy functions whose Korean notification
-- literals were deployed with encoding damage. Function logic is preserved:
-- only the deterministic title/body literal sequence is replaced.

begin;

do $repair$
declare
  helper_signature constant text :=
    'public.rankball_recruiting_close_action_pre_cancel_policy(text,text)';
  recruiting_signature constant text :=
    'public.rankball_recruiting_close_action(text,text)';
  match_signature constant text :=
    'public.rankball_match_terminal_action_pre_cancel_reason(text,text,text,text)';
  target_function regprocedure;
  function_definition text;
  repaired_definition text;
begin
  target_function := to_regprocedure(helper_signature);
  if target_function is null then
    raise exception 'recruiting_close_policy_helper_missing'
      using errcode = '42883';
  end if;
  function_definition := pg_get_functiondef(target_function);
  if position('방 닫기 페널티' in function_definition) = 0
     or position(
       '대기 인원 또는 임박한 일정이 있는 방을 닫아 신뢰 점수가 감소했습니다.'
       in function_definition
     ) = 0
  then
    repaired_definition := regexp_replace(
      function_definition,
      $pattern$notification_id,[[:space:]]+safe_actor_id,[[:space:]]+safe_actor_id,[[:space:]]+'[^']*',[[:space:]]+'[^']*',[[:space:]]+'orange',[[:space:]]+'recruiting_closed'$pattern$,
      $replacement$notification_id,
      safe_actor_id,
      safe_actor_id,
      '방 닫기 페널티',
      '대기 인원 또는 임박한 일정이 있는 방을 닫아 신뢰 점수가 감소했습니다.',
      'orange',
      'recruiting_closed'$replacement$
    );
    if repaired_definition = function_definition then
      raise exception 'recruiting_close_policy_helper_unicode_shape_changed'
        using errcode = '55000';
    end if;
    execute repaired_definition;
  end if;

  target_function := to_regprocedure(recruiting_signature);
  if target_function is null then
    raise exception 'recruiting_close_action_missing'
      using errcode = '42883';
  end if;
  function_definition := pg_get_functiondef(target_function);
  if position('경기 취소 신뢰도 반영' in function_definition) = 0
     or position(
       '경기 시작 12시간 이내에 취소해 신뢰도 '
       in function_definition
     ) = 0
     or position('점이 감소했습니다.' in function_definition) = 0
  then
    repaired_definition := regexp_replace(
      function_definition,
      $pattern$safe_actor_id,[[:space:]]+safe_actor_id,[[:space:]]+'[^']*',[[:space:]]+'[^']*'[[:space:]]*\|\|[[:space:]]*desired_penalty::text[[:space:]]*\|\|[[:space:]]*'[^']*',[[:space:]]+'orange',[[:space:]]+'recruiting_cancel_penalty'$pattern$,
      $replacement$safe_actor_id,
      safe_actor_id,
      '경기 취소 신뢰도 반영',
      '경기 시작 12시간 이내에 취소해 신뢰도 ' || desired_penalty::text || '점이 감소했습니다.',
      'orange',
      'recruiting_cancel_penalty'$replacement$
    );
    if repaired_definition = function_definition then
      raise exception 'recruiting_close_action_unicode_shape_changed'
        using errcode = '55000';
    end if;
    execute repaired_definition;
  end if;

  target_function := to_regprocedure(match_signature);
  if target_function is null then
    raise exception 'match_cancel_policy_helper_missing'
      using errcode = '42883';
  end if;
  function_definition := pg_get_functiondef(target_function);
  if position('경기 취소 신뢰도 반영' in function_definition) = 0
     or position(
       '경기 시작 12시간 이내에 취소해 신뢰도 '
       in function_definition
     ) = 0
     or position('점이 감소했습니다.' in function_definition) = 0
  then
    repaired_definition := regexp_replace(
      function_definition,
      $pattern$current_match.created_by,[[:space:]]+current_match.created_by,[[:space:]]+'[^']*',[[:space:]]+'[^']*'[[:space:]]*\|\|[[:space:]]*desired_penalty::text[[:space:]]*\|\|[[:space:]]*'[^']*',[[:space:]]+'orange',[[:space:]]+'match_cancel_penalty'$pattern$,
      $replacement$current_match.created_by,
      current_match.created_by,
      '경기 취소 신뢰도 반영',
      '경기 시작 12시간 이내에 취소해 신뢰도 ' || desired_penalty::text || '점이 감소했습니다.',
      'orange',
      'match_cancel_penalty'$replacement$
    );
    if repaired_definition = function_definition then
      raise exception 'match_cancel_policy_helper_unicode_shape_changed'
        using errcode = '55000';
    end if;
    execute repaired_definition;
  end if;
end
$repair$;

-- The renamed pre-policy function is an owner-only internal helper.
revoke all on function public.rankball_recruiting_close_action_pre_cancel_policy(
  text,
  text
) from public, anon, authenticated, service_role;

revoke all on function public.rankball_recruiting_close_action(text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_recruiting_close_action(text, text)
  to service_role;

revoke all on function public.rankball_match_terminal_action(
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.rankball_match_terminal_action(
  text,
  text,
  text,
  text
) to service_role;

update public.notifications
set
  title = '경기 취소 신뢰도 반영',
  body = '경기 시작 12시간 이내에 취소해 신뢰도 '
    || (payload->>'penalty')
    || '점이 감소했습니다.',
  updated_at = clock_timestamp()
where type in ('recruiting_cancel_penalty', 'match_cancel_penalty')
  and coalesce(payload->>'penalty', '') ~ '^[0-9]+$'
  and (
    title is distinct from '경기 취소 신뢰도 반영'
    or body is distinct from (
      '경기 시작 12시간 이내에 취소해 신뢰도 '
      || (payload->>'penalty')
      || '점이 감소했습니다.'
    )
  );

do $postflight$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_recruiting_close_action(text,text)'::regprocedure
  );
  if position(
       'public.rankball_scheduled_at_kst(current_post.scheduled_at)'
       in function_definition
     ) = 0
     or position(
       'rankball_recruiting_close_action_pre_cancel_policy'
       in function_definition
     ) = 0
     or position('경기 취소 신뢰도 반영' in function_definition) = 0
     or position(
       '경기 시작 12시간 이내에 취소해 신뢰도 '
       in function_definition
     ) = 0
     or position('점이 감소했습니다.' in function_definition) = 0
  then
    raise exception 'recruiting_close_action_canonical_postflight_failed'
      using errcode = '55000';
  end if;

  function_definition := pg_get_functiondef(
    'public.rankball_match_terminal_action_pre_cancel_reason(text,text,text,text)'::regprocedure
  );
  if position('경기 취소 신뢰도 반영' in function_definition) = 0
     or position(
       '경기 시작 12시간 이내에 취소해 신뢰도 '
       in function_definition
     ) = 0
     or position('점이 감소했습니다.' in function_definition) = 0
  then
    raise exception 'match_cancel_policy_helper_postflight_failed'
      using errcode = '55000';
  end if;
end
$postflight$;

select pg_notify('pgrst', 'reload schema');

commit;
