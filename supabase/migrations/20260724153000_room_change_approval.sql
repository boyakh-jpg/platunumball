begin;

create or replace function public.rankball_recruiting_change_required_ids(p_post_id text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with target_post as (
    select post.*
    from public.recruiting_posts post
    where post.id = nullif(btrim(p_post_id), '')
  ),
  related(profile_id) as (
    select post.player_id from target_post post
    union
    select post.referee_id from target_post post
    union
    select player.value
    from target_post post
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(post.player_ids) = 'array' then post.player_ids else '[]'::jsonb end
    ) player(value)
    union
    select application.player_id
    from public.recruiting_applications application
    where application.post_id = nullif(btrim(p_post_id), '')
    union
    select player.value
    from public.recruiting_applications application
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(application.player_ids) = 'array' then application.player_ids else '[]'::jsonb end
    ) player(value)
    where application.post_id = nullif(btrim(p_post_id), '')
  )
  select coalesce(array_agg(distinct btrim(profile_id) order by btrim(profile_id)), array[]::text[])
  from related
  where nullif(btrim(profile_id), '') is not null
$$;

create or replace function public.rankball_match_change_required_ids(p_match_id text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with target_match as (
    select match.*
    from public.matches match
    where match.id = nullif(btrim(p_match_id), '')
  ),
  related(profile_id) as (
    select match.created_by from target_match match
    union
    select match.referee_id from target_match match
    union
    select player.user_id
    from public.match_players player
    where player.match_id = nullif(btrim(p_match_id), '')
    union
    select reserve.value
    from target_match match
    cross join lateral jsonb_each(
      case when jsonb_typeof(match.reserve_players) = 'object'
        then match.reserve_players else '{}'::jsonb end
    ) reserve_side(side_name, player_ids)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(reserve_side.player_ids) = 'array'
        then reserve_side.player_ids else '[]'::jsonb end
    ) reserve(value)
    where reserve_side.side_name in ('teamA', 'teamB')
  )
  select coalesce(array_agg(distinct btrim(profile_id) order by btrim(profile_id)), array[]::text[])
  from related
  where nullif(btrim(profile_id), '') is not null
$$;

