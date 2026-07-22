create or replace function pg_temp.rankball_patch_function_definition(
  target_function regprocedure,
  old_fragment text,
  new_fragment text,
  shape_error text
)
returns void
language plpgsql
as $helper$
declare
  function_definition text;
begin
  select pg_get_functiondef(target_function) into function_definition;
  if function_definition is null then
    raise exception '%', shape_error;
  end if;
  if position(old_fragment in function_definition) > 0 then
    execute replace(function_definition, old_fragment, new_fragment);
  elsif position(new_fragment in function_definition) = 0 then
    raise exception '%', shape_error;
  end if;
end;
$helper$;

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$  side_capacity integer;
  active_a jsonb;$old$,
  $new$  side_capacity integer;
  bench_capacity integer;
  active_a jsonb;$new$,
  'match_room_bench_declaration_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$  side_capacity := greatest(1, least(5, coalesce((current_match.rules->>'sideCapacity')::integer, substring(current_match.mode from '^[0-9]+')::integer, 5)));$old$,
  $new$  side_capacity := greatest(1, least(5, coalesce((current_match.rules->>'sideCapacity')::integer, substring(current_match.mode from '^[0-9]+')::integer, 5)));
  bench_capacity := case
    when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-2]$' then (current_match.rules->>'benchCapacity')::integer
    else 2
  end;$new$,
  'match_room_bench_initialization_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$    side_capacity := greatest(1, least(5, coalesce((patch->>'sideCapacity')::integer, side_capacity)));
    if jsonb_array_length(active_a) > side_capacity or jsonb_array_length(active_b) > side_capacity then$old$,
  $new$    side_capacity := greatest(1, least(5, coalesce((patch->>'sideCapacity')::integer, side_capacity)));
    if side_capacity not in (1, 2, 3, 5)
       and not (side_capacity = 4 and coalesce(current_match.rules->>'recordType', '') = 'solo') then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    if patch ? 'benchCapacity' and coalesce(patch->>'benchCapacity', '') !~ '^[0-2]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    bench_capacity := coalesce((patch->>'benchCapacity')::integer, bench_capacity);
    if jsonb_array_length(active_a) > side_capacity or jsonb_array_length(active_b) > side_capacity then$new$,
  'match_room_mode_and_bench_guard_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$          'sideCapacity', side_capacity,
          'targetScore',$old$,
  $new$          'sideCapacity', side_capacity,
          'benchCapacity', bench_capacity,
          'targetScore',$new$,
  'match_room_rules_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  '      limit 2',
  '      limit bench_capacity',
  'match_room_roster_bench_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_match_room_action_unguarded(text,text,text,jsonb)'::regprocedure,
  $old$        if jsonb_array_length(coalesce(reserves->target_side, '[]'::jsonb)) >= 2 then raise exception 'match_reserve_full' using errcode = '23514'; end if;$old$,
  $new$        if jsonb_array_length(coalesce(reserves->target_side, '[]'::jsonb)) >= bench_capacity then raise exception 'match_reserve_full' using errcode = '23514'; end if;$new$,
  'match_room_placement_bench_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$  side_capacity integer;
  active_count integer;$old$,
  $new$  side_capacity integer;
  bench_capacity integer;
  active_count integer;$new$,
  'recruiting_management_bench_declaration_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$    side_capacity := greatest(1, least(5, coalesce((draft->>'sideCapacity')::integer, substring(coalesce(draft->>'mode', '5v5') from '^[0-9]+')::integer, 5)));$old$,
  $new$    side_capacity := greatest(1, least(5, coalesce((draft->>'sideCapacity')::integer, substring(coalesce(draft->>'mode', '5v5') from '^[0-9]+')::integer, 5)));
    if side_capacity not in (1, 2, 3, 5)
       or coalesce(nullif(btrim(draft->>'mode'), ''), side_capacity::text || 'v' || side_capacity::text) <> side_capacity::text || 'v' || side_capacity::text then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    if coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2') !~ '^[0-2]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    bench_capacity := coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2')::integer;$new$,
  'recruiting_management_create_policy_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$      coalesce(draft->'rules', '{}'::jsonb) || jsonb_build_object('mmrRangeMode', mmr_range_mode, 'ratingScale', rating_scale),$old$,
  $new$      coalesce(draft->'rules', '{}'::jsonb) || jsonb_build_object(
        'sideCapacity', side_capacity,
        'benchCapacity', bench_capacity,
        'mmrRangeMode', mmr_range_mode,
        'ratingScale', rating_scale
      ),$new$,
  'recruiting_management_create_rules_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$  side_capacity := current_post.side_capacity;

  if safe_action = 'interestRecruitingPost' then$old$,
  $new$  side_capacity := current_post.side_capacity;
  bench_capacity := current_post.bench_capacity;

  if safe_action = 'interestRecruitingPost' then$new$,
  'recruiting_management_existing_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  ' > 2 then',
  ' > bench_capacity then',
  'recruiting_management_bench_overflow_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'limit 2',
  'limit bench_capacity',
  'recruiting_management_bench_query_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'reserve_count >= 2',
  'reserve_count >= bench_capacity',
  'recruiting_management_bench_count_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'side_reserve_count(current_post, safe_side) >= 2',
  'side_reserve_count(current_post, safe_side) >= bench_capacity',
  'recruiting_management_side_bench_count_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  'jsonb_array_length(next_reserve_ids) >= 2',
  'jsonb_array_length(next_reserve_ids) >= bench_capacity',
  'recruiting_management_party_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$    side_capacity := greatest(1, least(5, coalesce((payload->>'sideCapacity')::integer, current_post.side_capacity)));
    if public.rankball_recruiting_side_active_count(current_post, 'teamA') > side_capacity$old$,
  $new$    side_capacity := greatest(1, least(5, coalesce((payload->>'sideCapacity')::integer, current_post.side_capacity)));
    if side_capacity not in (1, 2, 3, 5) then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    if payload ? 'benchCapacity' and coalesce(payload->>'benchCapacity', '') !~ '^[0-2]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    bench_capacity := coalesce((payload->>'benchCapacity')::integer, current_post.bench_capacity);
    if public.rankball_recruiting_side_active_count(current_post, 'teamA') > side_capacity$new$,
  'recruiting_management_update_policy_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$    set mode = management.side_capacity::text || 'v' || management.side_capacity::text,
        side_capacity = management.side_capacity,$old$,
  $new$    set mode = management.side_capacity::text || 'v' || management.side_capacity::text,
        side_capacity = management.side_capacity,
        bench_capacity = management.bench_capacity,$new$,
  'recruiting_management_update_bench_column_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_unguarded(text,jsonb)'::regprocedure,
  $old$        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'targetScore',$old$,
  $new$        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'sideCapacity', management.side_capacity,
          'benchCapacity', management.bench_capacity,
          'targetScore',$new$,
  'recruiting_management_update_rules_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action(text,jsonb)'::regprocedure,
  '    elsif jsonb_array_length(next_reserves) < 2 then',
  '    elsif jsonb_array_length(next_reserves) < current_post.bench_capacity then',
  'recruiting_management_summon_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_management_action_pre_summon(text,jsonb)'::regprocedure,
  '  if jsonb_array_length(selected_reserve) > 2 then',
  '  if jsonb_array_length(selected_reserve) > current_post.bench_capacity then',
  'recruiting_management_pre_summon_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_recruiting_side_party_join_action(text,text,text,text,text)'::regprocedure,
  '    if side_reserve_count >= 2 then',
  '    if side_reserve_count >= post_row.bench_capacity then',
  'recruiting_side_party_bench_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure,
  $old$  capacity integer;
  captain_id text;$old$,
  $new$  capacity integer;
  bench_capacity integer;
  captain_id text;$new$,
  'tournament_roster_bench_declaration_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure,
  $old$  )));
  team_snapshot := tournament_row.rules #> array['teamRosterSnapshot', 'teams', side_team_id];$old$,
  $new$  )));
  bench_capacity := case
    when coalesce(current_match.rules->>'benchCapacity', '') ~ '^[0-2]$' then (current_match.rules->>'benchCapacity')::integer
    else 2
  end;
  team_snapshot := tournament_row.rules #> array['teamRosterSnapshot', 'teams', side_team_id];$new$,
  'tournament_roster_bench_initialization_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_match_roster_action_legacy(text,text,jsonb)'::regprocedure,
  $old$  if jsonb_array_length(requested_reserve) > 2 then raise exception 'match_reserve_full' using errcode = '23514'; end if;$old$,
  $new$  if jsonb_array_length(requested_reserve) > bench_capacity then raise exception 'match_reserve_full' using errcode = '23514'; end if;$new$,
  'tournament_roster_bench_limit_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_operation_action(text,jsonb)'::regprocedure,
  $old$    capacity := greatest(1, least(5, coalesce(substring(coalesce(nullif(btrim(draft->>'mode'), ''), '5v5') from '^(\d+)')::integer, 5)));
    rules_json :=$old$,
  $new$    capacity := greatest(1, least(5, coalesce(substring(coalesce(nullif(btrim(draft->>'mode'), ''), '5v5') from '^(\d+)')::integer, 5)));
    if capacity not in (1, 2, 3, 5)
       or coalesce(nullif(btrim(draft->>'mode'), ''), '5v5') <> capacity::text || 'v' || capacity::text then
      raise exception 'unsupported_match_mode' using errcode = '23514';
    end if;
    rules_json :=$new$,
  'tournament_create_mode_guard_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_tournament_operation_action(text,jsonb)'::regprocedure,
  $old$    roster_snapshot := jsonb_build_object('version', 1, 'capturedAt', now_at, 'teams', '{}'::jsonb);$old$,
  $new$    if coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2') !~ '^[0-2]$' then
      raise exception 'invalid_bench_capacity' using errcode = '23514';
    end if;
    rules_json := rules_json || jsonb_build_object(
      'sideCapacity', capacity,
      'benchCapacity', coalesce(nullif(btrim(draft->>'benchCapacity'), ''), nullif(btrim(draft #>> '{rules,benchCapacity}'), ''), '2')::integer
    );
    roster_snapshot := jsonb_build_object('version', 1, 'capturedAt', now_at, 'teams', '{}'::jsonb);$new$,
  'tournament_create_bench_policy_shape_changed'
);

select pg_temp.rankball_patch_function_definition(
  'public.rankball_create_tournament_match_locked_unguarded(text,text,text,integer,integer,text)'::regprocedure,
  $old$  end if;
  if nullif(btrim(p_team_a_id), '') is null or nullif(btrim(p_team_b_id), '') is null or p_team_a_id = p_team_b_id then$old$,
  $new$  end if;
  if coalesce(tournament_row.mode, '') not in ('1v1', '2v2', '3v3', '5v5') then
    raise exception 'unsupported_match_mode' using errcode = '23514';
  end if;
  if nullif(btrim(p_team_a_id), '') is null or nullif(btrim(p_team_b_id), '') is null or p_team_a_id = p_team_b_id then$new$,
  'tournament_child_mode_guard_shape_changed'
);

alter table public.recruiting_posts
  drop constraint if exists recruiting_posts_supported_mode_check;
alter table public.recruiting_posts
  add constraint recruiting_posts_supported_mode_check
  check (coalesce(mode, '') in ('1v1', '2v2', '3v3', '5v5')) not valid;
alter table public.recruiting_posts validate constraint recruiting_posts_supported_mode_check;

alter table public.tournaments
  drop constraint if exists tournaments_supported_mode_check;
alter table public.tournaments
  add constraint tournaments_supported_mode_check
  check (coalesce(mode, '') in ('1v1', '2v2', '3v3', '5v5')) not valid;
alter table public.tournaments validate constraint tournaments_supported_mode_check;

alter table public.matches
  drop constraint if exists matches_supported_mode_check;
alter table public.matches
  add constraint matches_supported_mode_check
  check (
    coalesce(mode, '') in ('1v1', '2v2', '3v3', '5v5')
    or (mode = '4v4' and coalesce(rules->>'recordType', '') = 'solo')
  ) not valid;
alter table public.matches validate constraint matches_supported_mode_check;

notify pgrst, 'reload schema';
