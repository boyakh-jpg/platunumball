create or replace function public.rankball_court_region_key(
  p_region text,
  p_address_text text default null,
  p_road_address text default null,
  p_jibun_address text default null,
  p_payload jsonb default '{}'::jsonb
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  candidate text;
  candidate_key text;
  tokens text[];
  token text;
  token_index integer;
  raw_values text[] := array[
    p_payload->>'sigungu',
    p_payload->>'addressSigungu',
    p_payload->>'addressDistrict',
    p_road_address,
    p_jibun_address,
    p_address_text,
    p_payload->>'region',
    p_region,
    p_payload->>'addressDong'
  ];
begin
  foreach candidate in array raw_values loop
    candidate := regexp_replace(btrim(coalesce(candidate, '')), '\s+', ' ', 'g');
    if candidate is null or candidate = '' then
      continue;
    end if;

    candidate_key := public.rankball_room_feed_region_key(candidate);
    candidate_key := case candidate_key
      when '성수' then '성동'
      when '잠실' then '송파'
      else candidate_key
    end;

    tokens := regexp_split_to_array(candidate, '\s+');
    if array_length(tokens, 1) >= 2 then
      for token_index in 2..array_length(tokens, 1) loop
        token := nullif(btrim(tokens[token_index]), '');
        if token is not null and token ~ '(구|군|시)$' then
          candidate_key := public.rankball_room_feed_region_key(token);
          return case candidate_key
            when '성수' then '성동'
            when '잠실' then '송파'
            else candidate_key
          end;
        end if;
      end loop;
    end if;

    if candidate !~ '(특별시|광역시|특별자치시|특별자치도|도)$' then
      return candidate_key;
    end if;
  end loop;

  return null;
end;
$$;

do $$
declare
  row_id text;
begin
  if to_regclass('public.approved_courts') is not null then
    update public.approved_courts
    set region_key = public.rankball_court_region_key(payload->>'region', address_text, road_address, jibun_address, payload)
    where region_key is distinct from public.rankball_court_region_key(payload->>'region', address_text, road_address, jibun_address, payload);
  end if;

  if to_regclass('public.courts') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'courts'
        and column_name = 'region'
    ) then
    update public.courts
    set region_key = public.rankball_court_region_key(region, null, null, null, '{}'::jsonb)
    where region_key is distinct from public.rankball_court_region_key(region, null, null, null, '{}'::jsonb);
  end if;

  if to_regclass('public.recruiting_posts') is not null
    and to_regprocedure('public.rankball_refresh_recruiting_feed_for_post(text)') is not null then
    for row_id in select id from public.recruiting_posts where nullif(btrim(court_id), '') is not null loop
      perform public.rankball_refresh_recruiting_feed_for_post(row_id);
    end loop;
  end if;

  if to_regclass('public.matches') is not null
    and to_regprocedure('public.rankball_refresh_match_feed_for_match(text)') is not null then
    for row_id in select id from public.matches where nullif(btrim(court_id), '') is not null loop
      perform public.rankball_refresh_match_feed_for_match(row_id);
    end loop;
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
