-- Final approval follows the active match roster. A non-playing team captain is not an approver.

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
  current_match public.matches%rowtype;
  team_a_count integer;
  team_b_count integer;
  team_a_approvals integer;
  team_b_approvals integer;
  team_a_required integer;
  team_b_required integer;
begin
  if safe_actor_id is null or safe_actor_id <> safe_player_id or safe_side not in ('teamA', 'teamB') then
    raise exception 'invalid_match_approval_target' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null or current_match.status <> 'approval' then
    raise exception 'match_approval_locked' using errcode = '23514';
  end if;
  if public.rankball_match_player_side(safe_match_id, safe_player_id, current_match) <> safe_side then
    raise exception 'match_approval_player_not_found' using errcode = '42501';
  end if;

  insert into public.match_approvals (match_id, user_id, side)
  values (safe_match_id, safe_player_id, safe_side)
  on conflict (match_id, user_id) do update set side = excluded.side;

  select
    count(*) filter (where player_row.side = 'teamA'),
    count(*) filter (where player_row.side = 'teamB')
  into team_a_count, team_b_count
  from public.match_players player_row
  where player_row.match_id = safe_match_id;

  select
    count(*) filter (where approval_row.side = 'teamA'),
    count(*) filter (where approval_row.side = 'teamB')
  into team_a_approvals, team_b_approvals
  from public.match_approvals approval_row
  where approval_row.match_id = safe_match_id
    and exists (
      select 1
      from public.match_players player_row
      where player_row.match_id = approval_row.match_id
        and player_row.user_id = approval_row.user_id
        and player_row.side = approval_row.side
    );

  team_a_required := floor(team_a_count / 2.0)::integer + 1;
  team_b_required := floor(team_b_count / 2.0)::integer + 1;
  if team_a_count = 0 or team_b_count = 0
     or team_a_approvals < team_a_required
     or team_b_approvals < team_b_required then
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

revoke all on function public.rankball_match_approval_action(text, text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_approval_action(text, text, text, text) to service_role;
