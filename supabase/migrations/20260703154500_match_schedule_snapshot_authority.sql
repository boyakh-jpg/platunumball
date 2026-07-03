do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'matches'
      and column_name = 'scheduled_at'
      and data_type <> 'text'
  ) then
    alter table public.matches
      alter column scheduled_at type text
      using scheduled_at::text;
  end if;
end;
$$;

create or replace function public.rankball_match_schedule_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_rules jsonb := coalesce(new.rules, '{}'::jsonb);
  previous_timing text := null;
  requested_timing text;
  safe_timing text;
begin
  if tg_op = 'UPDATE' then
    previous_timing := old.rules->>'timingType';
  end if;

  requested_timing := coalesce(safe_rules->>'timingType', previous_timing);

  safe_timing := case
    when requested_timing = 'instant' then 'instant'
    when safe_rules ? 'timingType' then 'scheduled'
    when lower(btrim(coalesce(new.scheduled_at::text, ''))) in ('instant', '즉시') then 'instant'
    else 'scheduled'
  end;

  new.rules := safe_rules || jsonb_build_object('timingType', safe_timing);

  if safe_timing = 'instant' then
    new.scheduled_date := null;
    new.scheduled_time := null;
    new.scheduled_at := null;
  elsif new.scheduled_date is not null and new.scheduled_time is not null then
    new.scheduled_at := new.scheduled_date::text || ' ' || left(new.scheduled_time::text, 5);
  elsif new.scheduled_date is not null then
    new.scheduled_at := new.scheduled_date::text;
  else
    new.scheduled_at := null;
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.matches') is not null then
    update public.matches m
    set
      rules = coalesce(m.rules, '{}'::jsonb) || jsonb_build_object(
        'timingType',
        case
          when coalesce(m.rules->>'timingType', '') = 'instant'
            or (
              m.rules->>'timingType' is null
              and lower(btrim(coalesce(m.scheduled_at::text, ''))) in ('instant', '즉시')
            )
          then 'instant'
          else 'scheduled'
        end
      ),
      scheduled_date = case
        when coalesce(m.rules->>'timingType', '') = 'instant'
          or (
            m.rules->>'timingType' is null
            and lower(btrim(coalesce(m.scheduled_at::text, ''))) in ('instant', '즉시')
          )
        then null
        else m.scheduled_date
      end,
      scheduled_time = case
        when coalesce(m.rules->>'timingType', '') = 'instant'
          or (
            m.rules->>'timingType' is null
            and lower(btrim(coalesce(m.scheduled_at::text, ''))) in ('instant', '즉시')
          )
        then null
        else m.scheduled_time
      end,
      scheduled_at = case
        when coalesce(m.rules->>'timingType', '') = 'instant'
          or (
            m.rules->>'timingType' is null
            and lower(btrim(coalesce(m.scheduled_at::text, ''))) in ('instant', '즉시')
          )
        then null
        when m.scheduled_date is not null and m.scheduled_time is not null then m.scheduled_date::text || ' ' || left(m.scheduled_time::text, 5)
        when m.scheduled_date is not null then m.scheduled_date::text
        else null
      end
    where
      coalesce(m.rules->>'timingType', '') not in ('instant', 'scheduled')
      or (
        coalesce(m.rules->>'timingType', 'scheduled') = 'instant'
        and (m.scheduled_date is not null or m.scheduled_time is not null or nullif(btrim(coalesce(m.scheduled_at::text, '')), '') is not null)
      )
      or (
        coalesce(m.rules->>'timingType', 'scheduled') <> 'instant'
        and m.scheduled_date is not null
        and m.scheduled_at is distinct from case
          when m.scheduled_time is not null then m.scheduled_date::text || ' ' || left(m.scheduled_time::text, 5)
          else m.scheduled_date::text
        end
      );

    execute 'drop trigger if exists rankball_matches_schedule_snapshot_guard on public.matches';
    execute 'create trigger rankball_matches_schedule_snapshot_guard before insert or update of scheduled_at, scheduled_date, scheduled_time, rules on public.matches for each row execute function public.rankball_match_schedule_snapshot_guard()';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
