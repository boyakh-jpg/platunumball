-- Keep every post-match dispute window on the shared 10/15/20 minute policy.
create or replace function public.rankball_normalize_dispute_minutes(p_value integer default null)
returns integer
language sql
immutable
parallel safe
as $$
  select case when p_value in (10, 15, 20) then p_value else 15 end;
$$;

grant execute on function public.rankball_normalize_dispute_minutes(integer)
to anon, authenticated, service_role;

update public.matches
set dispute_minutes = public.rankball_normalize_dispute_minutes(dispute_minutes),
    objection_window = public.rankball_normalize_dispute_minutes(dispute_minutes)::text || '분'
where dispute_minutes not in (10, 15, 20)
   or dispute_minutes is null
   or objection_window is distinct from public.rankball_normalize_dispute_minutes(dispute_minutes)::text || '분';

update public.recruiting_posts
set dispute_minutes = public.rankball_normalize_dispute_minutes(dispute_minutes)
where dispute_minutes not in (10, 15, 20)
   or dispute_minutes is null;

alter table public.matches
  alter column dispute_minutes set default 15;

alter table public.recruiting_posts
  alter column dispute_minutes set default 15;

alter table public.matches
  drop constraint if exists matches_dispute_minutes_range;

alter table public.matches
  add constraint matches_dispute_minutes_range
  check (dispute_minutes in (10, 15, 20));

alter table public.recruiting_posts
  drop constraint if exists recruiting_posts_dispute_minutes_range;

alter table public.recruiting_posts
  add constraint recruiting_posts_dispute_minutes_range
  check (dispute_minutes in (10, 15, 20));

create or replace function public.rankball_normalize_dispute_window_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.dispute_minutes := public.rankball_normalize_dispute_minutes(new.dispute_minutes);
  if tg_table_name = 'matches' then
    new.objection_window := new.dispute_minutes::text || '분';
  end if;
  return new;
end;
$$;

drop trigger if exists rankball_matches_normalize_dispute_window on public.matches;
create trigger rankball_matches_normalize_dispute_window
before insert or update of dispute_minutes, objection_window on public.matches
for each row execute function public.rankball_normalize_dispute_window_row();

drop trigger if exists rankball_recruiting_normalize_dispute_window on public.recruiting_posts;
create trigger rankball_recruiting_normalize_dispute_window
before insert or update of dispute_minutes on public.recruiting_posts
for each row execute function public.rankball_normalize_dispute_window_row();

-- Patch the authoritative RPCs in place so every current write and deadline path
-- calls the same normalizer. The row triggers remain the final invariant guard.
do $migration$
declare
  patch record;
  function_definition text;
  repaired_definition text;
begin
  for patch in
    select *
    from (values
      (
        'public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)',
        'from jsonb_populate_record(null::public.matches, p_match_row)',
        $replacement$from jsonb_populate_record(
    null::public.matches,
    p_match_row || jsonb_build_object(
      'dispute_minutes', public.rankball_normalize_dispute_minutes(nullif(p_match_row->>'dispute_minutes', '')::integer),
      'objection_window', public.rankball_normalize_dispute_minutes(nullif(p_match_row->>'dispute_minutes', '')::integer)::text || '분'
    )
  )$replacement$
      ),
      (
        'public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)',
        'from jsonb_populate_record(null::public.recruiting_posts, p_post_row)',
        $replacement$from jsonb_populate_record(
    null::public.recruiting_posts,
    p_post_row || jsonb_build_object(
      'dispute_minutes', public.rankball_normalize_dispute_minutes(nullif(p_post_row->>'dispute_minutes', '')::integer)
    )
  )$replacement$
      ),
      (
        'public.rankball_create_tournament_match_locked_unguarded(text,text,text,integer,integer,text)',
        '''dispute_minutes'', 30',
        '''dispute_minutes'', public.rankball_normalize_dispute_minutes(null)'
      ),
      (
        'public.rankball_match_dispute_action(text,text,jsonb)',
        'dispute_minutes := case when current_match.dispute_minutes in (10, 15, 20) then current_match.dispute_minutes else 15 end;',
        'dispute_minutes := public.rankball_normalize_dispute_minutes(current_match.dispute_minutes);'
      ),
      (
        'public.rankball_match_result_action_roster_unguarded(text,text,jsonb)',
        'greatest(1, coalesce(current_match.dispute_minutes, 30))',
        'public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)'
      ),
      (
        'public.rankball_match_auto_finalize_action(text,timestamp with time zone)',
        'greatest(1, least(60, coalesce(current_match.dispute_minutes, 30)))',
        'public.rankball_normalize_dispute_minutes(current_match.dispute_minutes)'
      )
    ) as patches(signature, old_fragment, new_fragment)
  loop
    select pg_get_functiondef(to_regprocedure(patch.signature)) into function_definition;
    if function_definition is null then
      raise exception 'dispute_window_function_missing: %', patch.signature using errcode = '42883';
    end if;
    if position(patch.new_fragment in function_definition) > 0 then
      continue;
    end if;
    repaired_definition := replace(function_definition, patch.old_fragment, patch.new_fragment);
    if repaired_definition = function_definition then
      raise exception 'dispute_window_function_definition_unrecognized: %', patch.signature using errcode = '23514';
    end if;
    execute repaired_definition;
  end loop;
