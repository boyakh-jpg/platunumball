-- Team postgame records preserve up to three reserves per side.
-- Align legacy rooms created with benchCapacity=0 before roster writes reach the trigger.

create or replace function public.rankball_normalize_match_bench_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_capacity text;
  safe_capacity integer;
  team_a_count integer;
  team_b_count integer;
  is_team_match_record boolean;
begin
  is_team_match_record := coalesce(new.rules->>'recordType', '') = 'match_record'
    and coalesce(new.rules->>'recordComposition', '') = 'team';
  raw_capacity := coalesce(
    new.rules->>'benchCapacity',
    case when tg_op = 'UPDATE' then old.rules->>'benchCapacity' end,
    '2'
  );
  if is_team_match_record then
    safe_capacity := 3;
  else
    if coalesce(raw_capacity, '') !~ '^[0-3]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    safe_capacity := raw_capacity::integer;
  end if;
  team_a_count := jsonb_array_length(
    case when jsonb_typeof(new.reserve_players->'teamA') = 'array'
      then new.reserve_players->'teamA' else '[]'::jsonb end
  );
  team_b_count := jsonb_array_length(
    case when jsonb_typeof(new.reserve_players->'teamB') = 'array'
      then new.reserve_players->'teamB' else '[]'::jsonb end
  );
  if team_a_count > safe_capacity or team_b_count > safe_capacity then
    raise exception 'match_reserve_exceeds_bench_capacity' using errcode = '23514';
  end if;
  new.rules := jsonb_set(
    coalesce(new.rules, '{}'::jsonb),
    '{benchCapacity}',
    to_jsonb(safe_capacity),
    true
  );
  return new;
end;
$$;

update public.matches
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{benchCapacity}', '3'::jsonb, true)
where coalesce(rules->>'recordType', '') = 'match_record'
  and coalesce(rules->>'recordComposition', '') = 'team'
  and coalesce(rules->>'benchCapacity', '') <> '3';

revoke all on function public.rankball_normalize_match_bench_capacity()
  from public, anon, authenticated, service_role;
