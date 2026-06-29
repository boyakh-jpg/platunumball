create or replace function public.rankball_room_state_participant_ids(p_room_state jsonb)
returns table(profile_id text)
language sql
immutable
set search_path = public
as $$
  with room_state as (
    select coalesce(p_room_state, '{}'::jsonb) as value
  ),
  relation_values as (
    select relation_value.value as raw_value
    from room_state
    cross join lateral jsonb_array_elements_text('["partyLeaders","partyReserves","pinnedReservePlayers"]'::jsonb) as field(name)
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(room_state.value->field.name) = 'object' then room_state.value->field.name
        else '{}'::jsonb
      end
    ) as relation_value(key, value)
  ),
  raw_ids as (
    select raw_value #>> '{}' as profile_id
    from relation_values
    where jsonb_typeof(raw_value) = 'string'

    union all

    select array_value.profile_id
    from relation_values
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(raw_value) = 'array' then raw_value
        else '[]'::jsonb
      end
    ) as array_value(profile_id)

    union all

    select ready.key as profile_id
    from room_state
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(room_state.value->'reserveReady') = 'object' then room_state.value->'reserveReady'
        else '{}'::jsonb
      end
    ) as ready(key, value)
    where ready.value = 'true'::jsonb
  )
  select distinct nullif(btrim(profile_id), '') as profile_id
  from raw_ids
  where nullif(btrim(profile_id), '') is not null;
$$;

grant execute on function public.rankball_room_state_participant_ids(jsonb) to authenticated, service_role;

do $$
begin
  if to_regclass('public.profiles') is not null
    and to_regprocedure('public.rankball_refresh_profile_feed_dependency_trigger()') is not null then
    execute 'drop trigger if exists rankball_profiles_feed_dependency_refresh on public.profiles';
    execute 'create trigger rankball_profiles_feed_dependency_refresh after insert or update of id, name, handle, hashtag, position, region, region_sido, region_district, avatar_color or delete on public.profiles for each row execute function public.rankball_refresh_profile_feed_dependency_trigger()';
  end if;
end;
$$;
