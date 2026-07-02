# 2026-06-27 모집/경기 원격 로딩 상태

## 2026-06-30 모집 더보기 표시

1. 모집의 내가 만든 방/내 참여방/초대받음 탭은 개인 feed 전체 목록이므로 더보기 버튼을 표시하지 않는다.
2. 더보기 버튼은 공개 지역/날짜 목록에서 서버가 `exhausted=false`를 준 경우에만 표시한다.

## 2026-06-29 검색 결과 카드 동작

1. `SearchPicker` 결과 row 안에서는 프로필/팀 hover card를 열지 않는다.
2. 검색 결과 row는 선택 또는 검색어 채우기 같은 단일 동작만 수행한다.
3. 선택형 검색 결과는 row 전체가 선택 target이다.
4. 검색 결과 안에서는 즐겨찾기 별/저장/해제 액션을 두지 않는다. 즐겨찾기 관리는 설정 메뉴의 즐겨찾기 카드에서만 한다.

## 2026-06-29 비공개 팀전 생성 UI

1. 비공개 팀전 생성 화면의 B사이드는 전체 출전/후보 picker를 보여주지 않는다.
2. B사이드는 상대팀 검색 결과에서 팀을 고르고, 같은 팀원 중 초대 대상 1명을 select로 고른다.
3. B사이드 출전/후보 명단은 초대 수락 뒤 방 모달의 파티장 슬롯 관리에서 고른다.
4. 비공개 팀전 B사이드 대표가 초대를 수락하면 방 모달은 기존 슬롯 관리 popover를 바로 열어 팀원 선택 흐름을 드러낸다.
5. 비공개 팀전의 빈 B사이드 슬롯은 초대 버튼을 열지 않고, 파티장 슬롯 관리 안의 팀원 선택으로 채운다.
6. 팀 초대/팀원 선택 popover는 화면 높이가 부족해도 내부 스크롤과 하단 고정 액션으로 초대/저장 버튼을 항상 누를 수 있게 한다.

## 2026-06-28 페이지 로딩 바운딩볼

1. 전역 remote DB hydrate뿐 아니라 auth 확인, lazy page load, page-level 목록 확인 상태도 공통 `BasketballLoader`를 쓴다.
2. overlay가 이미 떠 있는 remote loading 상태에서는 페이지별 로더가 보조 표시여야 하며, 별도 카드/테두리/그림자 프레임을 만들지 않는다.

1. 모집 화면은 원격 서버 데이터가 준비되지 않았을 때 로딩 empty-state를 보여준다.
2. 원격 hydrate 중에는 `0개 방` 또는 `내 참여방 0`을 확정 상태처럼 보여주지 않는다.
3. 경기 화면은 원격 서버 데이터가 준비되지 않았을 때 `해당 큐 없음` 대신 로딩 empty-state를 보여준다.
4. 경기 화면은 첫 로드에서 current-profile match feed만 확정 일정 수로 보여준다.
5. 경기 화면 로딩 중에는 일정 카드, 상단/달력 숫자 카운트를 숨기고 `내 일정 확인 중`과 `확인 중`만 표시한다.

# 2026-06-28 팀 카드 정리

1. 팀 목록 카드는 로스터 전체를 펼치지 않는다.
2. 팀 목록 카드는 엠블럼, 팀명, MMR, 승률, 로스터 수, 정규멤버 수만 보여준다.
3. 팀원 상세/역할 관리는 팀 상세 화면에서 처리한다.
4. 팀명은 카드 폭 안에서 줄바꿈하며, `vw` 기반 글자 크기를 쓰지 않는다.

# 2026-06-27 생성 제목 동기화

1. 경기 생성 기본 제목은 선택한 mode와 맞아야 한다.
2. 사용자가 직접 바꾼 제목은 mode 변경으로 덮어쓰지 않는다.

# 2026-06-27 recruiting load-more UI

1. Recruiting list uses the same centered `om-load-more` row as Matches.
2. List pages show 80 rows or fewer first, then use `더 보기` for additional rows.
3. Pagination failure is shown inline beside the load-more button.

# 2026-06-27 profile bootstrap display

1. Saved theme and current-user tier may use the last successful local profile cache for the first paint.
2. Remote profile/state remains authoritative and must replace cached theme/tier after the server response.
3. Theme application uses a layout effect so a saved light/dark choice does not visibly flip after paint.
4. Background directory/list loads must not overwrite the active theme; only profile refresh and settings sync are authoritative for theme.

# 2026-06-28 remote load basketball loader

1. Remote DB hydration may show a centered basketball bounce loader immediately while remote data is not ready.
2. The loader uses the R2-hosted `bounding_ball2.gif` asset, which must stay browser-decodable and under 100KB.
3. The CSS basketball fallback is not used.
4. The loader blocks clicks, modal interaction, touch scroll, and wheel scroll while remote data is not ready.
5. The remote GIF loader renders without a card background, border, shadow, or blur frame.
6. The blocking overlay uses a light veil so stale page content is visibly unavailable until remote data is ready.
7. The GIF must render above the blocking veil and reset its failed state each time remote loading starts.
8. While `html.rankball-remote-loading` is active, the global overlay is the only visible loading indicator; page-level inline loaders stay hidden.
9. Blocking/page overlay loaders render at `document.body` level so they are centered against the full viewport, not a card, section, or page div.
10. During remote DB hydration, the app shell does not render route page content behind the overlay; cached counts/lists must not be visible before the authoritative first response.

# 2026-06-28 referee rulebook images

1. Rulebook illustrations use R2 `assets/named/{dark|light}/webp/{scene}.webp` assets.
2. The app theme chooses the dark or light image path.
3. Existing `assets/referee-rulebook/{scene}.svg` files remain as load-failure fallback only.

# 2026-06-28 recruiting start date filter

1. Recruiting start-date filter uses one compact row of 8 buttons: instant plus 7 real calendar dates.
2. Weekend date chips keep the same size as weekday chips; Saturday uses blue tone and Sunday uses red tone.
3. The row must not force horizontal scrolling on mobile.
4. Date chips keep a fixed upper width and use visible gaps instead of stretching across wide desktop rows. Recruiting filter selects and filter buttons use the same 42px minimum height.
5. Selected date chips use one shared active fill color. Saturday/Sunday colors are idle hints only, not separate selected backgrounds.
6. Recruiting filter groups avoid an extra outer frame/padding around the buttons so the filter row stays compact.
7. 시작일 버튼을 누르면 relation scope 칩의 active 상태를 풀고 전체 공개 목록 날짜 필터로 전환한다.

# RankBall Design System

## 2026-07-01 다크 색상 표준

RankBall 다크 모드는 이 팔레트를 기본 CSS 색상 표준으로 쓴다. 새 UI는 `--rb-*` 토큰을 우선 사용하고, 기존 alias도 같은 값으로 맞춘다.

| 용도 | 토큰 | 값 |
| --- | --- | --- |
| 앱 배경 | `--rb-bg` | `#303132` |
| 깊은 배경 | `--rb-bg-2` | `#242526` |
| 최하단/사이드바 | `--rb-bg-3` | `#18191A` |
| 카드 배경 | `--rb-surface` | `rgba(255,255,255,.055)` |
| 강조 카드 | `--rb-surface-strong` | `rgba(255,255,255,.085)` |
| 선 | `--rb-line` | `rgba(255,255,255,.13)` |
| 강한 선 | `--rb-line-strong` | `rgba(255,255,255,.22)` |
| 메인 글자 | `--rb-text` | `#FFFFFF` |
| 보조 글자 | `--rb-muted` | `rgba(255,255,255,.68)` |
| 희미한 글자 | `--rb-soft` | `rgba(255,255,255,.44)` |
| 주요 버튼 | `--rb-orange` | `#F05A46` |
| 버튼 호버 | `--rb-orange-2` | `#FF7658` |
| 버튼 누름 | `--rb-orange-pressed` | `#D94C37` |
| 성공/READY | `--rb-green` | `#65D99F` |
| 정보/링크 | `--rb-blue` | `#78AAFF` |
| 경고/대기 | `--rb-gold` | `#FFD36C` |
| 위험/신고 | `--rb-danger` | `#FF6B6B` |
| 아바타 기본 | `--rb-cream` | `#F5F1E8` |

