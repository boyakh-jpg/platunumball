begin;

revoke select on table public.teams, public.team_members, public.affiliations
  from public, anon;
grant select on table public.teams, public.team_members, public.affiliations
  to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
