# RankBall 데이터 저장 모델

## 2026-06-30 profile match summary

- `profile_match_summaries`는 확정 경기 기준 선수 누적 통계 캐시다.
- key는 `profile_id` 1 row다. 저장 값은 경기 수, 승/패/무, 기본 박스스코어 합계, 마지막 경기 참조다.
- 갱신 경로는 DB trigger다:
  - `matches` status/confirmed/score 변경
  - `match_results` 변경
  - `match_players` 변경
  - `player_match_stats` 변경
- trigger는 확정 경기일 때만 summary를 재집계한다. page load, 검색, 목록 응답에서 전체 match scan을 하지 않는다.
- `/api/profile/me`는 현재 사용자 summary만 읽는다. 다른 프로필, 팀, 심판 summary는 별도 설계 후 추가한다.

## 현재 전환 원칙

- Supabase가 설정된 환경에서는 `mockData` / `localStorage`를 앱 데이터 원천으로 쓰지 않는다.
- `src/lib/mockData.js`는 비-Supabase 개발과 seed 생성용으로만 남긴다.
- 프론트 `repository.js`는 `mockData.js`를 정적으로 import하지 않는다. `useAppData`는 개발 빌드의 비-Supabase local/demo 모드에서만 demo state를 동적으로 로드한다.
- 원격 로드 실패 시 데모 state로 fallback하지 않고 빈 원격 shell state를 유지한다.
- 실제 프로필 생성/수정은 `POST /api/profile/upsert` service-role server action을 통과한다.
- `POST /api/profile/upsert`는 일반 프로필 저장에서 `trust_score`, `ratings`, `streak` 클라이언트 변경을 무시하고 DB 기존값 또는 기본값만 유지한다.
- 아직 모든 방/경기 액션이 authoritative RPC로 이전된 것은 아니다. 다만 Supabase 환경에서 전체 app state 자동 저장은 하지 않고, 변경 단위별 server action으로만 커밋한다.

## 지금 적용한 최소 보안 패치

- legacy `rankball_state` 테이블은 런타임 미사용이며 schema migration에서 제거한다.
- `tournaments`는 public read만 유지한다. public insert/update 정책은 제거한다.
- `tournament_teams`는 public read만 유지한다. public insert/update 정책은 제거한다.
- `recruiting_applications` read는 authenticated related-user로 제한한다:
  - 신청자 `player_id`
  - 신청 row의 `player_ids`에 포함된 유저
  - 방장 `recruiting_posts.player_id`
  - 방 row의 `recruiting_posts.player_ids`에 포함된 유저
  - 방 row의 `room_state.ownerId`, `room_state.invitations` 관련 유저, `referee_id`
- `recruiting_posts` raw table read는 anon/public 전체 공개가 아니다. authenticated 현재 프로필이 `player_id`, `player_ids`, `room_state.ownerId`, `room_state.invitations`, `referee_id` 중 하나와 관련될 때만 허용한다.

## Production Migration TODO

- Discord 연동은 로그인 수단이 아니라 프로필 부가 연동으로 둔다.
- 프로필에는 `discordConnection`을 저장한다. normalized Supabase에서는 `profiles.discord_connection` JSONB와 unique용 `profiles.discord_user_id`에 보존한다.
- 알림은 앱 내부 `notifications`를 원본으로 두고, Discord DM은 `discordNotificationDeliveries` 같은 발송 큐에서 서버 Bot이 처리한다.
- Discord DM 큐에는 `webPath`, `webUrl`, `actions`를 저장한다. `actions.customId`는 `rankball:invite:{accept|decline}:{postId}:{invitationId}` 형식이다.
- 백엔드는 `POST /api/discord/interactions`에서 Discord signature를 검증하고, 초대 수락/거절 버튼 요청을 같은 초대 서버 액션으로 연결한다.
- `/api/auth/discord/start`와 `/api/auth/discord/callback`은 Discord OAuth `identify` 결과를 프론트로 돌려보내고, 프론트가 OAuth state에 기록된 profile state의 `discordConnection`에 저장한다.
- 같은 `discord_user_id`는 프로필 하나에만 연결한다. 중복이 있으면 앱 로직은 새 연동을 거절하고, DB는 중복 정리 후 unique index로 막는다.
- 프로필 저장 서버 액션도 `discord_user_id` 중복을 다시 확인한다. `discordConnection: null`은 명시적 연결 해제로 처리한다.
- OAuth 승인 직후 원격 state가 늦게 hydrate되더라도 로컬에 이미 붙은 `discordConnection`은 원격 저장 전까지 보존한다. 단, 원격 state에 같은 Discord ID가 다른 프로필에 이미 연결돼 있으면 보존하지 않는다.
- Bot DM 발송은 브라우저 localStorage 큐를 직접 신뢰하지 않는다. 배포용으로는 서버가 DB의 미발송 `discordNotificationDeliveries`를 읽고 성공/실패 상태를 커밋해야 한다.
- 홈의 해야 할 일은 별도 로직을 중복하지 말고 `notifications` 중 `actionRequired` 성격의 항목을 요약하는 방향으로 통합한다.
- 방 채팅과 Discord 채팅 양방향 연동은 `room_discord_links` 매핑과 `room_chat_messages.external_message_id` 중복 방지 키를 사용한다. 웹 채팅은 서버가 Discord REST로 전송하고, Discord 채팅은 `scripts/discord-room-chat-bridge.mjs`가 Gateway 이벤트를 받아 인증된 `/api/discord/room-chat` bridge로 넣는다. Discord thread 메시지는 Gateway `channel_id`가 thread id로 들어와도 `room_discord_links` 기준 parent channel/thread id로 정규화해 저장한다.

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
  - legacy `rankball_state`는 앱 경로에서 쓰지 않고 DB에서도 제거 대상임
- OAuth/profile 소유권이 안정된 뒤에만 demo login을 `VITE_DEMO_LOGIN=true` 뒤로 이동.

## 2026-06-24 구장 등록 배포 TODO

