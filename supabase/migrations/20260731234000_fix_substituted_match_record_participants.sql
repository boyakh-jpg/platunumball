begin;

create or replace function public.rankball_match_record_player_rows(p_match_id text)
returns table (
  match_id text,
  team_id text,
  user_id text,
  side text,
  slot_order integer,
  "position" text
)
language sql
stable
security definer
set search_path = public
as $$
  with target_match as (
    select id, team_a_id, team_b_id, played_player_ids, rules
    from public.matches
    where id = nullif(btrim(p_match_id), '')
  ), candidate_players as (
    select
      player_row.match_id,
      player_row.team_id,
      player_row.user_id,
      player_row.side,
      player_row.slot_order,
      player_row.position,
      0 as source_priority
    from public.match_players player_row
    join target_match match_row on match_row.id = player_row.match_id

    union all

    select
      match_row.id,
      nullif(btrim(match_row.team_a_id), ''),
      played_id.value,
      'teamA',
      (10000 + played_id.ordinality)::integer,
      nullif(btrim(match_row.rules #>> array['slotPositions', played_id.value]), ''),
      1
    from target_match match_row
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(match_row.played_player_ids->'teamA') = 'array'
          then match_row.played_player_ids->'teamA'
        else '[]'::jsonb
      end
    ) with ordinality played_id(value, ordinality)

    union all

    select
      match_row.id,
      nullif(btrim(match_row.team_b_id), ''),
      played_id.value,
      'teamB',
      (20000 + played_id.ordinality)::integer,
      nullif(btrim(match_row.rules #>> array['slotPositions', played_id.value]), ''),
      1
    from target_match match_row
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(match_row.played_player_ids->'teamB') = 'array'
          then match_row.played_player_ids->'teamB'
        else '[]'::jsonb
      end
    ) with ordinality played_id(value, ordinality)
  )
  select distinct on (nullif(btrim(candidate.user_id), ''))
    candidate.match_id,
    candidate.team_id,
    nullif(btrim(candidate.user_id), ''),
    candidate.side,
    candidate.slot_order,
    candidate.position
  from candidate_players candidate
  where nullif(btrim(candidate.user_id), '') is not null
  order by
    nullif(btrim(candidate.user_id), ''),
    candidate.source_priority,
    candidate.slot_order nulls last,
    candidate.side;
$$;

revoke all on function public.rankball_match_record_player_rows(text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_record_player_rows(text)
  to service_role;

do $$
declare
  function_signature regprocedure;
  function_definition text;
  old_source constant text := 'from public.match_players player_row';
  new_source constant text := 'from public.rankball_match_record_player_rows(safe_match_id) player_row';
begin
  foreach function_signature in array array[
    'public.rankball_refresh_match_record_archive(text)'::regprocedure,
    'public.rankball_match_record_archive_is_complete(text)'::regprocedure
  ] loop
    function_definition := pg_get_functiondef(function_signature);
    if position(new_source in function_definition) > 0 then
      continue;
    end if;
    if position(old_source in function_definition) = 0 then
      raise exception 'match_record_player_source_shape_changed: %', function_signature
        using errcode = '55000';
    end if;
    function_definition := replace(function_definition, old_source, new_source);
    if position(old_source in function_definition) > 0 then
      raise exception 'match_record_player_source_repair_incomplete: %', function_signature
        using errcode = '55000';
    end if;
    execute function_definition;
  end loop;
end;
$$;

do $$
declare
  candidate record;
begin
  for candidate in
    select match_row.id
    from public.matches match_row
    where match_row.status = 'confirmed'
      and exists (
        select 1
        from public.rankball_match_record_player_rows(match_row.id) player_row
        where public.rankball_match_player_is_record_participant(
          match_row.played_player_ids,
          match_row.reserve_players,
          player_row.side,
          player_row.user_id
        )
          and not exists (
            select 1
            from public.match_record_participants participant
            where participant.match_id = match_row.id
              and participant.profile_id = player_row.user_id
          )
      )
  loop
    if not public.rankball_refresh_match_record_archive(candidate.id) then
      raise exception 'match_record_substituted_participant_refresh_failed: %', candidate.id
        using errcode = '55000';
    end if;
    if not public.rankball_match_record_archive_is_complete(candidate.id) then
      raise exception 'match_record_substituted_participant_incomplete: %', candidate.id
        using errcode = '55000';
    end if;
  end loop;
end;
$$;

commit;
