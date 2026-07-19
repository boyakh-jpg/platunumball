do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'recruiting_posts'
    ) then
      alter publication supabase_realtime drop table public.recruiting_posts;
    end if;

    if exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'recruiting_applications'
    ) then
      alter publication supabase_realtime drop table public.recruiting_applications;
    end if;
  end if;
end
$$;
