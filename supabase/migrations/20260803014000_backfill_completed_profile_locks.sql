do $$
begin
  if to_regclass('public.profiles') is not null then
    update public.profiles
    set
      handle_locked_at = coalesce(handle_locked_at, created_at, updated_at, now()),
      birth_year_locked_at = coalesce(birth_year_locked_at, created_at, updated_at, now())
    where onboarding_complete is true
      and coalesce(nullif(btrim(hashtag), ''), nullif(btrim(handle), '')) is not null
      and birth_year is not null
      and (handle_locked_at is null or birth_year_locked_at is null);
  end if;
end
$$;
