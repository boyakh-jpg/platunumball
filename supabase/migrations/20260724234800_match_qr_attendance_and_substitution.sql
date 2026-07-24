-- Public-match QR attendance, attendance-based resize, and audited live substitutions.

create table if not exists public.match_attendance_entries (
  match_id text not null references public.matches(id) on delete cascade,
  player_id text not null references public.profiles(id) on delete cascade,
  side text not null check (side in ('teamA', 'teamB')),
  original_role text not null default 'active' check (original_role in ('active', 'reserve')),
  status text not null default 'pending' check (status in ('pending', 'on_time', 'late', 'no_show')),
  method text check (method is null or method in ('operator', 'qr')),
  checked_in_at timestamptz,
  first_registered_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create index if not exists match_attendance_entries_match_status_idx
  on public.match_attendance_entries (match_id, status, side);
create index if not exists match_attendance_entries_player_idx
  on public.match_attendance_entries (player_id, updated_at desc);

create table if not exists public.match_substitution_events (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  side text not null check (side in ('teamA', 'teamB')),
  active_out_player_id text not null references public.profiles(id) on delete cascade,
  active_in_player_id text not null references public.profiles(id) on delete cascade,
  reason text not null default 'operator' check (reason in ('late', 'injury', 'ejection', 'operator')),
  confirmed_by text not null references public.profiles(id) on delete cascade,
  clock_period integer,
  clock_remaining_ms bigint,
  minimum_meaningful_seconds integer not null,
  created_at timestamptz not null default now()
);

create index if not exists match_substitution_events_match_created_idx
  on public.match_substitution_events (match_id, created_at, id);

create table if not exists public.match_play_intervals (
  id uuid primary key default gen_random_uuid(),
  match_id text not null references public.matches(id) on delete cascade,
  player_id text not null references public.profiles(id) on delete cascade,
  side text not null check (side in ('teamA', 'teamB')),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create unique index if not exists match_play_intervals_one_open_player_idx
  on public.match_play_intervals (match_id, player_id)
  where ended_at is null;
create index if not exists match_play_intervals_match_idx
  on public.match_play_intervals (match_id, side, started_at);

alter table public.match_attendance_entries enable row level security;
alter table public.match_substitution_events enable row level security;
alter table public.match_play_intervals enable row level security;

revoke all on table public.match_attendance_entries from public, anon, authenticated;
revoke all on table public.match_substitution_events from public, anon, authenticated;
revoke all on table public.match_play_intervals from public, anon, authenticated;
grant select, insert, update, delete on table public.match_attendance_entries to service_role;
grant select, insert, update, delete on table public.match_substitution_events to service_role;
grant select, insert, update, delete on table public.match_play_intervals to service_role;

insert into public.match_attendance_entries (
  match_id, player_id, side, original_role, status, method, checked_in_at, first_registered_at, updated_at
)
select
  player.match_id,
  player.user_id,
  player.side,
  'active',
  case
    when coalesce(match.attendance -> player.side, '[]'::jsonb) ? player.user_id then 'on_time'
    else 'pending'
  end,
  case when coalesce(match.attendance -> player.side, '[]'::jsonb) ? player.user_id then 'operator' end,
  case when coalesce(match.attendance -> player.side, '[]'::jsonb) ? player.user_id
    then coalesce(match.started_at, match.updated_at, now()) end,
  coalesce(match.created_at, now()),
  coalesce(match.updated_at, now())
from public.match_players player
join public.matches match on match.id = player.match_id
where player.side in ('teamA', 'teamB')
  and nullif(btrim(player.user_id), '') is not null
on conflict (match_id, player_id) do nothing;

insert into public.match_attendance_entries (
  match_id, player_id, side, original_role, status, method, checked_in_at, first_registered_at, updated_at
)
select
  match.id,
  reserve.value,
  side.key,
  'reserve',
  case when coalesce(match.attendance -> side.key, '[]'::jsonb) ? reserve.value then 'on_time' else 'pending' end,
  case when coalesce(match.attendance -> side.key, '[]'::jsonb) ? reserve.value then 'operator' end,
  case when coalesce(match.attendance -> side.key, '[]'::jsonb) ? reserve.value
    then coalesce(match.started_at, match.updated_at, now()) end,
  coalesce(match.created_at, now()),
  coalesce(match.updated_at, now())
from public.matches match
cross join lateral jsonb_each(
  case when jsonb_typeof(match.reserve_players) = 'object' then match.reserve_players else '{}'::jsonb end
) side(key, value)
cross join lateral jsonb_array_elements_text(
  case when side.key in ('teamA', 'teamB') and jsonb_typeof(side.value) = 'array'
    then side.value else '[]'::jsonb end
) reserve(value)
where nullif(btrim(reserve.value), '') is not null
on conflict (match_id, player_id) do nothing;

create or replace function public.rankball_sync_match_active_attendance_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.side not in ('teamA', 'teamB') or nullif(btrim(new.user_id), '') is null then
    return new;
  end if;
  insert into public.match_attendance_entries (
    match_id, player_id, side, original_role, first_registered_at, updated_at
  )
  values (new.match_id, new.user_id, new.side, 'active', now(), now())
  on conflict (match_id, player_id) do update set
    side = excluded.side,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists sync_match_active_attendance_entry on public.match_players;
create trigger sync_match_active_attendance_entry
after insert or update of user_id, side on public.match_players
for each row execute function public.rankball_sync_match_active_attendance_entry();

create or replace function public.rankball_sync_match_reserve_attendance_entries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.match_attendance_entries (
    match_id, player_id, side, original_role, first_registered_at, updated_at
  )
  select new.id, reserve.value, side.key, 'reserve', now(), now()
  from jsonb_each(
    case when jsonb_typeof(new.reserve_players) = 'object' then new.reserve_players else '{}'::jsonb end
  ) side(key, value)
  cross join lateral jsonb_array_elements_text(
    case when side.key in ('teamA', 'teamB') and jsonb_typeof(side.value) = 'array'
      then side.value else '[]'::jsonb end
  ) reserve(value)
  where nullif(btrim(reserve.value), '') is not null
  on conflict (match_id, player_id) do update set
    side = excluded.side,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists sync_match_reserve_attendance_entries on public.matches;
create trigger sync_match_reserve_attendance_entries
after insert or update of reserve_players on public.matches
for each row execute function public.rankball_sync_match_reserve_attendance_entries();

create or replace function public.rankball_sync_match_operator_attendance_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  side_name text;
begin
  foreach side_name in array array['teamA', 'teamB'] loop
    update public.match_attendance_entries entry
    set status = case when new.started_at is null then 'on_time' else 'late' end,
        method = coalesce(entry.method, 'operator'),
        checked_in_at = coalesce(entry.checked_in_at, now()),
        updated_at = now()
    where entry.match_id = new.id
      and entry.side = side_name
      and entry.status in ('pending', 'no_show')
      and coalesce(new.attendance -> side_name, '[]'::jsonb) ? entry.player_id;
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_match_operator_attendance_status on public.matches;
create trigger sync_match_operator_attendance_status
after insert or update of attendance, started_at on public.matches
for each row execute function public.rankball_sync_match_operator_attendance_status();

create or replace function public.rankball_sync_match_play_intervals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  minimum_play_excluded jsonb := '[]'::jsonb;
  next_excluded jsonb := '[]'::jsonb;
  next_rules jsonb := '{}'::jsonb;
begin
  if new.started_at is not null
     and (case when tg_op = 'INSERT' then true else old.started_at is null end) then
    insert into public.match_play_intervals (match_id, player_id, side, started_at)
    select new.id, player.user_id, player.side, new.started_at
    from public.match_players player
    where player.match_id = new.id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    on conflict (match_id, player_id) where ended_at is null do nothing;
  end if;
  if new.ended_at is not null
     and (case when tg_op = 'INSERT' then true else old.ended_at is null end) then
    update public.match_play_intervals
    set ended_at = greatest(started_at, new.ended_at),
        updated_at = now()
    where match_id = new.id and ended_at is null;

    select coalesce(jsonb_agg(to_jsonb(player_id)), '[]'::jsonb)
    into minimum_play_excluded
    from (
      select event.player_id
      from (
        select
          active_in_player_id as player_id,
          max(minimum_meaningful_seconds) as minimum_seconds
        from public.match_substitution_events
        where match_id = new.id
        group by active_in_player_id
      ) event
      left join lateral (
        select coalesce(
          sum(extract(epoch from (coalesce(interval.ended_at, new.ended_at) - interval.started_at))),
          0
        ) as played_seconds
        from public.match_play_intervals interval
        where interval.match_id = new.id
          and interval.player_id = event.player_id
      ) play_time on true
      where play_time.played_seconds < event.minimum_seconds
    ) under_minimum;

    select coalesce(jsonb_agg(to_jsonb(player_id)), '[]'::jsonb)
    into next_excluded
    from (
      select distinct player_id
      from (
        select value as player_id
        from jsonb_array_elements_text(
          case when jsonb_typeof(new.mmr_excluded_player_ids) = 'array'
            then new.mmr_excluded_player_ids else '[]'::jsonb end
        ) current_excluded(value)
        union all
        select value as player_id
        from jsonb_array_elements_text(minimum_play_excluded) minimum_excluded(value)
      ) combined
      where nullif(btrim(player_id), '') is not null
    ) unique_excluded;

    next_rules := jsonb_set(
      jsonb_set(
        coalesce(new.rules, '{}'::jsonb),
        '{minimumPlayExcludedPlayerIds}',
        minimum_play_excluded,
        true
      ),
      '{mmrExcludedPlayerIds}',
      next_excluded,
      true
    );
    update public.matches
    set mmr_excluded_player_ids = next_excluded,
        rules = next_rules,
        updated_at = now()
    where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_match_play_intervals on public.matches;
create trigger sync_match_play_intervals
after insert or update of started_at, ended_at on public.matches
for each row execute function public.rankball_sync_match_play_intervals();

insert into public.match_play_intervals (match_id, player_id, side, started_at)
select match.id, player.user_id, player.side, match.started_at
from public.matches match
join public.match_players player on player.match_id = match.id
where match.started_at is not null
  and match.ended_at is null
  and player.side in ('teamA', 'teamB')
  and nullif(btrim(player.user_id), '') is not null
on conflict (match_id, player_id) where ended_at is null do nothing;

create or replace function public.rankball_match_attendance_qr_action(
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
  attendance_entry public.match_attendance_entries%rowtype;
  side_attendance jsonb;
  next_attendance jsonb;
  side_reserves jsonb;
  next_reserves jsonb;
  next_reserve_players jsonb;
  next_rules jsonb;
  scheduled_at_kst timestamptz;
  reserve_count integer;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.visibility <> 'public'
     or current_match.tournament_id is not null
     or coalesce(nullif(current_match.rules->>'recordType', ''), 'match') <> 'match'
     or lower(coalesce(current_match.rules->>'qrAttendanceEnabled', 'false')) <> 'true' then
    raise exception 'match_attendance_qr_disabled' using errcode = '23514';
  end if;
  if current_match.ended_at is not null
     or current_match.status not in ('contract', 'agreed')
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_attendance_qr_locked' using errcode = '23514';
  end if;

  select * into attendance_entry
  from public.match_attendance_entries entry
  where entry.match_id = safe_match_id
    and entry.player_id = safe_actor_id
  for update;
  if attendance_entry.player_id is null then
    raise exception 'match_attendance_player_not_registered' using errcode = '42501';
  end if;
  if attendance_entry.status in ('on_time', 'late') then
    return jsonb_build_object(
      'ok', true,
      'action', 'scanMatchAttendanceQr',
      'matchId', safe_match_id,
      'playerId', safe_actor_id,
      'sideName', attendance_entry.side,
      'attendanceStatus', attendance_entry.status,
      'alreadyCheckedIn', true
    );
  end if;

  if current_match.started_at is null
     and coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then
      raise exception 'match_schedule_required' using errcode = '23514';
    end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if now() < scheduled_at_kst - interval '10 minutes' then
      raise exception 'match_attendance_not_checkin_time' using errcode = '23514';
    end if;
  end if;

  side_attendance := case
    when jsonb_typeof(current_match.attendance -> attendance_entry.side) = 'array'
      then current_match.attendance -> attendance_entry.side
    else '[]'::jsonb
  end;
  if not (side_attendance ? safe_actor_id) then
    side_attendance := side_attendance || to_jsonb(safe_actor_id);
  end if;
  next_attendance := jsonb_set(
    case when jsonb_typeof(current_match.attendance) = 'object'
      then current_match.attendance else '{}'::jsonb end,
    array[attendance_entry.side],
    side_attendance,
    true
  );

  if current_match.started_at is null then
    update public.match_attendance_entries
    set status = 'on_time',
        method = 'qr',
        checked_in_at = now(),
        updated_at = now()
    where match_id = safe_match_id and player_id = safe_actor_id;
    update public.matches
    set attendance = next_attendance,
        updated_at = now()
    where id = safe_match_id;
    return jsonb_build_object(
      'ok', true,
      'action', 'scanMatchAttendanceQr',
      'matchId', safe_match_id,
      'playerId', safe_actor_id,
      'sideName', attendance_entry.side,
      'attendanceStatus', 'on_time',
      'reserveRegistered', attendance_entry.original_role = 'reserve'
    );
  end if;

  side_reserves := case
    when jsonb_typeof(current_match.reserve_players -> attendance_entry.side) = 'array'
      then current_match.reserve_players -> attendance_entry.side
    else '[]'::jsonb
  end;
  if not (side_reserves ? safe_actor_id) then
    reserve_count := jsonb_array_length(side_reserves);
    if reserve_count >= 3 then
      raise exception 'match_late_reserve_full' using errcode = '23514';
    end if;
    next_reserves := side_reserves || to_jsonb(safe_actor_id);
  else
    next_reserves := side_reserves;
  end if;
  next_reserve_players := jsonb_set(
    case when jsonb_typeof(current_match.reserve_players) = 'object'
      then current_match.reserve_players else '{}'::jsonb end,
    array[attendance_entry.side],
    next_reserves,
    true
  );
  next_rules := coalesce(current_match.rules, '{}'::jsonb) || jsonb_build_object(
    'benchCapacity',
    greatest(
      coalesce(nullif(current_match.rules->>'benchCapacity', '')::integer, 0),
      jsonb_array_length(next_reserves)
    ),
    'attendanceStatusUpdatedAt', now()
  );

  update public.match_attendance_entries
  set status = 'late',
      method = 'qr',
      checked_in_at = now(),
      updated_at = now()
  where match_id = safe_match_id and player_id = safe_actor_id;
  update public.matches
  set attendance = next_attendance,
      reserve_players = next_reserve_players,
      rules = next_rules,
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'scanMatchAttendanceQr',
    'matchId', safe_match_id,
    'playerId', safe_actor_id,
    'sideName', attendance_entry.side,
    'attendanceStatus', 'late',
    'reserveRegistered', true
  );
end;
$$;

create or replace function public.rankball_match_attendance_resize_action(
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
  attended_a text[] := array[]::text[];
  attended_b text[] := array[]::text[];
  active_a text[] := array[]::text[];
  active_b text[] := array[]::text[];
  reserve_a text[] := array[]::text[];
  reserve_b text[] := array[]::text[];
  player_team_ids jsonb := '{}'::jsonb;
  target_size integer := 0;
  current_side_size integer := 5;
  candidate_size integer;
  bench_capacity integer;
  next_mode text;
  next_reserves jsonb;
  next_attendance jsonb;
  next_recorders jsonb := '{}'::jsonb;
  next_rules jsonb;
  now_at timestamptz := now();
  scheduled_at_kst timestamptz;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null then
    raise exception 'match_id_required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
     and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
    raise exception 'match_attendance_resize_permission_denied' using errcode = '42501';
  end if;
  if current_match.visibility <> 'public'
     or current_match.tournament_id is not null
     or coalesce(nullif(current_match.rules->>'recordType', ''), 'match') <> 'match'
     or lower(coalesce(current_match.rules->>'qrAttendanceEnabled', 'false')) <> 'true' then
    raise exception 'match_attendance_qr_disabled' using errcode = '23514';
  end if;
  if current_match.started_at is not null
     or current_match.ended_at is not null
     or current_match.status not in ('contract', 'agreed')
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_attendance_resize_locked' using errcode = '23514';
  end if;
  if coalesce(current_match.rules->>'timingType', 'scheduled') <> 'instant' then
    if current_match.scheduled_date is null or current_match.scheduled_time is null then
      raise exception 'match_schedule_required' using errcode = '23514';
    end if;
    scheduled_at_kst := (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul';
    if now() < scheduled_at_kst - interval '10 minutes' then
      raise exception 'match_attendance_not_checkin_time' using errcode = '23514';
    end if;
  end if;
  current_side_size := case
    when coalesce(current_match.rules->>'sideCapacity', '') ~ '^[0-9]+$'
      then (current_match.rules->>'sideCapacity')::integer
    when coalesce(current_match.mode, '') ~ '^[0-9]+v[0-9]+$'
      then substring(current_match.mode from '^[0-9]+')::integer
    else 5
  end;

  select coalesce(jsonb_object_agg(player.user_id, to_jsonb(player.team_id)), '{}'::jsonb)
  into player_team_ids
  from public.match_players player
  where player.match_id = safe_match_id
    and nullif(btrim(player.user_id), '') is not null;

  select coalesce(array_agg(entry.player_id order by
    case when player.user_id is not null then 0 else 1 end,
    coalesce(player.slot_order, 999),
    entry.first_registered_at,
    entry.player_id
  ), array[]::text[])
  into attended_a
  from public.match_attendance_entries entry
  left join public.match_players player
    on player.match_id = entry.match_id and player.user_id = entry.player_id
  where entry.match_id = safe_match_id
    and entry.side = 'teamA'
    and entry.status in ('on_time', 'late');

  select coalesce(array_agg(entry.player_id order by
    case when player.user_id is not null then 0 else 1 end,
    coalesce(player.slot_order, 999),
    entry.first_registered_at,
    entry.player_id
  ), array[]::text[])
  into attended_b
  from public.match_attendance_entries entry
  left join public.match_players player
    on player.match_id = entry.match_id and player.user_id = entry.player_id
  where entry.match_id = safe_match_id
    and entry.side = 'teamB'
    and entry.status in ('on_time', 'late');

  foreach candidate_size in array array[5, 3, 2, 1] loop
    if candidate_size <= current_side_size
       and coalesce(array_length(attended_a, 1), 0) >= candidate_size
       and coalesce(array_length(attended_b, 1), 0) >= candidate_size
       and coalesce(array_length(attended_a, 1), 0) <= candidate_size + 3
       and coalesce(array_length(attended_b, 1), 0) <= candidate_size + 3 then
      target_size := candidate_size;
      exit;
    end if;
  end loop;
  if target_size = 0 then
    raise exception 'match_attendance_resize_unbalanced' using errcode = '23514';
  end if;

  active_a := attended_a[1:target_size];
  active_b := attended_b[1:target_size];
  reserve_a := coalesce(attended_a[target_size + 1:coalesce(array_length(attended_a, 1), 0)], array[]::text[]);
  reserve_b := coalesce(attended_b[target_size + 1:coalesce(array_length(attended_b, 1), 0)], array[]::text[]);
  bench_capacity := greatest(coalesce(array_length(reserve_a, 1), 0), coalesce(array_length(reserve_b, 1), 0));
  next_mode := target_size::text || 'v' || target_size::text;
  next_reserves := jsonb_build_object('teamA', to_jsonb(reserve_a), 'teamB', to_jsonb(reserve_b));
  next_attendance := jsonb_build_object('teamA', to_jsonb(attended_a), 'teamB', to_jsonb(attended_b));
  if coalesce(array_length(reserve_a, 1), 0) > 0 then
    next_recorders := jsonb_set(next_recorders, '{teamA}', to_jsonb(reserve_a[1]), true);
  end if;
  if coalesce(array_length(reserve_b, 1), 0) > 0 then
    next_recorders := jsonb_set(next_recorders, '{teamB}', to_jsonb(reserve_b[1]), true);
  end if;

  delete from public.match_players where match_id = safe_match_id;
  insert into public.match_players (match_id, team_id, user_id, side, slot_order)
  select
    safe_match_id,
    coalesce(nullif(player_team_ids->>player_id, ''), current_match.team_a_id),
    player_id,
    'teamA',
    ordinality::integer
  from unnest(active_a) with ordinality active(player_id, ordinality);
  insert into public.match_players (match_id, team_id, user_id, side, slot_order)
  select
    safe_match_id,
    coalesce(nullif(player_team_ids->>player_id, ''), current_match.team_b_id),
    player_id,
    'teamB',
    ordinality::integer
  from unnest(active_b) with ordinality active(player_id, ordinality);

  next_rules := coalesce(current_match.rules, '{}'::jsonb) || jsonb_build_object(
    'sideCapacity', target_size,
    'onCourtCount', target_size,
    'starterCount', target_size,
    'benchCapacity', bench_capacity,
    'teamCapacity', target_size + bench_capacity,
    'participantCapacity', (target_size + bench_capacity) * 2,
    'waitingPlayerCapacity', bench_capacity * 2,
    'statRecorders', next_recorders,
    'attendanceResize', jsonb_build_object(
      'fromMode', current_match.mode,
      'toMode', next_mode,
      'resizedAt', now_at,
      'resizedBy', safe_actor_id,
      'roomEditCountConsumed', false
    )
  );

  update public.match_attendance_entries
  set status = 'no_show',
      updated_at = now_at
  where match_id = safe_match_id and status = 'pending';

  update public.matches
  set mode = next_mode,
      reserve_players = next_reserves,
      attendance = next_attendance,
      stat_recorders = next_recorders,
      rules = next_rules,
      updated_at = now_at
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', 'resizeMatchForAttendance',
    'matchId', safe_match_id,
    'fromMode', current_match.mode,
    'toMode', next_mode,
    'sideCapacity', target_size,
    'benchCapacity', bench_capacity,
    'roomEditCountConsumed', false,
    'sqlReducer', true,
    'advisoryLocked', true
  );
end;
$$;

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
  result jsonb;
  current_match public.matches%rowtype;
  clock_period integer;
  clock_remaining_ms bigint;
  minimum_seconds integer;
  event_id uuid;
  now_at timestamptz := now();
begin
  if safe_reason not in ('late', 'injury', 'ejection', 'operator') then
    raise exception 'invalid_match_substitution_reason' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(coalesce(safe_match_id, '')));
  result := public.rankball_match_roster_move_action(
    safe_actor_id,
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

  insert into public.match_substitution_events (
    match_id, side, active_out_player_id, active_in_player_id, reason,
    confirmed_by, clock_period, clock_remaining_ms, minimum_meaningful_seconds, created_at
  )
  values (
    safe_match_id, safe_side, safe_active_player_id, safe_reserve_player_id, safe_reason,
    safe_actor_id, clock_period, clock_remaining_ms, minimum_seconds, now_at
  )
  returning id into event_id;

  update public.match_play_intervals
  set ended_at = greatest(started_at, now_at),
      updated_at = now_at
  where match_id = safe_match_id
    and player_id = safe_active_player_id
    and ended_at is null;
  insert into public.match_play_intervals (match_id, player_id, side, started_at)
  values (safe_match_id, safe_reserve_player_id, safe_side, now_at)
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
    'eventId', event_id,
    'reason', safe_reason,
    'minimumMeaningfulSeconds', minimum_seconds,
    'substitutionEventSaved', true
  );
end;
$$;

create or replace function public.rankball_match_postgame_roster_action(
  p_actor_profile_id text,
  p_action text,
  p_match_id text,
  p_player_id text default null,
  p_side text default null,
  p_anonymous_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_actor_id text := nullif(btrim(p_actor_profile_id), '');
  safe_action text := nullif(btrim(p_action), '');
  safe_match_id text := nullif(btrim(p_match_id), '');
  safe_player_id text := nullif(btrim(p_player_id), '');
  safe_side text := nullif(btrim(p_side), '');
  safe_anonymous_name text := nullif(btrim(p_anonymous_name), '');
  current_match public.matches%rowtype;
  current_played jsonb;
  current_reserve jsonb;
  current_anonymous jsonb;
  current_excluded jsonb;
  current_postgame_added jsonb;
  current_side_played jsonb;
  next_played jsonb;
  next_reserve jsonb;
  next_anonymous jsonb;
  next_excluded jsonb;
  next_postgame_added jsonb;
  next_rules jsonb;
  is_anonymous boolean := false;
begin
  perform public.rankball_assert_match_actor_active(safe_actor_id);
  if safe_match_id is null or safe_action not in ('addMatchLatePlayer', 'removeMatchLatePlayer') then
    raise exception 'invalid_postgame_roster_action' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));
  select * into current_match
  from public.matches
  where id = safe_match_id
  for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if safe_actor_id is distinct from nullif(btrim(current_match.created_by), '')
     and safe_actor_id is distinct from nullif(btrim(current_match.referee_id), '') then
    raise exception 'match_late_player_permission_denied' using errcode = '42501';
  end if;
  if current_match.status in ('approval', 'confirmed', 'void', 'cancelled', 'disputed')
     or current_match.ended_at is null
     or current_match.ended_at + make_interval(mins => greatest(1, coalesce(current_match.stat_entry_minutes, 60))) < now()
     or exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_late_player_locked' using errcode = '23514';
  end if;
  current_played := case
    when jsonb_typeof(current_match.played_player_ids) = 'object' then current_match.played_player_ids
    when jsonb_typeof(current_match.rules->'playedPlayerIds') = 'object' then current_match.rules->'playedPlayerIds'
    else '{}'::jsonb
  end;
  current_reserve := case
    when jsonb_typeof(current_match.reserve_players) = 'object' then current_match.reserve_players
    when jsonb_typeof(current_match.rules->'reservePlayers') = 'object' then current_match.rules->'reservePlayers'
    else '{}'::jsonb
  end;
  current_anonymous := case
    when jsonb_typeof(current_match.anonymous_players) = 'object' then current_match.anonymous_players
    else '{}'::jsonb
  end;
  current_excluded := case
    when jsonb_typeof(current_match.mmr_excluded_player_ids) = 'array' then current_match.mmr_excluded_player_ids
    when jsonb_typeof(current_match.rules->'mmrExcludedPlayerIds') = 'array' then current_match.rules->'mmrExcludedPlayerIds'
    else '[]'::jsonb
  end;
  current_postgame_added := case
    when jsonb_typeof(current_match.rules->'postgameAddedPlayerIds') = 'array'
      then current_match.rules->'postgameAddedPlayerIds'
    else '[]'::jsonb
  end;

  if safe_action = 'addMatchLatePlayer' then
    if safe_side not in ('teamA', 'teamB') then
      raise exception 'invalid_registered_late_player' using errcode = '22023';
    end if;
    if safe_player_id is null then
      if safe_anonymous_name is null or char_length(safe_anonymous_name) > 30 then
        raise exception 'anonymous_late_player_name_invalid' using errcode = '22023';
      end if;
      safe_player_id := 'anon_' || replace(gen_random_uuid()::text, '-', '');
      is_anonymous := true;
    elsif safe_anonymous_name is not null then
      raise exception 'ambiguous_late_player_identity' using errcode = '22023';
    elsif not exists (select 1 from public.profiles profile where profile.id = safe_player_id) then
      raise exception 'registered_late_player_not_found' using errcode = 'P0002';
    end if;

    if exists (
      select 1 from public.match_players player
      where player.match_id = safe_match_id and player.user_id = safe_player_id
    ) then
      raise exception 'late_player_still_active' using errcode = '23514';
    end if;
    if coalesce(current_played->'teamA', '[]'::jsonb) ? safe_player_id
       or coalesce(current_played->'teamB', '[]'::jsonb) ? safe_player_id then
      raise exception 'late_player_already_played' using errcode = '23514';
    end if;

    current_side_played := case
      when jsonb_typeof(current_played -> safe_side) = 'array' then current_played -> safe_side
      else '[]'::jsonb
    end;
    next_played := jsonb_set(
      current_played,
      array[safe_side],
      current_side_played || to_jsonb(safe_player_id),
      true
    );
    next_reserve := jsonb_build_object(
      'teamA',
      (
        select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_player_id), '[]'::jsonb)
        from jsonb_array_elements_text(
          case when jsonb_typeof(current_reserve->'teamA') = 'array'
            then current_reserve->'teamA' else '[]'::jsonb end
        ) reserve(value)
      ),
      'teamB',
      (
        select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_player_id), '[]'::jsonb)
        from jsonb_array_elements_text(
          case when jsonb_typeof(current_reserve->'teamB') = 'array'
            then current_reserve->'teamB' else '[]'::jsonb end
        ) reserve(value)
      )
    );
    next_excluded := case
      when current_excluded ? safe_player_id then current_excluded
      else current_excluded || to_jsonb(safe_player_id)
    end;
    next_postgame_added := case
      when current_postgame_added ? safe_player_id then current_postgame_added
      else current_postgame_added || to_jsonb(safe_player_id)
    end;
    next_anonymous := case
      when is_anonymous then jsonb_set(
        current_anonymous,
        array[safe_player_id],
        jsonb_build_object(
          'id', safe_player_id,
          'name', safe_anonymous_name,
          'position', 'free',
          'anonymous', true,
          'participationLabel', '경기 후 추가'
        ),
        true
      )
      else current_anonymous
    end;
  else
    if safe_player_id is null or not (current_postgame_added ? safe_player_id) then
      raise exception 'postgame_added_player_not_found' using errcode = 'P0002';
    end if;
    next_played := jsonb_set(
      jsonb_set(
        current_played,
        '{teamA}',
        (
          select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_player_id), '[]'::jsonb)
          from jsonb_array_elements_text(
            case when jsonb_typeof(current_played->'teamA') = 'array'
              then current_played->'teamA' else '[]'::jsonb end
          ) played(value)
        ),
        true
      ),
      '{teamB}',
      (
        select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_player_id), '[]'::jsonb)
        from jsonb_array_elements_text(
          case when jsonb_typeof(current_played->'teamB') = 'array'
            then current_played->'teamB' else '[]'::jsonb end
        ) played(value)
      ),
      true
    );
    next_reserve := current_reserve;
    select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_player_id), '[]'::jsonb)
    into next_excluded
    from jsonb_array_elements_text(current_excluded) excluded(value);
    select coalesce(jsonb_agg(to_jsonb(value)) filter (where value <> safe_player_id), '[]'::jsonb)
    into next_postgame_added
    from jsonb_array_elements_text(current_postgame_added) added(value);
    next_anonymous := current_anonymous - safe_player_id;
  end if;

  next_rules := coalesce(current_match.rules, '{}'::jsonb);
  next_rules := jsonb_set(next_rules, '{playedPlayerIds}', next_played, true);
  next_rules := jsonb_set(next_rules, '{reservePlayers}', next_reserve, true);
  next_rules := jsonb_set(next_rules, '{mmrExcludedPlayerIds}', next_excluded, true);
  next_rules := jsonb_set(next_rules, '{postgameAddedPlayerIds}', next_postgame_added, true);

  update public.matches
  set played_player_ids = next_played,
      reserve_players = next_reserve,
      anonymous_players = next_anonymous,
      mmr_excluded_player_ids = next_excluded,
      rules = next_rules,
      updated_at = now()
  where id = safe_match_id;

  return jsonb_build_object(
    'ok', true,
    'action', safe_action,
    'matchId', safe_match_id,
    'playerId', safe_player_id,
    'sideName', safe_side,
    'anonymous', is_anonymous,
    'mmrExcluded', safe_action = 'addMatchLatePlayer',
    'sqlReducer', true
  );
