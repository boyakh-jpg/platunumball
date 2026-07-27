begin;

create or replace function public.rankball_guard_no_referee_player_match_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_referee_id text;
  match_creator_id text;
  match_record_type text;
begin
  select
    nullif(btrim(match.referee_id), ''),
    nullif(btrim(match.created_by), ''),
    nullif(btrim(match.rules->>'recordType'), '')
  into assigned_referee_id, match_creator_id, match_record_type
  from public.matches match
  where match.id = new.match_id;

  if not found then
    raise exception 'match_not_found' using errcode = 'P0002';
  end if;

  if assigned_referee_id is null
     and not (
       match_record_type in ('solo', 'personal_record')
       and new.user_id = match_creator_id
       and coalesce(nullif(btrim(new.recorded_by), ''), new.user_id) = match_creator_id
     ) then
    raise exception 'no_referee_personal_stats_forbidden' using errcode = '42501';
  end if;

  return new;
end;
$$;

select pg_notify('pgrst', 'reload schema');

commit;