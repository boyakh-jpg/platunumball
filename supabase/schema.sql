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

  if to_regclass('public.affiliations') is not null then
    execute 'delete from public.affiliations where type = ''club''';
    execute 'alter table public.affiliations drop constraint if exists affiliations_type_check';
    execute 'alter table public.affiliations add constraint affiliations_type_check check (type in (''region'', ''school'', ''company''))';
  end if;

  if to_regclass('public.recruiting_posts') is not null then
    execute 'alter table public.recruiting_posts add column if not exists host_join_mode text not null default ''team''';
    execute 'alter table public.recruiting_posts add column if not exists host_side text not null default ''teamA''';
    execute 'alter table public.recruiting_posts add column if not exists host_ready boolean not null default false';
    execute 'alter table public.recruiting_posts add column if not exists side_capacity integer not null default 5';
    execute 'alter table public.recruiting_posts add column if not exists target_team_id text';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_date date';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_time time';
    execute 'alter table public.recruiting_posts add column if not exists scheduled_at text';
    execute 'alter table public.recruiting_posts add column if not exists confirmed_at timestamptz';
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
    execute 'alter table public.recruiting_applications add column if not exists updated_at timestamptz';
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_side_check';
    execute 'alter table public.recruiting_applications add constraint recruiting_applications_side_check check (side in (''teamA'', ''teamB''))';
    execute 'alter table public.recruiting_applications drop constraint if exists recruiting_applications_status_check';
    execute 'alter table public.recruiting_applications add constraint recruiting_applications_status_check check (status in (''waiting'', ''ready'', ''confirmed''))';
    execute 'create index if not exists recruiting_applications_post_side_idx on public.recruiting_applications (post_id, side, reserve)';
  end if;
end;
$$;