do $$
begin
  if to_regprocedure('public.rankball_recruiting_room_update_action_pre_change_approval(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_recruiting_room_update_action(text,text,jsonb)') is null then
      raise exception 'rankball_recruiting_room_update_action_missing';
    end if;
    alter function public.rankball_recruiting_room_update_action(text, text, jsonb)
      rename to rankball_recruiting_room_update_action_pre_change_approval;
  end if;

  if to_regprocedure('public.rankball_match_room_update_action_pre_change_approval(text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_room_update_action(text,text,jsonb)') is null then
      raise exception 'rankball_match_room_update_action_missing';
    end if;
    alter function public.rankball_match_room_update_action(text, text, jsonb)
      rename to rankball_match_room_update_action_pre_change_approval;
  end if;

  if to_regprocedure('public.rankball_match_start_action_guarded_pre_change_approval(text,text,text,text,jsonb)') is null then
    if to_regprocedure('public.rankball_match_start_action_guarded(text,text,text,text,jsonb)') is null then
      raise exception 'rankball_match_start_action_guarded_missing';
    end if;
    alter function public.rankball_match_start_action_guarded(text, text, text, text, jsonb)
      rename to rankball_match_start_action_guarded_pre_change_approval;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_room_update_action(
  p_actor_profile_id text,
  p_post_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  rule_patch jsonb;
  current_post public.recruiting_posts%rowtype;
  updated_post public.recruiting_posts%rowtype;
  required_ids text[];
  other_participants boolean := false;
  general_changed boolean := false;
  schedule_requested boolean := false;
  schedule_changed boolean := false;
  target_timing_type text;
  target_date_text text;
  target_time_text text;
  target_date date;
  target_time time;
  target_scheduled_at timestamptz;
  target_court_id text;
  target_court_name text;
  target_region text;
  proposal_id text;
  rule_revision integer := 0;
  assignment_mode text;
  base_result jsonb := '{}'::jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'invalid_room_update_patch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post
  where post.id = safe_post_id
  for update;

  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;
  if current_post.status <> 'open' or current_post.confirmed_at is not null then
    raise exception 'recruiting_room_edit_locked' using errcode = '23514';
  end if;
  if current_post.player_id is distinct from safe_actor_id then
    raise exception 'recruiting_owner_required' using errcode = '42501';
  end if;
  if coalesce(current_post.room_state #>> '{scheduleProposal,status}', '') = 'pending' then
    raise exception 'recruiting_schedule_change_pending' using errcode = '23514';
  end if;

  assignment_mode := coalesce(patch->>'pickupTeamAssignmentMode', current_post.rules->>'pickupTeamAssignmentMode', 'manual');
  if assignment_mode not in ('manual', 'random', 'mmr_balanced') then
    raise exception 'invalid_pickup_assignment_mode' using errcode = '22023';
  end if;

  required_ids := public.rankball_recruiting_change_required_ids(safe_post_id);
  other_participants := exists (
    select 1 from unnest(required_ids) required(profile_id)
    where required.profile_id <> safe_actor_id
  );

  schedule_requested := patch ?| array['timingType', 'scheduledDate', 'scheduledTime', 'courtId', 'court'];
  rule_patch := patch - array['timingType', 'scheduledDate', 'scheduledTime', 'courtId', 'court'];
  general_changed := rule_patch <> '{}'::jsonb;

  target_timing_type := case
    when patch->>'timingType' in ('instant', 'scheduled') then patch->>'timingType'
    when coalesce(current_post.room_state->>'timingType', '') in ('instant', 'scheduled')
      then current_post.room_state->>'timingType'
    when current_post.scheduled_date is null then 'instant'
    else 'scheduled'
  end;
  target_date_text := case
    when target_timing_type = 'instant' then ''
    else coalesce(nullif(patch->>'scheduledDate', ''), current_post.scheduled_date::text, '')
  end;
  target_time_text := case
    when target_timing_type = 'instant' then ''
    else left(coalesce(nullif(patch->>'scheduledTime', ''), current_post.scheduled_time::text, ''), 5)
  end;
  if target_timing_type = 'scheduled' then
    if target_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or target_time_text !~ '^[0-9]{2}:[0-9]{2}$' then
      raise exception 'invalid_room_schedule' using errcode = '22023';
    end if;
    target_date := target_date_text::date;
    target_time := target_time_text::time;
    target_scheduled_at := (target_date + target_time) at time zone 'Asia/Seoul';
  end if;

  target_court_id := coalesce(nullif(btrim(patch->>'courtId'), ''), current_post.court_id);
  target_court_name := current_post.court_name;
  target_region := current_post.region;
  if target_court_id is null then raise exception 'invalid_room_court' using errcode = '23514'; end if;
  if target_court_id is distinct from current_post.court_id then
    select court.id, court.name, coalesce(nullif(court.region_key, ''), court.region)
    into target_court_id, target_court_name, target_region
    from public.courts court
    join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
    where court.id = target_court_id;
    if target_court_name is null then raise exception 'court_not_found' using errcode = 'P0002'; end if;
  end if;

  schedule_changed := schedule_requested and (
    target_timing_type is distinct from case
      when coalesce(current_post.room_state->>'timingType', '') in ('instant', 'scheduled')
        then current_post.room_state->>'timingType'
      when current_post.scheduled_date is null then 'instant' else 'scheduled' end
    or target_date_text is distinct from coalesce(current_post.scheduled_date::text, '')
    or target_time_text is distinct from left(coalesce(current_post.scheduled_time::text, ''), 5)
    or target_court_id is distinct from current_post.court_id
  );

  if general_changed then
    base_result := public.rankball_recruiting_room_update_action_pre_change_approval(
      safe_actor_id,
      safe_post_id,
      rule_patch
    );
    select post.* into updated_post
    from public.recruiting_posts post
    where post.id = safe_post_id
    for update;
    rule_revision := coalesce((updated_post.room_state->>'ruleRevision')::integer, 0);

    update public.recruiting_posts
    set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'pickupTeamAssignmentMode', assignment_mode
        ),
        room_state = coalesce(room_state, '{}'::jsonb) || jsonb_build_object(
          'ruleAcknowledgementRequiredIds', to_jsonb(required_ids),
          'ruleAcknowledgedIds', to_jsonb(array[safe_actor_id]::text[])
        ),
        updated_at = now_at
    where id = safe_post_id;

    if other_participants then
      insert into public.notifications (
        id, user_id, target_user_id, title, body, tone, type,
        recruiting_post_id, discord_event, payload, created_at, updated_at
      )
      select
        'notice-recruiting-rules-' || safe_post_id || '-' || rule_revision::text || '-' || target.profile_id,
        target.profile_id,
        target.profile_id,
        '방 정보 변경 확인',
        current_post.title || '의 경기 규칙이 변경되었습니다. 방에서 변경 내용을 확인해 주세요.',
        'match',
        'recruiting_rules_changed',
        safe_post_id,
        'match',
        jsonb_build_object(
          'targetUserId', target.profile_id,
          'recruitingPostId', safe_post_id,
          'ruleRevision', rule_revision,
          'actionRequired', true,
          'webPath', '/app/recruiting?post=' || safe_post_id
        ),
        now_at,
        now_at
      from unnest(required_ids) target(profile_id)
      where target.profile_id <> safe_actor_id
      on conflict (id) do update set
        title = excluded.title,
        body = excluded.body,
        discord_event = excluded.discord_event,
        payload = excluded.payload,
        read_at = null,
        updated_at = excluded.updated_at;
    end if;
  else
    base_result := jsonb_build_object(
      'ok', true,
      'action', 'updateRecruitingRoomRules',
      'postId', safe_post_id,
      'participantsRetained', true,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  if schedule_changed and other_participants then
    proposal_id := 'schedule-' || substr(md5(safe_post_id || ':' || now_at::text), 1, 24);
    update public.recruiting_posts
    set room_state = coalesce(room_state, '{}'::jsonb) || jsonb_build_object(
          'scheduleProposal', jsonb_build_object(
            'id', proposal_id,
            'status', 'pending',
            'proposedBy', safe_actor_id,
            'proposedAt', now_at,
            'timingType', target_timing_type,
            'scheduledDate', target_date_text,
            'scheduledTime', target_time_text,
            'scheduledAt', coalesce(target_scheduled_at::text, ''),
            'courtId', target_court_id,
            'court', target_court_name,
            'requiredIds', to_jsonb(required_ids),
            'approvedIds', to_jsonb(array[safe_actor_id]::text[])
          )
        ),
        updated_at = now_at
    where id = safe_post_id;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      recruiting_post_id, discord_event, payload, created_at, updated_at
    )
    select
      'notice-recruiting-schedule-' || substr(md5(proposal_id || ':' || target.profile_id), 1, 24),
      target.profile_id,
      target.profile_id,
      '일정 변경 승인 요청',
      current_post.title || '의 일정 또는 구장 변경안을 확인해 주세요.',
      'match',
      'recruiting_schedule_change_requested',
      safe_post_id,
      'match',
      jsonb_build_object(
        'targetUserId', target.profile_id,
        'recruitingPostId', safe_post_id,
        'proposalId', proposal_id,
        'actionRequired', true,
        'webPath', '/app/recruiting?post=' || safe_post_id
      ),
      now_at,
      now_at
    from unnest(required_ids) target(profile_id)
    where target.profile_id <> safe_actor_id
    on conflict (id) do update set
      title = excluded.title,
      body = excluded.body,
      discord_event = excluded.discord_event,
      payload = excluded.payload,
      read_at = null,
      updated_at = excluded.updated_at;
  elsif schedule_changed then
    update public.recruiting_posts
    set scheduled_date = case when target_timing_type = 'instant' then null else target_date end,
        scheduled_time = case when target_timing_type = 'instant' then null else target_time end,
        scheduled_at = target_scheduled_at,
        court_id = target_court_id,
        court_name = target_court_name,
        region = coalesce(nullif(target_region, ''), region),
        room_state = (coalesce(room_state, '{}'::jsonb) - 'scheduleProposal')
          || jsonb_build_object('timingType', target_timing_type),
        updated_at = now_at
    where id = safe_post_id;
  end if;

  return base_result || jsonb_build_object(
    'scheduleChangePending', schedule_changed and other_participants,
    'scheduleChanged', schedule_changed,
    'ruleAcknowledgementRequired', general_changed and other_participants
  );
end;
$$;

create or replace function public.rankball_match_room_update_action(
  p_actor_profile_id text,
  p_match_id text,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  patch jsonb := coalesce(p_patch, '{}'::jsonb);
  rule_patch jsonb;
  current_match public.matches%rowtype;
  updated_match public.matches%rowtype;
  agreement_snapshot jsonb := '[]'::jsonb;
  required_ids text[];
  other_participants boolean := false;
  general_changed boolean := false;
  schedule_requested boolean := false;
  schedule_changed boolean := false;
  target_timing_type text;
  target_date_text text;
  target_time_text text;
  target_date date;
  target_time time;
  target_scheduled_at timestamptz;
  target_court_id text;
  target_court_name text;
  target_region text;
  proposal_id text;
  rule_revision integer := 0;
  assignment_mode text;
  base_result jsonb := '{}'::jsonb;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'invalid_room_update_patch' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select match.* into current_match
  from public.matches match
  where match.id = safe_match_id
  for update;

  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status not in ('contract', 'agreed')
     or current_match.started_at is not null
     or current_match.ended_at is not null
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_room_edit_locked' using errcode = '23514';
  end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
     and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
    raise exception 'match_room_operator_required' using errcode = '42501';
  end if;
  if coalesce(current_match.rules #>> '{scheduleProposal,status}', '') = 'pending' then
    raise exception 'match_schedule_change_pending' using errcode = '23514';
  end if;

  assignment_mode := coalesce(patch->>'pickupTeamAssignmentMode', current_match.rules->>'pickupTeamAssignmentMode', 'manual');
  if assignment_mode not in ('manual', 'random', 'mmr_balanced') then
    raise exception 'invalid_pickup_assignment_mode' using errcode = '22023';
  end if;

  required_ids := public.rankball_match_change_required_ids(safe_match_id);
  other_participants := exists (
    select 1 from unnest(required_ids) required(profile_id)
    where required.profile_id <> safe_actor_id
  );

  schedule_requested := patch ?| array['timingType', 'scheduledDate', 'scheduledTime', 'courtId', 'court'];
  rule_patch := patch - array['timingType', 'scheduledDate', 'scheduledTime', 'courtId', 'court'];
  general_changed := rule_patch <> '{}'::jsonb;

  target_timing_type := case
    when patch->>'timingType' in ('instant', 'scheduled') then patch->>'timingType'
    when coalesce(current_match.rules->>'timingType', '') in ('instant', 'scheduled')
      then current_match.rules->>'timingType'
    when current_match.scheduled_date is null then 'instant'
    else 'scheduled'
  end;
  target_date_text := case
    when target_timing_type = 'instant' then ''
    else coalesce(nullif(patch->>'scheduledDate', ''), current_match.scheduled_date::text, '')
  end;
  target_time_text := case
    when target_timing_type = 'instant' then ''
    else left(coalesce(nullif(patch->>'scheduledTime', ''), current_match.scheduled_time::text, ''), 5)
  end;
  if target_timing_type = 'scheduled' then
    if target_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or target_time_text !~ '^[0-9]{2}:[0-9]{2}$' then
      raise exception 'invalid_room_schedule' using errcode = '22023';
    end if;
    target_date := target_date_text::date;
    target_time := target_time_text::time;
    target_scheduled_at := (target_date + target_time) at time zone 'Asia/Seoul';
  end if;

  target_court_id := coalesce(nullif(btrim(patch->>'courtId'), ''), current_match.court_id);
  target_court_name := current_match.court_name;
  target_region := current_match.rules->>'region';
  if target_court_id is null then raise exception 'invalid_room_court' using errcode = '23514'; end if;
  if target_court_id is distinct from current_match.court_id then
    select court.id, court.name, coalesce(nullif(court.region_key, ''), court.region)
    into target_court_id, target_court_name, target_region
    from public.courts court
    join public.approved_courts approved on approved.id = court.id and approved.status = 'active'
    where court.id = target_court_id;
    if target_court_name is null then raise exception 'court_not_found' using errcode = 'P0002'; end if;
  end if;

  schedule_changed := schedule_requested and (
    target_timing_type is distinct from case
      when coalesce(current_match.rules->>'timingType', '') in ('instant', 'scheduled')
        then current_match.rules->>'timingType'
      when current_match.scheduled_date is null then 'instant' else 'scheduled' end
    or target_date_text is distinct from coalesce(current_match.scheduled_date::text, '')
    or target_time_text is distinct from left(coalesce(current_match.scheduled_time::text, ''), 5)
    or target_court_id is distinct from current_match.court_id
  );

  if general_changed then
    select coalesce(jsonb_agg(jsonb_build_object(
      'userId', agreement.user_id,
      'side', agreement.side
    )), '[]'::jsonb)
    into agreement_snapshot
    from public.match_agreements agreement
    where agreement.match_id = safe_match_id;

    base_result := public.rankball_match_room_update_action_pre_change_approval(
      safe_actor_id,
      safe_match_id,
      rule_patch
    );
    select match.* into updated_match
    from public.matches match
    where match.id = safe_match_id
    for update;
    rule_revision := coalesce((updated_match.rules->>'ruleRevision')::integer, 0);

    update public.matches
    set attendance = current_match.attendance,
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'pickupTeamAssignmentMode', assignment_mode,
          'ruleAcknowledgementRequiredIds', to_jsonb(required_ids),
          'ruleAcknowledgedIds', to_jsonb(array[safe_actor_id]::text[])
        ),
        updated_at = now_at
    where id = safe_match_id;

    insert into public.match_agreements (match_id, user_id, side)
    select
      safe_match_id,
      agreement.value->>'userId',
      agreement.value->>'side'
    from jsonb_array_elements(agreement_snapshot) agreement(value)
    where nullif(btrim(agreement.value->>'userId'), '') is not null
      and agreement.value->>'side' in ('teamA', 'teamB')
    on conflict (match_id, user_id) do update set side = excluded.side;

    if other_participants then
      insert into public.notifications (
        id, user_id, target_user_id, title, body, tone, type,
        match_id, discord_event, payload, created_at, updated_at
      )
      select
        'notice-match-rules-' || substr(md5(safe_match_id || ':' || rule_revision::text || ':' || target.profile_id), 1, 24),
        target.profile_id,
        target.profile_id,
        '경기 정보 변경 확인',
        current_match.title || '의 경기 규칙이 변경되었습니다. 방에서 변경 내용을 확인해 주세요.',
        'match',
        'match_rules_changed',
        safe_match_id,
        'match',
        jsonb_build_object(
          'targetUserId', target.profile_id,
          'matchId', safe_match_id,
          'ruleRevision', rule_revision,
          'actionRequired', true,
          'webPath', '/app/matches/' || safe_match_id
        ),
        now_at,
        now_at
      from unnest(required_ids) target(profile_id)
      where target.profile_id <> safe_actor_id
      on conflict (id) do update set
        title = excluded.title,
        body = excluded.body,
        discord_event = excluded.discord_event,
        payload = excluded.payload,
        read_at = null,
        updated_at = excluded.updated_at;
    end if;
  else
    base_result := jsonb_build_object(
      'ok', true,
      'action', 'updateMatchRoomRules',
      'matchId', safe_match_id,
      'participantsRetained', true,
      'sqlReducer', true,
      'advisoryLocked', true
    );
  end if;

  if schedule_changed and other_participants then
    proposal_id := 'schedule-' || substr(md5(safe_match_id || ':' || now_at::text), 1, 24);
    update public.matches
    set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'scheduleProposal', jsonb_build_object(
            'id', proposal_id,
            'status', 'pending',
            'proposedBy', safe_actor_id,
            'proposedAt', now_at,
            'timingType', target_timing_type,
            'scheduledDate', target_date_text,
            'scheduledTime', target_time_text,
            'scheduledAt', coalesce(target_scheduled_at::text, ''),
            'courtId', target_court_id,
            'court', target_court_name,
            'requiredIds', to_jsonb(required_ids),
            'approvedIds', to_jsonb(array[safe_actor_id]::text[])
          )
        ),
        updated_at = now_at
    where id = safe_match_id;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      match_id, discord_event, payload, created_at, updated_at
    )
    select
      'notice-match-schedule-' || substr(md5(proposal_id || ':' || target.profile_id), 1, 24),
      target.profile_id,
      target.profile_id,
      '일정 변경 승인 요청',
      current_match.title || '의 일정 또는 구장 변경안을 확인해 주세요.',
      'match',
      'match_schedule_change_requested',
      safe_match_id,
      'match',
      jsonb_build_object(
        'targetUserId', target.profile_id,
        'matchId', safe_match_id,
        'proposalId', proposal_id,
        'actionRequired', true,
        'webPath', '/app/matches/' || safe_match_id
      ),
      now_at,
      now_at
    from unnest(required_ids) target(profile_id)
    where target.profile_id <> safe_actor_id
    on conflict (id) do update set
      title = excluded.title,
      body = excluded.body,
      discord_event = excluded.discord_event,
      payload = excluded.payload,
      read_at = null,
      updated_at = excluded.updated_at;
  elsif schedule_changed then
    update public.matches
    set scheduled_date = case when target_timing_type = 'instant' then null else target_date end,
        scheduled_time = case when target_timing_type = 'instant' then null else target_time end,
        scheduled_at = target_scheduled_at,
        court_id = target_court_id,
        court_name = target_court_name,
        rules = (coalesce(rules, '{}'::jsonb) - 'scheduleProposal')
          || jsonb_build_object(
            'timingType', target_timing_type,
            'region', coalesce(target_region, rules->>'region')
          ),
        updated_at = now_at
    where id = safe_match_id;
  end if;

  return base_result || jsonb_build_object(
    'scheduleChangePending', schedule_changed and other_participants,
    'scheduleChanged', schedule_changed,
    'ruleAcknowledgementRequired', general_changed and other_participants
  );
