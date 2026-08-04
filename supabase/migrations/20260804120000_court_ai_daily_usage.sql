begin;

create table if not exists public.court_ai_usage_events (
  id bigint generated always as identity primary key,
  request_id text not null,
  model text not null,
  calls integer not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  neurons numeric(12, 6) not null,
  estimated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint court_ai_usage_events_calls_check check (calls > 0),
  constraint court_ai_usage_events_input_tokens_check check (input_tokens >= 0),
  constraint court_ai_usage_events_output_tokens_check check (output_tokens >= 0),
  constraint court_ai_usage_events_neurons_check check (neurons >= 0)
);

create index if not exists court_ai_usage_events_created_at_idx
  on public.court_ai_usage_events (created_at desc);

alter table public.court_ai_usage_events enable row level security;
revoke all on table public.court_ai_usage_events from public, anon, authenticated;
grant select, insert on table public.court_ai_usage_events to service_role;
grant usage, select on sequence public.court_ai_usage_events_id_seq to service_role;

commit;
