# 랜딩 제품 데모 영상

## 산출물

- WebM: `/assets/showcase/landing-product-demo.webm`
- MP4 fallback: `/assets/showcase/landing-product-demo.mp4`
- poster: `/assets/showcase/landing-product-demo-poster.webp`
- 사용자 제공 감열지: `/assets/showcase/landing-product-demo-receipt.png`
- 목표 규격: 1080×1920, 9:16, 30fps, 약 37초, 무음

현재 WebM·MP4·poster는 이전 캡처에 2v2 장면이 섞여 있어 사용 금지다. 아래 조건으로 새 원본을 녹화한 뒤 다시 렌더해야 한다.

## 사실 범위

모든 제품 화면은 현재 저장소 프런트엔드를 production 모드로 실행하고, 인증된 운영 테스트 계정의 읽기 전용 경기 데이터를 연결해 540×960 모바일 viewport에서 실제 조작·녹화한다. AI 생성 화면과 연습 경기는 사용하지 않는다.

- 방 만들기: `/app/create?intent=record`의 실제 `경기 기록 만들기` 폼. 불필요한 운영 데이터를 만들지 않도록 폼 조작까지만 녹화한다.
- 출석·팀 구성·모바일 전광판 안내·종료 결과: 모두 동일한 실제 5v5 기록방 `tm_31b5b240e7876ae208743610`. 다른 경기나 2v2 화면을 섞지 않는다.
- 영수증 진입: 같은 기록방 모달의 실제 `영수증 발급` 버튼을 누르고 `/app/receipt?match=tm_31b5b240e7876ae208743610`로 이동한다.
- 캡처 시점에 이 기록은 종료·확정 상태다. QR 출석과 전광판은 기록방에 실제 표시되는 운영 안내만 읽기 전용으로 보여주며, 진행 중 화면이나 조작을 꾸미지 않는다.
- 감열지 결과: 사용자가 제공한 완성 이미지. 최종 `1:0`, `1Q 0:0 · 2Q 1:0 · 3Q 0:0 · 4Q 0:0`을 표시한다.

영상의 단계 설명과 `여기 탭` 표시는 캡처 스크립트가 실제 페이지 위에 그리는 녹화 전용 오버레이다. 설명 상자는 단색으로 두고 왼쪽 주황색 강조선은 사용하지 않는다. 읽기 전용 구간의 리플은 위치 안내이며 운영 데이터 변경을 일으키는 클릭을 실행하지 않는다. `영수증 발급`만 실제 버튼을 클릭한다. 앱 CSS·제품 데이터·버튼 동작은 대체하지 않는다. 마지막 영수증 PNG는 사용자가 제공한 완성본이며 캡처 스크립트가 덮어쓰지 않는다.

## 타임라인

| 구간 | 단계 설명 | 실제 화면·조작 |
| --- | --- | --- |
| 0.0–4.8초 | 경기 기록방 만들기 | 실제 기록방 폼에서 `5v5` 선택, 생성 버튼 위치 확인 |
| 4.6–10.4초 | QR 출석 · 참가 확인 | 같은 5v5 기록방의 QR 출석 기준과 참가 명단 확인 |
| 10.2–15.6초 | 참가 확인 · 팀 구성 | 같은 기록방의 실제 HOME TEAM과 상대 팀 구성 확인 |
| 15.3–21.9초 | 모바일 전광판 · 점수 기록 | 같은 기록방의 실제 모바일 전광판 운영 안내 확인 |
| 21.7–26.5초 | 경기 종료 · 결과 확인 | 같은 기록방의 최종 점수와 확정 기록 확인 |
| 26.3–30.9초 | 기록방에서 영수증 만들기 | 기록방 모달의 실제 `영수증 발급` 버튼 클릭 |
| 30.7–36.9초 | 4쿼터 감열지 영수증 | 사용자 제공 감열지 완성본, 마지막 결과 약 6초 유지 |

장면 사이는 220ms 크로스페이드로 연결한다. 각 단계 설명과 클릭 위치를 읽을 수 있도록 약 36초로 구성한다.

## 재현

```powershell
$env:BOXTIER_DEMO_EMAIL='<운영 테스트 계정 이메일>'
$env:BOXTIER_DEMO_PASSWORD='<운영 테스트 계정 비밀번호>'
$env:BOXTIER_DEMO_MATCH_ID='tm_31b5b240e7876ae208743610'
node scripts/capture-landing-product-demo.mjs
node scripts/render-landing-product-demo.mjs
```

운영 외 환경이면 `BOXTIER_BASE_URL`을 지정한다. 모든 장면은 `BOXTIER_DEMO_MATCH_ID` 하나만 사용하며 스크립트가 실제 `5v5` 표시를 확인한 뒤 녹화를 시작한다. 렌더 전에 사용자 제공 감열지를 `/assets/showcase/landing-product-demo-receipt.png`에 둔다. 캡처 원본과 장면 시각은 `tmp/landing-product-demo/`에 생성된다. Edge/Chrome 자동 탐색이 실패하면 `BOXTIER_BROWSER_PATH`에 실행 파일 절대 경로를 지정한다. 렌더에는 `ffmpeg`와 `ffprobe`가 필요하다.

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
