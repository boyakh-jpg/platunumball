begin;

alter table public.team_invitations
  add column if not exists application jsonb not null default '{}'::jsonb;

alter table public.team_invitations
  drop constraint if exists team_invitations_application_object_check;
alter table public.team_invitations
  add constraint team_invitations_application_object_check
  check (jsonb_typeof(application) = 'object') not valid;
alter table public.team_invitations
  validate constraint team_invitations_application_object_check;

create or replace function public.rankball_request_team_membership_with_application(
  p_actor_profile_id text,
  p_team_id text,
  p_request_id text default null,
  p_application jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  safe_application jsonb := coalesce(p_application, '{}'::jsonb);
begin
  if jsonb_typeof(safe_application) <> 'object' then
    raise exception 'invalid_team_join_application' using errcode = '22023';
  end if;

  result := public.rankball_request_team_membership(p_actor_profile_id, p_team_id, p_request_id);
  if result->>'status' = 'pending' then
    update public.team_invitations
    set application = safe_application,
        updated_at = clock_timestamp()
    where id = result->>'invitationId'
      and team_id = result->>'teamId'
      and target_user_id = nullif(btrim(p_actor_profile_id), '')
      and request_kind = 'request'
      and status = 'pending';
  end if;

  return result;
end;
$$;

revoke all on function public.rankball_request_team_membership_with_application(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_request_team_membership_with_application(text, text, text, jsonb) to service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values (
  'general',
  'rankball_request_team_membership_with_application',
  'rankball_request_team_membership_with_application',
  'public.rankball_request_team_membership_with_application(text,text,text,jsonb)',
  'active',
  true
)
on conflict (contract_scope, contract_name) do update set
  function_name = excluded.function_name,
  signature = excluded.signature,
  lifecycle = excluded.lifecycle,
  service_role_execute = excluded.service_role_execute,
  updated_at = clock_timestamp();

select pg_notify('pgrst', 'reload schema');

commit;
