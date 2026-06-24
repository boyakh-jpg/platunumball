create table if not exists public.rankball_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.rankball_state enable row level security;

drop policy if exists "rankball_state_select_public" on public.rankball_state;
drop policy if exists "rankball_state_insert_public" on public.rankball_state;
drop policy if exists "rankball_state_update_public" on public.rankball_state;
drop policy if exists "rankball_state_admin_only" on public.rankball_state;

create policy "rankball_state_admin_only"
on public.rankball_state
for all
to authenticated
using (false)
with check (false);

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles add column if not exists auth_user_id text';
    execute 'alter table public.profiles add column if not exists hashtag text';
    execute 'alter table public.profiles add column if not exists birth_year integer';
    execute 'alter table public.profiles add column if not exists age_group text';
    execute 'alter table public.profiles add column if not exists age_group_checked_season text';
    execute 'alter table public.profiles add column if not exists region_sido text';
    execute 'alter table public.profiles add column if not exists region_district text';
    execute 'alter table public.profiles add column if not exists onboarding_complete boolean not null default false';
    execute 'alter table public.profiles add column if not exists profile_version integer not null default 0';
    execute 'alter table public.profiles add column if not exists handle_locked_at timestamptz';
    execute 'alter table public.profiles add column if not exists birth_year_locked_at timestamptz';
    execute 'alter table public.profiles add column if not exists name_updated_at timestamptz';
    execute 'alter table public.profiles add column if not exists discord_connection jsonb';
    execute 'alter table public.profiles add column if not exists discord_user_id text';
    execute 'update public.profiles set hashtag = lower(regexp_replace(coalesce(nullif(hashtag, ''''), handle, id), ''^[@#]+'', ''#'')) where hashtag is null';
    if not exists (
      select 1
      from public.profiles
      where auth_user_id is not null
      group by auth_user_id
      having count(*) > 1
    ) then
      execute 'create unique index if not exists profiles_auth_user_id_unique on public.profiles (auth_user_id) where auth_user_id is not null';
    end if;
    if not exists (
      select 1
      from public.profiles
      where hashtag is not null
      group by lower(regexp_replace(hashtag, ''^[@#]+'', ''''))
      having count(*) > 1
    ) then
      execute 'create unique index if not exists profiles_hashtag_unique on public.profiles (lower(regexp_replace(hashtag, ''^[@#]+'', ''''))) where hashtag is not null';
    end if;
    execute 'update public.profiles set discord_user_id = nullif(discord_connection->>''userId'', '''') where discord_user_id is null';
    if not exists (
      select 1
      from public.profiles
      where discord_user_id is not null
      group by discord_user_id
      having count(*) > 1
    ) then
      execute 'create unique index if not exists profiles_discord_user_id_unique on public.profiles (discord_user_id) where discord_user_id is not null';
    end if;
  end if;
end;
$$;

create or replace function public.current_profile_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.auth_user_id = auth.uid()::text
  limit 1
$$;

create or replace function public.enforce_team_membership_limit()
returns trigger
language plpgsql
as $$
begin
  if (
    select count(*)
    from public.team_members
    where user_id = new.user_id
      and team_id <> new.team_id
  ) >= 3 then
    raise exception 'team membership limit exceeded: max 3 teams per user';
  end if;

  return new;
end;
$$;

create table if not exists public.tournaments (
  id text primary key,
  title text not null,
  format text not null default 'league',
  visibility text not null default 'private',
  status text not null default 'draft',
  region text,
  court_name text,
  mode text,
  ranked boolean not null default true,
  official boolean not null default false,
  start_date date,
  end_date date,
  schedule_policy text not null default 'weekly',
  schedule_note text,
  mmr_limit_mode text not null default 'warn',
  max_mmr_gap integer not null default 250,
  mmr_policy text not null default 'gap_adjusted',
  rules jsonb not null default '{}'::jsonb,
  memo text,
  created_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  match_ids jsonb not null default '[]'::jsonb,
  team_statuses jsonb not null default '{}'::jsonb,
  team_approvals jsonb not null default '{}'::jsonb,
  bracket jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint tournaments_format_check check (format in ('league', 'tournament')),
  constraint tournaments_visibility_check check (visibility in ('private', 'public')),
  constraint tournaments_status_check check (status in ('draft', 'scheduled', 'active', 'closed', 'cancelled')),
  constraint tournaments_mmr_limit_mode_check check (mmr_limit_mode in ('off', 'warn', 'block')),
  constraint tournaments_mmr_policy_check check (mmr_policy in ('gap_adjusted', 'standard', 'event_only'))
);

