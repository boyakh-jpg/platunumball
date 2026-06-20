# RankBall 로직/명칭 기준

## 현재 앱 구조

| 화면 | 라우트 | 역할 |
| --- | --- | --- |
| 홈 | `/app` | 검색, 즉시 처리할 액션 큐, 초대/동의/승인 알림 진입점 |
| 경기 만들기 | `/app/create` | 비공개방, 공개방, 대회 생성 진입점 |
| 경기 | `/app/matches` | 내 진행 일정, 달력, 예정/진행/종료 경기 확인 |
| 경기방 | `/app/matches/:matchId` | 실제 경기 계약, 결과, 승인, 이의 제기 |
| 진행 | `/app/recorder` | 심판/기록자용 활성 경기 기록 입력 |
| 대기 매칭 | `/app/recruiting` | 공개/비공개 방 목록, 방 모달, 초대, 파티, READY/CONFIRM |
| 팀 | `/app/teams` | 내 팀 관리, 팀 랭킹, 팀 삭제/멤버 관리 |
| 대회 | `/app/tournaments/:tournamentId` | 리그/토너먼트 승인, 일정, 대진표 |
| 나 | `/app/profile` | 내 프로필, 즐겨찾기, 기록 더보기 진입점 |

데이터는 아직 `mockData` / `localStorage` / Supabase 혼합 구조다. 지금 단계에서는 `repository.js`가 실제 도메인 로직의 중심이고, Supabase는 normalized table과 `rankball_state`를 같이 다룬다.

## 고정할 화면 용어

| 표기 | 뜻 | 쓰면 안 되는 혼동 |
| --- | --- | --- |
| 팀 | 실제 소속 팀/클럽. 예: Noeul Kings | 방의 A/B 편을 팀이라고 부르지 않기 |
| 파티 | 같은 실제 팀 소속으로 한 방에 묶여 들어온 참가 묶음 | 실제 팀 자체와 동일시하지 않기 |
| 사이드 | 한 경기방 안의 A/B 진영 | `teamA`, `teamB`를 화면에서 그대로 팀처럼 말하지 않기 |
| A사이드/B사이드 | 방 안의 출전 진영 | 홈/어웨이와 섞지 않기 |
| 출전 슬롯 | 실제 경기 뛰는 자리 | 후보와 합산해서 정원 표시하지 않기 |
| 후보 슬롯 | 경기 밖 대기 자리. 최대 2명 | 후보팀, 충원팀 같은 표현 금지 |
| 자동 충원 | 출전 슬롯이 비면 READY 후보가 자동으로 출전 계산에 들어가는 상태 | 선수가 팀/파티를 잃은 것처럼 보이면 안 됨 |
| 방장 | 방 생성자. 공개방에서만 노란 왕관 | 실제 팀 주장과 동일시하지 않기 |
| 주장 | 실제 팀의 captain. 비공개 팀대팀방에서만 보조 왕관 | 방장 권한과 섞지 않기 |
| 심판 | 신뢰도 기준을 넘은 외부 기록 권한자 | 팀 기록자와 동시 우선권 주지 않기 |
| 기록자 | 심판이 없을 때 기록을 맡는 후보/참가자 | 후보라고 기록 불가로 제한하지 않기 |
| WAIT | 아직 동의/준비/재확인 필요 | 동의 대기, 대기 전 등 혼용 금지 |
| READY | 현재 룰에 동의하고 준비 완료 | 경기 후 승인과 섞지 않기 |
| CONFIRM | 룰 변경 후 다시 확정하는 동작 | READY와 같은 버튼명으로 쓰지 않기 |

## 슬롯 표시 우선순위

슬롯 뱃지는 항상 코드에서 아래 순서를 지킨다. 화면마다 따로 판단하지 않는다.

| 우선순위 | 표시 | 조건 | 색 |
| --- | --- | --- | --- |
| 1 | 방장 | 방 생성자 `ownerId`/`roomState.ownerId`/`playerId`와 같은 선수 | 노란 왕관 |
| 2 | 파티장 | `roomState.partyLeaders[entry.id]` 또는 entry 대표 선수 | 파란 왕관 |
| 3 | 팀 주장 | 비공개 팀전에서 실제 팀 `captain`인 선수 | 파란 왕관 |

방장과 파티장/팀주장이 겹치면 방장 표시만 쓴다. 공개방에서는 방장 표시가 기본이고, 비공개 팀전에서는 방장과 파티장을 함께 구분한다.

## UI 기본 원칙

