create or replace function public.enforce_team_membership_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('rankball_team:' || new.team_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('rankball_team_member_user:' || new.user_id, 0));

  if (
    select count(*)
    from public.team_members
    where user_id = new.user_id
      and team_id <> new.team_id
  ) >= 3 then
    raise exception 'team_membership_limit_exceeded' using errcode = '23514';
  end if;

  if (
    select count(*)
    from public.team_members
    where team_id = new.team_id
      and user_id <> new.user_id
  ) >= 10 then
    raise exception 'team_members_limit_exceeded' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_team_membership_limit() from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');
