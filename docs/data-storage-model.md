# RankBall 데이터 저장 모델

## 현재 전환 원칙

- Supabase가 설정된 환경에서는 `mockData` / `localStorage`를 앱 데이터 원천으로 쓰지 않는다.
- `src/lib/mockData.js`는 비-Supabase 개발과 seed 생성용으로만 남긴다.
- 원격 로드 실패 시 데모 state로 fallback하지 않고 빈 원격 shell state를 유지한다.
- 실제 프로필 생성/수정은 `POST /api/profile/upsert` service-role server action을 통과한다.
- 아직 모든 방/경기 액션이 authoritative RPC로 이전된 것은 아니다. 과도기 액션은 기존 클라이언트 reducer 결과를 server action/bridge로 커밋한다.

## 지금 적용한 최소 보안 패치

- `rankball_state`는 RLS로 계속 봉인한다. public read/write 정책을 만들지 않는다.
- `tournaments`는 public read만 유지한다. public insert/update 정책은 제거한다.
- `tournament_teams`는 public read만 유지한다. public insert/update 정책은 제거한다.
- `recruiting_applications` read는 authenticated related-user로 제한한다:
  - 신청자 `player_id`
  - 신청 row의 `player_ids`에 포함된 유저
  - 방장 `recruiting_posts.player_id`
  - 방 row의 `recruiting_posts.player_ids`에 포함된 유저

## Production Migration TODO

- Discord 연동은 로그인 수단이 아니라 프로필 부가 연동으로 둔다.
- 프로필에는 `discordConnection`을 저장한다. normalized Supabase에서는 `profiles.discord_connection` JSONB와 unique용 `profiles.discord_user_id`에 보존한다.
- 알림은 앱 내부 `notifications`를 원본으로 두고, Discord DM은 `discordNotificationDeliveries` 같은 발송 큐에서 서버 Bot이 처리한다.
- Discord DM 큐에는 `webPath`, `webUrl`, `actions`를 저장한다. `actions.customId`는 `rankball:invite:{accept|decline}:{postId}:{invitationId}` 형식이다.
- 배포 전 백엔드는 `POST /api/discord/interactions`에서 Discord signature를 검증하고, 버튼 요청을 같은 초대 수락/거절 서버 액션으로 연결해야 한다.
- `/api/auth/discord/start`와 `/api/auth/discord/callback`은 Discord OAuth `identify` 결과를 프론트로 돌려보내고, 프론트가 OAuth state에 기록된 profile state의 `discordConnection`에 저장한다.
- 같은 `discord_user_id`는 프로필 하나에만 연결한다. 중복이 있으면 앱 로직은 새 연동을 거절하고, DB는 중복 정리 후 unique index로 막는다.
- OAuth 승인 직후 원격 state가 늦게 hydrate되더라도 로컬에 이미 붙은 `discordConnection`은 원격 저장 전까지 보존한다. 단, 원격 state에 같은 Discord ID가 다른 프로필에 이미 연결돼 있으면 보존하지 않는다.
- Bot DM 발송은 브라우저 localStorage 큐를 직접 신뢰하지 않는다. 배포용으로는 서버가 DB의 미발송 `discordNotificationDeliveries`를 읽고 성공/실패 상태를 커밋해야 한다.
- 홈의 해야 할 일은 별도 로직을 중복하지 말고 `notifications` 중 `actionRequired` 성격의 항목을 요약하는 방향으로 통합한다.
- 방 채팅과 Discord 채팅 양방향 연동은 배포 후 백엔드에서 `roomId <-> discordChannelId/threadId` 매핑, 중복 방지 키, 삭제/신고/차단 정책을 둔 뒤 붙인다.

- 심판 시험 문제 추첨, 채점, 주 1회 응시 제한은 서버 함수/DB 정책으로 이동. 클라이언트 번들에는 정답 bank를 두지 않는다.

- 소유권 기준을 Supabase Auth ID로 이전:
  - `profiles.auth_user_id = auth.users.id`
  - `profiles.auth_user_id`는 unique이며 Google/Supabase 계정 하나는 프로필 하나에만 연결한다.
  - `profiles.hashtag`는 unique이며 `handle_locked_at` 이후 수정하지 않는다.
  - `profiles.birth_year`는 `birth_year_locked_at` 이후 수정하지 않는다.
  - `profiles.name_updated_at`으로 닉네임 월 1회 변경 제한을 건다.
  - match participants, recruiting posts, applications, notifications, favorites, reports는 `auth.users.id` 기준으로 연결