end;
$$;

create or replace function public.rankball_recruiting_rule_ack_action(
  p_actor_profile_id text,
  p_post_id text,
  p_rule_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  current_post public.recruiting_posts%rowtype;
  required_ids text[];
  acknowledged_ids text[];
  revision integer;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post where post.id = safe_post_id for update;
  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;

  revision := coalesce((current_post.room_state->>'ruleRevision')::integer, 0);
  if revision <> p_rule_revision then raise exception 'stale_room_rule_revision' using errcode = '40001'; end if;
  select coalesce(array_agg(value), array[]::text[]) into required_ids
  from jsonb_array_elements_text(coalesce(current_post.room_state->'ruleAcknowledgementRequiredIds', '[]'::jsonb)) item(value);
  if not safe_actor_id = any(required_ids) then raise exception 'room_rule_ack_not_required' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct value), array[]::text[]) into acknowledged_ids
  from jsonb_array_elements_text(coalesce(current_post.room_state->'ruleAcknowledgedIds', '[]'::jsonb)) item(value);
  if not safe_actor_id = any(acknowledged_ids) then
    acknowledged_ids := array_append(acknowledged_ids, safe_actor_id);
  end if;

  update public.recruiting_posts
  set room_state = coalesce(room_state, '{}'::jsonb)
        || jsonb_build_object('ruleAcknowledgedIds', to_jsonb(acknowledged_ids)),
      updated_at = now_at
  where id = safe_post_id;
  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
      updated_at = now_at
  where target_user_id = safe_actor_id
    and recruiting_post_id = safe_post_id
    and type = 'recruiting_rules_changed'
    and coalesce((payload->>'ruleRevision')::integer, 0) = revision;

  return jsonb_build_object(
    'ok', true,
    'postId', safe_post_id,
    'ruleRevision', revision,
    'acknowledgedCount', cardinality(acknowledged_ids),
    'requiredCount', cardinality(required_ids)
  );
