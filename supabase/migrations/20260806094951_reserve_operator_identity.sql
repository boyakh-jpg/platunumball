begin;

create or replace function public.rankball_profile_identity_term_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(
    normalize(coalesce(p_value, ''), NFKC),
    '[^[:alnum:]]+',
    '',
    'g'
  ));
$$;

create table if not exists public.profile_identity_block_terms (
  term text primary key,
  category text not null,
  match_mode text not null default 'contains',
  owner_allowed boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_identity_block_terms_term_check
    check (term <> '' and term = public.rankball_profile_identity_term_key(term)),
  constraint profile_identity_block_terms_category_check
    check (category in ('brand', 'impersonation', 'profanity', 'hate')),
  constraint profile_identity_block_terms_match_mode_check
    check (match_mode in ('exact', 'prefix', 'contains'))
);

alter table public.profile_identity_block_terms enable row level security;
revoke all on public.profile_identity_block_terms from public, anon, authenticated;
grant select, insert, update, delete on public.profile_identity_block_terms to service_role;

insert into public.profile_identity_block_terms (term, category, match_mode, owner_allowed)
values
  ('boxtier', 'brand', 'contains', true),
  ('박스티어', 'brand', 'contains', true),
  ('운영자', 'impersonation', 'prefix', false),
  ('관리자', 'impersonation', 'prefix', false),
  ('운영팀', 'impersonation', 'prefix', false),
  ('고객센터', 'impersonation', 'prefix', false),
  ('공식계정', 'impersonation', 'prefix', false),
  ('공식운영', 'impersonation', 'prefix', false),
  ('admin', 'impersonation', 'prefix', false),
  ('administrator', 'impersonation', 'prefix', false),
  ('moderator', 'impersonation', 'prefix', false),
  ('official', 'impersonation', 'prefix', false),
  ('씨발', 'profanity', 'contains', false),
  ('씨빨', 'profanity', 'contains', false),
  ('시빨', 'profanity', 'contains', false),
  ('시발', 'profanity', 'exact', false),
  ('개새끼', 'profanity', 'contains', false),
  ('개색기', 'profanity', 'contains', false),
  ('새끼', 'profanity', 'contains', false),
  ('병신', 'profanity', 'contains', false),
  ('븅신', 'profanity', 'contains', false),
  ('좆', 'profanity', 'contains', false),
  ('씹', 'profanity', 'contains', false),
  ('존나', 'profanity', 'contains', false),
  ('졸라', 'profanity', 'contains', false),
  ('지랄', 'profanity', 'contains', false),
  ('엿먹어', 'profanity', 'contains', false),
  ('꺼져', 'profanity', 'contains', false),
  ('닥쳐', 'profanity', 'contains', false),
  ('창녀', 'profanity', 'contains', false),
  ('걸레', 'profanity', 'contains', false),
  ('fuck', 'profanity', 'contains', false),
  ('shit', 'profanity', 'contains', false),
  ('bitch', 'profanity', 'contains', false),
  ('cunt', 'profanity', 'contains', false),
  ('whore', 'profanity', 'contains', false),
  ('slut', 'profanity', 'contains', false),
  ('ssibal', 'profanity', 'contains', false),
  ('sibal', 'profanity', 'contains', false),
  ('jonna', 'profanity', 'contains', false),
  ('짱깨', 'hate', 'contains', false),
  ('쪽바리', 'hate', 'contains', false),
  ('맘충', 'hate', 'contains', false),
  ('틀딱', 'hate', 'contains', false),
  ('급식충', 'hate', 'contains', false),
  ('한남', 'hate', 'exact', false),
  ('한녀', 'hate', 'exact', false),
  ('홍어', 'hate', 'exact', false),
  ('니거', 'hate', 'exact', false),
  ('nigger', 'hate', 'contains', false),
  ('nigga', 'hate', 'contains', false)
on conflict (term) do update set
  category = excluded.category,
  match_mode = excluded.match_mode,
  owner_allowed = excluded.owner_allowed,
  active = true,
  updated_at = clock_timestamp();

