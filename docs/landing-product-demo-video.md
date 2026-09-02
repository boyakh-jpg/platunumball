# 랜딩 제품 데모 영상

## 산출물

- WebM: `/assets/showcase/landing-product-demo.webm`
- MP4 fallback: `/assets/showcase/landing-product-demo.mp4`
- poster: `/assets/showcase/landing-product-demo-poster.webp`
- 사용자 제공 감열지: `/assets/showcase/landing-product-demo-receipt.png`
- 규격: 1080×1920, 9:16, 30fps, 약 60초, 무음

## 운영 배포

랜딩은 `assetUrl()`의 공용 R2 경로를 사용한다. production 빌드의 기존 `scripts/sync-receipt-assets-to-r2.mjs`가 WebM·MP4·poster 세 파일도 함께 업로드하며, 영상 MIME은 각각 `video/webm`·`video/mp4`로 저장한다. 고정 이름을 재사용하는 데모 파일은 `public, no-cache`로 재검증하고 버전형 영수증 자산의 immutable 캐시는 유지한다. Vercel CSP의 `media-src`는 이미지와 동일한 공개 `https://*.r2.dev` 호스트를 허용한다. 배포 후 세 객체의 응답과 실제 랜딩 재생을 함께 확인한다.

## 사실 범위

모든 제품 화면은 `boxtier.kr`의 공개 운영 화면과 읽기 전용 경기 데이터를 540×960 모바일 viewport에서 실제 조작·녹화한다. AI 생성 화면과 연습 경기는 사용하지 않는다.

- 방 만들기: `/app/create?intent=match`의 실제 공개 매칭방 생성 폼. `경쟁전`·`개인전`·`5v5`와 참가 가능한 MMR 범위를 확인하되 불필요한 운영 데이터를 만들지 않도록 생성은 실행하지 않는다. 조작 대상은 모바일 메뉴와 설명 상자 사이의 화면 중앙에 둔다.
- 티어 매칭: 공개 경쟁 개인방이 현재 MMR을 기준으로 참가 가능한 점수 범위를 보여주고 비슷한 실력대의 참가자를 모집하는 실제 폼을 보여준다. 상세 산식은 노출하지 않는다.
- 지역 매칭: `/app/recruiting`의 실제 `시도`·`시군구` 필터를 조작한다. 지역은 자동 배정이 아니라 가까운 코트의 공개방을 찾는 검색 조건으로 설명한다.
- 출석: 제품 사용 설명의 실제 QR 출석판 캡처 `/assets/guide/attendance-qr.png`에서 QR과 A/B 출석 현황을 보여준다. 캡처에 남은 과거 안내 문장 영역은 영상에서 제외하고 현재 정책인 경기 20분 전부터로 설명한다.
- 모바일 전광판: 제품 사용 설명의 실제 전광판 캡처 `/assets/guide/live-clock.jpg`에서 1Q 경기시간, 양 팀 점수, 득점 버튼, 샷클락을 보여준다. 정지 캡처에서 점수가 바뀌는 가짜 클릭은 실행하지 않는다.
- 팀 구성·종료 결과: 동일한 실제 5v5 기록방 `tm_31b5b240e7876ae208743610`. 다른 경기나 2v2 화면을 섞지 않는다.
- 티어 변화: 같은 5v5 경기의 실제 참가자 중 배치 완료된 선수 프로필을 열어 현재 티어 엠블럼·통합 MMR·다음 승급 조건을 보여준다. 선수는 공개 경기 API에서 선택하며 랭크보드는 사용하지 않는다.
- 영수증 진입: 같은 기록방 모달의 실제 `영수증 발급` 버튼을 누른다. 공개 비로그인 캡처에서는 실제 로그인 게이트가 호출되며, 편집본은 게이트가 나타나기 전에 사용자 제공 감열지로 전환한다. 테스트 계정 환경 변수를 지정하면 인증 후 영수증 경로로 진입한다.
- 캡처 시점에 이 기록은 종료·확정 상태이며 진행 중인 실제 경기가 없다. QR 출석판과 모바일 전광판은 저장소의 실제 제품 캡처를 사용하고, 라이브 조작이나 점수 변경을 꾸미지 않는다.
- 감열지 결과: 사용자가 제공한 완성 이미지. 최종 `1:0`, `1Q 0:0 · 2Q 1:0 · 3Q 0:0 · 4Q 0:0`을 표시한다.

