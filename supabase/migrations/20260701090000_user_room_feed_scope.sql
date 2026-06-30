-- Split personal room feed rows from public region feed rows.
-- Safe migration: no destructive table/data removal.

alter table public.user_room_feed
  add column if not exists feed_scope text;

update public.user_room_feed
set feed_scope = case
  when relation = 'region_public' then 'public'
  else 'profile'
end
where feed_scope is null
  or (relation = 'region_public' and feed_scope is distinct from 'public')
  or (relation <> 'region_public' and feed_scope is distinct from 'profile');

alter table public.user_room_feed
  alter column feed_scope set default 'profile';

alter table public.user_room_feed
  alter column feed_scope set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_room_feed'::regclass
      and conname = 'user_room_feed_scope_check'
  ) then
    alter table public.user_room_feed
      add constraint user_room_feed_scope_check
      check (feed_scope in ('profile', 'public')) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_room_feed'::regclass
      and conname = 'user_room_feed_scope_relation_check'
  ) then
    alter table public.user_room_feed
      add constraint user_room_feed_scope_relation_check
      check (
        (relation = 'region_public' and feed_scope = 'public')
        or (relation <> 'region_public' and feed_scope = 'profile')
      ) not valid;
  end if;
end;
$$;

alter table public.user_room_feed validate constraint user_room_feed_scope_check;
alter table public.user_room_feed validate constraint user_room_feed_scope_relation_check;

create index if not exists user_room_feed_scope_public_idx
  on public.user_room_feed (entity_type, feed_scope, relation, region_key, is_active, status, sort_at desc, entity_id desc);

create index if not exists user_room_feed_scope_profile_idx
  on public.user_room_feed (entity_type, feed_scope, profile_id, is_active, status, relation, entity_id);

drop policy if exists user_room_feed_select_related on public.user_room_feed;
create policy user_room_feed_select_related
on public.user_room_feed
for select
to authenticated
using (
  feed_scope = 'profile'
  and profile_id = public.current_profile_id()
);

comment on column public.user_room_feed.feed_scope is
  'profile rows are current-profile room feed. public rows are service-role region feed for public recruiting lists.';

create or replace function public.rankball_upsert_room_feed(
  p_profile_id text,
  p_entity_type text,
  p_entity_id text,
  p_relation text,
  p_region_key text,
  p_status text,
  p_visibility text,
  p_sort_at timestamptz,
  p_card_json jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_room_feed (
    profile_id,
    entity_type,
    entity_id,
    relation,
    feed_scope,
    region_key,
    status,
    visibility,
    sort_at,
    is_active,
    card_json,
    updated_at
  )
  values (
    nullif(btrim(p_profile_id), ''),
    p_entity_type,
    p_entity_id,
    p_relation,
    case when p_relation = 'region_public' then 'public' else 'profile' end,
    p_region_key,
    p_status,
    p_visibility,
    coalesce(p_sort_at, now()),
    true,
    coalesce(p_card_json, '{}'::jsonb),
    now()
  )
  on conflict (profile_id, entity_type, entity_id, relation)
  do update set
    feed_scope = excluded.feed_scope,
    region_key = excluded.region_key,
    status = excluded.status,
    visibility = excluded.visibility,
    sort_at = excluded.sort_at,
    is_active = true,
    card_json = excluded.card_json,
    updated_at = now();
$$;

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
      and feed_scope = 'profile'
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

create or replace function public.rankball_match_list(
  p_profile_id text,
  p_limit integer default 5,
  p_cursor text default '',
  p_active_only boolean default false
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  with params as (
    select
      nullif(btrim(p_profile_id), '') as profile_id,
      greatest(1, least(200, coalesce(p_limit, 5))) as row_limit,
      case
        when coalesce(p_cursor, '') like 'feed:%' and substring(coalesce(p_cursor, '') from 6) ~ '^[0-9]+$'
          then greatest(0, substring(coalesce(p_cursor, '') from 6)::integer)
        else 0
      end as row_offset
  ),
  grouped as (
    select
      feed.entity_id,
      max(feed.sort_at) as sort_at,
      max(feed.status) as status,
      coalesce(
        (array_agg(feed.card_json order by feed.sort_at desc, feed.relation))[1],
        '{}'::jsonb
      ) as card_json,
      jsonb_agg(distinct feed.relation) as relations
    from public.user_room_feed feed, params
    where feed.entity_type = 'match'
      and feed.feed_scope = 'profile'
      and feed.profile_id = params.profile_id
      and feed.is_active = true
      and coalesce(feed.status, '') <> 'closed'
      and (
        not coalesce(p_active_only, false)
        or coalesce(feed.status, '') not in ('confirmed', 'cancelled', 'void', 'closed')
      )
      and feed.relation in ('owner', 'participant', 'referee')
    group by feed.entity_id
  ),
  paged as (
    select grouped.*
    from grouped, params
    order by grouped.sort_at desc nulls last, grouped.entity_id desc
    offset (select row_offset from params)
    limit (select row_limit + 1 from params)
  ),
  numbered as (
    select
      paged.*,
      row_number() over (order by paged.sort_at desc nulls last, paged.entity_id desc) as rn
    from paged
  )
  select jsonb_build_object(
    'rows',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'entity_id', numbered.entity_id,
          'sort_at', numbered.sort_at,
          'status', numbered.status,
          'relations', numbered.relations,
          'card_json', numbered.card_json
        )
        order by numbered.sort_at desc nulls last, numbered.entity_id desc
      ) filter (where numbered.rn <= (select row_limit from params)),
      '[]'::jsonb
    ),
    'cursor',
    case
      when count(*) > (select row_limit from params) then 'feed:' || ((select row_offset from params) + (select row_limit from params))::text
      else ''
    end,
    'exhausted',
    count(*) <= (select row_limit from params)
  )
  from numbered, params;
$$;

revoke all on function public.rankball_match_list(text, integer, text, boolean) from public;
grant execute on function public.rankball_match_list(text, integer, text, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');
