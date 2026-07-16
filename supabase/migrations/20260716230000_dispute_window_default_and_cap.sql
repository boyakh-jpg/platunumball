-- Keep post-match dispute windows short by default and cap custom values.
alter table if exists public.matches
  alter column dispute_minutes set default 30;

alter table if exists public.recruiting_posts
  alter column dispute_minutes set default 30;

update public.matches
set dispute_minutes = least(60, greatest(1, coalesce(dispute_minutes, 30)))
where dispute_minutes is null or dispute_minutes < 1 or dispute_minutes > 60;

update public.recruiting_posts
set dispute_minutes = least(60, greatest(1, coalesce(dispute_minutes, 30)))
where dispute_minutes is null or dispute_minutes < 1 or dispute_minutes > 60;

alter table if exists public.matches
  drop constraint if exists matches_dispute_minutes_range;

alter table if exists public.matches
  add constraint matches_dispute_minutes_range
  check (dispute_minutes between 1 and 60);

alter table if exists public.recruiting_posts
  drop constraint if exists recruiting_posts_dispute_minutes_range;

alter table if exists public.recruiting_posts
  add constraint recruiting_posts_dispute_minutes_range
  check (dispute_minutes between 1 and 60);
