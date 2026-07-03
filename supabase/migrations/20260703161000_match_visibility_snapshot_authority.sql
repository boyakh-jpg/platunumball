create or replace function public.rankball_match_visibility_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_rules jsonb := coalesce(new.rules, '{}'::jsonb);
  previous_visibility text := null;
  safe_visibility text;
begin
  if tg_op = 'UPDATE' then
    previous_visibility := old.visibility;
  end if;

  safe_visibility := case
    when new.visibility in ('public', 'private') then new.visibility
    when previous_visibility in ('public', 'private') then previous_visibility
    when safe_rules->>'visibility' in ('public', 'private') then safe_rules->>'visibility'
    else 'private'
  end;

  new.visibility := safe_visibility;
  new.rules := safe_rules || jsonb_build_object('visibility', safe_visibility);
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.matches') is not null then
    update public.matches m
    set
      visibility = case
        when m.visibility in ('public', 'private') then m.visibility
        when m.rules->>'visibility' in ('public', 'private') then m.rules->>'visibility'
        else 'private'
      end,
      rules = coalesce(m.rules, '{}'::jsonb) || jsonb_build_object(
        'visibility',
        case
          when m.visibility in ('public', 'private') then m.visibility
          when m.rules->>'visibility' in ('public', 'private') then m.rules->>'visibility'
          else 'private'
        end
      )
    where
      m.visibility not in ('public', 'private')
      or m.visibility is null
      or coalesce(m.rules->>'visibility', '') is distinct from case
        when m.visibility in ('public', 'private') then m.visibility
        when m.rules->>'visibility' in ('public', 'private') then m.rules->>'visibility'
        else 'private'
      end;

    execute 'drop trigger if exists rankball_matches_visibility_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_visibility_snapshot_guard before insert or update of visibility, rules on public.matches for each row execute function public.rankball_match_visibility_snapshot_guard()';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