- Naver Maps JavaScript Client ID는 frontend public env로만 둔다: `VITE_NAVER_MAP_CLIENT_ID`.
- Naver Client Secret은 browser bundle에 넣지 않는다.
- `court_requests` server action은 제출 직전에 신뢰도, 정지 상태, 승인/대기 중복, 주소/좌표 존재를 다시 검사한다.
- 승인된 구장은 정규화한 `road_address`, `jibun_address`, `address_text`, `zonecode` 기준 unique constraint 또는 unique index로 중복을 막는다.
- 허위 구장 신고 처리는 report 생성, 요청 상태 변경, 신뢰도 차감, 등록 제한 알림을 하나의 transaction으로 커밋한다.

## 2026-06-24 normalized persistence tables

- `matches`에 출석, 심판 미출석, 이의 draft, 후보/사후 기록 필드를 저장할 수 있는 컬럼을 추가했다.
- `notifications`, `reports`, `court_requests`, `approved_courts`, `referee_requests`, `referee_exam_attempts`, `admin_appointments`, `referee_appointments`, `admin_audit_log`, `admin_disciplinary_actions`, `discord_notification_deliveries` 테이블을 배포용 정규 테이블로 추가했다.
- 일부 테이블은 `payload` JSONB를 함께 저장해 현재 앱 state shape 손실을 줄인다.
- `repository.js`는 선택 테이블이 없거나 RLS로 막혀도 전체 원격 로드를 실패시키지 않는다.
- 선택 테이블 write도 core profile/team/match 저장을 망가뜨리지 않게 optional write로 둔다.
- 이 작업은 서버 권한화 완료가 아니다. 관리자 처리, 구장 승인, 허위 구장 신고, Discord DM 발송은 아직 server action/transaction/service role 경로가 필요하다.

## 2026-06-26 dedicated server action write

- `reports_self_read` RLS는 신고자, 대상자, `reported_user_ids` 포함 사용자만 본인 관련 신고 row를 읽게 한다. 전체 신고 큐는 관리자 정책 또는 server action 경로만 사용한다.

- Supabase 설정 환경이면 browser가 전체 app state를 자동 저장하지 않는다.
- `/api/supabase/bridge`, `VITE_ENABLE_SERVER_BRIDGE_WRITE`, `VITE_ENABLE_BULK_REMOTE_WRITE` 경로는 제거했다.
- 신고 생성은 `POST /api/reports/submit`, 구장요청 신고는 `POST /api/court-requests/report`만 사용한다.
- `reports`, `court_requests`, `approved_courts`, `court_reviews`, `matches`, 경기 하위 테이블, `recruiting_posts`, `recruiting_applications`는 browser role의 insert/update/delete/truncate/trigger/reference grant와 browser write policy를 두지 않는다. 브라우저는 scoped RLS `select`만 사용하고 write는 server action/RPC만 사용한다.
- 심판 시험/요청은 `POST /api/referee/sync`만 사용한다.
- Discord DM 발송 큐는 `POST /api/discord/sync-deliveries`가 현재 프로필의 `discord_user_id` 기준으로만 저장한다.
- `court_requests` write는 `POST /api/court-requests/submit`, `approve`, `report` server action으로 처리한다.
- `approved_courts`, 관리자 임명, 심판 임명, audit log, 징계 row는 전용 server action/RPC만 사용한다.
- 서버 API에는 `SUPABASE_SERVICE_ROLE_KEY`가 필요하다. 프론트 env에 넣으면 안 된다.
- 최초 최고관리자는 `RANKBALL_OWNER_AUTH_USER_IDS` 또는 `RANKBALL_OWNER_PROFILE_IDS` env로 지정하거나 DB에 active `admin_appointments`를 넣어야 한다.
- Supabase 설정 환경이면 구장 등록요청 제출/신고/승인은 local state 갱신과 함께 서버 transaction API도 호출한다. 끄려면 `VITE_ENABLE_SERVER_ACTIONS=false`를 명시한다.
- `POST /api/court-requests/approve`는 `rankball_approve_court_request()` RPC로 승인 구장 생성, 요청 상태 변경, audit log, 알림을 한 transaction으로 처리한다.
- `POST /api/court-requests/report`는 `rankball_report_court_request()` RPC로 신고 생성, 요청자 신뢰도 차감, 요청 상태 변경, 알림을 한 transaction으로 처리한다.
- `POST /api/court-requests/submit`은 `rankball_submit_court_request()` RPC로 구장 등록요청 제출 직전 신뢰도와 승인/대기 중복을 서버에서 다시 검사한다.
- 일반 관리자 신고 처리, 임명/징계 처리, Discord DM worker API, Discord 초대 버튼 interaction은 분리된 server action이다.

## 2026-06-25 Supabase-only frontend bootstrap

- `loadState({ includeDemo: false })`는 localStorage를 읽지 않고 빈 Supabase shell state를 만든다.
- `normalizeState(..., { includeDemo: false })`는 `initialState`의 유저, 팀, 경기, 모집방, 신고, 즐겨찾기를 병합하지 않는다.
- Supabase hydration은 `loadRemoteState(authUserId, authEmail)`로 현재 auth profile을 우선 선택한다.
- 현재 auth profile이 아직 없으면 `createProfileShell()`로 `/app/signup`이 깨지지 않게 하고, 저장 시 `POST /api/profile/upsert`가 실제 `profiles.auth_user_id` row를 만든다.
- Supabase 모드에서는 `rankball_state` localStorage 저장을 하지 않는다.
- 프로필 저장 실패는 로컬 optimistic profile 상태를 되돌려 `/app/signup`에서 다시 수정 가능하게 한다.

## DB 정리 기준

