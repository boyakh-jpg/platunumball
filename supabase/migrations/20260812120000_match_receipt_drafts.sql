create table if not exists public.match_receipt_drafts (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  capability_hash text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  claimed_by text references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists match_receipt_drafts_expires_at_idx
  on public.match_receipt_drafts (expires_at);

alter table public.match_receipt_drafts enable row level security;
revoke all on table public.match_receipt_drafts from anon, authenticated;
grant all on table public.match_receipt_drafts to service_role;

create table if not exists public.match_receipt_draft_events (
  id bigint generated always as identity primary key,
  request_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists match_receipt_draft_events_lookup_idx
  on public.match_receipt_draft_events (request_hash, created_at desc);

alter table public.match_receipt_draft_events enable row level security;
revoke all on table public.match_receipt_draft_events from anon, authenticated;
grant all on table public.match_receipt_draft_events to service_role;

create or replace function public.consume_match_receipt_draft_quota(p_request_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  request_count integer;
begin
  if length(coalesce(p_request_hash, '')) <> 64 then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_hash, 0));
  select count(*) into request_count
  from public.match_receipt_draft_events
  where request_hash = p_request_hash
    and created_at > now() - interval '1 hour';
  if request_count >= 10 then
    return false;
  end if;
  insert into public.match_receipt_draft_events (request_hash) values (p_request_hash);
  return true;
end;
$$;

revoke all on function public.consume_match_receipt_draft_quota(text) from public, anon, authenticated;
grant execute on function public.consume_match_receipt_draft_quota(text) to service_role;