end;
$$;

do $migration$
begin
  if to_regprocedure('public.rankball_apply_room_rule_patch_pre_qr_attendance(jsonb,jsonb,text)') is null then
    alter function public.rankball_apply_room_rule_patch(jsonb, jsonb, text)
      rename to rankball_apply_room_rule_patch_pre_qr_attendance;
  end if;
end;
$migration$;

create or replace function public.rankball_apply_room_rule_patch(
  p_current_rules jsonb,
  p_patch jsonb,
  p_mode text
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  source_rules jsonb := coalesce(p_current_rules, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb);
  next_rules jsonb;
  game_clock_enabled boolean;
begin
  next_rules := public.rankball_apply_room_rule_patch_pre_qr_attendance(
    p_current_rules,
    p_patch,
    p_mode
  );
  game_clock_enabled := public.rankball_room_rule_boolean(source_rules, 'gameClockEnabled', true);
  return next_rules || jsonb_build_object(
    'gameClockEnabled', game_clock_enabled,
    'qrAttendanceEnabled',
      game_clock_enabled and public.rankball_room_rule_boolean(source_rules, 'qrAttendanceEnabled', false)
  );
end;
$$;

revoke all on function public.rankball_sync_match_active_attendance_entry() from public, anon, authenticated, service_role;
revoke all on function public.rankball_sync_match_reserve_attendance_entries() from public, anon, authenticated, service_role;
revoke all on function public.rankball_sync_match_operator_attendance_status() from public, anon, authenticated, service_role;
revoke all on function public.rankball_sync_match_play_intervals() from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_attendance_qr_action(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_attendance_resize_action(text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_substitution_action(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_match_postgame_roster_action(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_apply_room_rule_patch_pre_qr_attendance(jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.rankball_apply_room_rule_patch(jsonb, jsonb, text) from public, anon, authenticated, service_role;

grant execute on function public.rankball_match_attendance_qr_action(text, text) to service_role;
grant execute on function public.rankball_match_attendance_resize_action(text, text) to service_role;
grant execute on function public.rankball_match_substitution_action(text, text, text, text, text, text) to service_role;
grant execute on function public.rankball_match_postgame_roster_action(text, text, text, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
