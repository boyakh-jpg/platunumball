create or replace function public.rankball_normalize_hashtag(
  p_value text,
  p_fallback text default null
)
returns text
language sql
immutable
as $$
  select case
    when normalized.body = '' then null
    else '#' || normalized.body
  end
  from (
    select left(
      regexp_replace(
        regexp_replace(
          lower(coalesce(nullif(btrim(p_value), ''), nullif(btrim(p_fallback), ''), '')),
          '^[@#]+',
          ''
        ),
        '[^[:alnum:]_-]+',
        '',
        'g'
      ),
      20
    ) as body
  ) normalized
$$;

create or replace function public.rankball_profile_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_hashtag text;
  safe_region text;
  linked_discord_id text;
begin
  safe_hashtag := public.rankball_normalize_hashtag(new.hashtag, coalesce(new.handle, new.id));
  if safe_hashtag is not null then
    new.hashtag := safe_hashtag;
    new.handle := safe_hashtag;
  end if;

  safe_region := nullif(btrim(concat_ws(
    ' ',
    nullif(btrim(new.region_sido), ''),
    nullif(btrim(new.region_district), '')
  )), '');
  if safe_region is not null then
    new.region := safe_region;
  end if;

  if new.discord_connection is null then
    new.discord_user_id := null;
  elsif jsonb_typeof(new.discord_connection) = 'object' then
    linked_discord_id := nullif(btrim(coalesce(new.discord_connection->>'userId', new.discord_connection->>'id')), '');
    if coalesce(new.discord_connection->>'status', '') = 'linked' and linked_discord_id is not null then
      new.discord_user_id := linked_discord_id;
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'drop trigger if exists rankball_profiles_snapshot_guard on public.profiles';
    execute 'create trigger rankball_profiles_snapshot_guard before insert or update of handle, hashtag, region, region_sido, region_district, discord_connection, discord_user_id on public.profiles for each row execute function public.rankball_profile_snapshot_guard()';

    with normalized as (
      select
        id,
        public.rankball_normalize_hashtag(hashtag, coalesce(handle, id)) as normalized_hashtag,
        nullif(btrim(concat_ws(
          ' ',
          nullif(btrim(region_sido), ''),
          nullif(btrim(region_district), '')
        )), '') as normalized_region,
        case
          when discord_connection is null then null
          when jsonb_typeof(discord_connection) = 'object'
            and coalesce(discord_connection->>'status', '') = 'linked'
            and nullif(btrim(coalesce(discord_connection->>'userId', discord_connection->>'id')), '') is not null
            then nullif(btrim(coalesce(discord_connection->>'userId', discord_connection->>'id')), '')
          else discord_user_id
        end as normalized_discord_user_id
      from public.profiles
    )
    update public.profiles profile
    set
      handle = coalesce(normalized.normalized_hashtag, profile.handle),
      hashtag = coalesce(normalized.normalized_hashtag, profile.hashtag),
      region = coalesce(normalized.normalized_region, profile.region),
      discord_user_id = normalized.normalized_discord_user_id
    from normalized
    where profile.id = normalized.id
      and (
        (normalized.normalized_hashtag is not null and (
          profile.handle is distinct from normalized.normalized_hashtag
          or profile.hashtag is distinct from normalized.normalized_hashtag
        ))
        or (normalized.normalized_region is not null and profile.region is distinct from normalized.normalized_region)
        or profile.discord_user_id is distinct from normalized.normalized_discord_user_id
      );
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
