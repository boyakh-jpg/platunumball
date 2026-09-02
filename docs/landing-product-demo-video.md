# 랜딩 제품 데모 영상

## 산출물

- WebM: `/assets/showcase/landing-product-demo.webm`
- MP4 fallback: `/assets/showcase/landing-product-demo.mp4`
- poster: `/assets/showcase/landing-product-demo-poster.webp`
- 규격: 1080×1920, 9:16, 30fps, 360프레임(약 12초), 무음

## 사실 범위

모든 장면은 현재 앱을 540×960 모바일 viewport에서 실제 조작해 녹화한다.

- QR 출석, 참가 확인, 팀 배정, 실시간 전광판, 종료·결과 확정: `/app/guide/practice`의 비저장 연습 경기
- 전적, Gold 티어, MMR: `/app`의 확정 데모 전적
- 영수증: 홈의 첫 확정 경기 링크에서 경기 ID를 읽어 `/app/receipt?match=...`로 연 실제 검증 영수증

캡처 스크립트는 `개인전 → 현장 픽업 → 3v3 → 1분 → 단일 경기`를 만들고, 화면의 최소 인정시간을 실제로 채운 뒤 5:2에서 정상 `경기 종료`와 결과 확정을 수행한다. 이 무심판 연습 흐름에는 개인 PTS 기록 입력이 없으므로 꾸며 넣지 않았다. 개인 기록 구간은 홈의 실제 확정 전적 요약을 사용한다.

연습 경기는 전적·MMR을 갱신하지 않는다. 편집본의 전적·티어·영수증은 연습 경기의 저장 결과가 아니라 별도 확정 데모 경기다.

## 타임라인

| 구간 | 실제 화면 |
| --- | --- |
| 0.0–0.9초 | 연습 경기 QR 출석 |
| 0.9–1.6초 | 참가 확인 완료 |
| 1.6–3.0초 | 무작위 팀 배정 |
| 3.0–5.5초 | 경기시계가 동작하는 모바일 전광판 |
| 5.5–7.0초 | 홈의 최근 전적, Gold 2, 1339 MMR |
| 7.0–8.0초 | 경기 종료 전광판 |
| 8.0–9.0초 | 연습 결과 최종 확정 |
| 9.0–12.0초 | 실제 확정 경기의 검증 영수증 |

## 재현

```powershell
npm run dev -- --port 4176
$env:BOXTIER_BASE_URL='http://127.0.0.1:4176'
node scripts/capture-landing-product-demo.mjs
node scripts/render-landing-product-demo.mjs
```

캡처 원본과 장면 시각은 `tmp/landing-product-demo/`에 생성된다. Edge/Chrome 자동 탐색이 실패하면 `BOXTIER_BROWSER_PATH`에 실행 파일 절대 경로를 지정한다. 렌더에는 `ffmpeg`와 `ffprobe`가 필요하다.

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

`muted`와 `playsinline`은 모바일 자동재생에 필요하다. 장식용이면 접근성 중복을 피하도록 `aria-hidden="true"`를 사용하고 `aria-label`을 제거한다.
