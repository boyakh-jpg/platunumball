begin;

create or replace function public.rankball_is_match_referee_eligible(
  p_profile_id text,
  p_match_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.matches match_row
    where match_row.id = nullif(btrim(p_match_id), '')
      and nullif(btrim(match_row.referee_id), '') = nullif(btrim(p_profile_id), '')
      and (
        (
          match_row.started_at is not null
          and match_row.confirmed_at is null
          and match_row.status not in ('cancelled', 'void', 'voided', 'closed', 'confirmed')
          and exists (
            select 1
            from public.profiles revoked_profile
            where revoked_profile.id = nullif(btrim(p_profile_id), '')
              and coalesce(revoked_profile.trust_score, 0) < 70
          )
          and exists (
            select 1
            from public.referee_appointments revoked_appointment
            where revoked_appointment.user_id = nullif(btrim(p_profile_id), '')
              and revoked_appointment.role = 'referee'
              and revoked_appointment.status = 'revoked'
              and revoked_appointment.payload->>'autoRevoked' = 'true'
              and revoked_appointment.payload->>'revokeReason' = 'referee_trust_below_70'
              and match_row.started_at <= (revoked_appointment.payload->>'revokedAt')::timestamptz
          )
        )
        or exists (
          select 1
          from public.profiles profile
          join public.referee_appointments appointment on appointment.user_id = profile.id
          where profile.id = nullif(btrim(p_profile_id), '')
            and (
              coalesce(profile.trust_score, 0) >= 70
              or lower(coalesce(profile.test_login_id, '')) in ('rankball-001', 'rankball-011')
            )
            and appointment.role = 'referee'
            and appointment.grade in ('candidate', 'silver', 'gold', 'platinum', 'official')
            and appointment.status = 'active'
            and (appointment.starts_at is null or appointment.starts_at <= now())
            and (appointment.ends_at is null or appointment.ends_at > now())
        )
      )
  );
$$;

create or replace function public.rankball_tournament_referee_eligible(
  p_profile_id text,
  p_through_date date default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    nullif(btrim(p_profile_id), '') is not null
    and exists (
      select 1
      from public.profiles profile_row
      where profile_row.id = nullif(btrim(p_profile_id), '')
        and (
          coalesce(profile_row.trust_score, 0) >= 70
          or lower(coalesce(profile_row.test_login_id, '')) in ('rankball-001', 'rankball-011')
        )
    )
    and exists (
      select 1
      from public.referee_appointments appointment
      where appointment.user_id = nullif(btrim(p_profile_id), '')
        and appointment.role = 'referee'
        and appointment.grade in ('candidate', 'silver', 'gold', 'platinum', 'official')
        and coalesce(appointment.status, 'active') not in (
          'pending', 'rejected', 'revoked', 'expired', 'suspended', 'blocked'
        )
        and (appointment.starts_at is null or appointment.starts_at <= now())
        and (
          appointment.ends_at is null
          or appointment.ends_at >= case
            when p_through_date is null then now()
            else ((p_through_date + 1)::timestamp at time zone 'Asia/Seoul')
          end
        )
    );
$$;

create or replace function public.rankball_tournament_referee_authorized(
  p_profile_id text,
  p_tournament_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tournaments tournament_row
    where tournament_row.id = nullif(btrim(p_tournament_id), '')
      and (
        public.rankball_tournament_referee_eligible(p_profile_id, tournament_row.end_date)
        or (
          tournament_row.status = 'active'
          and tournament_row.started_at is not null
          and coalesce(tournament_row.referee_ids, '[]'::jsonb) ? nullif(btrim(p_profile_id), '')
          and coalesce(
            tournament_row.referee_statuses->>nullif(btrim(p_profile_id), ''),
            'invited'
          ) = 'accepted'
          and exists (
            select 1
            from public.profiles revoked_profile
            where revoked_profile.id = nullif(btrim(p_profile_id), '')
              and coalesce(revoked_profile.trust_score, 0) < 70
          )
          and exists (
            select 1
            from public.referee_appointments revoked_appointment
            where revoked_appointment.user_id = nullif(btrim(p_profile_id), '')
              and revoked_appointment.role = 'referee'
              and revoked_appointment.status = 'revoked'
              and revoked_appointment.payload->>'autoRevoked' = 'true'
              and revoked_appointment.payload->>'revokeReason' = 'referee_trust_below_70'
              and tournament_row.started_at <= (revoked_appointment.payload->>'revokedAt')::timestamptz
          )
        )
      )
  );
$$;

create or replace function public.rankball_revoke_referee_below_active_trust()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.trust_score, 0) >= 70
    and coalesce(new.trust_score, 0) < 70
    and lower(coalesce(new.test_login_id, '')) not in ('rankball-001', 'rankball-011')
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