- public write 정책을 owner/captain/referee/recorder 정책으로 교체.
- 현재 app-state 동기화 방식을 normalized table read와 좁은 write로 분리.
- service-role 전용 bulk import/export 경로와 browser client write 경로 분리.
- RLS 테스트 추가:
  - 관련 없는 유저는 application을 읽을 수 없음
  - 방장은 자기 방 application을 읽을 수 있음
  - 신청자는 자기 application을 읽을 수 있음
  - public은 tournament를 insert/update 할 수 없음
  - public은 `rankball_state`를 read/write 할 수 없음
- OAuth/profile 소유권이 안정된 뒤에만 demo login을 `VITE_DEMO_LOGIN=true` 뒤로 이동.

## 2026-06-24 구장 등록 배포 TODO

- Naver Maps JavaScript Client ID는 frontend public env로만 둔다: `VITE_NAVER_MAP_CLIENT_ID`.
- Naver Client Secret은 browser bundle에 넣지 않는다.
- `court_requests` server action은 제출 직전에 신뢰도, 정지 상태, 승인/대기 중복, 주소/좌표 존재를 다시 검사한다.
- 승인된 구장은 정규화한 `road_address`, `jibun_address`, `address_text`, `zonecode` 기준 unique constraint 또는 unique index로 중복을 막는다.
- 허위 구장 신고 처리는 report 생성, 요청 상태 변경, 신뢰도 차감, 등록 제한 알림을 하나의 transaction으로 커밋한다.

## 2026-06-24 normalized persistence bridge

- `matches`에 출석, 심판 미출석, 이의 draft, 후보/사후 기록 필드를 저장할 수 있는 컬럼을 추가했다.
- `notifications`, `reports`, `court_requests`, `approved_courts`, `referee_requests`, `referee_exam_attempts`, `admin_appointments`, `referee_appointments`, `admin_audit_log`, `admin_disciplinary_actions`, `discord_notification_deliveries` 테이블을 배포 전환용 브리지로 추가했다.
- 브리지 테이블은 `payload` JSONB를 함께 저장해 현재 앱 state shape 손실을 줄인다.
- `repository.js`는 브리지 테이블이 없거나 RLS로 막혀도 전체 원격 로드를 실패시키지 않는다.
- 선택 테이블 write도 core profile/team/match 저장을 망가뜨리지 않게 optional write로 둔다.
- 이 작업은 서버 권한화 완료가 아니다. 관리자 처리, 구장 승인, 허위 구장 신고, Discord DM 발송은 아직 server action/transaction/service role 경로가 필요하다.

## 2026-06-24 server bridge write

- `VITE_ENABLE_SERVER_BRIDGE_WRITE=true`이면 optional bridge write는 browser Supabase upsert 대신 `POST /api/supabase/bridge`로 보낸다.
- `/api/supabase/bridge`는 Supabase access token을 검증하고 `profiles.auth_user_id`로 앱 `profileId`를 찾는다.
- 일반 유저는 자기 `notifications`, `reports`, `referee_requests`, `referee_exam_attempts`, `discord_notification_deliveries` row만 브리지로 쓸 수 있다.
- `court_requests` write는 브리지를 우회하지 않고 `POST /api/court-requests/submit`, `approve`, `report` server action으로 처리한다.
- `approved_courts`, 관리자 임명, 심판 임명, audit log, 징계 row는 관리자 권한이 있어야 쓸 수 있다.
- 서버 API에는 `SUPABASE_SERVICE_ROLE_KEY`가 필요하다. 프론트 env에 넣으면 안 된다.
- 최초 최고관리자는 `RANKBALL_OWNER_AUTH_USER_IDS` 또는 `RANKBALL_OWNER_PROFILE_IDS` env로 지정하거나 DB에 active `admin_appointments`를 넣어야 한다.
- `VITE_ENABLE_SERVER_ACTIONS=true`이면 구장 등록요청 제출/신고/승인은 local state 갱신과 함께 서버 transaction API도 호출한다.
- `POST /api/court-requests/approve`는 `rankball_approve_court_request()` RPC로 승인 구장 생성, 요청 상태 변경, audit log, 알림을 한 transaction으로 처리한다.
- `POST /api/court-requests/report`는 `rankball_report_court_request()` RPC로 신고 생성, 요청자 신뢰도 차감, 요청 상태 변경, 알림을 한 transaction으로 처리한다.
- `POST /api/court-requests/submit`은 `rankball_submit_court_request()` RPC로 구장 등록요청 제출 직전 신뢰도와 승인/대기 중복을 서버에서 다시 검사한다.
- 일반 관리자 신고 처리, 임명/징계 처리, Discord DM worker API는 분리되어 있으며, Discord 버튼 interaction은 아직 남는다.