create table if not exists public.tournament_teams (
  tournament_id text not null references public.tournaments(id) on delete cascade,
  team_id text not null,
  seed_order integer not null default 1,
  status text not null default 'invited',
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tournament_id, team_id),
  constraint tournament_teams_status_check check (status in ('invited', 'accepted', 'declined'))
);

create index if not exists tournaments_created_at_idx on public.tournaments (created_at desc);
create index if not exists tournament_teams_team_id_idx on public.tournament_teams (team_id);

alter table public.tournaments enable row level security;
alter table public.tournament_teams enable row level security;

drop policy if exists "tournaments_select_public" on public.tournaments;
drop policy if exists "tournaments_insert_public" on public.tournaments;
drop policy if exists "tournaments_update_public" on public.tournaments;
drop policy if exists "tournament_teams_select_public" on public.tournament_teams;
drop policy if exists "tournament_teams_insert_public" on public.tournament_teams;
drop policy if exists "tournament_teams_update_public" on public.tournament_teams;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('tournaments', 'tournament_teams')
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and ('public' = any(roles) or 'anon' = any(roles))
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end;
$$;

create policy "tournaments_select_public"
on public.tournaments
for select
to anon, authenticated
using (true);

create policy "tournament_teams_select_public"
on public.tournament_teams
for select
to anon, authenticated
using (true);