end;
$$;

create or replace function public.rankball_match_rule_ack_action(
  p_actor_profile_id text,
  p_match_id text,
  p_rule_revision integer
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
  required_ids text[];
  acknowledged_ids text[];
  revision integer;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select match.* into current_match
  from public.matches match where match.id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  revision := coalesce((current_match.rules->>'ruleRevision')::integer, 0);
  if revision <> p_rule_revision then raise exception 'stale_room_rule_revision' using errcode = '40001'; end if;
  select coalesce(array_agg(value), array[]::text[]) into required_ids
  from jsonb_array_elements_text(coalesce(current_match.rules->'ruleAcknowledgementRequiredIds', '[]'::jsonb)) item(value);
  if not safe_actor_id = any(required_ids) then raise exception 'room_rule_ack_not_required' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct value), array[]::text[]) into acknowledged_ids
  from jsonb_array_elements_text(coalesce(current_match.rules->'ruleAcknowledgedIds', '[]'::jsonb)) item(value);
  if not safe_actor_id = any(acknowledged_ids) then
    acknowledged_ids := array_append(acknowledged_ids, safe_actor_id);
  end if;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb)
        || jsonb_build_object('ruleAcknowledgedIds', to_jsonb(acknowledged_ids)),
      updated_at = now_at
  where id = safe_match_id;
  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
      updated_at = now_at
  where target_user_id = safe_actor_id
    and match_id = safe_match_id
    and type = 'match_rules_changed'
    and coalesce((payload->>'ruleRevision')::integer, 0) = revision;

  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'ruleRevision', revision,
    'acknowledgedCount', cardinality(acknowledged_ids),
    'requiredCount', cardinality(required_ids)
  );
