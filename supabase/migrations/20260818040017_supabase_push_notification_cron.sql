create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create or replace function public.rankball_invoke_push_notification_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_base_url text;
  cron_secret text;
begin
  select decrypted_secret
  into app_base_url
  from vault.decrypted_secrets
  where name = 'rankball_app_base_url'
  limit 1;

  select decrypted_secret
  into cron_secret
  from vault.decrypted_secrets
  where name = 'rankball_cron_secret'
  limit 1;

  if coalesce(pg_catalog.btrim(app_base_url), '') = ''
    or coalesce(pg_catalog.btrim(cron_secret), '') = ''
  then
    return null;
  end if;

  return net.http_post(
    url := pg_catalog.rtrim(app_base_url, '/') || '/api/notifications/push-worker',
    body := '{"source":"supabase_cron"}'::jsonb,
    headers := pg_catalog.jsonb_build_object(
      'Authorization',
      'Bearer ' || cron_secret,
      'Content-Type',
      'application/json'
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.rankball_invoke_push_notification_worker() from public, anon, authenticated, service_role;

comment on function public.rankball_invoke_push_notification_worker()
is 'Queues one authenticated Web Push worker HTTP request from Supabase Cron.';

do $cron$
declare
  existing_job record;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname = 'rankball-push-notification-worker'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;

  perform cron.schedule(
    'rankball-push-notification-worker',
    '* * * * *',
    'select public.rankball_invoke_push_notification_worker();'
  );
end;
$cron$;
