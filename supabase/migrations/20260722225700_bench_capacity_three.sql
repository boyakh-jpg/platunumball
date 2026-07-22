alter table public.recruiting_posts
  drop constraint if exists recruiting_posts_bench_capacity_check;

alter table public.recruiting_posts
  add constraint recruiting_posts_bench_capacity_check
  check (bench_capacity between 0 and 3) not valid;

alter table public.recruiting_posts
  validate constraint recruiting_posts_bench_capacity_check;

do $$
declare
  function_record record;
  target_function regprocedure;
  function_definition text;
  old_fragment constant text := '^[0-2]$';
  new_fragment constant text := '^[0-3]$';
  old_count integer;
  new_count integer;
begin
  for function_record in
    select *
    from (values
      ('public.rankball_match_room_action_unguarded(text,text,text,jsonb)', 2),
      ('public.rankball_normalize_match_bench_capacity()', 1),
      ('public.rankball_normalize_recruiting_bench_capacity()', 1),
      ('public.rankball_recruiting_management_action_unguarded(text,jsonb)', 2),
      ('public.rankball_refresh_match_feed_for_match(text)', 1),
      ('public.rankball_slim_room_feed_card(text,jsonb)', 2),
      ('public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)', 1),
      ('public.rankball_tournament_operation_action(text,jsonb)', 1)
    ) as expected(function_signature, expected_count)
  loop
    target_function := to_regprocedure(function_record.function_signature);
    if target_function is null then
      raise exception 'bench_capacity_three_function_missing:%', function_record.function_signature;
    end if;

    select pg_get_functiondef(target_function) into function_definition;
    old_count := (length(function_definition) - length(replace(function_definition, old_fragment, ''))) / length(old_fragment);
    new_count := (length(function_definition) - length(replace(function_definition, new_fragment, ''))) / length(new_fragment);

    if old_count = function_record.expected_count then
      function_definition := replace(function_definition, old_fragment, new_fragment);
      new_count := (length(function_definition) - length(replace(function_definition, new_fragment, ''))) / length(new_fragment);
      if new_count < function_record.expected_count then
        raise exception 'bench_capacity_three_replace_failed:%', function_record.function_signature;
      end if;
      execute function_definition;
    elsif old_count = 0 and new_count >= function_record.expected_count then
      null;
    else
      raise exception 'bench_capacity_three_shape_changed:%', function_record.function_signature
        using detail = format(
          'expected old=%s or new>=%s, found old=%s new=%s',
          function_record.expected_count,
          function_record.expected_count,
          old_count,
          new_count
        );
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
