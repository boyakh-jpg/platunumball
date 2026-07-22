-- Keep completed records queryable while separating long-lived facts from
-- transient approval workflow rows. Core match/result/stat rows are retained
-- until every rating, tournament, achievement, and review consumer is archive-aware.

create table if not exists public.match_record_archives (
  -- Deliberately independent from matches: a later verified core-row cleanup
  -- must not cascade-delete the historical record bundle.
  match_id text primary key,
  archive_version smallint not null default 1 check (archive_version > 0),
  record_date date not null,
  occurred_at timestamptz not null,
  confirmed_at timestamptz,
  is_active boolean not null default true,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  workflow_compacted_at timestamptz
);

create index if not exists match_record_archives_active_date_idx
  on public.match_record_archives (record_date desc, occurred_at desc, match_id)
  where is_active;

create table if not exists public.match_record_participants (
  match_id text not null references public.match_record_archives(match_id) on delete cascade,
  profile_id text not null,
  record_date date not null,
  occurred_at timestamptz not null,
  side text not null,
  title text not null default '',
  mode text,
  court_id text,
  court_name text,
  team_id text,
  team_name text,
  opponent_team_id text,
  opponent_team_name text,
  score_for integer not null default 0,
  score_against integer not null default 0,
  outcome text not null check (outcome in ('win', 'loss', 'draw')),
  ranked boolean not null default false,
  tournament_id text,
  position text,
  stats jsonb not null default '{}'::jsonb check (jsonb_typeof(stats) = 'object'),
  primary key (match_id, profile_id)
);

create index if not exists match_record_participants_profile_date_idx
  on public.match_record_participants (profile_id, record_date desc, occurred_at desc, match_id);

create index if not exists match_record_participants_team_date_idx
  on public.match_record_participants (team_id, record_date desc, occurred_at desc, match_id)
  where team_id is not null;

create table if not exists public.match_record_teams (
  match_id text not null references public.match_record_archives(match_id) on delete cascade,
  team_id text not null,
  record_date date not null,
  occurred_at timestamptz not null,
  side text not null,
  title text not null default '',
  mode text,
  court_id text,
  court_name text,
  team_name text,
  opponent_team_id text,
  opponent_team_name text,
  score_for integer not null default 0,
  score_against integer not null default 0,
  outcome text not null check (outcome in ('win', 'loss', 'draw')),
  ranked boolean not null default false,
  tournament_id text,
  visibility text not null default 'public',
  reader_ids text[] not null default array[]::text[],
  primary key (match_id, team_id)
);

create index if not exists match_record_teams_team_date_idx
  on public.match_record_teams (team_id, record_date desc, occurred_at desc, match_id);

create table if not exists public.match_record_refresh_queue (
  match_id text primary key,
  queued_at timestamptz not null default now()
);

alter table public.match_record_archives enable row level security;
alter table public.match_record_participants enable row level security;
alter table public.match_record_teams enable row level security;
alter table public.match_record_refresh_queue enable row level security;

revoke all on public.match_record_archives from public, anon, authenticated;
revoke all on public.match_record_participants from public, anon, authenticated;
revoke all on public.match_record_teams from public, anon, authenticated;
revoke all on public.match_record_refresh_queue from public, anon, authenticated;
grant all on public.match_record_archives to service_role;
grant all on public.match_record_participants to service_role;
grant all on public.match_record_teams to service_role;
grant all on public.match_record_refresh_queue to service_role;

create or replace function public.rankball_record_detail_cutoff(
  p_reference timestamptz default now()
)
returns date
language sql
stable
set search_path = public
as $$
  select (
    (coalesce(p_reference, now()) at time zone 'Asia/Seoul')::date
    - interval '6 months'
  )::date;
$$;

create or replace function public.rankball_record_list_cutoff(
  p_reference timestamptz default now()
)
returns date
language sql
stable
set search_path = public
as $$
  select (
    (coalesce(p_reference, now()) at time zone 'Asia/Seoul')::date
    - interval '5 years'
  )::date;
$$;

revoke all on function public.rankball_record_detail_cutoff(timestamptz) from public, anon, authenticated;
revoke all on function public.rankball_record_list_cutoff(timestamptz) from public, anon, authenticated;
grant execute on function public.rankball_record_detail_cutoff(timestamptz) to service_role;
grant execute on function public.rankball_record_list_cutoff(timestamptz) to service_role;