2026-07-01: 공통 radius는 `--radius-sm/md/lg/xl` 계층을 쓴다. 일반 카드/입력/버튼은 10~18px 기준이고, 모바일 bottom sheet 상단은 24px까지 허용한다.
2026-07-01: 농구 앱 정체성은 flat sports surface, scoreboard 숫자, court-line accent를 우선하고 반복 glow/gradient/glass 장식은 줄인다.
2026-07-01: 모집 시작일 필터는 모바일에서 8개 버튼을 억지로 압축하지 않고 필터 내부 가로 스크롤을 허용한다. 페이지 전체 가로 스크롤은 계속 금지한다.
2026-07-01: 홈 티어 rail은 통합 티어 1개와 모드별 티어 4개를 같은 테두리 안에 묶고, 통합 티어 박스는 rail 내부폭을 꽉 쓰며, rail/티어 박스/pill은 shared card border 토큰을 쓴다.
2026-07-01: 데스크톱 홈 hero 안의 통합 티어/모드별 티어는 compact right rail로 유지하고, 티어 엠블럼이나 모드 카드가 hero 세로 높이를 늘리지 않게 2열 compact 보드를 쓴다.
2026-07-01: 데스크톱 홈은 검색을 최상단, 알림/처리 카드를 오른쪽 최상단, 보조 카드들을 hero 옆/아래 2열 흐름으로 배치해 세로 낭비를 줄인다. section eyebrow는 READY 의미가 아니면 초록을 쓰지 않고 orange 계열 토큰을 쓴다.
2026-07-01: 홈 desktop hero는 세로 높이를 줄이고, 오른쪽 보조 카드들이 hero 오른쪽 빈 영역부터 차도록 배치한다. 라이트 모드에서 hero 내부 tier group wrapper는 투명 배경을 유지한다.
2026-07-02: 홈 tier rail은 hero 내부가 아니라 오른쪽 최상단 rail에 두고 알림 카드보다 먼저 보여준다. tier rail은 통합 티어 배너와 최근 5경기 승수만 보여주고, 큰 티어명은 hero title font가 적용되게 영문 티어명으로 쓴다. 모드별/팀전 티어 카드는 홈에서 제외한다. 친선전/정규전 큐와 승인 대기 경기는 오른쪽 보조 rail이 아니라 왼쪽 메인 라인에 각각 한 줄 카드로 둔다.
2026-07-02: 홈 760~1079px 구간은 desktop right rail 배치를 쓰지 않고 hero → search → top rail → dashboard 순서를 유지한다. top rail은 1080px 이상에서만 hero 오른쪽 rail로 올라간다.
2026-07-02: 홈 760~1079px hero는 viewport edge까지 full-bleed하되, hero 내부 텍스트/CTA와 바로 아래 검색 입력은 20px 이상 inset을 유지해 테두리에 붙지 않게 한다.
2026-07-02: 홈 759px 이하에서는 `rank-summary-grid`가 `display: contents`라 실제 hero인 `.home-rank-board-head`가 직접 `--app-main-pad-x`를 상쇄해야 한다. 이 규칙 변경 전에는 390/430/501/760/900/1024px에서 hero left, order, overflow를 다시 확인한다.
2026-07-02: 경기(`/app/matches`)와 매칭(`/app/recruiting`) page container는 데스크톱에서 공통 앱 폭 1440px을 따른다. 원인/결과: 각 arena CSS 뒤쪽의 1480px override가 공통 `.app-main > *` 폭보다 커져 메뉴별 폭이 달라졌으므로, 최종 page width guard로 통일한다.
2026-07-02: 홈 hero 배경은 desktop에서는 `rank-summary-grid`, 759px 이하에서는 실제 hero인 `home-rank-board-head` 한 곳에만 둔다. 원인/결과: 부모와 자식에 같은 `--bg-court`가 동시에 적용되어 배경이 두 장처럼 보였으므로 동시 배경을 금지한다.
2026-07-01: 경기 메뉴의 상단 상태 요약 카드는 모바일에서도 내부 가로 스크롤을 만들지 않고 2열 grid로 접는다. 필터 세그먼트는 항목 수가 적으면 가로 스크롤 대신 균등 grid를 쓴다.
2026-07-01: 방 모달의 출전 슬롯은 한 사이드 안에서 넘치지 않게 컨테이너 폭에 맞춰 줄이고, 후보 슬롯은 A/B 후보를 세로 카드처럼 쌓지 않고 각 후보 라인을 한 줄 row로 둔다. 5v5 같은 짧은 mode chip은 condensed/음수 자간을 쓰지 않는다.
2026-07-01: 방 모달의 포지션 아바타는 공/상체가 선명하게 보이게 하단 페더만 짧게 쓰고, 방장/파티장 배지는 아바타를 가리지 않게 작게 둔다. 파티 연결선은 엠블럼 중앙에 맞추며 dark/light 모두 같은 slot-count 기반 좌표를 쓴다.
2026-07-01: 방 모달의 슬롯 초대 popover는 modal overflow에 잘리지 않게 viewport 레벨로 띄우고, 검색 결과는 popover 내부 inline 목록으로 보여 초대 버튼이 항상 누를 수 있어야 한다.
2026-07-01: 방 모달 경기장 영역은 dark/light 모두 `--bg-hoop` 배경 이미지를 유지하고, light mode에서는 cream overlay로 가독성만 보정한다.
2026-07-01: 데스크톱이 아닌 홈/경기/모집 hero는 카드처럼 둥근 모서리를 주지 않고, viewport 좌우에 붙여 배경이 새지 않게 full-bleed로 둔다. 모바일 폭에서는 상단도 붙인다.
2026-07-01: 홈/경기/모집 hero 이미지 위에는 1px 반복 격자/스캔라인을 얹지 않고, 가독성용 어두운 overlay와 이미지 질감만 둔다.
2026-07-01: 앱 바닥과 주요 hero/방 모달 overlay의 1px 격자무늬는 제거한다. 코트 정체성은 실제 배경 이미지와 scoreboard/card hierarchy로만 표현한다.
2026-07-02: "hero들"이라고 하면 홈/경기/모집만이 아니라 `page-header`, landing, team hub, season, profile, team detail, rulebook, tournament, match room 같은 모든 page-level hero를 포함한다.
2026-07-02: 모든 page-level hero는 이미지 위에 dark/white wash, scanline/grid, 별도 `::before`/`::after` overlay를 얹지 않는다. hero 텍스트는 dark에서 `--rb-orange`/`--rb-orange-2`, light 큰 제목은 `--rb-cream`로 시인성을 확보한다.
2026-07-02: hero 제목 폰트는 모두 `--hero-title-font`를 쓴다. 원인/결과: 개별 파일의 `linear-gradient` background와 `::before`/`::after` overlay가 뒤쪽 CSS에서 다시 살아나 이미지 위 막이 반복됐으므로, page-level hero는 최종 guard에서 image + fallback color만 남기고 `backdrop-filter`/blur/filter를 쓰지 않는다.
2026-07-02: 팀 허브 모바일 hero에도 데스크톱처럼 전체 1위 팀 보드를 포함한다. 원인/결과: 759px 이하 규칙이 `.team-hub-board`를 숨겨 모바일에서 팀 허브 정보가 빠졌으므로, 팀 페이지에서는 보드를 다시 표시한다.
2026-07-02: 홈 image hero와 rank spotlight card는 조각난 frame처럼 보이는 border, underline, inner pseudo frame을 쓰지 않는다. 이미지 경계는 배경/간격으로 처리한다.
2026-07-01: 일반 페이지의 floating search/card layer는 모바일 bottom nav보다 낮아야 한다. 모달/전역 로더만 bottom nav보다 위에 올 수 있다.
2026-06-28: 즐겨찾기 검색은 프로필, 팀, 구장, 심판을 각각 최대 10개까지 저장하고, 관련 SearchPicker의 idle 목록과 검색 결과 별 토글에 연결한다.
2026-06-28: 설정 즐겨찾기 목록은 저장 직후 전체를 누적 노출하지 않고, 프로필/팀/구장/심판 4개 타입 버튼을 한 줄에 두어 선택한 타입 목록만 연다.
2026-06-28: `SearchPicker`는 서버 호출 없이 2글자 이상부터 클라이언트 부분검색을 수행하고 기본 결과를 10개만 보여준다.
2026-06-28: `SearchPicker` 원격 검색은 검색창별 도메인을 `profile`, `team`, `court`, `referee`, `all`로 제한하고 한글/# 검색은 2글자, 영문/숫자 검색은 4글자부터 300ms debounce 후 최대 10개만 요청한다.

