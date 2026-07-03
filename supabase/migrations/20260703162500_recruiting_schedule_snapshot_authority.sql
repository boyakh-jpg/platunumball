do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'recruiting_posts'
      and column_name = 'scheduled_at'
      and data_type <> 'text'
  ) then
    alter table public.recruiting_posts
      alter column scheduled_at type text
      using scheduled_at::text;
  end if;
end;
$$;

create or replace function public.rankball_recruiting_schedule_snapshot_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_room_state jsonb := coalesce(new.room_state, '{}'::jsonb);
  previous_timing text := null;
  requested_timing text;
  safe_timing text;
begin
  if tg_op = 'UPDATE' then
    previous_timing := old.room_state->>'timingType';
  end if;

  requested_timing := coalesce(safe_room_state->>'timingType', previous_timing);

  safe_timing := case
    when requested_timing = 'instant' then 'instant'
    when safe_room_state ? 'timingType' then 'scheduled'
    when lower(btrim(coalesce(new.scheduled_at::text, ''))) in ('instant', '즉시') then 'instant'
    else 'scheduled'
  end;

  new.room_state := safe_room_state || jsonb_build_object('timingType', safe_timing);

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
  if to_regclass('public.recruiting_posts') is not null then
    update public.recruiting_posts p
    set
      room_state = coalesce(p.room_state, '{}'::jsonb) || jsonb_build_object(
        'timingType',
        case
          when coalesce(p.room_state->>'timingType', '') = 'instant'
            or (
              p.room_state->>'timingType' is null
              and lower(btrim(coalesce(p.scheduled_at::text, ''))) in ('instant', '즉시')
            )
          then 'instant'
          else 'scheduled'
        end
      ),
      scheduled_date = case
        when coalesce(p.room_state->>'timingType', '') = 'instant'
          or (
            p.room_state->>'timingType' is null
            and lower(btrim(coalesce(p.scheduled_at::text, ''))) in ('instant', '즉시')
          )
        then null
        else p.scheduled_date
      end,
      scheduled_time = case
        when coalesce(p.room_state->>'timingType', '') = 'instant'
          or (
            p.room_state->>'timingType' is null
            and lower(btrim(coalesce(p.scheduled_at::text, ''))) in ('instant', '즉시')
          )
        then null
        else p.scheduled_time
      end,
      scheduled_at = case
        when coalesce(p.room_state->>'timingType', '') = 'instant'
          or (
            p.room_state->>'timingType' is null
            and lower(btrim(coalesce(p.scheduled_at::text, ''))) in ('instant', '즉시')
          )
        then null
        when p.scheduled_date is not null and p.scheduled_time is not null then p.scheduled_date::text || ' ' || left(p.scheduled_time::text, 5)
        when p.scheduled_date is not null then p.scheduled_date::text
        else null
      end
    where
      coalesce(p.room_state->>'timingType', '') not in ('instant', 'scheduled')
      or (
        coalesce(p.room_state->>'timingType', 'scheduled') = 'instant'
        and (p.scheduled_date is not null or p.scheduled_time is not null or nullif(btrim(coalesce(p.scheduled_at::text, '')), '') is not null)
      )
      or (
        coalesce(p.room_state->>'timingType', 'scheduled') <> 'instant'
        and p.scheduled_date is not null
        and p.scheduled_at is distinct from case
          when p.scheduled_time is not null then p.scheduled_date::text || ' ' || left(p.scheduled_time::text, 5)
          else p.scheduled_date::text
        end
      );

    execute 'drop trigger if exists rankball_recruiting_schedule_snapshot_guard on public.recruiting_posts';
    execute 'create trigger rankball_recruiting_schedule_snapshot_guard before insert or update of scheduled_at, scheduled_date, scheduled_time, room_state on public.recruiting_posts for each row execute function public.rankball_recruiting_schedule_snapshot_guard()';
  end if;
end;
$$;

select pg_notify('pgrst', 'reload schema');
