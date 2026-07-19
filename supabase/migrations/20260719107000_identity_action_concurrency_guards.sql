do $$
begin
  if to_regprocedure('public.rankball_sync_team_membership_identity_guard_legacy(text,jsonb,jsonb)') is null then
    alter function public.rankball_sync_team_membership(text, jsonb, jsonb)
      rename to rankball_sync_team_membership_identity_guard_legacy;
  end if;
end
$$;

create or replace function public.rankball_sync_team_membership(
  p_actor_profile_id text,
  p_team jsonb,
  p_notifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_profile_id text := nullif(btrim(p_actor_profile_id), '');
  safe_team_id text := nullif(btrim(p_team->>'id'), '');
  initial_members jsonb := coalesce(p_team->'members', '[]'::jsonb);
  initial_member jsonb;
  has_existing_members boolean := false;
begin
  if safe_actor_profile_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '42501';
  end if;
  if safe_team_id is null then
    raise exception 'missing_team_id' using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || safe_team_id, 0));

  select exists(
    select 1
    from public.team_members
    where team_id = safe_team_id
  ) into has_existing_members;

  if not has_existing_members then
    if jsonb_typeof(initial_members) <> 'array' or jsonb_array_length(initial_members) <> 1 then
      raise exception 'team_initial_member_must_be_actor_captain' using errcode = '42501';
    end if;

    initial_member := initial_members->0;
    if coalesce(nullif(btrim(initial_member->>'userId'), ''), nullif(btrim(initial_member->>'user_id'), ''), '') <> safe_actor_profile_id
      or coalesce(initial_member->>'role', '') <> 'captain' then
      raise exception 'team_initial_member_must_be_actor_captain' using errcode = '42501';
    end if;
  end if;

  return public.rankball_sync_team_membership_identity_guard_legacy(
    safe_actor_profile_id,
    p_team,
    p_notifications
  );
end
$$;

revoke all on function public.rankball_sync_team_membership(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rankball_sync_team_membership(text, jsonb, jsonb) to service_role;
revoke all on function public.rankball_sync_team_membership_identity_guard_legacy(text, jsonb, jsonb) from public, anon, authenticated, service_role;

create or replace function public.rankball_guard_approved_court_request_report()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'approved' and new.status = 'reported' then
    raise exception 'approved_court_request_cannot_be_reported' using errcode = '23514';
  end if;
  return new;
end
$$;

drop trigger if exists rankball_guard_approved_court_request_report on public.court_requests;
create trigger rankball_guard_approved_court_request_report
before update of status on public.court_requests
for each row
execute function public.rankball_guard_approved_court_request_report();

revoke all on function public.rankball_guard_approved_court_request_report() from public, anon, authenticated;

create or replace function public.rankball_guard_referee_exam_cooldown()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.status, '') <> 'started' then
    return new;
  end if;
  if new.user_id is null or btrim(new.user_id) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_referee_exam:' || new.user_id, 0));

  if exists(
    select 1
    from public.referee_exam_attempts
    where user_id = new.user_id
      and id <> new.id
      and available_after > now()
  ) then
    raise exception 'referee_exam_cooldown_active' using errcode = '23514';
  end if;

  new.started_at := coalesce(new.started_at, now());
  new.available_after := greatest(
    coalesce(new.available_after, new.started_at + interval '7 days'),
    new.started_at + interval '7 days'
  );
  return new;
end
$$;

drop trigger if exists rankball_guard_referee_exam_cooldown on public.referee_exam_attempts;
create trigger rankball_guard_referee_exam_cooldown
before insert on public.referee_exam_attempts
for each row
execute function public.rankball_guard_referee_exam_cooldown();

create index if not exists referee_exam_attempts_user_available_idx
on public.referee_exam_attempts (user_id, available_after desc);

revoke all on function public.rankball_guard_referee_exam_cooldown() from public, anon, authenticated;

create or replace function public.rankball_guard_active_report_duplicate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.type, '') not in ('match', 'player')
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

drop trigger if exists rankball_guard_active_report_duplicate on public.reports;
create trigger rankball_guard_active_report_duplicate
before insert or update of type, target_id, user_id, status on public.reports
for each row
execute function public.rankball_guard_active_report_duplicate();

create index if not exists reports_active_actor_target_idx
on public.reports (user_id, type, target_id, created_at)
where type in ('match', 'player')
  and coalesce(status, 'open') not in ('resolved', 'dismissed');

revoke all on function public.rankball_guard_active_report_duplicate() from public, anon, authenticated;
