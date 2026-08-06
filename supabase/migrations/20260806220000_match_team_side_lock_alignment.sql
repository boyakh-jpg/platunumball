begin;

create or replace function public.rankball_match_room_action_pre_side_mmr_balance(
  p_actor_profile_id text,
  p_match_id text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_player_id text := nullif(btrim(p_payload->>'playerId'), '');
  current_match public.matches%rowtype;
  current_side text;
  target_side text;
  reserve_a boolean := false;
  reserve_b boolean := false;
  team_party_locked boolean := false;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);

  if p_action in ('updateMatchRoomRules', 'setMatchRoomPlayerPlacement', 'removeMatchRoomPlayer')
     and safe_match_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
    select * into current_match from public.matches where id = safe_match_id for update;
    if current_match.id is not null
       and safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
       and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
      raise exception 'match_room_operator_required' using errcode = '42501';
    end if;
  end if;

  if p_action = 'setMatchRoomPlayerPlacement'
     and current_match.id is not null
     and safe_player_id is not null then
    select player.side into current_side
    from public.match_players player
    where player.match_id = safe_match_id and player.user_id = safe_player_id
    order by player.slot_order
    limit 1;

    if current_side is null then
      reserve_a := coalesce(current_match.reserve_players->'teamA', '[]'::jsonb) ? safe_player_id;
      reserve_b := coalesce(current_match.reserve_players->'teamB', '[]'::jsonb) ? safe_player_id;
      if reserve_a and reserve_b then
        raise exception 'match_roster_cross_side_duplicate' using errcode = '23514';
      end if;
      current_side := case when reserve_a then 'teamA' when reserve_b then 'teamB' else null end;
    end if;

    target_side := case
      when p_payload #>> '{placement,side}' in ('teamA', 'teamB') then p_payload #>> '{placement,side}'
      else current_side
    end;

    if target_side is distinct from current_side then
      select
        (
          current_match.team_a_id is not null
          and (
            select count(distinct roster.user_id)
            from (
              select player.user_id
              from public.match_players player
              where player.match_id = safe_match_id and player.side = 'teamA'
              union all
              select reserve.value
              from jsonb_array_elements_text(
                case when jsonb_typeof(current_match.reserve_players->'teamA') = 'array'
                  then current_match.reserve_players->'teamA' else '[]'::jsonb end
              ) reserve(value)
            ) roster
          ) >= 2
        )
        or (
          current_match.team_b_id is not null
          and (
            select count(distinct roster.user_id)
            from (
              select player.user_id
              from public.match_players player
              where player.match_id = safe_match_id and player.side = 'teamB'
              union all
              select reserve.value
              from jsonb_array_elements_text(
                case when jsonb_typeof(current_match.reserve_players->'teamB') = 'array'
                  then current_match.reserve_players->'teamB' else '[]'::jsonb end
              ) reserve(value)
            ) roster
          ) >= 2
        )
        or exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(current_match.rules->'parties') = 'array'
              then current_match.rules->'parties' else '[]'::jsonb end
          ) party(party_row)
          where nullif(btrim(party.party_row->>'teamId'), '') is not null
            and (
              select count(distinct member.user_id)
              from (
                select player.value
                from jsonb_array_elements_text(
                  case when jsonb_typeof(party.party_row->'players') = 'array'
                    then party.party_row->'players' else '[]'::jsonb end
                ) player(value)
                union all
                select reserve.value
                from jsonb_array_elements_text(
                  case when jsonb_typeof(party.party_row->'reserves') = 'array'
                    then party.party_row->'reserves' else '[]'::jsonb end
                ) reserve(value)
              ) member(user_id)
            ) >= 2
        )
      into team_party_locked;

      if team_party_locked then
        raise exception 'match_team_side_locked' using errcode = '23514';
      end if;
    end if;
  end if;

  return public.rankball_match_room_action_unguarded(
    safe_actor_id,
    safe_match_id,
    p_action,
    coalesce(p_payload, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.rankball_match_room_action_pre_side_mmr_balance(text, text, text, jsonb)
  from public, anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
