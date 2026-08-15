begin;

create or replace function public.rankball_clear_stale_match_period_scores()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (
    new.score_a is distinct from old.score_a
    or new.score_b is distinct from old.score_b
  ) and new.period_scores is not distinct from old.period_scores then
    new.period_scores := '[]'::jsonb;
  end if;

  return new;
end;
$$;

drop trigger if exists rankball_match_results_clear_stale_period_scores
on public.match_results;

create trigger rankball_match_results_clear_stale_period_scores
before update of score_a, score_b, period_scores
on public.match_results
for each row
execute function public.rankball_clear_stale_match_period_scores();

revoke all on function public.rankball_clear_stale_match_period_scores()
from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
