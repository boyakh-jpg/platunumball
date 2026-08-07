begin;

create or replace function public.rankball_enforce_match_qr_attendance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  record_type text := lower(coalesce(nullif(btrim(new.rules->>'recordType'), ''), 'match'));
begin
  new.rules := jsonb_set(
    coalesce(new.rules, '{}'::jsonb),
    '{qrAttendanceEnabled}',
    to_jsonb(record_type not in ('match_record', 'personal_record', 'solo')),
    true
  );
  return new;
end;
$$;

drop trigger if exists rankball_enforce_match_qr_attendance_trigger on public.matches;
create trigger rankball_enforce_match_qr_attendance_trigger
before insert or update of rules on public.matches
for each row execute function public.rankball_enforce_match_qr_attendance();

update public.matches
set rules = jsonb_set(
      coalesce(rules, '{}'::jsonb),
      '{qrAttendanceEnabled}',
      to_jsonb(
        lower(coalesce(nullif(btrim(rules->>'recordType'), ''), 'match'))
          not in ('match_record', 'personal_record', 'solo')
      ),
      true
    ),
    updated_at = clock_timestamp()
where rules->'qrAttendanceEnabled' is distinct from to_jsonb(
  lower(coalesce(nullif(btrim(rules->>'recordType'), ''), 'match'))
    not in ('match_record', 'personal_record', 'solo')
);

create or replace function public.rankball_match_no_dispute_action(
  p_actor_profile_id text,
  p_match_id text
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
  current_ids jsonb;
  acknowledgement_count integer := 0;
begin
  if safe_actor_id is null or safe_match_id is null then
    raise exception 'match_no_dispute_input_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;

  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) in ('match_record', 'personal_record', 'solo')
     or current_match.ended_at is null
     or current_match.confirmed_at is not null
     or not exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_no_dispute_unavailable' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id and dispute.by = safe_actor_id
  ) then
    raise exception 'match_no_dispute_conflicts_with_dispute' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and player.user_id = safe_actor_id
      and not (
        case when jsonb_typeof(current_match.reserve_players->player.side) = 'array'
          then current_match.reserve_players->player.side else '[]'::jsonb end
      ) ? player.user_id
    union
    select 1
    where safe_actor_id in (
      select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      )
      union
      select value from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      )
    )
  ) then
    raise exception 'match_no_dispute_participant_required' using errcode = '42501';
  end if;

  current_ids := case when jsonb_typeof(current_match.rules->'noDisputeUserIds') = 'array'
    then current_match.rules->'noDisputeUserIds' else '[]'::jsonb end;
  if not current_ids ? safe_actor_id then
    current_ids := current_ids || to_jsonb(safe_actor_id);
    update public.matches
    set rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{noDisputeUserIds}', current_ids, true),
        updated_at = clock_timestamp()
    where id = safe_match_id;
  end if;

  select count(*)::integer into acknowledgement_count
  from jsonb_array_elements_text(current_ids);

  return jsonb_build_object(
    'ok', true,
    'matchId', safe_match_id,
    'acknowledgementCount', acknowledgement_count
  );
end;
$$;

create or replace function public.rankball_match_finalize_locked(
  p_actor_profile_id text,
  p_match_id text,
  p_action text,
  p_disputes_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  submitted_at timestamptz;
  participant_count integer := 0;
  acknowledgement_count integer := 0;
  required_count integer := 0;
  time_ready boolean := false;
begin
  if p_disputes_acknowledged is distinct from true then
    raise exception 'match_finalize_disputes_acknowledgement_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;
  if lower(coalesce(current_match.rules->>'recordType', '')) in ('match_record', 'personal_record', 'solo') then
    raise exception 'match_live_finalize_record_type_invalid' using errcode = '23514';
  end if;

  select result.submitted_at into submitted_at
  from public.match_results result
  where result.match_id = safe_match_id
  for update;
  if submitted_at is null or current_match.ended_at is null then
    raise exception 'match_result_submission_required' using errcode = '23514';
  end if;

  with actual_players as (
    select distinct player.user_id
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
      and not (
        case when jsonb_typeof(current_match.reserve_players->player.side) = 'array'
          then current_match.reserve_players->player.side else '[]'::jsonb end
      ) ? player.user_id
    union
    select value from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    )
    union
    select value from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    )
  ), acknowledgements as (
    select distinct value as user_id
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.rules->'noDisputeUserIds') = 'array'
        then current_match.rules->'noDisputeUserIds' else '[]'::jsonb end
    )
  )
  select count(*)::integer,
         count(acknowledgements.user_id) filter (where not exists (
           select 1 from public.match_disputes dispute
           where dispute.match_id = safe_match_id and dispute.by = actual_players.user_id
         ))::integer
  into participant_count, acknowledgement_count
  from actual_players
  left join acknowledgements using (user_id);

  required_count := ceil(participant_count * 2.0 / 3.0)::integer;
  time_ready := clock_timestamp() >= greatest(submitted_at, current_match.ended_at) + interval '3 minutes';
  if not time_ready and (required_count = 0 or acknowledgement_count < required_count) then
    raise exception 'match_manual_finalization_not_due' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_disputes dispute
    where dispute.match_id = safe_match_id and dispute.status = 'open'
  ) then
    raise exception 'match_dispute_resolution_required' using errcode = '23514';
  end if;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'manualFinalizationAudit',
        jsonb_build_object(
          'actor', nullif(btrim(p_actor_profile_id), ''),
          'finalizedAt', clock_timestamp(),
          'disputesAcknowledged', true,
          'openDisputeCount', 0,
          'timeReady', time_ready,
          'noDisputeCount', acknowledgement_count,
          'noDisputeRequiredCount', required_count
        )
      ),
      updated_at = clock_timestamp()
  where id = safe_match_id;

  return public.rankball_match_live_finalize_action(
    p_actor_profile_id,
    safe_match_id,
    coalesce(nullif(btrim(p_action), ''), 'finalizeMatch')
  );
end;
$$;

revoke all on function public.rankball_enforce_match_qr_attendance() from public, anon, authenticated;
revoke all on function public.rankball_match_no_dispute_action(text, text) from public, anon, authenticated;
grant execute on function public.rankball_match_no_dispute_action(text, text) to service_role;
revoke all on function public.rankball_match_finalize_locked(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.rankball_match_finalize_locked(text, text, text, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
