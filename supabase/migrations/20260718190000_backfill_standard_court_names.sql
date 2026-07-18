update public.approved_courts court
set name = public.rankball_normalize_court_name(court.payload->>'baseName'),
    payload = court.payload || jsonb_build_object(
      'name', public.rankball_normalize_court_name(court.payload->>'baseName'),
      'facilityName', public.rankball_normalize_court_name(court.payload->>'baseName'),
      'canonicalBaseName', public.rankball_normalize_court_name(court.payload->>'baseName'),
      'canonicalName', public.rankball_normalize_court_name(court.payload->>'baseName')
    ),
    updated_at = now()
where nullif(court.payload->>'baseName', '') is not null
  and nullif(court.payload->>'addressDong', '') is not null
  and public.rankball_normalize_court_name(court.name) = public.rankball_normalize_court_name(
    (court.payload->>'addressDong') || ' ' || (court.payload->>'baseName')
  );

update public.court_requests request
set name = public.rankball_normalize_court_name(request.payload->>'baseName'),
    payload = request.payload || jsonb_build_object(
      'name', public.rankball_normalize_court_name(request.payload->>'baseName'),
      'facilityName', public.rankball_normalize_court_name(request.payload->>'baseName'),
      'canonicalBaseName', public.rankball_normalize_court_name(request.payload->>'baseName')
    ),
    updated_at = now()
where nullif(request.payload->>'baseName', '') is not null
  and nullif(request.payload->>'addressDong', '') is not null
  and public.rankball_normalize_court_name(request.name) = public.rankball_normalize_court_name(
    (request.payload->>'addressDong') || ' ' || (request.payload->>'baseName')
  );

update public.courts legacy
set name = approved.name
from public.approved_courts approved
where legacy.id = approved.id
  and legacy.name is distinct from approved.name;