2026-06-27: Score result cards keep side/team names secondary and the numeric score as the visual center.

이 문서는 UI/CSS/반응형/라이트/다크 수정 기준이다.
디자인 변경 시 이 문서를 같이 갱신한다.

## 최상위 원칙

1. 같은 기능은 같은 모양이어야 한다.
   - 공개방/비공개방 카드가 내용은 달라도 구조는 같아야 한다.
   - 매칭 메뉴와 경기 메뉴에서 같은 방은 같은 모달로 보여야 한다.

2. 화면마다 다른 히어로 구조를 만들지 않는다.
   - 홈, 경기, 매칭, 진행, 팀, 나, 설정은 같은 header/hero 기준을 쓴다.
   - 위치, 여백, 글자 크기, 배경 크롭 기준을 통일한다.

3. 라이트/다크는 색과 이미지 시간대만 다르다.
   - 같은 메뉴는 같은 그림 구도와 같은 위치를 쓴다.
   - 라이트는 낮 이미지, 다크는 밤 이미지.
   - 배경 두 장 겹쳐 쓰지 않는다.

4. 카드 안 카드 금지.
   - 카드 안쪽에는 작은 패널을 둘 수 있지만, 떠 있는 카드처럼 보이게 중첩하지 않는다.
   - 구분은 배경 단계, border, padding으로 한다.

5. 정보는 카드에서 줄이고 모달에서 푼다.
   - 목록 카드에 참여자 전체를 넣지 않는다.
   - 목록은 상태/일시/구장/방식/방보기 중심.

6. 모바일 우선으로 깨짐을 막는다.
   - 가로 스크롤 금지.
   - 큰 요약 패널은 모바일에서 제거.
   - 필터는 가로 스크롤이 아니라 줄바꿈.

## 페이지 구조

| 영역 | 기준 |
| --- | --- |
| page shell | max-width 1220~1280px |
| page gap | 16~20px |
| hero/header | 모든 주요 메뉴 동일 구조 |
| card radius | 10~18px 계층형 |
| card border | `var(--line)` |
| card padding desktop | 18~24px |
| card padding mobile | 14~18px |
| section title | eyebrow + title 조합 |
| bottom nav | 모바일 한 줄 고정 |

긴 목록은 초기 렌더/원격 로드를 줄이기 위해 50~80개 단위로 먼저 보여주고, 필요한 화면에만 `더 보기` 버튼을 둔다.

## 히어로 원칙

히어로 구성:

1. eyebrow
2. H1
3. 설명
4. 핵심 버튼 1개
5. 필요 시 작은 요약 패널

히어로 금지:

- 페이지마다 제각각 다른 높이.
- 라이트/다크에서 다른 위치로 잘리는 배경.
- 한 히어로에 배경 이미지 2장 이상.
- 의미 없는 큰 숫자 패널.
- 모바일에서 본문보다 큰 장식 영역.

배경 토큰:

| 용도 | 변수 |
| --- | --- |
| 코트 | `--bg-court` |
| 액션 | `--bg-action` |
| 나 메뉴 | `--bg-profile` |
| 골대 | `--bg-hoop` |
| 공/도시 | `--bg-ball` |
| 크기 | `--hero-bg-size` |
| 위치 | `--hero-bg-position-*` |

라이트/다크:

- `--bg-*` URL만 바꾼다.
- `--hero-bg-position-*`은 바꾸지 않는다.
- 같은 위치에서 낮/밤 차이만 보여야 한다.

## 카드 원칙

카드 단계:

| 단계 | 용도 |
| --- | --- |
| page background | 전체 바닥 |
| card | 큰 정보 묶음 |
| panel | 카드 내부 정보 묶음 |
| chip/badge | 상태/분류 |

카드 기준:

- 바깥 카드: `var(--surface)` 계열.
- 내부 패널: 바깥 카드와 명확히 다른 배경.
- 라이트모드에서 투명도만으로 구분 금지.
- 카드 내부 텍스트가 밖으로 넘치면 카드 문제로 본다.
- 카드 내용이 많으면 모달/상세로 넘긴다.

## 버튼 원칙

| 타입 | 용도 |
| --- | --- |
| primary | 현재 가장 중요한 행동 1개 |
| secondary | 일반 행동 |
| danger | 취소, 강퇴, 무효, 삭제 |
| icon | 닫기, 검색, 설정, 초대 |

원칙:

- 한 카드 안 primary는 최대 1개.
- 버튼 텍스트가 줄을 깨면 문구를 줄인다.
- 위험 행동은 항상 danger.
- 닫기와 경기취소를 섞지 않는다.
- 비활성 버튼은 이유를 같이 보여준다.

문구:

| 나쁜 문구 | 좋은 문구 |
| --- | --- |
| 방닫기 | 모달 닫기 |
| 방닫기 danger | 경기취소 |
| 대기완료 | READY |
| 동의 | READY |
| 재확인 | CONFIRM |
| 후보팀 | 후보 |
| 충원팀 | 후보 |

## 뱃지 원칙

태그 순서:

1. 단계
2. 방식
3. 공개 여부
4. 참가 방식
5. 경기 종류
6. 심판

상태 색:

| 상태 | 색 |
| --- | --- |
| waiting | blue |
| locked | blue |
| checkin | orange |
| live | blue/orange |
| postgame | orange |
| dispute | orange/danger |
| record | gold |
| cancelled | neutral |
| void | neutral |

금지:

- 공개확정
- 일반
- 사전등록 남발
- FLOW 접두어
- 카드 제목에 상태 중복 표기

## 방 카드 원칙

경기 메뉴와 매칭 메뉴의 방목록카드는 같은 정보 구조를 쓴다.
매칭 메뉴의 외형과 상단 흐름은 유지할 수 있지만, 중간 요약 박스는 경기 메뉴처럼 `A / 전체 / B`, 룰 순서로 통일한다.

목록 카드에 표시:

