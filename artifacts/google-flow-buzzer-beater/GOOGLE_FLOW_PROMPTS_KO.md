# BOXTIER 야외농구 버저비터 — Google Flow 제작 패키지

## 1. 최종 영상 한 줄

한국 도심의 야간 야외 농구 코트. 림을 정면으로 보는 선수가 마지막 1초에 3점슛을 던진다. 카메라는 즉시 공과 림으로 당겨지고, 공은 첫 림 접촉과 경기 종료 버저 뒤 **슬로모션 없이 실제 시간으로 6초 동안** 안으로 들어갈 듯 밖으로 떨어질 듯 림을 돈다. 거의 멈춘 공이 마지막에 안쪽으로 기울어 들어간다. 관중이 폭발한 뒤 실제 BOXTIER 모바일 전광판 전체화면에서 손가락이 `BOXTIER +3`을 한 번 눌러 `BOXTIER 74 → 77`, `NIGHT OWLS 75`로 갱신한다. 경기 종료 뒤 실제 BOXTIER 홈페이지에서 발급한 감열지 영수증이 빈 코트로 날아와 바닥에 떨어지고, 카메라가 `버저비터 승리 · 마지막 1초, 2점 차 역전승` 문구까지 밀고 들어간다.

## 2. 절대 고정 조건

- 화면비: 세로 `9:16`.
- 권장 출력: `1080 × 1920`, 가능하면 4K 세로 마스터도 생성.
- 프레임레이트: `24fps` 또는 `30fps` 중 프로젝트 전체 하나로 고정.
- 시간 표현: **전 구간 정상 속도**. 슬로모션, 타임 램프, 프레임 홀드, 인위적 시간 정지 금지.
- 장소: 한국 도심 주거지역의 **야외 코트**, 밤. 아스팔트/아크릴 바닥, 철망, 아파트 창문, 높은 야외 조명.
- 실내 체육관, 천장, 목재 마루, 대형 전광판 금지.
- 경기 상황: 4쿼터 종료, 슛 전 `BOXTIER 74 / NIGHT OWLS 75`, 성공 후 `BOXTIER 77 / NIGHT OWLS 75`. 3점슛으로 2점 차 역전승.
- 경기 시계: 공이 림에 처음 닿는 순간 이미 `0.0`이며 종료 버저가 울린다.
- 공: 모든 컷에서 동일한 주황색 8패널 농구공 하나. 검은 이음선은 공 표면에 고정된 채 구와 함께 연속 회전한다. 이음선 생성·삭제·이동·왜곡 금지.
- 골대: 모든 컷에서 같은 투명 백보드, 같은 주황색 림, 같은 흰색 네트.
- 주인공: 검은색 유니폼 `#7`, 얇은 주황색 파이핑. 수비수는 미색 유니폼.
- 브랜드 컬러: 차콜 `#080b0f`, 보조 차콜 `#0c141d`, 오렌지 `#f05a46`, 홈 민트 `#41d7b0`, 원정 골드 `#f2b84b`, 크림 `#f5f1e8`.
- 효과: 실제 스포츠 광고 수준. 과한 네온, 홀로그램, 폭발, 번개, 색종이, SF HUD 금지.

## 3. 전체 러닝타임

| 구간 | 타임코드 | 길이 | 핵심 |
|---|---:|---:|---|
| CUT 01 | 00:00.0–00:01.2 | 1.2초 | 마지막 3점슛 릴리스 |
| CUT 02 | 00:01.2–00:02.2 | 1.0초 | 공의 비행, 첫 림 접촉과 동시에 버저 |
| CUT 03 | 00:02.2–00:05.0 | 2.8초 | 림 회전 전반, 여러 번 미세 접촉 |
| CUT 04 | 00:05.0–00:08.2 | 3.2초 | 림 회전 후반, 거의 정지, 밖으로 떨어질 듯 버팀 |
| CUT 05 | 00:08.2–00:09.0 | 0.8초 | 마지막 바깥 흔들림, 안쪽 낙하, 환호 |
| CUT 06 | 00:09.0–00:10.2 | 1.2초 | 실제 모바일 전광판 전체화면, 손가락으로 +3 한 번 |
| CUT 07 | 00:10.2–00:13.4 | 3.2초 | 빈 코트, 실제 발급 영수증 비행·착지·바닥 줌인 |

