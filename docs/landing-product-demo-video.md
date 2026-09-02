# 랜딩 제품 데모 영상

## 산출물

- WebM: `/assets/showcase/landing-product-demo.webm`
- MP4 fallback: `/assets/showcase/landing-product-demo.mp4`
- poster: `/assets/showcase/landing-product-demo-poster.webp`
- 감열지 원본 캡처: `/assets/showcase/landing-product-demo-receipt.png`
- 규격: 1080×1920, 9:16, 30fps, 약 30초, 무음

## 사실 범위

모든 제품 화면은 현재 저장소 프런트엔드를 production 모드로 실행하고, 인증된 운영 테스트 계정의 읽기 전용 경기 데이터를 연결해 540×960 모바일 viewport에서 실제 조작·녹화한다. AI 생성 화면과 연습 경기는 사용하지 않는다.

- 방 만들기: `/app/create?intent=record`의 실제 `경기 기록 만들기` 폼. 불필요한 운영 데이터를 만들지 않도록 폼 조작까지만 녹화한다.
- 출석·팀 배정: 운영 테스트 계정의 실제 2v2 경기방 `m_mshmjm2k_lvd25`. 공유 경기 상태를 바꾸지 않도록 실제 버튼 위치에 탭 안내만 표시한다.
- 모바일 결과판·종료 결과: 종료·확정된 실제 5v5 기록방 `tm_31b5b240e7876ae208743610`. 캡처 시점에 진행 중인 테스트 경기가 없어 경기 중 전광판 조작을 꾸미지 않고, 실제 기록방의 최종 결과를 읽기 전용으로 녹화한다.
- 영수증 진입: 종료된 실제 5v5 기록방 `tm_31b5b240e7876ae208743610`의 `영수증 발급` 버튼.
- 감열지 결과: 위 기록방이 연 실제 `/app/receipt?match=...` 화면. 최종 1:0과 일치하도록 `1Q 0:0 · 2Q 1:0 · 3Q 0:0 · 4Q 0:0`을 입력한 제품 감열지 미리보기.

영상의 단계 설명과 `여기 탭` 표시는 캡처 스크립트가 실제 페이지 위에 그리는 녹화 전용 오버레이다. 출석과 팀 배정 구간의 리플은 클릭 위치 안내이며 운영 데이터 변경을 일으키는 클릭을 실행하지 않는다. 앱 CSS·제품 데이터·버튼 동작은 대체하지 않는다. 영수증 PNG도 별도 제작물이 아니라 제품의 `감열지 영수증 미리보기` 요소를 직접 캡처한 파일이다.

## 타임라인

| 구간 | 단계 설명 | 실제 화면·조작 |
| --- | --- | --- |
| 0.0–4.3초 | 경기 기록방 만들기 | 기록방 폼에서 `5v5` 선택, 실제 생성 버튼 확인 |
| 4.1–8.9초 | QR 출석 · 참가 확인 | 실제 참가자 `출석` 버튼 위치 안내, 운영 상태 변경 없음 |
| 8.7–12.5초 | 참가자 · 팀 구성 | 실제 `완전 랜덤 배치` 버튼 위치 안내, 운영 상태 변경 없음 |
| 12.3–18.1초 | 모바일 전광판 · 경기 결과 | 종료된 실제 5v5 기록방의 최종 점수 확인 |
| 17.9–21.3초 | 경기 종료 · 결과 확인 | 종료·확정된 실제 경기 결과 확인 |
| 21.1–24.2초 | 기록방에서 영수증 만들기 | 실제 5v5 기록방의 `영수증 발급` 탭 |
| 24.0–30.1초 | 4쿼터 감열지 영수증 | 1Q–4Q 입력과 감열지 미리보기, 마지막 결과 약 5초 유지 |

장면 사이는 220ms 크로스페이드로 연결한다. 사용자 흐름을 읽을 수 있도록 기존 17초 편집보다 느리게 구성했다.

## 재현

```powershell
$env:BOXTIER_DEMO_EMAIL='<운영 테스트 계정 이메일>'
$env:BOXTIER_DEMO_PASSWORD='<운영 테스트 계정 비밀번호>'
node scripts/capture-landing-product-demo.mjs
node scripts/render-landing-product-demo.mjs
```

운영 외 환경이면 `BOXTIER_BASE_URL`을 지정한다. 경기 ID를 교체할 때는 `BOXTIER_LIVE_MATCH_ID`, `BOXTIER_RESULT_MATCH_ID`, `BOXTIER_RECEIPT_MATCH_ID`를 지정한다. 캡처 원본과 장면 시각은 `tmp/landing-product-demo/`에 생성된다. Edge/Chrome 자동 탐색이 실패하면 `BOXTIER_BROWSER_PATH`에 실행 파일 절대 경로를 지정한다. 렌더에는 `ffmpeg`와 `ffprobe`가 필요하다.

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