do $$
begin
  if to_regclass('public.team_members') is not null then
    execute 'drop trigger if exists team_members_limit_3 on public.team_members';
    execute '
      create trigger team_members_limit_3
      before insert or update of user_id, team_id on public.team_members
      for each row
      execute function public.enforce_team_membership_limit()
    ';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.teams') is not null then
    execute 'alter table public.teams add column if not exists deleted_at timestamptz';
    execute 'create index if not exists teams_deleted_at_idx on public.teams (deleted_at)';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.tournaments') is not null then
    execute 'alter table public.tournaments add column if not exists started_at timestamptz';
    execute 'alter table public.tournaments add column if not exists match_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.tournaments add column if not exists team_statuses jsonb not null default ''{}''::jsonb';
    execute 'alter table public.tournaments add column if not exists team_approvals jsonb not null default ''{}''::jsonb';
    execute 'alter table public.tournaments add column if not exists bracket jsonb not null default ''{}''::jsonb';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.tournament_teams') is not null then
    execute 'alter table public.tournament_teams add column if not exists approved_by text';
    execute 'alter table public.tournament_teams add column if not exists approved_at timestamptz';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.affiliations') is not null then
    execute 'delete from public.affiliations where type = ''club''';
    execute 'alter table public.affiliations drop constraint if exists affiliations_type_check';
    execute 'alter table public.affiliations add constraint affiliations_type_check check (type in (''region'', ''school'', ''company''))';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.matches') is not null then
    execute 'alter table public.matches add column if not exists score_a integer not null default 0';
    execute 'alter table public.matches add column if not exists score_b integer not null default 0';
    execute 'alter table public.matches add column if not exists mmr_limit_mode text not null default ''block''';
    execute 'alter table public.matches add column if not exists referee_id text';
    execute 'alter table public.matches add column if not exists referee_trust_min integer not null default 90';
    execute 'alter table public.matches add column if not exists stat_entry_minutes integer not null default 60';
    execute 'alter table public.matches add column if not exists dispute_minutes integer not null default 120';
    execute 'alter table public.matches add column if not exists ended_at timestamptz';
    execute 'alter table public.matches add column if not exists trust_feedback jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists stat_recorders jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists played_player_ids jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists reserve_players jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists promoted_reserve_ids jsonb not null default ''{}''::jsonb';
    execute 'alter table public.matches add column if not exists attendance jsonb not null default ''{"teamA":[],"teamB":[]}''::jsonb';
    execute 'alter table public.matches add column if not exists referee_absence_request jsonb';
    execute 'alter table public.matches add column if not exists former_referee_id text';
    execute 'alter table public.matches add column if not exists dispute_draft_result jsonb';
    execute 'alter table public.matches add column if not exists dispute_draft_updated_at timestamptz';
    execute 'alter table public.matches add column if not exists dispute_resolved_at timestamptz';
    execute 'alter table public.matches add column if not exists mmr_excluded_player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.matches add column if not exists anonymous_players jsonb not null default ''{}''::jsonb';
    execute 'create index if not exists matches_referee_id_idx on public.matches (referee_id)';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.matches') is not null then
    execute 'alter table public.matches add column if not exists tournament_id text';
    execute 'alter table public.matches add column if not exists tournament_format text';
    execute 'alter table public.matches add column if not exists tournament_round integer';
    execute 'alter table public.matches add column if not exists tournament_fixture integer';
    execute 'alter table public.matches add column if not exists tournament_mmr_policy text';
    execute 'create index if not exists matches_tournament_id_idx on public.matches (tournament_id)';
    execute 'alter table public.matches drop constraint if exists matches_mmr_limit_mode_check';
    execute 'alter table public.matches add constraint matches_mmr_limit_mode_check check (mmr_limit_mode in (''off'', ''warn'', ''block''))';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.match_results') is not null then
    execute 'alter table public.match_results add column if not exists score_a integer not null default 0';
    execute 'alter table public.match_results add column if not exists score_b integer not null default 0';
    execute 'update public.match_results set score_a = 0 where score_a is null';
    execute 'update public.match_results set score_b = 0 where score_b is null';
    execute 'alter table public.match_results add column if not exists stat_submissions jsonb not null default ''{}''::jsonb';
    execute 'alter table public.match_results add column if not exists submitted_by text';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.player_match_stats') is not null then
    execute 'alter table public.player_match_stats add column if not exists recorded_by text';
    execute 'alter table public.player_match_stats add column if not exists record_source text not null default ''player''';
    execute 'alter table public.player_match_stats add column if not exists fouls integer not null default 0';
    execute 'update public.player_match_stats set fouls = 0 where fouls is null';
    execute 'alter table public.player_match_stats drop constraint if exists player_match_stats_record_source_check';
    execute 'alter table public.player_match_stats add constraint player_match_stats_record_source_check check (record_source in (''player'', ''referee'', ''candidate_recorder''))';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.recruiting_posts') is not null then
    execute 'alter table public.recruiting_posts add column if not exists host_join_mode text not null default ''team''';
    execute 'alter table public.recruiting_posts add column if not exists host_side text not null default ''teamA''';
    execute 'alter table public.recruiting_posts add column if not exists host_ready boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists side_capacity integer not null default 5';
    execute 'alter table public.recruiting_posts add column if not exists target_team_id text';
    execute 'alter table public.recruiting_posts add column if not exists referee_id text';
    execute 'alter table public.recruiting_posts add column if not exists referee_trust_min integer not null default 90';
    execute 'alter table public.recruiting_posts add column if not exists stat_entry_minutes integer not null default 60';
    execute 'alter table public.recruiting_posts add column if not exists dispute_minutes integer not null default 120';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.recruiting_posts') is not null then
    execute 'alter table public.recruiting_posts add column if not exists scheduled_date date';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_time time';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_at text';
    execute 'alter table public.recruiting_posts add column if not exists confirmed_at timestamptz';
    execute 'alter table public.recruiting_posts add column if not exists player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_posts add column if not exists room_state jsonb not null default ''{}''::jsonb';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_host_join_mode_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_host_join_mode_check check (host_join_mode in (''player'', ''team''))';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_host_side_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_host_side_check check (host_side in (''teamA'', ''teamB''))';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_side_capacity_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_side_capacity_check check (side_capacity between 1 and 5)';
  end if;
