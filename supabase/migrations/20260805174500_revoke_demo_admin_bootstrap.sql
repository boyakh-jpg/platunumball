begin;

insert into public.admin_audit_log (
  id, type, status, appointment_id, target_user_id, created_by, payload, created_at
)
select
  'aa_' || md5('demo-admin-bootstrap-revoke:' || appointment.id),
  'appointment_action',
  'committed',
  appointment.id,
  appointment.user_id,
  null,
  jsonb_build_object(
    'actionType', 'revokeAppointment',
    'appointmentId', appointment.id,
    'targetUserId', appointment.user_id,
    'role', 'admin',
    'reason', 'demo_admin_bootstrap_removed',
    'autoRevoked', true
  ),
  now()
from public.admin_appointments appointment
join public.profiles profile on profile.id = appointment.user_id
where appointment.id = 'ap_region_rankball_001'
  and profile.test_login_id = 'rankball-001'
  and appointment.status = 'active'
on conflict (id) do nothing;

update public.admin_appointments appointment
set status = 'revoked',
    ends_at = least(coalesce(appointment.ends_at, now()), now()),
    payload = coalesce(appointment.payload, '{}'::jsonb) || jsonb_build_object(
      'status', 'revoked',
      'revokedAt', now(),
      'revokeReason', 'demo_admin_bootstrap_removed',
      'autoRevoked', true
    ),
    updated_at = now()
from public.profiles profile
where profile.id = appointment.user_id
  and appointment.id = 'ap_region_rankball_001'
  and profile.test_login_id = 'rankball-001'
  and appointment.status = 'active';

commit;
