begin;

create or replace function public.rankball_sync_pickup_capacity_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.rules->>'formationMode', '') = 'pickup'
     or coalesce(new.rules->>'matchIntent', '') = 'pickup' then
    new.rules := coalesce(new.rules, '{}'::jsonb) || jsonb_build_object(
      'sideCapacity', new.side_capacity,
      'benchCapacity', new.bench_capacity,
      'onCourtCount', new.side_capacity,
      'starterCount', new.side_capacity,
      'teamCapacity', new.side_capacity + new.bench_capacity,
      'participantCapacity', (new.side_capacity + new.bench_capacity) * 2,
      'waitingPlayerCapacity', new.bench_capacity * 2
    );
  end if;
  return new;
end;
$$;

drop trigger if exists recruiting_posts_sync_pickup_capacity_rules
on public.recruiting_posts;

create trigger recruiting_posts_sync_pickup_capacity_rules
before insert or update of mode, side_capacity, bench_capacity, rules
on public.recruiting_posts
for each row
execute function public.rankball_sync_pickup_capacity_rules();

update public.recruiting_posts
set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
  'sideCapacity', side_capacity,
  'benchCapacity', bench_capacity,
  'onCourtCount', side_capacity,
  'starterCount', side_capacity,
  'teamCapacity', side_capacity + bench_capacity,
  'participantCapacity', (side_capacity + bench_capacity) * 2,
  'waitingPlayerCapacity', bench_capacity * 2
)
where coalesce(rules->>'formationMode', '') = 'pickup'
   or coalesce(rules->>'matchIntent', '') = 'pickup';

revoke all on function public.rankball_sync_pickup_capacity_rules()
from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