| 항목 | 기준 |
| --- | --- |
| 버튼 | 주요 동작 1개만 강한 색, 보조 동작은 `secondary`, 위험 동작은 빨간 테두리 |
| 슬롯 | 출전/후보 동일 너비, 상태 변화가 슬롯 크기를 바꾸면 안 됨 |
| 간격 | 카드 내부 `10~14px`, 슬롯 간격은 CSS 변수 `--room-slot-gap` 사용 |
| 뱃지 | 상태/방식/경기종류 순서 유지, 같은 정보 중복 표기 금지 |
| 모바일 | 가로 스크롤 금지, 필요 없는 요약 정보는 숨기고 방 보기에서 확인 |
| 라이트 모드 | 작은 박스는 배경 차이를 둬야 하고, 투명 배경만으로 구분하지 않기 |

## 내부 코드명 매핑

| 현재 코드명 | 실제 의미 | 향후 이름 |
| --- | --- | --- |
| `recruitingPost` | 매칭방/대기방 초안 | `queueRoom` |
| `applicants` | 방 참가 엔트리 목록 | `entries` |
| `teamA`, `teamB` | A/B 사이드 | `sideA`, `sideB` |
| `teamId` | 실제 팀 ID | `realTeamId` |
| `kind: "team"` | 팀으로 만든 파티 엔트리 | `kind: "party"` |
| `kind: "player"` | 개인 엔트리 | 유지 |
| `reserve` | 후보 슬롯 여부 | `candidate` |
| `fillSlots` | 후보 자동 충원 계산 결과 | `autoFilledCandidates` |
| `hostJoinMode` | 방장 참가 방식 | `hostEntryMode` |
| `sourceTeamId` | 파티에서 나온 개인의 원래 팀 | `originTeamId` |
| `sourceEntryId` | 파티에서 나온 개인의 원래 파티 | `originPartyId` |

지금 바로 대규모 rename은 하지 않는다. `repository.js` 전면 개편 금지 조건 때문에 문서 기준만 먼저 고정한다.

## 방 생성 로직

`/app/create`에서 `visibility`로 분기한다.

| 값 | 생성 함수 | 결과 |
| --- | --- | --- |
| `private` | `createMatch` | 실제 `match`가 바로 생성되고 `status: "contract"`로 시작 |
| `public` | `createRecruitingPost` | 공개 매칭방이 생성되고 `/app/recruiting`에 노출 |
| `tournament` | `createTournament` | 대회가 생성되고 초대한 팀 승인 후 경기 일정 생성 |

공개방과 비공개방은 화면과 모달을 분리하지 않는 방향으로 간다. 차이는 노출 범위와 초대/참여 방식뿐이다.

## 매칭방 핵심 로직

현재 중심 파일:

- `src/lib/recruiting.js`
- `src/data/repository.js`
- `src/pages/Recruiting.jsx`
- `src/pages/Matches.jsx`

방은 `getRecruitingLobby(post, state)`로 화면용 구조로 정규화된다.

| lobby 필드 | 의미 |
| --- | --- |
| `entries` | 방에 들어온 개인/파티 엔트리 |
| `sides.teamA/teamB` | A/B 사이드 |
| `projectedPlayers` | 실제 출전으로 계산되는 선수 |
| `reserveCandidates` | 후보 슬롯 선수 |
| `fillSlots` | 출전 슬롯이 비어 자동 충원되는 후보 |
| `canConfirm` | 방장이 매치 확정 가능한지 |

## 참여/초대/파티 로직

| 동작 | 함수 | 기준 |
| --- | --- | --- |
| 개인/팀 참여 | `interestRecruitingPost` | 방에 entry 추가 |
| 초대 보내기 | `inviteRecruitingPlayers` | 방 참가자만 초대 가능해야 함 |
| 초대 수락 | `acceptRecruitingInvitation` | 빈 슬롯이 있으면 입장, 넘치면 실패 처리 |
| 초대 거절 | `declineRecruitingInvitation` | 초대만 제거 |
| 같은 팀 파티 합류 | `joinRecruitingSideParty` | 같은 사이드에 같은 실제 팀원이 있을 때 묶음 |
| 파티에서 개인으로 분리 | `detachRecruitingPartyPlayer` | 원래 팀/파티 출처는 유지 |
| 파티 멤버 출전/후보 이동 | `setRecruitingPartyPlayerPlacement` | 같은 파티 안에서 슬롯 이동 |
| 개인 출전/후보 이동 | `setRecruitingApplicantPlacement` | 개인 entry 슬롯 이동 |
| 참가 취소 | `cancelRecruitingParticipation` | 내 entry 제거 |
| 강퇴 | `kickRecruitingApplicant`, `removeRecruitingPartyPlayer` | 방장 권한 |

파티는 MMR 반영 단위다. 같은 실제 팀원이 같은 사이드에서 같이 뛰면 파티로 묶일 수 있어야 한다. 다른 사이드로 옮기려면 파티를 먼저 나가 개인 entry가 되는 방식이 맞다.

## 후보/기록자 로직

후보는 팀별로 줄을 나누는 게 아니라 A/B 후보 슬롯으로 통일한다. 각 사이드 후보는 최대 2명이다.