- `recruiting_posts`는 모집방 원본이다. `room_state`는 초대, 파티장, 슬롯 포지션 같은 방 내부 상태 snapshot으로만 둔다.
- `recruiting_applications`는 모집방 참여자 원본이다. 참여/포지션 유지 여부는 이 테이블과 `recruiting_posts.room_state.slotPositions`를 함께 본다.
- `matches`는 확정 경기 본체와 빠른 카드 표시용 snapshot을 같이 가진다.
- `match_players`, `match_results`, `player_match_stats`, `match_agreements`, `match_approvals`, `match_disputes`는 현재 경기 상세/기록/승인 원본 경로라 삭제하지 않는다.
- FK처럼 쓰는 text 컬럼은 빈 문자열을 저장하지 않는다. 없으면 `null`이다.
- `profileBindings` localStorage는 Supabase 모드의 프로필 선택 기준으로 쓰지 않는다. 실제 기준은 `profiles.auth_user_id`다.
- 테스트 시나리오 데이터는 프론트가 직접 읽지 않고 `npm run seed:supabase`로 normalized Supabase tables에 넣는다.
- `seed:supabase`는 `SUPABASE_SERVICE_ROLE_KEY`와 `SUPABASE_URL` 또는 `VITE_SUPABASE_URL`이 필요하다.
- 테스트 계정 쓰기는 Supabase Auth bearer token을 서버가 `profiles.auth_user_id`로 매핑할 때만 허용한다.
- `profiles.test_login_id`는 seed/login handle이며 소유권 검증에 쓰지 않는다.
- 프로필 저장은 가입 필수 경로라 `VITE_ENABLE_SERVER_ACTIONS`가 꺼져도 `/api/profile/upsert`를 시도하고, 실패하면 화면에 오류를 보여준다.

## 2026-06-25 Vercel Hobby API consolidation

- Hobby serverless function 한도를 피하기 위해 실제 Vercel API route는 `api/index.js` 하나로 둔다.
- 기존 API handler 파일들은 `server/api/` 아래로 이동하고 `api/index.js`가 path 기준으로 dispatch한다.
- `vercel.json`은 `/api/:path*`를 `/api?path=:path*`로 먼저 rewrite하고, 그 다음 SPA fallback을 `/index.html`로 보낸다.

## 2026-06-24 admin server actions

- `POST /api/admin/review-action`은 `rankball_commit_admin_review_action()` RPC로 신고 상태 변경, audit log, 징계 row, 신고자/대상자 알림을 한 transaction으로 처리한다.
- `POST /api/admin/appointment-action`은 `rankball_commit_admin_appointment_action()` RPC로 관리자/심판 임명과 회수, audit log, 대상자 알림을 한 transaction으로 처리한다.
- `POST /api/admin/disciplinary-action`은 `rankball_commit_admin_disciplinary_action()` RPC로 직접 징계, audit log, 대상자 알림을 한 transaction으로 처리한다.
- 브라우저는 `admin_audit_log`, `admin_disciplinary_actions`, `admin_appointments`, `referee_appointments`를 직접 insert/update/delete 하지 않는다.
- 해당 admin 테이블들은 browser role의 write/truncate/trigger/reference grant를 모두 제거하고, authenticated admin select만 RLS로 허용한다.
- Supabase 설정 환경에서 관리자 UI는 local state를 먼저 갱신하고 같은 draft를 server action에 전달한다. 배포 전에는 server action 성공 결과 기준으로 재조회/동기화해야 한다.
- Supabase 설정 환경의 프론트 bootstrap에서는 `localStorage/mockData` 앱 데이터 fallback을 제거했다. 남은 작업은 방/경기 reducer 자체를 authoritative RPC로 이전하는 것이다.

## 2026-06-24 Discord DM worker

- `POST /api/discord/dm-worker` 또는 `GET /api/discord/dm-worker`는 `discord_notification_deliveries.status=queued`, `sent_at is null`, `send_at <= now()` row를 `sending`으로 claim한 뒤 Discord Bot DM을 발송한다.
- 성공하면 delivery row를 `sent`로 커밋하고 `sent_at`과 Discord message/channel ID를 남긴다. 실패하면 `queued`로 되돌리고 `last_error`를 남겨 다음 worker 호출에서 재시도한다.
- worker 호출은 `Authorization: Bearer <CRON_SECRET>`가 일치할 때만 허용한다.
- 필요한 env는 `DISCORD_BOT_TOKEN`이다. 값은 가능하면 `Bot ` prefix 없이 순수 Bot token만 넣는다.
- Vercel Hobby Cron은 알림 worker에 쓰지 않는다. 알파 테스트에서는 cron-job.org가 5분마다 `/api/discord/dm-worker`를 호출한다.
- Discord interaction 버튼 수락/거절 처리는 `/api/discord/interactions`가 담당한다. 방 채팅 동기화는 `room_discord_links`와 `/api/discord/room-chat` bridge를 사용한다.
- 수동 테스트 DM은 `/api/discord/dm-worker` `POST`에서만 Discord username을 받을 수 있다. 서버는 봇이 들어간 Discord 서버 멤버 검색으로 숫자 `discord_user_id`를 찾은 뒤 발송한다. 자동 발송 큐와 프로필 저장 원본은 계속 숫자 `discord_user_id`다. username 테스트에는 봇이 같은 서버에 있어야 하고 Discord Bot의 Server Members Intent가 필요할 수 있다.
- `/api/discord/dm-worker` `POST`에 `botCheck: true`를 보내면 Bot token 설정, 봇 계정, 참여 서버 수를 토큰 노출 없이 점검한다.
- Match server action은 디코 연동된 경기 참가자/심판에게 시작 24시간 전, 2시간 전, 1시간 전, 경기 시작, 경기 종료, 종료 30분 이의신청 안내 delivery row를 만든다.
- Match server action은 방관리자에게 시작 10분 전 참여자 도착 여부 확인 안내와 시작시간 시작 처리 안내를 만든다. 일정/roster/방관리자가 바뀌면 미발송 시작 전 리마인더와 방관리자 안내 row를 현재 대상자 기준으로 재생성하고, 조기 시작 시 해당 row를 삭제한다.
- 같은 경기 안내는 Discord 연결 여부와 무관하게 `notifications` row도 만든다. 홈은 `payload.sendAt`이 지난 unread 알림만 별도 `알림` 카드에 보여주고, 서버가 만든 예약 알림은 `skipDiscordSync`로 클라이언트 중복 Discord delivery 생성을 막는다.
- 경기 종료, 점수 제출, 이의신청, 승인 처리, 이의 처리 재개가 일어나면 미발송 시작 전 리마인더, 방관리자 안내, 경기 종료 점수 입력 안내, 종료 30분 뒤 이의신청 안내 row는 삭제한다.
- 경기 취소 또는 무효 처리 시 해당 경기의 미발송 Discord delivery row를 삭제한다.
- 경기 리마인더 stale 삭제는 현재 snapshot에 참가자/방관리자 대상자가 없어도 먼저 실행한다. 대상자 없음은 새 row 생성을 막는 조건이지 기존 예약 row 삭제를 막는 조건이 아니다.
- Recruiting server action은 즉시방 생성 시 방 개설 delivery row를 만든다.

