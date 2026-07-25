-- Candidate self-substitution, audited operator reasons, and strict late-attendance eligibility.

alter table public.match_substitution_events
  drop constraint if exists match_substitution_events_reason_check;
alter table public.match_substitution_events
  add constraint match_substitution_events_reason_check
  check (reason in ('self', 'late', 'injury', 'ejection', 'operator'));

create or replace function public.rankball_guard_match_late_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'late' then
    if tg_op = 'INSERT' then
      raise exception 'match_late_attendance_requires_no_show' using errcode = '23514';
    elsif old.status not in ('no_show', 'late') then
      raise exception 'match_late_attendance_requires_no_show' using errcode = '23514';
    elsif old.status = 'no_show' and not exists (
      select 1
      from public.matches match
      where match.id = new.match_id
        and match.started_at is not null
        and match.ended_at is null
    ) then
      raise exception 'match_late_attendance_requires_live_match' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_match_late_attendance on public.match_attendance_entries;
create trigger guard_match_late_attendance
before insert or update on public.match_attendance_entries
for each row execute function public.rankball_guard_match_late_attendance();

create or replace function public.rankball_mark_pending_attendance_no_show_at_start()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.started_at is null and new.started_at is not null then
    update public.match_attendance_entries
    set status = 'no_show',
        updated_at = now()
    where match_id = new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_mark_pending_attendance_no_show_at_start on public.matches;
create trigger zz_mark_pending_attendance_no_show_at_start
after update of started_at on public.matches
for each row execute function public.rankball_mark_pending_attendance_no_show_at_start();

update public.match_attendance_entries entry
set status = 'no_show',
    updated_at = now()
from public.matches match
where entry.match_id = match.id
  and entry.status = 'pending'
  and match.started_at is not null
  and match.ended_at is null
  and entry.first_registered_at <= match.started_at;

