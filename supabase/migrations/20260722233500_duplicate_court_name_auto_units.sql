begin;

create or replace function public.rankball_court_unit_number(raw_unit text)
returns integer
language plpgsql
immutable
as $$
declare
  safe_unit text := public.rankball_normalize_court_name(raw_unit);
  matched text;
begin
  matched := substring(safe_unit from '^([1-9][0-9]*)코트$');
  return case when matched is null then null else matched::integer end;
end;
$$;

create or replace function public.rankball_prepare_duplicate_court_unit(
  p_court_id text,
  p_sigungu text,
  p_facility_name text,
  p_court_unit text,
  p_actor_profile_id text,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row public.approved_courts%rowtype;
  peer_row public.approved_courts%rowtype;
  updated_row public.approved_courts%rowtype;
  safe_sigungu text;
  safe_facility text;
  safe_unit text := public.rankball_normalize_court_name(p_court_unit);
  safe_actor text := coalesce(nullif(btrim(coalesce(p_actor_profile_id, '')), ''), 'system');
  safe_reason text := coalesce(nullif(btrim(coalesce(p_reason, '')), ''), '중복 구장명 자동 코트 구분');
  group_key text;
  next_no integer;
  previous_name text;
  actor_name text;
  now_ts timestamptz := clock_timestamp();
begin
  select * into court_row
  from public.approved_courts
  where id = p_court_id
  for update;
  if not found then
    raise exception 'court_not_found' using errcode = 'P0002';
  end if;

  if safe_unit is not null then return safe_unit; end if;

  safe_sigungu := public.rankball_normalize_court_name(coalesce(p_sigungu, court_row.sigungu));
  safe_facility := public.rankball_court_facility_base(
    coalesce(p_facility_name, court_row.facility_name),
    safe_sigungu,
    null
  );
  if safe_sigungu is null or safe_facility is null then return null; end if;

  group_key := lower(regexp_replace(safe_sigungu || '|' || safe_facility, '[[:space:]]+', '', 'g'));
  perform pg_advisory_xact_lock(hashtextextended('rankball:court-name-unit:' || group_key, 0));

  if not exists (
    select 1
    from public.approved_courts other
    where other.id <> p_court_id
      and coalesce(other.status, 'active') <> 'disabled'
      and lower(regexp_replace(
        coalesce(other.sigungu, '') || '|' || coalesce(other.facility_name, ''),
        '[[:space:]]+', '', 'g'
      )) = group_key
      and (
        nullif(btrim(coalesce(other.court_unit, '')), '') is null
        or public.rankball_court_unit_number(other.court_unit) is not null
      )
  ) then
    return null;
  end if;

  select coalesce(max(public.rankball_court_unit_number(other.court_unit)), 0)
  into next_no
  from public.approved_courts other
  where lower(regexp_replace(
    coalesce(other.sigungu, '') || '|' || coalesce(other.facility_name, ''),
    '[[:space:]]+', '', 'g'
  )) = group_key;

  select coalesce(nullif(name, ''), safe_actor)
  into actor_name
  from public.profiles
  where id = safe_actor;
  actor_name := coalesce(actor_name, safe_actor);

  for peer_row in
    select other.*
    from public.approved_courts other
    where other.id <> p_court_id
      and coalesce(other.status, 'active') <> 'disabled'
      and lower(regexp_replace(
        coalesce(other.sigungu, '') || '|' || coalesce(other.facility_name, ''),
        '[[:space:]]+', '', 'g'
      )) = group_key
      and nullif(btrim(coalesce(other.court_unit, '')), '') is null
    order by other.created_at nulls first, other.id
    for update
  loop
    next_no := next_no + 1;
    previous_name := peer_row.name;

    update public.approved_courts
    set court_unit = next_no::text || '코트',
        name_source = 'manual',
        name_modified_at = now_ts,
        name_modified_by = safe_actor,
        updated_at = now_ts
    where id = peer_row.id
    returning * into updated_row;

    if updated_row.name is distinct from previous_name then
      update public.matches set court_name = updated_row.name
      where court_id = updated_row.id and court_name is distinct from updated_row.name;
      update public.recruiting_posts set court_name = updated_row.name
      where court_id = updated_row.id and court_name is distinct from updated_row.name;
      update public.tournaments set court_name = updated_row.name
      where court_id = updated_row.id and court_name is distinct from updated_row.name;
      update public.court_reviews set court_name = updated_row.name
      where court_id = updated_row.id and court_name is distinct from updated_row.name;

      insert into public.court_name_change_log (
        id, court_id, sigungu, previous_name, new_name, facility_name, reason,
        changed_by, changed_by_name, change_source, created_at
      ) values (
        'court_name_' || md5(updated_row.id || now_ts::text || next_no::text || safe_actor),
        updated_row.id, updated_row.sigungu, previous_name, updated_row.name,
        updated_row.facility_name, safe_reason || ' · ' || next_no::text || '코트 자동 지정',
        safe_actor, actor_name, 'admin', now_ts
      );

      insert into public.admin_audit_log (
        id, type, status, target_user_id, created_by, payload, created_at
      ) values (
        'aa_' || md5('court-auto-unit:' || updated_row.id || now_ts::text || next_no::text),
        'court_database_auto_unit', 'committed', null, safe_actor,
        jsonb_build_object(
          'courtId', updated_row.id,
          'actorName', actor_name,
          'reason', safe_reason,
          'changes', jsonb_build_object(
            'name', jsonb_build_object('before', previous_name, 'after', updated_row.name),
            'courtUnit', jsonb_build_object('before', null, 'after', updated_row.court_unit)
          )
        ),
        now_ts
      );
    end if;
  end loop;

  return (next_no + 1)::text || '코트';
end;
$$;

create or replace function public.rankball_admin_update_court_with_auto_unit(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_court_id text,
  p_patch jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row public.approved_courts%rowtype;
  safe_patch jsonb := case when jsonb_typeof(p_patch) = 'object' then p_patch else '{}'::jsonb end;
  effective_patch jsonb;
  desired_facility text;
  desired_sigungu text;
  desired_unit text;
  auto_unit text;
  result jsonb;
begin
  select * into court_row from public.approved_courts where id = p_court_id for update;
  if not found then raise exception 'court_not_found' using errcode = 'P0002'; end if;

  desired_facility := case when safe_patch ? 'facilityName' then safe_patch ->> 'facilityName' else court_row.facility_name end;
  desired_sigungu := case when safe_patch ? 'sigungu' then safe_patch ->> 'sigungu' else court_row.sigungu end;
  desired_unit := case when safe_patch ? 'courtUnit' then safe_patch ->> 'courtUnit' else court_row.court_unit end;
  auto_unit := public.rankball_prepare_duplicate_court_unit(
    p_court_id, desired_sigungu, desired_facility, desired_unit, p_actor_profile_id, p_reason
  );
  effective_patch := safe_patch;
  if nullif(btrim(coalesce(desired_unit, '')), '') is null and auto_unit is not null then
    effective_patch := effective_patch || jsonb_build_object('courtUnit', auto_unit);
  end if;

  result := public.rankball_admin_update_court(
    p_actor_profile_id, p_actor_admin_level, p_court_id, effective_patch, p_reason
  );
  return result || jsonb_build_object('autoCourtUnit', auto_unit);
end;
$$;

create or replace function public.rankball_admin_update_courts_batch_with_auto_unit(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_updates jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  update_item jsonb;
  update_result jsonb;
  results jsonb := '[]'::jsonb;
  update_count integer := 0;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_updates) is distinct from 'array'
    or jsonb_array_length(p_updates) < 1
    or jsonb_array_length(p_updates) > 100
    or pg_column_size(p_updates) > 524288 then
    raise exception 'court_batch_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_updates) as items(item)
    where jsonb_typeof(item) is distinct from 'object'
      or nullif(btrim(coalesce(item->>'courtId', '')), '') is null
      or jsonb_typeof(item->'patch') is distinct from 'object'
      or item->'patch' = '{}'::jsonb
      or pg_column_size(item->'patch') > 32768
  ) or exists (
    select 1 from jsonb_array_elements(p_updates) as items(item)
    group by item->>'courtId' having count(*) > 1
  ) then
    raise exception 'court_batch_item_invalid' using errcode = '22023';
  end if;

  for update_item in select item from jsonb_array_elements(p_updates) as items(item)
  loop
    update_result := public.rankball_admin_update_court_with_auto_unit(
      p_actor_profile_id, p_actor_admin_level, update_item->>'courtId', update_item->'patch', p_reason
    );
    results := results || jsonb_build_array(update_result);
    update_count := update_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'updatedCount', update_count, 'results', results);
