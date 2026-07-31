begin;

do $migration$
declare
  function_definition text;
  old_guard text := $old$if safe_decision = 'accepted' then
    if base_revision <> greatest(
      current_result.result_revision,
      current_result.score_revision_a,
      current_result.score_revision_b
    ) then
      raise exception 'match_result_revision_stale' using errcode = '40001';
    end if;$old$;
  new_guard text := $new$if safe_decision = 'accepted' then
    if base_revision > greatest(
      current_result.result_revision,
      current_result.score_revision_a,
      current_result.score_revision_b
    ) or (
      request_kind = 'team_scores'
      and base_revision <> greatest(
        current_result.result_revision,
        current_result.score_revision_a,
        current_result.score_revision_b
      )
    ) then
      raise exception 'match_result_revision_stale' using errcode = '40001';
    end if;$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_resolve_dispute_action(text,text,text,text,text)'::regprocedure
  );
  if position(old_guard in function_definition) = 0 then
    raise exception 'match_dispute_revision_guard_shape_changed' using errcode = '55000';
  end if;
  execute replace(function_definition, old_guard, new_guard);
end;
$migration$;

create or replace function public.rankball_match_referee_absence_action(
  p_actor_profile_id text,
  p_match_id text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  opponent_side text;
  opponent_team_id text;
  opponent_leader_id text;
  now_at timestamptz := clock_timestamp();
begin
  if p_action not in ('requestMatchRefereeAbsence', 'confirmMatchRefereeAbsence') then
    raise exception 'unsupported_referee_absence_action' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if current_match.referee_id is null
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or current_match.status not in ('contract', 'agreed') then
    raise exception 'match_referee_absence_locked' using errcode = '23514';
  end if;

  if p_action = 'requestMatchRefereeAbsence' then
    if current_match.created_by <> safe_actor_id then
      raise exception 'match_host_required' using errcode = '42501';
    end if;
    if current_match.referee_absence_request->>'status' = 'pending' then
      raise exception 'match_referee_absence_already_requested' using errcode = '23514';
    end if;
    if current_match.referee_absence_request->>'status' = 'confirmed' then
      raise exception 'match_referee_absence_already_confirmed' using errcode = '23514';
    end if;

    update public.matches
    set referee_absence_request = jsonb_build_object(
          'by', safe_actor_id,
          'createdAt', now_at,
          'status', 'pending'
        ),
        updated_at = now_at
    where id = safe_match_id;
  else
    if current_match.referee_absence_request->>'status' <> 'pending' then
      raise exception 'match_referee_absence_request_missing' using errcode = '23514';
    end if;

    opponent_side := case
      when public.rankball_match_player_side(safe_match_id, current_match.created_by, current_match) = 'teamB'
        then 'teamA'
      else 'teamB'
    end;
    opponent_team_id := case
      when opponent_side = 'teamA' then current_match.team_a_id
      else current_match.team_b_id
    end;
    if opponent_team_id is not null then
      select user_id into opponent_leader_id
      from public.team_members
      where team_id = opponent_team_id and role = 'captain'
      order by user_id
      limit 1;
    end if;
    if opponent_leader_id is null then
      select user_id into opponent_leader_id
      from public.match_players
      where match_id = safe_match_id and side = opponent_side
      order by slot_order, user_id
      limit 1;
    end if;
    if opponent_leader_id is null or opponent_leader_id <> safe_actor_id then
      raise exception 'match_opponent_leader_required' using errcode = '42501';
    end if;

    update public.profiles
    set trust_score = greatest(
          0,
          least(
            100,
            coalesce(trust_score, 80)
              - public.rankball_rating_policy_number(
                  array['trust', 'refereeAbsencePenalty'],
                  4,
                  0,
                  15
                )::integer
          )
        ),
        updated_at = now_at
    where id = current_match.referee_id;

    update public.matches
    set former_referee_id = coalesce(former_referee_id, referee_id),
        referee_id = null,
        referee_absence_request = referee_absence_request || jsonb_build_object(
          'status', 'confirmed',
          'confirmedBy', safe_actor_id,
          'confirmedAt', now_at
        ),
        updated_at = now_at
    where id = safe_match_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'action', p_action,
    'matchId', safe_match_id,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_referee_absence_action(text, text, text)
from public, anon, authenticated;
grant execute on function public.rankball_match_referee_absence_action(text, text, text)
to service_role;

comment on function public.rankball_match_referee_absence_action(text, text, text) is
  'Creates one pending referee-absence request and applies the trust penalty only after opponent-leader confirmation.';

commit;
