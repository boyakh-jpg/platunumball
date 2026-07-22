alter table public.recruiting_posts
  add column if not exists bench_capacity smallint not null default 2;

alter table public.recruiting_posts
  drop constraint if exists recruiting_posts_bench_capacity_check;

alter table public.recruiting_posts
  add constraint recruiting_posts_bench_capacity_check
  check (bench_capacity between 0 and 2);

update public.recruiting_posts
set bench_capacity = case
  when coalesce(rules->>'benchCapacity', '') ~ '^[0-2]$' then (rules->>'benchCapacity')::smallint
  else 2
end
where bench_capacity is distinct from case
  when coalesce(rules->>'benchCapacity', '') ~ '^[0-2]$' then (rules->>'benchCapacity')::smallint
  else 2
end;

update public.recruiting_posts
set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{benchCapacity}', to_jsonb(bench_capacity), true)
where rules->>'benchCapacity' is distinct from bench_capacity::text;

update public.matches
set rules = jsonb_set(
  coalesce(rules, '{}'::jsonb),
  '{benchCapacity}',
  '2'::jsonb,
  true
)
where coalesce(rules->>'benchCapacity', '') !~ '^[0-2]$';

create or replace function public.rankball_normalize_recruiting_bench_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  raw_capacity text;
  safe_capacity integer;
begin
  if tg_op = 'INSERT' then
    raw_capacity := coalesce(new.rules->>'benchCapacity', new.bench_capacity::text, '2');
  elsif new.bench_capacity is distinct from old.bench_capacity then
    raw_capacity := new.bench_capacity::text;
  elsif (new.rules->>'benchCapacity') is distinct from (old.rules->>'benchCapacity') then
    raw_capacity := new.rules->>'benchCapacity';
  else
    raw_capacity := old.bench_capacity::text;
  end if;

  if coalesce(raw_capacity, '') !~ '^[0-2]$' then
    raise exception 'invalid_bench_capacity' using errcode = '23514';
  end if;
  safe_capacity := raw_capacity::integer;
  new.bench_capacity := safe_capacity;
  new.rules := jsonb_set(coalesce(new.rules, '{}'::jsonb), '{benchCapacity}', to_jsonb(safe_capacity), true);
  return new;
end;
$$;

drop trigger if exists normalize_recruiting_bench_capacity on public.recruiting_posts;
create trigger normalize_recruiting_bench_capacity
before insert or update of bench_capacity, rules on public.recruiting_posts
for each row execute function public.rankball_normalize_recruiting_bench_capacity();

create or replace function public.rankball_recruiting_side_bench_count(
  p_post_id text,
  p_side text
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with post_row as (
    select * from public.recruiting_posts where id = p_post_id
  ), application_rows as (
    select * from public.recruiting_applications where post_id = p_post_id
  ), bench_ids as (
    select reserve_id as player_id
    from post_row post
    cross join lateral jsonb_array_elements_text(
      case
        when post.host_side = p_side and jsonb_typeof(post.room_state #> '{partyReserves,host}') = 'array'
          then post.room_state #> '{partyReserves,host}'
        else '[]'::jsonb
      end
    ) reserve(reserve_id)

    union

    select reserve_id
    from post_row post
    join application_rows application on application.side = p_side
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(post.room_state #> array[
          'partyReserves',
          case when application.kind = 'team' and application.team_id is not null
            then 'team:' || application.team_id
            else 'player:' || application.player_id
          end
        ]) = 'array'
          then post.room_state #> array[
            'partyReserves',
            case when application.kind = 'team' and application.team_id is not null
              then 'team:' || application.team_id
              else 'player:' || application.player_id
            end
          ]
        else '[]'::jsonb
      end
    ) reserve(reserve_id)

    union

    select reserve_id
    from application_rows application
    cross join lateral jsonb_array_elements_text(
      case
        when application.side <> p_side or application.reserve = false then '[]'::jsonb
        when jsonb_typeof(application.player_ids) = 'array' and jsonb_array_length(application.player_ids) > 0
          then application.player_ids
        else jsonb_build_array(application.player_id)
      end
    ) reserve(reserve_id)

    union

    select reserve_id
    from post_row post
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(post.room_state #> array['pinnedReservePlayers', p_side]) = 'array'
        then post.room_state #> array['pinnedReservePlayers', p_side]
        else '[]'::jsonb
      end
    ) reserve(reserve_id)

    union

    select invitation->>'targetUserId'
    from post_row post
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(post.room_state->'invitations') = 'array'
        then post.room_state->'invitations'
        else '[]'::jsonb
      end
    ) invitation
    where invitation->>'role' <> 'referee'
      and coalesce(invitation->>'status', 'pending') = 'pending'
      and lower(coalesce(invitation->>'reserve', 'false')) in ('true', 't', '1', 'yes', 'on')
      and coalesce(invitation->>'side', 'teamB') = p_side
  )
  select count(distinct player_id)::integer
  from bench_ids
  where nullif(btrim(player_id), '') is not null
