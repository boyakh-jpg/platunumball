alter function public.rankball_swap_match_side_json(jsonb) stable;

revoke all on function public.rankball_swap_match_side_json(jsonb) from public, anon, authenticated;
grant execute on function public.rankball_swap_match_side_json(jsonb) to service_role;

select pg_notify('pgrst', 'reload schema');
