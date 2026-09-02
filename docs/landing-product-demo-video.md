# 랜딩 제품 데모 영상

## 산출물

- WebM: `/assets/showcase/landing-product-demo.webm`
- MP4 fallback: `/assets/showcase/landing-product-demo.mp4`
- poster: `/assets/showcase/landing-product-demo-poster.webp`
- 사용자 제공 감열지: `/assets/showcase/landing-product-demo-receipt.png`
- 규격: 1080×1920, 9:16, 30fps, 약 60초, 무음

## 사실 범위

모든 제품 화면은 `boxtier.kr`의 공개 운영 화면과 읽기 전용 경기 데이터를 540×960 모바일 viewport에서 실제 조작·녹화한다. AI 생성 화면과 연습 경기는 사용하지 않는다.

- 방 만들기: `/app/create?intent=match`의 실제 공개 매칭방 생성 폼. `경쟁전`·`개인전`·`5v5`와 실제 MMR 허용구간을 확인하되 불필요한 운영 데이터를 만들지 않도록 생성은 실행하지 않는다.
- 티어 매칭: 공개 경쟁 개인방이 실력 허용구간 안에서 참가자를 모집하는 실제 폼을 보여준다. MMR은 `실력이 비슷한 상대를 찾고 순위를 계산하는 경기력 점수`로 설명하며 상세 산식은 노출하지 않는다.
- 지역 매칭: `/app/recruiting`의 실제 `시도`·`시군구` 필터를 조작한다. 지역은 자동 배정이 아니라 가까운 코트의 공개방을 찾는 검색 조건으로 설명한다.
- 출석·팀 구성·모바일 전광판 안내·종료 결과: 모두 동일한 실제 5v5 기록방 `tm_31b5b240e7876ae208743610`. 다른 경기나 2v2 화면을 섞지 않는다.
- 티어 변화: `/app/rankings`의 실제 전국 통합 MMR 랭크보드를 보여준다. 확정된 경쟁전 결과를 서버가 계산해 통합·경기 방식별 MMR과 티어에 반영한다. 현재 비어 있는 5v5 랭크보드는 꾸미지 않는다.
- 영수증 진입: 같은 기록방 모달의 실제 `영수증 발급` 버튼을 누른다. 공개 비로그인 캡처에서는 실제 로그인 게이트가 호출되며, 편집본은 게이트가 나타나기 전에 사용자 제공 감열지로 전환한다. 테스트 계정 환경 변수를 지정하면 인증 후 영수증 경로로 진입한다.
- 캡처 시점에 이 기록은 종료·확정 상태다. QR 출석과 전광판은 기록방에 실제 표시되는 운영 안내만 읽기 전용으로 보여주며, 진행 중 화면이나 조작을 꾸미지 않는다.
- 감열지 결과: 사용자가 제공한 완성 이미지. 최종 `1:0`, `1Q 0:0 · 2Q 1:0 · 3Q 0:0 · 4Q 0:0`을 표시한다.

영상의 단계 설명과 `여기 탭` 표시는 캡처 스크립트가 실제 페이지 위에 그리는 녹화 전용 오버레이다. 설명 상자는 단색으로 두고 왼쪽 주황색 강조선은 사용하지 않는다. 읽기 전용 구간의 리플은 위치 안내이며 운영 데이터 변경을 일으키는 클릭을 실행하지 않는다. `영수증 발급`만 실제 버튼을 클릭한다. 앱 CSS·제품 데이터·버튼 동작은 대체하지 않는다. 마지막 영수증 PNG는 사용자가 제공한 완성본이며 캡처 스크립트가 덮어쓰지 않는다.

## 타임라인

| 구간 | 단계 설명 | 실제 화면·조작 |
| --- | --- | --- |
| 0.0–6.8초 | 공개 5v5 경쟁방 만들기 | 실제 공개방 폼에서 `공개 매칭방`과 `5v5` 선택, `경쟁전` 확인 |
| 6.6–12.6초 | 티어에 맞는 상대 모집 | 실제 `SILVER 3 ~ GOLD 2` MMR 허용구간 확인 |
| 12.4–18.4초 | 지역별 공개방 찾기 | 실제 공개 매칭 목록에서 `부산광역시`·`중구` 필터 조작 |
| 18.1–24.5초 | 경기 20분 전 QR 체크인 | 같은 5v5 기록방의 실제 QR 출석 기준 확인 |
| 24.3–30.0초 | 5v5 참가 확인 · 팀 구성 | 같은 기록방의 실제 출전·후보와 팀 구성 확인 |
| 29.8–36.8초 | 휴대폰이 모바일 전광판 | 4쿼터 경기시계·점수 운영에 사용하는 실제 전광판 안내 확인 |
| 36.6–41.9초 | 경기 종료 · 결과 확인 | 같은 기록방의 최종 점수와 확정 기록 확인 |
| 41.7–48.2초 | 기록이 쌓이면 티어도 변화 | 실제 전국 통합 MMR 랭크보드와 결과 반영 방식 설명 |
| 47.9–52.9초 | 기록방에서 영수증 만들기 | 같은 기록방 모달의 실제 `영수증 발급` 버튼 클릭 |
| 52.7–60.0초 | 4쿼터 감열지 영수증 | 사용자 제공 감열지 완성본, 마지막 결과 약 7초 유지 |

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