end;
$$;

create or replace function public.rankball_recruiting_schedule_response_action(
  p_actor_profile_id text,
  p_post_id text,
  p_proposal_id text,
  p_decision text default 'approve'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_post_id text := nullif(btrim(p_post_id), '');
  safe_proposal_id text := nullif(btrim(p_proposal_id), '');
  decision text := lower(coalesce(nullif(btrim(p_decision), ''), 'approve'));
  current_post public.recruiting_posts%rowtype;
  proposal jsonb;
  stored_required_ids text[];
  current_required_ids text[];
  required_ids text[];
  approved_ids text[];
  complete boolean := false;
  final_status text := 'pending';
  target_date date;
  target_time time;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if decision not in ('approve', 'reject') then raise exception 'invalid_schedule_decision' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(coalesce(safe_post_id, '')));
  select post.* into current_post
  from public.recruiting_posts post where post.id = safe_post_id for update;
  if current_post.id is null then raise exception 'recruiting_post_not_found' using errcode = 'P0002'; end if;

  proposal := current_post.room_state->'scheduleProposal';
  if coalesce(proposal->>'status', '') <> 'pending'
     or proposal->>'id' is distinct from safe_proposal_id then
    raise exception 'schedule_proposal_not_pending' using errcode = '23514';
  end if;
  select coalesce(array_agg(value), array[]::text[]) into stored_required_ids
  from jsonb_array_elements_text(coalesce(proposal->'requiredIds', '[]'::jsonb)) item(value);
  current_required_ids := public.rankball_recruiting_change_required_ids(safe_post_id);
  select coalesce(array_agg(profile_id order by profile_id), array[]::text[]) into required_ids
  from unnest(stored_required_ids) stored(profile_id)
  where stored.profile_id = any(current_required_ids);
  if not safe_actor_id = any(required_ids) then raise exception 'schedule_response_not_required' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct value), array[]::text[]) into approved_ids
  from jsonb_array_elements_text(coalesce(proposal->'approvedIds', '[]'::jsonb)) item(value);

  if decision = 'reject' then
    final_status := 'rejected';
    proposal := proposal || jsonb_build_object(
      'status', final_status,
      'rejectedBy', safe_actor_id,
      'rejectedAt', now_at,
      'requiredIds', to_jsonb(required_ids)
    );
  else
    if not safe_actor_id = any(approved_ids) then approved_ids := array_append(approved_ids, safe_actor_id); end if;
    complete := not exists (
      select 1 from unnest(required_ids) required(profile_id)
      where not required.profile_id = any(approved_ids)
    );
    final_status := case when complete then 'approved' else 'pending' end;
    proposal := proposal || jsonb_build_object(
      'status', final_status,
      'approvedIds', to_jsonb(approved_ids),
      'requiredIds', to_jsonb(required_ids)
    );
    if complete then proposal := proposal || jsonb_build_object('appliedAt', now_at); end if;
  end if;

  if final_status = 'approved' then
    if proposal->>'timingType' = 'scheduled' then
      target_date := (proposal->>'scheduledDate')::date;
      target_time := (proposal->>'scheduledTime')::time;
    end if;
    update public.recruiting_posts
    set scheduled_date = target_date,
        scheduled_time = target_time,
        scheduled_at = case when target_date is null then null else (target_date + target_time) at time zone 'Asia/Seoul' end,
        court_id = proposal->>'courtId',
        court_name = proposal->>'court',
        room_state = coalesce(room_state, '{}'::jsonb)
          || jsonb_build_object('timingType', proposal->>'timingType', 'scheduleProposal', proposal),
        updated_at = now_at
    where id = safe_post_id;
  else
    update public.recruiting_posts
    set room_state = coalesce(room_state, '{}'::jsonb) || jsonb_build_object('scheduleProposal', proposal),
        updated_at = now_at
    where id = safe_post_id;
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
      updated_at = now_at
  where target_user_id = safe_actor_id
    and recruiting_post_id = safe_post_id
    and type = 'recruiting_schedule_change_requested'
    and payload->>'proposalId' = safe_proposal_id;

  if final_status <> 'pending' then
    update public.notifications
    set read_at = coalesce(read_at, now_at),
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
        updated_at = now_at
    where recruiting_post_id = safe_post_id
      and type = 'recruiting_schedule_change_requested'
      and payload->>'proposalId' = safe_proposal_id;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      recruiting_post_id, discord_event, payload, created_at, updated_at
    )
    select
      'notice-recruiting-schedule-result-' || substr(md5(safe_proposal_id || ':' || target.profile_id), 1, 24),
      target.profile_id,
      target.profile_id,
      case when final_status = 'approved' then '일정 변경 확정' else '일정 변경 반려' end,
      case when final_status = 'approved'
        then current_post.title || '의 새 일정과 구장이 확정되었습니다.'
        else current_post.title || '의 일정 변경안이 반려되어 기존 일정이 유지됩니다.' end,
      'match',
      case when final_status = 'approved'
        then 'recruiting_schedule_change_applied' else 'recruiting_schedule_change_rejected' end,
      safe_post_id,
      'match',
      jsonb_build_object(
        'targetUserId', target.profile_id,
        'recruitingPostId', safe_post_id,
        'proposalId', safe_proposal_id,
        'actionRequired', false,
        'webPath', '/app/recruiting?post=' || safe_post_id
      ),
      now_at,
      now_at
    from unnest(required_ids) target(profile_id)
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'postId', safe_post_id,
    'proposalId', safe_proposal_id,
    'status', final_status,
    'approvedCount', cardinality(approved_ids),
    'requiredCount', cardinality(required_ids)
  );
