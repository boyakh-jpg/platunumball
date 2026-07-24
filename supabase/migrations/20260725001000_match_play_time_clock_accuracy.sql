-- Measure substituted-player participation with active game-clock time.

alter table public.match_substitution_events
  add column if not exists clock_active_elapsed_ms bigint;

alter table public.match_play_intervals
  add column if not exists started_active_elapsed_ms bigint;

alter table public.match_play_intervals
  add column if not exists ended_active_elapsed_ms bigint;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.match_substitution_events'::regclass
      and conname = 'match_substitution_events_clock_elapsed_check'
  ) then
    alter table public.match_substitution_events
      add constraint match_substitution_events_clock_elapsed_check
      check (clock_active_elapsed_ms is null or clock_active_elapsed_ms >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.match_play_intervals'::regclass
      and conname = 'match_play_intervals_clock_elapsed_check'
  ) then
    alter table public.match_play_intervals
      add constraint match_play_intervals_clock_elapsed_check
      check (
        (started_active_elapsed_ms is null or started_active_elapsed_ms >= 0)
        and (ended_active_elapsed_ms is null or ended_active_elapsed_ms >= 0)
        and (
          started_active_elapsed_ms is null
          or ended_active_elapsed_ms is null
          or ended_active_elapsed_ms >= started_active_elapsed_ms
        )
      );
  end if;
end;
$migration$;

create or replace function public.rankball_match_clock_effective_elapsed_ms(
  p_match_id text,
  p_at timestamptz default now()
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select
    session.active_elapsed_ms
    + case
        when session.status = 'running' and session.last_resumed_at is not null then
          least(
            session.period_remaining_ms,
            greatest(
              0,
              floor(
                extract(epoch from (coalesce(p_at, now()) - session.last_resumed_at)) * 1000
              )::bigint
            )
          )
        else 0
      end
  from public.match_clock_sessions session
  where session.match_id = nullif(btrim(p_match_id), '')
  limit 1
$$;

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
  start_active_elapsed_ms bigint;
  end_active_elapsed_ms bigint;
begin
  if new.started_at is not null
     and (case when tg_op = 'INSERT' then true else old.started_at is null end) then
    start_active_elapsed_ms := public.rankball_match_clock_effective_elapsed_ms(new.id, new.started_at);
    insert into public.match_play_intervals (
      match_id,
      player_id,
      side,
      started_at,
      started_active_elapsed_ms
    )
    select
      new.id,
      player.user_id,
      player.side,
      new.started_at,
      start_active_elapsed_ms
    from public.match_players player
    where player.match_id = new.id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
    on conflict (match_id, player_id) where ended_at is null do nothing;
  end if;

  if new.ended_at is not null
     and (case when tg_op = 'INSERT' then true else old.ended_at is null end) then
    end_active_elapsed_ms := public.rankball_match_clock_effective_elapsed_ms(new.id, new.ended_at);
    update public.match_play_intervals
    set ended_at = greatest(started_at, new.ended_at),
        ended_active_elapsed_ms = case
          when end_active_elapsed_ms is null then ended_active_elapsed_ms
          when started_active_elapsed_ms is null then end_active_elapsed_ms
          else greatest(started_active_elapsed_ms, end_active_elapsed_ms)
        end,
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
          sum(
            case
              when play_interval.started_active_elapsed_ms is not null
                   and coalesce(
                     play_interval.ended_active_elapsed_ms,
                     end_active_elapsed_ms
                   ) is not null then
                greatest(
                  0,
                  coalesce(
                    play_interval.ended_active_elapsed_ms,
                    end_active_elapsed_ms
                  ) - play_interval.started_active_elapsed_ms
                )::numeric / 1000
              else
                extract(
                  epoch from (
                    coalesce(play_interval.ended_at, new.ended_at)
                    - play_interval.started_at
                  )
                )
            end
          ),
          0
        ) as played_seconds
        from public.match_play_intervals play_interval
        where play_interval.match_id = new.id
          and play_interval.player_id = event.player_id
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
  clock_active_elapsed_ms bigint;
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
    'eventId', event_id,
    'reason', safe_reason,
    'clockActiveElapsedMs', clock_active_elapsed_ms,
    'minimumMeaningfulSeconds', minimum_seconds,
    'substitutionEventSaved', true
  );
end;
$$;

revoke all on function public.rankball_match_clock_effective_elapsed_ms(text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_sync_match_play_intervals()
  from public, anon, authenticated, service_role;
revoke all on function public.rankball_match_substitution_action(text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.rankball_match_substitution_action(text, text, text, text, text, text)
  to service_role;
