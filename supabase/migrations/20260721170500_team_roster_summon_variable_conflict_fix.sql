do $$
declare
  function_sql text;
  next_function_sql text;
begin
  select pg_get_functiondef('public.rankball_recruiting_management_action(text,jsonb)'::regprocedure)
  into function_sql;

  if position('#variable_conflict use_variable' in function_sql) = 0 then
    next_function_sql := regexp_replace(
      function_sql,
      'AS \$function\$\s*',
      E'AS $function$\n#variable_conflict use_variable\n',
      'i'
    );
    if next_function_sql = function_sql then
      raise exception 'rankball_recruiting_management_action_body_not_rewritten';
    end if;
    execute next_function_sql;
  end if;
end;
$$;

do $$
declare
  repair_row record;
begin
  for repair_row in
    select
      post.id as post_id,
      invitation->>'fromUserId' as actor_id,
      invitation->>'teamId' as team_id,
      invitation->>'side' as side_name,
      coalesce((invitation->>'reserve')::boolean, false) as reserve_requested,
      jsonb_agg(to_jsonb(invitation->>'targetUserId')) as target_ids
    from public.recruiting_posts post
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(post.room_state->'invitations') = 'array' then post.room_state->'invitations' else '[]'::jsonb end
    ) invitation
    where post.status = 'open'
      and coalesce(invitation->>'status', 'pending') = 'pending'
      and invitation->>'joinMode' = 'team'
      and nullif(invitation->>'teamId', '') is not null
      and (
        (
          post.team_id = invitation->>'teamId'
          and post.host_side = invitation->>'side'
          and invitation->>'fromUserId' = coalesce(post.room_state #>> '{partyLeaders,host}', post.player_id)
        )
        or exists (
          select 1
          from public.recruiting_applications application
          where application.post_id = post.id
            and application.kind = 'team'
            and application.team_id = invitation->>'teamId'
            and application.side = invitation->>'side'
            and invitation->>'fromUserId' = coalesce(
              post.room_state #>> array['partyLeaders', 'team:' || application.team_id],
              application.player_id
            )
        )
      )
    group by
      post.id,
      invitation->>'fromUserId',
      invitation->>'teamId',
      invitation->>'side',
      coalesce((invitation->>'reserve')::boolean, false)
  loop
    perform public.rankball_recruiting_management_action(
      repair_row.actor_id,
      jsonb_build_object(
        'action', 'inviteRecruitingPlayers',
        'postId', repair_row.post_id,
        'invite', jsonb_build_object(
          'playerIds', repair_row.target_ids,
          'joinMode', 'team',
          'teamId', repair_row.team_id,
          'side', repair_row.side_name,
          'reserve', repair_row.reserve_requested
        )
      )
    );
  end loop;
end;
$$;

select pg_notify('pgrst', 'reload schema');
