begin;

create or replace function public.rankball_referee_assignment_eligible(
  p_profile_id text,
  p_through_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = nullif(btrim(p_profile_id), '')
      and (
        lower(coalesce(profile.test_login_id, '')) in ('rankball-001', 'rankball-011')
        or exists (
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
      )
  );
$$;

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
        public.rankball_referee_assignment_eligible(p_profile_id, now())
        or (
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
  select public.rankball_referee_assignment_eligible(
    p_profile_id,
    case
      when p_through_date is null then now()
      else (p_through_date + 1)::timestamptz - interval '1 microsecond'
    end
  );
$$;

do $patch$
declare
  function_definition text;
  patched_definition text;
  trust_fragment text;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure
  );
  patched_definition := function_definition;
  foreach trust_fragment in array array[
    '(coalesce(profile.trust_score, 80) >= 70 or lower(coalesce(profile.test_login_id, '''')) in (''rankball-001'', ''rankball-011''))',
    'coalesce(profile.trust_score, 80) >= current_post.referee_trust_min',
    'coalesce(profile.trust_score, 80) >= 90'
  ]
  loop
    patched_definition := replace(patched_definition, trust_fragment, 'true');
  end loop;
  if patched_definition = function_definition then
    raise exception 'recruiting_referee_trust_shape_changed' using errcode = '55000';
  end if;
  execute patched_definition;
end;
$patch$;

insert into public.referee_appointments (
  id, user_id, role, grade, status, starts_at, ends_at, payload, created_at, updated_at
)
select
  'referee-alpha-' || profile.id,
  profile.id,
  'referee',
  'candidate',
  'active',
  now(),
  null,
  jsonb_build_object('alphaTestException', true),
  now(),
  now()
from public.profiles profile
where lower(coalesce(profile.test_login_id, '')) in ('rankball-001', 'rankball-011')
  and not exists (
    select 1
    from public.referee_appointments appointment
    where appointment.user_id = profile.id
      and appointment.role = 'referee'
      and appointment.status = 'active'
      and (appointment.starts_at is null or appointment.starts_at <= now())
      and (appointment.ends_at is null or appointment.ends_at > now())
  )
on conflict (id) do nothing;

revoke all on function public.rankball_referee_assignment_eligible(text, timestamptz)
from public, anon, authenticated;
revoke all on function public.rankball_is_match_referee_eligible(text, text)
from public, anon, authenticated;
revoke all on function public.rankball_tournament_referee_eligible(text, date)
from public, anon, authenticated;

grant execute on function public.rankball_referee_assignment_eligible(text, timestamptz) to service_role;
grant execute on function public.rankball_is_match_referee_eligible(text, text) to service_role;
grant execute on function public.rankball_tournament_referee_eligible(text, date) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
