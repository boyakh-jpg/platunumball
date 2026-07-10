-- Serialize room and match action entry points by entity id before any branch-specific reducer runs.

create or replace function public.rankball_recruiting_action(
  p_actor_profile_id text,
  p_action text,
  p_post_row jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := coalesce(nullif(btrim(p_action), ''), 'sync');
  safe_post_id text := nullif(btrim(p_post_row->>'id'), '');
  expected_updated_at timestamptz := coalesce(p_expected_updated_at, nullif(p_post_row->>'__expectedUpdatedAt', '')::timestamptz);
  current_updated_at timestamptz;
  persist_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_post_id is null then
    raise exception 'missing_recruiting_post' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:recruiting'), hashtext(safe_post_id));

  if safe_action = 'setRecruitingSlotPosition' and p_post_row ? '__operation' then
    return public.rankball_recruiting_slot_position_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,playerId}',
      p_post_row #>> '{__operation,position}'
    );
  end if;

  if safe_action = 'interestRecruitingPost' and p_post_row ? '__operation' then
    return public.rankball_recruiting_interest_player_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,application,joinMode}',
      p_post_row #>> '{__operation,application,teamId}',
      p_post_row #>> '{__operation,application,side}',
      case when lower(coalesce(p_post_row #>> '{__operation,application,reserve}', 'false')) = 'true' then true else false end,
      p_post_row #>> '{__operation,application,position}'
    );
  end if;

  if safe_action = 'setRecruitingApplicantPlacement' and p_post_row ? '__operation' then
    return public.rankball_recruiting_applicant_placement_action(
      safe_actor_id,
      safe_post_id,
      p_post_row #>> '{__operation,playerId}',
      p_post_row #>> '{__operation,placement,side}',
      case when lower(coalesce(p_post_row #>> '{__operation,placement,reserve}', 'false')) = 'true' then true else false end
    );
  end if;

  if safe_action = 'cancelRecruitingParticipation' and p_post_row ? '__operation' then
    return public.rankball_recruiting_cancel_participation_action(
      safe_actor_id,
      safe_post_id
    );
  end if;

  select updated_at
  into current_updated_at
  from public.recruiting_posts
  where id = safe_post_id
  for update;

  if expected_updated_at is not null and current_updated_at is not null and current_updated_at <> expected_updated_at then
    raise exception 'recruiting_stale_snapshot' using errcode = '40001';
  end if;

  persist_result := public.rankball_persist_recruiting_snapshot(
    p_post_row - '__expectedUpdatedAt',
    p_application_rows,
    p_notification_rows
  );

  return persist_result || jsonb_build_object(
    'action', safe_action,
    'actorProfileId', safe_actor_id,
    'advisoryLocked', true
  );
end;
$$;

drop function if exists public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb);
revoke all on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) from public;
revoke all on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) from anon;
revoke all on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) from authenticated;
grant execute on function public.rankball_recruiting_action(text, text, jsonb, jsonb, jsonb, timestamptz) to service_role;

create or replace function public.rankball_match_action(
  p_actor_profile_id text,
  p_action text,
  p_match_row jsonb,
  p_player_rows jsonb default '[]'::jsonb,
  p_result_row jsonb default null,
  p_stat_rows jsonb default '[]'::jsonb,
  p_agreement_rows jsonb default '[]'::jsonb,
  p_approval_rows jsonb default '[]'::jsonb,
  p_dispute_rows jsonb default '[]'::jsonb,
  p_notification_rows jsonb default '[]'::jsonb,
  p_replace_result boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := coalesce(nullif(btrim(p_action), ''), 'sync');
  safe_match_id text := nullif(btrim(p_match_row->>'id'), '');
  expected_updated_at timestamptz := nullif(p_match_row->>'__expectedUpdatedAt', '')::timestamptz;
  current_updated_at timestamptz;
  persist_result jsonb;
begin
  if safe_actor_id is null then
    raise exception 'missing_actor_profile_id' using errcode = '22023';
  end if;
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  if safe_action = 'agreeMatch' and p_match_row ? '__operation' then
    return public.rankball_match_agree_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
  end if;

  if safe_action = 'checkInMatchPlayer' and p_match_row ? '__operation' then
    return public.rankball_match_checkin_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{__operation,sideName}',
      p_match_row #>> '{__operation,playerId}'
    );
  end if;

  if safe_action = 'startMatch' and p_match_row ? '__operation' then
    return public.rankball_match_start_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{agreed_at}',
      coalesce(p_match_row->'attendance', '{}'::jsonb)
    );
  end if;

  if safe_action = 'endMatch' and p_match_row ? '__operation' then
    return public.rankball_match_end_action(
      safe_actor_id,
      safe_match_id,
      p_match_row #>> '{started_at}',
      p_match_row #>> '{ended_at}'
    );
  end if;

  select updated_at
  into current_updated_at
  from public.matches
  where id = safe_match_id
  for update;

  if expected_updated_at is not null and current_updated_at is not null and current_updated_at <> expected_updated_at then
    raise exception 'match_stale_snapshot' using errcode = '40001';
  end if;

  persist_result := public.rankball_persist_match_snapshot(
    p_match_row - '__expectedUpdatedAt',
    p_player_rows,
    p_result_row,
    p_stat_rows,
    p_agreement_rows,
    p_approval_rows,
    public.rankball_normalize_match_dispute_rows(p_dispute_rows, safe_match_id),
    p_notification_rows,
    p_replace_result
  );

  return persist_result || jsonb_build_object(
    'action', safe_action,
    'actorProfileId', safe_actor_id,
    'advisoryLocked', true
  );
end;
$$;

revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from public;
revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from anon;
revoke all on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) from authenticated;
grant execute on function public.rankball_match_action(text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
