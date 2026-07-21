alter table public.affiliations
  add column if not exists normalized_name text,
  add column if not exists member_count integer not null default 0,
  add column if not exists created_by text,
  add column if not exists status text not null default 'active',
  add column if not exists merged_into_id text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.affiliations
set normalized_name = lower(regexp_replace(btrim(coalesce(nullif(name, ''), id)), '\s+', '', 'g'))
where normalized_name is null or normalized_name = '';

alter table public.affiliations
  alter column normalized_name set not null;

alter table public.affiliations
  drop constraint if exists affiliations_type_check;

alter table public.affiliations
  add constraint affiliations_type_check
  check (type in ('region', 'school', 'company', 'organization'));

alter table public.affiliations
  drop constraint if exists affiliations_status_check;

alter table public.affiliations
  add constraint affiliations_status_check
  check (status in ('active', 'hidden', 'merged'));

alter table public.affiliations
  drop constraint if exists affiliations_member_count_check;

alter table public.affiliations
  add constraint affiliations_member_count_check
  check (member_count >= 0);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.affiliations'::regclass
      and conname = 'affiliations_created_by_fkey'
  ) then
    alter table public.affiliations
      add constraint affiliations_created_by_fkey
      foreign key (created_by) references public.profiles(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.affiliations'::regclass
      and conname = 'affiliations_merged_into_id_fkey'
  ) then
    alter table public.affiliations
      add constraint affiliations_merged_into_id_fkey
      foreign key (merged_into_id) references public.affiliations(id) on delete set null;
  end if;
end
$$;

create unique index if not exists affiliations_active_organization_name_unique
  on public.affiliations (normalized_name)
  where type = 'organization' and status = 'active';

alter table public.profiles
  add column if not exists affiliation_id text,
  add column if not exists affiliation_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_affiliation_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_affiliation_id_fkey
      foreign key (affiliation_id) references public.affiliations(id) on delete set null;
  end if;
end
$$;

with legacy_names as (
  select btrim(school) as name
  from public.profiles
  where nullif(btrim(school), '') is not null
  union all
  select btrim(company) as name
  from public.profiles
  where nullif(btrim(company), '') is not null
), canonical_names as (
  select
    min(name) as name,
    lower(regexp_replace(name, '\s+', '', 'g')) as normalized_name
  from legacy_names
  group by lower(regexp_replace(name, '\s+', '', 'g'))
)
insert into public.affiliations (
  id,
  type,
  name,
  normalized_name,
  member_count,
  status,
  created_at,
  updated_at
)
select
  'aff_legacy_' || substr(md5(normalized_name), 1, 20),
  'organization',
  name,
  normalized_name,
  0,
  'active',
  now(),
  now()
from canonical_names candidate
where not exists (
  select 1
  from public.affiliations existing
  where existing.type = 'organization'
    and existing.status = 'active'
    and existing.normalized_name = candidate.normalized_name
);

update public.profiles profile
set affiliation_id = affiliation.id
from public.affiliations affiliation
where profile.affiliation_id is null
  and affiliation.type = 'organization'
  and affiliation.status = 'active'
  and affiliation.normalized_name = lower(regexp_replace(
    btrim(coalesce(nullif(btrim(profile.school), ''), nullif(btrim(profile.company), ''))),
    '\s+',
    '',
    'g'
  ));

update public.affiliations affiliation
set member_count = (
  select count(*)::integer
  from public.profiles profile
  where profile.affiliation_id = affiliation.id
), updated_at = now()
where affiliation.type = 'organization';

create or replace function public.rankball_refresh_affiliation_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.affiliation_id is not null then
    update public.affiliations
    set
      member_count = (
        select count(*)::integer
        from public.profiles
        where affiliation_id = old.affiliation_id
      ),
      updated_at = clock_timestamp()
    where id = old.affiliation_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.affiliation_id is not null then
    update public.affiliations
    set
      member_count = (
        select count(*)::integer
        from public.profiles
        where affiliation_id = new.affiliation_id
      ),
      updated_at = clock_timestamp()
    where id = new.affiliation_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_refresh_affiliation_member_count on public.profiles;