end;
$migration$;

create or replace function public.rankball_dispute_window_health()
returns table(check_name text, ok boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  match_default text;
  recruiting_default text;
  invalid_match_count bigint;
  invalid_recruiting_count bigint;
  missing_normalized_functions text;
begin
  select pg_get_expr(default_value.adbin, default_value.adrelid)
  into match_default
  from pg_attribute attribute
  join pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = 'public.matches'::regclass
    and attribute.attname = 'dispute_minutes';

  select pg_get_expr(default_value.adbin, default_value.adrelid)
  into recruiting_default
  from pg_attribute attribute
  join pg_attrdef default_value
    on default_value.adrelid = attribute.attrelid
   and default_value.adnum = attribute.attnum
  where attribute.attrelid = 'public.recruiting_posts'::regclass
    and attribute.attname = 'dispute_minutes';

  select count(*) into invalid_match_count
  from public.matches where dispute_minutes not in (10, 15, 20) or dispute_minutes is null;

  select count(*) into invalid_recruiting_count
  from public.recruiting_posts where dispute_minutes not in (10, 15, 20) or dispute_minutes is null;

  with required(signature) as (
    values
      ('public.rankball_persist_match_snapshot(jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'),
      ('public.rankball_persist_recruiting_snapshot(jsonb,jsonb,jsonb)'),
      ('public.rankball_create_tournament_match_locked_unguarded(text,text,text,integer,integer,text)'),
      ('public.rankball_match_dispute_action(text,text,jsonb)'),
      ('public.rankball_match_result_action_roster_unguarded(text,text,jsonb)'),
      ('public.rankball_match_auto_finalize_action(text,timestamp with time zone)')
  )
  select string_agg(required.signature, ', ' order by required.signature)
  into missing_normalized_functions
  from required
  where to_regprocedure(required.signature) is null
     or position(
       'rankball_normalize_dispute_minutes'
       in coalesce(pg_get_functiondef(to_regprocedure(required.signature)), '')
     ) = 0;

  return query values
    ('normalizer_values',
      public.rankball_normalize_dispute_minutes(10) = 10
      and public.rankball_normalize_dispute_minutes(15) = 15
      and public.rankball_normalize_dispute_minutes(20) = 20
      and public.rankball_normalize_dispute_minutes(null) = 15
      and public.rankball_normalize_dispute_minutes(30) = 15,
      'allowed=10,15,20; fallback=15'),
    ('matches_default', match_default = '15', coalesce(match_default, 'missing')),
    ('recruiting_default', recruiting_default = '15', coalesce(recruiting_default, 'missing')),
    ('matches_values', invalid_match_count = 0, invalid_match_count::text),
    ('recruiting_values', invalid_recruiting_count = 0, invalid_recruiting_count::text),
    ('matches_constraint', exists (
      select 1 from pg_constraint
      where conrelid = 'public.matches'::regclass
        and conname = 'matches_dispute_minutes_range'
        and convalidated
        and pg_get_constraintdef(oid) like '%10%15%20%'
    ), 'matches_dispute_minutes_range'),
    ('recruiting_constraint', exists (
      select 1 from pg_constraint
      where conrelid = 'public.recruiting_posts'::regclass
        and conname = 'recruiting_posts_dispute_minutes_range'
        and convalidated
        and pg_get_constraintdef(oid) like '%10%15%20%'
    ), 'recruiting_posts_dispute_minutes_range'),
    ('matches_trigger', exists (
      select 1 from pg_trigger
      where tgrelid = 'public.matches'::regclass
        and tgname = 'rankball_matches_normalize_dispute_window'
        and tgenabled <> 'D'
    ), 'rankball_matches_normalize_dispute_window'),
    ('recruiting_trigger', exists (
      select 1 from pg_trigger
      where tgrelid = 'public.recruiting_posts'::regclass
        and tgname = 'rankball_recruiting_normalize_dispute_window'
        and tgenabled <> 'D'
    ), 'rankball_recruiting_normalize_dispute_window'),
    ('rpc_normalization', missing_normalized_functions is null, coalesce(missing_normalized_functions, 'ok'));
end;
$$;

revoke all on function public.rankball_dispute_window_health() from public, anon, authenticated;
grant execute on function public.rankball_dispute_window_health() to service_role;

select pg_notify('pgrst', 'reload schema');