## 2026-06-24 RLS hardening

- `tournaments`, `tournament_teams`의 anon read는 `visibility='public'`만 허용한다.
- 비공개 tournament read는 생성자, 참가 팀 멤버, 승인자, 관리자만 허용한다.
- `profiles.auth_user_id`는 `uuid references auth.users(id)`로 강제하며 중복, non-uuid, orphan 값이 있으면 migration을 실패시킨다.
- 클라이언트는 `profiles.auth_user_id`를 insert/update 할 수 없다. 서버/service-role만 설정한다.
- `notifications` 직접 update는 막고 `rankball_mark_notification_read()` RPC로 `read_at`만 바꾼다.
- `reports`는 브라우저 직접 insert를 허용하지 않고 `POST /api/reports/submit` service-role 경로만 사용한다. 읽기는 신고자/대상자 self-read와 관리자 read policy만 허용한다.
- `referee_requests` 소유자 컬럼은 `requested_by`다.
- 관리자/심판 임명, audit, 징계, 승인 구장 write는 client 정책을 만들지 않는다. server/service-role만 처리한다.
- `approved_courts`는 authenticated read만 허용하고 payload에서 요청자/신뢰도/승인자 내부값을 제거한다.
- `affiliations`, `seasons` public read는 public-safe 데이터만 넣는 전제다.

## 2026-06-25 recruiting server sync

- `POST /api/recruiting/sync-post`를 추가했다.
- 생성/참여/초대/초대 수락/거절/READY/배치/파티/채팅/방닫기 후 `operation` payload가 있으면 서버가 현재 DB 상태를 로드하고 중앙 reducer를 다시 실행한 결과를 upsert한다.
- 서버는 Supabase bearer를 검증하고 `profiles.auth_user_id`에 매핑된 `profileId`가 방장, 참여자, 초대 발신자, 초대 대상자 중 하나인지 확인한다.
- 서버는 `recruiting_posts`, `recruiting_applications`, 관련 `notifications`를 갱신한다.
- `recruiting_posts` 저장/로드 매핑에 `title`, `visibility`, `rules`, `official`, `preRegistered`, 구장예약, 연령 제한, `sourceTeamId/sourceEntryId`를 보존한다.
- operation을 지원하지 않는 legacy 경로는 기존 snapshot 검증/upsert fallback만 허용한다.
- 모집방 확정은 recruiting server action이 `recruiting_posts`와 생성된 `matches`를 같은 요청 안에서 저장한다.
- 이 단계는 전체 state 저장 브리지 제거 이후의 전용 server action sync다. 아직 DB row-level RPC transaction 엔진은 아니므로 동시성 잠금과 MMR 커밋은 남아 있다.

## 2026-06-25 match server sync

- `POST /api/matches/sync-match`를 추가했다.
- 경기 생성, 동의, 출석, 심판 미출석, 경기 시작/종료, 기록 제출, 승인, 이의, 룰/슬롯 수정 후 `operation` payload가 있으면 서버가 현재 DB 상태를 로드하고 중앙 reducer를 다시 실행한 결과를 upsert한다.
- 서버는 Supabase bearer를 검증하고 현재 `profileId`가 경기 참가자, 심판, 기존 생성자 중 하나인지 확인한다.
- 서버는 `matches`, `match_players`, `match_results`, `player_match_stats`, `match_agreements`, `match_approvals`, `match_disputes`, 관련 `notifications`를 갱신한다.
- operation을 지원하지 않는 legacy 경로는 기존 snapshot 검증/upsert fallback만 허용한다.
- 이 단계는 전체 state 저장 브리지 제거 이후의 전용 server action sync다. 아직 DB row-level RPC transaction 엔진은 아니므로 동시성 잠금과 MMR 커밋은 남아 있다.

## 2026-06-26 match rating commit RPC

- `approveMatch`가 양쪽 승인으로 `confirmed`가 되면 서버 reducer가 변경된 profile/team 경쟁 수치만 `ratingCommit` payload로 만든다.
- `POST /api/matches/sync-match`는 `rankball_commit_match_rating()` RPC를 호출해 match row를 `for update`로 잠근 뒤 `profiles.ratings/trust_score/streak`, `teams.mmr/wins/losses`, `matches.rating_result/team_rating_result/confirmed_at`을 한 transaction으로 커밋한다.
- 이미 `matches.rating_result`가 있으면 RPC는 `alreadyCommitted=true`로 반환하고 MMR을 다시 적용하지 않는다.
- MMR 커밋 후 서버 응답은 영향받은 `profiles`/`teams`를 DB에서 다시 읽어 `state.users`/`state.teams`로 내려주며, 프론트는 reducer 추정값이 아니라 DB 권위값을 즉시 병합한다.
- 따봉/심판 미출석처럼 MMR 확정과 분리된 신뢰도 변경은 `rankball_apply_profile_trust_deltas()`가 `profiles.trust_score`만 0~100으로 커밋한다.
- `npm run simulate:backend -- --full` includes `ranked_mmr_commit_1v1`, which verifies `ratingCommitted=true`, returned DB profile state, and cleanup restoration of test profile rating snapshots.
- 경기 생성/기록 제출/출석/이의/룰 수정은 아직 기존 server action 저장 경로를 쓴다.

## 2026-06-25 report submit server action

- `POST /api/reports/submit`을 추가했다.
- 경기 신고 생성 후 새 `report`와 신고 접수 `notifications`를 서버에 저장한다.
- 서버는 Supabase bearer를 검증하고 신고자 `user_id`를 현재 `profileId`로 강제한다.
- `match` 신고는 경기 참가자/후보/출전 이력/방장/심판만 가능하고 7일 신고 기한을 서버에서도 확인한다.
- `player` 신고는 대상 프로필 존재 여부와 자기신고 금지만 확인한다.
- 신고 `created_at`은 클라이언트 값이 아니라 서버 접수 시각으로 고정한다.
- 신고 사유는 서버에서 최대 500자로 제한한다.
- `court_request` 신고는 중복 신고, 신뢰도 차감, 상태 변경이 묶인 기존 `POST /api/court-requests/report`만 사용한다.
- 아직 신고 생성만 server action화한 단계다. 신고 판정/징계/피드백은 기존 관리자 RPC가 처리한다.

