alter table public.teams
  add column if not exists receipt_emblem_uploaded_at timestamptz,
  add column if not exists receipt_emblem_upload_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'teams_receipt_emblem_upload_count_check'
       and conrelid = 'public.teams'::regclass
  ) then
    alter table public.teams
      add constraint teams_receipt_emblem_upload_count_check
      check (receipt_emblem_upload_count >= 0);
  end if;
end
$$;

update public.teams
   set receipt_emblem_upload_count = greatest(coalesce(receipt_emblem_upload_count, 0), 1),
       receipt_emblem_uploaded_at = coalesce(receipt_emblem_uploaded_at, receipt_emblem_updated_at, updated_at, now())
 where receipt_emblem_key is not null
   and (
     coalesce(receipt_emblem_upload_count, 0) < 1
     or receipt_emblem_uploaded_at is null
   );

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
  v_updated_at timestamptz := clock_timestamp();
  v_emblem_key text := nullif(p_emblem_key, '');
  v_is_upload boolean;
  v_next_allowed_at timestamptz;
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

  if v_emblem_key is not null
     and v_emblem_key !~ ('^team-emblems/' || p_team_id || '/[a-f0-9]{24}[.]webp$') then
    raise exception 'invalid_team_receipt_emblem_key' using errcode = '22023';
  end if;

  v_is_upload := v_emblem_key is not null
    and v_emblem_key is distinct from v_team.receipt_emblem_key;

  if v_is_upload
     and v_team.emblem_upload_blocked_until is not null
     and v_team.emblem_upload_blocked_until > v_updated_at then
    raise exception 'team_emblem_moderation_blocked'
      using errcode = 'P0001', detail = v_team.emblem_upload_blocked_until::text;
  end if;

  if v_is_upload
     and coalesce(v_team.receipt_emblem_upload_count, 0) >= 2
     and v_team.receipt_emblem_uploaded_at is not null
     and v_team.receipt_emblem_uploaded_at + interval '30 days' > v_updated_at then
    v_next_allowed_at := v_team.receipt_emblem_uploaded_at + interval '30 days';
    raise exception 'team_receipt_emblem_cooldown'
      using errcode = 'P0001', detail = v_next_allowed_at::text;
  end if;

  update public.teams
     set receipt_emblem_key = v_emblem_key,
         receipt_emblem_updated_at = case when v_emblem_key is null then null else v_updated_at end,
         receipt_emblem_uploaded_at = case
           when v_is_upload then v_updated_at
           else v_team.receipt_emblem_uploaded_at
         end,
         receipt_emblem_upload_count = coalesce(v_team.receipt_emblem_upload_count, 0)
           + case when v_is_upload then 1 else 0 end,
         updated_at = v_updated_at
   where id = p_team_id
   returning * into v_team;

  v_next_allowed_at := case
    when v_team.receipt_emblem_upload_count >= 2
      and v_team.receipt_emblem_uploaded_at is not null
      then v_team.receipt_emblem_uploaded_at + interval '30 days'
    else null
  end;

  if v_team.emblem_upload_blocked_until is not null
     and (v_next_allowed_at is null or v_team.emblem_upload_blocked_until > v_next_allowed_at) then
    v_next_allowed_at := v_team.emblem_upload_blocked_until;
  end if;

  return jsonb_build_object(
    'ok', true,
    'teamId', p_team_id,
    'receiptEmblemKey', v_team.receipt_emblem_key,
    'receiptEmblemUpdatedAt', v_team.receipt_emblem_updated_at,
    'receiptEmblemUploadedAt', v_team.receipt_emblem_uploaded_at,
    'receiptEmblemUploadCount', v_team.receipt_emblem_upload_count,
    'nextUploadAt', v_next_allowed_at,
    'removedReceiptEmblemKey', case
      when v_team.receipt_emblem_key is distinct from nullif(p_expected_emblem_key, '')
        then nullif(p_expected_emblem_key, '')
      else null
    end
  );
end;
$$;

revoke all on function public.rankball_update_team_receipt_emblem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_receipt_emblem(text, text, text, text) to service_role;

notify pgrst, 'reload schema';
