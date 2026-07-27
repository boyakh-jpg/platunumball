-- Ending a match must not treat a live score row as a submitted postgame result.

begin;

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
  next_started_at timestamptz;
  next_ended_at timestamptz;
  next_rules jsonb;
begin
  if safe_actor_id is null or safe_match_id is null then
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
  if safe_actor_id is distinct from coalesce(nullif(current_match.referee_id, ''), current_match.created_by) then
    raise exception 'match_end_permission_denied' using errcode = '42501';
  end if;
  if current_match.status <> 'agreed' or current_match.ended_at is not null then
    raise exception 'match_not_endable' using errcode = '23514';
  end if;
  if current_match.started_at is null then
    raise exception 'match_not_started' using errcode = '23514';
  end if;

  next_started_at := current_match.started_at;
  next_ended_at := coalesce(nullif(btrim(coalesce(p_ended_at, '')), '')::timestamptz, now());
  next_rules := jsonb_set(
    coalesce(current_match.rules, '{}'::jsonb),
    '{startedAt}',
    to_jsonb(coalesce(current_match.rules->>'startedAt', next_started_at::text)),
    true
  );

  update public.matches
  set status = current_match.status,
      started_at = next_started_at,
      ended_at = next_ended_at,
      rules = next_rules,
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'endMatch',
    'matchId', safe_match_id,
    'startedAt', next_started_at,
    'endedAt', next_ended_at,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end
$$;

revoke all on function public.rankball_match_end_action(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_end_action(text, text, text, text)
  to service_role;

comment on function public.rankball_match_end_action(text, text, text, text) is
  'Ends an active match without treating live score-only match_results as a submitted postgame result.';

commit;