`CUT 03 + CUT 04 = 6.0초`. 이 6초가 후킹의 중심이다. 공의 속도만 물리적으로 줄어든다. 영상 시간이나 카메라 시간은 느려지지 않는다.

## 4. 에셋 사용표

모든 경로는 이 문서가 있는 폴더 기준이다.

| 용도 | 시작 이미지 | 중간 이미지 | 종료 이미지 |
|---|---|---|---|
| CUT 01 릴리스 | `assets/01-start-release.png` | — | `assets/01-end-release.png` |
| CUT 02 비행·첫 림 접촉 | `assets/02-start-flight.png` | — | `assets/02-end-first-rim-contact.png` |
| CUT 03 림 회전 전반 | `assets/03-start-rim-orbit-a.png` | — | `assets/03-end-rim-orbit-a.png` |
| CUT 04 림 회전 후반·거의 정지 | `assets/04-start-rim-orbit-b.png` | — | `assets/04-end-near-stop.png` |
| CUT 05 성공·환호 | `assets/05-start-final-tip.png` | — | `assets/05-end-ball-through-net.png` |
| CUT 06 실제 전광판 조작 | `assets/ref-mobile-scoreboard-fullscreen-before-74-75.png` | `assets/ref-mobile-scoreboard-fullscreen-press-plus3.png` | `assets/ref-mobile-scoreboard-fullscreen-after-77-75.png` |
| CUT 07 실제 영수증 엔딩 | `assets/07-start-receipt-airborne-actual.png` | `assets/07-mid-receipt-floor-actual.png` | `assets/07-end-receipt-zoom-actual.png` |

보조 참조:

- 전체 공간 기준: `assets/00-master-outdoor-court.png`
- 손가락 입력 기준: `assets/ref-mobile-scoreboard-fullscreen-press-plus3.png`
- 실제 BOXTIER 발급 영수증 원본: `assets/ref-receipt-buzzer-beater-issued.png`
- 실제 BOXTIER 발급 Story 원본: `assets/ref-receipt-buzzer-beater-issued-story.png`
- 팀 엠블럼: `assets/emblem-boxtier.png`, `assets/emblem-night-owls.png`

인접 컷 경계 이미지는 동일 파일을 복제해 이름만 나눴다. 예: CUT 01 종료 이미지와 CUT 02 시작 이미지는 같은 프레임이다. Flow에서 컷을 따로 생성해도 연결점이 흔들리지 않게 하기 위한 구조다. CUT 07의 세 이미지는 각각 비행 시작, 바닥 착지, 최종 줌인 구도를 고정한다. 세 이미지의 인쇄면 정체성 기준은 반드시 실제 Story 원본을 함께 사용한다.

## 5. 공통 스타일 프롬프트

각 컷 프롬프트 맨 앞에 아래 내용을 붙인다.

```text
Cinematic photorealistic vertical 9:16 premium street-basketball commercial set at a nighttime outdoor basketball court in a Korean residential neighborhood. Maintain exact continuity with the supplied start and end frames: the same transparent backboard, orange rim, white net, painted asphalt court, chain-link fence, apartment windows, floodlight color, crowd wardrobe, black jersey number 7 with thin orange piping, off-white defender, and the same single orange basketball. The ball has a conventional physically correct eight-panel construction. Treat every black channel and seam as a rigid texture permanently attached to the rotating sphere: the seams rotate continuously with the ball and never morph, slide, disappear, multiply, repaint, or jump between frames. Normal real-time motion at 24fps; physically accurate gravity, momentum, rim contact and net response. Handheld sports-camera energy is restrained and believable. Deep charcoal shadows, warm outdoor floodlights, orange brand accents, realistic skin and fabric, no indoor arena.
```

공통 금지 프롬프트:

```text
No slow motion, no speed ramp, no frozen time, no frame hold, no bullet time, no dreamy floating motion, no indoor roof, no wooden gym floor, no giant arena scoreboard, no extra hoop, no extra basketball, no duplicated players, no warped hands, no changing jersey number, no teleporting ball, no impossible rim deformation, no ball passing through solid metal, no net moving before the ball enters, no seam mutation, no changing panel topology, no mirrored seams, no detached seam texture, no confetti, no fireworks, no sci-fi HUD, no hologram, no giant glow, no captions outside the phone or receipt, no logo mutation, no score mutation, no camera collision, no sudden weather change, no daylight.
```

## 6. CUT 01 — 마지막 3점슛 릴리스

