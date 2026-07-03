create or replace function public.rankball_sync_match_score_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    update public.matches
    set score_a = 0,
        score_b = 0
    where id = old.match_id
      and (score_a is distinct from 0 or score_b is distinct from 0);
    return old;
  end if;

  update public.matches
  set score_a = coalesce(new.score_a, 0),
      score_b = coalesce(new.score_b, 0)
  where id = new.match_id
    and (
      score_a is distinct from coalesce(new.score_a, 0)
      or score_b is distinct from coalesce(new.score_b, 0)
    );

  return new;
end;
$$;

create or replace function public.rankball_match_score_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  result_score record;
begin
  select score_a, score_b
  into result_score
  from public.match_results
  where match_id = new.id
  limit 1;

  if found then
    new.score_a := coalesce(result_score.score_a, 0);
    new.score_b := coalesce(result_score.score_b, 0);
  else
    new.score_a := 0;
    new.score_b := 0;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.match_results') is not null
    and to_regclass('public.matches') is not null then
    insert into public.match_results (
      match_id,
      submitted_by,
      score_a,
      score_b,
      stat_submissions,
      submitted_at
    )
    select
      m.id,
      nullif(m.created_by, ''),
      coalesce(m.score_a, 0),
      coalesce(m.score_b, 0),
      '{}'::jsonb,
      coalesce(m.confirmed_at, m.ended_at, m.updated_at, m.created_at, now())
    from public.matches m
    where not exists (
      select 1
      from public.match_results result
      where result.match_id = m.id
    )
      and (coalesce(m.score_a, 0) <> 0 or coalesce(m.score_b, 0) <> 0);

    update public.matches m
    set score_a = coalesce(result.score_a, 0),
        score_b = coalesce(result.score_b, 0)
    from public.match_results result
    where result.match_id = m.id
      and (
        m.score_a is distinct from coalesce(result.score_a, 0)
        or m.score_b is distinct from coalesce(result.score_b, 0)
      );

    execute 'drop trigger if exists rankball_match_results_score_snapshot on public.match_results';
    execute 'create trigger rankball_match_results_score_snapshot after insert or update of score_a, score_b or delete on public.match_results for each row execute function public.rankball_sync_match_score_snapshot()';
    execute 'drop trigger if exists rankball_matches_score_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_score_snapshot_guard before insert or update of score_a, score_b on public.matches for each row execute function public.rankball_match_score_snapshot_guard()';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
