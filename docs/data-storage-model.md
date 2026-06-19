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

- 심판 시험 문제 추첨, 채점, 주 1회 응시 제한은 서버 함수/DB 정책으로 이동. 클라이언트 번들에는 정답 bank를 두지 않는다.

- 소유권 기준을 Supabase Auth ID로 이전:
  - `profiles.user_id = auth.users.id`
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
