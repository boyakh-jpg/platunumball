-- Normalize source/user facility labels without inferring a place name.
create or replace function public.rankball_normalize_court_name(raw_name text)
returns text
language plpgsql
immutable
as $$
declare
  normalized_name text := normalize(coalesce(raw_name, ''), NFKC);
begin
  normalized_name := regexp_replace(btrim(normalized_name), '[[:space:]]+', ' ', 'g');
  normalized_name := regexp_replace(normalized_name, '^\[[[:space:]]*[0-9]+[[:space:]]*\][[:space:]]*', '', 'g');
  normalized_name := regexp_replace(normalized_name, '^농구장[[:space:]]*\([[:space:]]*([^()]+)[[:space:]]*\)$', '\1 농구장', 'i');
  normalized_name := regexp_replace(normalized_name, '[[:space:]]*\([[:space:]]*실내[[:space:]]*농구장[[:space:]]*\)[[:space:]]*$', ' 실내농구장', 'i');
  normalized_name := regexp_replace(normalized_name, '[[:space:]]*\([[:space:]]*실외[[:space:]]*농구장[[:space:]]*\)[[:space:]]*$', ' 실외농구장', 'i');
  normalized_name := regexp_replace(normalized_name, '[[:space:]]*\([[:space:]]*야외[[:space:]]*농구장[[:space:]]*\)[[:space:]]*$', ' 야외농구장', 'i');
  normalized_name := regexp_replace(normalized_name, '[[:space:]]*\([[:space:]]*농구장[[:space:]]*\)[[:space:]]*$', ' 농구장', 'i');
  normalized_name := regexp_replace(normalized_name, '농구[[:space:]]*코트', '농구장', 'gi');
  normalized_name := regexp_replace(normalized_name, '([0-9A-Za-z가-힣])농구장', '\1 농구장', 'g');
  normalized_name := regexp_replace(normalized_name, '농구장[[:space:]]*([0-9]+)[[:space:]]*면', '농구장 \1면', 'g');
  normalized_name := regexp_replace(normalized_name, '농구장[[:space:]]*([0-9]+)', '농구장 \1', 'g');
  normalized_name := regexp_replace(normalized_name, '농구장[[:space:]]*([A-Za-z])[[:space:]]*$', '농구장 \1', 'i');
  normalized_name := regexp_replace(normalized_name, '제[[:space:]]+([0-9]+)[[:space:]]*농구장', '제\1 농구장', 'gi');
  normalized_name := regexp_replace(normalized_name, '농구장[[:space:]]*및[[:space:]]*', '농구장 및 ', 'g');
  normalized_name := regexp_replace(normalized_name, '제[[:space:]]+([0-9]+)[[:space:]]*코트', '제\1코트', 'gi');
  normalized_name := regexp_replace(normalized_name, '([A-Za-z0-9]+)[[:space:]]+코트', '\1코트', 'gi');
  normalized_name := regexp_replace(btrim(normalized_name), '[[:space:]]+', ' ', 'g');
  return nullif(normalized_name, '');
end;
$$;

revoke all on function public.rankball_normalize_court_name(text) from public;