- 단계 뱃지.
- 경기 방식.
- 공개/비공개/팀전/개인전.
- 정규전/친선전.
- 심판 있음/없음.
- 제목.
- 일시.
- 구장.
- 슬롯 현황.
- 방 보기 버튼.

목록 카드에서 숨김:

- 참여자 전체 명단.
- 개인 참여자의 소속 팀명.
- 후보 목록 전체.
- 긴 룰 설명.
- 반복되는 팀/사이드 정보.

## 방 만들기 팀전 선택

- 팀전 방 유형은 내 팀이 있는 사용자에게만 활성화한다.
- 팀전 A사이드는 select로 내 소속 팀만 고른다.
- 비공개 팀전 B사이드는 공용 `SearchPicker` 검색으로만 고른다.
- B사이드 검색 focus 상태에서는 즐겨찾기 팀을 최대 10개까지 세로 목록으로 보여준다. 즐겨찾기 팀이 없으면 추천 B사이드를 보여준다.
- B사이드 검색 결과에서 즐겨찾기 토글은 별 아이콘 보조 액션으로 둔다. 행 선택 버튼 안에 버튼을 중첩하지 않는다.

## 팀 초대 UI

- 팀 상세 관리에서 새 팀원은 즉시 추가하지 않고 초대 발송으로 처리한다.
- pending 팀 초대는 관리 카드 안에 작게 표시하고 취소 액션을 둔다.
- 받은 팀 초대는 알림 화면의 초대 카드에서 수락/거절한다.

## 방 모달 원칙

1. 공개방/비공개방 같은 모달.
2. 매칭 메뉴/경기 메뉴 같은 모달.
3. 단계별로 필요한 패널만 바뀐다.
4. 모달이 열리면 뒤 페이지 스크롤 잠금.
5. 모달 외부 클릭으로 닫힘.
6. 닫기 버튼은 크고 명확하게.
7. 경기취소는 별도 danger 버튼.
8. 룰/메모/구장 예약 정보는 항상 보임.
9. 심판이 있으면 심판 카드 진입점 표시.
10. 슬롯 액션은 슬롯에서 바로 열림.

## 검색 선택 원칙

1. 즐겨찾기/자주 찾는 항목은 해당 검색 입력을 열었을 때 팝업 안에 보여준다.
2. 선택 화면 아래에 별도 즐겨찾기 추가 버튼을 두지 않는다.
3. 검색 입력은 필터만 하지 않고 바로 선택 가능한 결과 목록을 제공한다.
4. 팝업 목록은 카드 안 작은 패널로 처리하고 일반 콘텐츠 그라데이션을 쓰지 않는다.
5. 검색창별 대상 타입은 제한하되, 해당 타입의 해시태그는 검색어에 포함한다.
6. floating SearchPicker 결과는 다음 카드나 selector panel에 가려지지 않도록 열린 카드의 stacking을 올린다.

## 슬롯 원칙

출전 슬롯과 후보 슬롯:

- 같은 너비.
- 같은 높이.
- 같은 아바타 영역.
- 같은 상태 표시 위치.
- 같은 border 기준.

금지:

- 선수가 들어오면 슬롯 너비가 달라지는 것.
- 후보 슬롯만 다른 컴포넌트처럼 보이는 것.
- 프로필 텍스트 때문에 카드 높이가 늘어나는 것.
- 관리 버튼 때문에 슬롯 줄이 깨지는 것.

슬롯 표시 순서:

1. 왕관/역할 표시.
2. 포지션 아바타.
3. 이름.
4. 포지션.
5. 파티/개인 참여.
6. READY/WAIT.

왕관 기준:

- 노란 왕관: 방장.
- 파란 왕관: 사이드장/파티장.
- 같은 슬롯에서 겹치면 노란 왕관만 표시.
- 팀 주장은 팀 화면에서만 표시하고 경기 슬롯 왕관으로 쓰지 않는다.

## 아바타 원칙

1. 슬롯은 포지션 아바타 사용.
2. 티어는 배경 엠블럼으로만 표시.
3. 티어 텍스트/뱃지는 슬롯 안에서 제거.
4. hover 카드에는 티어 상세 유지.
5. `object-fit: cover`.
6. `contain` 금지.
7. 하반신은 숨기고 얼굴~상체 중심.
8. 아바타가 슬롯 크기를 키우면 안 된다.
9. 상하좌우 자른 경계가 칼로 자른 느낌이면 안 된다.
10. PG/PF는 공이 보이게 조금 줄인다.
11. C는 엠블럼을 가리지 않게 줄인다.

## 파티 시각화

1. 파티는 전체 테두리로 묶는다.
2. 파티 내부 슬롯 간격은 변하지 않는다.
3. 2명 이상일 때만 파티 표시.
4. 혼자 남은 파티는 표시하지 않는다.
5. `o-o-o` 느낌의 연결선을 넣는다.
6. 연결선은 텍스트와 아바타를 가리지 않는다.
7. 모바일에서는 연결선보다 전체 배경/테두리 우선.

## 프로필/호버 원칙

데스크톱:

- hover로 카드 표시.
- 클릭하면 카드 고정.
- 카드 고정 중 다른 hover 카드 금지.

모바일:

- 탭/길게 누르기로 카드 표시.
- 프로필 페이지 이동은 카드 안 `프로필 보기`.
- 선수/팀/구장/심판 모두 같은 규칙.

팝업:

- 최상단 포털.
- 부모 카드에 잘리면 안 됨.
- 아래 공간 없으면 대상 상단 기준 위로 표시.
- 외부 클릭 시 닫힘.

## 라이트 모드 원칙

1. 다크용 검은 투명 박스를 그대로 쓰지 않는다.
2. 카드와 내부 패널 색 차이가 보여야 한다.
3. 작은 글씨 대비를 확보한다.
4. 아바타 배경 경계가 보이면 마스크/배경을 조정한다.
5. 배경 사진은 낮 이미지.
6. 테두리만으로 구분하지 않고 배경 단계도 둔다.
7. 하단 메뉴는 회색 덩어리로 보이지 않게 밝은 민트/블루 계열 flat surface를 쓰고 gradient를 넣지 않는다.

## 모바일 원칙

1. 가로 스크롤 금지.
2. 하단 메뉴 한 줄.
3. 하단 메뉴가 본문을 가리면 본문 padding-bottom 조정.
4. 필터 버튼은 줄바꿈.
5. 큰 요약 패널 제거.
6. 카드 내부 긴 정보는 접거나 숨긴다.
7. 기록판은 한 화면에 최대한 5명 보이게.
8. 개인활약은 3칸 x 2줄.
9. 모달 액션 버튼은 손가락으로 누르기 충분한 높이.
10. 주소창/하단 메뉴 때문에 가려지는 영역 고려.
11. 기록방 요약은 점수/개인활약/파울을 말줄임하지 않고 줄바꿈으로 전부 읽히게 한다.
12. 모바일 슬롯 액션/초대 팝업은 슬롯 좌표에 매달지 않고 화면 안쪽 중앙 sheet로 띄운다. 초대 검색 결과는 팝업 안 inline 목록으로 크게 보여서 선택 버튼이 숨거나 화면 밖으로 잘리지 않게 한다.
13. 달력 날짜 칸은 경기 수 배지가 있어도 행 높이가 바뀌지 않게 고정한다.
14. `dispute` 방 모달은 경기 관계자가 점수판을 열람하고 새로고침할 수 있다. 점수판 수정/저장은 심판 또는 방장에게만 보이며 저장 결과 메시지는 기록판 안에 짧게 표시한다.
15. `record` 방 모달은 읽기 전용이다. 채팅 입력, 슬롯 관리, 초대, 방 수정 버튼을 보이지 않는다.