## 2026-06-25 Supabase-only frontend bootstrap

- `loadState({ includeDemo: false })`는 localStorage를 읽지 않고 빈 Supabase shell state를 만든다.
- `normalizeState(..., { includeDemo: false })`는 `initialState`의 유저, 팀, 경기, 모집방, 신고, 즐겨찾기를 병합하지 않는다.
- Supabase hydration은 `loadRemoteState(authUserId, authEmail)`로 현재 auth profile을 우선 선택한다.
- 현재 auth profile이 아직 없으면 `createProfileShell()`로 `/app/signup`이 깨지지 않게 하고, 저장 시 `POST /api/profile/upsert`가 실제 `profiles.auth_user_id` row를 만든다.
- Supabase 모드에서는 `rankball_state` localStorage 저장을 하지 않는다.
- `profileBindings` localStorage는 Supabase 모드의 프로필 선택 기준으로 쓰지 않는다. 실제 기준은 `profiles.auth_user_id`다.
- 테스트 시나리오 데이터는 프론트가 직접 읽지 않고 `npm run seed:supabase`로 normalized Supabase tables에 넣는다.
- `seed:supabase`는 `SUPABASE_SERVICE_ROLE_KEY`와 `SUPABASE_URL` 또는 `VITE_SUPABASE_URL`이 필요하다.
- 테스트 계정 쓰기는 `test-token-rankball-###` bearer token을 서버가 `profiles.test_login_id`로 매핑할 때만 허용한다.
- 테스트 계정 저장은 `profiles.auth_user_id`를 건드리지 않는다.

## 2026-06-25 Vercel Hobby API consolidation

- Hobby serverless function 한도를 피하기 위해 실제 Vercel API route는 `api/index.js` 하나로 둔다.
- 기존 API handler 파일들은 `server/api/` 아래로 이동하고 `api/index.js`가 path 기준으로 dispatch한다.
- `vercel.json`은 `/api/:path*`를 `/api?path=:path*`로 먼저 rewrite하고, 그 다음 SPA fallback을 `/index.html`로 보낸다.

## 2026-06-24 admin server actions

- `POST /api/admin/review-action`은 `rankball_commit_admin_review_action()` RPC로 신고 상태 변경, audit log, 징계 row, 신고자/대상자 알림을 한 transaction으로 처리한다.
- `POST /api/admin/appointment-action`은 `rankball_commit_admin_appointment_action()` RPC로 관리자/심판 임명과 회수, audit log, 대상자 알림을 한 transaction으로 처리한다.
- `POST /api/admin/disciplinary-action`은 `rankball_commit_admin_disciplinary_action()` RPC로 직접 징계, audit log, 대상자 알림을 한 transaction으로 처리한다.
- 브라우저는 `admin_audit_log`, `admin_disciplinary_actions`, `admin_appointments`, `referee_appointments`를 직접 insert/update/delete 하지 않는다.
- `VITE_ENABLE_SERVER_ACTIONS=true`일 때 관리자 UI는 local state를 먼저 갱신하고 같은 draft를 server action에 전달한다. 배포 전에는 server action 성공 결과 기준으로 재조회/동기화해야 한다.
- Supabase 설정 환경의 프론트 bootstrap에서는 `localStorage/mockData` 앱 데이터 fallback을 제거했다. 남은 작업은 방/경기 reducer 자체를 authoritative RPC로 이전하는 것이다.

## 2026-06-24 Discord DM worker

