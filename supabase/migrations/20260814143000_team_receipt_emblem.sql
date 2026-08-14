alter table public.teams
  add column if not exists receipt_emblem_key text,
  add column if not exists receipt_emblem_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'teams_receipt_emblem_key_format_check'
      and conrelid = 'public.teams'::regclass
  ) then
    alter table public.teams
      add constraint teams_receipt_emblem_key_format_check
      check (
        receipt_emblem_key is null
        or receipt_emblem_key ~ '^team-emblems/[A-Za-z0-9_-]{2,128}/[a-f0-9]{24}[.]webp$'
      );
  end if;
end
$$;

create or replace function public.rankball_update_team_receipt_emblem(
  p_actor_profile_id text,
  p_team_id text,
  p_emblem_key text,
  p_expected_emblem_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams%rowtype;
  v_updated_at timestamptz := now();
begin
  select *
    into v_team
    from public.teams
   where id = p_team_id
     and deleted_at is null
   for update;

  if not found then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
      from public.team_members
     where team_id = p_team_id
       and user_id = p_actor_profile_id
       and role = 'captain'
  ) then
    raise exception 'team_receipt_emblem_permission_denied' using errcode = '42501';
  end if;

  if v_team.receipt_emblem_key is distinct from nullif(p_expected_emblem_key, '') then
    raise exception 'team_receipt_emblem_conflict' using errcode = '40001';
  end if;

  if nullif(p_emblem_key, '') is not null
     and nullif(p_emblem_key, '') !~ ('^team-emblems/' || p_team_id || '/[a-f0-9]{24}[.]webp$') then
    raise exception 'invalid_team_receipt_emblem_key' using errcode = '22023';
  end if;

  update public.teams
     set receipt_emblem_key = nullif(p_emblem_key, ''),
         receipt_emblem_updated_at = case when nullif(p_emblem_key, '') is null then null else v_updated_at end,
         updated_at = v_updated_at
   where id = p_team_id;

  return jsonb_build_object(
    'ok', true,
    'teamId', p_team_id,
    'receiptEmblemKey', nullif(p_emblem_key, ''),
    'receiptEmblemUpdatedAt', case when nullif(p_emblem_key, '') is null then null else v_updated_at end,
    'removedReceiptEmblemKey', v_team.receipt_emblem_key
  );
end;
$$;

revoke all on function public.rankball_update_team_receipt_emblem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_receipt_emblem(text, text, text, text) to service_role;

notify pgrst, 'reload schema';