## 2026-06-25 team sync server action

- `POST /api/teams/sync-team`을 추가했다.
- 팀 생성, 삭제, 팀원 추가, 역할 변경, 팀원 제거 후 `teams`, `team_members`, 관련 `notifications`를 서버에 저장한다.
- 서버는 Supabase bearer를 검증하고 기존 팀은 현재 `profileId`가 주장일 때만 변경한다.
- 새 팀은 현재 `profileId`가 주장 멤버로 포함된 경우만 생성한다.
- 서버는 팀명 14자 제한, 멤버 프로필 존재 여부, 1인 3팀 제한을 다시 검사한다.
- 삭제는 `deleted_at` soft delete로 처리하고 `team_members`, 팀 즐겨찾기, 해당 팀 모집방 상태를 함께 정리한다.
- 아직 완전한 team authority engine은 아니다. 클라이언트 reducer 결과를 서버에 커밋하는 과도기 브리지다.

## 2026-06-25 tournament sync server action

- `POST /api/tournaments/sync-tournament`를 추가했다.
- 토너먼트/리그 생성과 팀 승인 후 `tournaments`, `tournament_teams`, 관련 `notifications`를 서버에 저장한다.
- 서버는 생성자는 전체 sync를 허용하고, 팀장은 `action=approveTeam`으로 자기 팀 승인 sync만 허용한다.
- 초대팀 존재 여부와 토너먼트 최소 2팀 조건을 서버에서도 확인한다.
- 승인 완료로 자동 생성된 경기는 기존 `POST /api/matches/sync-match`로 같이 저장한다.
- 토너먼트 경기 일정 변경은 match snapshot 변경이므로 기존 match sync 경로를 사용한다.
- 아직 완전한 tournament authority engine은 아니다. 팀 승인, 대진 생성, 경기 생성 계산은 클라이언트 reducer 결과를 커밋한다.

## 2026-06-25 referee request server action

- `POST /api/referee/sync`를 추가했다.
- 심판 시험 시작/종료는 `referee_exam_attempts`에 저장한다.
- 시험 문제 추첨과 채점은 `/api/referee/sync` 서버에서 처리하고, 클라이언트는 공개 문제와 서버 채점 결과만 받는다.
- 심판 등록요청은 `referee_requests`와 관련 `notifications`에 저장한다.
- 서버는 `user_id`, `requested_by`를 현재 `profileId`로 강제하고 신뢰도 90점 조건을 다시 확인한다.
- 시험 시작은 서버에서 `available_after` 쿨다운을 확인한다.
- 커뮤니티 심판 등록요청은 같은 사용자/시험버전의 passed attempt가 있어야 저장된다.
- `referee_exam_attempts`, `referee_requests` 브라우저 write grant/policy는 제거하고, self-read만 브라우저에 남긴다.
- 심판 임명, 등급 부여, 회수는 기존 관리자 임명 server action 영역으로 남긴다.

Referee exam verification update:
- Backend flow simulation verifies `/api/referee/sync` start/finish/request, server grading, cooldown rejection, and public-question-only response.

## 2026-06-25 favorites sync server action

- `POST /api/favorites/sync`를 추가했다.
- 선수, 팀, 구장 즐겨찾기 토글 후 `favorites` row를 서버에 upsert/delete한다.
- 서버는 `user_id`를 현재 `profileId`로 강제한다.
- 선수, 팀, 구장 즐겨찾기는 대상 존재 여부를 확인한다.
- 구장 즐겨찾기는 `courts` 또는 `approved_courts`에 존재하는 id만 허용한다.

## 2026-06-25 notification read server action

- `POST /api/notifications/read`를 추가했다.
- 단일 알림 읽음은 `notificationId`, 전체 읽음은 `all=true`로 처리한다.
- 서버는 현재 `profileId`가 `user_id` 또는 `target_user_id`인 row만 `read_at`, `updated_at`으로 갱신한다.
- 브라우저의 직접 `notifications` update는 계속 금지한다.

## 2026-06-25 court review server action

- `court_reviews`는 구장별 리뷰 평균을 만들기 위한 서버 테이블이다.
- `POST /api/courts/submit-review`는 `rankball_submit_court_review()` RPC로 경기 참가자만 리뷰를 제출하게 한다.
- 같은 경기에서 같은 사용자는 리뷰 1개만 유지한다. 재제출은 수정으로 처리한다.
- 프론트는 `court_reviews`를 읽어 `getRegisteredCourts()`에서 `reviewSummary`, `rating`, `reviewCount`를 붙인다.
- 구장 hover 카드의 별점 표시는 기존 UI를 재사용하며 `court_reviews.rating` 평균과 리뷰 수를 보여준다.
- 경기방 postgame 보조 카드에서 참가자가 구장 리뷰를 작성하고 `POST /api/courts/submit-review`로 서버 저장한다.
- 구장 리뷰 신고는 `reports.type = 'court_review'`로 관리자 큐에 연결한다.

## 2026-06-25 abuse/integrity scenario seed

- `scripts/seed-demo-flow.mjs`는 기존 `reports`, `settings.courtRequests`, `settings.adminAuditLog`, `settings.adminDisciplinaryActions`, `notifications`, `matches`, `users` shape만 사용해 abuse/integrity 시나리오를 추가한다.
- 신고 status는 현재 관리자 UI/server action이 처리하는 `open`, `resolved`, `dismissed`만 사용한다.
- 구장 신고 seed는 아직 `type="court_request"` 중심이다. 신규 `court`, `court_review`, hidden 시나리오 seed 보강은 별도 남았다.
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
| `blocked_user_wrong_division` | recruiting server action | join/invite accept sync rejects users outside `allowedAgeGroups` |

Backend gaps:

