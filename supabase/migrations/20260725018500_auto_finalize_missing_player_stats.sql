begin;

alter table public.player_match_stats
  drop constraint if exists player_match_stats_record_source_check;

alter table public.player_match_stats
  add constraint player_match_stats_record_source_check
  check (
    record_source in (
      'player',
      'referee',
      'candidate_recorder',
      'host_postgame',
      'dispute_operator',
      'auto_finalize'
    )
  ) not valid;

alter table public.player_match_stats
  validate constraint player_match_stats_record_source_check;

create or replace function public.rankball_match_auto_finalize_action(
  p_match_id text,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  now_at timestamptz := coalesce(p_now, now());
  current_match public.matches%rowtype;
  tournament_lock_id text;
  operator_id text;
begin
  if safe_match_id is null then
    raise exception 'missing_match' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:rating-policy'), hashtext('active'));
  select nullif(btrim(match.tournament_id), '') into tournament_lock_id
  from public.matches match where match.id = safe_match_id;
  if tournament_lock_id is not null then
    perform pg_advisory_xact_lock(hashtext('rankball:tournament'), hashtext(tournament_lock_id));
  end if;
  perform pg_advisory_xact_lock(hashtext('rankball:match'), hashtext(safe_match_id));

  select * into current_match from public.matches where id = safe_match_id for update;
  if current_match.id is null then raise exception 'match_not_found' using errcode = 'P0002'; end if;
  if current_match.status = 'confirmed' and current_match.rating_result is not null then
    return jsonb_build_object('ok', true, 'matchId', safe_match_id, 'alreadyConfirmed', true, 'ratingAtomic', true);
  end if;
  if current_match.status <> 'approval'
     or current_match.ended_at is null
     or current_match.dispute_draft_result is not null
     or current_match.confirmed_at is not null
     or current_match.rating_result is not null then
    raise exception 'match_auto_finalization_locked' using errcode = '23514';
  end if;
  if now_at <= current_match.ended_at + make_interval(mins => greatest(1, least(60, coalesce(current_match.dispute_minutes, 30)))) then
    raise exception 'match_auto_finalization_not_due' using errcode = '23514';
  end if;
  if not exists (select 1 from public.match_results result where result.match_id = safe_match_id) then
    raise exception 'match_result_missing' using errcode = '23514';
  end if;

  if exists (
    select 1
    from (
      select player.user_id, player.side
      from public.match_players player
      where player.match_id = safe_match_id
        and player.side in ('teamA', 'teamB')
        and nullif(btrim(player.user_id), '') is not null
        and not (
          (case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
            then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id
        )
      union
      select played.value, 'teamA'
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
          then current_match.played_player_ids->'teamA' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
      union
      select played.value, 'teamB'
      from jsonb_array_elements_text(
        case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
          then current_match.played_player_ids->'teamB' else '[]'::jsonb end
      ) played(value)
      where nullif(btrim(played.value), '') is not null
    ) actual_players
    group by user_id
    having count(distinct side) > 1
  ) then
    raise exception 'match_actual_roster_ambiguous' using errcode = '23514';
  end if;

  insert into public.match_approvals (match_id, user_id, side)
  select safe_match_id, actual_player.user_id, actual_player.side
  from (
    select player.user_id, player.side
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
      and not (
        (case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id
      )
    union
    select played.value, 'teamA'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value, 'teamB'
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  ) actual_player
  on conflict (match_id, user_id) do update set side = excluded.side;

  operator_id := coalesce(
    nullif(btrim(current_match.referee_id), ''),
    nullif(btrim(current_match.created_by), ''),
    (select player.user_id from public.match_players player where player.match_id = safe_match_id order by player.slot_order, player.user_id limit 1)
  );
  if operator_id is null then raise exception 'match_auto_finalization_operator_missing' using errcode = '23514'; end if;

  insert into public.player_match_stats (
    match_id,
    user_id,
    recorded_by,
    record_source,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    fouls,
    updated_at
  )
  select
    safe_match_id,
    actual_player.user_id,
    operator_id,
    'auto_finalize',
    0,
    0,
    0,
    0,
    0,
    0,
    now_at
  from (
    select player.user_id
    from public.match_players player
    where player.match_id = safe_match_id
      and player.side in ('teamA', 'teamB')
      and nullif(btrim(player.user_id), '') is not null
      and not (
        (case when jsonb_typeof(current_match.reserve_players -> (player.side)) = 'array'
          then current_match.reserve_players -> (player.side) else '[]'::jsonb end) ? player.user_id
      )
    union
    select played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamA') = 'array'
        then current_match.played_player_ids->'teamA' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
    union
    select played.value
    from jsonb_array_elements_text(
      case when jsonb_typeof(current_match.played_player_ids->'teamB') = 'array'
        then current_match.played_player_ids->'teamB' else '[]'::jsonb end
    ) played(value)
    where nullif(btrim(played.value), '') is not null
  ) actual_player
  on conflict (match_id, user_id) do nothing;

  return public.rankball_match_finalize_locked(operator_id, safe_match_id, 'autoConfirmMatch');
end;
$$;

revoke all on function public.rankball_match_auto_finalize_action(text, timestamptz)
from public, anon, authenticated;
grant execute on function public.rankball_match_auto_finalize_action(text, timestamptz)
to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
