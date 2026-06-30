create or replace function public.rankball_recruiting_feed_counts(p_profile_id text)
returns table(created bigint, joined bigint, invited bigint)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select entity_id, relation
    from public.user_room_feed
    where profile_id = nullif(btrim(p_profile_id), '')
      and entity_type = 'recruiting'
      and is_active = true
      and status = 'open'
      and relation in ('owner', 'participant', 'invited', 'referee')
  ),
  owned as (
    select distinct entity_id
    from scoped
    where relation = 'owner'
  ),
  joined_rows as (
    select distinct scoped.entity_id
    from scoped
    where scoped.relation in ('participant', 'referee')
      and not exists (
        select 1
        from owned
        where owned.entity_id = scoped.entity_id
      )
  ),
  invited_rows as (
    select distinct entity_id
    from scoped
    where relation = 'invited'
  )
  select
    (select count(*) from owned)::bigint as created,
    (select count(*) from joined_rows)::bigint as joined,
    (select count(*) from invited_rows)::bigint as invited;
$$;

revoke all on function public.rankball_recruiting_feed_counts(text) from public;
grant execute on function public.rankball_recruiting_feed_counts(text) to service_role;