## 홈 디자인 원칙

홈은 대시보드가 아니라 액션 허브다.

구성:

1. 검색/빠른 진입.
2. 처리 필요.
3. 내 일정 요약.
4. 최근 기록.
5. 나 메뉴 기록 화면은 최근 6개월 상세 기록과 날짜별 count를 먼저 보여준다. 오래된 기록은 전체 상세 카드가 아니라 텍스트/집계형 목록으로 분리한다.
6. 팀/랭킹 요약.

원칙:

- 검색 기록 영역 제거.
- 처리 완료된 액션은 즉시 사라짐.
- 단순 대기중 방은 홈 액션에 넣지 않음.
- 카드 그라데이션 혼자 튀지 않게 통일.
- 랭킹/모드별 티어는 2x2 기준으로 정렬.
- 홈 상단 사용자 요약과 `경기 만들기` CTA는 랭크/티어 히어로 안에 둔다. 별도 상단 카드로 분리하지 않는다.
- 검색 입력은 공용 `SearchPicker`를 쓴다. 입력 즉시 아래에 결과를 띄우고, 화면 목적에 맞는 대상만 검색한다.
- 방만들기 심판 초대는 native select가 아니라 공용 `SearchPicker`를 쓰고, 심판 자격이 있는 후보만 검색한다.
- 설정의 요청 폼은 신뢰도/권한 조건을 제출 버튼 근처에 먼저 보여주고, 조건 미달이면 버튼을 비활성화한다.

## 경기/매칭 디자인 원칙

경기:

- 내 일정 중심.
- 캘린더와 목록 정렬 일치.
- 과거 필터는 달력 표시 범위.
- 확정 이후 방은 경기 메뉴에서 같은 모달로 열림.

매칭:

- 대기방 중심.
- 방 카드에서 참여자 제거.
- 필터는 접기 가능.
- 첫 목록은 내 지역 중심이다. `전체 지역` 토글을 기본 필터로 두지 않고, 나중에 시군구 선택 필터로 확장한다.
- DB 기본 제목 `모집방`은 사용자가 쓴 방제처럼 카드 제목으로 강조하지 않는다.
- 모바일 큰 표시판 제거.
- 방보기 버튼은 명확하게.

## 진행 디자인 원칙

1. 진행 중/기록 필요 경기와 확정 후 24시간 이내 평가 가능한 경기만 보여준다.
2. 예정 경기에는 기록판을 보여주지 않는다.
3. 기록 확정 후 24시간이 지난 경기는 경기 메뉴에서 숨기고 나/팀 기록 화면에서만 보여준다.
4. 모바일 기록판은 촘촘하되 터치 가능해야 한다.
5. 점수는 자동 합산이 보이게 한다.

## 팀 디자인 원칙

1. 팀 카드는 엠블럼 중심.
2. 프로필 사진 장식 제거.
3. 골드3 같은 텍스트 티어는 줄이고 엠블럼으로 표시.
4. 즐겨찾기 버튼은 카드 핵심 흐름을 방해하면 제거.
5. 멤버 행은 이름/포지션/역할만 정렬.
6. 오버플로우 금지.
7. 팀 허브 히어로 스타일은 유지 가능.
8. 새 팀명은 경기/매칭 방 요약 박스 기준으로 14자를 넘기지 않는다.
9. 팀 만들기 홈 코트는 native select가 아니라 구장 전용 `SearchPicker`를 쓰고, 즐겨찾기 구장 또는 추천 구장을 focus popup 안에 보여준다.

## 설정 디자인 원칙

1. 데스크톱에서 좌우 컬럼 높이 균형.
2. 긴 학습자료는 별도 페이지.
3. 신고/심판/구장 등록은 카드 분리.
4. 구장 등록의 주소검색/좌표변환은 같은 폼 안에서 보조 액션으로 배치.
5. 관리자 메뉴 진입은 권한자에게만 보이는 별도 카드로 둔다.
6. 설정 페이지가 세로로 지나치게 길어지면 분리.
7. 즐겨찾기 관리는 나 메뉴가 아니라 설정 메뉴의 전용 카드에서 한다. 프로필/팀/구장/심판은 각 10개 한도를 표시하고, 관련 검색창의 focus popup과 검색 결과 별 토글에 연결한다.

## 관리자 디자인 원칙

1. 관리자 메뉴는 전체 신고를 시간순으로만 쌓지 않는다.
2. 기본 축은 구장별, 플레이어별, 경기별 정렬이다.
3. 왼쪽은 정렬 큐, 오른쪽은 선택 항목 상세로 둔다.
4. 관리자 화면도 일반 콘텐츠 카드 규칙을 따른다.
5. 임명 관리는 검토 큐 위에 별도 카드로 두고, 관리자/심판 등급 기준과 만료일을 먼저 보여준다.
6. 처리 액션은 선택 상세 안에 배치하고 신고자 피드백, 제재 기간, 대상 선택을 한 번에 보여준다.
7. 플레이어 큐는 신고/요청/제재가 있는 대상만 보여주고 전체 플레이어를 나열하지 않는다.
8. 처리 액션은 서버 로그가 붙기 전까지 mock 안내를 같이 노출한다.

## CSS 원칙

1. 새 색상 직접 추가 전 `tokens.css` 확인.
2. 반복되는 카드/패널 스타일은 공통 클래스로 묶는다.
3. 컴포넌트 크기를 내용에 맡기지 않는다.
4. 슬롯/보드/버튼은 고정 또는 clamp 기준 치수 사용.
5. `vw` 기반 font-size 금지.
6. letter-spacing 음수 금지.
7. 보라/남색/베이지/갈색 단일톤으로 밀지 않는다.
8. 라이트/다크 override는 같은 selector 구조로 둔다.

## 수정 전 체크리스트

UI 수정 전:

- 같은 컴포넌트가 다른 메뉴에도 있는가.
- 라이트 모드도 같이 바뀌는가.
- 모바일에서 가로 스크롤이 생기지 않는가.
- 텍스트가 버튼/카드 밖으로 나가지 않는가.
- 카드 안 카드가 생기지 않는가.
- 배경 이미지가 중복되지 않는가.
- slot width가 출전/후보에서 같은가.

수정 후:

- desktop dark.
- desktop light.
- mobile dark.
- mobile light.
- 방 모달.
- 카드 목록.
- hover/popup.
- 하단 메뉴.

## 메뉴 간 디자인 통일 원칙

같은 정보군은 메뉴가 달라도 같은 구조와 같은 표면을 쓴다.

- 기록: 홈 최근 전적, 나 메뉴 최근 기록, 나 메뉴 전체 기록은 같은 `recent-match-row` 행 구조를 쓴다.
- 수치: 팀 카드 기록, 나 메뉴 통계, 홈 요약 수치는 같은 metric tile 구조를 쓴다.
- 필터: 경기 메뉴 필터와 매칭 메뉴 필터는 줄바꿈 가능한 버튼/셀렉트 구조를 쓴다. 가로 스크롤 금지.
- 필터 active 상태는 라이트/다크 모두 배경과 글자색을 같이 지정해 대비를 유지한다.
- 방 목록: 경기 메뉴와 매칭 메뉴 방카드는 같은 요약 박스 구조를 쓴다. 외형 차이는 허용하지만 정보 계층은 같아야 한다.
- 라이트 모드: 회색 면을 기본값으로 쓰지 않는다. 흰색/민트 계열 표면과 명확한 내부 패널 차이를 둔다.
- 카드 내부: 카드 안의 작은 정보 묶음은 inner panel 계층으로 처리한다. 다른 카드처럼 보이게 중첩하지 않는다.