create or replace function public.rankball_refresh_match_late_attendance_ids(
  p_match_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  late_player_ids jsonb := '[]'::jsonb;
begin
  if safe_match_id is null then return; end if;
  select coalesce(jsonb_agg(to_jsonb(entry.player_id) order by entry.checked_in_at, entry.player_id), '[]'::jsonb)
  into late_player_ids
  from public.match_attendance_entries entry
  where entry.match_id = safe_match_id
    and entry.status = 'late';

  update public.matches
  set rules = jsonb_set(
        coalesce(rules, '{}'::jsonb),
        '{lateAttendancePlayerIds}',
        late_player_ids,
        true
      ),
      updated_at = now()
  where id = safe_match_id
    and coalesce(rules->'lateAttendancePlayerIds', '[]'::jsonb) is distinct from late_player_ids;
end;
$$;

create or replace function public.rankball_sync_match_late_attendance_ids_from_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rankball_refresh_match_late_attendance_ids(new.match_id);
  return new;
end;
$$;

drop trigger if exists sync_match_late_attendance_ids_from_entry on public.match_attendance_entries;
create trigger sync_match_late_attendance_ids_from_entry
after insert or update on public.match_attendance_entries
for each row execute function public.rankball_sync_match_late_attendance_ids_from_entry();

create or replace function public.rankball_sync_match_late_attendance_ids_from_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rankball_refresh_match_late_attendance_ids(new.id);
  return new;
end;
$$;

drop trigger if exists sync_match_late_attendance_ids_from_match_insert on public.matches;
create trigger sync_match_late_attendance_ids_from_match_insert
after insert on public.matches
for each row execute function public.rankball_sync_match_late_attendance_ids_from_match();

drop trigger if exists sync_match_late_attendance_ids_from_match_update on public.matches;
create trigger sync_match_late_attendance_ids_from_match_update
after update of attendance, reserve_players on public.matches
for each row execute function public.rankball_sync_match_late_attendance_ids_from_match();

select public.rankball_refresh_match_late_attendance_ids(entry.match_id)
from (
  select match.id as match_id
  from public.matches match
  where coalesce(match.rules, '{}'::jsonb) ? 'lateAttendancePlayerIds'
  union
  select distinct attendance.match_id
  from public.match_attendance_entries attendance
  where attendance.status = 'late'
) entry;

create or replace function public.rankball_match_substitution_action(
  p_actor_profile_id text,
  p_match_id text,
  p_side text,
  p_active_player_id text,
  p_reserve_player_id text,
  p_reason text default 'operator'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_active_player_id text := nullif(btrim(p_active_player_id), '');
  safe_reserve_player_id text := nullif(btrim(p_reserve_player_id), '');
  safe_reason text := coalesce(nullif(btrim(p_reason), ''), 'operator');
  roster_move_actor_id text;
  self_substitution boolean := false;
  late_eligible boolean := false;
  result jsonb;
  current_match public.matches%rowtype;
  clock_period integer;
  clock_remaining_ms bigint;
  clock_active_elapsed_ms bigint;
  minimum_seconds integer;
  event_id uuid;
  now_at timestamptz := now();
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null
     or safe_side not in ('teamA', 'teamB')
     or safe_active_player_id is null
     or safe_reserve_player_id is null then
    raise exception 'invalid_match_substitution_request' using errcode = '22023';
  end if;
  if safe_reason not in ('self', 'late', 'injury', 'ejection', 'operator') then
    raise exception 'invalid_match_substitution_reason' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  self_substitution := safe_actor_id = safe_reserve_player_id;
  if self_substitution then
    if safe_reason <> 'self'
       or not (
         case
           when jsonb_typeof(current_match.reserve_players->safe_side) = 'array'
             then current_match.reserve_players->safe_side
           else '[]'::jsonb
         end ? safe_actor_id
       ) then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    roster_move_actor_id := coalesce(
      nullif(btrim(current_match.referee_id), ''),
      nullif(btrim(current_match.created_by), '')
    );
    if roster_move_actor_id is null then
      raise exception 'match_substitution_operator_missing' using errcode = '42501';
    end if;
  else
    if safe_reason = 'self' then
      raise exception 'match_substitution_permission_denied' using errcode = '42501';
    end if;
    roster_move_actor_id := safe_actor_id;
  end if;

  select exists(
    select 1
    from public.match_attendance_entries entry
    where entry.match_id = safe_match_id
      and entry.player_id = safe_reserve_player_id
      and entry.status = 'late'
      and current_match.started_at is not null
      and entry.checked_in_at >= current_match.started_at
  ) into late_eligible;
  if safe_reason = 'late' and not late_eligible then
    raise exception 'match_late_substitution_not_eligible' using errcode = '23514';
  end if;
  if self_substitution then
    safe_reason := case when late_eligible then 'late' else 'self' end;
  end if;

  result := public.rankball_match_roster_move_action(
    roster_move_actor_id,
    'substituteMatchPlayer',
    safe_match_id,
    safe_side,
    safe_active_player_id,
    safe_reserve_player_id,
    null
  );
  if coalesce((result->>'fallback')::boolean, false)
     or not coalesce((result->>'ok')::boolean, false) then
    return result;
  end if;

  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  minimum_seconds := greatest(
    60,
    least(
      180,
      round(
        coalesce(nullif(current_match.rules->>'periodCount', '')::numeric, 1)
        * coalesce(nullif(current_match.rules->>'periodMinutes', '')::numeric, 12)
        * 60
        * 0.1
      )::integer
    )
  );
  select session.current_period, session.period_remaining_ms
  into clock_period, clock_remaining_ms
  from public.match_clock_sessions session
  where session.match_id = safe_match_id
  limit 1;
  clock_active_elapsed_ms := public.rankball_match_clock_effective_elapsed_ms(
    safe_match_id,
    now_at
  );

  insert into public.match_substitution_events (
    match_id,
    side,
    active_out_player_id,
    active_in_player_id,
    reason,
    confirmed_by,
    clock_period,
    clock_remaining_ms,
    clock_active_elapsed_ms,
    minimum_meaningful_seconds,
    created_at
  )
  values (
    safe_match_id,
    safe_side,
    safe_active_player_id,
    safe_reserve_player_id,
    safe_reason,
    safe_actor_id,
    clock_period,
    clock_remaining_ms,
    clock_active_elapsed_ms,
    minimum_seconds,
    now_at
  )
  returning id into event_id;

  update public.match_play_intervals
  set ended_at = greatest(started_at, now_at),
      ended_active_elapsed_ms = case
        when clock_active_elapsed_ms is null then ended_active_elapsed_ms
        when started_active_elapsed_ms is null then clock_active_elapsed_ms
        else greatest(started_active_elapsed_ms, clock_active_elapsed_ms)
      end,
      updated_at = now_at
  where match_id = safe_match_id
    and player_id = safe_active_player_id
    and ended_at is null;
  insert into public.match_play_intervals (
    match_id,
    player_id,
    side,
    started_at,
    started_active_elapsed_ms
  )
  values (
    safe_match_id,
    safe_reserve_player_id,
    safe_side,
    now_at,
    clock_active_elapsed_ms
  )
  on conflict (match_id, player_id) where ended_at is null do nothing;

  update public.matches
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'minimumMeaningfulPlaySeconds', minimum_seconds,
        'lastSubstitutionEventId', event_id,
        'lastSubstitutionAt', now_at
      ),
      updated_at = now_at
  where id = safe_match_id;

  return result || jsonb_build_object(
    'actorProfileId', safe_actor_id,
    'eventId', event_id,
    'reason', safe_reason,
    'clockActiveElapsedMs', clock_active_elapsed_ms,
    'minimumMeaningfulSeconds', minimum_seconds,
    'substitutionEventSaved', true
  );
end;
$$;

revoke all on function public.rankball_guard_match_late_attendance()
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_mark_pending_attendance_no_show_at_start()
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_refresh_match_late_attendance_ids(text)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_sync_match_late_attendance_ids_from_entry()
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_sync_match_late_attendance_ids_from_match()
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_substitution_action(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_substitution_action(text, text, text, text, text, text)
  to service_role;

select pg_notify('pgrst', 'reload schema');
