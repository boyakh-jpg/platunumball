create or replace function public.rankball_court_facility_base(
  raw_facility_name text,
  raw_sigungu text default null,
  raw_court_unit text default null
)
returns text
language plpgsql
immutable
as $$
declare
  safe_name text := public.rankball_normalize_court_name(raw_facility_name);
  safe_sigungu text := public.rankball_normalize_court_name(raw_sigungu);
  safe_unit text := public.rankball_normalize_court_name(raw_court_unit);
begin
  if safe_name is null then return null; end if;
  if safe_sigungu is not null and safe_name like safe_sigungu || ' %' then
    safe_name := btrim(substr(safe_name, char_length(safe_sigungu) + 1));
  end if;
  if safe_unit is not null and right(safe_name, char_length(safe_unit)) = safe_unit then
    safe_name := btrim(left(safe_name, char_length(safe_name) - char_length(safe_unit)));
  end if;
  safe_name := regexp_replace(safe_name, '[[:space:]]*((실내|실외|야외)[[:space:]]*)?농구장[[:space:]]*$', '', 'i');
  safe_name := regexp_replace(safe_name, '[[:space:]]*농구[[:space:]]*코트[[:space:]]*$', '', 'i');
  safe_name := regexp_replace(safe_name, '[[:space:]·,\-]+$', '', 'g');
  return public.rankball_normalize_court_name(safe_name);
end;
$$;

update public.approved_courts court
set name_modification_count = greatest(court.name_modification_count - 1, 0),
    name_modified_by = 'system'
where court.name_modified_by = 'system:osm_spatial'
  and exists (
    select 1
    from public.court_name_evidence evidence
    where evidence.court_id = court.id
      and evidence.inference_version = 'osm-spatial-v2'
  );

revoke all on function public.rankball_court_facility_base(text, text, text) from public, anon, authenticated;
grant execute on function public.rankball_court_facility_base(text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