## 2026-06-22 카드 표면 표준

- 콘텐츠 박스와 목록 카드는 그라데이션을 쓰지 않는다. 히어로 배경과 티어 배경처럼 이미지가 핵심인 영역만 예외다.
- 홈, 팀, 경기, 매칭의 일반 카드 표면은 `rgba(10, 14, 21, 0.9)` 계열 flat surface를 기본으로 한다.
- 라이트 모드는 회색 면을 기본값으로 쓰지 않고 흰색/민트 계열 flat surface를 쓴다.
- 경기 메뉴 공개방 카드가 방 목록 카드의 기준이다. 매칭 메뉴 대기방 카드도 같은 `om-match-card` 배치, 같은 요약 박스, 같은 방보기 버튼 구조를 따른다.
- 매칭 목록만 따로 슬롯 숫자/요약 박스 모양을 축약하지 않는다. 필요하면 방 모달에서 줄이고, 목록 카드는 메뉴 간 같은 시각 문법을 유지한다.

## 2026-06-23 dense surface pass

- 플레이어/팀 hover popup의 티어는 엠블럼 1개와 텍스트 라벨 1개만 쓴다. `TierEmblem` 옆에 `TierBadge compact`를 중복 배치하지 않는다.
- hover popup 안의 엠블럼은 별도 pill/border 안에 다시 넣지 않는다. 엠블럼 자체만 키우고 카드 밖으로 넘치지 않게 한다.
- 홈 우측 rail, 팀 카드, 설정 카드의 일반 content surface는 flat surface를 쓴다. hero/tier image 영역이 아닌 곳에는 gradient를 넣지 않는다.
- 설정 desktop은 좌우 컬럼 높이가 과하게 벌어지지 않게 `repeat(2, minmax(0, 1fr))` 기준으로 맞추고, 내부 metric/form/list는 compact height를 기본값으로 둔다.
- 설정의 구장 검색 결과, 신고 대상처럼 길어지는 보조 목록은 카드 전체 높이를 밀지 않도록 내부 스크롤로 압축한다.
- 팀 카드의 통계/멤버 row는 동일한 최소 높이와 동일한 gap을 유지한다. 팀 엠블럼은 카드 우측에 한 번만 크게 보여준다.
- 검색 input의 즐겨찾기 shortcut은 항상 노출하지 않고 focus popup 안에 작게 둔다. 해당 검색 대상과 다른 타입의 즐겨찾기는 섞지 않는다.
- 즐겨찾기 토글은 주 CTA가 아니므로 작은 보조 액션 크기로 둔다. 팀 프로필 모바일에서도 full-width 버튼으로 키우지 않는다.
- 프로필의 외부 연동 카드는 기존 `section-card`, `contract-grid`, `settings-toggle-grid` 표준을 재사용한다. 별도 랜딩/온보딩 카드로 키우지 않는다.
- Discord 연동 표시는 작은 pill 링크 뱃지로 둔다. 프로필 이미지는 `discordConnection.avatarUrl`이 있을 때만 원형 아바타 배경으로 쓰고, 없으면 기존 색상 이니셜을 유지한다.
- 모집방 파티 슬롯과 파티 묶음은 진한 테두리 대신 투명한 표면과 발광 후광으로 묶는다. 파티 연결선은 선 하나만 쓰고 슬롯 테두리에서 끊기지 않게 아바타 중심까지 이어지며 엠블럼 뒤 레이어에 둔다.
- 아바타와 티어 엠블럼 이미지가 슬롯/카드 경계에서 잘려 보이면 CSS mask feather로 가장자리를 부드럽게 처리한다.
- 경기 메뉴의 `전체/정규전/친선전`과 경기 방식 필터는 캘린더 아래 별도 카드가 아니라 `내 진행 일정` 요약 안에 둔다.
- 모집 메뉴의 매치방 필터도 경기 메뉴 필터처럼 `segmented-control compact-segments` 묶음과 라벨 없는 방식 셀렉트를 쓴다.
- 신고 폼은 사유 선택을 먼저 두고, 그 다음 공용 `SearchPicker`로 사유에 맞는 선수/경기기록/구장요청만 검색한다. 경기기록 검색 결과와 관리자 검토에는 같은 경기기록 해시태그를 노출한다.
- 실제 Google/Supabase auth 프로필에서는 Settings의 테스트 계정 전환 UI를 숨기고 `Google 계정당 1개` 고정 상태만 flat `contract-grid`로 표시한다.
- 가입정보 설정의 해시태그와 출생연도는 잠긴 뒤 disabled input과 짧은 `muted` 설명으로 표시하고, 중복/월 1회 제한은 `form-warning`으로 표시한다.

## 2026-06-24 목록/라이트 방 표준 정리

- 사이드바/프로필 티어 pill은 한 줄로 유지하고 외곽선 없이 엠블럼이 시각 중심이 되게 한다.
- 경기와 매칭 목록 카드는 데스크탑에서 더 넓은 공통 요약 박스를 써서 팀명이 글자 단위로 줄바꿈되지 않게 한다.
- 경기와 매칭 필터 select는 옆 필터 버튼과 같은 42px 높이를 쓴다.
- 라이트 모드 방 패널과 선수 슬롯은 코트 배경이 보이는 반투명 flat surface를 쓴다.

## 2026-06-22 CSS cleanup

- 공통 히어로 구조와 배경은 이번 정리 범위에서 제외한다.
- 경기/매칭 목록 카드는 같은 `om-match-card` 기준으로 간격, 요약 박스, 방보기 버튼을 맞춘다.
- 매칭 목록 카드도 경기 목록 카드처럼 슬롯 숫자/팀명과 룰 요약을 같은 크기 계층으로 보여준다.
- 경기/매칭 목록 카드의 제목은 실제 방제만 보여준다. 상태, 모드, 대진, 규칙과 중복되는 자동 생성 제목은 숨긴다.
- 경기/매칭 목록 카드 안 요약 박스는 상태에 따라 별도 테두리/배경 강조를 넣지 않는다. 상태는 상단 배지와 버튼으로만 구분한다.
- 모바일 방 목록은 룰 상세 문구를 숨기고 상태/제목/일시/구장/요약만 남긴다.
- 모바일 달력 날짜 칸은 경기 수 표시가 있어도 높이가 바뀌지 않게 고정한다.
- 기록방 요약은 모바일에서 개인활약 문구가 말줄임으로 잘리지 않게 줄바꿈을 허용한다.
- 경기 목록의 점수 요약은 팀명 `span.team-hover-trigger`를 보조 문구 span과 같은 selector로 묶지 않는다.
- 경기 목록의 점수 요약 팀명은 다른 방 요약 좌우 팀명과 같은 큰 폰트 계층을 쓴다.
- 라이트모드는 회색 덩어리 대신 밝은 흰색/민트 계열 표면과 명확한 내부 패널 차이를 둔다.
- 하단 메뉴는 모바일에서 한 줄, 큰 아이콘, 충분한 터치 높이, flat surface를 유지한다.

## 2026-06-23 관리자/구장 UI 업데이트

- 관리자 임명/회수 폼은 `admin-action-panel` 표준을 재사용한다. 별도 카드 안 카드처럼 보이게 만들지 않는다.
- 심판 등급 산정 요약은 작은 내부 패널 grid로 표시하고, 이름/등급/점수/경기수/따봉/신고만 보여준다.
- 구장 등록요청 승인 버튼은 요청 row 오른쪽 액션으로 둔다. 등록요청 목록 전체를 별도 승인 페이지로 복제하지 않는다.
- 구장등록 폼에는 경기방 예약 여부를 넣지 않는다. 예약 여부는 경기방 생성의 `courtReserved`에서만 다룬다.
- 구장등록 폼은 Naver 주소검색, 선택 주소 요약, 상세주소, 선택적 지도 핀, 구장 메타 입력 순서로 둔다. 지역, 주소 프리텍스트, 위도, 경도 입력칸은 노출하지 않는다.
## 구장 속성 UI

