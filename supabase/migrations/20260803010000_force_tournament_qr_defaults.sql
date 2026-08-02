begin;

create or replace function public.rankball_enforce_tournament_qr_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tournament_id is not null
     and coalesce(nullif(new.rules->>'recordType', ''), 'match') = 'match' then
    new.rules := coalesce(new.rules, '{}'::jsonb) || jsonb_build_object(
      'gameClockEnabled', true,
      'qrAttendanceEnabled', true
    );
  end if;
  return new;
end;
$$;

drop trigger if exists matches_tournament_qr_defaults on public.matches;
create trigger matches_tournament_qr_defaults
before insert or update of tournament_id, rules on public.matches
for each row execute function public.rankball_enforce_tournament_qr_defaults();

revoke all on function public.rankball_enforce_tournament_qr_defaults() from public, anon, authenticated;

update public.matches
set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
      'gameClockEnabled', true,
      'qrAttendanceEnabled', true
    ),
    updated_at = clock_timestamp()
where tournament_id is not null
  and status in ('contract', 'agreed')
  and started_at is null
  and ended_at is null
  and cancelled_at is null
  and voided_at is null
  and coalesce(nullif(rules->>'recordType', ''), 'match') = 'match'
  and (
    lower(coalesce(rules->>'gameClockEnabled', 'false')) <> 'true'
    or lower(coalesce(rules->>'qrAttendanceEnabled', 'false')) <> 'true'
  );

select pg_notify('pgrst', 'reload schema');

commit;
