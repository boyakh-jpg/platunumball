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
begin
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
      execute 'create policy notifications_self_read on public.notifications for select to authenticated using (user_id = auth.uid()::text)';
      execute 'create policy notifications_self_update on public.notifications for update to authenticated using (user_id = auth.uid()::text) with check (user_id = auth.uid()::text)';
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
      execute 'create policy reports_insert_authenticated on public.reports for insert to authenticated with check (user_id = auth.uid()::text)';
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