### 입력

- 시작: `assets/01-start-release.png`
- 종료: `assets/01-end-release.png`
- 길이: `1.2초`

### Flow 동작 프롬프트

```text
The black-jersey number 7 shooter is already at the peak of a last-second three-point jump shot. His chest, shoulders, hips, toes, face and eyes all point toward the one visible hoop in front of him; he is never facing away from the target. Over exactly 1.2 seconds in normal real time, he extends both arms and releases the single basketball cleanly away from his body and toward that same hoop. His shooting wrist snaps forward into a natural high follow-through while his guide hand separates. The off-white defender reaches late without touching the shooter or ball. The camera starts at chest-to-head height on the shooter's front-left side, preserving the readable shooter-to-ball-to-hoop line of action, then makes a very small upward tilt to keep the ball and fingertips in frame. Keep the hoop visible in the upper-right distance. The packed fence-side crowd holds its breath; nobody celebrates yet. Natural shoe squeak, fabric movement and outdoor crowd tension. End exactly on the supplied end frame with the ball newly separated from the fingertips and the wrist fully flexed. No buzzer yet.
```

### 실패 방지

- 공을 손에서 갑자기 생성하지 않는다.
- 슈터의 몸과 시선 반대편에 림을 배치하지 않는다. 공은 슈터에게서 멀어지며 눈앞의 림으로 날아간다.
- 슈터가 착지하기 전에 컷 종료.
- 수비 접촉, 파울 제스처, 환호 금지.

## 7. CUT 02 — 비행과 경기 종료 버저

### 입력

- 시작: `assets/02-start-flight.png`
- 종료: `assets/02-end-first-rim-contact.png`
- 길이: `1.0초`

### Flow 동작 프롬프트

```text
Continue seamlessly from the release frame. In exactly 1.0 second of normal real-time motion, the single basketball follows a physically plausible high three-point arc away from the facing shooter and toward the same orange rim. During the first 0.35 second, execute a fast optical push-in combined with a controlled pan and tilt from the shooter's follow-through to the ball and hoop. This must feel like a real sports camera rapidly reframing with a lens, not a digital warp, teleport, speed ramp, or slow motion. By 0.35 second, the shooter is out of frame and the ball and rim dominate the image. Settle into the close rim composition of the supplied end frame. Preserve the direction of travel and the continuous eight-panel seam rotation. The crowd collectively inhales but remains quiet. The instant the front-lower edge of the ball makes its first clean metallic contact with the rim, the game-ending buzzer begins sharply and the game clock is understood to be 0.0. Add a faint red-orange reflection from the buzzer indicator on the backboard support only; do not add a floating timer. End at the precise first-rim-contact pose. The ball has not entered the cylinder and the net has not moved.
```

### 실패 방지

- 버저는 림 접촉 전이 아니라 **접촉 순간** 시작.
- 공이 백보드를 먼저 맞지 않는다.
- 첫 접촉에서 바로 득점하지 않는다.
- 네트는 아직 정지.

## 8. CUT 03 — 림 회전 전반 2.8초

### 입력

- 시작: `assets/03-start-rim-orbit-a.png`
- 종료: `assets/03-end-rim-orbit-a.png`
- 길이: `2.8초`

### Flow 동작 프롬프트

```text
This is the first half of the hook. Keep the tight close-up camera locked to the same hoop with only tiny natural handheld breathing. Over exactly 2.8 seconds in normal real time, the basketball rolls and bumps around the circular rim approximately one and a half uneven rotations. It never becomes weightless and never accelerates unnaturally. The ball repeatedly contacts the metal at distinct points: first front-right, then side, then rear, then toward the left-front quadrant. Each contact removes a little energy. The center of the ball alternates just inside and just outside the rim cylinder, making the result genuinely unreadable. The conventional eight-panel seams stay rigidly attached to the ball and reveal continuous, decelerating spin across every contact; never redraw the seam pattern. Give the ball tiny vertical hops of only a few centimeters caused by the rim, followed by immediate gravitational settling. The net remains almost completely untouched because the ball has not crossed inside. The game-ending buzzer sustains briefly, then ends naturally while rim ticks continue. The background crowd stays frozen in anxious body language only in the ordinary human sense: hands near mouths, shoulders tense, eyes following the ball, but everyone still moves subtly in real time. End exactly at the supplied opposite-quadrant frame, where the ball looks more likely to fall out than in.
```