drop trigger if exists rankball_referee_active_trust_guard on public.profiles;
create trigger rankball_referee_active_trust_guard
after update of trust_score on public.profiles
for each row execute function public.rankball_revoke_referee_below_active_trust();

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
  and lower(coalesce(profile.test_login_id, '')) not in ('rankball-001', 'rankball-011')
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
  and lower(coalesce(profile.test_login_id, '')) not in ('rankball-001', 'rankball-011')
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
  and lower(coalesce(profile.test_login_id, '')) not in ('rankball-001', 'rankball-011')
  and appointment.role = 'referee'
  and appointment.status = 'active';

do $patch$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_commit_admin_appointment_action(text,integer,text,text,text,text,text,integer,text)'::regprocedure
  );
  old_text := $old$  if safe_role = 'admin' then
    safe_grade := case$old$;
  new_text := $new$  if safe_role = 'referee' and not exists (
    select 1
    from public.profiles
    where id = safe_target_user_id
      and coalesce(trust_score, 0) >= 90
  ) then
    raise exception 'referee_entry_trust_too_low' using errcode = '23514';
  end if;

  if safe_role = 'admin' then
    safe_grade := case$new$;
  if strpos(function_definition, old_text) = 0 then
    raise exception 'admin_referee_entry_trust_shape_changed';
  end if;
  execute replace(function_definition, old_text, new_text);
end;
$patch$;

do $patch$
declare
  function_definition text;
  patched_definition text;
  fixed_threshold text := 'coalesce(profile.trust_score, 80) >= 90';
  stored_threshold text := 'coalesce(profile.trust_score, 80) >= current_post.referee_trust_min';
begin
  function_definition := pg_get_functiondef(
    'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure
  );
  if strpos(function_definition, fixed_threshold) = 0 then
    raise exception 'recruiting_referee_fixed_trust_shape_changed';
  end if;
  if strpos(function_definition, stored_threshold) = 0 then
    raise exception 'recruiting_referee_stored_trust_shape_changed';
  end if;
  patched_definition := replace(
    function_definition,
    fixed_threshold,
    '(coalesce(profile.trust_score, 80) >= 70 or lower(coalesce(profile.test_login_id, '''')) in (''rankball-001'', ''rankball-011''))'
  );
  patched_definition := replace(
    patched_definition,
    stored_threshold,
    '(coalesce(profile.trust_score, 80) >= 70 or lower(coalesce(profile.test_login_id, '''')) in (''rankball-001'', ''rankball-011''))'
  );
  execute patched_definition;
end;
$patch$;

do $patch$
declare
  function_signature text;
  function_definition text;
  patched_definition text;
begin
  foreach function_signature in array array[
    'public.rankball_tournament_referee_coverage_ready(text,boolean)',
    'public.rankball_tournament_approval_ready(text)',
    'public.rankball_tournament_match_schedule_action(text,text,text,jsonb)',
    'public.rankball_match_start_action_guarded(text,text,text,text,jsonb)'
  ]
  loop
    if to_regprocedure(function_signature) is null then
      raise exception 'tournament_referee_authority_function_missing: %', function_signature;
    end if;
    function_definition := pg_get_functiondef(function_signature::regprocedure);
    patched_definition := replace(
      function_definition,
      'public.rankball_tournament_referee_eligible(referee.referee_id, tournament_row.end_date)',
      'public.rankball_tournament_referee_authorized(referee.referee_id, tournament_row.id)'
    );
    patched_definition := replace(
      patched_definition,
      'public.rankball_tournament_referee_eligible(match_row.referee_id, tournament_row.end_date)',
      'public.rankball_tournament_referee_authorized(match_row.referee_id, tournament_row.id)'
    );
    if patched_definition = function_definition then
      raise exception 'tournament_referee_authority_shape_changed: %', function_signature;
    end if;
    execute patched_definition;
  end loop;
end;
$patch$;

revoke all on function public.rankball_is_match_referee_eligible(text, text)
from public, anon, authenticated;
revoke all on function public.rankball_tournament_referee_eligible(text, date)
from public, anon, authenticated;
revoke all on function public.rankball_tournament_referee_authorized(text, text)
from public, anon, authenticated;
revoke all on function public.rankball_revoke_referee_below_active_trust()
from public, anon, authenticated;

grant execute on function public.rankball_is_match_referee_eligible(text, text) to service_role;
grant execute on function public.rankball_tournament_referee_eligible(text, date) to service_role;
grant execute on function public.rankball_tournament_referee_authorized(text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