end;
$$;

create or replace function public.rankball_match_schedule_response_action(
  p_actor_profile_id text,
  p_match_id text,
  p_proposal_id text,
  p_decision text default 'approve'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_proposal_id text := nullif(btrim(p_proposal_id), '');
  decision text := lower(coalesce(nullif(btrim(p_decision), ''), 'approve'));
  current_match public.matches%rowtype;
  proposal jsonb;
  stored_required_ids text[];
  current_required_ids text[];
  required_ids text[];
  approved_ids text[];
  complete boolean := false;
  final_status text := 'pending';
  target_date date;
  target_time time;
  now_at timestamptz := clock_timestamp();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if decision not in ('approve', 'reject') then raise exception 'invalid_schedule_decision' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select match.* into current_match
  from public.matches match where match.id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;

  proposal := current_match.rules->'scheduleProposal';
  if coalesce(proposal->>'status', '') <> 'pending'
     or proposal->>'id' is distinct from safe_proposal_id then
    raise exception 'schedule_proposal_not_pending' using errcode = '23514';
  end if;
  select coalesce(array_agg(value), array[]::text[]) into stored_required_ids
  from jsonb_array_elements_text(coalesce(proposal->'requiredIds', '[]'::jsonb)) item(value);
  current_required_ids := public.rankball_match_change_required_ids(safe_match_id);
  select coalesce(array_agg(profile_id order by profile_id), array[]::text[]) into required_ids
  from unnest(stored_required_ids) stored(profile_id)
  where stored.profile_id = any(current_required_ids);
  if not safe_actor_id = any(required_ids) then raise exception 'schedule_response_not_required' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct value), array[]::text[]) into approved_ids
  from jsonb_array_elements_text(coalesce(proposal->'approvedIds', '[]'::jsonb)) item(value);

  if decision = 'reject' then
    final_status := 'rejected';
    proposal := proposal || jsonb_build_object(
      'status', final_status,
      'rejectedBy', safe_actor_id,
      'rejectedAt', now_at,
      'requiredIds', to_jsonb(required_ids)
    );
  else
    if not safe_actor_id = any(approved_ids) then approved_ids := array_append(approved_ids, safe_actor_id); end if;
    complete := not exists (
      select 1 from unnest(required_ids) required(profile_id)
      where not required.profile_id = any(approved_ids)
    );
    final_status := case when complete then 'approved' else 'pending' end;
    proposal := proposal || jsonb_build_object(
      'status', final_status,
      'approvedIds', to_jsonb(approved_ids),
      'requiredIds', to_jsonb(required_ids)
    );
    if complete then proposal := proposal || jsonb_build_object('appliedAt', now_at); end if;
  end if;

  if final_status = 'approved' then
    if proposal->>'timingType' = 'scheduled' then
      target_date := (proposal->>'scheduledDate')::date;
      target_time := (proposal->>'scheduledTime')::time;
    end if;
    update public.matches
    set scheduled_date = target_date,
        scheduled_time = target_time,
        scheduled_at = case when target_date is null then null else (target_date + target_time) at time zone 'Asia/Seoul' end,
        court_id = proposal->>'courtId',
        court_name = proposal->>'court',
        rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
          'timingType', proposal->>'timingType',
          'scheduleProposal', proposal
        ),
        updated_at = now_at
    where id = safe_match_id;
  else
    update public.matches
    set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object('scheduleProposal', proposal),
        updated_at = now_at
    where id = safe_match_id;
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now_at),
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
      updated_at = now_at
  where target_user_id = safe_actor_id
    and match_id = safe_match_id
    and type = 'match_schedule_change_requested'
    and payload->>'proposalId' = safe_proposal_id;

  if final_status <> 'pending' then
    update public.notifications
    set read_at = coalesce(read_at, now_at),
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('actionRequired', false),
        updated_at = now_at
    where match_id = safe_match_id
      and type = 'match_schedule_change_requested'
      and payload->>'proposalId' = safe_proposal_id;

    insert into public.notifications (
      id, user_id, target_user_id, title, body, tone, type,
      match_id, discord_event, payload, created_at, updated_at
    )
    select
      'notice-match-schedule-result-' || substr(md5(safe_proposal_id || ':' || target.profile_id), 1, 24),
      target.profile_id,
      target.profile_id,
      case when final_status = 'approved' then '일정 변경 확정' else '일정 변경 반려' end,
      case when final_status = 'approved'
        then current_match.title || '의 새 일정과 구장이 확정되었습니다.'
        else current_match.title || '의 일정 변경안이 반려되어 기존 일정이 유지됩니다.' end,
      'match',
      case when final_status = 'approved'
        then 'match_schedule_change_applied' else 'match_schedule_change_rejected' end,
      safe_match_id,
      'match',
      jsonb_build_object(
        'targetUserId', target.profile_id,
        'matchId', safe_match_id,
        'proposalId', safe_proposal_id,
        'actionRequired', false,
        'webPath', '/app/matches/' || safe_match_id
      ),
      now_at,
      now_at
    from unnest(required_ids) target(profile_id)
    on conflict (id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'proposalId', safe_proposal_id,
    'status', final_status,
    'approvedCount', cardinality(approved_ids),
    'requiredCount', cardinality(required_ids)
  );