- `POST /api/discord/dm-worker`는 `discord_notification_deliveries.status=queued` row를 `sending`으로 claim한 뒤 Discord Bot DM을 발송한다.
- 성공하면 delivery row를 `sent`, 실패하면 `failed`로 커밋하고 `payload`에 Discord message/channel ID 또는 error를 남긴다.
- worker 호출은 `DISCORD_WORKER_SECRET` 또는 `CRON_SECRET` bearer가 있으면 허용한다. secret이 없으면 관리자 Supabase bearer token과 admin level 30 이상이 필요하다.
- 필요한 env는 `DISCORD_BOT_TOKEN`이다.
- `vercel.json`은 `/api/discord/dm-worker`를 5분마다 호출하도록 설정한다. 배포 환경에는 `CRON_SECRET`을 넣어야 한다.
- Discord interaction 버튼 수락/거절 처리와 채팅 양방향 연동은 아직 남은 작업이다.

## 2026-06-24 RLS hardening

- `tournaments`, `tournament_teams`의 anon read는 `visibility='public'`만 허용한다.
- 비공개 tournament read는 생성자, 참가 팀 멤버, 승인자, 관리자만 허용한다.
- `profiles.auth_user_id`는 `uuid references auth.users(id)`로 강제하며 중복, non-uuid, orphan 값이 있으면 migration을 실패시킨다.
- 클라이언트는 `profiles.auth_user_id`를 insert/update 할 수 없다. 서버/service-role만 설정한다.
- `notifications` 직접 update는 막고 `rankball_mark_notification_read()` RPC로 `read_at`만 바꾼다.
- `reports`는 신고자 insert만 허용하고 관리자 read policy를 별도로 둔다.
- `referee_requests` 소유자 컬럼은 `requested_by`다.
- 관리자/심판 임명, audit, 징계, 승인 구장 write는 client 정책을 만들지 않는다. server/service-role만 처리한다.
- `approved_courts`는 authenticated read만 허용하고 payload에서 요청자/신뢰도/승인자 내부값을 제거한다.
- `affiliations`, `seasons` public read는 public-safe 데이터만 넣는 전제다.

## 2026-06-25 recruiting server sync

- `POST /api/recruiting/sync-post`를 추가했다.
- 생성/참여/초대/초대 수락/거절/READY/배치/파티/채팅/방닫기 후 해당 `recruitingPost` snapshot을 서버에 즉시 upsert한다.
- 서버는 Supabase bearer를 검증하고 `profiles.auth_user_id`에 매핑된 `profileId`가 방장, 참여자, 초대 발신자, 초대 대상자 중 하나인지 확인한다.
- 서버는 `recruiting_posts`, `recruiting_applications`, 관련 `notifications`를 갱신한다.
- `recruiting_posts` 저장/로드 매핑에 `title`, `visibility`, `rules`, `official`, `preRegistered`, 구장예약, 연령 제한, `sourceTeamId/sourceEntryId`를 보존한다.
- 이 단계는 아직 완전한 authoritative room engine이 아니다. 클라이언트의 기존 로컬 액션 결과를 서버에 커밋하는 과도기 브리지다.
- 다음 단계는 생성/참여/초대/수락 계산 자체를 RPC 내부로 옮기고, 경기 확정 시 `matches` 생성도 같은 transaction으로 묶는 것이다.

## 2026-06-25 match server sync

- `POST /api/matches/sync-match`를 추가했다.
- 경기 생성, 동의, 출석, 심판 미출석, 경기 시작/종료, 기록 제출, 승인, 이의, 룰/슬롯 수정 후 해당 `match` snapshot을 서버에 즉시 upsert한다.
- 서버는 Supabase bearer를 검증하고 현재 `profileId`가 경기 참가자, 심판, 기존 생성자 중 하나인지 확인한다.
- 서버는 `matches`, `match_players`, `match_results`, `player_match_stats`, `match_agreements`, `match_approvals`, `match_disputes`, 관련 `notifications`를 갱신한다.
- 이 단계는 아직 완전한 authoritative match engine이 아니다. 클라이언트 reducer 결과를 서버에 커밋하는 과도기 브리지다.
- 다음 단계는 슬롯 점유, 출석 강퇴, 결과/이의 승인, MMR 반영을 RPC transaction으로 옮기는 것이다.

## 2026-06-25 report submit bridge

- `POST /api/reports/submit`을 추가했다.
- 경기 신고 생성 후 새 `report`와 신고 접수 `notifications`를 서버에 저장한다.
- 서버는 Supabase bearer를 검증하고 신고자 `user_id`를 현재 `profileId`로 강제한다.
- `match` 신고는 경기 참가자/후보/출전 이력/방장/심판만 가능하고 7일 신고 기한을 서버에서도 확인한다.
- `player` 신고는 대상 프로필 존재 여부와 자기신고 금지만 확인한다.
- `court_request` 신고는 중복 신고, 신뢰도 차감, 상태 변경이 묶인 기존 `POST /api/court-requests/report`만 사용한다.
- 아직 신고 생성만 server action화한 단계다. 신고 판정/징계/피드백은 기존 관리자 RPC가 처리한다.

