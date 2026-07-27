begin;

do $$
begin
  if to_regprocedure('public.rankball_match_generate_pickup_assignment_pre_host_anchor(text,text,text)') is null then
    if to_regprocedure('public.rankball_match_generate_pickup_assignment(text,text,text)') is null then
      raise exception 'rankball_match_generate_pickup_assignment_missing' using errcode = '42883';
    end if;
    alter function public.rankball_match_generate_pickup_assignment(text, text, text)
      rename to rankball_match_generate_pickup_assignment_pre_host_anchor;
  end if;
end;
$$;

create or replace function public.rankball_match_generate_pickup_assignment(
  p_actor_profile_id text,
  p_match_id text,
  p_assignment_mode text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  assignment_result jsonb;
  current_match public.matches%rowtype;
  host_id text;
  host_on_team_a boolean := false;
  host_on_team_b boolean := false;
  changed_at timestamptz := clock_timestamp();
begin
  assignment_result := public.rankball_match_generate_pickup_assignment_pre_host_anchor(
    p_actor_profile_id,
    p_match_id,
    p_assignment_mode
  );

  select match_row.* into current_match
  from public.matches match_row
  where match_row.id = safe_match_id
  for update;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  host_id := nullif(btrim(current_match.created_by), '');
  if host_id is null then return assignment_result; end if;

  host_on_team_a := exists (
    select 1
    from public.match_players player_row
    where player_row.match_id = safe_match_id
      and player_row.user_id = host_id
      and player_row.side = 'teamA'
  ) or coalesce(current_match.reserve_players->'teamA', '[]'::jsonb) ? host_id;

  host_on_team_b := exists (
    select 1
    from public.match_players player_row
    where player_row.match_id = safe_match_id
      and player_row.user_id = host_id
      and player_row.side = 'teamB'
  ) or coalesce(current_match.reserve_players->'teamB', '[]'::jsonb) ? host_id;

  if host_on_team_a or not host_on_team_b then return assignment_result; end if;

  update public.match_players player_row
  set side = case player_row.side
    when 'teamA' then 'teamB'
    when 'teamB' then 'teamA'
    else player_row.side
  end
  where player_row.match_id = safe_match_id
    and player_row.side in ('teamA', 'teamB');

  update public.match_agreements agreement_row
  set side = case agreement_row.side when 'teamA' then 'teamB' else 'teamA' end
  where agreement_row.match_id = safe_match_id
    and agreement_row.side in ('teamA', 'teamB');

  update public.match_approvals approval_row
  set side = case approval_row.side when 'teamA' then 'teamB' else 'teamA' end
  where approval_row.match_id = safe_match_id
    and approval_row.side in ('teamA', 'teamB');

  update public.matches match_row
  set team_a_id = current_match.team_b_id,
      team_b_id = current_match.team_a_id,
      score_a = current_match.score_b,
      score_b = current_match.score_a,
      dual_score_recorder_side = case current_match.dual_score_recorder_side
        when 'teamA' then 'teamB'
        when 'teamB' then 'teamA'
        else current_match.dual_score_recorder_side
      end,
      rules = public.rankball_swap_match_side_json(coalesce(current_match.rules, '{}'::jsonb)),
      evidence = public.rankball_swap_match_side_json(coalesce(current_match.evidence, '[]'::jsonb)),
      trust_feedback = public.rankball_swap_match_side_json(coalesce(current_match.trust_feedback, '{}'::jsonb)),
      stat_recorders = public.rankball_swap_match_side_json(coalesce(current_match.stat_recorders, '{}'::jsonb)),
      played_player_ids = public.rankball_swap_match_side_json(coalesce(current_match.played_player_ids, '{}'::jsonb)),
      reserve_players = public.rankball_swap_match_side_json(coalesce(current_match.reserve_players, '{}'::jsonb)),
      promoted_reserve_ids = public.rankball_swap_match_side_json(coalesce(current_match.promoted_reserve_ids, '{}'::jsonb)),
      attendance = public.rankball_swap_match_side_json(coalesce(current_match.attendance, '{}'::jsonb)),
      referee_absence_request = public.rankball_swap_match_side_json(current_match.referee_absence_request),
      dispute_draft_result = public.rankball_swap_match_side_json(current_match.dispute_draft_result),
      anonymous_players = public.rankball_swap_match_side_json(coalesce(current_match.anonymous_players, '{}'::jsonb)),
      rating_result = public.rankball_swap_match_side_json(current_match.rating_result),
      team_rating_result = public.rankball_swap_match_side_json(current_match.team_rating_result),
      updated_at = changed_at
  where match_row.id = safe_match_id;

  return public.rankball_swap_match_side_json(assignment_result)
    || jsonb_build_object('hostAnchoredTo', 'teamA');
end;
$$;

revoke all on function public.rankball_match_generate_pickup_assignment_pre_host_anchor(text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_generate_pickup_assignment(text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_generate_pickup_assignment(text, text, text)
  to service_role;

comment on function public.rankball_match_generate_pickup_assignment(text, text, text)
is 'Generates a pickup draft and keeps an attending player host on the teamA label without changing team composition.';

select pg_notify('pgrst', 'reload schema');

commit;