- `reports`는 `target_type/reporter_id`가 아니라 `type/user_id` 구조다. seed와 server action은 이 구조를 따라야 한다.
- 승인 구장(`approved_courts`) 신고는 `reports.type = 'court'`로 연결한다.
- 구장 hidden moderation status와 구장 리뷰 soft hide action은 있다. restore/hard delete 운영 도구는 없다.
- `profiles`에는 birth year와 age group만 있고 나이 인증 상태, 신고 전 주장 나이, 관리자 검증 나이를 분리 저장할 컬럼이 없다.
- 방 생성자는 연령 제한 밖이면 생성이 막히지만, recruiting 참여/초대 수락 시점의 연령 차단은 아직 authoritative server logic이 아니다.
- abuse/integrity seed는 demo state 생성기에 들어갔다. Supabase Auth user 150명 이상을 만드는 service-role bulk script는 `npm run seed:supabase:auth-bulk`, cleanup은 `npm run seed:supabase:auth-bulk:cleanup`이다. 둘 다 dry-run 기본이며 실제 실행은 `RANKBALL_CONFIRM_AUTH_BULK=rankball`이 필요하다.

## 2026-06-26 server hydration guard

- Supabase 설정 환경에서 remote hydration이 끝나기 전에는 방/경기/팀/토너먼트 생성과 방/경기/팀 변경을 막는다.
- 이 차단은 임시 shell profile로 생성한 로컬 방이 서버 권한 검사에서 거부된 뒤 새로고침 때 사라지는 문제를 막기 위한 것이다.
- server action이 실패하거나 비활성 상태면 `서버 저장 실패` 알림을 띄운다.
- 테스트계정은 Supabase Auth bearer token과 `profiles.auth_user_id`가 매핑될 때만 백엔드 계정으로 본다.

## 2026-06-26 server state hydration

- Screen-specific endpoints are the preferred Supabase hydration path.
- `POST /api/state/load` is profile-only fallback. Match, recruiting, tournament, and directory hydration must use their own endpoints.
- The endpoint maps Supabase Auth users on the server.
- It returns public rows plus private rows related to the current profile.
- Direct `loadRemoteState()` Supabase reads are fallback only.
- Test accounts use real Supabase Auth JWTs and follow the same RLS/auth path as Google users.

## 2026-06-26 backend migration TODO status

Done:

- Supabase schema/RLS hardening: `profiles.auth_user_id` uuid FK, duplicate hard failure, client write guard, admin/report/court/referee policy hardening.
- RLS read hardening: recruiting permissive read policies are dropped, profile directory reads use `public_profiles`, and match tables read through `matches.visibility` plus participant/admin checks.
- `/api/system/schema-health` includes `rankball_rls_policy_health()` so deployment checks fail on permissive raw read policy regressions for reports, court, matches, recruiting, feed, admin tables, direct browser grants on `room_feed_cards`, missing admin read policies, admin anon read grants, and browser write grants/policies on admin/reports/court/matches/recruiting raw tables.
- `/api/system/schema-health` also includes `rankball_rpc_grant_health()` so service-role-only RPCs fail health checks if `anon` or `authenticated` regains `EXECUTE`.
- `/api/system/schema-health` includes `rankball_profile_identity_health()` so profile auth/Discord/hashtag identity constraints, lock columns, client `auth_user_id` write guards, and `public_profiles` private-column hiding stay enforced.
- `/api/system/schema-health` checks `room_chat_messages` Discord sync columns and `room_discord_links` so room chat bridge schema drift fails deployment health checks.
- Vercel Hobby API consolidation: one `api/index.js` function dispatches the server routes.
- Server action paths exist for profile upsert, court request submit/approve/report, admin review, admin/referee appointment, disciplinary action, Discord DM worker, Discord delivery queue sync, reports, recruiting, matches, teams, tournaments, referee requests, favorites, notification read, court reviews.
- Team membership save/delete now commits through `rankball_sync_team_membership()` / `rankball_delete_team()` DB RPC transactions.
- Tournament create/approve now replays the reducer on the server and persists generated tournament matches inside `sync-tournament`.
- Supabase frontend tournament create calls send operation-only draft payloads; `sync-tournament` returns the persisted tournament and generated matches for client merge.
- Tournament follow-up rounds are generated by server replay when confirmed bracket winners complete the next source pair, then `sync-match` persists the updated tournament snapshot and generated match snapshots.
- Tournament follow-up `sync-match` responses now return the DB-created follow-up matches and tournament snapshot in `state`, and the client replaces same-round optimistic duplicates by tournament round/fixture key.
- `npm run simulate:backend -- --full` includes a 4-team `tournament_followup_round` scenario that verifies team approvals, first-round confirmation, DB-persisted follow-up final match creation, and tournament `match_ids` update.
- Tournament snapshot persistence now goes through `rankball_persist_tournament_snapshot_locked()`, which takes a per-tournament advisory transaction lock before calling the existing snapshot RPC.
- Recruiting and match action persistence now takes a per-room/per-match advisory transaction lock inside `rankball_recruiting_action()` / `rankball_match_action()` before branch reducers or snapshot persistence run.
- `rankball_match_action()` treats branch reducer `fallback=true` as a signal to continue into locked snapshot persistence, so reserve/party/unsupported match actions do not get dropped after the fast path declines.
- `rankball_match_roster_move_action()` commits safe match recorder handoff and active/reserve substitution in one DB transaction by updating `match_players`, `matches.reserve_players`, `matches.played_player_ids`, and `matches.stat_recorders`.
- `rankball_match_approval_action()` commits non-final participant result approvals in one DB transaction; approvals that would confirm the match still fall back to server reducer replay so rating commit stays authoritative.
- `rankball_match_thumbs_action()` commits match thumbs and affected profile trust deltas in one DB transaction.
- `rankball_match_star_toggle_action()` wraps the thumbs RPC for single-target star toggles and preserves replay fallback for trust-feedback limit notifications.
- `agreeMatch` and `checkInMatchPlayer` now use direct operation-only SQL reducer calls when `matchId`, `sideName`, and `playerId` are present, without sending a client match snapshot.
- Supabase frontend `createMatch` calls send operation-only draft payloads; the server replays `createMatch` and returns the persisted match as the source of truth.
- `startMatch` and `endMatch` now use direct operation-only SQL reducer calls for supported no-referee host-operated matches; start falls back to the DB `matches.attendance` row and auto-includes the host actor's active side attendance when no client attendance snapshot is sent.
- Backend flow simulation seeds pending app/Discord match notice rows and verifies stale cleanup for `startMatch`, `approveMatch`, and `voidMatch`.
- Match rating commit responses now reload affected profiles/teams from DB and return them in `state.users` / `state.teams`, so MMR UI merges DB-authoritative values after approve/auto-confirm.
- Room, match, and tournament frontend callers now send `{ operation }` only when operation replay is available; full snapshot sync is legacy fallback.
- The frontend sends completed match lifecycle/roster/result/trust mutations as operation-only, including `agreeMatch`, `addMatchLatePlayer`, `approveMatch`, `checkInMatchPlayer`, `handoffMatchRecorder`, `removeMatchLatePlayer`, `substituteMatchPlayer`, `requestMatchRefereeAbsence`, `confirmMatchRefereeAbsence`, `startMatch`, `endMatch`, `cancelMatch`, `deleteSoloRecord`, `voidMatch`, `submitMatchResult`, `disputeMatch`, `resumeMatchApproval`, `submitMatchThumbs`, and `toggleMatchStar`; the server uses SQL reducers where supported and otherwise reloads authoritative state before persisting attendance, roster, lifecycle, postgame late-player changes, result, dispute, finalization, rating, or trust updates.
- The frontend sends supported recruiting management mutations as operation-only, including `inviteRecruitingReferee`, `inviteRecruitingPlayers`, `acceptRecruitingInvitation`, `declineRecruitingInvitation`, `cancelRecruitingParticipation`, `updateRecruitingRoomRules`, `setRecruitingApplicantReserve`, `setRecruitingApplicantPlacement`, `joinRecruitingSideParty`, `setRecruitingSlotPosition`, `setRecruitingPartyPlayerReserve`, `setRecruitingPartyPlayerPlacement`, `setRecruitingTeamPartyRoster`, `detachRecruitingPartyPlayer`, `removeRecruitingPartyPlayer`, `setRecruitingStatRecorder`, `kickRecruitingApplicant`, `confirmRecruitingMatch`, and `closeRecruitingPost`; these use recruiting SQL reducers when supported and otherwise fall back to server authoritative replay.
- Recruiting, match, and tournament snapshot persistence now uses DB RPC transaction functions instead of multi-step client-side table upserts.
- Remote hydration guard blocks local room/match/team/tournament actions before backend state is ready.
- Test account server mapping uses `profiles.auth_user_id` with Supabase Auth JWTs.
- Client `u1` owner fallback is removed. Admin menu authority now comes from server context or DB `admin_appointments`.

