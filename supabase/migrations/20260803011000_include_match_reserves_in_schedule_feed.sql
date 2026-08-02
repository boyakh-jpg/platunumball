do $$
begin
  if to_regprocedure('public.rankball_refresh_match_feed_for_match_core(text)') is null then
    alter function public.rankball_refresh_match_feed_for_match(text)
      rename to rankball_refresh_match_feed_for_match_core;
  end if;
end;
$$;

create or replace function public.rankball_sync_match_reserve_feed(p_match_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.matches%rowtype;
  reserve_players jsonb := '{}'::jsonb;
  reserve_player_id text;
  region_key text;
  row_sort_at timestamptz;
begin
  select * into match_row
  from public.matches
  where id = nullif(btrim(p_match_id), '');

  if not found then return; end if;

  reserve_players := case
    when jsonb_typeof(match_row.reserve_players) = 'object' then match_row.reserve_players
    when jsonb_typeof(match_row.rules->'reservePlayers') = 'object' then match_row.rules->'reservePlayers'
    else '{}'::jsonb
  end;

  row_sort_at := coalesce(match_row.updated_at, match_row.ended_at, match_row.started_at, match_row.agreed_at, match_row.created_at, now());
  region_key := public.rankball_room_feed_region_key(coalesce(
    public.rankball_court_snapshot(match_row.court_id, match_row.court_name, match_row.rules->>'region')->>'region',
    match_row.rules->>'region'
  ));

  for reserve_player_id in
    select distinct value
    from (values ('teamA'), ('teamB')) sides(side_name)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(reserve_players->side_name) = 'array' then reserve_players->side_name else '[]'::jsonb end
    )
    where nullif(btrim(value), '') is not null
  loop
    perform public.rankball_upsert_room_feed(
      reserve_player_id, 'match', match_row.id, 'participant', region_key,
      match_row.status, match_row.visibility, row_sort_at, '{}'::jsonb
    );
    update public.user_room_feed
    set timing_type = case when match_row.rules->>'timingType' = 'instant' then 'instant' else 'scheduled' end,
        scheduled_date = match_row.scheduled_date,
        updated_at = now()
    where profile_id = reserve_player_id
      and entity_type = 'match'
      and entity_id = match_row.id
      and relation = 'participant';
  end loop;
end;
$$;

create or replace function public.rankball_refresh_match_feed_for_match(p_match_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rankball_refresh_match_feed_for_match_core(p_match_id);
  perform public.rankball_sync_match_reserve_feed(p_match_id);
end;
$$;

revoke all on function public.rankball_refresh_match_feed_for_match_core(text) from public, anon, authenticated;
revoke all on function public.rankball_sync_match_reserve_feed(text) from public, anon, authenticated;
revoke all on function public.rankball_refresh_match_feed_for_match(text) from public, anon, authenticated;
grant execute on function public.rankball_refresh_match_feed_for_match_core(text) to service_role;
grant execute on function public.rankball_sync_match_reserve_feed(text) to service_role;
grant execute on function public.rankball_refresh_match_feed_for_match(text) to service_role;

do $$
declare
  match_id text;
begin
  for match_id in
    select id from public.matches
    where jsonb_array_length(case when jsonb_typeof(reserve_players->'teamA') = 'array' then reserve_players->'teamA' else '[]'::jsonb end) > 0
       or jsonb_array_length(case when jsonb_typeof(reserve_players->'teamB') = 'array' then reserve_players->'teamB' else '[]'::jsonb end) > 0
  loop
    perform public.rankball_refresh_match_feed_for_match(match_id);
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');