end;
$$;

create or replace function public.rankball_match_start_action_guarded(
  p_actor_profile_id text,
  p_match_id text,
  p_started_at text default null,
  p_agreed_at text default null,
  p_attendance jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_match public.matches%rowtype;
  current_required_ids text[];
  rule_required_ids text[];
  acknowledged_ids text[];
begin
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(p_match_id, '')));
  select match.* into current_match
  from public.matches match
  where match.id = nullif(btrim(p_match_id), '')
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if coalesce(current_match.rules #>> '{scheduleProposal,status}', '') = 'pending' then
    raise exception 'match_schedule_change_pending' using errcode = '23514';
  end if;

  current_required_ids := public.rankball_match_change_required_ids(current_match.id);
  select coalesce(array_agg(value), array[]::text[]) into rule_required_ids
  from jsonb_array_elements_text(coalesce(current_match.rules->'ruleAcknowledgementRequiredIds', '[]'::jsonb)) item(value);
  select coalesce(array_agg(value), array[]::text[]) into acknowledged_ids
  from jsonb_array_elements_text(coalesce(current_match.rules->'ruleAcknowledgedIds', '[]'::jsonb)) item(value);
  if exists (
    select 1
    from unnest(rule_required_ids) required(profile_id)
    where required.profile_id = any(current_required_ids)
      and not required.profile_id = any(acknowledged_ids)
  ) then
    raise exception 'match_rule_acknowledgement_pending' using errcode = '23514';
  end if;

  return public.rankball_match_start_action_guarded_pre_change_approval(
    p_actor_profile_id,
    p_match_id,
    p_started_at,
    p_agreed_at,
    p_attendance
  );
end;
$$;

revoke all on function public.rankball_recruiting_change_required_ids(text) from public, anon, authenticated;
revoke all on function public.rankball_match_change_required_ids(text) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_room_update_action_pre_change_approval(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_room_update_action_pre_change_approval(text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_start_action_guarded_pre_change_approval(text, text, text, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rankball_recruiting_room_update_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_match_room_update_action(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_rule_ack_action(text, text, integer) from public, anon, authenticated;
revoke all on function public.rankball_match_rule_ack_action(text, text, integer) from public, anon, authenticated;
revoke all on function public.rankball_recruiting_schedule_response_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_schedule_response_action(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.rankball_recruiting_room_update_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_match_room_update_action(text, text, jsonb) to service_role;
grant execute on function public.rankball_recruiting_rule_ack_action(text, text, integer) to service_role;
grant execute on function public.rankball_match_rule_ack_action(text, text, integer) to service_role;
grant execute on function public.rankball_recruiting_schedule_response_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_schedule_response_action(text, text, text, text) to service_role;
grant execute on function public.rankball_match_start_action_guarded(text, text, text, text, jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
