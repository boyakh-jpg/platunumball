# RankBall 데이터 저장 모델

## 현재 유지 원칙

- UI와 기능 개발을 위해 현재 `mockData` / `localStorage` / Supabase 혼합 흐름을 유지한다.
- 아직 전체 production schema migration을 하지 않는다.
- `src/data/repository.js`를 전면 개편하지 않는다.
- `src/lib/mockData.js`를 삭제하지 않는다.
- Auth 구조를 전면 교체하지 않는다.

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
