create or replace function public.rankball_normalize_court_name(raw_name text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(btrim(coalesce(raw_name, '')), '[[:space:]]+', ' ', 'g'),
        '제[[:space:]]+([0-9]+)[[:space:]]*코트',
        '제\1코트',
        'gi'
      ),
      '([A-Za-z0-9]+)[[:space:]]+코트',
      '\1코트',
      'gi'
    ),
    ''
  );
$$;

revoke all on function public.rankball_normalize_court_name(text) from public;
