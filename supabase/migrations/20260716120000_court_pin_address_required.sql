do $$
begin
  if to_regclass('public.court_requests') is not null
    and not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.court_requests'::regclass
        and conname = 'court_requests_pending_pin_required'
    ) then
    alter table public.court_requests
      add constraint court_requests_pending_pin_required
      check (status <> 'pending' or (lat is not null and lng is not null)) not valid;
  end if;
end;
$$;
