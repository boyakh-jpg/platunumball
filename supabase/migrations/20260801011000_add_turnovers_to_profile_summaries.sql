begin;

alter table public.profile_match_summaries
  add column if not exists turnovers integer not null default 0 check (turnovers >= 0);

alter table public.profile_personal_record_summaries
  add column if not exists turnovers integer not null default 0 check (turnovers >= 0),
  add column if not exists public_turnovers integer not null default 0 check (public_turnovers >= 0);

do $migration$
declare
  function_definition text;
  target_function regprocedure;
  old_text text;
  new_text text;
begin
  foreach target_function in array array[
    'public.rankball_rebuild_profile_match_summary(text)'::regprocedure,
    'public.rankball_refresh_all_profile_match_summaries()'::regprocedure
  ] loop
    select pg_get_functiondef(target_function) into function_definition;
    function_definition := replace(function_definition, E'\r\n', E'\n');
    if position('coalesce(sum(coalesce(stat.turnovers, 0)), 0)::integer as turnovers' in function_definition) = 0 then
      old_text := $old$      coalesce(sum(coalesce(stat.blocks, 0)), 0)::integer as blocks,
      coalesce(sum(coalesce(stat.fouls, 0)), 0)::integer as fouls,$old$;
      new_text := $new$      coalesce(sum(coalesce(stat.blocks, 0)), 0)::integer as blocks,
      coalesce(sum(coalesce(stat.turnovers, 0)), 0)::integer as turnovers,
      coalesce(sum(coalesce(stat.fouls, 0)), 0)::integer as fouls,$new$;
      if position(old_text in function_definition) = 0 then
        raise exception 'profile_match_summary_turnovers_aggregate_shape_changed: %', target_function using errcode = '55000';
      end if;
      function_definition := replace(function_definition, old_text, new_text);

      old_text := $old$    blocks,
    fouls,$old$;
      new_text := $new$    blocks,
    turnovers,
    fouls,$new$;
      if position(old_text in function_definition) = 0 then
        raise exception 'profile_match_summary_turnovers_column_shape_changed: %', target_function using errcode = '55000';
      end if;
      function_definition := replace(function_definition, old_text, new_text);

      old_text := $old$    blocks = excluded.blocks,
    fouls = excluded.fouls,$old$;
      new_text := $new$    blocks = excluded.blocks,
    turnovers = excluded.turnovers,
    fouls = excluded.fouls,$new$;
      if position(old_text in function_definition) = 0 then
        raise exception 'profile_match_summary_turnovers_upsert_shape_changed: %', target_function using errcode = '55000';
      end if;
      function_definition := replace(function_definition, old_text, new_text);
      execute function_definition;
    end if;
  end loop;
end;
$migration$;

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef('public.rankball_rebuild_personal_record_summary(text)'::regprocedure)
    into function_definition;
  function_definition := replace(function_definition, E'\r\n', E'\n');
  if position('coalesce(stat_row.turnovers, 0) as turnovers' in function_definition) = 0 then
    old_text := $old$      coalesce(stat_row.blocks, 0) as blocks,
      coalesce(stat_row.fouls, 0) as fouls$old$;
    new_text := $new$      coalesce(stat_row.blocks, 0) as blocks,
      coalesce(stat_row.turnovers, 0) as turnovers,
      coalesce(stat_row.fouls, 0) as fouls$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'personal_record_summary_turnovers_source_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$      coalesce(sum(blocks), 0)::integer as blocks,
      coalesce(sum(fouls), 0)::integer as fouls,$old$;
    new_text := $new$      coalesce(sum(blocks), 0)::integer as blocks,
      coalesce(sum(turnovers), 0)::integer as turnovers,
      coalesce(sum(fouls), 0)::integer as fouls,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'personal_record_summary_turnovers_aggregate_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$      coalesce(sum(blocks) filter (where visibility = 'public'), 0)::integer as public_blocks,
      coalesce(sum(fouls) filter (where visibility = 'public'), 0)::integer as public_fouls,$old$;
    new_text := $new$      coalesce(sum(blocks) filter (where visibility = 'public'), 0)::integer as public_blocks,
      coalesce(sum(turnovers) filter (where visibility = 'public'), 0)::integer as public_turnovers,
      coalesce(sum(fouls) filter (where visibility = 'public'), 0)::integer as public_fouls,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'personal_record_summary_public_turnovers_aggregate_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    points, rebounds, assists, steals, blocks, fouls,$old$;
    new_text := $new$    points, rebounds, assists, steals, blocks, turnovers, fouls,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'personal_record_summary_turnovers_column_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    public_points, public_rebounds, public_assists, public_steals, public_blocks, public_fouls,$old$;
    new_text := $new$    public_points, public_rebounds, public_assists, public_steals, public_blocks, public_turnovers, public_fouls,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'personal_record_summary_public_turnovers_column_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    blocks = excluded.blocks,
    fouls = excluded.fouls,$old$;
    new_text := $new$    blocks = excluded.blocks,
    turnovers = excluded.turnovers,
    fouls = excluded.fouls,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'personal_record_summary_turnovers_upsert_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);

    old_text := $old$    public_blocks = excluded.public_blocks,
    public_fouls = excluded.public_fouls,$old$;
    new_text := $new$    public_blocks = excluded.public_blocks,
    public_turnovers = excluded.public_turnovers,
    public_fouls = excluded.public_fouls,$new$;
    if position(old_text in function_definition) = 0 then
      raise exception 'personal_record_summary_public_turnovers_upsert_shape_changed' using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_text, new_text);
    execute function_definition;
  end if;
end;
$migration$;

select public.rankball_refresh_all_profile_match_summaries();
select public.rankball_rebuild_personal_record_summary(profile_row.id)
from public.profiles profile_row;

select pg_notify('pgrst', 'reload schema');

commit;
