create or replace function public.rankball_apply_profile_trust_deltas(
  p_actor_profile_id text,
  p_match_id text,
  p_deltas jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_match public.matches%rowtype;
  delta_row jsonb;
  target_profile_id text;
  delta_value integer;
  affected_count integer;
  profile_count integer := 0;
begin
  if nullif(trim(coalesce(p_actor_profile_id, '')), '') is null then
    raise exception 'missing_actor_profile_id' using errcode = '23502';
  end if;

  if nullif(trim(coalesce(p_match_id, '')), '') is null then
    raise exception 'missing_match_id' using errcode = '23502';
  end if;

  if coalesce(jsonb_typeof(p_deltas), 'array') <> 'array' then
    raise exception 'invalid_trust_deltas' using errcode = '22023';
  end if;

  select *
  into locked_match
  from public.matches
  where id = p_match_id
  for update;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if locked_match.status in ('cancelled', 'voided') then
    raise exception 'match_not_trust_mutable' using errcode = '42501';
  end if;

  for delta_row in
    select value from jsonb_array_elements(coalesce(p_deltas, '[]'::jsonb))
  loop
    target_profile_id := nullif(trim(coalesce(delta_row->>'id', '')), '');
    delta_value := coalesce(nullif(delta_row->>'trustDelta', '')::integer, 0);

    if target_profile_id is null then
      raise exception 'invalid_profile_update' using errcode = '22023';
    end if;

    if delta_value = 0 then
      continue;
    end if;

    update public.profiles
    set
      trust_score = greatest(0, least(100, coalesce(trust_score, 80) + delta_value)),
      updated_at = now()
    where id = target_profile_id;

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'trust_profile_not_found' using errcode = 'P0002';
    end if;

    profile_count := profile_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'matchId', p_match_id,
    'profileCount', profile_count
  );
end;
$$;

revoke all on function public.rankball_apply_profile_trust_deltas(text, text, jsonb) from public;
grant execute on function public.rankball_apply_profile_trust_deltas(text, text, jsonb) to service_role;
