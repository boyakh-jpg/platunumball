# 랜딩 제품 데모 영상

## 산출물

- WebM: `/assets/showcase/landing-product-demo.webm`
- MP4 fallback: `/assets/showcase/landing-product-demo.mp4`
- poster: `/assets/showcase/landing-product-demo-poster.webp`
- 규격: 1080×1920, 9:16, 30fps, 510프레임(약 17초), 무음

## 사실 범위

모든 장면은 현재 앱을 540×960 모바일 viewport에서 실제 조작해 녹화한다.

- QR 출석, 참가 확인, 팀 배정, 실시간 전광판, 종료·결과 확정: `/app/guide/practice`의 비저장 연습 경기
- 전적, Gold 티어, MMR: `/app`의 확정 데모 전적
- 영수증: 홈 `내 최근 전적`의 첫 완료 경기 링크에서 경기 ID를 읽어 `/app/receipt?match=...`로 연 실제 검증 감열지 영수증

캡처 스크립트는 `개인전 → 현장 픽업 → 3v3 → 1분 → 단일 경기`를 만들고, 화면의 최소 인정시간을 실제로 채운 뒤 5:2에서 정상 `경기 종료`와 결과 확정을 수행한다. 이 무심판 연습 흐름에는 개인 PTS 기록 입력이 없으므로 꾸며 넣지 않았다. 개인 기록 구간은 홈의 실제 확정 전적 요약을 사용한다.

주요 조작은 클릭 전에 실제 버튼 경계와 `여기 탭` 안내를 보여주고, 클릭 순간에는 실제 버튼 중심 또는 실제 포인터 좌표에 탭 리플을 그린다. 영수증 구간도 실제 `감열지 영수증` 버튼 선택을 보여준다. 모두 녹화 전용 오버레이라 앱 CSS와 동작은 바꾸지 않는다. 장면 사이는 180ms 크로스페이드로 연결하며, 총 510프레임을 유지한다.

확정 데모 경기는 5v5 쿼터 규칙을 사용하고, `result.periodScores`의 `1Q`~`4Q` 점수 합계가 최종 점수와 정확히 일치한다. 감열지 화면은 제품의 실제 미리보기 renderer가 이 canonical 데이터를 출력한 결과다.

연습 경기는 전적·MMR을 갱신하지 않는다. 편집본의 전적·티어·영수증은 연습 경기의 저장 결과가 아니라 별도 확정 데모 경기다.

## 타임라인

| 구간 | 실제 화면 |
| --- | --- |
| 0.0–2.5초 | QR 출석, `연습 선수 출석 완료` 탭, 참가 확인 |
| 2.4–4.6초 | `완전 랜덤 배치` 탭, 팀 배정 |
| 4.4–8.9초 | `+3`, `+2`, `+2` 탭과 실시간 전광판 |
| 8.7–12.2초 | `경기 종료`, 결과 최종 확정 탭 |
| 12.0–13.1초 | 최근 전적·티어 |
| 12.9–14.1초 | `감열지 영수증` 탭 |
| 13.9–17.0초 | 쿼터 점수가 포함된 실제 검증 감열지 영수증 |

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
