begin;

alter table public.reports
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_to text references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.reports'::regclass
      and conname = 'reports_priority_check'
  ) then
    alter table public.reports
      add constraint reports_priority_check
      check (priority in ('normal', 'urgent'));
  end if;
end
$$;

create index if not exists reports_open_operations_idx
  on public.reports (priority, assigned_to, created_at)
  where status = 'open';

create index if not exists reports_resolved_at_idx
  on public.reports (resolved_at desc)
  where resolved_at is not null;

create or replace function public.rankball_admin_report_operation(
  p_actor_profile_id pg_catalog.text,
  p_actor_admin_level pg_catalog.int4,
  p_report_id pg_catalog.text,
  p_operation pg_catalog.text
)
returns pg_catalog.jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_row public.reports%rowtype;
  updated_row public.reports%rowtype;
  now_ts pg_catalog.timestamptz := pg_catalog.now();
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 30 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  if p_operation not in ('assignSelf', 'unassign', 'markUrgent', 'clearUrgent') then
    raise exception 'invalid_report_operation' using errcode = '22023';
  end if;

  select * into report_row
  from public.reports
  where id = p_report_id
  for update;

  if not found then
    raise exception 'report_not_found' using errcode = 'P0002';
  end if;

  if report_row.status <> 'open' then
    raise exception 'report_already_processed' using errcode = '23505';
  end if;

  if p_operation = 'assignSelf'
    and report_row.assigned_to is not null
    and report_row.assigned_to <> p_actor_profile_id then
    raise exception 'report_already_assigned' using errcode = '23505';
  end if;

  update public.reports
  set
    priority = case
      when p_operation = 'markUrgent' then 'urgent'
      when p_operation = 'clearUrgent' then 'normal'
      else priority
    end,
    assigned_to = case
      when p_operation = 'assignSelf' then p_actor_profile_id
      when p_operation = 'unassign' then null
      else assigned_to
    end,
    assigned_at = case
      when p_operation = 'assignSelf' then coalesce(assigned_at, now_ts)
      else assigned_at
    end,
    updated_at = now_ts
  where id = p_report_id
  returning * into updated_row;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    report_id,
    created_by,
    payload,
    created_at
  ) values (
    'admin_report_operation_' || pg_catalog.md5(
      pg_catalog.random()::pg_catalog.text || pg_catalog.clock_timestamp()::pg_catalog.text
    ),
    'report_operation',
    'committed',
    p_report_id,
    p_actor_profile_id,
    pg_catalog.jsonb_build_object(
      'operation', p_operation,
      'previous', pg_catalog.jsonb_build_object(
        'priority', report_row.priority,
        'assignedTo', report_row.assigned_to,
        'assignedAt', report_row.assigned_at
      ),
      'next', pg_catalog.jsonb_build_object(
        'priority', updated_row.priority,
        'assignedTo', updated_row.assigned_to,
        'assignedAt', updated_row.assigned_at
      )
    ),
    now_ts
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'report', pg_catalog.to_jsonb(updated_row)
  );
end;
$$;

revoke all on function public.rankball_admin_report_operation(
  pg_catalog.text,
  pg_catalog.int4,
  pg_catalog.text,
  pg_catalog.text
) from public, anon, authenticated;
grant execute on function public.rankball_admin_report_operation(
  pg_catalog.text,
  pg_catalog.int4,
  pg_catalog.text,
  pg_catalog.text
) to service_role;

commit;
