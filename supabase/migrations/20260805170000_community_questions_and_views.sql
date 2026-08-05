begin;

alter table public.community_posts
  add column if not exists view_count integer not null default 0;

alter table public.community_posts
  drop constraint if exists community_posts_category_check;
alter table public.community_posts
  add constraint community_posts_category_check check (category in ('general', 'question', 'notice'));

alter table public.community_posts
  drop constraint if exists community_posts_view_count_check;
alter table public.community_posts
  add constraint community_posts_view_count_check check (view_count >= 0);

create table if not exists public.community_post_views (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_post_views_user_idx
  on public.community_post_views (user_id);

create or replace function public.rankball_increment_community_view_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.community_posts
  set view_count = view_count + 1
  where id = new.post_id;
  return new;
end;
$$;

drop trigger if exists community_post_views_increment_count on public.community_post_views;
create trigger community_post_views_increment_count
after insert on public.community_post_views
for each row execute function public.rankball_increment_community_view_count();

alter table public.community_post_views enable row level security;

revoke all on table public.community_post_views from public, anon, authenticated;
grant all on table public.community_post_views to service_role;

revoke all on function public.rankball_increment_community_view_count() from public, anon, authenticated;
grant execute on function public.rankball_increment_community_view_count() to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