## 2026-06-25 team sync bridge

- `POST /api/teams/sync-team`을 추가했다.
- 팀 생성, 삭제, 팀원 추가, 역할 변경, 팀원 제거 후 `teams`, `team_members`, 관련 `notifications`를 서버에 저장한다.
- 서버는 Supabase bearer를 검증하고 기존 팀은 현재 `profileId`가 주장일 때만 변경한다.
- 새 팀은 현재 `profileId`가 주장 멤버로 포함된 경우만 생성한다.
- 서버는 팀명 14자 제한, 멤버 프로필 존재 여부, 1인 3팀 제한을 다시 검사한다.
- 삭제는 `deleted_at` soft delete로 처리하고 `team_members`, 팀 즐겨찾기, 해당 팀 모집방 상태를 함께 정리한다.
- 아직 완전한 team authority engine은 아니다. 클라이언트 reducer 결과를 서버에 커밋하는 과도기 브리지다.

## 2026-06-25 tournament sync bridge

- `POST /api/tournaments/sync-tournament`를 추가했다.
- 토너먼트/리그 생성과 팀 승인 후 `tournaments`, `tournament_teams`, 관련 `notifications`를 서버에 저장한다.
- 서버는 생성자는 전체 sync를 허용하고, 팀장은 `action=approveTeam`으로 자기 팀 승인 sync만 허용한다.
- 초대팀 존재 여부와 토너먼트 최소 2팀 조건을 서버에서도 확인한다.
- 승인 완료로 자동 생성된 경기는 기존 `POST /api/matches/sync-match`로 같이 저장한다.
- 토너먼트 경기 일정 변경은 match snapshot 변경이므로 기존 match sync 경로를 사용한다.
- 아직 완전한 tournament authority engine은 아니다. 팀 승인, 대진 생성, 경기 생성 계산은 클라이언트 reducer 결과를 커밋한다.

## 2026-06-25 referee request bridge

- `POST /api/referee/sync`를 추가했다.
- 심판 시험 시작/종료는 `referee_exam_attempts`에 저장한다.
- 심판 등록요청은 `referee_requests`와 관련 `notifications`에 저장한다.
- 서버는 `user_id`, `requested_by`를 현재 `profileId`로 강제하고 신뢰도 90점 조건을 다시 확인한다.
- 시험 시작은 서버에서 `available_after` 쿨다운을 확인한다.
- 커뮤니티 심판 등록요청은 같은 사용자/시험버전의 passed attempt가 있어야 저장된다.
- 심판 임명, 등급 부여, 회수는 기존 관리자 임명 server action 영역으로 남긴다.

## 2026-06-25 favorites sync bridge

- `POST /api/favorites/sync`를 추가했다.
- 선수, 팀, 구장 즐겨찾기 토글 후 `favorites` row를 서버에 upsert/delete한다.
- 서버는 `user_id`를 현재 `profileId`로 강제한다.
- 선수와 팀 즐겨찾기는 대상 존재 여부를 확인한다.
- 구장은 정적 seed 구장과 승인 구장 id가 섞여 있어 현재 단계에서는 target id 존재 검사를 보류한다.

## 2026-06-25 notification read bridge

- `POST /api/notifications/read`를 추가했다.
- 단일 알림 읽음은 `notificationId`, 전체 읽음은 `all=true`로 처리한다.
- 서버는 현재 `profileId`가 `user_id` 또는 `target_user_id`인 row만 `read_at`, `updated_at`으로 갱신한다.
- 브라우저의 직접 `notifications` update는 계속 금지한다.

## 2026-06-25 court review bridge

- `court_reviews`는 구장별 리뷰 평균을 만들기 위한 서버 테이블이다.
- `POST /api/courts/submit-review`는 `rankball_submit_court_review()` RPC로 경기 참가자만 리뷰를 제출하게 한다.
- 같은 경기에서 같은 사용자는 리뷰 1개만 유지한다. 재제출은 수정으로 처리한다.
- 프론트는 `court_reviews`를 읽어 `getRegisteredCourts()`에서 `reviewSummary`, `rating`, `reviewCount`를 붙인다.
- 구장 hover 카드의 별점 표시는 기존 UI를 재사용하며 `court_reviews.rating` 평균과 리뷰 수를 보여준다.
- 경기방 postgame 보조 카드에서 참가자가 구장 리뷰를 작성하고 `POST /api/courts/submit-review`로 서버 저장한다.
- 다음 단계는 구장 리뷰 신고/관리자 검토 연결이다.