drop trigger if exists profiles_refresh_affiliation_member_count_insert_delete on public.profiles;
drop trigger if exists profiles_refresh_affiliation_member_count_update on public.profiles;
create trigger profiles_refresh_affiliation_member_count_insert_delete
after insert or delete on public.profiles
for each row execute function public.rankball_refresh_affiliation_member_count();

create trigger profiles_refresh_affiliation_member_count_update
after update of affiliation_id on public.profiles
for each row execute function public.rankball_refresh_affiliation_member_count();

create or replace function public.rankball_guard_active_report_duplicate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.type, '') not in ('match', 'player', 'team_emblem', 'team_name', 'affiliation_name')
    or coalesce(new.status, 'open') in ('resolved', 'dismissed') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'rankball_report:' || coalesce(new.user_id, '') || ':' || new.type || ':' || coalesce(new.target_id, ''),
    0
  ));

  if exists(
    select 1
    from public.reports
    where user_id = new.user_id
      and type = new.type
      and target_id = new.target_id
      and id <> new.id
      and coalesce(status, 'open') not in ('resolved', 'dismissed')
  ) then
    raise exception 'active_report_duplicate' using errcode = '23505';
  end if;

  return new;
end
$$;

create index if not exists reports_active_name_actor_target_idx
on public.reports (user_id, type, target_id, created_at)
where type in ('team_emblem', 'team_name', 'affiliation_name')
  and coalesce(status, 'open') not in ('resolved', 'dismissed');

create or replace function public.rankball_set_profile_affiliation(
  p_actor_profile_id text,
  p_affiliation_id text default null,
  p_affiliation_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles%rowtype;
  affiliation_row public.affiliations%rowtype;
  safe_affiliation_id text := nullif(btrim(coalesce(p_affiliation_id, '')), '');
  safe_name text := regexp_replace(btrim(coalesce(p_affiliation_name, '')), '\s+', ' ', 'g');
  safe_normalized_name text;
  now_at timestamptz := clock_timestamp();
  next_change_at timestamptz;
begin
  select * into profile_row
  from public.profiles
  where id = p_actor_profile_id
  for update;

  if profile_row.id is null then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  if safe_affiliation_id is not null then
    select * into affiliation_row
    from public.affiliations
    where id = safe_affiliation_id
      and type = 'organization'
      and status = 'active';

    if affiliation_row.id is null then
      raise exception 'affiliation_not_found' using errcode = 'P0002';
    end if;
  elsif safe_name <> '' then
    if char_length(safe_name) < 2 or char_length(safe_name) > 40 or safe_name ~ '[<>]' then
      raise exception 'invalid_affiliation_name' using errcode = '22023';
    end if;

    safe_normalized_name := lower(regexp_replace(safe_name, '\s+', '', 'g'));
    select * into affiliation_row
    from public.affiliations
    where type = 'organization'
      and status = 'active'
      and normalized_name = safe_normalized_name
    for update;

    if affiliation_row.id is null then
      begin
        insert into public.affiliations (
          id,
          type,
          name,
          normalized_name,
          member_count,
          created_by,
          status,
          created_at,
          updated_at
        ) values (
          'aff_' || substr(md5(p_actor_profile_id || safe_normalized_name || now_at::text || random()::text), 1, 20),
          'organization',
          safe_name,
          safe_normalized_name,
          0,
          profile_row.id,
          'active',
          now_at,
          now_at
        )
        returning * into affiliation_row;
      exception when unique_violation then
        select * into affiliation_row
        from public.affiliations
        where type = 'organization'
          and status = 'active'
          and normalized_name = safe_normalized_name;
      end;
    end if;
  end if;

  if profile_row.affiliation_id is not distinct from affiliation_row.id then
    return jsonb_build_object(
      'ok', true,
      'changed', false,
      'profileId', profile_row.id,
      'affiliationId', affiliation_row.id,
      'affiliationName', affiliation_row.name,
      'memberCount', coalesce(affiliation_row.member_count, 0),
      'affiliationUpdatedAt', profile_row.affiliation_updated_at
    );
  end if;

  if profile_row.affiliation_updated_at is not null then
    next_change_at := profile_row.affiliation_updated_at + interval '30 days';
    if next_change_at > now_at then
      raise exception 'affiliation_change_cooldown:%', next_change_at using errcode = 'P0001';
    end if;
  end if;

  update public.profiles
  set
    affiliation_id = affiliation_row.id,
    affiliation_updated_at = now_at,
    updated_at = now_at
  where id = profile_row.id;

  if affiliation_row.id is not null then
    select * into affiliation_row
    from public.affiliations
    where id = affiliation_row.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', true,
    'profileId', profile_row.id,
    'affiliationId', affiliation_row.id,
    'affiliationName', affiliation_row.name,
    'memberCount', coalesce(affiliation_row.member_count, 0),
    'affiliationUpdatedAt', now_at,
    'nextChangeAt', now_at + interval '30 days'
  );
