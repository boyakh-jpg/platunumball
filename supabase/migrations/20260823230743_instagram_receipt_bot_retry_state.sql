alter table public.instagram_receipt_bot_requests
  add column if not exists processing_state text not null default 'completed',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_error text;

alter table public.instagram_receipt_bot_requests
  drop constraint if exists instagram_receipt_bot_requests_processing_state_check;
alter table public.instagram_receipt_bot_requests
  add constraint instagram_receipt_bot_requests_processing_state_check
  check (processing_state in ('processing', 'completed', 'failed'));
alter table public.instagram_receipt_bot_requests
  drop constraint if exists instagram_receipt_bot_requests_attempt_count_check;
alter table public.instagram_receipt_bot_requests
  add constraint instagram_receipt_bot_requests_attempt_count_check check (attempt_count between 0 and 10);
alter table public.instagram_receipt_bot_requests
  drop constraint if exists instagram_receipt_bot_requests_last_error_check;
alter table public.instagram_receipt_bot_requests
  add constraint instagram_receipt_bot_requests_last_error_check check (last_error is null or char_length(last_error) <= 120);

create or replace function public.claim_instagram_receipt_bot_request_v3(
  p_event_hash text,
  p_sender_hash text,
  p_principal_hash text,
  p_profile_id text,
  p_content_hash text,
  p_request_kind text,
  p_cooldown_seconds integer,
  p_hour_limit integer,
  p_day_limit integer,
  p_global_hour_limit integer,
  p_content_dedupe_seconds integer,
  p_lease_seconds integer
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_existing public.instagram_receipt_bot_requests%rowtype;
  v_decision text;
begin
  if char_length(p_event_hash) <> 64 or char_length(p_sender_hash) <> 64
     or char_length(p_principal_hash) <> 64 or char_length(p_content_hash) <> 64
     or p_request_kind not in ('receipt', 'command')
     or p_cooldown_seconds not between 1 and 86400
     or p_hour_limit not between 1 and 1000
     or p_day_limit not between 1 and 10000
     or p_global_hour_limit not between 1 and 100000
     or p_content_dedupe_seconds not between 1 and 86400
     or p_lease_seconds not between 10 and 300 then
    raise exception 'invalid_instagram_receipt_bot_limit';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_hash, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_principal_hash, 1));

  select * into v_existing from public.instagram_receipt_bot_requests where event_hash = p_event_hash;
  if found then
    if v_existing.decision <> 'accepted' or v_existing.processing_state = 'completed' then return 'duplicate_event'; end if;
    if v_existing.processing_state = 'processing' and v_existing.lease_expires_at > v_now then return 'in_progress'; end if;
    if v_existing.attempt_count >= 3 then return 'retry_exhausted'; end if;
    update public.instagram_receipt_bot_requests
    set processing_state = 'processing', attempt_count = attempt_count + 1,
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds), last_error = null
    where event_hash = p_event_hash;
    return 'retry';
  end if;

  if p_request_kind = 'receipt' and exists (
    select 1 from public.instagram_receipt_bot_requests
    where sender_hash = p_sender_hash and content_hash = p_content_hash and decision = 'accepted'
      and created_at >= v_now - pg_catalog.make_interval(secs => p_content_dedupe_seconds)
  ) then
    v_decision := 'duplicate_content';
  elsif p_request_kind = 'receipt' and exists (
    select 1 from public.instagram_receipt_bot_requests
    where principal_hash = p_principal_hash and decision = 'accepted'
      and created_at >= v_now - pg_catalog.make_interval(secs => p_cooldown_seconds)
  ) then
    v_decision := 'cooldown';
  elsif p_request_kind = 'receipt' and (select count(*) from public.instagram_receipt_bot_requests
         where principal_hash = p_principal_hash and decision = 'accepted'
           and created_at >= v_now - interval '1 hour') >= p_hour_limit then
    v_decision := 'hourly_limit';
  elsif p_request_kind = 'receipt' and (
    select count(*) from public.instagram_receipt_bot_requests
    where principal_hash = p_principal_hash and request_kind = 'receipt' and decision = 'accepted'
      and created_at >= v_now - interval '1 day'
  ) >= p_day_limit then
    v_decision := 'daily_limit';
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('instagram_receipt_bot_global', 2));
    if (select count(*) from public.instagram_receipt_bot_requests
        where decision = 'accepted' and created_at >= v_now - interval '1 hour') >= p_global_hour_limit then
      v_decision := 'global_limit';
    else
      v_decision := 'accepted';
    end if;
  end if;

  insert into public.instagram_receipt_bot_requests (
    event_hash, sender_hash, principal_hash, profile_id, content_hash, request_kind, decision,
    processing_state, attempt_count, lease_expires_at, completed_at
  ) values (
    p_event_hash, p_sender_hash, p_principal_hash, p_profile_id, p_content_hash, p_request_kind, v_decision,
    case when v_decision = 'accepted' then 'processing' else 'completed' end,
    case when v_decision = 'accepted' then 1 else 0 end,
    case when v_decision = 'accepted' then v_now + pg_catalog.make_interval(secs => p_lease_seconds) else null end,
    case when v_decision = 'accepted' then null else v_now end
  );
  return v_decision;
end;
$$;

create or replace function public.consume_instagram_receipt_bot_link_v2(
  p_code_hash text,
  p_profile_id text,
  p_profile_principal_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_hash text;
begin
  if char_length(p_code_hash) <> 64 or coalesce(p_profile_id, '') = '' or char_length(p_profile_principal_hash) <> 64 then return false; end if;
  select sender_hash into v_sender_hash
  from public.instagram_receipt_bot_link_codes
  where code_hash = p_code_hash and expires_at > now()
  for update;
  if v_sender_hash is null then return false; end if;

  delete from public.instagram_receipt_bot_accounts where sender_hash = v_sender_hash or profile_id = p_profile_id;
  insert into public.instagram_receipt_bot_accounts (sender_hash, profile_id) values (v_sender_hash, p_profile_id);
  update public.instagram_receipt_bot_history set profile_id = p_profile_id where sender_hash = v_sender_hash;
  update public.instagram_receipt_bot_requests
  set principal_hash = p_profile_principal_hash, profile_id = p_profile_id
  where sender_hash = v_sender_hash;
  delete from public.instagram_receipt_bot_link_codes where code_hash = p_code_hash;
  return true;
end;
$$;

revoke all on function public.claim_instagram_receipt_bot_request_v3(text, text, text, text, text, text, integer, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.consume_instagram_receipt_bot_link_v2(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_instagram_receipt_bot_request_v3(text, text, text, text, text, text, integer, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.consume_instagram_receipt_bot_link_v2(text, text, text) to service_role;