create or replace function public.rankball_profile_identity_matches_block_term(
  p_name text,
  p_hashtag text,
  p_handle text
)
returns table (term text, category text, owner_allowed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select block.term, block.category, block.owner_allowed
  from public.profile_identity_block_terms block
  cross join lateral unnest(array[
    public.rankball_profile_identity_term_key(p_name),
    public.rankball_profile_identity_term_key(p_hashtag),
    public.rankball_profile_identity_term_key(p_handle),
    public.rankball_profile_identity_term_key(public.rankball_normalize_hashtag(p_hashtag, p_handle))
  ]) identity(value)
  where block.active
    and identity.value <> ''
    and case block.match_mode
      when 'exact' then identity.value = block.term
      when 'prefix' then identity.value like block.term || '%'
      else identity.value like '%' || block.term || '%'
    end
  order by block.owner_allowed, char_length(block.term) desc
$$;

create or replace function public.rankball_assert_profile_identity_allowed(
  p_profile_id text,
  p_name text,
  p_hashtag text,
  p_handle text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_owner_allowed boolean;
  owner_profile boolean := false;
begin
  select matched.owner_allowed
  into matched_owner_allowed
  from public.rankball_profile_identity_matches_block_term(p_name, p_hashtag, p_handle) matched
  limit 1;

  if not found then
    return;
  end if;

  if matched_owner_allowed then
    select exists (
      select 1
      from public.admin_appointments appointment
      where appointment.user_id = nullif(btrim(p_profile_id), '')
        and appointment.role = 'admin'
        and appointment.grade = 'owner'
        and appointment.status = 'active'
        and (appointment.starts_at is null or appointment.starts_at <= now())
        and (appointment.ends_at is null or appointment.ends_at >= now())
    ) into owner_profile;

    if owner_profile then
      return;
    end if;

    raise exception 'reserved_operator_identity' using errcode = '42501';
  end if;

  raise exception 'profile_identity_blocked' using errcode = '23514';
end;
$$;

do $$
declare
  active_owner_count integer;
  active_owner_id text;
begin
  select count(distinct appointment.user_id), max(appointment.user_id)
  into active_owner_count, active_owner_id
  from public.admin_appointments appointment
  where appointment.role = 'admin'
    and appointment.grade = 'owner'
    and appointment.status = 'active'
    and (appointment.starts_at is null or appointment.starts_at <= now())
    and (appointment.ends_at is null or appointment.ends_at >= now());

  if active_owner_count > 1 then
    raise exception 'multiple_active_owner_profiles';
  end if;

  if active_owner_count = 1 then
    update public.profiles
    set
      name = 'boxtier',
      handle = '#boxtier',
      hashtag = '#boxtier',
      name_updated_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where id = active_owner_id;
  end if;
end;
$$;

create or replace function public.rankball_profile_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.rankball_assert_profile_identity_allowed(
    new.id,
    new.name,
    new.hashtag,
    new.handle
  );
  return new;
end;
$$;

drop trigger if exists rankball_profiles_identity_guard on public.profiles;
create trigger rankball_profiles_identity_guard
before insert or update of name, handle, hashtag
on public.profiles
for each row
execute function public.rankball_profile_identity_guard();

alter function public.rankball_profile_identity_term_key(text) owner to postgres;
alter function public.rankball_profile_identity_matches_block_term(text, text, text) owner to postgres;
alter function public.rankball_assert_profile_identity_allowed(text, text, text, text) owner to postgres;
alter function public.rankball_profile_identity_guard() owner to postgres;

revoke all on function public.rankball_profile_identity_term_key(text) from public, anon, authenticated;
revoke all on function public.rankball_profile_identity_matches_block_term(text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_assert_profile_identity_allowed(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rankball_profile_identity_guard() from public, anon, authenticated;

grant execute on function public.rankball_profile_identity_term_key(text) to service_role;
grant execute on function public.rankball_profile_identity_matches_block_term(text, text, text) to service_role;
grant execute on function public.rankball_assert_profile_identity_allowed(text, text, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
