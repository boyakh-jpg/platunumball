do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if to_regclass('public.recruiting_posts') is not null then
      begin
        alter publication supabase_realtime add table public.recruiting_posts;
      exception
        when duplicate_object then null;
      end;
    end if;

    if to_regclass('public.recruiting_applications') is not null then
      begin
        alter publication supabase_realtime add table public.recruiting_applications;
      exception
        when duplicate_object then null;
      end;
    end if;
  end if;
end $$;