end;
$$;

create or replace function public.rankball_moderate_reported_name(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_report_id text,
  p_action_type text,
  p_replacement_name text default null,
  p_merge_target_id text default null,
  p_reason text default null,
  p_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  report_row public.reports%rowtype;
  source_affiliation public.affiliations%rowtype;
  target_affiliation public.affiliations%rowtype;
  safe_admin_level integer;
  safe_action text := btrim(coalesce(p_action_type, ''));
  safe_name text := regexp_replace(btrim(coalesce(p_replacement_name, '')), '\s+', ' ', 'g');
  safe_reason text := coalesce(nullif(btrim(p_reason), ''), '이름 운영 정책 위반 확인');
  safe_feedback text := coalesce(nullif(btrim(p_feedback), ''), '신고된 이름을 운영 정책에 따라 조정했습니다.');
  safe_merge_target_id text := nullif(btrim(coalesce(p_merge_target_id, '')), '');
  now_at timestamptz := clock_timestamp();
  audit_id text;
begin
  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);
  if safe_admin_level < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  select * into report_row
  from public.reports
  where id = p_report_id
  for update;

  if report_row.id is null then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;
  if report_row.status <> 'open' then
    raise exception 'report_already_processed' using errcode = '23505';
  end if;

  if safe_action = 'renameTeam' then
    if report_row.type <> 'team_name' then
      raise exception 'team_name_report_required' using errcode = '22023';
    end if;
    if safe_name = '' or char_length(safe_name) > 14 or safe_name ~ '[<>]' then
      raise exception 'invalid_team_name' using errcode = '22023';
    end if;
    update public.teams
    set name = safe_name, updated_at = now_at
    where id = report_row.target_id and deleted_at is null;
    if not found then
      raise exception 'team_not_found' using errcode = 'P0002';
    end if;
  elsif safe_action = 'renameAffiliation' then
    if report_row.type <> 'affiliation_name' then
      raise exception 'affiliation_name_report_required' using errcode = '22023';
    end if;
    if char_length(safe_name) < 2 or char_length(safe_name) > 40 or safe_name ~ '[<>]' then
      raise exception 'invalid_affiliation_name' using errcode = '22023';
    end if;
    update public.affiliations
    set
      name = safe_name,
      normalized_name = lower(regexp_replace(safe_name, '\s+', '', 'g')),
      updated_at = now_at
    where id = report_row.target_id
      and type = 'organization'
      and status = 'active';
    if not found then
      raise exception 'affiliation_not_found' using errcode = 'P0002';
    end if;
  elsif safe_action = 'mergeAffiliation' then
    if report_row.type <> 'affiliation_name' then
      raise exception 'affiliation_name_report_required' using errcode = '22023';
    end if;
    if safe_merge_target_id is null or safe_merge_target_id = report_row.target_id then
      raise exception 'invalid_affiliation_merge_target' using errcode = '22023';
    end if;
    select * into source_affiliation
    from public.affiliations
    where id = report_row.target_id and type = 'organization' and status = 'active'
    for update;
    select * into target_affiliation
    from public.affiliations
    where id = safe_merge_target_id and type = 'organization' and status = 'active'
    for update;
    if source_affiliation.id is null or target_affiliation.id is null then
      raise exception 'affiliation_not_found' using errcode = 'P0002';
    end if;
    update public.profiles
    set affiliation_id = target_affiliation.id, updated_at = now_at
    where affiliation_id = source_affiliation.id;
    update public.affiliations
    set status = 'merged', merged_into_id = target_affiliation.id, member_count = 0, updated_at = now_at
    where id = source_affiliation.id;
  else
    raise exception 'unsupported_name_moderation_action' using errcode = '22023';
  end if;

  update public.reports
  set
    status = 'resolved',
    resolved_at = now_at,
    resolved_by = p_actor_profile_id,
    resolution = jsonb_build_object(
      'actionType', safe_action,
      'replacementName', nullif(safe_name, ''),
      'mergeTargetId', safe_merge_target_id,
      'reason', safe_reason,
      'feedback', safe_feedback
    ),
    payload = payload || jsonb_build_object(
      'status', 'resolved',
      'resolvedAt', now_at,
      'resolvedBy', p_actor_profile_id,
      'resolution', jsonb_build_object(
        'actionType', safe_action,
        'replacementName', nullif(safe_name, ''),
        'mergeTargetId', safe_merge_target_id,
        'reason', safe_reason,
        'feedback', safe_feedback
      )
    ),
    updated_at = now_at
  where id = report_row.id;

  audit_id := 'aa_' || md5(report_row.id || p_actor_profile_id || safe_action || now_at::text);
  insert into public.admin_audit_log (
    id, type, status, report_id, created_by, payload, created_at
  ) values (
    audit_id,
    'name_moderation',
    'committed',
    report_row.id,
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', 'name_moderation',
      'status', 'committed',
      'reportId', report_row.id,
      'targetId', report_row.target_id,
      'actionType', safe_action,
      'replacementName', nullif(safe_name, ''),
      'mergeTargetId', safe_merge_target_id,
      'reason', safe_reason,
      'createdAt', now_at,
      'createdBy', p_actor_profile_id
    ),
    now_at
  );

  if report_row.user_id is not null then
    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
    ) values (
      'n_' || md5('name-moderation' || report_row.id || report_row.user_id || now_at::text),
      report_row.user_id,
      report_row.user_id,
      '이름 신고 처리 결과',
      safe_feedback,
      'team',
      'report',
      jsonb_build_object('reportId', report_row.id, 'actionType', safe_action),
      now_at,
      now_at
    ) on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'reportId', report_row.id,
    'actionType', safe_action,
    'status', 'resolved',
    'auditId', audit_id
  );
end;
$$;

create or replace view public.public_profiles as
select
  id,
  name,
  handle,
  hashtag,
  position,
  region,
  region_sido,
  region_district,
  trust_score,
  streak,
  avatar_color,
  ratings,
  age_group,
  age_group_checked_season,
  onboarding_complete,
  updated_at,
  avatar_key,
  avatar_source,
  avatar_updated_at,
  avatar_border_enabled,
  avatar_border_color,
  discord_avatar_url,
  avatar_icon_key,
  affiliation_id
from public.profiles;

grant select on public.public_profiles to anon, authenticated;

revoke all on function public.rankball_refresh_affiliation_member_count() from public, anon, authenticated;
revoke all on function public.rankball_set_profile_affiliation(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_moderate_reported_name(text, integer, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_set_profile_affiliation(text, text, text) to service_role;
grant execute on function public.rankball_moderate_reported_name(text, integer, text, text, text, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
