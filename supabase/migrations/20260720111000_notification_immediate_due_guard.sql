-- Keep immediate notifications visible even when the API and database clocks differ slightly.

create or replace function public.rankball_set_notification_due_at()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_due_at text;
begin
  raw_due_at := coalesce(
    nullif(btrim(new.payload->>'sendAt'), ''),
    nullif(btrim(new.payload->>'dueAt'), '')
  );
  if raw_due_at is not null then
    begin
      new.due_at := raw_due_at::timestamptz;
    exception when others then
      new.due_at := '-infinity'::timestamptz;
    end;
  else
    new.due_at := '-infinity'::timestamptz;
  end if;
  return new;
end;
$$;

update public.notifications
set due_at = '-infinity'::timestamptz
where nullif(btrim(payload->>'sendAt'), '') is null
  and nullif(btrim(payload->>'dueAt'), '') is null
  and due_at <> '-infinity'::timestamptz;

revoke all on function public.rankball_set_notification_due_at() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
