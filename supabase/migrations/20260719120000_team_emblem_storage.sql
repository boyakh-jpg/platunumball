-- Team captains update one immutable Cloudflare R2 object key through a locked service-role RPC.
alter table public.teams
  add column if not exists emblem_key text,
  add column if not exists emblem_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teams_emblem_key_length_check'
  ) then
    alter table public.teams
      add constraint teams_emblem_key_length_check
      check (emblem_key is null or char_length(emblem_key) <= 256);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'teams_emblem_key_format_check'
  ) then
    alter table public.teams
      add constraint teams_emblem_key_format_check
      check (emblem_key is null or emblem_key ~ '^team-emblems/[A-Za-z0-9_-]{2,128}/[a-f0-9]{24}[.]webp$');
  end if;
end
$$;

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
  safe_actor_profile_id text := nullif(btrim(p_actor_profile_id), '');
  safe_team_id text := nullif(btrim(p_team_id), '');
  safe_emblem_key text := nullif(btrim(p_emblem_key), '');
  safe_expected_key text := nullif(btrim(p_expected_emblem_key), '');
  current_team public.teams%rowtype;
  previous_emblem_key text;
  now_at timestamptz := now();
  expected_prefix text;
begin
  if safe_actor_profile_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;
  if safe_team_id is null or safe_team_id !~ '^[A-Za-z0-9_-]{2,128}$' then
    raise exception 'invalid_team_id' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || safe_team_id, 0));
  select * into current_team
  from public.teams
  where id = safe_team_id and deleted_at is null
  for update;

  if current_team.id is null then
    raise exception 'team_not_found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1
    from public.team_members
    where team_id = safe_team_id
      and user_id = safe_actor_profile_id
      and role = 'captain'
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

  previous_emblem_key := current_team.emblem_key;
  update public.teams
  set
    emblem_key = safe_emblem_key,
    emblem_updated_at = now_at,
    updated_at = now_at
  where id = safe_team_id;

  return jsonb_build_object(
    'ok', true,
    'teamId', safe_team_id,
    'emblemKey', safe_emblem_key,
    'emblemUpdatedAt', now_at,
    'previousEmblemKey', previous_emblem_key
  );
end;
$$;

revoke all on function public.rankball_update_team_emblem(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_update_team_emblem(text, text, text, text) to service_role;