1. 구장 등록은 바닥과 형태를 일반 입력 필드와 같은 높이의 셀렉트로 보여준다.
2. 구장 선택/방 수정에서 바닥과 형태는 보조 정보로 짧게 붙인다.
3. 구장 hover 카드의 별점 칸은 추천 배지가 아니라 리뷰 평균과 리뷰 수를 보여준다.
4. 경기방의 구장 리뷰 작성은 postgame 보조 카드로 보여주고, 종합 별점은 필수, 세부 별점은 선택으로 둔다.
5. 반코트 5v5 경고는 차단 UI가 아니라 작은 경고 문구로 표시한다.

## 2026-06-24 구장 등록 상태 UI

1. Naver 키, 주소 선택, 좌표 저장, 중복 확인은 폼 안의 작은 `arena-mini-note` 또는 `tier-range-note`로만 표시한다.
2. 중복 구장 경고는 orange tone note로 표시하고 제출 버튼은 비활성화한다.
3. 지도 핀 버튼은 주소가 선택되고 Naver Maps JavaScript 키가 있을 때만 활성화한다.
4. 구장등록 주소 입력은 공용 실시간 `SearchPicker`를 쓰지 않고 일반 input, `네이버 주소 검색` 버튼, 선택 결과 목록으로 처리한다.
5. Naver 주소 결과 row는 도로명, 작은 출처 배지, 지번 보조줄을 분리해 겹치지 않게 표시한다.
6. 구장등록 폼은 신뢰도 기준을 통과한 사용자에게만 렌더링하고, 미달 사용자는 권한 안내만 보여준다.
7. 상세주소는 주소의 일부이고, 찾아가는 메모는 현장 접근 설명으로 분리한다.

## 2026-06-24 심판 등록 상태 UI

1. 심판 룰북 카드는 모든 사용자에게 보여준다.
2. 심판 시험 패널과 심판 등록요청 폼은 신뢰도 기준 통과자에게만 렌더링한다.
3. 신뢰도 미달 사용자는 시험 버튼 대신 필요한 신뢰도와 현재 신뢰도 안내만 본다.

## 2026-06-25 목록카드 중간폭 표준

1. 경기/매칭 방 목록카드는 충분한 데스크탑 폭에서만 정보/요약/버튼 3열을 유지한다.
2. 761px~960px 중간폭에서는 정보와 버튼을 첫 줄에 두고, 요약 박스는 다음 줄 전체 폭으로 내린다.
3. 태그, 일시, 구장, 방장/팀 메타가 좁은 첫 열에 갇혀 줄바꿈되면 카드 폭 문제로 본다.
4. native select 옵션 목록은 브라우저가 흰 배경으로 펼칠 수 있으므로 option/optgroup 글자색을 어두운색으로 고정한다.
5. 프로필 공유카드는 오른쪽에 큰 티어 엠블럼을 두고, 링크 복사는 현재 페이지가 아니라 `/app/players/{userId}` 공개 프로필 URL을 복사한다.

## 2026-06-24 Login OAuth browser guard

1. Google OAuth는 KakaoTalk, Instagram, Naver app, Line 같은 embedded browser에서 시도하지 않는다.
2. 로그인 화면은 embedded browser를 감지하면 작은 안내 패널, 링크 복사, 새 창 열기 액션을 먼저 보여준다.
3. 안내 패널은 기존 `auth-card` 안의 flat warning surface로 처리하고 별도 모달을 만들지 않는다.

## 2026-06-25 테스트 로그인 UI

1. 테스트 계정 선택기는 로그인 카드 안에만 둔다.
2. Google OAuth 버튼과 테스트 계정 버튼은 같은 provider button 계열을 쓴다.
3. 테스트 계정 선택기는 `VITE_DEMO_LOGIN=true` 또는 localhost에서만 보인다.
4. 테스트 계정 UI는 실제 가입/프로필 설정 흐름을 대체하지 않는다.

## 2026-06-26 settings save UI

1. 밝기 카드는 segmented control로 선택하고 같은 카드 하단에 저장 버튼과 짧은 상태값을 둔다.
2. 구장 등록요청 폼은 저장 실패 시 입력값을 유지하고 상태 메시지를 폼 안에 표시한다.

## 2026-06-26 create submit feedback

1. 경기/대회 생성 버튼이 비활성화되면 같은 submit row에 정확한 조건 미달 이유를 항상 표시한다.
2. 서버 저장 실패로 생성 id가 반환되지 않으면 같은 submit row에 실패 메시지를 표시하고 입력값은 유지한다.
3. 서버 저장 실패 메시지는 가능한 경우 원문 error code를 함께 표시해 운영자가 실제 실패 원인을 확인할 수 있게 한다.
4. 서버 전송 전 local reducer가 생성을 차단한 경우에도 reducer가 만든 알림 제목/본문을 같은 submit row에 표시한다.

## 2026-06-25 가입 해시태그 UI

1. 가입 해시태그는 추천값을 자동으로 채우지 않는다.
2. `#` 기호는 입력칸 밖 prefix로 고정하고 사용자가 지울 수 없게 한다.
3. 사용자는 `#` 뒤의 본문만 직접 입력하며, 빈 값은 저장하지 않는다.
## 2026-06-25 심판 초대 슬롯 UI

1. 방 모달의 심판 초대 슬롯은 기존 선수 초대 패널 계열을 쓰되 별도 `RefereeInvitePanel`로 분리한다.
2. 심판 검색은 공용 `SearchPicker`를 쓰고 심판 자격이 있는 후보만 보여준다.
3. 심판 초대 대기자는 작은 pill 목록으로 표시한다.
4. 공개방 직접 `심판참여` 버튼은 `refereeWanted` 방의 심판 슬롯 안에서만 보여준다.

## 2026-06-25 1v1 개인방 참여 UI

1. `sideCapacity === 1`이고 방장이 개인인 방은 참여 방식에서 팀 탭을 숨긴다.
2. 같은 팀 파티 합류 버튼과 슬롯 파티 합류 액션도 숨긴다.
3. 2v2 이상 방의 팀/파티 참여 UI는 기존 기준을 유지한다.
4. 아직 참여하지 않은 공개방의 액션 버튼은 `참여하기`로 표시하고, 실제 참여 상태 문구인 `참여 중` 또는 `내 참여방`과 구분한다.

## 2026-06-27 경기 메뉴 점진 로딩

1. 경기 메뉴는 `/api/matches/list` 결과가 오면 경기 카드와 경기 카운트를 먼저 보여준다.
2. 첫 렌더는 current-profile match feed만 기준으로 한다.
3. `scope: "mine"` 모집방 보강 로드는 경기 메뉴 idle 경로에서 실행하지 않는다.
4. 경기 카드가 아직 하나도 없고 경기 feed 로드가 진행 중이면 `해당 큐 없음`을 먼저 보여주지 않고 loading empty-state를 유지한다.
5. 진행 메뉴도 기록 가능한 경기 보강 로드가 진행 중이면 `처리할 진행 경기 없음`을 먼저 보여주지 않고 loading empty-state를 유지한다.
6. 매칭 화면에서 이미 로드한 모집방 state는 경기 메뉴 목록/카운트에 자동으로 섞지 않는다.

