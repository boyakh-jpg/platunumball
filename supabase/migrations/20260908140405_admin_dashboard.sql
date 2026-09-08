-- One server-only snapshot: exact totals and a bounded, privacy-limited list.
create or replace function public.rankball_admin_dashboard(
  p_actor_profile_id text,
  p_actor_admin_level integer default 0,
  p_kind text default 'tournaments',
  p_search text default '',
  p_status text default 'all',
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  safe_kind text := btrim(coalesce(p_kind, 'tournaments'));
  safe_search text := btrim(regexp_replace(regexp_replace(left(btrim(coalesce(p_search, '')), 80), '[,:%()*"''\\.]', ' ', 'g'), '\s+', ' ', 'g'));
  search_term text := lower(safe_search);
  safe_status text := btrim(coalesce(p_status, 'all'));
  safe_limit integer := greatest(1, least(coalesce(p_limit, 30), 60));
  safe_offset integer := greatest(0, least(coalesce(p_offset, 0), 10000));
  generated_at timestamptz := now();
  today_start timestamptz := date_trunc('day', generated_at at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  summary_json jsonb;
  rows_json jsonb;
  filtered_total bigint;
  next_offset integer;
  has_more boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    or public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  if safe_kind not in ('members', 'teams', 'matches', 'tournaments') then
    safe_kind := 'tournaments';
  end if;
  if safe_kind in ('members', 'teams') or safe_status not in ('all', 'active', 'completed') then
    safe_status := 'all';
  end if;

  select jsonb_build_object(
    'members', (
      select jsonb_build_object('total', count(*), 'today', count(*) filter (
        where p.created_at >= today_start and p.created_at < today_start + interval '1 day'
      )) from public.profiles p
    ),
    'teams', (
      select jsonb_build_object('total', count(*), 'today', count(*) filter (
        where t.created_at >= today_start and t.created_at < today_start + interval '1 day'
      )) from public.teams t where t.deleted_at is null
    ),
    'matches', (
      select jsonb_build_object(
        'total', count(*),
        -- getMatchRoomPhase live: started, not ended, not postgame/disputed/terminal.
        'active', count(*) filter (where m.started_at is not null and m.ended_at is null
          and coalesce(m.status, '') not in ('approval', 'disputed', 'confirmed', 'cancelled', 'canceled', 'void', 'voided', 'closed')),
        'confirmed', count(*) filter (where m.status = 'confirmed'),
        'today', count(*) filter (where m.created_at >= today_start and m.created_at < today_start + interval '1 day')
      ) from public.matches m
    ),
    'tournaments', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where t.status = 'active'),
        'completed', count(*) filter (where t.status = 'closed')
      ) from public.tournaments t
    )
  ) into summary_json;

  if safe_kind = 'members' then
    with filtered as not materialized (
      select p.id, p.name, p.hashtag, p.region, p.created_at
      from public.profiles p
      where search_term = '' or strpos(lower(concat_ws(' ', p.id, p.name, p.hashtag, p.region)), search_term) > 0
    ), page_rows as (
      select * from filtered order by created_at desc nulls last, id asc limit safe_limit offset safe_offset
    )
    select (select count(*) from filtered), coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.name, 'hashtag', p.hashtag, 'region', p.region,
      'createdAt', p.created_at, 'status', null
    ) order by p.created_at desc nulls last, p.id asc), '[]'::jsonb)
    into filtered_total, rows_json from page_rows p;

  elsif safe_kind = 'teams' then
    with filtered as not materialized (
      select t.id, t.name, t.region, t.created_at
      from public.teams t
      where t.deleted_at is null
        and (search_term = '' or strpos(lower(concat_ws(' ', t.id, t.name, t.region)), search_term) > 0)
    ), page_rows as materialized (
      select * from filtered order by created_at desc nulls last, id asc limit safe_limit offset safe_offset
    )
    select (select count(*) from filtered), coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'region', t.region, 'createdAt', t.created_at, 'status', null,
      'memberCount', (select count(*) from public.team_members tm where tm.team_id = t.id)
    ) order by t.created_at desc nulls last, t.id asc), '[]'::jsonb)
    into filtered_total, rows_json from page_rows t;

  elsif safe_kind = 'matches' then
    with filtered as not materialized (
      select m.id, m.title, m.mode, m.status, m.scheduled_at, m.created_at, m.started_at, m.ended_at,
        coalesce(c.name, m.court_name) as court_name, c.region_key as region
      from public.matches m
      left join public.approved_courts c on c.id = m.court_id
      where (safe_status = 'all'
          or (safe_status = 'completed' and m.status = 'confirmed')
          or (safe_status = 'active' and m.started_at is not null and m.ended_at is null
            and coalesce(m.status, '') not in ('approval', 'disputed', 'confirmed', 'cancelled', 'canceled', 'void', 'voided', 'closed')))
        and (search_term = '' or strpos(lower(concat_ws(' ', m.id, m.title, m.mode, c.name, m.court_name, c.region_key)), search_term) > 0)
    ), page_rows as (
      select * from filtered order by created_at desc nulls last, id asc limit safe_limit offset safe_offset
    )
    select (select count(*) from filtered), coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'name', m.title, 'region', m.region, 'createdAt', m.created_at, 'status', m.status,
      'mode', m.mode, 'scheduledAt', m.scheduled_at, 'courtName', m.court_name,
      'startedAt', m.started_at, 'endedAt', m.ended_at
    ) order by m.created_at desc nulls last, m.id asc), '[]'::jsonb)
    into filtered_total, rows_json from page_rows m;

  else
    with filtered as not materialized (
      select t.id, t.title, t.region, t.status, t.format, t.start_date, t.end_date, t.created_at
      from public.tournaments t
      where (safe_status = 'all' or (safe_status = 'active' and t.status = 'active')
          or (safe_status = 'completed' and t.status = 'closed'))
        and (search_term = '' or strpos(lower(concat_ws(' ', t.id, t.title, t.region, t.court_name)), search_term) > 0)
    ), page_rows as materialized (
      select * from filtered
      order by (status = 'active') desc, created_at desc nulls last, id asc
      limit safe_limit offset safe_offset
    )
    select (select count(*) from filtered), coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.title, 'region', t.region, 'createdAt', t.created_at, 'status', t.status,
      'format', t.format, 'startDate', t.start_date, 'endDate', t.end_date,
      'teamCount', team_counts.total, 'approvedTeamCount', team_counts.approved,
      'matchCount', match_counts.total, 'confirmedMatchCount', match_counts.confirmed,
      'cancelledMatchCount', match_counts.cancelled
    ) order by (t.status = 'active') desc, t.created_at desc nulls last, t.id asc), '[]'::jsonb)
    into filtered_total, rows_json
    from page_rows t
    cross join lateral (
      select count(*) filter (where tt.status <> 'declined') as total,
        count(*) filter (where tt.status = 'accepted') as approved
      from public.tournament_teams tt where tt.tournament_id = t.id
    ) team_counts
    cross join lateral (
      select count(*) as total, count(*) filter (where m.status = 'confirmed') as confirmed,
        count(*) filter (where m.status in ('cancelled', 'canceled', 'void', 'voided', 'closed')) as cancelled
      from public.matches m where m.tournament_id = t.id
    ) match_counts;
  end if;

  -- Stop pagination at the shared directory offset ceiling; exact totals remain visible.
  next_offset := safe_offset + jsonb_array_length(rows_json);
  has_more := next_offset < filtered_total and next_offset <= 10000 and jsonb_array_length(rows_json) > 0;
  return jsonb_build_object(
    'ok', true, 'generatedAt', generated_at, 'summary', summary_json, 'rows', rows_json,
    'page', jsonb_build_object(
      'kind', safe_kind, 'search', safe_search, 'status', safe_status,
      'limit', safe_limit, 'offset', safe_offset, 'total', filtered_total,
      'hasMore', has_more, 'nextOffset', case when has_more then next_offset else null end
    )
  );
end;
$function$;

revoke all on function public.rankball_admin_dashboard(text, integer, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rankball_admin_dashboard(text, integer, text, text, text, integer, integer) to service_role;
