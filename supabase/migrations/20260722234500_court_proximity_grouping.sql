begin;

alter table public.approved_courts
  add column if not exists proximity_group_id text,
  add column if not exists verified_court_count integer,
  add column if not exists court_count_verified_at timestamptz,
  add column if not exists court_count_verified_by text,
  add column if not exists proximity_excess boolean not null default false,
  add column if not exists proximity_previous_status text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'approved_courts_verified_court_count_check'
      and conrelid = 'public.approved_courts'::regclass
  ) then
    alter table public.approved_courts
      add constraint approved_courts_verified_court_count_check
      check (verified_court_count is null or verified_court_count >= 1) not valid;
  end if;
end $$;

create index if not exists approved_courts_coordinate_lookup_idx
on public.approved_courts (lat, lng)
where lat is not null and lng is not null and coalesce(status, 'active') = 'active';

create index if not exists approved_courts_proximity_group_idx
on public.approved_courts (proximity_group_id, proximity_excess, created_at, id)
where proximity_group_id is not null;

create or replace function public.rankball_court_distance_m(
  p_lat_a double precision,
  p_lng_a double precision,
  p_lat_b double precision,
  p_lng_b double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select case
    when p_lat_a is null or p_lng_a is null or p_lat_b is null or p_lng_b is null then null
    else 12742000.0 * asin(sqrt(least(1.0,
      power(sin(radians(p_lat_b - p_lat_a) / 2.0), 2)
      + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
      * power(sin(radians(p_lng_b - p_lng_a) / 2.0), 2)
    )))
  end;
$$;

create or replace function public.rankball_nearby_court_component(p_court_id text)
returns table(court_id text, distance_m double precision)
language sql
stable
security definer
set search_path = public
as $$
  with recursive anchor as (
    select id, lat::double precision as lat, lng::double precision as lng
    from public.approved_courts
    where id = p_court_id
      and lat is not null and lng is not null
      and coalesce(status, 'active') = 'active'
  ), component(court_id) as (
    select id from anchor
    union
    select candidate.id
    from component member
    join public.approved_courts origin on origin.id = member.court_id
    join public.approved_courts candidate
      on candidate.id <> origin.id
      and candidate.lat is not null and candidate.lng is not null
      and coalesce(candidate.status, 'active') = 'active'
      and candidate.lat between origin.lat - 0.00028 and origin.lat + 0.00028
      and candidate.lng between origin.lng - 0.00036 and origin.lng + 0.00036
      and public.rankball_court_distance_m(
        origin.lat::double precision, origin.lng::double precision,
        candidate.lat::double precision, candidate.lng::double precision
      ) <= 30.0
  )
  select component.court_id,
    public.rankball_court_distance_m(
      anchor.lat, anchor.lng,
      court.lat::double precision, court.lng::double precision
    ) as distance_m
  from component
  cross join anchor
  join public.approved_courts court on court.id = component.court_id;
$$;

create or replace function public.rankball_admin_auto_group_nearby_courts(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_court_id text,
  p_facility_name text default null,
  p_reason text default '30m 근접 구장 자동 병합'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  court_ids text[];
  existing_group_id text;
  group_id text;
  safe_facility text;
  actor_name text;
  before_rows jsonb;
  changed_row record;
  before_row jsonb;
  now_ts timestamptz := clock_timestamp();
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  select proximity_group_id into existing_group_id
  from public.approved_courts where id = p_court_id;

  select array_agg(candidate.court_id order by candidate.court_id)
  into court_ids
  from (
    select component.court_id
    from public.rankball_nearby_court_component(p_court_id) component
    union
    select court.id
    from public.approved_courts court
    where existing_group_id is not null
      and court.proximity_group_id = existing_group_id
      and (coalesce(court.status, 'active') = 'active' or court.proximity_excess)
    union
    select peer.id
    from public.approved_courts peer
    where coalesce(peer.status, 'active') = 'active'
      and exists (
        select 1
        from public.rankball_nearby_court_component(p_court_id) component
        join public.approved_courts source on source.id = component.court_id
        where lower(regexp_replace(
            coalesce(nullif(peer.road_address, ''), nullif(peer.jibun_address, ''), peer.address_text),
            '[[:space:]]+', '', 'g'
          )) = lower(regexp_replace(
            coalesce(nullif(source.road_address, ''), nullif(source.jibun_address, ''), source.address_text),
            '[[:space:]]+', '', 'g'
          ))
          and lower(regexp_replace(
            coalesce(peer.sigungu, '') || '|' || coalesce(peer.facility_name, ''),
            '[[:space:]]+', '', 'g'
          )) = lower(regexp_replace(
            coalesce(source.sigungu, '') || '|' || coalesce(source.facility_name, ''),
            '[[:space:]]+', '', 'g'
          ))
      )
  ) candidate;
  if coalesce(array_length(court_ids, 1), 0) = 0 then
    raise exception 'court_not_found_or_coordinates_missing' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rankball:court-proximity:' || array_to_string(court_ids, '|'), 0));
  perform 1 from public.approved_courts where id = any(court_ids) order by id for update;

  if array_length(court_ids, 1) = 1 then
    return jsonb_build_object(
      'ok', true,
      'groupId', null,
      'detectedCount', 1,
      'actualCount', (select verified_court_count from public.approved_courts where id = p_court_id),
      'courts', (
        select jsonb_agg(jsonb_build_object(
          'id', court.id, 'name', court.name, 'facilityName', court.facility_name,
          'courtUnit', court.court_unit, 'status', court.status, 'distanceM', 0
        )) from public.approved_courts court where court.id = p_court_id
      )
    );
  end if;

  group_id := 'court_group_' || md5(array_to_string(court_ids, '|'));
  safe_facility := public.rankball_court_facility_base(p_facility_name, null, null);
  if safe_facility is null then
    select public.rankball_court_facility_base(court.facility_name, court.sigungu, court.court_unit)
    into safe_facility
    from public.approved_courts court
    where court.id = any(court_ids)
    order by
      case when court.name_source = 'manual' then 0 else 1 end,
      case when court.registration_origin = 'user_request' then 0 else 1 end,
      coalesce(court.name_modification_count, 0) desc,
      court.created_at nulls last,
      court.id
    limit 1;
  end if;
  if safe_facility is null then
    raise exception 'court_facility_name_required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from (
      select court.id,
        row_number() over (order by court.created_at nulls first, court.id)::integer as unit_no
      from public.approved_courts court
      where court.id = any(court_ids)
    ) expected
    join public.approved_courts court on court.id = expected.id
    where court.proximity_group_id is distinct from group_id
      or court.facility_name is distinct from safe_facility
      or court.court_unit is distinct from expected.unit_no::text || '코트'
  ) then
    return jsonb_build_object(
      'ok', true,
      'groupId', group_id,
      'detectedCount', array_length(court_ids, 1),
      'actualCount', (
        select max(court.verified_court_count)
        from public.approved_courts court where court.id = any(court_ids)
      ),
      'courts', (
        select jsonb_agg(jsonb_build_object(
          'id', court.id, 'name', court.name, 'facilityName', court.facility_name,
          'courtUnit', court.court_unit, 'status', court.status,
          'proximityExcess', court.proximity_excess,
          'distanceM', round(public.rankball_court_distance_m(
            anchor.lat::double precision, anchor.lng::double precision,
            court.lat::double precision, court.lng::double precision
          )::numeric, 1)
        ) order by court.proximity_excess, public.rankball_court_distance_m(
          anchor.lat::double precision, anchor.lng::double precision,
          court.lat::double precision, court.lng::double precision
        ), court.id)
        from public.approved_courts anchor
        join public.approved_courts court on court.id = any(court_ids)
        where anchor.id = p_court_id
      )
    );
  end if;

  select jsonb_object_agg(court.id, to_jsonb(court))
  into before_rows
  from public.approved_courts court
  where court.id = any(court_ids);

  -- The active-court identity trigger observes rows one at a time. Hide the locked
  -- group inside this transaction so every final unique unit can be assigned first.
  update public.approved_courts
  set status = 'hidden'
  where id = any(court_ids);

  with ordered as (
    select court.id,
      row_number() over (order by court.created_at nulls first, court.id)::integer as unit_no
    from public.approved_courts court
    where court.id = any(court_ids)
  )
  update public.approved_courts court
  set facility_name = safe_facility,
      court_unit = ordered.unit_no::text || '코트',
      proximity_group_id = group_id,
      proximity_excess = case when court.proximity_group_id = existing_group_id then court.proximity_excess else false end,
      proximity_previous_status = case when court.proximity_group_id = existing_group_id then court.proximity_previous_status else null end,
      name_source = 'manual',
      name_modified_at = now_ts,
      name_modified_by = p_actor_profile_id,
      updated_at = now_ts
  from ordered
  where court.id = ordered.id;

  update public.approved_courts court
  set status = coalesce(before_rows -> court.id ->> 'status', 'active')
  where court.id = any(court_ids);

  select coalesce(nullif(name, ''), p_actor_profile_id)
  into actor_name from public.profiles where id = p_actor_profile_id;
  actor_name := coalesce(actor_name, p_actor_profile_id, '관리자');

  for changed_row in
    select court.* from public.approved_courts court where court.id = any(court_ids)
  loop
    before_row := before_rows -> changed_row.id;
    if before_row ->> 'name' is distinct from changed_row.name then
      update public.matches set court_name = changed_row.name
      where court_id = changed_row.id and court_name is distinct from changed_row.name;
      update public.recruiting_posts set court_name = changed_row.name
      where court_id = changed_row.id and court_name is distinct from changed_row.name;
      update public.tournaments set court_name = changed_row.name
      where court_id = changed_row.id and court_name is distinct from changed_row.name;
      update public.court_reviews set court_name = changed_row.name
      where court_id = changed_row.id and court_name is distinct from changed_row.name;

      insert into public.court_name_change_log (
        id, court_id, sigungu, previous_name, new_name, facility_name, reason,
        changed_by, changed_by_name, change_source, created_at
      ) values (
        'court_name_' || md5('proximity:' || changed_row.id || now_ts::text),
        changed_row.id, changed_row.sigungu, before_row ->> 'name', changed_row.name,
        changed_row.facility_name, p_reason, p_actor_profile_id, actor_name, 'admin', now_ts
      );
    end if;
  end loop;

  insert into public.admin_audit_log (
    id, type, status, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5('court-proximity-group:' || group_id || now_ts::text),
    'court_proximity_auto_group', 'committed', null, p_actor_profile_id,
    jsonb_build_object(
      'groupId', group_id, 'anchorCourtId', p_court_id, 'detectedCount', array_length(court_ids, 1),
      'courtIds', to_jsonb(court_ids), 'facilityName', safe_facility, 'reason', p_reason
    ), now_ts
  );

  return jsonb_build_object(
    'ok', true,
    'groupId', group_id,
    'detectedCount', array_length(court_ids, 1),
    'actualCount', (
      select max(court.verified_court_count)
      from public.approved_courts court where court.id = any(court_ids)
    ),
    'courts', (
      select jsonb_agg(jsonb_build_object(
        'id', court.id, 'name', court.name, 'facilityName', court.facility_name,
        'courtUnit', court.court_unit, 'status', court.status,
        'proximityExcess', court.proximity_excess,
        'distanceM', round(public.rankball_court_distance_m(
          anchor.lat::double precision, anchor.lng::double precision,
          court.lat::double precision, court.lng::double precision
        )::numeric, 1)
      ) order by court.proximity_excess, public.rankball_court_distance_m(
        anchor.lat::double precision, anchor.lng::double precision,
        court.lat::double precision, court.lng::double precision
      ), court.id)
      from public.approved_courts anchor
      join public.approved_courts court on court.id = any(court_ids)
      where anchor.id = p_court_id
    )
  );
