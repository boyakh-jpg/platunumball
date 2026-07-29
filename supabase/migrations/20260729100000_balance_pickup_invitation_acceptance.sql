-- Keep pickup invitations side-neutral and balance their provisional acceptance slots.

create or replace function public.rankball_recruiting_pickup_best_side(p_post_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with current_post as (
    select
      post.host_side,
      post.host_join_mode,
      post.player_id,
      greatest(1, least(5, coalesce(post.side_capacity, 5))) as side_capacity,
      greatest(0, least(3, coalesce(post.bench_capacity, 0))) as bench_capacity
    from public.recruiting_posts post
    where post.id = p_post_id
  ),
  sides(side) as (
    values ('teamA'::text), ('teamB'::text)
  ),
  application_counts as (
    select
      application.side,
      coalesce(sum(case
        when application.kind = 'team' then greatest(
          1,
          jsonb_array_length(case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end)
        )
        else 1
      end), 0)::integer as participant_count
    from public.recruiting_applications application
    where application.post_id = p_post_id
    group by application.side
  ),
  occupancy as (
    select
      sides.side,
      (
        case
          when post.host_join_mode = 'player' and post.player_id is not null and post.host_side = sides.side then 1
          else 0
        end
        + coalesce(application_counts.participant_count, 0)
      )::integer as participant_count,
      post.side_capacity + post.bench_capacity as participant_capacity
    from current_post post
    cross join sides
    left join application_counts on application_counts.side = sides.side
  )
  select coalesce(
    (
      select occupancy.side
      from occupancy
      where occupancy.participant_count < occupancy.participant_capacity
      order by occupancy.participant_count asc, case when occupancy.side = 'teamA' then 0 else 1 end
      limit 1
    ),
    'teamA'
  );
$$;

revoke all on function public.rankball_recruiting_pickup_best_side(text) from public;
revoke all on function public.rankball_recruiting_pickup_best_side(text) from anon;
revoke all on function public.rankball_recruiting_pickup_best_side(text) from authenticated;
revoke all on function public.rankball_recruiting_pickup_best_side(text) from service_role;

do $patch$
declare
  function_def text;
  old_fragment text;
  new_fragment text;
begin
  select pg_get_functiondef('public.rankball_recruiting_invite_players_action(text,text,jsonb,text,boolean,text,text)'::regprocedure)
  into function_def;

  old_fragment := $old$  if coalesce(p_reserve, false) then$old$;
  new_fragment := $new$  if coalesce(p_reserve, false)
    and coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') <> 'pickup'
  then$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_invite_players_action reserve guard shape changed';
  end if;

  old_fragment := $old$    'side', safe_side,
    'reserve', coalesce(p_reserve, false),$old$;
  new_fragment := $new$    'side', case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then null
      else safe_side
    end,
    'reserve', case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup' then false
      else coalesce(p_reserve, false)
    end,$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_invite_players_action invitation shape changed';
  end if;

  new_fragment := $new$    case
      when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup'
        then format('%s 통합 참가 초대장이 도착했습니다.', current_post.title)
      else format('%s %s %s 초대장이 도착했습니다.', current_post.title, case when safe_side = 'teamA' then 'A사이드' else 'B사이드' end, case when coalesce(p_reserve, false) then '후보' else '출전' end)
    end,$new$;
  if strpos(function_def, new_fragment) = 0 then
    old_fragment := function_def;
    function_def := regexp_replace(
      function_def,
      E'    format\\(''%s %s %s[^\\r\\n]+\\),',
      new_fragment
    );
    if function_def = old_fragment then
      raise exception 'rankball_recruiting_invite_players_action notification shape changed';
    end if;
  end if;

  execute function_def;

  select pg_get_functiondef('public.rankball_recruiting_invitation_decision_action(text,text,text,text)'::regprocedure)
  into function_def;

  old_fragment := $old$  safe_side := case when invitation->>'side' in ('teamA', 'teamB') then invitation->>'side' else 'teamB' end;$old$;
  new_fragment := $new$  safe_side := case
    when coalesce(current_post.rules->>'formationMode', current_post.rules->>'matchIntent', '') = 'pickup'
      then public.rankball_recruiting_pickup_best_side(safe_post_id)
    when invitation->>'side' in ('teamA', 'teamB') then invitation->>'side'
    else 'teamB'
  end;$new$;
  if strpos(function_def, old_fragment) > 0 then
    function_def := replace(function_def, old_fragment, new_fragment);
  elsif strpos(function_def, new_fragment) = 0 then
    raise exception 'rankball_recruiting_invitation_decision_action side selection shape changed';
  end if;

  execute function_def;
end;
$patch$;
