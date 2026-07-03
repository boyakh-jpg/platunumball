do $$
declare
  row_id text;
begin
  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in
      select id
      from public.recruiting_posts
      where coalesce(status, '') = 'open'
        and (
          lower(btrim(coalesce(scheduled_at, ''))) in ('instant', '즉시')
          or lower(btrim(coalesce(room_state->>'timingType', ''))) = 'instant'
        )
        and coalesce(created_at, now()) > now() - interval '120 minutes'
    loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
