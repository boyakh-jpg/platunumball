-- c1..c12 were deleted synthetic courts.
-- Keep them deleted and fail health if a row or reference is reintroduced.

begin;

do $migration$
declare
  function_oid oid;
  function_definition text;
  patched_definition text;
  normalized_old_check text;
  normalized_new_check text;
  old_check constant text := $contract$
    select 'builtInCourtMissingApprovedRow', greatest(0, 12 - count(*))
    from public.approved_courts court
    where court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
      and court.status = 'active' and court.lat is not null and court.lng is not null
$contract$;
  new_check constant text := $contract$
    select 'deletedBuiltInCourtResidue', count(*)::bigint
    from (
      select 'approved:' || court.id as residue_id
      from public.approved_courts court
      where court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
      union all
      select 'legacy:' || court.id
      from public.courts court
      where court.id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
      union all
      select 'match:' || match_row.id
      from public.matches match_row
      where match_row.court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
      union all
      select 'recruiting:' || post.id
      from public.recruiting_posts post
      where post.court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
      union all
      select 'tournament:' || tournament.id
      from public.tournaments tournament
      where tournament.court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
      union all
      select 'review:' || review.id
      from public.court_reviews review
      where review.court_id = any(array['c1','c2','c3','c4','c5','c6','c7','c8','c9','c10','c11','c12'])
    ) residue
$contract$;
begin
  select procedure.oid
    into function_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'rankball_operational_data_health'
    and pg_get_function_identity_arguments(procedure.oid) = '';

  if function_oid is null then
    raise exception 'rankball_operational_data_health_missing' using errcode = '42883';
  end if;

  select pg_get_functiondef(function_oid)
    into function_definition;

  function_definition := replace(function_definition, E'\r\n', E'\n');
  normalized_old_check := replace(old_check, E'\r\n', E'\n');
  normalized_new_check := replace(new_check, E'\r\n', E'\n');

  if position('deletedBuiltInCourtResidue' in function_definition) > 0 then
    return;
  end if;

  if position(normalized_old_check in function_definition) = 0 then
    raise exception 'rankball_operational_data_health_unexpected_builtin_court_check'
      using errcode = '55000';
  end if;

  patched_definition := replace(function_definition, normalized_old_check, normalized_new_check);
  execute patched_definition;
end
$migration$;

revoke all on function public.rankball_operational_data_health()
  from public, anon, authenticated;
grant execute on function public.rankball_operational_data_health()
  to service_role;

comment on function public.rankball_operational_data_health() is
  'Checks operational source integrity; deleted synthetic court ids c1..c12 must not remain or be referenced.';

commit;

select pg_notify('pgrst', 'reload schema');
