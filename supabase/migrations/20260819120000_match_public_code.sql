create sequence if not exists public.match_public_code_seq;

create or replace function public.next_match_public_code()
returns text language plpgsql security invoker set search_path = ''
as $$
declare code_number bigint;
begin
  code_number := nextval('public.match_public_code_seq');
  if code_number > 99999999 then raise exception 'match_public_code_exhausted'; end if;
  return 'BT-' || lpad(code_number::text, 8, '0');
end;
$$;

revoke all on function public.next_match_public_code() from public, anon, authenticated;
grant execute on function public.next_match_public_code() to service_role;
grant usage on sequence public.match_public_code_seq to service_role;

alter table public.matches add column if not exists public_code text;
alter table public.match_receipt_drafts add column if not exists public_code text;
update public.matches set public_code = public.next_match_public_code() where public_code is null;
update public.match_receipt_drafts set public_code = public.next_match_public_code() where public_code is null;
alter table public.matches alter column public_code set default public.next_match_public_code();
alter table public.matches alter column public_code set not null;
alter table public.match_receipt_drafts alter column public_code set default public.next_match_public_code();
alter table public.match_receipt_drafts alter column public_code set not null;

alter table public.matches drop constraint if exists matches_public_code_format_check;
alter table public.matches add constraint matches_public_code_format_check check (public_code ~ '^BT-[0-9]{8}$');
alter table public.match_receipt_drafts drop constraint if exists match_receipt_drafts_public_code_format_check;
alter table public.match_receipt_drafts add constraint match_receipt_drafts_public_code_format_check check (public_code ~ '^BT-[0-9]{8}$');
create unique index if not exists matches_public_code_key on public.matches (public_code);
drop index if exists public.match_receipt_drafts_public_code_key;
create index if not exists match_receipt_drafts_public_code_idx on public.match_receipt_drafts (public_code);

create or replace function public.assign_match_public_code()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.public_code is null then new.public_code := public.next_match_public_code(); end if;
  return new;
end;
$$;

revoke all on function public.assign_match_public_code() from public, anon, authenticated;

drop trigger if exists assign_match_public_code on public.matches;
create trigger assign_match_public_code before insert on public.matches
for each row execute function public.assign_match_public_code();

create or replace function public.preserve_match_public_code()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.public_code is distinct from old.public_code then raise exception 'match_public_code_is_immutable'; end if;
  return new;
end;
$$;

revoke all on function public.preserve_match_public_code() from public, anon, authenticated;

drop trigger if exists preserve_match_public_code on public.matches;
create trigger preserve_match_public_code before update of public_code on public.matches
for each row execute function public.preserve_match_public_code();
drop trigger if exists preserve_match_receipt_public_code on public.match_receipt_drafts;
create trigger preserve_match_receipt_public_code before update of public_code on public.match_receipt_drafts
for each row execute function public.preserve_match_public_code();
