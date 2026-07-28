begin;

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
  dispute_request jsonb := coalesce(p_dispute_request, '{}'::jsonb);
  dispute_reason text;
begin
  perform public.rankball_normalize_dispute_minutes(null);

  dispute_reason := case jsonb_typeof(dispute_request)
    when 'object' then nullif(btrim(dispute_request->>'reason'), '')
    when 'string' then nullif(btrim(dispute_request #>> '{}'), '')
    else null
  end;
  if dispute_reason is null or char_length(dispute_reason) > 500 then
    raise exception 'match_dispute_reason_required' using errcode = '22023';
  end if;

  return public.rankball_match_dispute_pre_reason_required(
    p_actor_profile_id,
    p_match_id,
    dispute_request
  );
end;
$$;

revoke all on function public.rankball_match_dispute_action(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.rankball_match_dispute_action(text, text, jsonb)
  to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