end;
$$;

create or replace function public.rankball_admin_review_court_with_auto_unit(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_court_id text,
  p_scenario text,
  p_patch jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  court_row public.approved_courts%rowtype;
  safe_patch jsonb := case when jsonb_typeof(p_patch) = 'object' then p_patch else '{}'::jsonb end;
  effective_patch jsonb := safe_patch;
  desired_facility text;
  desired_sigungu text;
  desired_unit text;
  auto_unit text;
  result jsonb;
begin
  select * into court_row from public.approved_courts where id = p_court_id for update;
  if not found then raise exception 'court_not_found' using errcode = 'P0002'; end if;

  if btrim(coalesce(p_scenario, '')) not in ('regional_alias', 'closed', 'duplicate') then
    desired_facility := case when safe_patch ? 'facilityName' then safe_patch ->> 'facilityName' else court_row.facility_name end;
    desired_sigungu := case when safe_patch ? 'sigungu' then safe_patch ->> 'sigungu' else court_row.sigungu end;
    desired_unit := case when safe_patch ? 'courtUnit' then safe_patch ->> 'courtUnit' else court_row.court_unit end;
    auto_unit := public.rankball_prepare_duplicate_court_unit(
      p_court_id, desired_sigungu, desired_facility, desired_unit, p_actor_profile_id, p_reason
    );
    if nullif(btrim(coalesce(desired_unit, '')), '') is null and auto_unit is not null then
      effective_patch := effective_patch || jsonb_build_object('courtUnit', auto_unit);
    end if;
  end if;

  result := public.rankball_admin_review_court(
    p_actor_profile_id, p_actor_admin_level, p_court_id, p_scenario, effective_patch, p_reason
  );
  return result || jsonb_build_object('autoCourtUnit', auto_unit);
end;
$$;

revoke all on function public.rankball_court_unit_number(text) from public, anon, authenticated;
revoke all on function public.rankball_prepare_duplicate_court_unit(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_admin_update_court_with_auto_unit(text, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.rankball_admin_update_courts_batch_with_auto_unit(text, integer, jsonb, text) from public, anon, authenticated;
revoke all on function public.rankball_admin_review_court_with_auto_unit(text, integer, text, text, jsonb, text) from public, anon, authenticated;

grant execute on function public.rankball_admin_update_court_with_auto_unit(text, integer, text, jsonb, text) to service_role;
grant execute on function public.rankball_admin_update_courts_batch_with_auto_unit(text, integer, jsonb, text) to service_role;
grant execute on function public.rankball_admin_review_court_with_auto_unit(text, integer, text, text, jsonb, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