end;
$$;

do $$
declare
  policy_name text;
begin
  if to_regclass('public.recruiting_applications') is not null then
    execute 'alter table public.recruiting_applications enable row level security';
    execute 'alter table public.recruiting_applications add column if not exists side text not null default ''teamB''';
    execute 'alter table public.recruiting_applications add column if not exists status text not null default ''waiting''';
    execute 'alter table public.recruiting_applications add column if not exists reserve boolean not null default false';
    execute 'alter table public.recruiting_applications add column if not exists position text';
    execute 'alter table public.recruiting_applications add column if not exists player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_applications add column if not exists updated_at timestamptz';
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_side_check';
    execute 'alter table public.recruiting_applications add constraint recruiting_applications_side_check check (side in (''teamA'', ''teamB''))';
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_status_check';
    execute 'alter table public.recruiting_applications add constraint recruiting_applications_status_check check (status in (''waiting'', ''ready'', ''confirmed''))';
    execute 'create index if not exists recruiting_applications_post_side_idx on public.recruiting_applications (post_id, side, reserve)';

    for policy_name in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = 'recruiting_applications'
        and cmd in ('SELECT', 'ALL')
    loop
      execute format('drop policy if exists %I on public.recruiting_applications', policy_name);
    end loop;

    if to_regclass('public.recruiting_posts') is not null then
      execute '
        create policy recruiting_applications_related_user_read
        on public.recruiting_applications
        for select
        to authenticated
        using (
          player_id = auth.uid()::text
          or player_ids ? auth.uid()::text
          or exists (
            select 1
            from public.recruiting_posts post
            where post.id = recruiting_applications.post_id
              and (
                post.player_id = auth.uid()::text
                or post.player_ids ? auth.uid()::text
              )
          )
        )
      ';
    else
      execute '
        create policy recruiting_applications_related_user_read
        on public.recruiting_applications
        for select
        to authenticated
        using (
          player_id = auth.uid()::text
          or player_ids ? auth.uid()::text
        )
      ';
    end if;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.affiliations') is not null then
    execute 'alter table public.affiliations enable row level security';
    execute 'drop policy if exists affiliations_read_all on public.affiliations';
    execute 'create policy affiliations_read_all on public.affiliations for select to public using (true)';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.seasons') is not null then
    execute 'alter table public.seasons enable row level security';
    execute 'drop policy if exists seasons_read_all on public.seasons';
    execute 'create policy seasons_read_all on public.seasons for select to public using (true)';
  end if;
end;
$$;

