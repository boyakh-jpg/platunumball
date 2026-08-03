-- Keep referee request creation idempotent under concurrent API submissions.

create or replace function public.rankball_guard_referee_request_pending()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.status, 'pending') <> 'pending' then
    return new;
  end if;
  if new.requested_by is null or btrim(new.requested_by) = '' then
    raise exception 'missing_actor_profile_id' using errcode = '23502';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball_referee_request:' || new.requested_by, 0));
  if exists(
    select 1
    from public.referee_requests request
    where request.requested_by = new.requested_by
      and request.status = 'pending'
      and request.id <> new.id
  ) then
    raise exception 'referee_request_pending_exists' using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_guard_referee_request_pending on public.referee_requests;
create trigger rankball_guard_referee_request_pending
before insert on public.referee_requests
for each row
execute function public.rankball_guard_referee_request_pending();

revoke all on function public.rankball_guard_referee_request_pending() from public, anon, authenticated, service_role;