## 2026-06-25 abuse/integrity scenario seed

- `scripts/seed-demo-flow.mjs`는 기존 `reports`, `settings.courtRequests`, `settings.adminAuditLog`, `settings.adminDisciplinaryActions`, `notifications`, `matches`, `users` shape만 사용해 abuse/integrity 시나리오를 추가한다.
- 신고 status는 현재 관리자 UI/server action이 처리하는 `open`, `resolved`, `dismissed`만 사용한다.
- 구장 신고는 현재 공식 target인 `type="court_request"`만 사용한다. `approved_courts` 직접 신고, hidden/disabled 상태는 아직 seed하지 않는다.
- 나이 관련 seed는 `profiles.birth_year`, `profiles.age_group`, `recruiting_posts.ageRestriction`, `recruiting_posts.allowedAgeGroups`에 맞춘다. `claimed_birth_year`, `verified_birth_year`, `verification_status`는 현재 schema가 없어 만들지 않는다.
- 완료된 경기의 사기 의심은 최종 결과를 직접 바꾸지 않고 `status="disputed"` match와 `reports`로 표현한다.
- fraud report는 자동 ranking 변경을 만들지 않는다. 확정 제재 시나리오는 `adminDisciplinaryActions`와 낮은 `trustScore`로만 표현한다.

Scenario map:

| scenario | related rows | expected behavior |
| --- | --- | --- |
| `reported_court_wrong_location` | `cr_reported_court_wrong_location`, `r_reported_court_wrong_location` | 관리자 구장별 큐에 open 신고로 노출 |
| `reported_court_closed` | `cr_reported_court_closed`, `r_reported_court_closed` | 폐쇄 구장 신고가 구장요청 기준으로 묶임 |
| `reported_court_unsafe` | `cr_reported_court_unsafe`, `r_reported_court_unsafe`, `r_reported_court_broken_hoop` | 같은 구장요청에 여러 신고자 신고 누적 |
| `age_fraud_u13_to_open` | `u32`, `r_age_fraud_u13_to_open` | 플레이어별 open 신고로 노출, ranking 자동 변경 없음 |
| `age_fraud_u20_to_open` | `u35`, `r_age_fraud_u20_to_open` | resolved 신고와 active suspension row 노출 |
| `age_verification_pending` | none | backend gap: verification status 없음 |
| `age_verification_rejected` | none | backend gap: verification status 없음 |
| `age_fraud_match_dispute` | disputed match, `r_age_fraud_match_dispute` | 경기별 큐에 이의/신고 같이 노출 |
| `admin_resolved_age_fraud` | `aa_admin_resolved_age_fraud`, `n_admin_resolved_age_fraud` | 신고자 피드백 알림과 audit row 존재 |
| `low_trust_after_confirmed_fraud` | `u35`, `ad_low_trust_after_confirmed_fraud` | 신뢰도 낮은 유저와 제재 row 존재 |
| `blocked_user_wrong_division` | none | backend gap: 참여 시점 연령 자격 차단 미구현 |

Backend gaps:

- `reports`는 `target_type/reporter_id`가 아니라 `type/user_id` 구조다. seed와 server action은 이 구조를 따라야 한다.
- 승인 구장(`approved_courts`) 신고, 구장 hidden/disabled moderation status가 없다.
- 구장 리뷰 신고/숨김은 아직 `court_reviews`와 `reports` 사이 연결이 없다.
- `profiles`에는 birth year와 age group만 있고 나이 인증 상태, 신고 전 주장 나이, 관리자 검증 나이를 분리 저장할 컬럼이 없다.
- 방 생성자는 연령 제한 밖이면 생성이 막히지만, recruiting 참여/초대 수락 시점의 연령 차단은 아직 authoritative server logic이 아니다.
- abuse/integrity seed는 demo state 생성기에 들어갔다. Supabase Auth user 150명 이상을 만드는 service-role alpha seed script와 cleanup script는 별도 남은 작업이다.
