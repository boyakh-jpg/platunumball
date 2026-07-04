create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('player', 'team', 'court', 'referee')),
  target_id text not null,
  created_at timestamp with time zone not null default now()
);

alter table public.favorites
  add column if not exists id uuid default gen_random_uuid();

alter table public.favorites
  add column if not exists user_id text;

alter table public.favorites
  add column if not exists target_type text;

alter table public.favorites
  add column if not exists target_id text;

alter table public.favorites
  add column if not exists created_at timestamp with time zone not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'favorites_pkey'
      and conrelid = 'public.favorites'::regclass
  ) then
    alter table public.favorites add constraint favorites_pkey primary key (id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'favorites_user_id_fkey'
      and conrelid = 'public.favorites'::regclass
  ) then
    alter table public.favorites
      add constraint favorites_user_id_fkey
      foreign key (user_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'favorites_target_type_check'
      and conrelid = 'public.favorites'::regclass
  ) then
    alter table public.favorites
      add constraint favorites_target_type_check
      check (target_type in ('player', 'team', 'court', 'referee'));
  end if;
end $$;

create unique index if not exists favorites_user_target_unique
  on public.favorites (user_id, target_type, target_id);

create index if not exists favorites_user_type_idx
  on public.favorites (user_id, target_type);

alter table public.favorites enable row level security;

drop policy if exists "favorites_select_own" on public.favorites;
create policy "favorites_select_own"
  on public.favorites
  for select
  using (
    user_id in (
      select profiles.id
      from public.profiles
      where profiles.auth_user_id = auth.uid()
    )
  );

drop policy if exists "favorites_insert_own" on public.favorites;
create policy "favorites_insert_own"
  on public.favorites
  for insert
  with check (
    user_id in (
      select profiles.id
      from public.profiles
      where profiles.auth_user_id = auth.uid()
    )
  );

drop policy if exists "favorites_delete_own" on public.favorites;
create policy "favorites_delete_own"
  on public.favorites
  for delete
  using (
    user_id in (
      select profiles.id
      from public.profiles
      where profiles.auth_user_id = auth.uid()
    )
  );
