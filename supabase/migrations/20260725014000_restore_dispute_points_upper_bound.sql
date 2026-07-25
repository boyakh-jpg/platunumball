do $$
begin
  if to_regprocedure('public.rankball_match_dispute_action_pre_points_bound(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_dispute_action(text,text,jsonb)') is null then
      raise exception 'rankball_match_dispute_action_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_dispute_action(text, text, jsonb)
      rename to rankball_match_dispute_action_pre_points_bound;
  end if;
end;
$$;

create or replace function public.rankball_match_dispute_action(
  p_actor_profile_id text,
  p_match_id text,
  p_dispute_request jsonb default '""'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  requested_points_text text;
begin
  if jsonb_typeof(coalesce(p_dispute_request, '{}'::jsonb)) = 'object'
     and nullif(btrim(p_dispute_request->>'playerId'), '') = safe_actor_id then
    requested_points_text := nullif(btrim(p_dispute_request->>'requestedPoints'), '');
    if requested_points_text ~ '^[0-9]+(\.[0-9]+)?$'
       and round(requested_points_text::numeric) > 999 then
      raise exception 'match_stat_value_out_of_range' using errcode = '22023';
    end if;
  end if;

  return public.rankball_match_dispute_action_pre_points_bound(
    p_actor_profile_id,
    p_match_id,
    coalesce(p_dispute_request, '""'::jsonb)
  );
end;
$$;

revoke all on function public.rankball_match_dispute_action_pre_points_bound(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_dispute_action(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_match_dispute_action_pre_points_bound(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