현재 상태 필드:

| 필드 | 의미 |
| --- | --- |
| `roomState.partyReserves` | 파티 엔트리 안에서 후보로 빠진 선수 |
| `roomState.pinnedReservePlayers` | 자동 충원하지 않고 후보로 고정한 선수 |
| `roomState.reserveReady` | 후보의 READY 상태 |
| `match.reservePlayers` | 확정된 경기의 후보 명단 |
| `match.promotedReserveIds` | 후보에서 자동 충원된 선수 |
| `match.statRecorders` | 심판 없을 때 기록 권한 |

심판이 있으면 심판 우선이다. 심판이 없으면 후보/기록자 로직을 쓴다. 후보는 실제 선수이므로 기록자를 맡아도 개인 기록은 유지되어야 한다.

## READY/CONFIRM/확정 로직

| 단계 | 의미 |
| --- | --- |
| WAIT | 현재 룰에 아직 동의하지 않음 |
| READY | 현재 룰에 동의함 |
| 룰 수정 | `updateRecruitingRoomRules`가 `ruleRevision`을 올리고 참가자 상태를 다시 WAIT로 돌림 |
| CONFIRM | 룰 변경 후 참가자가 다시 동의하는 버튼 |
| 매치 확정 | `confirmRecruitingMatch`가 실제 `match`를 만들고 방 초대장을 제거 |

방장은 룰을 수정한 당사자라 다시 CONFIRM할 필요가 없다. 후보는 재확인하지 않으면 확정 시 자동 취소되는 방향이 맞다.

## 실제 경기 로직

`match.status`가 경기 진행 단계를 결정한다.

| status | 화면 의미 | 주요 함수 |
| --- | --- | --- |
| `contract` | 경기 전 동의 필요 | `agreeMatch` |
| `agreed` | 예정/진행 가능 | `submitMatchResult` |
| `approval` | 결과 승인 필요 | `approveMatch`, `disputeMatch` |
| `disputed` | 이의신청 중 | `resumeMatchApproval`, `voidMatch` |
| `confirmed` | 기록 확정 | `finalizeMatch` 내부 처리 |
| `cancelled` | 취소 | `cancelMatch` |
| `void` | 무효 | `voidMatch` |

경기 후 24시간이 지나면 동의/승인 누락은 자동 처리된다. 진행 메뉴는 결과 확정 후 24시간까지만 보여주고, 이후는 기록 페이지에서 봐야 한다.

## 기록 입력 로직

중심 파일:

- `src/pages/Recorder.jsx`
- `submitMatchResult`
- `handoffMatchRecorder`

우선순위:

1. 심판이 있으면 심판만 전체 기록 가능
2. 심판이 없으면 사이드별 기록자/후보 기록자 사용
3. 기록자 교체는 `handoffMatchRecorder`로 넘김
4. 선수와 기록자가 교체되면 기존 기록은 선수 기준으로 유지하고 기록 권한만 이동

개인 활약은 득점만 필수가 아니다. 후보 기록자가 리바운드/어시스트/블락/파울까지 입력하면 반영한다. 파울은 평균 파울과 신뢰도 패널티에 연결한다.

## 팀 로직

`팀`은 실제 소속 단위다.

| 로직 | 함수 |
| --- | --- |
| 팀 생성 | `createTeam` |
| 팀 삭제 | `deleteTeam` |
| 팀원 추가 | `addTeamMember` |
| 역할 변경 | `updateTeamMemberRole` |
| 팀원 제거 | `removeTeamMember` |
| 랭킹 | 팀 MMR 기준 |

한 유저가 가질 수 있는 팀은 3개 제한으로 간다. 방 안에서의 A/B 사이드는 팀이 아니다.

## 대회 로직

| 동작 | 함수 |
| --- | --- |
| 대회 생성 | `createTournament` |
| 팀 승인 | `approveTournamentTeam` |
| 일정 입력 | `updateTournamentMatchSchedule` |
| 리그 대진 생성 | `buildLeaguePairings` |
| 토너먼트 대진 생성 | `buildTournamentPairings` |
| 토너먼트 브라켓 표시 | `TournamentDetail.jsx` |

대회는 공개 매칭방과 다른 흐름이다. 초대한 팀 주장이 승인하면 시작 가능하고, 대회 경기는 MMR 반영을 더 유리하게 가져간다.

## 지금 실제로 쓰는 로직

