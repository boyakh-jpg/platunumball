do $$
declare
  function_definition text;
  old_fragment text := $old$  next_room_state := current_room_state;
  next_room_state := jsonb_set(next_room_state, '{invitations}', next_invitations, true);$old$;
  new_fragment text := $new$  if (
    (case
      when current_post.host_join_mode = 'player' and current_post.player_id is not null then 1
      else jsonb_array_length(case when jsonb_typeof(current_post.player_ids) = 'array' then current_post.player_ids else '[]'::jsonb end)
    end)
    + (
      select coalesce(sum(case
        when kind = 'team' then greatest(1, jsonb_array_length(case when jsonb_typeof(player_ids) = 'array' then player_ids else '[]'::jsonb end))
        else 1
      end), 0)::integer
      from public.recruiting_applications
      where post_id = safe_post_id
    )
  ) >= (
    (greatest(1, least(5, coalesce(current_post.side_capacity, 5)))
      + greatest(0, least(3, coalesce(current_post.bench_capacity, 2)))) * 2
  ) then
    select coalesce(jsonb_agg(
      case
        when coalesce(candidate->>'role', 'player') <> 'referee'
          and coalesce(candidate->>'status', 'pending') = 'pending'
        then candidate || jsonb_build_object('status', 'expired', 'updatedAt', now())
        else candidate
      end
    ), '[]'::jsonb)
    into next_invitations
    from jsonb_array_elements(next_invitations) candidate;
  end if;

  next_room_state := current_room_state;
  next_room_state := jsonb_set(next_room_state, '{invitations}', next_invitations, true);$new$;
begin
  select pg_get_functiondef('public.rankball_recruiting_invitation_decision_action(text,text,text,text)'::regprocedure)
  into function_definition;

  if position(new_fragment in function_definition) = 0 then
    if position(old_fragment in function_definition) = 0 then
      raise exception 'recruiting_invitation_decision_shape_changed';
    end if;
    execute replace(function_definition, old_fragment, new_fragment);
  end if;
end;
$$;
