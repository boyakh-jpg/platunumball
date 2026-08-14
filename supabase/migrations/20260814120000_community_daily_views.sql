begin;

create table if not exists public.community_post_daily_views (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id text references public.profiles(id) on delete cascade,
  viewer_key_hash text not null,
  view_date date not null default (timezone('Asia/Seoul', now()))::date,
  created_at timestamptz not null default now(),
  primary key (post_id, viewer_key_hash, view_date)
);

create index if not exists community_post_daily_views_user_idx
  on public.community_post_daily_views (user_id);

drop trigger if exists community_post_daily_views_increment_count on public.community_post_daily_views;
create trigger community_post_daily_views_increment_count
after insert on public.community_post_daily_views
for each row execute function public.rankball_increment_community_view_count();

alter table public.community_post_daily_views enable row level security;

revoke all on table public.community_post_daily_views from public, anon, authenticated;
grant all on table public.community_post_daily_views to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