- `getRecruitingLobby`: 방 모달과 경기 메뉴 preview의 기준.
- `RoomSidePanel`, `SideRoster`, `ReserveLine`, `SlotCommandPanel`: 현재 방 모달 슬롯 UI.
- `RoomKickPanel`: 강퇴 전용 패널.
- `RoomChat`: 방 채팅.
- `InvitePanel`, `InvitationList`: 방 초대.
- `QueueRoomBoard`: 매칭 목록 카드의 인원 요약.
- `joinRecruitingSideParty`: 같은 사이드 실제 팀원끼리 파티 합류.
- `detachRecruitingPartyPlayer`: 파티 나가기.
- `setRecruitingPartyPlayerPlacement`: 파티 멤버 출전/후보 이동.
- `confirmRecruitingMatch`: 방을 실제 경기로 전환.
- `applyAutomaticMatchDecisions`: 24시간 지난 동의/승인 자동 처리.
- `applyExpiredRecruitingRooms`: 제한시간 지난 방 취소.

## 이번에 제거한 죽은 로직

아래 로직은 렌더링되지 않는 옛 방장관리 UI라 제거했다.

| 제거 | 이유 |
| --- | --- |
| `EntryBlock` | 현재 슬롯형 모달에서 사용 안 함 |
| `HostRoomControls` | 방장관리 메뉴를 따로 두지 않는 방향과 충돌 |
| `SlotActionMenu` | 옛 드롭다운 슬롯 조작 UI |
| `PlacementActionButtons` | 옛 A/B/후보 이동 버튼 묶음 |
| `getEntryPlacementAvailability` | 위 컴포넌트 전용 계산 함수 |
| `stopControlClick` | 위 컴포넌트 제거 후 미사용 |
| `ow-party-block`, `ow-slot-action-menu`, `ow-host-control-*` CSS | 제거한 UI 전용 스타일 |
| `ow-open-slot` CSS | 현재 빈 슬롯은 `ow-room-player-slot empty`로 통일 |

## 지워도 되는 후보

바로 지우기 전 마지막 확인이 필요하다.

| 후보 | 이유 | 조건 |
| --- | --- | --- |
| `setRecruitingApplicantReserve` | 현재 화면에서 직접 호출 없음 | 개인 후보 이동을 전부 `setRecruitingApplicantPlacement`로 통일 확인 후 삭제 |
| `setRecruitingStatRecorder` | 수동 기록자 지정 UI가 사라짐 | 후보 자동 기록자 정책 확정 후 삭제 |
| `RECRUITING_TYPES`의 `need_player/find_team/need_team` 라벨 | 현재 방 개념과 안 맞음 | 데이터 마이그레이션 없이 `roomType`으로 alias 처리 후 삭제 |
| `legacyCreateRecruitingPost` | 이전 데이터 호환용 | 실제 저장 데이터에 legacy shape가 더 없을 때 삭제 |
| `legacyInterestRecruitingPost` | 이전 데이터 호환용 | 위와 동일 |

## 지우면 안 되는 로직

| 로직 | 이유 |
| --- | --- |
| `partyReserves` | 파티 멤버 후보 이동에 필요 |
| `pinnedReservePlayers` | 후보 고정/자동 충원 분리에 필요 |
| `reserveReady` | 후보 재확인에 필요 |
| `sourceTeamId`, `sourceEntryId` | 파티에서 나온 개인이 원래 팀을 기억해야 함 |
| `playerTeams` | 팀 MMR 반영 비율 계산에 필요 |
| `promotedReserveIds` | 후보 자동 충원 기록에 필요 |
| `hostPenalties`, `kickLog` | 방장 잠수/강퇴 남발 신뢰도 로직에 필요 |
| `recruitingPostId` | 매칭방에서 생성된 경기 추적에 필요 |

## 앞으로 고정할 명칭 규칙

1. 화면에서 `팀`은 실제 팀만 뜻한다.
2. 방의 A/B는 `A사이드`, `B사이드`로 부른다.
3. 방 안 묶음은 `파티`로 부른다.
4. 후보는 항상 `후보 슬롯`이다. `후보팀` 금지.
5. `동의`, `대기 완료`, `참여 확인`은 `WAIT`, `READY`, `CONFIRM`으로 통일한다.
6. 공개방/비공개방은 같은 방 모달을 쓴다.
7. 경기방과 매칭방을 별도 UI처럼 만들지 않는다. 단계만 다르게 보여준다.
8. 방장은 사람 배치 권한보다 초대/강퇴/룰수정 권한 중심이다.
9. 같은 실제 팀원이 같은 사이드에 있으면 파티 합류를 제안한다.
10. 다른 사이드로 가려면 파티에서 나가 개인 entry가 되어야 한다.

## 코드 정리 순서

1. 화면 문구부터 위 용어로 통일.
2. `teamA/teamB` 화면 노출을 `A사이드/B사이드`로 치환.
3. `recruitingPost`는 내부에서만 유지하고 화면/문서에서는 `방`으로 표기.
4. 수동 기록자 지정 로직 제거 여부 확정.
5. legacy recruiting type alias 정리.
6. 마지막에 schema/DB rename 검토.
