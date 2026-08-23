create table if not exists public.instagram_receipt_bot_requests (
  event_hash text primary key check (char_length(event_hash) = 64),
  sender_hash text not null check (char_length(sender_hash) = 64),
  content_hash text not null check (char_length(content_hash) = 64),
  decision text not null check (decision in ('accepted', 'duplicate_content', 'cooldown', 'hourly_limit', 'daily_limit', 'global_limit')),
  outcome text check (outcome in ('help', 'image_sent', 'failed')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists instagram_receipt_bot_requests_sender_created_idx
  on public.instagram_receipt_bot_requests (sender_hash, created_at desc);
create index if not exists instagram_receipt_bot_requests_created_idx
  on public.instagram_receipt_bot_requests (created_at desc);
create index if not exists instagram_receipt_bot_requests_content_created_idx
  on public.instagram_receipt_bot_requests (sender_hash, content_hash, created_at desc);

create table if not exists public.instagram_receipt_bot_render_jobs (
  public_id text primary key check (public_id ~ '^[A-Za-z0-9_-]{43}$'),
  receipt_input jsonb not null check (jsonb_typeof(receipt_input) = 'object'),
  preset text not null check (preset in ('story', 'feed')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists instagram_receipt_bot_render_jobs_expires_idx
  on public.instagram_receipt_bot_render_jobs (expires_at);

alter table public.instagram_receipt_bot_requests enable row level security;
alter table public.instagram_receipt_bot_render_jobs enable row level security;

revoke all on table public.instagram_receipt_bot_requests from public, anon, authenticated;
revoke all on table public.instagram_receipt_bot_render_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.instagram_receipt_bot_requests to service_role;
grant select, insert, update, delete on table public.instagram_receipt_bot_render_jobs to service_role;

create or replace function public.claim_instagram_receipt_bot_request(
  p_event_hash text,
  p_sender_hash text,
  p_content_hash text,
  p_cooldown_seconds integer,
  p_hour_limit integer,
  p_day_limit integer,
  p_global_hour_limit integer,
  p_content_dedupe_seconds integer
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_decision text;
begin
  if char_length(p_event_hash) <> 64 or char_length(p_sender_hash) <> 64 or char_length(p_content_hash) <> 64
     or p_cooldown_seconds not between 1 and 86400
     or p_hour_limit not between 1 and 1000
     or p_day_limit not between 1 and 10000
     or p_global_hour_limit not between 1 and 100000
     or p_content_dedupe_seconds not between 1 and 86400 then
    raise exception 'invalid_instagram_receipt_bot_limit';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_hash, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_sender_hash, 1));

  if exists (select 1 from public.instagram_receipt_bot_requests where event_hash = p_event_hash) then
    return 'duplicate_event';
  end if;

  if exists (
    select 1 from public.instagram_receipt_bot_requests
    where sender_hash = p_sender_hash and content_hash = p_content_hash and decision = 'accepted'
      and created_at >= v_now - make_interval(secs => p_content_dedupe_seconds)
  ) then
    v_decision := 'duplicate_content';
  elsif exists (
    select 1 from public.instagram_receipt_bot_requests
    where sender_hash = p_sender_hash and decision = 'accepted'
      and created_at >= v_now - make_interval(secs => p_cooldown_seconds)
  ) then
    v_decision := 'cooldown';
  elsif (select count(*) from public.instagram_receipt_bot_requests
         where sender_hash = p_sender_hash and decision = 'accepted' and created_at >= v_now - interval '1 hour') >= p_hour_limit then
    v_decision := 'hourly_limit';
  elsif (select count(*) from public.instagram_receipt_bot_requests
         where sender_hash = p_sender_hash and decision = 'accepted' and created_at >= v_now - interval '1 day') >= p_day_limit then
    v_decision := 'daily_limit';
  else
    perform pg_advisory_xact_lock(hashtextextended('instagram_receipt_bot_global', 2));
    if (select count(*) from public.instagram_receipt_bot_requests
        where decision = 'accepted' and created_at >= v_now - interval '1 hour') >= p_global_hour_limit then
      v_decision := 'global_limit';
    else
      v_decision := 'accepted';
    end if;
  end if;

  insert into public.instagram_receipt_bot_requests (event_hash, sender_hash, content_hash, decision)
  values (p_event_hash, p_sender_hash, p_content_hash, v_decision);
  return v_decision;
end;
$$;

create or replace function public.cleanup_instagram_receipt_bot_data()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.instagram_receipt_bot_render_jobs where expires_at <= now();
  delete from public.instagram_receipt_bot_requests where created_at < now() - interval '7 days';
$$;

revoke all on function public.claim_instagram_receipt_bot_request(text, text, text, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.cleanup_instagram_receipt_bot_data() from public, anon, authenticated;
grant execute on function public.claim_instagram_receipt_bot_request(text, text, text, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.cleanup_instagram_receipt_bot_data() to service_role;