### 물리 체크

- 정상 속도인데 공 자체가 접촉 마찰로 감속한다.
- 림과 공 접점마다 짧은 금속음. 연속적인 볼링공 회전음 금지.
- 공 중심이 림 중심을 가로질러 흔들려야 한다.
- 이 구간 안에서 공이 네트 안쪽으로 내려가지 않는다.

## 9. CUT 04 — 림 회전 후반 3.2초, 최대 답답함

### 입력

- 시작: `assets/04-start-rim-orbit-b.png`
- 종료: `assets/04-end-near-stop.png`
- 길이: `3.2초`

### Flow 동작 프롬프트

```text
This is the maximum-frustration second half of the six-second rim sequence. Keep normal real-time camera motion and normal 24fps playback. The basketball continues from the supplied start frame with very little remaining energy. Across exactly 3.2 seconds, it makes several small, physically plausible micro-contacts around less than one full rim rotation. Each movement becomes shorter: a 20-centimeter roll, a tiny hop, a 10-centimeter roll, then two nearly stationary rocking motions. The ball repeatedly leans toward the outside edge as if it will fall away, recovers by only a few centimeters because of the curved rim and its remaining spin, then creeps toward the far-right/back quadrant. During the final 0.8 second, the ball is almost balanced on the metal: it rocks once toward the court side, once toward the cylinder, and appears to stop with its center slightly outside the hoop. Do not freeze a frame; preserve tiny real-time rotational movement of the same fixed eight-panel seam pattern, micro-vibration and gravity-driven rocking. Even at near-stop, each black channel remains in the physically expected place on the same sphere. The white net remains untouched. The crowd is now nearly silent except for one restrained gasp and outdoor ambience. End exactly on the supplied near-stop frame before any inward drop.
```

### 절대 금지

- 이 컷에서 득점 금지.
- 편집으로 시간을 느리게 보이게 하는 모션 블러 증가 금지.
- 공을 림 위에 접착한 듯 완전히 정지시키지 않는다.
- 림이 휘거나 공이 찌그러지지 않는다.
- 관중 선환호 금지.

## 10. CUT 05 — 마지막 기울기, 성공, 환호

### 입력

- 시작: `assets/05-start-final-tip.png`
- 종료: `assets/05-end-ball-through-net.png`
- 길이: `0.8초`

### Flow 동작 프롬프트

```text
Begin from the near-motionless ball balanced on the far-right/back rim. Continue in normal real time. For the first 0.25 second, the ball makes one final tiny outward rock that strongly suggests a miss. Its remaining backspin then turns the contact point inward by only a few centimeters. Keep the same conventional eight-panel seam layout rigidly attached to the sphere during this last rotation. Gravity takes over. The ball tips decisively into the cylinder and drops cleanly through the white net. The net stretches downward around the single ball and snaps naturally. Only after the ball visibly crosses inside the rim does the crowd erupt with a sudden authentic roar and raised arms. Keep all phones and scoreboards out of this cut. End exactly on the supplied frame with the ball passing downward through the center of the net and the outdoor crowd beginning to celebrate.
```

### 성공 불변 조건

- 마지막 바깥 흔들림을 생략하지 않는다.
- 공이 림 원통 안쪽으로 넘어가기 전 환호 금지.
- 공 이음선과 패널 배치 변경 금지.
- 휴대폰, 점수판, 영수증은 다음 컷에서만 등장.

## 11. CUT 06 — 실제 모바일 전광판 전체화면, 손가락 +3

### 입력

- 시작: `assets/ref-mobile-scoreboard-fullscreen-before-74-75.png`
- 중간 동작 참조: `assets/ref-mobile-scoreboard-fullscreen-press-plus3.png`
- 종료: `assets/ref-mobile-scoreboard-fullscreen-after-77-75.png`
- 엠블럼 참조: `assets/emblem-boxtier.png`, `assets/emblem-night-owls.png`
- 길이: `1.2초`

### Flow 동작 프롬프트

