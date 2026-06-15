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

  if to_regclass('public.affiliations') is not null then
    execute 'delete from public.affiliations where type = ''club''';
    execute 'alter table public.affiliations drop constraint if exists affiliations_type_check';
    execute 'alter table public.affiliations add constraint affiliations_type_check check (type in (''region'', ''school'', ''company''))';
  end if;
end;
$$;
