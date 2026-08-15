begin;

create or replace function public.rankball_withdraw_linked_account(
  p_profile_id text,
  p_auth_user_id uuid,
  p_identity_hashes text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  first_identity_hash text;
  result_payload jsonb;
  blocked_until_at timestamptz;
begin
  if coalesce(cardinality(p_identity_hashes), 0) = 0 then
    raise exception 'account_identity_missing' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_identity_hashes) identity_hash
    where identity_hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'invalid_account_identity_hash' using errcode = '22023';
  end if;

  select min(identity_hash)
  into first_identity_hash
  from unnest(p_identity_hashes) identity_hash;

  result_payload := public.rankball_withdraw_account(
    p_profile_id,
    p_auth_user_id,
    first_identity_hash
  );
  blocked_until_at := (result_payload ->> 'blockedUntil')::timestamptz;

  insert into public.account_withdrawals (identity_hash, profile_id, withdrawn_at, blocked_until)
  select distinct identity_hash, p_profile_id, clock_timestamp(), blocked_until_at
  from unnest(p_identity_hashes) identity_hash
  on conflict (identity_hash) do update set
    profile_id = excluded.profile_id,
    withdrawn_at = excluded.withdrawn_at,
    blocked_until = excluded.blocked_until;

  return result_payload;
end;
$$;

revoke all on function public.rankball_withdraw_linked_account(text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.rankball_withdraw_linked_account(text, uuid, text[]) to service_role;

insert into public.rankball_rpc_contract_registry (
  contract_scope, contract_name, function_name, signature, lifecycle, service_role_execute
)
values (
  'general',
  'rankball_withdraw_linked_account',
  'rankball_withdraw_linked_account',
  'public.rankball_withdraw_linked_account(text,uuid,text[])',
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
