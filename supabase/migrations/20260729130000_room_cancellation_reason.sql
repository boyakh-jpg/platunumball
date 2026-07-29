begin;

create or replace function public.rankball_recruiting_close_with_reason_action(
  p_actor_profile_id text,
  p_post_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_reason text := nullif(btrim(p_reason), '');
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  if safe_reason is null or char_length(safe_reason) < 5 or char_length(safe_reason) > 200 then
    raise exception 'room_cancellation_reason_required' using errcode = '22023';
  end if;

  result := public.rankball_recruiting_close_action(
    p_actor_profile_id,
    p_post_id
  );

  if lower(coalesce(result->>'fallback', 'false')) in ('true', 't', '1', 'yes', 'on') then
    return result;
  end if;

  update public.recruiting_posts
  set room_state = coalesce(room_state, '{}'::jsonb) || jsonb_build_object(
        'cancellationReasonText', safe_reason,
        'cancelledBy', nullif(btrim(p_actor_profile_id), ''),
        'cancelledAt', coalesce(room_state->>'cancelledAt', now_at::text)
      ),
      updated_at = now_at
  where id = nullif(btrim(p_post_id), '');

  update public.notifications
  set body = body || E'\n취소 사유: ' || safe_reason,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('cancellationReason', safe_reason),
      updated_at = now_at
  where recruiting_post_id = nullif(btrim(p_post_id), '')
    and type in ('recruiting_closed', 'recruiting_cancelled')
    and position('취소 사유:' in coalesce(body, '')) = 0;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'cancellationReason', safe_reason
  );
end;
$$;

do $$
begin
  if to_regprocedure('public.rankball_match_terminal_action_pre_cancel_reason(text,text,text,text)') is null then
    alter function public.rankball_match_terminal_action(text, text, text, text)
      rename to rankball_match_terminal_action_pre_cancel_reason;
  end if;
end;
$$;

create or replace function public.rankball_match_terminal_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_action text := nullif(btrim(p_action), '');
  safe_reason text := nullif(btrim(p_reason), '');
  result jsonb;
  now_at timestamptz := clock_timestamp();
begin
  if safe_action = 'cancelMatch'
     and (safe_reason is null or char_length(safe_reason) < 5 or char_length(safe_reason) > 200)
  then
    raise exception 'match_cancellation_reason_required' using errcode = '22023';
  end if;

  result := public.rankball_match_terminal_action_pre_cancel_reason(
    p_actor_profile_id,
    p_action,
    p_match_id,
    p_reason
  );

  if safe_action <> 'cancelMatch'
     or lower(coalesce(result->>'fallback', 'false')) in ('true', 't', '1', 'yes', 'on')
  then
    return result;
  end if;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'cancellationReason', safe_reason,
        'cancelledBy', nullif(btrim(p_actor_profile_id), '')
      ),
      updated_at = now_at
  where id = nullif(btrim(p_match_id), '')
    and status = 'cancelled';

  update public.notifications
  set body = body || E'\n취소 사유: ' || safe_reason,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('cancellationReason', safe_reason),
      updated_at = now_at
  where match_id = nullif(btrim(p_match_id), '')
    and type = 'match_cancelled'
    and position('취소 사유:' in coalesce(body, '')) = 0;

  return coalesce(result, '{}'::jsonb) || jsonb_build_object(
    'cancellationReason', safe_reason
  );
end;
$$;

revoke all on function public.rankball_recruiting_close_with_reason_action(text, text, text)
  from public, anon, authenticated;
revoke all on function public.rankball_match_terminal_action(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_recruiting_close_with_reason_action(text, text, text)
  to service_role;
grant execute on function public.rankball_match_terminal_action(text, text, text, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
