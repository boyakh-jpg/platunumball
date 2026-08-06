begin;

alter table public.community_posts
  drop constraint if exists community_posts_category_check;
alter table public.community_posts
  add constraint community_posts_category_check
  check (category in ('general', 'question', 'team', 'photo', 'notice'));

select pg_notify('pgrst', 'reload schema');

commit;