create table if not exists public.notifications (
  id text primary key,
  user_id text,
  target_user_id text,
  title text not null,
  body text,
  tone text,
  type text,
  match_id text,
  recruiting_post_id text,
  invitation_id text,
  discord_event text,
  read_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id text primary key,
  type text not null,
  target_id text not null,
  user_id text,
  reported_user_ids jsonb not null default '[]'::jsonb,
  reason text not null,
  status text not null default 'open',
  resolved_at timestamptz,
  resolved_by text,
  resolution jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.court_requests (
  id text primary key,
  requested_by text,
  status text not null default 'pending',
  name text not null,
  hashtag text,
  address_text text not null,
  road_address text,
  jibun_address text,
  zonecode text,
  lat double precision,
  lng double precision,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.approved_courts (
  id text primary key,
  source_request_id text,
  approved_by text,
  name text not null,
  hashtag text,
  address_text text not null,
  road_address text,
  jibun_address text,
  zonecode text,
  lat double precision,
  lng double precision,
  payload jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referee_requests (
  id text primary key,
  requested_by text,
  status text not null default 'pending',
  qualification text,
  trust_score integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referee_exam_attempts (
  id text primary key,
  user_id text,
  status text not null default 'started',
  exam_version text,
  payload jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  available_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_appointments (
  id text primary key,
  user_id text,
  role text not null default 'admin',
  grade text,
  status text not null default 'active',
  appointed_by text,
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.referee_appointments (
  id text primary key,
  user_id text,
  role text not null default 'referee',
  grade text,
  status text not null default 'active',
  appointed_by text,
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_log (
  id text primary key,
  type text,
  status text,
  report_id text,
  request_id text,
  appointment_id text,
  target_user_id text,
  created_by text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_disciplinary_actions (
  id text primary key,
  user_id text,
  type text,
  action_type text,
  status text not null default 'active',
  source_report_id text,
  created_by text,
  starts_at timestamptz,
  ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.discord_notification_deliveries (
  id text primary key,
  notification_id text,
  target_user_id text,
  discord_user_id text,
  event text,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  queued_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.current_admin_level()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(max(
    case grade
      when 'owner' then 100
      when 'senior' then 80
      when 'regionManager' then 60
      when 'matchManager' then 50
      when 'support' then 30
      else 0
    end
  ), 0)
  from public.admin_appointments
  where user_id = public.current_profile_id()
    and role = 'admin'
    and status not in ('revoked', 'expired')
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
$$;

create or replace function public.current_is_admin(min_level integer default 30)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_admin_level() >= min_level
$$;

create or replace function public.rankball_admin_level_for_profile(actor_profile_id text, override_level integer default 0)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce(override_level, 0),
    coalesce(max(
      case grade
        when 'owner' then 100
        when 'senior' then 80
        when 'regionManager' then 60
        when 'matchManager' then 50
        when 'support' then 30
        else 0
      end
    ), 0)
  )
  from public.admin_appointments
  where user_id = actor_profile_id
    and role = 'admin'
    and status not in ('revoked', 'expired')
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at >= now())
$$;

create or replace function public.rankball_approve_court_request(
  actor_profile_id text,
  actor_admin_level integer,
  request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  duplicate_id text;
  approved_id text;
  now_ts timestamptz := now();
  approved_payload jsonb;
begin
  if public.rankball_admin_level_for_profile(actor_profile_id, actor_admin_level) < 30 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;

  select id into duplicate_id
  from public.approved_courts
  where lower(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text)) =
    lower(coalesce(nullif(request_row.road_address, ''), nullif(request_row.jibun_address, ''), request_row.address_text))
    and coalesce(zonecode, '') = coalesce(request_row.zonecode, '')
    and source_request_id is distinct from request_row.id
  limit 1;

  if duplicate_id is not null then
    raise exception 'court_duplicate:%', duplicate_id using errcode = '23505';
  end if;

  approved_id := coalesce(
    (
      select id
      from public.approved_courts
      where source_request_id = request_row.id
      limit 1
    ),
    'court_' || request_row.id
  );

  approved_payload := request_row.payload || jsonb_build_object(
    'id', approved_id,
    'status', 'approved',
    'sourceRequestId', request_row.id,
    'approvedBy', actor_profile_id,
    'approvedAt', now_ts,
    'favorite', false
  );

  insert into public.approved_courts (
    id,
    source_request_id,
    approved_by,
    name,
    hashtag,
    address_text,
    road_address,
    jibun_address,
    zonecode,
    lat,
    lng,
    payload,
    approved_at,
    created_at,
    updated_at
  )
  values (
    approved_id,
    request_row.id,
    actor_profile_id,
    request_row.name,
    request_row.hashtag,
    request_row.address_text,
    request_row.road_address,
    request_row.jibun_address,
    request_row.zonecode,
    request_row.lat,
    request_row.lng,
    approved_payload,
    now_ts,
    now_ts,
    now_ts
  )
  on conflict (id) do update set
    approved_by = excluded.approved_by,
    payload = excluded.payload,
    approved_at = excluded.approved_at,
    updated_at = excluded.updated_at;

  update public.court_requests
  set
    status = 'approved',
    payload = payload || jsonb_build_object(
      'status', 'approved',
      'approvedBy', actor_profile_id,
      'approvedAt', now_ts,
      'approvedCourtId', approved_id
    ),
    updated_at = now_ts
  where id = request_row.id;

  insert into public.admin_audit_log (
    id,
    type,
    status,
    request_id,
    target_user_id,
    created_by,
    payload,
    created_at
  )
  values (
    'aa_' || md5(request_row.id || actor_profile_id || now_ts::text),
    'court_approval',
    'committed',
    request_row.id,
    request_row.requested_by,
    actor_profile_id,
    jsonb_build_object('requestId', request_row.id, 'courtId', approved_id),
    now_ts
  )
  on conflict (id) do nothing;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values (
    'n_' || md5('court-approved' || request_row.id || now_ts::text),
    request_row.requested_by,
    request_row.requested_by,
    '구장 등록 승인',
    request_row.name || ' 구장 등록요청이 승인되었습니다.',
    'team',
    'court_request',
    jsonb_build_object('courtRequestId', request_row.id, 'approvedCourtId', approved_id),
    now_ts,
    now_ts
  )
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'requestId', request_row.id, 'approvedCourtId', approved_id);
end;
$$;

create or replace function public.rankball_report_court_request(
  actor_profile_id text,
  request_id text,
  reason text default '허위 구장 등록'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.court_requests%rowtype;
  duplicate_report_id text;
  report_id text;
  now_ts timestamptz := now();
  next_trust integer;
  safe_reason text := coalesce(nullif(trim(reason), ''), '허위 구장 등록');
begin
  select * into request_row
  from public.court_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'court_request_not_found' using errcode = 'P0002';
  end if;

  if request_row.requested_by = actor_profile_id then
    raise exception 'cannot_report_own_court_request' using errcode = '42501';
  end if;

  select id into duplicate_report_id
  from public.reports
  where type = 'court_request'
    and target_id = request_row.id
    and user_id = actor_profile_id
    and status <> 'dismissed'
  limit 1;

  if duplicate_report_id is not null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'reportId', duplicate_report_id);
  end if;

  report_id := 'r_' || md5(request_row.id || actor_profile_id || now_ts::text);

  insert into public.reports (
    id,
    type,
    target_id,
    user_id,
    reported_user_ids,
    reason,
    status,
    payload,
    created_at,
    updated_at
  )
  values (
    report_id,
    'court_request',
    request_row.id,
    actor_profile_id,
    to_jsonb(array[request_row.requested_by]),
    safe_reason,
    'open',
    jsonb_build_object(
      'id', report_id,
      'type', 'court_request',
      'targetId', request_row.id,
      'by', actor_profile_id,
      'reportedUserIds', jsonb_build_array(request_row.requested_by),
      'reason', safe_reason,
      'status', 'open',
      'createdAt', now_ts
    ),
    now_ts,
    now_ts
  );

  update public.profiles
  set
    trust_score = greatest(0, least(100, coalesce(trust_score, 80) - 8)),
    updated_at = now_ts
  where id = request_row.requested_by
  returning trust_score into next_trust;

  update public.court_requests
  set
    status = 'reported',
    payload = payload || jsonb_build_object(
      'status', 'reported',
      'reportedAt', now_ts,
      'reportedBy', actor_profile_id,
      'trustPenalty', 8,
      'requesterTrustAfterReport', next_trust
    ),
    updated_at = now_ts
  where id = request_row.id;

  insert into public.notifications (
    id,
    user_id,
    target_user_id,
    title,
    body,
    tone,
    type,
    payload,
    created_at,
    updated_at
  )
  values
    (
      'n_' || md5('court-report-requester' || request_row.id || now_ts::text),
      request_row.requested_by,
      request_row.requested_by,
      case when coalesce(next_trust, 80) < 70 then '구장 등록 제한' else '구장 등록요청 신고됨' end,
      case when coalesce(next_trust, 80) < 70
        then '허위 구장 신고로 신뢰도 ' || coalesce(next_trust, 80)::text || '점이 되어 구장 등록요청이 제한됩니다.'
        else '허위 구장 신고로 신뢰도 8점이 차감되었습니다. 현재 ' || coalesce(next_trust, 80)::text || '점입니다.'
      end,
      'orange',
      'court_request',
      jsonb_build_object('courtRequestId', request_row.id, 'reportId', report_id),
      now_ts,
      now_ts
    ),
    (
      'n_' || md5('court-report-reporter' || request_row.id || actor_profile_id || now_ts::text),
      actor_profile_id,
      actor_profile_id,
      '구장 허위 신고 접수',
      request_row.name || ' 등록요청을 허위 구장으로 신고했습니다.',
      'orange',
      'court_request',
      jsonb_build_object('courtRequestId', request_row.id, 'reportId', report_id),
      now_ts,
      now_ts
    )
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'requestId', request_row.id, 'reportId', report_id, 'requesterTrustAfterReport', next_trust);
end;
$$;

revoke all on function public.rankball_approve_court_request(text, integer, text) from public;
revoke all on function public.rankball_report_court_request(text, text, text) from public;
grant execute on function public.rankball_approve_court_request(text, integer, text) to service_role;
grant execute on function public.rankball_report_court_request(text, text, text) to service_role;

do $$
begin
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications add column if not exists user_id text';
    execute 'alter table public.notifications add column if not exists target_user_id text';
    execute 'alter table public.notifications add column if not exists type text';
    execute 'alter table public.notifications add column if not exists recruiting_post_id text';
    execute 'alter table public.notifications add column if not exists invitation_id text';
    execute 'alter table public.notifications add column if not exists discord_event text';
    execute 'alter table public.notifications add column if not exists payload jsonb not null default ''{}''::jsonb';
    execute 'alter table public.notifications add column if not exists updated_at timestamptz not null default now()';
  end if;

  if to_regclass('public.reports') is not null then
    execute 'alter table public.reports add column if not exists reported_user_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.reports add column if not exists resolved_at timestamptz';
    execute 'alter table public.reports add column if not exists resolved_by text';
    execute 'alter table public.reports add column if not exists resolution jsonb';
    execute 'alter table public.reports add column if not exists payload jsonb not null default ''{}''::jsonb';
    execute 'alter table public.reports add column if not exists updated_at timestamptz not null default now()';
  end if;
end;
$$;

create unique index if not exists approved_courts_address_identity_unique
on public.approved_courts (
  lower(coalesce(nullif(road_address, ''), nullif(jibun_address, ''), address_text)),
  coalesce(zonecode, '')
);

do $$
begin
  if to_regclass('public.approved_courts_source_request_unique') is null and not exists (
    select 1
    from public.approved_courts
    where source_request_id is not null
    group by source_request_id
    having count(*) > 1
  ) then
    execute 'create unique index approved_courts_source_request_unique on public.approved_courts (source_request_id) where source_request_id is not null';
  end if;

  if to_regclass('public.reports_court_request_active_reporter_unique') is null and not exists (
    select 1
    from public.reports
    where type = ''court_request''
      and status <> ''dismissed''
    group by target_id, user_id
    having count(*) > 1
  ) then
    execute 'create unique index reports_court_request_active_reporter_unique on public.reports (target_id, user_id) where type = ''court_request'' and status <> ''dismissed''';
  end if;
end;
$$;

create index if not exists court_requests_status_idx on public.court_requests (status, created_at desc);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists discord_notification_deliveries_status_idx on public.discord_notification_deliveries (status, queued_at);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'notifications',
    'reports',
    'court_requests',
    'approved_courts',
    'referee_requests',
    'referee_exam_attempts',
    'admin_appointments',
    'referee_appointments',
    'admin_audit_log',
    'admin_disciplinary_actions',
    'discord_notification_deliveries'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

drop policy if exists approved_courts_select_public on public.approved_courts;
create policy approved_courts_select_public
on public.approved_courts
for select
to anon, authenticated
using (true);

drop policy if exists court_requests_self_read on public.court_requests;
drop policy if exists court_requests_self_insert on public.court_requests;
drop policy if exists court_requests_admin_read on public.court_requests;
create policy court_requests_self_read
on public.court_requests
for select
to authenticated
using (requested_by = public.current_profile_id());
create policy court_requests_self_insert
on public.court_requests
for insert
to authenticated
with check (requested_by = public.current_profile_id() and status = 'pending');
create policy court_requests_admin_read
on public.court_requests
for select
to authenticated
using (public.current_is_admin(30));

drop policy if exists referee_requests_self_read on public.referee_requests;
drop policy if exists referee_requests_self_insert on public.referee_requests;
create policy referee_requests_self_read
on public.referee_requests
for select
to authenticated
using (user_id = public.current_profile_id());
create policy referee_requests_self_insert
on public.referee_requests
for insert
to authenticated
with check (user_id = public.current_profile_id());

drop policy if exists referee_exam_attempts_self_read on public.referee_exam_attempts;
drop policy if exists referee_exam_attempts_self_insert on public.referee_exam_attempts;
create policy referee_exam_attempts_self_read
on public.referee_exam_attempts
for select
to authenticated
using (user_id = public.current_profile_id());
create policy referee_exam_attempts_self_insert
on public.referee_exam_attempts
for insert
to authenticated
with check (user_id = public.current_profile_id());

drop policy if exists admin_appointments_admin_read on public.admin_appointments;
drop policy if exists referee_appointments_admin_read on public.referee_appointments;
drop policy if exists admin_audit_log_admin_read on public.admin_audit_log;
drop policy if exists admin_disciplinary_actions_admin_read on public.admin_disciplinary_actions;
create policy admin_appointments_admin_read on public.admin_appointments for select to authenticated using (public.current_is_admin(30));
create policy referee_appointments_admin_read on public.referee_appointments for select to authenticated using (public.current_is_admin(30));
create policy admin_audit_log_admin_read on public.admin_audit_log for select to authenticated using (public.current_is_admin(30));
create policy admin_disciplinary_actions_admin_read on public.admin_disciplinary_actions for select to authenticated using (public.current_is_admin(30));

drop policy if exists discord_notification_deliveries_self_read on public.discord_notification_deliveries;
create policy discord_notification_deliveries_self_read
on public.discord_notification_deliveries
for select
to authenticated
using (target_user_id = public.current_profile_id());

do $$
begin
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications enable row level security';
    execute 'drop policy if exists notifications_read_all on public.notifications';
    execute 'drop policy if exists notifications_self_read on public.notifications';
    execute 'drop policy if exists notifications_self_update on public.notifications';
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'notifications' and column_name = 'user_id'
    ) then
      execute 'create policy notifications_self_read on public.notifications for select to authenticated using (user_id = public.current_profile_id() or target_user_id = public.current_profile_id())';
      execute 'create policy notifications_self_update on public.notifications for update to authenticated using (user_id = public.current_profile_id() or target_user_id = public.current_profile_id()) with check (user_id = public.current_profile_id() or target_user_id = public.current_profile_id())';
    else
      execute 'create policy notifications_self_read on public.notifications for select to authenticated using (false)';
    end if;
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.reports') is not null then
    execute 'alter table public.reports enable row level security';
    execute 'drop policy if exists reports_read_all on public.reports';
    execute 'drop policy if exists reports_insert_authenticated on public.reports';
    execute 'drop policy if exists reports_no_public_read on public.reports';
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'reports' and column_name = 'user_id'
    ) then
      execute 'create policy reports_insert_authenticated on public.reports for insert to authenticated with check (user_id = public.current_profile_id())';
    end if;
    execute 'create policy reports_no_public_read on public.reports for select to authenticated using (false)';
  end if;
end;
$$;

do $$
begin
  if to_regclass('public.match_disputes') is not null then
    execute 'drop policy if exists match_disputes_read_all on public.match_disputes';
    execute 'drop policy if exists match_disputes_no_public_read on public.match_disputes';
    execute 'create policy match_disputes_no_public_read on public.match_disputes for select to authenticated using (false)';
  end if;
end;
$$;
