create or replace function public.rankball_extend_admin_appointment_action(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_appointment_id text,
  p_term_days integer default 30,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_row public.admin_appointments%rowtype;
  referee_row public.referee_appointments%rowtype;
  now_ts timestamptz := now();
  safe_admin_level integer;
  appointment_id text;
  safe_role text;
  safe_grade text;
  safe_target_user_id text;
  safe_term_days integer;
  safe_reason text;
  required_level integer;
  base_ts timestamptz;
  ends_ts timestamptz;
  audit_id text;
begin
  appointment_id := nullif(trim(p_appointment_id), '');
  if appointment_id is null then
    raise exception 'appointment_id_required' using errcode = '23502';
  end if;

  safe_admin_level := public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level);

  select * into admin_row
  from public.admin_appointments
  where id = appointment_id
  for update;

  if found then
    safe_role := 'admin';
    safe_grade := admin_row.grade;
    safe_target_user_id := admin_row.user_id;
    base_ts := greatest(coalesce(admin_row.ends_at, now_ts), now_ts);
  else
    select * into referee_row
    from public.referee_appointments
    where id = appointment_id
    for update;

    if not found then
      raise exception 'appointment_not_found' using errcode = 'P0002';
    end if;

    safe_role := 'referee';
    safe_grade := referee_row.grade;
    safe_target_user_id := referee_row.user_id;
    base_ts := greatest(coalesce(referee_row.ends_at, now_ts), now_ts);
  end if;

  required_level := case when safe_role = 'admin' then 80 else 50 end;
  if safe_admin_level < required_level then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  if safe_role = 'admin' then
    if admin_row.status in ('revoked', 'expired') or (admin_row.ends_at is not null and admin_row.ends_at < now_ts) then
      raise exception 'appointment_not_active' using errcode = '23505';
    end if;
  else
    if referee_row.status in ('revoked', 'expired') or (referee_row.ends_at is not null and referee_row.ends_at < now_ts) then
      raise exception 'appointment_not_active' using errcode = '23505';
    end if;
  end if;

  safe_term_days := case when p_term_days is not null and p_term_days > 0 then p_term_days else 30 end;
  safe_reason := coalesce(nullif(trim(p_reason), ''), '임명 연장');
  ends_ts := base_ts + make_interval(days => safe_term_days);
  audit_id := 'aa_' || md5(appointment_id || p_actor_profile_id || 'extendAppointment' || now_ts::text);

  if safe_role = 'admin' then
    update public.admin_appointments
    set
      status = 'active',
      ends_at = ends_ts,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'status', 'active',
        'endsAt', ends_ts,
        'extendedAt', now_ts,
        'extendedBy', p_actor_profile_id,
        'extendReason', safe_reason
      ),
      updated_at = now_ts
    where id = appointment_id;
  else
    update public.referee_appointments
    set
      status = 'active',
      ends_at = ends_ts,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'status', 'active',
        'endsAt', ends_ts,
        'extendedAt', now_ts,
        'extendedBy', p_actor_profile_id,
        'extendReason', safe_reason
      ),
      updated_at = now_ts
    where id = appointment_id;
  end if;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    appointment_id,
    target_user_id,
    created_by,
    payload,
    created_at
  )
  values (
    audit_id,
    'appointment_action',
    'committed',
    appointment_id,
    safe_target_user_id,
    p_actor_profile_id,
    jsonb_build_object(
      'id', audit_id,
      'type', 'appointment_action',
      'status', 'committed',
      'actionType', 'extendAppointment',
      'appointmentId', appointment_id,
      'targetUserId', safe_target_user_id,
      'role', safe_role,
      'grade', safe_grade,
      'termDays', safe_term_days,
      'reason', safe_reason,
      'createdAt', now_ts,
      'createdBy', p_actor_profile_id
    ),
    now_ts
  );

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values (
    'n_' || md5('appointment-extend' || appointment_id || safe_target_user_id || now_ts::text),
    safe_target_user_id,
    safe_target_user_id,
    '임명 연장',
    safe_reason || ' · ' || safe_term_days::text || '일',
    'team',
    'appointment',
    jsonb_build_object('appointmentId', appointment_id, 'role', safe_role, 'grade', safe_grade),
    now_ts,
    now_ts
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'actionType', 'extendAppointment',
    'appointmentId', appointment_id,
    'role', safe_role,
    'grade', safe_grade,
    'endsAt', ends_ts
  );
end;
$$;

revoke all on function public.rankball_extend_admin_appointment_action(text, integer, text, integer, text) from public;
grant execute on function public.rankball_extend_admin_appointment_action(text, integer, text, integer, text) to service_role;