Partial:

- Frontend still has client reducer logic and sends changed room/match/team/tournament snapshots to dedicated server sync actions. This is not yet a fully authoritative room/match/team/tournament backend.
- `mockData.js` and generated demo flow remain for non-Supabase local dev and seed generation, not production source of truth.
- Admin UI calls server actions, but local UI state is still updated first and should be reloaded from server result before production.
- Env owner support uses `POST /api/admin/context` to expose only the current user's admin level to the client.
- Discord OAuth/profile badge/DM queue, invite button interactions, room chat bridge path, Gateway bridge script, and room-channel link provisioning script exist. Real deployment still needs Bot token, bridge secret, channel/thread links, and a long-running bridge process.
- Backend flow simulation covers Discord-origin room chat import, duplicate Discord message protection, bot echo skip, and room detail visibility.
- Court reviews exist, `court` / `court_review` reports submit through `/api/reports/submit`, and admin review actions can soft-hide approved courts and court reviews.

Remaining:

- Set owner authority through `RANKBALL_OWNER_AUTH_USER_IDS`, `RANKBALL_OWNER_PROFILE_IDS`, or DB `admin_appointments`; do not depend on frontend seed IDs.
- Keep app user identity as `profiles.id`; never expose or use Google/provider ID as the public RankBall user id.
- Finish authoritative RPC/server actions for recruiting create/join/invite/accept/ready/confirm and match attendance/start/record/end/dispute/approve.
- Move operation calculation itself from server reducer replay to DB RPC if stricter row-level lock semantics are required.
- Recruiting `setRecruitingApplicantPlacement` now tries `rankball_recruiting_applicant_placement_action()` first for self player applicant moves. Unsupported host/team/party/limit cases still fall back to server authoritative replay.
- Make frontend repository a thin server caller after the authoritative RPCs are ready.
- Remove production reliance on localStorage state and mock fallback completely.
- Add broader server-side eligibility checks for tournament brackets and match roster edits.
- Add hard delete/restore tools for court moderation only if operational policy later requires it.
- Keep Supabase Auth/test seed and cleanup scripts for realistic multi-user simulations.

## 2026-06-26 Supabase test seed scripts

- `npm run seed:supabase` now maps seeded demo profiles to backend test login ids.
- Mapping rule: `u1 -> rankball-001`, `u2 -> rankball-002`, and so on.
- Test login uses Supabase password Auth for `rankball-001@rankball.test`, `rankball-002@rankball.test`, and so on.
- Test seed profiles link `profiles.auth_user_id` to `auth.users.id`; Google accounts use the same ownership path.
- Test seed profiles are saved as onboarding-complete rows. If older `profiles.test_login_id` rows lack onboarding lock fields, the client maps them as completed test profiles until the seed is rerun.
- `npm run seed:supabase:cleanup` is dry-run by default.
- Actual cleanup requires `RANKBALL_CONFIRM_CLEANUP=rankball npm run seed:supabase:cleanup`.
- Cleanup deletes only ids derived from the current demo seed state plus `seed-owner-u1`.
- `npm run seed:supabase:auth-bulk` creates/updates the separate `rankball-integrity-001..150` Auth/Profile set for abuse/integrity simulations. It does not touch the basic `rankball-001..050` test set unless the prefix env is changed.
- `npm run seed:supabase:auth-bulk:cleanup` removes only ids derived from the current bulk prefix/range and is also dry-run until `RANKBALL_CONFIRM_AUTH_BULK=rankball`.
- This finishes the basic backend test-account seed/cleanup path, but not the authoritative room/match RPC migration.

## 2026-06-28 public data and court fallback