```text
Hard cut after the made basket to the supplied real BOXTIER mobile scoreboard interface captured from an actual phone-sized browser viewport in fullscreen mode. The scoreboard UI itself fills the entire vertical 9:16 picture edge to edge; do not place it inside a decorative mock phone, floating card, split screen, or outdoor composite. Treat both supplied scoreboard frames, all typography, both emblems, controls, colors and spacing as rigid authentic interface textures. At the start, the exact team labels are BOXTIER and NIGHT OWLS, never HOME, AWAY, A or B. The exact score is BOXTIER 74 and NIGHT OWLS 75, with 4Q and 00:00.0 visible.

During the first 0.25 second, a realistic human index finger enters from the lower edge. Match its size, angle and contact position to the supplied press reference. From 0.25 to 0.55 second, the fingertip physically contacts and depresses the BOXTIER +3 control exactly once. Show one subtle tactile button compression, one restrained orange contact ripple confined to that control, and one short electronic confirmation pulse. Never press any NIGHT OWLS control. Never tap twice. From 0.55 to 0.75 second, the BOXTIER number performs one crisp change from 74 to 77 while NIGHT OWLS remains 75. The team names and both emblems remain completely stable. The finger releases and exits downward. Hold the exact supplied final full-screen interface from 0.75 to 1.2 second: BOXTIER 77, NIGHT OWLS 75, 4Q, 00:00.0. No other digit or label appears.
```

### 점수·UI 불변 조건

- 시작: `BOXTIER 74 / NIGHT OWLS 75`.
- 입력: `BOXTIER +3` 한 번만.
- 종료: `BOXTIER 77 / NIGHT OWLS 75`.
- `HOME`, `AWAY`, `A`, `B`, `78`, `76` 금지.
- 실제 캡처의 팀명, 엠블럼, 버튼, 전체화면 구조를 재디자인하지 않는다.
- 화면 바깥의 휴대폰 베젤, 손바닥, 경기장 합성 금지.

## 12. CUT 07 — 실제 발급 영수증 비행, 바닥 착지, 줌인

### 입력

- 시작·비행 구도: `assets/07-start-receipt-airborne-actual.png`
- 중간·바닥 착지 구도: `assets/07-mid-receipt-floor-actual.png`
- 종료·줌인 구도: `assets/07-end-receipt-zoom-actual.png`
- 실제 인쇄면 원본: `assets/ref-receipt-buzzer-beater-issued.png`
- 실제 Story 원본: `assets/ref-receipt-buzzer-beater-issued-story.png`
- 길이: `3.2초`

### 프레임 배치

- `00:10.2–00:11.3`: 시작 이미지처럼 같은 영수증 한 장이 코트 위 바람에 날린다.
- `00:11.3–00:12.2`: 중간 이미지처럼 영수증이 거친 아스팔트에 닿아 완전히 눕는다.
- `00:12.2–00:13.4`: 종이는 움직이지 않고 카메라만 종료 이미지까지 광학적으로 밀고 들어간다.

### Flow 동작 프롬프트

```text
Hard cut from the real mobile scoreboard to the same outdoor court just after the game. The playing area is now empty, while the celebrating spectators remain only beyond the sideline and gradually soften out of focus. Keep the same hoop, chain-link fence, apartment windows and floodlights. Use the supplied airborne, floor and close-up frames to lock the outdoor environment, one-paper silhouette, physical pose, lighting and camera composition. Use the supplied actual BOXTIER Story receipt as the mandatory identity texture. Treat its printed face as one rigid, already-issued thermal-paper texture from the first frame to the last. Never regenerate, rewrite, translate, rearrange or morph its pixels.

From 00:10.2 to 00:11.3, begin exactly on the supplied airborne frame. The exact same cream BOXTIER thermal receipt drifts diagonally in a light natural breeze, starting about 40 centimeters above the asphalt. It flutters twice with physically believable paper flex, rotates less than 90 degrees, loses lift and approaches the exact pose and ground position shown in the supplied floor frame. No hand enters and no second paper appears.

From 00:11.3 to 00:12.2, the lower torn edge touches first and the receipt settles fully flat in the exact supplied floor-frame pose. Hold long enough to clearly register that it has landed. It does not lift, slide or blow away again; only two tiny corners may move a few millimeters in the wind.

From 00:12.2 to 00:13.4, keep the paper completely fixed and perform one smooth low physical camera push-in with a slight downward tilt, not a digital zoom or a paper scale animation. Finish exactly on the supplied close-up frame with a narrow border of rough outdoor asphalt still visible. Keep the actual issued typography stable and legible: BOXTIER 77, NIGHT OWLS 75, FINAL, and the exact Korean comment “버저비터 승리 · 마지막 1초, 2점 차 역전승”. The score and Korean comment are both fully inside frame and tack sharp. Transition the sound from distant fading cheers to quiet outdoor wind, the dry tick of thermal paper touching rough asphalt, then near silence during the final push-in.
```