## 2026-06-27 경기 카드 좁은 화면

1. 760px 이하에서도 `om-score-box`와 summary/info box는 카드 전체 폭을 사용한다.
2. `om-room-link`는 첫 행 오른쪽에 고정하고 score/summary는 다음 행으로 내려 카드 내용과 겹치지 않는다.

## 2026-06-30 invite selection hover

1. Invite/team/player selection panels must not wrap selected result headers with hover cards.
2. Touch-pinned hover cards close on a second tap of the trigger.

## 2026-07-01 strap cleanup

1. Active menu/card uses background and border contrast only. Do not use strap, accent stripe, or thin top-line decoration.
2. Buttons use flat fill and border contrast only. Do not use 3D drop straps, glow shadows, or thick offset shadows.

## 2026-07-01 visible sports identity pass

1. 홈, 경기, 매칭 첫 화면은 radius만 바꾸지 않고 court-line background와 scoreboard surface를 같이 사용한다.
2. Hero title은 기존 큰 크기를 유지하되 scoreboard 대비와 숫자 계층을 강화한다.
3. Active filter/card 상태는 글자색만 바꾸지 않고 같은 green fill과 상단 얇은 라인으로 통일한다. 좌측 세로 accent stripe는 쓰지 않는다.
4. Glow/gradient 증가는 금지하고, 실제 서비스처럼 진한 표면·명확한 border·팀 컬러 accent로 구분한다.
5. 전역 body 배경에는 노란/골드 wash를 쓰지 않고, 흰색 또는 중립 court-line 광원만 사용한다.

## 2026-07-01 Imweb fitness internal screen pass

1. Internal app screens use charcoal sports surfaces in dark mode and warm cream sports surfaces in light mode.
2. Primary CTA color is orange. Green is kept for success/ready states only.
3. Match list cards stay summary-only: title, status, time, court, count, score/result, CTA. Player slot grids must not be rendered directly in list cards.
4. Room modal and lobby must preserve `SideRoster`, `ReserveLine`, `PlayerRoomSlot`, empty slots, reserve slots, avatar, READY/WAIT, party group, and party connection line.
5. Party connection glow stays visible but subdued, using orange line/glow instead of neon green/blue.
6. Light mode must not become a white SaaS dashboard. Use warm cream background, charcoal text, orange CTA, soft card surface, and court/gym wall tone.

## 2026-07-01 Home composition pass

1. Desktop home uses a court hero plus right rail composition: rank hero on the left, search/action queue on the right.
2. Home lower dashboard uses match-focused primary column and compact support-card rail.
3. Mobile home stays single-column for readability: search, action queue, rank hero, then dashboard.

## 2026-07-01 Full internal preview pass

1. Internal app screens follow the supplied preview more strongly: charcoal sports background, large condensed hero title, compact cards, orange primary CTA, and flat scoreboard surfaces.
2. Home composition changes from simple stacked cards to hero plus right rail from 760px upward. Mobile remains single column.
3. Matches and Recruiting list cards stay summary-first: title, status chips, time/court, count or score, and one CTA.
4. Room modal keeps existing slot, avatar, reserve, READY/WAIT, captain/host badge, and party connection structure. Only visual skin, spacing, and responsive sheet treatment change.
5. Active buttons and selected states use orange fill or orange-tinted surface. Green is reserved for ready/success states.
6. Light mode remains warm cream sports UI, not pure white dashboard.

## 2026-07-01 Fuller hero board

1. Recruiting and Matches heroes use image-led board composition: larger min-height, full-cover background image, and text over the lower image area.
2. Dark overlay must protect text readability without hiding the sports photo. Light mode uses warm cream/brown overlay, not white dashboard treatment.

## 2026-07-01 Party slot avatar tuning

1. Party connection line crosses the avatar/emblem center and keeps a visible warm glow.
2. Player avatar images are cropped/feathered above nickname text so names, position, team, and READY stay readable.

## 2026-07-01 App floor background

1. The far-back app background does not use a visible court/grid pattern. Keep it flat with only a very soft light wash.
2. Court lines may appear inside hero boards or focused cards, not across the whole page floor.

## 2026-07-01 Room reserve and palette

1. Room modal reserve lanes show A-side and B-side candidates in one horizontal row group to reduce vertical height.
2. Dark and light UI use charcoal/cream surfaces with orange primary actions, gold wait/warning states, and green only for READY/success states.

## 2026-07-01 Home search placement

1. Desktop home places the search panel as a compact top bar above the hero and right rail.
2. Mobile home keeps the hero first and places search directly below the hero before action queue.
3. Desktop search results open as a dropdown so the top bar does not push the hero down.

## 2026-07-01 Mobile hero bleed

1. On mobile, page hero/header surfaces bleed to the viewport edges so the far-back page background is not visible at the top left/right. Room modal internals are excluded; Home and Team may keep layout-specific content placement only.
2. Mobile hero top corners are square; lower corners may keep the large app radius.

## 2026-07-01 Shared UI primitives

1. Buttons, icon buttons, segmented controls, selects, inputs, cards, panels, badges, and chips derive from shared primitive tokens in `tokens.css`.
2. Page CSS may change layout, width, and contextual emphasis, but should not invent unrelated border radius, shadow, border, or primary color rules.
3. Primary actions use orange. Secondary controls use surface plus border. Green is reserved for READY/success state.
4. Raw page-specific button/card overrides should be migrated back to the shared primitive layer instead of adding new late overrides.
5. Hero title typography uses the shared `--hero-title-*` tokens. Home, Matches, Recruiting, room, profile, team, season, rulebook, and tournament heroes keep page layout differences but share title color, shadow, condensed font stack, line-height, and letter spacing.
6. Page-specific cards and panels should be added to the shared primitive selector layer first. Only layout-specific size/gap/placement belongs in page CSS.
7. Condensed hero title fonts use non-negative tracking through `--hero-title-letter-spacing`. English-heavy words like `RANKBALL` must not use tight negative spacing.
8. Segmented control groups use `--control-group-*` tokens. Group radius and padding must leave enough inner space so active buttons are never clipped by the group border or scroll container.
9. New buttons, button groups, cards, inputs, and room modal surfaces use the `--ui-*` aliases in `tokens.css` as the stable module API.
10. `recruiting-arena.css` and `matches-arena.css` load after `globals.css`; each file must end by reconnecting page selectors to the same `--ui-*` primitive layer to prevent chunk-specific override drift.
11. Room modal skin uses `--ui-room-modal-*` and `--ui-room-panel-*`. Slot, avatar, READY/WAIT, reserve, and party connection structure stays separate from visual primitive tokens.
12. Long filter groups, such as recruiting date chips, keep scroll inside the group. Buttons must not bleed outside the group border or lose their own border because of older active-state overrides.
13. Shared `Button` defaults to `type="button"`. Submit actions must explicitly pass `type="submit"` so modal close/cancel buttons never submit parent forms.
14. Settings keeps short profile exposure and Discord controls inside the main settings screen with one shared save action. Favorites, court request, and referee request stay as separate settings subpages.
15. Rulebook illustrations must use `object-fit: contain` so exported PNG/WebP scenes are fully visible inside their cards.
16. On mobile/tablet app layouts, the first page hero cancels `app-main` top and side padding. Home, settings, teams, matches, recruiting, match room, profile, season, and rulebook heroes must start at the app viewport top edge with no side gutters.
17. Image-led cards and hero cards must not contain extra framed mini-cards for secondary navigation. Keep secondary links as text actions unless a primary CTA or form control is required; ask before reintroducing boxed inner controls.