- `public_profiles`는 공개 프로필 표시용 컬럼만 제공한다. `school`, `company`, `club`, `test_login_id`, `discord_connection`, `discord_user_id`, `auth_user_id`는 공개 view에 넣지 않는다.
- `user_room_feed` 직접 RLS read는 `feed_scope='profile'`인 현재 프로필 row만 허용한다. `feed_scope='public'` 지역 공개 feed는 서버 API/service-role 경로에서만 읽는다. `profile_id='*'`는 legacy 저장키/fallback일 뿐 공개 feed 의미 기준이 아니다.
- 구장 표시 fallback은 `court_id` 기준 legacy `courts` -> active `approved_courts` -> 기존 `court_name` 순서다. 목록/상세 API는 `courts`와 `approved_courts`를 병합하되 hidden/disabled approved court는 공개 fallback에서 제외한다.
- `matches.court_id`, `recruiting_posts.court_id`, `tournaments.court_id`가 비어 있고 `court_name`이 단일 구장으로만 매칭되면 DB guard가 `court_id`를 채운다. 중복 이름은 수동 정리 전까지 문자열 fallback으로 둔다.
- 2026-07-04: `approved_courts.region_key`는 승인 구장의 구/군/시 필터 원본이다. 주소/payload에서 자동 계산하고, `user_room_feed.region_key`는 구장 snapshot 기준으로 다시 만든다.
- SPA fallback은 `/assets/*`에 적용하지 않는다. 오래된 hashed JS asset 요청은 `index.html`이 아니라 404가 되어야 한다.
## 2026-06-27 경기 유지보수 worker

- `/api/system/maintenance`는 `CRON_SECRET`으로 보호되는 서버 전용 경기 유지보수 endpoint다.
- 기존 외부 스케줄러가 `/api/discord/dm-worker`를 호출할 때 같은 경기 유지보수도 함께 실행한다.

## 2026-06-30 cleanup audit

### 안전 삭제

- `src/data/repository.js`의 `getRecruitingParticipantEntry`는 참조 0개라 제거했다.
- `src/lib/recruiting.js`의 `clampIndex`는 참조 0개라 제거했다.
- `src/pages/Recruiting.jsx`의 `getEntryTitle`, `getReadyTitle`은 참조 0개라 제거했다.

### 보류

- `src/pages/CreateMatch.jsx`의 `PublicPartyPicker`는 참조 0개 후보지만 JSX UI 블록이라 생성 플로우 UI 패스에서 별도 확인 후 제거한다.
- `src/lib/mockData.js`, `src/lib/demoFlowState.js`는 비-Supabase dev/seed 경로라 즉시 삭제하지 않는다. production source of truth는 아니다.
- legacy `courts` 테이블 fallback은 `approved_courts` 이전 데이터 보정용이라 즉시 삭제하지 않는다.
- legacy `rankball_state`는 런타임 미사용 제거 대상이지만 DB destructive cleanup은 별도 migration 확인 후 처리한다.

### DB table/column 참조표

| table | 주요 columns | 현재 참조 | 처리 |
| --- | --- | --- | --- |
| `user_room_feed` | `profile_id`, `feed_scope`, `entity_type`, `entity_id`, `relation`, `status`, `sort_at`, `is_active`; `card_json`은 빈 호환 필드 | `server/api/matches/list.js`, `server/api/recruiting/list.js`, `server/api/system/maintenance.js`, feed trigger/RPC | 유지 |
| `room_feed_cards` | `entity_type`, `entity_id`, `card_json` jsonb thin list projection, `updated_at` | `server/api/matches/list.js`, `server/api/recruiting/list.js`, feed trigger/RPC | 유지 |
| `matches` | `id`, `status`, `visibility`, `created_by`, `scheduled_at`, `team_a_id`, `team_b_id`, `room_state`, `rating_result` | match list/detail/sync, report, maintenance | 유지 |
| `match_players` | `match_id`, `user_id`, `side`, `slot_order`, `role` | match list/sync/detail, record flow | 유지 |
| `match_results` | `match_id`, `score_a`, `score_b`, `stat_submissions`, `submitted_by` | match sync, maintenance, feed trigger | 유지 |
| `match_approvals` | `match_id`, `user_id`, `side`, `approved_at` | match sync, maintenance, feed trigger | 유지 |
| `match_disputes` | `id`, `match_id`, `user_id`, `reason`, `created_at` | match sync, feed trigger | 유지 |
| `player_match_stats` | `match_id`, `user_id`, `points`, `rebounds`, `assists`, `steals`, `blocks`, `fouls` | match sync/detail, feed trigger | 유지 |
| `recruiting_posts` | `id`, `status`, `visibility`, `player_id`, `player_ids`, `room_state`, `scheduled_date`, `scheduled_time` | recruiting list/sync, match schedule bridge | 유지 |
| `recruiting_applications` | `post_id`, `player_id`, `player_ids`, `team_id`, `side`, `status`, `reserve`, `position` | recruiting list/sync, feed trigger | 유지 |
| `profiles` | `id`, `auth_user_id`, `test_login_id`, `hashtag`, `ratings`, `trust_score`, `app_settings` | auth/profile/server validation/settings | 유지 |
| `public_profiles` | `id`, `name`, `hashtag`, `avatar_color`, `position`, `ratings`, `trust_score` | list/search/card display | 유지 |
| `teams` | `id`, `name`, `captain_id`, `mmr`, `deleted_at` | team list/search/sync, room cards | 유지 |
| `team_members` | `team_id`, `user_id`, `role` | team roster/profile/search/feed dependency | 유지 |
| `favorites` | `user_id`, `target_type`, `target_id` | settings/search/favorites sync | 유지 |
| `notifications` | `id`, `user_id`, `target_user_id`, `type`, `payload`, `read_at` | home/invite/action notices, Discord queue source | 유지 |
| `discord_notification_deliveries` | `id`, `notification_id`, `target_user_id`, `discord_user_id`, `status`, `send_at` | Discord DM worker | 유지 |
| `approved_courts` | `id`, `name`, `address`, `region`, `status`, `hidden_at` | court search/favorites/feed fallback | 유지 |
| `courts` | `id`, `name`, `address`, `region` | legacy court fallback | 보류 |
| `rankball_state` | legacy snapshot | runtime 미사용, schema cleanup 대상 | 보류 |
