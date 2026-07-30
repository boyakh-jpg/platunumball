begin;

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
    and (
      exists (
        select 1
        from public.profiles profile_row
        where profile_row.id = nullif(btrim(p_profile_id), '')
          and profile_row.test_login_id in ('rankball-001', 'rankball-011')
      )
      or (
        exists (
          select 1
          from public.profiles profile_row
          where profile_row.id = nullif(btrim(p_profile_id), '')
            and coalesce(profile_row.trust_score, 0) >= 90
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
              or appointment.ends_at >= greatest(
                now(),
                case
                  when p_through_date is null then now()
                  else ((p_through_date + 1)::timestamp at time zone 'UTC') - interval '1 millisecond'
                end
              )
            )
        )
      )
    );
$$;

revoke all on function public.rankball_tournament_referee_eligible(text, date)
from public, anon, authenticated;

commit;
