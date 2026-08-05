begin;

create or replace function public.rankball_referee_assignment_eligible(
  p_profile_id text,
  p_through_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = nullif(btrim(p_profile_id), '')
      and exists (
        select 1
        from public.referee_appointments appointment
        where appointment.user_id = profile.id
          and appointment.role = 'referee'
          and appointment.grade in ('candidate', 'silver', 'gold', 'platinum', 'official')
          and appointment.status = 'active'
          and (appointment.starts_at is null or appointment.starts_at <= now())
          and (
            appointment.ends_at is null
            or appointment.ends_at >= greatest(now(), coalesce(p_through_at, now()))
          )
      )
  );
$$;

create or replace function public.rankball_revoke_referee_below_active_trust()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(old.trust_score, 0) >= 70
    and coalesce(new.trust_score, 0) < 70
  then
    insert into public.admin_audit_log (
      id, type, status, appointment_id, target_user_id, created_by, payload, created_at
    )
    select
      'aa_' || md5('referee-trust-auto-revoke:' || appointment.id || ':' || now()::text),
      'appointment_action',
      'committed',
      appointment.id,
      new.id,
      null,
      jsonb_build_object(
        'actionType', 'revokeAppointment',
        'appointmentId', appointment.id,
        'targetUserId', new.id,
        'role', 'referee',
        'reason', 'referee_trust_below_70',
        'autoRevoked', true
      ),
      now()
    from public.referee_appointments appointment
    where appointment.user_id = new.id
      and appointment.role = 'referee'
      and appointment.status = 'active'
    on conflict (id) do nothing;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
    )
    select
      'n_' || md5('referee-trust-auto-revoke:' || appointment.id || ':' || now()::text),
      new.id,
      new.id,
      '심판 자격 활동 정지',
      '신뢰도 70 미만으로 심판 임명이 자동 회수되었습니다.',
      'orange',
      'appointment',
      jsonb_build_object(
        'appointmentId', appointment.id,
        'role', 'referee',
        'reason', 'referee_trust_below_70',
        'autoRevoked', true
      ),
      now(),
      now()
    from public.referee_appointments appointment
    where appointment.user_id = new.id
      and appointment.role = 'referee'
      and appointment.status = 'active'
    on conflict (id) do nothing;

    update public.referee_appointments
    set status = 'revoked',
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'status', 'revoked',
          'revokedAt', now(),
          'revokeReason', 'referee_trust_below_70',
          'autoRevoked', true
        ),
        updated_at = now()
    where user_id = new.id
      and role = 'referee'
      and status = 'active';
  end if;
  return new;
end;
$$;

insert into public.admin_audit_log (
  id, type, status, appointment_id, target_user_id, created_by, payload, created_at
)
select
  'aa_' || md5('referee-trust-backfill-revoke:' || appointment.id),
  'appointment_action',
  'committed',
  appointment.id,
  profile.id,
  null,
  jsonb_build_object(
    'actionType', 'revokeAppointment',
    'appointmentId', appointment.id,
    'targetUserId', profile.id,
    'role', 'referee',
    'reason', 'referee_trust_below_70',
    'autoRevoked', true
  ),
  now()
from public.referee_appointments appointment
join public.profiles profile on profile.id = appointment.user_id
where coalesce(profile.trust_score, 0) < 70
  and appointment.role = 'referee'
  and appointment.status = 'active'
on conflict (id) do nothing;

insert into public.notifications (
  id, user_id, target_user_id, title, body, tone, type, payload, created_at, updated_at
)
select
  'n_' || md5('referee-trust-backfill-revoke:' || appointment.id),
  profile.id,
  profile.id,
  '심판 자격 활동 정지',
  '신뢰도 70 미만으로 심판 임명이 자동 회수되었습니다.',
  'orange',
  'appointment',
  jsonb_build_object(
    'appointmentId', appointment.id,
    'role', 'referee',
    'reason', 'referee_trust_below_70',
    'autoRevoked', true
  ),
  now(),
  now()
from public.referee_appointments appointment
join public.profiles profile on profile.id = appointment.user_id
where coalesce(profile.trust_score, 0) < 70
  and appointment.role = 'referee'
  and appointment.status = 'active'
on conflict (id) do nothing;

update public.referee_appointments appointment
set status = 'revoked',
    payload = coalesce(appointment.payload, '{}'::jsonb) || jsonb_build_object(
      'status', 'revoked',
      'revokedAt', now(),
      'revokeReason', 'referee_trust_below_70',
      'autoRevoked', true
    ),
    updated_at = now()
from public.profiles profile
where profile.id = appointment.user_id
  and coalesce(profile.trust_score, 0) < 70
  and appointment.role = 'referee'
  and appointment.status = 'active';

revoke all on function public.rankball_referee_assignment_eligible(text, timestamptz)
from public, anon, authenticated;
revoke all on function public.rankball_revoke_referee_below_active_trust()
from public, anon, authenticated;

grant execute on function public.rankball_referee_assignment_eligible(text, timestamptz) to service_role;
grant execute on function public.rankball_revoke_referee_below_active_trust() to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
