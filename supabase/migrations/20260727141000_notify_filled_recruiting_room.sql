do $$
declare
  function_definition text;
  old_condition text := $old$  ) >= (
    (greatest(1, least(5, coalesce(current_post.side_capacity, 5)))
      + greatest(0, least(3, coalesce(current_post.bench_capacity, 2)))) * 2
  ) then
    select coalesce(jsonb_agg($old$;
  new_condition text := $new$  ) >= (
    (greatest(1, least(5, coalesce(current_post.side_capacity, 5)))
      + greatest(0, least(3, coalesce(current_post.bench_capacity, 2)))) * 2
  ) and nullif(current_room_state->>'playerCapacityFilledAt', '') is null then
    insert into public.notifications (
      id, target_user_id, title, body, tone, recruiting_post_id, invitation_id, payload, created_at, updated_at
    )
    select
      'n_' || replace(gen_random_uuid()::text, '-', ''),
      candidate->>'targetUserId',
      '초대 종료',
      current_post.title || ' 초대받은 방의 출전·후보 슬롯이 모두 찼습니다.',
      'orange',
      safe_post_id,
      candidate->>'id',
      jsonb_build_object('source', 'recruiting_room_player_capacity_filled'),
      now(),
      now()
    from jsonb_array_elements(next_invitations) candidate
    where coalesce(candidate->>'role', 'player') <> 'referee'
      and coalesce(candidate->>'status', 'pending') = 'pending'
      and nullif(candidate->>'targetUserId', '') is not null;

    if owner_id is not null then
      insert into public.notifications (
        id, target_user_id, title, body, tone, recruiting_post_id, payload, created_at, updated_at
      ) values (
        'n_' || replace(gen_random_uuid()::text, '-', ''),
        owner_id,
        '방 정원 충족',
        current_post.title || ' 정원이 모두 찼습니다. 방을 확인하고 경기를 확정해 주세요.',
        'match',
        safe_post_id,
        jsonb_build_object('source', 'recruiting_room_player_capacity_filled'),
        now(),
        now()
      );
    end if;

    select coalesce(jsonb_agg($new$;
  old_marker text := $old$    into next_invitations
    from jsonb_array_elements(next_invitations) candidate;
  end if;$old$;
  new_marker text := $new$    into next_invitations
    from jsonb_array_elements(next_invitations) candidate;
    current_room_state := jsonb_set(current_room_state, '{playerCapacityFilledAt}', to_jsonb(now()), true);
  end if;$new$;
begin
  select pg_get_functiondef('public.rankball_recruiting_invitation_decision_action(text,text,text,text)'::regprocedure)
  into function_definition;

  if position(new_condition in function_definition) = 0 then
    if position(old_condition in function_definition) = 0 then
      raise exception 'recruiting_filled_room_condition_shape_changed';
    end if;
    function_definition := replace(function_definition, old_condition, new_condition);
  end if;

  if position(new_marker in function_definition) = 0 then
    if position(old_marker in function_definition) = 0 then
      raise exception 'recruiting_filled_room_marker_shape_changed';
    end if;
    function_definition := replace(function_definition, old_marker, new_marker);
  end if;

  execute function_definition;
end;
$$;
