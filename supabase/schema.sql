create table if not exists public.rankball_state (
  id text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.rankball_state enable row level security;

drop policy if exists "rankball_state_select_public" on public.rankball_state;
drop policy if exists "rankball_state_insert_public" on public.rankball_state;
drop policy if exists "rankball_state_update_public" on public.rankball_state;

create policy "rankball_state_select_public"
on public.rankball_state
for select
to anon, authenticated
using (true);

create policy "rankball_state_insert_public"
on public.rankball_state
for insert
to anon, authenticated
with check (true);

create policy "rankball_state_update_public"
on public.rankball_state
for update
to anon, authenticated
using (true)
with check (true);

insert into public.rankball_state (id, state)
values ('rankball-mvp', '{}'::jsonb)
on conflict (id) do nothing;

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

create policy "tournaments_select_public"
on public.tournaments
for select
to anon, authenticated
using (true);

create policy "tournaments_insert_public"
on public.tournaments
for insert
to anon, authenticated
with check (true);

create policy "tournaments_update_public"
on public.tournaments
for update
to anon, authenticated
using (true)
with check (true);

create policy "tournament_teams_select_public"
on public.tournament_teams
for select
to anon, authenticated
using (true);

create policy "tournament_teams_insert_public"
on public.tournament_teams
for insert
to anon, authenticated
with check (true);

create policy "tournament_teams_update_public"
on public.tournament_teams
for update
to anon, authenticated
using (true)
with check (true);

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

  if to_regclass('public.teams') is not null then
    execute 'alter table public.teams add column if not exists deleted_at timestamptz';
    execute 'create index if not exists teams_deleted_at_idx on public.teams (deleted_at)';
  end if;

  if to_regclass('public.tournaments') is not null then
    execute 'alter table public.tournaments add column if not exists started_at timestamptz';
    execute 'alter table public.tournaments add column if not exists match_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.tournaments add column if not exists team_statuses jsonb not null default ''{}''::jsonb';
    execute 'alter table public.tournaments add column if not exists team_approvals jsonb not null default ''{}''::jsonb';
    execute 'alter table public.tournaments add column if not exists bracket jsonb not null default ''{}''::jsonb';
  end if;

  if to_regclass('public.tournament_teams') is not null then
    execute 'alter table public.tournament_teams add column if not exists approved_by text';
    execute 'alter table public.tournament_teams add column if not exists approved_at timestamptz';
  end if;

  if to_regclass('public.affiliations') is not null then
    execute 'delete from public.affiliations where type = ''club''';
    execute 'alter table public.affiliations drop constraint if exists affiliations_type_check';
    execute 'alter table public.affiliations add constraint affiliations_type_check check (type in (''region'', ''school'', ''company''))';
  end if;

  if to_regclass('public.matches') is not null then
    execute 'alter table public.matches add column if not exists mmr_limit_mode text not null default ''block''';
    execute 'alter table public.matches add column if not exists referee_id text';
    execute 'alter table public.matches add column if not exists referee_trust_min integer not null default 90';
    execute 'alter table public.matches add column if not exists stat_entry_minutes integer not null default 60';
    execute 'alter table public.matches add column if not exists dispute_minutes integer not null default 120';
    execute 'alter table public.matches add column if not exists ended_at timestamptz';
    execute 'create index if not exists matches_referee_id_idx on public.matches (referee_id)';
    execute 'alter table public.matches add column if not exists tournament_id text';
    execute 'alter table public.matches add column if not exists tournament_format text';
    execute 'alter table public.matches add column if not exists tournament_round integer';
    execute 'alter table public.matches add column if not exists tournament_fixture integer';
    execute 'alter table public.matches add column if not exists tournament_mmr_policy text';
    execute 'create index if not exists matches_tournament_id_idx on public.matches (tournament_id)';
    execute 'alter table public.matches drop constraint if exists matches_mmr_limit_mode_check';
    execute 'alter table public.matches add constraint matches_mmr_limit_mode_check check (mmr_limit_mode in (''off'', ''warn'', ''block''))';
  end if;

  if to_regclass('public.match_results') is not null then
    execute 'alter table public.match_results add column if not exists stat_submissions jsonb not null default ''{}''::jsonb';
    execute 'alter table public.match_results add column if not exists submitted_by text';
  end if;

  if to_regclass('public.player_match_stats') is not null then
    execute 'alter table public.player_match_stats add column if not exists recorded_by text';
    execute 'alter table public.player_match_stats add column if not exists record_source text not null default ''player''';
    execute 'alter table public.player_match_stats drop constraint if exists player_match_stats_record_source_check';
    execute 'alter table public.player_match_stats add constraint player_match_stats_record_source_check check (record_source in (''player'', ''referee''))';
  end if;

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
    execute 'alter table public.recruiting_posts add column if not exists scheduled_date date';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_time time';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_at text';
    execute 'alter table public.recruiting_posts add column if not exists confirmed_at timestamptz';
    execute 'alter table public.recruiting_posts add column if not exists player_ids jsonb not null default ''[]''::jsonb';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_host_join_mode_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_host_join_mode_check check (host_join_mode in (''player'', ''team''))';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_host_side_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_host_side_check check (host_side in (''teamA'', ''teamB''))';
    execute 'alter table public.recruiting_posts drop constraint if exists recruiting_posts_side_capacity_check';
    execute 'alter table public.recruiting_posts add constraint recruiting_posts_side_capacity_check check (side_capacity between 1 and 5)';
  end if;

  if to_regclass('public.recruiting_applications') is not null then
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
  end if;
end;
$$;

do $$
declare
  ref_date constant date := date '2026-06-15';
begin
  if to_regclass('public.recruiting_posts') is not null then
    with queued as (
      select
        id,
        row_number() over (order by coalesce(scheduled_date, ref_date), created_at, id) - 1 as idx
      from public.recruiting_posts
      where (
          scheduled_date is null
          or scheduled_time is null
          or scheduled_date < ref_date
          or scheduled_at is null
          or btrim(scheduled_at) = ''
          or scheduled_at !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        )
    ),
    used_slots as (
      select
        scheduled_date,
        scheduled_time
      from public.recruiting_posts
      where scheduled_date >= ref_date
        and scheduled_time is not null
        and scheduled_at is not null
        and btrim(scheduled_at) <> ''
        and scheduled_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
    ),
    available_slots as (
      select
        row_number() over (order by generated.next_date, generated.next_time) - 1 as idx,
        generated.next_date,
        generated.next_time
      from (
        select
          ref_date + ((slot_idx / 3)::int) as next_date,
          (time '18:00' + ((slot_idx % 3) * interval '90 minutes'))::time as next_time
        from generate_series(0, 1095) as generated_slots(slot_idx)
      ) generated
      where not exists (
        select 1
        from used_slots
        where used_slots.scheduled_date = generated.next_date
          and used_slots.scheduled_time = generated.next_time
      )
    ),
    slots as (
      select queued.id, available_slots.next_date, available_slots.next_time
      from queued
      join available_slots on available_slots.idx = queued.idx
    )
    update public.recruiting_posts post
    set
      scheduled_date = slots.next_date,
      scheduled_time = slots.next_time,
      scheduled_at = slots.next_date::text || ' ' || to_char(slots.next_time, 'HH24:MI')
    from slots
    where post.id = slots.id;
  end if;

  if to_regclass('public.matches') is not null and to_regclass('public.match_results') is not null then
    with future_results as (
      select
        match_row.id,
        row_number() over (order by coalesce(match_row.scheduled_date, ref_date), match_row.created_at, match_row.id) - 1 as idx
      from public.matches match_row
      where exists (
        select 1
        from public.match_results result_row
        where result_row.match_id = match_row.id
      )
        and coalesce(match_row.status, '') not in ('void', 'cancelled')
        and (match_row.scheduled_date is null or match_row.scheduled_date >= ref_date)
    ),
    past_slots as (
      select
        id,
        ref_date - 1 - ((idx / 12)::int) as next_date,
        (time '10:00' + ((idx % 12) * interval '60 minutes'))::time as next_time
      from future_results
    )
    update public.matches match_row
    set
      scheduled_date = past_slots.next_date,
      scheduled_time = past_slots.next_time,
      scheduled_at = past_slots.next_date::text || ' ' || to_char(past_slots.next_time, 'HH24:MI')
    from past_slots
    where match_row.id = past_slots.id;

    with unscheduled_open as (
      select
        match_row.id,
        row_number() over (order by coalesce(match_row.created_at, now()), match_row.id) - 1 as idx
      from public.matches match_row
      where not exists (
        select 1
        from public.match_results result_row
        where result_row.match_id = match_row.id
      )
        and coalesce(match_row.status, '') not in ('void', 'cancelled')
        and (match_row.scheduled_date is null or match_row.scheduled_time is null)
    ),
    open_slots as (
      select
        id,
        ref_date + ((idx / 4)::int) as next_date,
        (time '18:00' + ((idx % 4) * interval '60 minutes'))::time as next_time
      from unscheduled_open
    )
    update public.matches match_row
    set
      scheduled_date = open_slots.next_date,
      scheduled_time = open_slots.next_time,
      scheduled_at = open_slots.next_date::text || ' ' || to_char(open_slots.next_time, 'HH24:MI')
    from open_slots
    where match_row.id = open_slots.id;

    update public.matches match_row
    set
      status = 'confirmed',
      ended_at = coalesce(
        match_row.ended_at,
        ((match_row.scheduled_date + coalesce(match_row.scheduled_time, time '20:00')) at time zone 'Asia/Seoul') + interval '90 minutes'
      ),
      confirmed_at = coalesce(
        match_row.confirmed_at,
        ((match_row.scheduled_date + coalesce(match_row.scheduled_time, time '20:00')) at time zone 'Asia/Seoul') + interval '120 minutes'
      )
    where exists (
      select 1
      from public.match_results result_row
      where result_row.match_id = match_row.id
    )
      and coalesce(match_row.status, '') not in ('void', 'cancelled', 'disputed')
      and match_row.scheduled_date < ref_date;

    update public.matches match_row
    set
      status = 'approval',
      ended_at = timestamp with time zone '2026-06-15 00:00:00+09',
      stat_entry_minutes = greatest(coalesce(match_row.stat_entry_minutes, 60), 1440),
      dispute_minutes = greatest(coalesce(match_row.dispute_minutes, 120), 2880),
      confirmed_at = null
    where not exists (
      select 1
      from public.match_results result_row
      where result_row.match_id = match_row.id
    )
      and coalesce(match_row.status, '') not in ('void', 'cancelled', 'disputed')
      and match_row.scheduled_date < ref_date;

    update public.matches match_row
    set
      status = 'agreed',
      ended_at = null,
      confirmed_at = null,
      score_a = 0,
      score_b = 0
    where not exists (
      select 1
      from public.match_results result_row
      where result_row.match_id = match_row.id
    )
      and coalesce(match_row.status, '') not in ('void', 'cancelled')
      and match_row.scheduled_date >= ref_date;
  end if;
end;
$$;