$$;

create or replace function public.rankball_validate_recruiting_bench_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_post_id text;
  safe_capacity integer;
begin
  if tg_table_name = 'recruiting_posts' then
    safe_post_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    safe_post_id := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
  end if;
  select bench_capacity into safe_capacity
  from public.recruiting_posts
  where id = safe_post_id;
  if safe_capacity is null then return null; end if;

  if public.rankball_recruiting_side_bench_count(safe_post_id, 'teamA') > safe_capacity
     or public.rankball_recruiting_side_bench_count(safe_post_id, 'teamB') > safe_capacity then
    raise exception 'recruiting_reserve_full' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists validate_recruiting_post_bench_capacity on public.recruiting_posts;
create constraint trigger validate_recruiting_post_bench_capacity
after insert or update of bench_capacity, rules, room_state, host_side on public.recruiting_posts
deferrable initially deferred
for each row execute function public.rankball_validate_recruiting_bench_capacity();

drop trigger if exists validate_recruiting_application_bench_capacity on public.recruiting_applications;
create constraint trigger validate_recruiting_application_bench_capacity
after insert or update or delete on public.recruiting_applications
deferrable initially deferred
for each row execute function public.rankball_validate_recruiting_bench_capacity();

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
begin
  raw_capacity := coalesce(
    new.rules->>'benchCapacity',
    case when tg_op = 'UPDATE' then old.rules->>'benchCapacity' end,
    '2'
  );
  if coalesce(raw_capacity, '') !~ '^[0-2]$' then
    raise exception 'invalid_bench_capacity' using errcode = '23514';
  end if;
  safe_capacity := raw_capacity::integer;
  team_a_count := jsonb_array_length(case when jsonb_typeof(new.reserve_players->'teamA') = 'array' then new.reserve_players->'teamA' else '[]'::jsonb end);
  team_b_count := jsonb_array_length(case when jsonb_typeof(new.reserve_players->'teamB') = 'array' then new.reserve_players->'teamB' else '[]'::jsonb end);
  if team_a_count > safe_capacity or team_b_count > safe_capacity then
    raise exception 'match_reserve_exceeds_bench_capacity' using errcode = '23514';
  end if;
  new.rules := jsonb_set(coalesce(new.rules, '{}'::jsonb), '{benchCapacity}', to_jsonb(safe_capacity), true);
  return new;
end;
$$;

drop trigger if exists normalize_match_bench_capacity on public.matches;
create trigger normalize_match_bench_capacity
before insert or update of rules, reserve_players on public.matches
for each row execute function public.rankball_normalize_match_bench_capacity();

