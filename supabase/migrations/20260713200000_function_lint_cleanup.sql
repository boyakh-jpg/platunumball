alter function public.rankball_slim_room_feed_card(text, jsonb) stable;
alter function public.rankball_compact_recruiting_feed_counts(jsonb) stable;
alter function public.rankball_compact_saved_room_feed_card(text, jsonb) stable;
alter function public.rankball_room_feed_card_with_region_key(text, jsonb) stable;

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
