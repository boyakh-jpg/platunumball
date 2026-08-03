begin;

create or replace function public.rankball_refresh_court_metrics_after_review()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_court_id text;
  new_court_id text;
begin
  if current_setting('rankball.skip_derived_refresh', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then
    old_court_id := public.rankball_resolve_approved_court_id(old.court_id, old.court_name);
    if old_court_id is not null then
      perform public.rankball_refresh_court_metrics(old_court_id);
    end if;
  end if;

  if tg_op <> 'DELETE' then
    new_court_id := public.rankball_resolve_approved_court_id(new.court_id, new.court_name);
    if new_court_id is not null and new_court_id is distinct from old_court_id then
      perform public.rankball_refresh_court_metrics(new_court_id);
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

select pg_notify('pgrst', 'reload schema');

commit;
