alter table public.match_receipt_drafts
  add column if not exists created_by text references public.profiles(id) on delete set null,
  add column if not exists opponent_capability_hash text,
  add column if not exists opponent_response text,
  add column if not exists opponent_responded_by text references public.profiles(id) on delete set null,
  add column if not exists opponent_responded_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'match_receipt_drafts_opponent_response_check'
      and conrelid = 'public.match_receipt_drafts'::regclass
  ) then
    alter table public.match_receipt_drafts
      add constraint match_receipt_drafts_opponent_response_check
      check (opponent_response is null or opponent_response in ('accepted', 'disputed'));
  end if;
end
$$;

create index if not exists match_receipt_drafts_opponent_responded_by_idx
  on public.match_receipt_drafts (opponent_responded_by)
  where opponent_responded_by is not null;

create index if not exists match_receipt_drafts_created_by_idx
  on public.match_receipt_drafts (created_by)
  where created_by is not null;

comment on column public.match_receipt_drafts.opponent_response is
  'Opponent acknowledgement for a non-canonical receipt. Never promotes the receipt to an official record or MMR source.';