end;
$$;

create or replace function public.rankball_admin_verify_nearby_court_count(
  p_actor_profile_id text,
  p_actor_admin_level integer,
  p_court_id text,
  p_actual_count integer,
  p_facility_name text default null,
  p_patch jsonb default '{}'::jsonb,
  p_reason text default '30m 근접 구장 실제 코트 수 검증'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  grouped jsonb;
  group_id text;
  total_rows integer;
  kept_rows integer;
  disabled_rows integer;
  actor_name text;
  safe_patch jsonb := case when jsonb_typeof(p_patch) = 'object' then p_patch else '{}'::jsonb end;
  property_patch jsonb;
  before_rows jsonb;
  changed_row record;
  before_row jsonb;
  now_ts timestamptz := clock_timestamp();
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;
  if p_actual_count is null or p_actual_count < 1 then
    raise exception 'court_actual_count_invalid' using errcode = '22023';
  end if;
  if pg_column_size(safe_patch) > 32768 then
    raise exception 'court_patch_invalid' using errcode = '22023';
  end if;

  property_patch := safe_patch - 'facilityName' - 'courtUnit';
  if property_patch <> '{}'::jsonb then
    perform public.rankball_admin_update_court(
      p_actor_profile_id, p_actor_admin_level, p_court_id, property_patch, p_reason
    );
  end if;

  grouped := public.rankball_admin_auto_group_nearby_courts(
    p_actor_profile_id, p_actor_admin_level, p_court_id, p_facility_name, p_reason
  );
  group_id := grouped ->> 'groupId';

  if group_id is null then
    update public.approved_courts
    set verified_court_count = p_actual_count,
        court_count_verified_at = now_ts,
        court_count_verified_by = p_actor_profile_id,
        court_unit = case when p_actual_count = 1 then null else court_unit end,
        updated_at = now_ts
    where id = p_court_id;
    total_rows := 1;
    kept_rows := 1;
    disabled_rows := 0;
  else
    perform 1 from public.approved_courts where proximity_group_id = group_id order by id for update;

    select jsonb_object_agg(court.id, to_jsonb(court))
    into before_rows
    from public.approved_courts court
    where court.proximity_group_id = group_id
      and (coalesce(court.status, 'active') = 'active' or court.proximity_excess);

    with ranked as (
      select court.id,
        row_number() over (
          order by case when court.id = p_court_id then 0 else 1 end,
            court.proximity_excess, court.created_at nulls first, court.id
        )::integer as unit_no
      from public.approved_courts court
      where court.proximity_group_id = group_id
        and (coalesce(court.status, 'active') = 'active' or court.proximity_excess)
    )
    update public.approved_courts court
    set status = case
          when ranked.unit_no <= p_actual_count then coalesce(nullif(court.proximity_previous_status, 'disabled'), 'active')
          else 'disabled'
        end,
        verification_status = 'verified',
        court_unit = case
          when ranked.unit_no <= p_actual_count and p_actual_count = 1 then null
          else ranked.unit_no::text || '코트'
        end,
        proximity_excess = ranked.unit_no > p_actual_count,
        proximity_previous_status = case
          when ranked.unit_no > p_actual_count and not court.proximity_excess then coalesce(court.status, 'active')
          when ranked.unit_no <= p_actual_count then null
          else court.proximity_previous_status
        end,
        verified_court_count = p_actual_count,
        court_count_verified_at = now_ts,
        court_count_verified_by = p_actor_profile_id,
        admin_review_count = coalesce(court.admin_review_count, 0) + 1,
        admin_reviewed_at = now_ts,
        admin_reviewed_by = p_actor_profile_id,
        admin_review_scenario = case when ranked.unit_no > p_actual_count then 'duplicate' else 'manual' end,
        updated_at = now_ts
    from ranked
    where court.id = ranked.id;

    select count(*), count(*) filter (where not proximity_excess), count(*) filter (where proximity_excess)
    into total_rows, kept_rows, disabled_rows
    from public.approved_courts
    where proximity_group_id = group_id
      and (coalesce(status, 'active') = 'active' or proximity_excess);
  end if;

  select coalesce(nullif(name, ''), p_actor_profile_id)
  into actor_name from public.profiles where id = p_actor_profile_id;
  actor_name := coalesce(actor_name, p_actor_profile_id, '관리자');

  if before_rows is not null then
    for changed_row in
      select court.* from public.approved_courts court
      where court.proximity_group_id = group_id
        and (coalesce(court.status, 'active') = 'active' or court.proximity_excess)
    loop
      before_row := before_rows -> changed_row.id;
      if before_row ->> 'name' is distinct from changed_row.name then
        update public.matches set court_name = changed_row.name
        where court_id = changed_row.id and court_name is distinct from changed_row.name;
        update public.recruiting_posts set court_name = changed_row.name
        where court_id = changed_row.id and court_name is distinct from changed_row.name;
        update public.tournaments set court_name = changed_row.name
        where court_id = changed_row.id and court_name is distinct from changed_row.name;
        update public.court_reviews set court_name = changed_row.name
        where court_id = changed_row.id and court_name is distinct from changed_row.name;

        insert into public.court_name_change_log (
          id, court_id, sigungu, previous_name, new_name, facility_name, reason,
          changed_by, changed_by_name, change_source, created_at
        ) values (
          'court_name_' || md5('count-verify:' || changed_row.id || now_ts::text),
          changed_row.id, changed_row.sigungu, before_row ->> 'name', changed_row.name,
          changed_row.facility_name, p_reason, p_actor_profile_id, actor_name, 'admin', now_ts
        );
      end if;
    end loop;
  end if;

  insert into public.admin_audit_log (
    id, type, status, target_user_id, created_by, payload, created_at
  ) values (
    'aa_' || md5('court-count-verify:' || p_court_id || now_ts::text),
    'court_proximity_count_verify', 'committed', null, p_actor_profile_id,
    jsonb_build_object(
      'groupId', group_id, 'anchorCourtId', p_court_id, 'actualCount', p_actual_count,
      'databaseRowCount', total_rows, 'keptRowCount', kept_rows,
      'disabledDuplicateCount', disabled_rows, 'missingRowCount', greatest(p_actual_count - total_rows, 0),
      'actorName', actor_name, 'reason', p_reason
    ), now_ts
  );

  return jsonb_build_object(
    'ok', true, 'groupId', group_id, 'actualCount', p_actual_count,
    'databaseRowCount', total_rows, 'keptRowCount', kept_rows,
    'disabledDuplicateCount', disabled_rows,
    'missingRowCount', greatest(p_actual_count - total_rows, 0)
  );
end;
$$;

create or replace function public.rankball_admin_regroup_all_nearby_courts(
  p_actor_profile_id text,
  p_actor_admin_level integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  court_id text;
  grouped jsonb;
  grouped_ids text[] := array[]::text[];
  group_count integer := 0;
  grouped_court_count integer := 0;
begin
  if public.rankball_admin_level_for_profile(p_actor_profile_id, p_actor_admin_level) < 50 then
    raise exception 'admin_permission_required' using errcode = '42501';
  end if;

  for court_id in
    select court.id
    from public.approved_courts court
    where court.lat is not null and court.lng is not null
      and coalesce(court.status, 'active') = 'active'
      and not (court.id = any(grouped_ids))
      and exists (
        select 1
        from public.approved_courts other
        where other.id <> court.id
          and coalesce(other.status, 'active') = 'active'
          and other.lat is not null and other.lng is not null
          and other.lat between court.lat - 0.00028 and court.lat + 0.00028
          and other.lng between court.lng - 0.00036 and court.lng + 0.00036
          and public.rankball_court_distance_m(
            court.lat::double precision, court.lng::double precision,
            other.lat::double precision, other.lng::double precision
          ) <= 30.0
      )
    order by court.created_at nulls first, court.id
  loop
    if court_id = any(grouped_ids) then
      continue;
    end if;
    grouped := public.rankball_admin_auto_group_nearby_courts(
      p_actor_profile_id, p_actor_admin_level, court_id, null, '전국 구장 30m 근접 자동 재검사'
    );
    if coalesce((grouped ->> 'detectedCount')::integer, 0) > 1 then
      group_count := group_count + 1;
      grouped_court_count := grouped_court_count + (grouped ->> 'detectedCount')::integer;
      grouped_ids := grouped_ids || array(
        select item ->> 'id' from jsonb_array_elements(grouped -> 'courts') item
      );
    else
      grouped_ids := array_append(grouped_ids, court_id);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'groupCount', group_count, 'groupedCourtCount', grouped_court_count
  );
end;
$$;

revoke all on function public.rankball_court_distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.rankball_nearby_court_component(text) from public, anon, authenticated;
revoke all on function public.rankball_admin_auto_group_nearby_courts(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_admin_verify_nearby_court_count(text, integer, text, integer, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.rankball_admin_regroup_all_nearby_courts(text, integer) from public, anon, authenticated;

grant execute on function public.rankball_admin_auto_group_nearby_courts(text, integer, text, text, text) to service_role;
grant execute on function public.rankball_admin_verify_nearby_court_count(text, integer, text, integer, text, jsonb, text) to service_role;
grant execute on function public.rankball_admin_regroup_all_nearby_courts(text, integer) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
