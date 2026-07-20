alter table public.teams
  add column if not exists emblem_previous_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_previous_key_length_check') then
    alter table public.teams
      add constraint teams_emblem_previous_key_length_check
      check (emblem_previous_key is null or char_length(emblem_previous_key) <= 256);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_emblem_previous_key_format_check') then
    alter table public.teams
      add constraint teams_emblem_previous_key_format_check
      check (emblem_previous_key is null or emblem_previous_key ~ '^team-emblems/[A-Za-z0-9_-]{2,128}/[a-f0-9]{24}[.]webp$');
  end if;
end $$;

create or replace function public.rankball_update_team_emblem(
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
  current_team public.teams%rowtype;
  safe_team_id text := btrim(coalesce(p_team_id, ''));
  safe_emblem_key text := nullif(btrim(p_emblem_key), '');
  safe_expected_key text := nullif(btrim(p_expected_emblem_key), '');
  old_emblem_key text;
  old_previous_key text;
  removed_emblem_key text;
  discarded_emblem_key text;
  expected_prefix text;
  now_at timestamptz := clock_timestamp();
  next_allowed_at timestamptz;
  new_upload boolean := false;
begin
  select * into current_team
  from public.teams
  where id = safe_team_id
    and deleted_at is null
  for update;

  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = safe_team_id and user_id = p_actor_profile_id and role = 'captain'
  ) then
    raise exception 'team_emblem_permission_denied' using errcode = '42501';
  end if;
  if current_team.emblem_key is distinct from safe_expected_key then
    raise exception 'team_emblem_conflict' using errcode = '40001';
  end if;

  if safe_emblem_key is not null then
    expected_prefix := 'team-emblems/' || safe_team_id || '/';
    if position(expected_prefix in safe_emblem_key) <> 1
      or substring(safe_emblem_key from char_length(expected_prefix) + 1) !~ '^[a-f0-9]{24}[.]webp$' then
      raise exception 'invalid_team_emblem_key' using errcode = '22023';
    end if;
  end if;

  old_emblem_key := current_team.emblem_key;
  old_previous_key := current_team.emblem_previous_key;
  new_upload := safe_emblem_key is not null and safe_emblem_key is distinct from old_emblem_key;
  if new_upload and current_team.emblem_upload_blocked_until > now_at then
    raise exception 'team_emblem_moderation_blocked' using errcode = 'P0001', detail = current_team.emblem_upload_blocked_until::text;
  end if;
  if new_upload and current_team.emblem_upload_count >= 2 and current_team.emblem_uploaded_at > now_at - interval '30 days' then
    next_allowed_at := current_team.emblem_uploaded_at + interval '30 days';
    raise exception 'team_emblem_cooldown' using errcode = 'P0001', detail = next_allowed_at::text;
  end if;

  if safe_emblem_key is null then
    removed_emblem_key := old_emblem_key;
    discarded_emblem_key := old_previous_key;
  elsif new_upload
    and old_previous_key is not null
    and old_previous_key is distinct from safe_emblem_key
    and old_previous_key is distinct from old_emblem_key then
    discarded_emblem_key := old_previous_key;
  end if;

  update public.teams
  set
    emblem_key = safe_emblem_key,
    emblem_previous_key = case
      when safe_emblem_key is null then null
      when new_upload then old_emblem_key
      else emblem_previous_key
    end,
    emblem_source = case when safe_emblem_key is null then 'initial' else 'upload' end,
    emblem_updated_at = now_at,
    emblem_uploaded_at = case when new_upload then now_at else emblem_uploaded_at end,
    emblem_upload_count = emblem_upload_count + case when new_upload then 1 else 0 end,
    updated_at = now_at
  where id = safe_team_id
  returning * into current_team;

  next_allowed_at := case
    when current_team.emblem_upload_count >= 2 and current_team.emblem_uploaded_at is not null
      then current_team.emblem_uploaded_at + interval '30 days'
    else null
  end;
  if current_team.emblem_upload_blocked_until > now_at
    and (next_allowed_at is null or current_team.emblem_upload_blocked_until > next_allowed_at) then
    next_allowed_at := current_team.emblem_upload_blocked_until;
  end if;

  return jsonb_build_object(
    'ok', true,
    'teamId', safe_team_id,
    'emblemKey', current_team.emblem_key,
    'emblemSource', current_team.emblem_source,
    'emblemUpdatedAt', current_team.emblem_updated_at,
    'emblemUploadedAt', current_team.emblem_uploaded_at,
    'emblemUploadCount', current_team.emblem_upload_count,
    'emblemViolationCount', current_team.emblem_violation_count,
    'emblemUploadBlockedUntil', current_team.emblem_upload_blocked_until,
    'nextUploadAt', next_allowed_at,
    'previousEmblemKey', current_team.emblem_previous_key,
    'emblemCanRestore', current_team.emblem_previous_key is not null,
    'removedEmblemKey', removed_emblem_key,
    'discardedEmblemKey', discarded_emblem_key
  );
end;
$$;

create or replace function public.rankball_restore_team_emblem(
  p_actor_profile_id text,
  p_team_id text,
  p_expected_emblem_key text,
  p_expected_previous_emblem_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_team public.teams%rowtype;
  safe_team_id text := btrim(coalesce(p_team_id, ''));
  safe_expected_key text := nullif(btrim(p_expected_emblem_key), '');
  safe_expected_previous_key text := nullif(btrim(p_expected_previous_emblem_key), '');
  old_emblem_key text;
  now_at timestamptz := clock_timestamp();
begin
  select * into current_team
  from public.teams
  where id = safe_team_id
    and deleted_at is null
  for update;

  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.team_members
    where team_id = safe_team_id and user_id = p_actor_profile_id and role = 'captain'
  ) then
    raise exception 'team_emblem_permission_denied' using errcode = '42501';
  end if;
  if current_team.emblem_key is distinct from safe_expected_key
    or current_team.emblem_previous_key is distinct from safe_expected_previous_key then
    raise exception 'team_emblem_conflict' using errcode = '40001';
  end if;
  if current_team.emblem_previous_key is null then
    raise exception 'team_emblem_restore_unavailable' using errcode = 'P0002';
  end if;
  if current_team.emblem_upload_blocked_until > now_at then
    raise exception 'team_emblem_moderation_blocked' using errcode = 'P0001', detail = current_team.emblem_upload_blocked_until::text;
  end if;

  old_emblem_key := current_team.emblem_key;
  update public.teams
  set
    emblem_key = current_team.emblem_previous_key,
    emblem_previous_key = old_emblem_key,
    emblem_source = 'upload',
    emblem_updated_at = now_at,
    updated_at = now_at
  where id = safe_team_id
  returning * into current_team;

  return jsonb_build_object(
    'ok', true,
    'teamId', safe_team_id,
    'emblemKey', current_team.emblem_key,
    'emblemSource', current_team.emblem_source,
    'emblemUpdatedAt', current_team.emblem_updated_at,
    'emblemUploadedAt', current_team.emblem_uploaded_at,
    'emblemUploadCount', current_team.emblem_upload_count,
    'emblemViolationCount', current_team.emblem_violation_count,
    'emblemUploadBlockedUntil', current_team.emblem_upload_blocked_until,
    'previousEmblemKey', current_team.emblem_previous_key,
    'emblemCanRestore', current_team.emblem_previous_key is not null
  );
end;
$$;

revoke all on function public.rankball_update_team_emblem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_emblem(text, text, text, text) to service_role;
revoke all on function public.rankball_restore_team_emblem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_restore_team_emblem(text, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