create or replace function public.rankball_match_player_is_record_participant(
  p_played_player_ids jsonb,
  p_reserve_players jsonb,
  p_side text,
  p_profile_id text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  with normalized as (
    select
      case when lower(coalesce(nullif(btrim(p_side), ''), 'teamA')) in ('teamb', 'b')
        then 'teamB'
        else 'teamA'
      end as side_key,
      nullif(btrim(p_profile_id), '') as profile_id
  ), source as (
    select
      normalized.profile_id,
      case
        when jsonb_typeof(coalesce(p_played_player_ids, '{}'::jsonb) -> normalized.side_key) = 'array'
          then coalesce(p_played_player_ids, '{}'::jsonb) -> normalized.side_key
        else '[]'::jsonb
      end as played_ids,
      case
        when jsonb_typeof(coalesce(p_reserve_players, '{}'::jsonb) -> normalized.side_key) = 'array'
          then coalesce(p_reserve_players, '{}'::jsonb) -> normalized.side_key
        else '[]'::jsonb
      end as reserve_ids
    from normalized
  )
  select coalesce(
    profile_id is not null
    and ((played_ids ? profile_id) or not (reserve_ids ? profile_id)),
    false
  )
  from source;
$$;

revoke all on function public.rankball_match_player_is_record_participant(jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.rankball_match_player_is_record_participant(jsonb, jsonb, text, text)
  to service_role;

create or replace function public.rankball_match_record_reader_ids(p_match_id text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  with actor_ids(profile_id) as (
    select match_row.created_by from public.matches match_row where match_row.id = p_match_id
    union all
    select match_row.referee_id from public.matches match_row where match_row.id = p_match_id
    union all
    select match_row.former_referee_id from public.matches match_row where match_row.id = p_match_id
    union all
    select match_row.rules->>'tournamentOrganizerId' from public.matches match_row where match_row.id = p_match_id
    union all
    select player_row.user_id from public.match_players player_row where player_row.match_id = p_match_id
    union all
    select agreement_row.user_id from public.match_agreements agreement_row where agreement_row.match_id = p_match_id
    union all
    select approval_row.user_id from public.match_approvals approval_row where approval_row.match_id = p_match_id
    union all
    select dispute_row.user_id from public.match_disputes dispute_row where dispute_row.match_id = p_match_id
    union all
    select player_id.value
    from public.matches match_row
    cross join lateral (
      values
        (match_row.played_player_ids->'teamA'),
        (match_row.played_player_ids->'teamB'),
        (match_row.reserve_players->'teamA'),
        (match_row.reserve_players->'teamB'),
        (match_row.rules #> '{playedPlayerIds,teamA}'),
        (match_row.rules #> '{playedPlayerIds,teamB}'),
        (match_row.rules #> '{reservePlayers,teamA}'),
        (match_row.rules #> '{reservePlayers,teamB}')
    ) source(raw_ids)
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(source.raw_ids) = 'array' then source.raw_ids else '[]'::jsonb end
    ) player_id(value)
    where match_row.id = p_match_id
    union all
    select recorder.value
    from public.matches match_row
    cross join lateral (
      values (match_row.stat_recorders), (match_row.rules->'statRecorders')
    ) source(raw_recorders)
    cross join lateral jsonb_each_text(
      case when jsonb_typeof(source.raw_recorders) = 'object' then source.raw_recorders else '{}'::jsonb end
    ) recorder(side, value)
    where match_row.id = p_match_id
  )
  select coalesce(
    array_agg(distinct btrim(profile_id) order by btrim(profile_id))
      filter (where nullif(btrim(profile_id), '') is not null),
    array[]::text[]
  )
  from actor_ids;
$$;

revoke all on function public.rankball_match_record_reader_ids(text) from public, anon, authenticated;
grant execute on function public.rankball_match_record_reader_ids(text) to service_role;

create or replace function public.rankball_merge_archived_rows(
  p_existing jsonb,
  p_current jsonb,
  p_key text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  with candidates as (
    select item, 0 as source_priority
    from jsonb_array_elements(
      case when jsonb_typeof(p_current) = 'array' then p_current else '[]'::jsonb end
    ) current_row(item)
    union all
    select item, 1
    from jsonb_array_elements(
      case when jsonb_typeof(p_existing) = 'array' then p_existing else '[]'::jsonb end
    ) existing_row(item)
  ), selected as (
    select distinct on (coalesce(nullif(item->>p_key, ''), md5(item::text))) item
    from candidates
    order by coalesce(nullif(item->>p_key, ''), md5(item::text)), source_priority
  )
  select coalesce(jsonb_agg(item order by coalesce(nullif(item->>p_key, ''), md5(item::text))), '[]'::jsonb)
  from selected;
$$;

revoke all on function public.rankball_merge_archived_rows(jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.rankball_merge_archived_rows(jsonb, jsonb, text)
  to service_role;

create or replace function public.rankball_refresh_match_record_archive(p_match_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  current_match public.matches%rowtype;
  current_result public.match_results%rowtype;
  match_occurred_at timestamptz;
  match_record_date date;
  result_score_a integer := 0;
  result_score_b integer := 0;
  players_payload jsonb := '[]'::jsonb;
  result_payload jsonb := '{}'::jsonb;
  stats_payload jsonb := '[]'::jsonb;
  agreements_payload jsonb := '[]'::jsonb;
  approvals_payload jsonb := '[]'::jsonb;
  disputes_payload jsonb := '[]'::jsonb;
  teams_payload jsonb := '[]'::jsonb;
  archive_payload jsonb;
  existing_archive_payload jsonb := '{}'::jsonb;
  existing_workflow_compacted_at timestamptz;
begin
  if safe_match_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('rankball:match-record-archive'), hashtext(safe_match_id));

  select *
  into current_match
  from public.matches
  where id = safe_match_id;

  if not found then
    return false;
  end if;

  if current_match.status is distinct from 'confirmed' then
    update public.match_record_archives
    set is_active = false,
        source_updated_at = current_match.updated_at,
        updated_at = now()
    where match_id = safe_match_id;

    delete from public.match_record_participants where match_id = safe_match_id;
    delete from public.match_record_teams where match_id = safe_match_id;
    return false;
  end if;

  select payload, workflow_compacted_at
  into existing_archive_payload, existing_workflow_compacted_at
  from public.match_record_archives
  where match_id = safe_match_id;

  if not found then
    existing_archive_payload := '{}'::jsonb;
    existing_workflow_compacted_at := null;
  end if;

  match_occurred_at := coalesce(
    current_match.confirmed_at,
    current_match.ended_at,
    current_match.started_at,
    case
      when current_match.scheduled_date is not null and current_match.scheduled_time is not null
        then (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul'
      when current_match.scheduled_date is not null
        then current_match.scheduled_date::timestamp at time zone 'Asia/Seoul'
      else null
    end,
    current_match.created_at,
    now()
  );
  match_record_date := coalesce(
    current_match.scheduled_date,
    (match_occurred_at at time zone 'Asia/Seoul')::date
  );

  select *
  into current_result
  from public.match_results
  where match_id = safe_match_id
  order by submitted_at desc nulls last
  limit 1;

  if found then
    result_payload := to_jsonb(current_result);
    result_score_a := coalesce(current_result.score_a, current_match.score_a, 0);
    result_score_b := coalesce(current_result.score_b, current_match.score_b, 0);
  else
    result_score_a := coalesce(current_match.score_a, 0);
    result_score_b := coalesce(current_match.score_b, 0);
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(player_row) order by player_row.slot_order nulls last, player_row.user_id),
    '[]'::jsonb
  )
  into players_payload
  from public.match_players player_row
  where player_row.match_id = safe_match_id;

  select coalesce(
    jsonb_agg(to_jsonb(stat_row) order by stat_row.user_id),
    '[]'::jsonb
  )
  into stats_payload
  from public.player_match_stats stat_row
  where stat_row.match_id = safe_match_id;

  select coalesce(
    jsonb_agg(to_jsonb(agreement_row) order by agreement_row.user_id),
    '[]'::jsonb
  )
  into agreements_payload
  from public.match_agreements agreement_row
  where agreement_row.match_id = safe_match_id;

  select coalesce(
    jsonb_agg(to_jsonb(approval_row) order by approval_row.user_id),
    '[]'::jsonb
  )
  into approvals_payload
  from public.match_approvals approval_row
  where approval_row.match_id = safe_match_id;

  select coalesce(
    jsonb_agg(to_jsonb(dispute_row) order by dispute_row.created_at, dispute_row.id),
    '[]'::jsonb
  )
  into disputes_payload
  from public.match_disputes dispute_row
  where dispute_row.match_id = safe_match_id;

  select coalesce(jsonb_agg(to_jsonb(team_row) order by team_row.id), '[]'::jsonb)
  into teams_payload
  from public.teams team_row
  where team_row.id in (
    nullif(btrim(current_match.team_a_id), ''),
    nullif(btrim(current_match.team_b_id), '')
  );

  if existing_workflow_compacted_at is not null then
    agreements_payload := public.rankball_merge_archived_rows(
      existing_archive_payload->'agreements',
      agreements_payload,
      'user_id'
    );
    approvals_payload := public.rankball_merge_archived_rows(
      existing_archive_payload->'approvals',
      approvals_payload,
      'user_id'
    );
    disputes_payload := public.rankball_merge_archived_rows(
      existing_archive_payload->'disputes',
      disputes_payload,
      'id'
    );
  end if;

  archive_payload := jsonb_build_object(
    'match', to_jsonb(current_match),
    'players', players_payload,
    'result', result_payload,
    'stats', stats_payload,
    'agreements', agreements_payload,
    'approvals', approvals_payload,
    'disputes', disputes_payload,
    'teams', teams_payload
  );

  insert into public.match_record_archives (
    match_id,
    archive_version,
    record_date,
    occurred_at,
    confirmed_at,
    is_active,
    payload,
    source_updated_at,
    updated_at
  ) values (
    safe_match_id,
    1,
    match_record_date,
    match_occurred_at,
    current_match.confirmed_at,
    true,
    archive_payload,
    current_match.updated_at,
    now()
  )
  on conflict (match_id) do update set
    archive_version = excluded.archive_version,
    record_date = excluded.record_date,
    occurred_at = excluded.occurred_at,
    confirmed_at = excluded.confirmed_at,
    is_active = true,
    payload = excluded.payload,
    source_updated_at = excluded.source_updated_at,
    updated_at = now();

  delete from public.match_record_participants where match_id = safe_match_id;

  with ranked_players as (
    select
      player_row.*,
      row_number() over (
        partition by player_row.user_id
        order by player_row.slot_order nulls last, player_row.side, player_row.team_id
      ) as record_rank
    from public.match_players player_row
    where player_row.match_id = safe_match_id
      and nullif(btrim(player_row.user_id), '') is not null
      and public.rankball_match_player_is_record_participant(
        current_match.played_player_ids,
        current_match.reserve_players,
        player_row.side,
        player_row.user_id
      )
  ), normalized_players as (
    select
      player_row.*,
      case
        when lower(coalesce(nullif(player_row.side, ''), 'teamA')) in ('teamb', 'b') then 'teamB'
        else 'teamA'
      end as normalized_side,
      coalesce(
        case
          when lower(coalesce(nullif(player_row.side, ''), 'teamA')) in ('teamb', 'b')
            then nullif(btrim(current_match.team_b_id), '')
          else nullif(btrim(current_match.team_a_id), '')
        end,
        nullif(btrim(player_row.team_id), '')
      ) as record_team_id,
      case
        when lower(coalesce(nullif(player_row.side, ''), 'teamA')) in ('teamb', 'b')
          then nullif(btrim(current_match.team_a_id), '')
        else nullif(btrim(current_match.team_b_id), '')
      end as record_opponent_team_id
    from ranked_players player_row
    where player_row.record_rank = 1
  )
  insert into public.match_record_participants (
    match_id,
    profile_id,
    record_date,
    occurred_at,
    side,
    title,
    mode,
    court_id,
    court_name,
    team_id,
    team_name,
    opponent_team_id,
    opponent_team_name,
    score_for,
    score_against,
    outcome,
    ranked,
    tournament_id,
    position,
    stats
  )
  select
    safe_match_id,
    player_row.user_id,
    match_record_date,
    match_occurred_at,
    player_row.normalized_side,
    coalesce(current_match.title, ''),
    current_match.mode,
    current_match.court_id,
    current_match.court_name,
    player_row.record_team_id,
    coalesce(
      own_team.name,
      case
        when player_row.normalized_side = 'teamB'
          then nullif(btrim(current_match.rules #>> '{recordSummary,teamBName}'), '')
        else nullif(btrim(current_match.rules #>> '{recordSummary,teamAName}'), '')
      end
    ),
    player_row.record_opponent_team_id,
    coalesce(
      opponent_team.name,
      case
        when player_row.normalized_side = 'teamB'
          then nullif(btrim(current_match.rules #>> '{recordSummary,teamAName}'), '')
        else nullif(btrim(current_match.rules #>> '{recordSummary,teamBName}'), '')
      end
    ),
    case when player_row.normalized_side = 'teamB' then result_score_b else result_score_a end,
    case when player_row.normalized_side = 'teamB' then result_score_a else result_score_b end,
    case
      when result_score_a = result_score_b then 'draw'
      when player_row.normalized_side = 'teamB' and result_score_b > result_score_a then 'win'
      when player_row.normalized_side = 'teamA' and result_score_a > result_score_b then 'win'
      else 'loss'
    end,
    coalesce(current_match.ranked, false),
    nullif(btrim(current_match.tournament_id), ''),
    player_row.position,
    coalesce(to_jsonb(stat_row) - 'match_id' - 'user_id', '{}'::jsonb)
  from normalized_players player_row
  left join public.teams own_team on own_team.id = player_row.record_team_id
  left join public.teams opponent_team on opponent_team.id = player_row.record_opponent_team_id
  left join lateral (
    select stat.*
    from public.player_match_stats stat
    where stat.match_id = safe_match_id
      and stat.user_id = player_row.user_id
    order by stat.updated_at desc nulls last
    limit 1
  ) stat_row on true;

  delete from public.match_record_teams where match_id = safe_match_id;

  with team_sides as (
    select
      'teamA'::text as side,
      nullif(btrim(current_match.team_a_id), '') as team_id,
      nullif(btrim(current_match.team_b_id), '') as opponent_team_id,
      result_score_a as score_for,
      result_score_b as score_against
    union all
    select
      'teamB'::text,
      nullif(btrim(current_match.team_b_id), ''),
      nullif(btrim(current_match.team_a_id), ''),
      result_score_b,
      result_score_a
  ), unique_teams as (
    select distinct on (team_id) *
    from team_sides
    where team_id is not null
    order by team_id, side
  )
  insert into public.match_record_teams (
    match_id,
    team_id,
    record_date,
    occurred_at,
    side,
    title,
    mode,
    court_id,
    court_name,
    team_name,
    opponent_team_id,
    opponent_team_name,
    score_for,
    score_against,
    outcome,
    ranked,
    tournament_id,
    visibility,
    reader_ids
  )
  select
    safe_match_id,
    team_side.team_id,
    match_record_date,
    match_occurred_at,
    team_side.side,
    coalesce(current_match.title, ''),
    current_match.mode,
    current_match.court_id,
    current_match.court_name,
    coalesce(
      own_team.name,
      case
        when team_side.side = 'teamB'
          then nullif(btrim(current_match.rules #>> '{recordSummary,teamBName}'), '')
        else nullif(btrim(current_match.rules #>> '{recordSummary,teamAName}'), '')
      end
    ),
    team_side.opponent_team_id,
    coalesce(
      opponent_team.name,
      case
        when team_side.side = 'teamB'
          then nullif(btrim(current_match.rules #>> '{recordSummary,teamAName}'), '')
        else nullif(btrim(current_match.rules #>> '{recordSummary,teamBName}'), '')
      end
    ),
    team_side.score_for,
    team_side.score_against,
    case
      when team_side.score_for = team_side.score_against then 'draw'
      when team_side.score_for > team_side.score_against then 'win'
      else 'loss'
    end,
    coalesce(current_match.ranked, false),
    nullif(btrim(current_match.tournament_id), ''),
    case when lower(coalesce(current_match.visibility, current_match.rules->>'visibility', 'public')) = 'private'
      then 'private'
      else 'public'
    end,
    public.rankball_match_record_reader_ids(safe_match_id)
  from unique_teams team_side
  left join public.teams own_team on own_team.id = team_side.team_id
  left join public.teams opponent_team on opponent_team.id = team_side.opponent_team_id;

  return true;
end;
$$;

revoke all on function public.rankball_refresh_match_record_archive(text) from public, anon, authenticated;
grant execute on function public.rankball_refresh_match_record_archive(text) to service_role;

create or replace function public.rankball_match_record_archive_is_complete(p_match_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_match_id text := nullif(btrim(p_match_id), '');
  expected_profile_count integer := 0;
  indexed_profile_count integer := 0;
  expected_team_count integer := 0;
  indexed_team_count integer := 0;
  archive_payload jsonb;
  archive_active boolean := false;
begin
  if safe_match_id is null then
    return false;
  end if;

  select payload, is_active
  into archive_payload, archive_active
  from public.match_record_archives
  where match_id = safe_match_id;

  if not found or not archive_active then
    return false;
  end if;

  select count(distinct nullif(btrim(player_row.user_id), ''))::integer
  into expected_profile_count
  from public.match_players player_row
  join public.matches match_row on match_row.id = player_row.match_id
  where player_row.match_id = safe_match_id
    and nullif(btrim(player_row.user_id), '') is not null
    and public.rankball_match_player_is_record_participant(
      match_row.played_player_ids,
      match_row.reserve_players,
      player_row.side,
      player_row.user_id
    );

  select count(*)::integer
  into indexed_profile_count
  from public.match_record_participants
  where match_id = safe_match_id;

  select count(distinct team_id)::integer
  into expected_team_count
  from (
    select nullif(btrim(team_a_id), '') as team_id from public.matches where id = safe_match_id
    union
    select nullif(btrim(team_b_id), '') from public.matches where id = safe_match_id
  ) team_ids
  where team_id is not null;

  select count(*)::integer
  into indexed_team_count
  from public.match_record_teams
  where match_id = safe_match_id;

  return coalesce(archive_payload->'match'->>'id', '') = safe_match_id
    and jsonb_typeof(archive_payload->'players') = 'array'
    and jsonb_typeof(archive_payload->'result') = 'object'
    and jsonb_typeof(archive_payload->'stats') = 'array'
    and jsonb_typeof(archive_payload->'agreements') = 'array'
    and jsonb_typeof(archive_payload->'approvals') = 'array'
    and jsonb_typeof(archive_payload->'disputes') = 'array'
    and jsonb_typeof(archive_payload->'teams') = 'array'
    and indexed_profile_count = expected_profile_count
    and indexed_team_count = expected_team_count;
end;
$$;

revoke all on function public.rankball_match_record_archive_is_complete(text) from public, anon, authenticated;
grant execute on function public.rankball_match_record_archive_is_complete(text) to service_role;

create or replace function public.rankball_match_record_archive_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_match_id text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  target_match_id := case
    when tg_table_name = 'matches' then to_jsonb(new)->>'id'
    else to_jsonb(new)->>'match_id'
  end;

  insert into public.match_record_refresh_queue (match_id, queued_at)
  values (target_match_id, now())
  on conflict (match_id) do update set queued_at = excluded.queued_at;
  return new;
end;
$$;

revoke all on function public.rankball_match_record_archive_trigger() from public, anon, authenticated;
grant execute on function public.rankball_match_record_archive_trigger() to service_role;

create or replace function public.rankball_process_match_record_refresh_queue_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.match_record_refresh_queue where match_id = new.match_id;
  perform public.rankball_refresh_match_record_archive(new.match_id);
  return new;
end;
$$;

revoke all on function public.rankball_process_match_record_refresh_queue_trigger()
  from public, anon, authenticated;
grant execute on function public.rankball_process_match_record_refresh_queue_trigger()
  to service_role;

drop trigger if exists rankball_match_record_refresh_queue_flush on public.match_record_refresh_queue;
create constraint trigger rankball_match_record_refresh_queue_flush
after insert on public.match_record_refresh_queue
deferrable initially deferred
for each row execute function public.rankball_process_match_record_refresh_queue_trigger();

drop trigger if exists rankball_match_record_archive_matches_refresh on public.matches;
create trigger rankball_match_record_archive_matches_refresh
after insert or update on public.matches
for each row execute function public.rankball_match_record_archive_trigger();

drop trigger if exists rankball_match_record_archive_players_refresh on public.match_players;
create trigger rankball_match_record_archive_players_refresh
after insert or update on public.match_players
for each row execute function public.rankball_match_record_archive_trigger();

drop trigger if exists rankball_match_record_archive_results_refresh on public.match_results;
create trigger rankball_match_record_archive_results_refresh
after insert or update on public.match_results
for each row execute function public.rankball_match_record_archive_trigger();

drop trigger if exists rankball_match_record_archive_stats_refresh on public.player_match_stats;
create trigger rankball_match_record_archive_stats_refresh
after insert or update on public.player_match_stats
for each row execute function public.rankball_match_record_archive_trigger();

drop trigger if exists rankball_match_record_archive_agreements_refresh on public.match_agreements;
create trigger rankball_match_record_archive_agreements_refresh
after insert or update on public.match_agreements
for each row execute function public.rankball_match_record_archive_trigger();

drop trigger if exists rankball_match_record_archive_approvals_refresh on public.match_approvals;
create trigger rankball_match_record_archive_approvals_refresh
after insert or update on public.match_approvals
for each row execute function public.rankball_match_record_archive_trigger();

drop trigger if exists rankball_match_record_archive_disputes_refresh on public.match_disputes;
create trigger rankball_match_record_archive_disputes_refresh
after insert or update on public.match_disputes
for each row execute function public.rankball_match_record_archive_trigger();

create or replace function public.rankball_refresh_all_match_record_archives()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  match_item record;
  refreshed_count integer := 0;
begin
  for match_item in
    select id
    from public.matches
    where status = 'confirmed'
    order by confirmed_at nulls last, id
  loop
    if public.rankball_refresh_match_record_archive(match_item.id) then
      refreshed_count := refreshed_count + 1;
    end if;
  end loop;

  return refreshed_count;
end;
$$;

revoke all on function public.rankball_refresh_all_match_record_archives() from public, anon, authenticated;
grant execute on function public.rankball_refresh_all_match_record_archives() to service_role;

create or replace function public.rankball_archive_and_cleanup_completed_records(
  p_batch_size integer default 100,
  p_reference timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_batch_size integer := least(500, greatest(1, coalesce(p_batch_size, 100)));
  detail_cutoff date := public.rankball_record_detail_cutoff(p_reference);
  candidate record;
  refreshed_count integer := 0;
  compacted_match_count integer := 0;
  deleted_agreement_count integer := 0;
  deleted_approval_count integer := 0;
  deleted_dispute_count integer := 0;
  affected_count integer := 0;
begin
  for candidate in
    select archive_row.match_id
    from public.match_record_archives archive_row
    join public.matches match_row on match_row.id = archive_row.match_id
    where archive_row.is_active
      and archive_row.workflow_compacted_at is null
      and match_row.status = 'confirmed'
      and archive_row.record_date < detail_cutoff
      and not exists (
        select 1
        from public.match_disputes dispute_row
        where dispute_row.match_id = archive_row.match_id
          and dispute_row.status = 'open'
      )
    order by archive_row.record_date, archive_row.match_id
    limit safe_batch_size
    for update of archive_row skip locked
  loop
    if not public.rankball_refresh_match_record_archive(candidate.match_id) then
      continue;
    end if;
    refreshed_count := refreshed_count + 1;

    if not public.rankball_match_record_archive_is_complete(candidate.match_id) then
      continue;
    end if;

    delete from public.match_agreements
    where match_id = candidate.match_id;
    get diagnostics affected_count = row_count;
    deleted_agreement_count := deleted_agreement_count + affected_count;

    delete from public.match_approvals
    where match_id = candidate.match_id;
    get diagnostics affected_count = row_count;
    deleted_approval_count := deleted_approval_count + affected_count;

    delete from public.match_disputes
    where match_id = candidate.match_id
      and status <> 'open';
    get diagnostics affected_count = row_count;
    deleted_dispute_count := deleted_dispute_count + affected_count;

    update public.match_record_archives
    set workflow_compacted_at = coalesce(workflow_compacted_at, coalesce(p_reference, now()))
    where match_id = candidate.match_id;

    compacted_match_count := compacted_match_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'detailCutoff', detail_cutoff,
    'batchSize', safe_batch_size,
    'archivesRefreshed', refreshed_count,
    'matchesWorkflowCompacted', compacted_match_count,
    'deletedAgreements', deleted_agreement_count,
    'deletedApprovals', deleted_approval_count,
    'deletedResolvedDisputes', deleted_dispute_count,
    'deletedCoreRows', 0,
    'coreCompactionDeferred', true,
    'coreCompactionReason', 'live_record_rating_tournament_achievement_and_review_consumers_not_archive_aware',
    'recruitingAndInvitationCleanupDeferred', true,
    'recruitingAndInvitationCleanupReason', 'current_achievement_metrics_still_depend_on_live_rows'
  );
end;
$$;

revoke all on function public.rankball_archive_and_cleanup_completed_records(integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rankball_archive_and_cleanup_completed_records(integer, timestamptz)
  to service_role;

comment on function public.rankball_archive_and_cleanup_completed_records(integer, timestamptz) is
  'Archives confirmed matches and removes only old transient agreement, approval, and resolved-dispute rows. Core match facts remain intact.';

select public.rankball_refresh_all_match_record_archives();
select pg_notify('pgrst', 'reload schema');
