begin;

do $migration$
declare
  function_definition text;
  old_time text := $old$  match_occurred_at := coalesce(
    current_match.confirmed_at,
    current_match.ended_at,
    current_match.started_at,
    case
      when current_match.scheduled_date is not null and current_match.scheduled_time is not null
        then (current_match.scheduled_date + current_match.scheduled_time) at time zone 'Asia/Seoul'
      when current_match.scheduled_date is not null
        then current_match.scheduled_date::timestamp at time zone 'Asia/Seoul'
      else null
    end,
    current_match.created_at,
    now()
  );
  match_record_date := coalesce(
    current_match.scheduled_date,
    (match_occurred_at at time zone 'Asia/Seoul')::date
  );$old$;
  new_time text := $new$  match_occurred_at := coalesce(
    case
      when lower(coalesce(current_match.rules->>'recordType', 'match')) in ('match_record', 'personal_record')
        and current_match.scheduled_date is not null
        then (current_match.scheduled_date + coalesce(current_match.scheduled_time, time '12:00')) at time zone 'Asia/Seoul'
      else current_match.started_at
    end,
    current_match.started_at,
    current_match.ended_at,
    current_match.confirmed_at,
    case
      when current_match.scheduled_date is not null
        then (current_match.scheduled_date + coalesce(current_match.scheduled_time, time '12:00')) at time zone 'Asia/Seoul'
      else null
    end,
    current_match.created_at,
    now()
  );
  match_record_date := (match_occurred_at at time zone 'Asia/Seoul')::date;$new$;
begin
  function_definition := pg_get_functiondef(
    'public.rankball_refresh_match_record_archive(text)'::regprocedure
  );
  if position(new_time in function_definition) = 0 then
    if position(old_time in function_definition) = 0 then
      raise exception 'match_record_actual_played_date_shape_changed' using errcode = '55000';
    end if;
    execute replace(function_definition, old_time, new_time);
  end if;
end;
$migration$;

with canonical as (
  select
    match_row.id,
    coalesce(
      case
        when lower(coalesce(match_row.rules->>'recordType', 'match')) in ('match_record', 'personal_record')
          and match_row.scheduled_date is not null
          then (match_row.scheduled_date + coalesce(match_row.scheduled_time, time '12:00')) at time zone 'Asia/Seoul'
        else match_row.started_at
      end,
      match_row.started_at,
      match_row.ended_at,
      match_row.confirmed_at,
      case
        when match_row.scheduled_date is not null
          then (match_row.scheduled_date + coalesce(match_row.scheduled_time, time '12:00')) at time zone 'Asia/Seoul'
        else null
      end,
      match_row.created_at
    ) as occurred_at
  from public.matches match_row
  where match_row.status = 'confirmed'
)
update public.match_record_archives archive_row
set
  occurred_at = canonical.occurred_at,
  record_date = (canonical.occurred_at at time zone 'Asia/Seoul')::date,
  updated_at = now()
from canonical
where archive_row.match_id = canonical.id
  and canonical.occurred_at is not null;

update public.match_record_participants participant
set occurred_at = archive_row.occurred_at, record_date = archive_row.record_date
from public.match_record_archives archive_row
where archive_row.match_id = participant.match_id
  and (
    participant.occurred_at is distinct from archive_row.occurred_at
    or participant.record_date is distinct from archive_row.record_date
  );

update public.match_record_teams team_record
set occurred_at = archive_row.occurred_at, record_date = archive_row.record_date
from public.match_record_archives archive_row
where archive_row.match_id = team_record.match_id
  and (
    team_record.occurred_at is distinct from archive_row.occurred_at
    or team_record.record_date is distinct from archive_row.record_date
  );

select pg_notify('pgrst', 'reload schema');

commit;
