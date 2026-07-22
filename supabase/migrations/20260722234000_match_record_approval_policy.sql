-- Match records use the approvers fixed during record-room setup.
-- Individual composition requires every actual participant; team composition requires both captains.

do $migration$
declare
  function_definition text;
  old_text text;
  new_text text;
begin
  select pg_get_functiondef(
    'public.rankball_match_finalize_locked_concurrency_inner(text,text,text)'::regprocedure
  ) into function_definition;

  old_text := $old$team_a_required := floor(team_a_count / 2.0)::integer + 1;
    team_b_required := floor(team_b_count / 2.0)::integer + 1;
    if team_a_count = 0 or team_b_count = 0
       or team_a_approvals < team_a_required
       or team_b_approvals < team_b_required then
      raise exception 'match_approval_majority_required' using errcode = '23514';
    end if;$old$;

  new_text := $new$if current_match.rules->>'recordType' = 'match_record' then
      if current_match.rules->>'recordSetupReady' <> 'true' then
        raise exception 'match_record_setup_required' using errcode = '23514';
      end if;

      with required_players as (
        select required.value as user_id, 'teamA'::text as side
        from jsonb_array_elements_text(
          case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
            then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
        ) required(value)
        union all
        select required.value as user_id, 'teamB'::text as side
        from jsonb_array_elements_text(
          case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
            then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
        ) required(value)
      )
      select
        count(distinct user_id) filter (where side = 'teamA'),
        count(distinct user_id) filter (where side = 'teamB')
      into team_a_required, team_b_required
      from required_players;

      with required_players as (
        select required.value as user_id, 'teamA'::text as side
        from jsonb_array_elements_text(
          case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
            then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
        ) required(value)
        union all
        select required.value as user_id, 'teamB'::text as side
        from jsonb_array_elements_text(
          case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
            then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
        ) required(value)
      )
      select
        count(distinct approval.user_id) filter (where approval.side = 'teamA'),
        count(distinct approval.user_id) filter (where approval.side = 'teamB')
      into team_a_approvals, team_b_approvals
      from public.match_approvals approval
      join required_players required
        on required.user_id = approval.user_id
       and required.side = approval.side
      where approval.match_id = safe_match_id
        and approval.approved_at >= coalesce(current_match.dispute_resolved_at, '-infinity'::timestamptz);

      if team_a_required = 0 or team_b_required = 0
         or team_a_approvals < team_a_required
         or team_b_approvals < team_b_required then
        raise exception 'match_record_approval_required' using errcode = '23514';
      end if;
    else
      team_a_required := floor(team_a_count / 2.0)::integer + 1;
      team_b_required := floor(team_b_count / 2.0)::integer + 1;
      if team_a_count = 0 or team_b_count = 0
         or team_a_approvals < team_a_required
         or team_b_approvals < team_b_required then
        raise exception 'match_approval_majority_required' using errcode = '23514';
      end if;
    end if;$new$;

  if position(old_text in function_definition) = 0 then
    raise exception 'match_finalize_approval_policy_shape_changed';
  end if;

  execute replace(function_definition, old_text, new_text);
end;
$migration$;

create or replace function public.rankball_match_approval_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  tournament_lock_id text;
  record_type text;
  current_match public.matches%rowtype;
  actor_is_required boolean := false;
  invalid_required_player boolean := false;
  ambiguous_actual_players boolean := false;
  team_a_required integer := 0;
  team_b_required integer := 0;
  team_a_approvals integer := 0;
  team_b_approvals integer := 0;
begin
  select nullif(btrim(match.tournament_id), ''), match.rules->>'recordType'
  into tournament_lock_id, record_type
  from public.matches match
  where match.id = safe_match_id;

  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(tournament_lock_id));
  end if;

  if record_type is distinct from 'match_record' then
    return public.rankball_match_approval_action_concurrency_inner(
      p_actor_profile_id,
      p_match_id,
      p_side,
      p_player_id
    );
  end if;

  if safe_actor_id is null or safe_actor_id <> safe_player_id or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_approval_target' using errcode = '42501';
  end if;
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));

  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.status <> 'approval' then
    raise exception 'match_approval_locked' using errcode = '23514';
  end if;
  if current_match.rules->>'recordSetupReady' <> 'true' then
    raise exception 'match_record_setup_required' using errcode = '23514';
  end if;

  with actual_players as (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  ), required_players as (
    select required.value as user_id, 'teamA'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
    ) required(value)
    union all
    select required.value as user_id, 'teamB'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
    ) required(value)
  )
  select
    exists (
      select 1 from required_players
      where user_id = safe_player_id and side = safe_side
    ),
    exists (
      select 1 from required_players required
      where not exists (
        select 1 from actual_players actual
        where actual.user_id = required.user_id and actual.side = required.side
      )
    ),
    exists (
      select 1 from actual_players
      group by user_id
      having count(distinct side) > 1
    ),
    count(distinct user_id) filter (where side = 'teamA'),
    count(distinct user_id) filter (where side = 'teamB')
  into actor_is_required, invalid_required_player, ambiguous_actual_players, team_a_required, team_b_required
  from required_players;

  if ambiguous_actual_players or invalid_required_player or team_a_required = 0 or team_b_required = 0 then
    raise exception 'match_record_approval_roster_invalid' using errcode = '23514';
  end if;
  if not actor_is_required then
    raise exception 'match_record_approval_not_required' using errcode = '42501';
  end if;

  insert into public.match_approvals (match_id, user_id, side, approved_at)
  values (safe_match_id, safe_player_id, safe_side, now())
  on conflict (match_id, user_id) do update set
    side = excluded.side,
    approved_at = excluded.approved_at;

  with required_players as (
    select required.value as user_id, 'teamA'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamA}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamA}' else '[]'::jsonb end
    ) required(value)
    union all
    select required.value as user_id, 'teamB'::text as side
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules #> '{recordApproverIds,teamB}') = 'array'
        then current_match.rules #> '{recordApproverIds,teamB}' else '[]'::jsonb end
    ) required(value)
  )
  select
    count(distinct approval.user_id) filter (where approval.side = 'teamA'),
    count(distinct approval.user_id) filter (where approval.side = 'teamB')
  into team_a_approvals, team_b_approvals
  from public.match_approvals approval
  join required_players required
    on required.user_id = approval.user_id
   and required.side = approval.side
  where approval.match_id = safe_match_id
    and approval.approved_at >= coalesce(current_match.dispute_resolved_at, '-infinity'::timestamptz);

  if team_a_approvals < team_a_required or team_b_approvals < team_b_required then
    update public.matches set updated_at = now() where id = safe_match_id;
    return jsonb_build_object(
      'ok', true,
      'action', 'approveMatch',
      'matchId', safe_match_id,
      'sqlReducer', true,
      'finalized', false,
      'teamARequired', team_a_required,
      'teamBRequired', team_b_required
    );
  end if;

  return public.rankball_match_finalize_locked(safe_actor_id, safe_match_id, 'approveMatch');
end;
$$;

revoke all on function public.rankball_match_approval_action(text, text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text)
to service_role;
