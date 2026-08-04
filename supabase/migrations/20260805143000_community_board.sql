begin;

create table if not exists public.community_posts (
  id uuid primary key default gen_random_uuid(),
  author_id text not null references public.profiles(id) on delete cascade,
  category text not null default 'general' check (category in ('general', 'notice')),
  title text not null check (char_length(btrim(title)) between 2 and 100),
  body text not null check (char_length(btrim(body)) between 2 and 5000),
  status text not null default 'published' check (status in ('published', 'deleted')),
  pinned boolean not null default false,
  like_count integer not null default 0 check (like_count >= 0),
  comment_count integer not null default 0 check (comment_count >= 0),
  deleted_by text references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_posts_pinned_notice_check check (not pinned or category = 'notice')
);

create table if not exists public.community_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.community_posts(id) on delete cascade,
  author_id text not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.community_comments(id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  status text not null default 'published' check (status in ('published', 'deleted')),
  deleted_by text references public.profiles(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_comments_not_self_parent check (parent_id is null or parent_id <> id)
);

create table if not exists public.community_post_likes (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id text not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists community_posts_feed_idx
  on public.community_posts (status, pinned desc, created_at desc);
create index if not exists community_posts_popular_idx
  on public.community_posts (status, category, created_at desc, like_count desc, comment_count desc);
create index if not exists community_posts_author_idx
  on public.community_posts (author_id, created_at desc);
create index if not exists community_comments_post_idx
  on public.community_comments (post_id, status, created_at);
create index if not exists community_comments_author_idx
  on public.community_comments (author_id, created_at desc);

create or replace function public.rankball_refresh_community_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  update public.community_posts
  set like_count = (
    select count(*)::integer
    from public.community_post_likes
    where post_id = target_post_id
  )
  where id = target_post_id;
  return coalesce(new, old);
end;
$$;

create or replace function public.rankball_refresh_community_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  update public.community_posts
  set comment_count = (
    select count(*)::integer
    from public.community_comments
    where post_id = target_post_id
      and status = 'published'
  )
  where id = target_post_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists community_post_likes_refresh_count on public.community_post_likes;
create trigger community_post_likes_refresh_count
after insert or delete on public.community_post_likes
for each row execute function public.rankball_refresh_community_like_count();

drop trigger if exists community_comments_refresh_count on public.community_comments;
create trigger community_comments_refresh_count
after insert or update of status or delete on public.community_comments
for each row execute function public.rankball_refresh_community_comment_count();

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_post_likes enable row level security;

revoke all on table public.community_posts from public, anon, authenticated;
revoke all on table public.community_comments from public, anon, authenticated;
revoke all on table public.community_post_likes from public, anon, authenticated;
grant all on table public.community_posts to service_role;
grant all on table public.community_comments to service_role;
grant all on table public.community_post_likes to service_role;

revoke all on function public.rankball_refresh_community_like_count() from public, anon, authenticated;
revoke all on function public.rankball_refresh_community_comment_count() from public, anon, authenticated;
grant execute on function public.rankball_refresh_community_like_count() to service_role;
grant execute on function public.rankball_refresh_community_comment_count() to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