영상의 단계 설명과 `여기 탭` 표시는 캡처 스크립트가 실제 페이지 위에 그리는 녹화 전용 오버레이다. 설명 상자는 단색으로 두고 왼쪽 주황색 강조선은 사용하지 않는다. 읽기 전용 구간의 리플은 위치 안내이며 운영 데이터 변경을 일으키는 클릭을 실행하지 않는다. `영수증 발급`만 실제 버튼을 클릭한다. 앱 CSS·제품 데이터·버튼 동작은 대체하지 않는다. 마지막 영수증 PNG는 사용자가 제공한 완성본이며 캡처 스크립트가 덮어쓰지 않는다.

## 타임라인

| 구간 | 단계 설명 | 실제 화면·조작 |
| --- | --- | --- |
| 0.0–7.5초 | 공개 5v5 경쟁방 만들기 | 실제 공개방 폼에서 `공개 매칭방`과 `5v5` 선택, `경쟁전` 확인 |
| 7.3–13.5초 | 비슷한 실력대끼리 모집 | 실제 `SILVER 3 ~ GOLD 2` 참가 가능 MMR 범위 확인 |
| 13.2–19.2초 | 지역별 공개방 찾기 | 실제 공개 매칭 목록에서 `부산광역시`·`중구` 필터 조작 |
| 19.0–27.0초 | QR로 현장 출석 확인 | 실제 QR 출석판에서 QR과 A/B 출석 현황 확인 |
| 26.8–32.5초 | 5v5 참가 확인 · 팀 구성 | 같은 기록방의 실제 출전·후보와 팀 구성 확인 |
| 32.3–40.9초 | 휴대폰이 모바일 전광판 | 실제 전광판의 1Q 시간·점수 버튼·샷클락 확인 |
| 40.7–46.0초 | 경기 종료 · 결과 확인 | 같은 기록방의 최종 점수와 확정 기록 확인 |
| 45.7–52.2초 | 기록이 쌓이면 티어도 변화 | 실제 경기 참가자 프로필의 현재 티어·통합 MMR·다음 승급 조건 확인 |
| 52.0–57.0초 | 기록방에서 영수증 만들기 | 실제 `영수증 발급` 버튼 클릭과 이미지·Story·Feed 공유 설명 |
| 56.8–60.7초 | 4쿼터 감열지 영수증 | 사용자 제공 감열지 완성본, 마지막 결과 약 3.9초 유지 |

장면 사이는 220ms 크로스페이드로 연결한다. 첫 방문자가 매칭부터 기록·티어 반영까지 읽을 수 있도록 약 60초로 구성한다.

## 재현

```powershell
$env:BOXTIER_DEMO_MATCH_ID='tm_31b5b240e7876ae208743610'
node scripts/capture-landing-product-demo.mjs
node scripts/render-landing-product-demo.mjs
```

공개 화면 캡처에는 로그인이 필요 없다. 인증 상태까지 재현하려면 `BOXTIER_DEMO_EMAIL`과 `BOXTIER_DEMO_PASSWORD`를 함께 지정한다. 운영 외 환경이면 `BOXTIER_BASE_URL`을 지정한다. 모든 장면은 `BOXTIER_DEMO_MATCH_ID` 하나만 사용하며 스크립트가 실제 `5v5` 표시를 확인한 뒤 녹화를 시작한다. 렌더 전에 사용자 제공 감열지를 `/assets/showcase/landing-product-demo-receipt.png`에 둔다. 캡처 원본과 장면 시각은 `tmp/landing-product-demo/`에 생성된다. Edge/Chrome 자동 탐색이 실패하면 `BOXTIER_BROWSER_PATH`에 실행 파일 절대 경로를 지정한다. 렌더에는 `ffmpeg`, 검증에는 `ffprobe`가 필요하다.

## 권장 HTML

```html
<video
  autoplay
  muted
  loop
  playsinline
  preload="metadata"
  poster="/assets/showcase/landing-product-demo-poster.webp"
  aria-label="BoxTier 모바일 경기 운영 데모"
>
  <source src="/assets/showcase/landing-product-demo.webm" type="video/webm" />
  <source src="/assets/showcase/landing-product-demo.mp4" type="video/mp4" />
</video>
```

`muted`와 `playsinline`은 모바일 자동재생에 필요하다. 장식용이면 `aria-hidden="true"`를 사용하고 `aria-label`을 제거한다.
