begin;

alter table public.community_posts
  add column if not exists image_path text;

alter table public.community_posts
  drop constraint if exists community_posts_category_check;
alter table public.community_posts
  add constraint community_posts_category_check
  check (category in ('general', 'question', 'photo', 'notice'));

alter table public.community_posts
  drop constraint if exists community_posts_image_path_check;
alter table public.community_posts
  add constraint community_posts_image_path_check
  check (
    (status = 'published' and category = 'photo' and image_path ~ '^posts/[0-9a-f-]{36}\.webp$')
    or ((status <> 'published' or category <> 'photo') and image_path is null)
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-post-images', 'community-post-images', true, 655360, array['image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

select pg_notify('pgrst', 'reload schema');

commit;