### 절대 금지

- 영수증을 손으로 줍지 않는다.
- 마지막 프레임에서 종이가 떠 있으면 실패.
- 화면 위 자막으로 문구를 따로 띄우지 않는다.
- 종이 문구가 영상 중 다른 단어로 변형되지 않는다.
- 영수증이 여러 장으로 복제되지 않는다.
- 시작·중간·종료 사이에서 영수증의 방향, 비율, 엠블럼, 점수, 문구가 바뀌면 실패.
- 줌인은 카메라 이동이어야 하며 종이 자체가 커지거나 카메라 쪽으로 떠오르면 실패.

## 13. 실제 BOXTIER 사이트 발급·캡처 재현

영수증 스크립트는 홈페이지 `/`부터 열고 `가입 없이 영수증 만들기`를 눌러 실제 `/app/receipt`로 진입한다. 폼 입력, 엠블럼 업로드, `영수증 발급하기`, Story 저장까지 실제 사이트 UI로 수행한다.

```powershell
$env:BOXTIER_PREVIEW_URL='http://127.0.0.1:4176'
node artifacts/google-flow-buzzer-beater/issue-actual-receipt.mjs
```

실제 연습경기 전광판 전체화면 캡처:

```powershell
$env:BOXTIER_PREVIEW_URL='http://127.0.0.1:4176'
node artifacts/google-flow-buzzer-beater/capture-actual-scoreboard.mjs
```

영상 전용 캡처에서는 실제 전광판 구조 위에 팀명과 엠블럼만 영상 설정값으로 주입한다. 운영 기록이나 운영 DB는 변경하지 않는다.

## 14. 음향 큐시트

| 타임코드 | 음향 |
|---:|---|
| 00:00.0 | 야외 코트 잔향, 신발 마찰, 관중의 낮은 웅성거림 |
| 00:00.4 | 손끝에서 공이 떨어지는 짧은 가죽 마찰음 |
| 00:01.2 | 관중 소리 급격히 낮아지고 집단 숨 들이마심 |
| 00:02.2 | 첫 림 접촉 `clang`과 동시에 경기 종료 버저 시작 |
| 00:02.2–00:05.0 | 버저 잔향, 간헐적 금속 림 접촉음 4–6회 |
| 00:05.0–00:08.2 | 더 작고 드문 림 접촉음, 거의 무음, 한 번의 억눌린 탄식 |
| 00:08.4 | 네트 통과 `swish` |
| 00:08.45 | 관중 환호 폭발 |
| 00:09.25 | 손가락이 `BOXTIER +3`을 누르는 짧은 터치음 |
| 00:09.55 | 74→77 점수 확인음 |
| 00:10.2 | 하드컷과 함께 환호가 멀리 사라지고 야간 바람으로 전환 |
| 00:10.4–00:11.3 | 감열지 펄럭임 2회 |
| 00:11.3 | 종이가 바닥에 닿는 마른 소리 |
| 00:11.3–00:12.2 | 종이가 완전히 눕고 낮은 바람만 유지 |
| 00:12.2–00:13.4 | 카메라 줌인, 멀리서 남은 한 번의 환호 뒤 거의 무음 |

음악은 없어도 된다. 넣는다면 저역 드론만 사용하고, 림 6초 동안 비트를 넣지 않는다. 금속 접촉음과 침묵이 후킹을 만든다.

## 15. 편집 연결 규칙

1. 각 클립은 지정된 시작·종료 이미지를 모두 입력한다.
2. Flow가 생성한 클립의 첫 3프레임과 마지막 3프레임을 확인한다.
3. 경계에서 공 위치, 회전 솔기, 림 위치가 흔들리면 다음 컷 시작 프레임을 바꾸지 말고 해당 컷만 재생성한다.
4. CUT 02→03, CUT 03→04, CUT 04→05는 디졸브 금지. 프레임 일치 하드컷.
5. CUT 05→06은 의도적 하드컷. 득점 직후 실제 모바일 전광판 전체화면으로 전환한다.
6. CUT 06→07은 의도적 하드컷. 점수 확인음과 빈 코트 정적을 대비한다.
7. CUT 07은 새 시작·중간·종료 이미지를 순서대로 사용한다. 최종 영수증은 바닥에 닿은 상태로 `2.1초` 유지하고, 그중 마지막 `1.2초`는 종이를 움직이지 않은 채 카메라만 줌인한다.
8. 림 6초가 길다고 자동 단축하지 않는다. 이 답답함이 후킹이다.

