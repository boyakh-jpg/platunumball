create or replace function public.rankball_import_public_courts_fast(
  p_batch_id text,
  p_source_file text,
  p_source_sha256 text,
  p_rows jsonb,
  p_apply boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = '60s'
as $$
begin
  perform set_config('rankball.public_import_validated', 'on', true);
  return public.rankball_import_public_courts(
    p_batch_id,
    p_source_file,
    p_source_sha256,
    p_rows,
    p_apply
  );
end;
$$;

drop trigger if exists approved_courts_identity_guard on public.approved_courts;
create trigger approved_courts_identity_guard
before insert or update on public.approved_courts
for each row
when (coalesce(current_setting('rankball.public_import_validated', true), '') <> 'on')
execute function public.rankball_enforce_approved_court_identity();

drop trigger if exists approved_courts_legacy_identity_guard on public.approved_courts;
create trigger approved_courts_legacy_identity_guard
before insert or update on public.approved_courts
for each row
when (coalesce(current_setting('rankball.public_import_validated', true), '') <> 'on')
execute function public.rankball_enforce_legacy_court_identity();

drop trigger if exists courts_identity_guard on public.courts;
create trigger courts_identity_guard
before insert or update on public.courts
for each row
when (coalesce(current_setting('rankball.public_import_validated', true), '') <> 'on')
execute function public.rankball_enforce_legacy_court_row_identity();

drop trigger if exists approved_courts_sync_legacy_identity on public.approved_courts;
create trigger approved_courts_sync_legacy_identity
after insert or update of name, address_text, road_address, jibun_address, lat, lng, payload on public.approved_courts
for each row
when (coalesce(current_setting('rankball.public_import_validated', true), '') <> 'on')
execute function public.rankball_sync_court_identity_tables();

drop trigger if exists courts_sync_approved_identity on public.courts;
create trigger courts_sync_approved_identity
after insert or update of name, address_text, road_address, jibun_address, lat, lng, payload on public.courts
for each row
when (coalesce(current_setting('rankball.public_import_validated', true), '') <> 'on')
execute function public.rankball_sync_court_identity_tables();

revoke all on function public.rankball_import_public_courts_fast(text, text, text, jsonb, boolean) from public;
revoke all on function public.rankball_import_public_courts_fast(text, text, text, jsonb, boolean) from anon;
revoke all on function public.rankball_import_public_courts_fast(text, text, text, jsonb, boolean) from authenticated;
grant execute on function public.rankball_import_public_courts_fast(text, text, text, jsonb, boolean) to service_role;
