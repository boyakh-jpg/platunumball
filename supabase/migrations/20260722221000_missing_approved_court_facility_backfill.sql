insert into public.court_facility_info (
  court_id,
  detail_address,
  created_at,
  updated_at
)
select
  court.id,
  '체육관 1층',
  now(),
  now()
from public.approved_courts court
where court.id = 'court_cr_mrq0v14z_grmsr'
on conflict (court_id) do update set
  detail_address = coalesce(court_facility_info.detail_address, excluded.detail_address),
  updated_at = case
    when court_facility_info.detail_address is null then now()
    else court_facility_info.updated_at
  end;

select pg_notify('pgrst', 'reload schema');