## 16. 생성 실패 시 재시도 문장

### 슬로모션이 생길 때

```text
Regenerate at normal real-time speed. Do not slow the camera, playback, shutter, crowd or environment. The long duration must come only from repeated physically plausible rim contacts and gradual loss of ball energy.
```

### 공이 너무 빨리 들어갈 때

```text
The ball must remain above and in contact with the rim for the entire requested duration. It may alternate inside and outside the cylinder, but it must not cross below the top plane of the rim until CUT 05.
```

### 공이 림 위에서 완전히 얼 때

```text
Do not freeze the frame. Preserve tiny seam rotation, millimeter-scale rocking, gravity-driven micro-slips and subtle real-time crowd movement while the ball nearly stops.
```

### 점수가 틀릴 때

```text
Lock all scoreboard text, emblems and digits to the supplied real fullscreen captures. Before update: BOXTIER 74, NIGHT OWLS 75, 4Q, 00:00.0. After exactly one physical press of the BOXTIER +3 control: BOXTIER 77, NIGHT OWLS 75, 4Q, 00:00.0. Never show HOME, AWAY, A or B. Never press a NIGHT OWLS control. Never register a second tap. No other number or label may appear.
```

### 손가락이 버튼을 빗나가거나 점수가 두 번 오를 때

```text
Use the supplied press frame as a rigid contact map. The index fingertip must land at the center of the BOXTIER +3 control, depress it once, release once, and leave the frame. Register exactly one three-point event: 74 changes directly to 77. No double tap, no intermediate number, no second ripple, and no NIGHT OWLS input.
```

### 영수증 글자가 변할 때

```text
Treat the supplied receipt as a rigid printed texture attached to the paper. Do not regenerate, rewrite, morph or animate any character. Preserve the exact pixels of the receipt face while only the paper pose and lighting change.
```

### 실내로 바뀔 때

```text
This scene is exclusively outdoors at night. Keep open night sky above the court, tall freestanding floodlights, chain-link fence, apartment buildings and asphalt. No ceiling, rafters, arena seats or wooden floor.
```

## 17. 최종 검수표

- [ ] 세로 9:16.
- [ ] 전 컷 야외 야간 코트.
- [ ] 공 하나, 골대 하나.
- [ ] 슈터 검은색 `#7` 유지.
- [ ] 슈터의 얼굴·가슴·발끝이 공을 보내는 같은 골대를 향함.
- [ ] 릴리스 직후 첫 `0.35초` 안에 공과 림으로 빠르게 광학 줌인.
- [ ] 공의 8패널 이음선이 모든 프레임에서 이어지고 공 표면에 고정됨.
- [ ] 첫 림 접촉과 종료 버저가 같은 순간.
- [ ] 림 체류가 실제 시간 6.0초.
- [ ] 슬로모션·타임 램프·프레임 정지 없음.
- [ ] CUT 04 끝까지 득점하지 않음.
- [ ] 마지막 outward rock 뒤 inward tip.
- [ ] 공이 들어간 뒤 환호 시작.
- [ ] 점수 `74–75 → 77–75`, 최종 2점 차.
- [ ] 실제 모바일 전광판 전체화면이며 장식용 폰 목업이 없음.
- [ ] 팀명이 `BOXTIER`, `NIGHT OWLS`이고 양쪽 엠블럼이 유지됨.
- [ ] 손가락이 `BOXTIER +3`만 정확히 한 번 누름.
- [ ] 모바일 화면 `4Q / 00:00.0` 유지.
- [ ] BOXTIER UI는 차콜·오렌지·민트·골드.
- [ ] 경기 종료 뒤 코트가 비어 있음.
- [ ] 영수증이 바람에 날아와 직접 바닥에 착지.
- [ ] 아무도 영수증을 줍지 않음.
- [ ] 마지막은 바닥에 놓인 영수증으로 줌인.
- [ ] 실제 BOXTIER 홈페이지 발급 영수증의 인쇄면이 그대로 유지됨.
- [ ] `버저비터 승리 · 마지막 1초, 2점 차 역전승`이 정확히 읽힘.
