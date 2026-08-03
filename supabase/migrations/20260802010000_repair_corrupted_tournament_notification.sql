-- Repair one historical tournament notification written with broken UTF-8 text.

update public.notifications
set
  title = '대회 시작',
  body = '대회 일정 잠금 검증 대회가 시작됐습니다. 경기 일정을 확인해 주세요.',
  updated_at = now()
where created_at = timestamptz '2026-07-26 18:26:59.25077+00'
  and payload->>'tournamentId' = 'trn_mrzoso61_499880eb3c'
  and title = '??? ???';
