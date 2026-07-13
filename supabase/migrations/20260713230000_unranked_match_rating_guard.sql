create or replace function public.rankball_commit_match_rating(
  p_match_id text,
  p_actor_profile_id text,
  p_rating_result jsonb,
  p_team_rating_result jsonb,
  p_profile_updates jsonb default '[]'::jsonb,
  p_team_updates jsonb default '[]'::jsonb,
  p_confirmed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_match record;
  rating_change jsonb;
  profile_update jsonb;
  team_update jsonb;
  safe_mode text;
  safe_rating_result jsonb := p_rating_result;
  safe_team_rating_result jsonb := coalesce(p_team_rating_result, '{}'::jsonb);
  affected_count integer := 0;
  rating_count integer := 0;
  profile_count integer := 0;
  team_count integer := 0;
begin
  if nullif(p_match_id, '') is null then
    raise exception 'missing_match_id';
  end if;

  select id, status, mode, ranked, rating_result
    into locked_match
    from public.matches
    where id = p_match_id
    for update;

  if not found then
    raise exception 'match_not_found';
  end if;

  if locked_match.rating_result is not null then
    return jsonb_build_object('ok', true, 'alreadyCommitted', true, 'profileCount', 0, 'teamCount', 0);
  end if;

  if locked_match.status in ('void', 'cancelled') then
    raise exception 'match_not_committable';
  end if;

  if p_rating_result is null or jsonb_typeof(p_rating_result) <> 'array' then
    raise exception 'invalid_rating_result';
  end if;

  if coalesce(jsonb_typeof(p_profile_updates), 'array') <> 'array' then
    raise exception 'invalid_profile_updates';
  end if;

  if coalesce(jsonb_typeof(p_team_updates), 'array') <> 'array' then
    raise exception 'invalid_team_updates';
  end if;

  if locked_match.ranked is false then
    if jsonb_array_length(p_rating_result) > 0
      or jsonb_array_length(coalesce(p_team_updates, '[]'::jsonb)) > 0
      or exists (
        select 1
        from jsonb_array_elements(coalesce(p_profile_updates, '[]'::jsonb)) update_row
        where nullif(update_row->>'streakResult', '') is not null
      ) then
      raise exception 'unranked_rating_change_forbidden' using errcode = '22023';
    end if;
    safe_rating_result := '[]'::jsonb;
    safe_team_rating_result := jsonb_build_object('teamA', 0, 'teamB', 0, 'teams', '{}'::jsonb);
  end if;

  safe_mode := coalesce(nullif(locked_match.mode, ''), '5v5');

  for rating_change in
    select value from jsonb_array_elements(safe_rating_result)
  loop
    if nullif(rating_change->>'playerId', '') is null then
      raise exception 'invalid_rating_change';
    end if;

    update public.profiles
    set
      ratings = jsonb_set(
        jsonb_set(
          coalesce(ratings, jsonb_build_object('integrated', 1200, 'modes', '{}'::jsonb)),
          '{integrated}',
          to_jsonb(greatest(0, round(coalesce((ratings->>'integrated')::numeric, 1200) + coalesce(nullif(rating_change->>'integratedDelta', '')::numeric, 0))::integer)),
          true
        ),
        array['modes', safe_mode],
        to_jsonb(greatest(0, round(coalesce((ratings #>> array['modes', safe_mode])::numeric, coalesce((ratings->>'integrated')::numeric, 1200)) + coalesce(nullif(rating_change->>'modeDelta', '')::numeric, 0))::integer)),
        true
      ),
      updated_at = now()
    where id = rating_change->>'playerId';

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'rating_profile_not_found';
    end if;
    rating_count := rating_count + 1;
  end loop;

  for profile_update in
    select value from jsonb_array_elements(coalesce(p_profile_updates, '[]'::jsonb))
  loop
    if nullif(profile_update->>'id', '') is null then
      raise exception 'invalid_profile_update';
    end if;

    update public.profiles
    set
      trust_score = greatest(0, least(100, coalesce(trust_score, 80) + coalesce(nullif(profile_update->>'trustDelta', '')::integer, 0))),
      streak = case profile_update->>'streakResult'
        when 'win' then greatest(1, coalesce(streak, 0) + 1)
        when 'loss' then least(-1, coalesce(streak, 0) - 1)
        else coalesce(streak, 0)
      end,
      updated_at = now()
    where id = profile_update->>'id';

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'rating_profile_not_found';
    end if;
    profile_count := profile_count + 1;
  end loop;

  for team_update in
    select value from jsonb_array_elements(coalesce(p_team_updates, '[]'::jsonb))
  loop
    if nullif(team_update->>'id', '') is null then
      raise exception 'invalid_team_update';
    end if;

    update public.teams
    set
      mmr = greatest(0, round(coalesce(mmr, 1200) + coalesce(nullif(team_update->>'mmrDelta', '')::numeric, 0))::integer),
      wins = greatest(0, coalesce(wins, 0) + coalesce(nullif(team_update->>'winDelta', '')::integer, 0)),
      losses = greatest(0, coalesce(losses, 0) + coalesce(nullif(team_update->>'lossDelta', '')::integer, 0)),
      updated_at = now()
    where id = team_update->>'id';

    get diagnostics affected_count = row_count;
    if affected_count <> 1 then
      raise exception 'rating_team_not_found';
    end if;
    team_count := team_count + 1;
  end loop;

  update public.matches
  set
    status = 'confirmed',
    rating_result = safe_rating_result,
    team_rating_result = safe_team_rating_result,
    confirmed_at = coalesce(p_confirmed_at, now()),
    updated_at = now()
  where id = p_match_id;

  return jsonb_build_object(
    'ok', true,
    'alreadyCommitted', false,
    'ratingCount', rating_count,
    'profileCount', profile_count,
    'teamCount', team_count
  );
end;
$$;

revoke all on function public.rankball_commit_match_rating(text, text, jsonb, jsonb, jsonb, jsonb, timestamptz) from public;
revoke all on function public.rankball_commit_match_rating(text, text, jsonb, jsonb, jsonb, jsonb, timestamptz) from anon;
revoke all on function public.rankball_commit_match_rating(text, text, jsonb, jsonb, jsonb, jsonb, timestamptz) from authenticated;
grant execute on function public.rankball_commit_match_rating(text, text, jsonb, jsonb, jsonb, jsonb, timestamptz) to service_role;

select pg_notify('pgrst', 'reload schema');
