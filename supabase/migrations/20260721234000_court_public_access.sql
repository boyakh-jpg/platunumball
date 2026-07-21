alter table public.court_requests
  add column if not exists public_access text;

alter table public.approved_courts
  add column if not exists public_access text;

create or replace function public.rankball_normalize_court_public_access(raw_value text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(raw_value, '')))
    when 'public' then 'public'
    when '공개' then 'public'
    when 'private' then 'private'
    when '비공개' then 'private'
    else 'unknown'
  end;
$$;

update public.court_requests
set public_access = public.rankball_normalize_court_public_access(
      coalesce(nullif(payload->>'publicAccess', ''), public_access)
    ),
    payload = case
      when jsonb_typeof(payload) = 'object' then payload
      else '{}'::jsonb
    end || jsonb_build_object(
      'publicAccess',
      public.rankball_normalize_court_public_access(
        coalesce(nullif(payload->>'publicAccess', ''), public_access)
      )
    );

update public.approved_courts
set public_access = public.rankball_normalize_court_public_access(
      coalesce(nullif(payload->>'publicAccess', ''), public_access)
    ),
    payload = case
      when jsonb_typeof(payload) = 'object' then payload
      else '{}'::jsonb
    end || jsonb_build_object(
      'publicAccess',
      public.rankball_normalize_court_public_access(
        coalesce(nullif(payload->>'publicAccess', ''), public_access)
      )
    );

alter table public.court_requests
  alter column public_access set default 'unknown',
  alter column public_access set not null;

alter table public.approved_courts
  alter column public_access set default 'unknown',
  alter column public_access set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'court_requests_public_access_check'
      and conrelid = 'public.court_requests'::regclass
  ) then
    alter table public.court_requests
      add constraint court_requests_public_access_check
      check (public_access in ('public', 'private', 'unknown'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'approved_courts_public_access_check'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_public_access_check
      check (public_access in ('public', 'private', 'unknown'));
  end if;
end;
$$;

create or replace function public.rankball_sync_court_public_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_payload jsonb := case
    when jsonb_typeof(new.payload) = 'object' then new.payload
    else '{}'::jsonb
  end;
  safe_public_access text;
begin
  if tg_op = 'UPDATE'
    and new.public_access is distinct from old.public_access
    and safe_payload->>'publicAccess' is not distinct from old.payload->>'publicAccess' then
    safe_public_access := public.rankball_normalize_court_public_access(new.public_access);
  else
    safe_public_access := public.rankball_normalize_court_public_access(
      coalesce(nullif(safe_payload->>'publicAccess', ''), new.public_access)
    );
  end if;
  new.public_access := safe_public_access;
  new.payload := safe_payload || jsonb_build_object('publicAccess', safe_public_access);
  return new;
end;
$$;

drop trigger if exists court_requests_sync_public_access on public.court_requests;
create trigger court_requests_sync_public_access
before insert or update of public_access, payload on public.court_requests
for each row execute function public.rankball_sync_court_public_access();

drop trigger if exists approved_courts_sync_public_access on public.approved_courts;
create trigger approved_courts_sync_public_access
before insert or update of public_access, payload on public.approved_courts
for each row execute function public.rankball_sync_court_public_access();

revoke all on function public.rankball_normalize_court_public_access(text) from public;
revoke all on function public.rankball_sync_court_public_access() from public;
grant execute on function public.rankball_normalize_court_public_access(text) to service_role;

select pg_notify('pgrst', 'reload schema');
