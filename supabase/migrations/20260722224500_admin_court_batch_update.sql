create or replace function public.rankball_admin_update_courts_batch(
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
    select 1
    from jsonb_array_elements(p_updates) as items(item)
    where jsonb_typeof(item) is distinct from 'object'
      or nullif(btrim(coalesce(item->>'courtId', '')), '') is null
      or jsonb_typeof(item->'patch') is distinct from 'object'
      or item->'patch' = '{}'::jsonb
      or pg_column_size(item->'patch') > 32768
  ) then
    raise exception 'court_batch_item_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_updates) as items(item)
    group by item->>'courtId'
    having count(*) > 1
  ) then
    raise exception 'court_batch_duplicate_court' using errcode = '22023';
  end if;

  for update_item in select item from jsonb_array_elements(p_updates) as items(item)
  loop
    update_result := public.rankball_admin_update_court(
      p_actor_profile_id,
      p_actor_admin_level,
      update_item->>'courtId',
      update_item->'patch',
      p_reason
    );
    results := results || jsonb_build_array(update_result);
    update_count := update_count + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'updatedCount', update_count,
    'results', results
  );
end;
$$;

revoke all on function public.rankball_admin_update_courts_batch(text, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.rankball_admin_update_courts_batch(text, integer, jsonb, text) to service_role;