revoke all on function public.rankball_normalize_recruiting_bench_capacity() from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_side_bench_count(text, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_validate_recruiting_bench_capacity() from public, anon, authenticated, service_role;
revoke all on function public.rankball_normalize_match_bench_capacity() from public, anon, authenticated, service_role;

do $$
declare
  function_definition text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('public.rankball_recruiting_interest_player_action(text,text,text,text,text,boolean,text)'::regprocedure)
  into function_definition;
  old_fragment := 'if safe_reserve and greatest(selected_reserve_count, selected_pinned_reserve_count) >= 2 then';
  new_fragment := 'if safe_reserve and greatest(selected_reserve_count, selected_pinned_reserve_count) >= current_post.bench_capacity then';
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'recruiting_interest_bench_shape_changed'; end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;

  select pg_get_functiondef('public.rankball_recruiting_applicant_placement_action(text,text,text,text,boolean)'::regprocedure)
  into function_definition;
  old_fragment := 'if greatest(reserve_count, jsonb_array_length(side_pinned_ids)) >= 2 and not (side_pinned_ids ? safe_player_id) then';
  new_fragment := 'if greatest(reserve_count, jsonb_array_length(side_pinned_ids)) >= current_post.bench_capacity and not (side_pinned_ids ? safe_player_id) then';
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'recruiting_placement_bench_shape_changed'; end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;

  select pg_get_functiondef('public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'::regprocedure)
  into function_definition;
  old_fragment := 'and coalesce((invitation->>''reserve'')::boolean, false) = true;';
  new_fragment := 'and lower(coalesce(invitation->>''reserve'', ''false'')) in (''true'', ''t'', ''1'', ''yes'', ''on'');';
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'recruiting_invite_boolean_shape_changed'; end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);
  end if;
  old_fragment := 'if reserve_count + pending_reserve_count + invitation_count > 2 then';
  new_fragment := 'if reserve_count + pending_reserve_count + invitation_count > current_post.bench_capacity then';
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'recruiting_invite_bench_shape_changed'; end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);
  end if;
  execute function_definition;

  select pg_get_functiondef('public.rankball_recruiting_invitation_decision_action(text,text,text,text)'::regprocedure)
  into function_definition;
  old_fragment := 'safe_reserve := coalesce((invitation->>''reserve'')::boolean, false);';
  new_fragment := 'safe_reserve := lower(coalesce(invitation->>''reserve'', ''false'')) in (''true'', ''t'', ''1'', ''yes'', ''on'');';
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'recruiting_invitation_boolean_shape_changed'; end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);
  end if;
  old_fragment := 'if safe_reserve and greatest(reserve_count, pinned_reserve_count) >= 2 then';
  new_fragment := 'if safe_reserve and greatest(reserve_count, pinned_reserve_count) >= current_post.bench_capacity then';
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then raise exception 'recruiting_invitation_bench_shape_changed'; end if;
    function_definition := replace(function_definition, old_fragment, new_fragment);
  end if;
  execute function_definition;
end;
$$;

do $$
declare
  function_definition text;
  old_fragment text := $old$    'sideCapacity', post_row.side_capacity,$old$;
  new_fragment text := $new$    'sideCapacity', post_row.side_capacity,
    'benchCapacity', post_row.bench_capacity,$new$;
begin
  select pg_get_functiondef('public.rankball_refresh_recruiting_feed_for_post(text)'::regprocedure)
  into function_definition;
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'recruiting_feed_side_capacity_shape_changed';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$$;

do $$
declare
  function_definition text;
  old_fragment text := $old$    'mode', match_row.mode,$old$;
  new_fragment text := $new$    'mode', match_row.mode,
    'benchCapacity', case
      when coalesce(match_row.rules->>'benchCapacity', '') ~ '^[0-2]$' then (match_row.rules->>'benchCapacity')::integer
      else 2
    end,$new$;
begin
  select pg_get_functiondef('public.rankball_refresh_match_feed_for_match(text)'::regprocedure)
  into function_definition;
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'match_feed_mode_shape_changed';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$$;

do $$
declare
  function_definition text;
  old_fragment text := $old$      'sideCapacity', side_capacity,$old$;
  new_fragment text := $new$      'sideCapacity', side_capacity,
      'benchCapacity', case
        when coalesce(card->>'benchCapacity', '') ~ '^[0-2]$' then (card->>'benchCapacity')::integer
        else 2
      end,$new$;
begin
  select pg_get_functiondef('public.rankball_slim_room_feed_card(text,jsonb)'::regprocedure)
  into function_definition;
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'slim_room_feed_side_capacity_shape_changed';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$$;

do $$
declare
  function_definition text;
  old_fragment text := $old$      'listCardOnly', true,
      'title', card->>'title',
      'mode', card->>'mode',
      'courtId', card->>'courtId',$old$;
  new_fragment text := $new$      'listCardOnly', true,
      'title', card->>'title',
      'mode', card->>'mode',
      'benchCapacity', case
        when coalesce(card->>'benchCapacity', '') ~ '^[0-2]$' then (card->>'benchCapacity')::integer
        else 2
      end,
      'courtId', card->>'courtId',$new$;
begin
  select pg_get_functiondef('public.rankball_slim_room_feed_card(text,jsonb)'::regprocedure)
  into function_definition;
  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'slim_match_feed_mode_shape_changed';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$$;

select public.rankball_refresh_recruiting_feed_for_post(id)
from public.recruiting_posts;

select public.rankball_refresh_match_feed_for_match(id)
from public.matches;

notify pgrst, 'reload schema';
