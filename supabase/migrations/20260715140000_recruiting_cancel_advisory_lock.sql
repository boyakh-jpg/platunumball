-- Keep participation cancellation on the same per-room advisory lock as other room mutations.

do $$
begin
  if to_regprocedure('public.rankball_recruiting_cancel_participation_action_unlocked(text,text)') is null then
    alter function public.rankball_recruiting_cancel_participation_action(text, text)
      rename to rankball_recruiting_cancel_participation_action_unlocked;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_cancel_participation_action(
  p_actor_profile_id text,
  p_post_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtext('rankball:recruiting'),
    hashtext(coalesce(nullif(btrim(p_post_id), ''), ''))
  );
  result := public.rankball_recruiting_cancel_participation_action_unlocked(
    p_actor_profile_id,
    p_post_id
  );
  return coalesce(result, '{}'::jsonb) || jsonb_build_object('advisoryLocked', true);
end;
$$;

revoke all on function public.rankball_recruiting_cancel_participation_action_unlocked(text, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_cancel_participation_action(text, text) from public, anon, authenticated;
grant execute on function public.rankball_recruiting_cancel_participation_action(text, text) to service_role;

notify pgrst, 'reload schema';
