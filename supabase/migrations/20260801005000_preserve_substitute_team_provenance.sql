begin;

-- The active transition delegates to this internal reducer. Resolve the
-- incoming reserve's original recruiting team instead of copying the outgoing
-- player's team id.
do $migration$
declare
  function_definition text;
  old_fragment constant text := $old$    if active_slot_order is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_active_player_missing', 'matchId', safe_match_id);
    end if;
    if exists ($old$;
  new_fragment constant text := $new$    if active_slot_order is null then
      return jsonb_build_object('ok', false, 'fallback', true, 'reason', 'match_active_player_missing', 'matchId', safe_match_id);
    end if;

    active_team_id := coalesce(
      (
        select nullif(btrim(application.team_id), '')
        from public.recruiting_applications application
        where application.post_id = nullif(
            btrim(current_match.rules->>'recruitingPostId'),
            ''
          )
          and application.kind = 'team'
          and application.side = safe_side
          and application.status in ('ready', 'confirmed')
          and (
            application.player_id = active_in_id
            or (
              jsonb_typeof(application.player_ids) = 'array'
              and application.player_ids ? active_in_id
            )
          )
          and nullif(btrim(application.team_id), '') is not null
        order by coalesce(application.updated_at, application.created_at) desc
        limit 1
      ),
      (
        select nullif(btrim(post.team_id), '')
        from public.recruiting_posts post
        where post.id = nullif(
            btrim(current_match.rules->>'recruitingPostId'),
            ''
          )
          and post.host_join_mode = 'team'
          and post.host_side = safe_side
          and (
            post.player_id = active_in_id
            or (
              jsonb_typeof(post.player_ids) = 'array'
              and post.player_ids ? active_in_id
            )
            or (
              jsonb_typeof(post.room_state #> '{partyReserves,host}') = 'array'
              and (post.room_state #> '{partyReserves,host}') ? active_in_id
            )
            or (
              jsonb_typeof(post.room_state #> array['pinnedReservePlayers', safe_side]) = 'array'
              and (post.room_state #> array['pinnedReservePlayers', safe_side]) ? active_in_id
            )
          )
          and nullif(btrim(post.team_id), '') is not null
        limit 1
      ),
      case
        when safe_side = 'teamA' then current_match.team_a_id
        else current_match.team_b_id
      end
    );
    if exists ($new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_match_roster_move_action_pre_substitution_permission(text,text,text,text,text,text,text)'::regprocedure
  );

  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'match_substitution_team_provenance_shape_changed'
        using errcode = '55000';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$migration$;

select pg_notify('pgrst', 'reload schema');

commit;
