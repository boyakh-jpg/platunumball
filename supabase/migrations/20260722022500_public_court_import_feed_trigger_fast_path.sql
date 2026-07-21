create or replace function public.rankball_refresh_court_feed_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
    and tg_table_name = 'approved_courts'
    and coalesce(new.registration_origin, '') = 'public_import'
    and coalesce(new.payload->>'publicImportKey', '') ~ '^[0-9a-f]{64}$' then
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.rankball_refresh_court_feed_dependency(old.id);
    return old;
  end if;

  if tg_op = 'UPDATE' and old.id is distinct from new.id then
    perform public.rankball_refresh_court_feed_dependency(old.id);
  end if;

  perform public.rankball_refresh_court_feed_dependency(new.id);
  return new;
end;
$$;
