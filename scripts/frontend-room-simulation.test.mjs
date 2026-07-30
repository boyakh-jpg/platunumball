import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acceptRecruitingInvitation,
  blockUser,
  checkInMatchPlayer,
  confirmRecruitingMatch,
  createRecruitingPost,
  endMatch,
  finalizeMatchByAuthority,
  incrementMatchScore,
  interestRecruitingPost,
  inviteRecruitingPlayers,
  inviteRecruitingReferee,
  reportPlayer,
  runAutomaticStateMaintenance,
  setRecruitingRoomTeam,
  setRecruitingTeamPartyRoster,
  startMatch,
  submitMatchResult,
} from "../src/data/repository.js";
import { demoFlowState } from "../src/lib/demoFlowState.js";
import {
  PRACTICE_SELF_ID,
  PRACTICE_TEAM_A_ID,
  PRACTICE_TEAM_B_ID,
  approvePracticeDummyPlayers,
  completePracticeAttendance,
  confirmPracticeRecruitingRoom,
  createPracticeMatchRecord,
  createPracticeRecruitingRoom,
  createPracticeState,
  runPracticeReducer,
  submitPracticeSampleResult,
} from "../src/lib/practiceMatch.js";
import { getRecruitingLobby } from "../src/lib/recruiting.js";
import { getLocalRivalries } from "../src/lib/season.js";

const MODE_CAPACITY = Object.freeze({
  "1v1": 1,
  "2v2": 2,
  "3v3": 3,
  "5v5": 5,
});

function apply(state, actionName, args, actorId, message = actionName) {
  const result = runPracticeReducer(state, actionName, args, actorId);
  assert.equal(result.applied, true, `${message}: ${result.error}`);
  return result.state;
}

function asActor(state, actorId) {
  return { ...state, currentUserId: actorId };
}

function acceptActualInvitation(state, postId, targetUserId, role = "player") {
  const invitation = state.recruitingPosts
    .find((post) => post.id === postId)
    ?.roomState?.invitations
    ?.find((item) => item.targetUserId === targetUserId && item.role === role && item.status === "pending");
  assert.ok(invitation, `${postId}: ${targetUserId} ${role} 초대`);
  return acceptRecruitingInvitation(asActor(state, targetUserId), postId, invitation.id);
}

function runActualMatchLifecycle({ visibility, teamOnly, referee }) {
  const hostId = "u1";
  const refereeId = "u11";
  const postId = `actual-${visibility}-${teamOnly ? "team" : "player"}-${referee ? "referee" : "no-referee"}`;
  let state = {
    ...structuredClone(demoFlowState),
    currentUserId: hostId,
    matches: [],
    recruitingPosts: [],
    notifications: [],
    reports: [],
    settings: { ...structuredClone(demoFlowState.settings), blockedUserIds: [] },
  };
  state = createRecruitingPost(state, {
    id: postId,
    title: postId,
    visibility,
    timingType: "instant",
    hostJoinMode: teamOnly ? "team" : "player",
    teamOnly,
    mode: "2v2",
    sideCapacity: 2,
    benchCapacity: 0,
    ranked: false,
    formationMode: "prearranged",
    matchPurpose: "friendly",
    gameClockEnabled: true,
    qrAttendanceEnabled: false,
    periodCount: 2,
    periodMinutes: 1,
    overtimeMinutes: 1,
    shotClockSeconds: 24,
    refereeWanted: referee,
    court: "실제 프론트 시뮬레이션 코트",
    meetingPoint: "1번 코트 입구",
  });

  if (teamOnly) {
    state = setRecruitingRoomTeam(asActor(state, hostId), postId, "teamA", "t1");
    if (visibility === "private") {
      state = setRecruitingRoomTeam(asActor(state, hostId), postId, "teamB", "t2", "상대 팀 초대");
      state = acceptActualInvitation(state, postId, "u6");
    } else {
      state = interestRecruitingPost(asActor(state, "u6"), postId, {
        joinMode: "team",
        teamId: "t2",
        side: "teamB",
      });
    }
    for (const entry of getRecruitingLobby(
      state.recruitingPosts.find((post) => post.id === postId),
      state,
    ).entries.filter((item) => item.kind === "team")) {
      const teamA = entry.team.id === "t1";
      state = setRecruitingTeamPartyRoster(
        asActor(state, teamA ? hostId : "u6"),
        postId,
        entry.id,
        { playerIds: teamA ? [hostId, "u2"] : ["u6", "u7"], reservePlayerIds: [] },
      );
    }
  } else {
    for (const [side, playerIds] of [["teamA", ["u2"]], ["teamB", ["u6", "u7"]]]) {
      state = inviteRecruitingPlayers(asActor(state, hostId), postId, {
        side,
        playerIds,
        joinMode: "player",
      });
      for (const playerId of playerIds) state = acceptActualInvitation(state, postId, playerId);
    }
  }

  if (referee) {
    state = inviteRecruitingReferee(asActor(state, hostId), postId, refereeId);
    state = acceptActualInvitation(state, postId, refereeId, "referee");
  }
  state = confirmRecruitingMatch(asActor(state, hostId), postId);
  let match = state.matches[0];
  assert.ok(match?.id, `${postId}: 경기 확정`);
  assert.equal(match.refereeId ?? "", referee ? refereeId : "", `${postId}: 심판 배정`);

  const operatorId = referee ? refereeId : hostId;
  const unauthorizedId = referee ? hostId : "u6";
  for (const sideName of ["teamA", "teamB"]) {
    for (const playerId of match[sideName].players) {
      state = checkInMatchPlayer(asActor(state, operatorId), match.id, sideName, playerId);
    }
  }
  match = state.matches[0];
  assert.ok(match.attendance.teamA.includes(hostId), `${postId}: 방장 출석`);
  state = startMatch(asActor(state, unauthorizedId), match.id);
  assert.equal(state.matches[0].startedAt, undefined, `${postId}: 비운영자 시작 차단`);
  state = startMatch(asActor(state, operatorId), match.id);
  match = state.matches[0];
  assert.ok(match.startedAt, `${postId}: 경기 시작`);

  const scoreOptions = referee ? {} : { clockController: true };
  state = incrementMatchScore(asActor(state, unauthorizedId), match.id, 1, 0, {
    expectedRevisionA: 0,
  });
  assert.equal(state.matches[0].result, null, `${postId}: 비운영자 점수 차단`);
  state = incrementMatchScore(asActor(state, operatorId), match.id, 2, 0, {
    ...scoreOptions,
    expectedRevisionA: 0,
  });
  state = incrementMatchScore(asActor(state, operatorId), match.id, 0, 2, {
    ...scoreOptions,
    expectedRevisionB: 0,
  });
  if (!referee) {
    state = incrementMatchScore(asActor(state, operatorId), match.id, 1, 0, {
      ...scoreOptions,
      expectedRevisionA: 1,
    });
  }
  state = endMatch(asActor(state, unauthorizedId), match.id);
  assert.equal(state.matches[0].endedAt, undefined, `${postId}: 비운영자 종료 차단`);
  state = endMatch(asActor(state, operatorId), match.id);
  match = state.matches[0];
  assert.ok(match.endedAt, `${postId}: 경기 종료`);

  if (referee) {
    const playerStats = Object.fromEntries(
      [...match.teamA.players, ...match.teamB.players].map((playerId) => [
        playerId,
        {
          points: playerId === hostId ? 3 : playerId === "u6" ? 2 : 0,
          rebounds: 0,
          assists: 0,
          steals: 0,
          blocks: 0,
          turnovers: 0,
          fouls: 0,
        },
      ]),
    );
    state = submitMatchResult(asActor(state, refereeId), match.id, {
      scoreA: 3,
      scoreB: 2,
      playerStats,
    });
    match = state.matches[0];
    assert.equal(match.status, "approval", `${postId}: 심판 기록 제출`);
  }
  const submittedBy = match.result.submittedBy;
  state = submitMatchResult(asActor(state, unauthorizedId), match.id, {
    scoreA: 9,
    scoreB: 9,
    playerStats: {},
  });
  match = state.matches[0];
  assert.equal(match.result.submittedBy, submittedBy, `${postId}: 비운영자 기록 제출 차단`);
  assert.deepEqual(
    [match.teamA.score, match.teamB.score],
    [3, 2],
    `${postId}: 점수 반영`,
  );

  const finalizeOptions = {
    disputesAcknowledged: true,
    now: new Date(new Date(match.result.submittedAt).getTime() + (4 * 60 * 1000)).toISOString(),
  };
  state = finalizeMatchByAuthority(asActor(state, unauthorizedId), match.id, finalizeOptions);
  assert.notEqual(state.matches[0].status, "confirmed", `${postId}: 비운영자 최종 확정 차단`);
  state = finalizeMatchByAuthority(asActor(state, operatorId), match.id, finalizeOptions);
  match = state.matches[0];
  assert.equal(match.status, "confirmed", `${postId}: 최종 확정`);
  assert.ok(match.confirmedAt, `${postId}: 확정 시각`);
}

function acceptPendingInvitations(state, postId) {
  let next = state;
  const invitations = next.recruitingPosts
    .find((post) => post.id === postId)
    ?.roomState?.invitations
    ?.filter((invitation) => invitation.status === "pending") ?? [];
  invitations.forEach((invitation) => {
    next = apply(
      next,
      "acceptRecruitingInvitation",
      [postId, invitation.id],
      invitation.targetUserId,
      `초대 수락 ${invitation.targetUserId}`,
    );
  });
  return next;
}

function confirmRoom(state, postId) {
  const confirmed = confirmPracticeRecruitingRoom(state, postId);
  assert.ok(confirmed.matchId, "방 확정");
  return confirmed;
}

function runIndividualRoom({ mode, benchCapacity, referee }) {
  let state = createPracticeState({}, { name: "프론트 시뮬 방장" });
  const refereeId = referee
    ? state.users.find((user) => user.officialReferee === true)?.id
    : "";
  const created = createPracticeRecruitingRoom(state, {
    title: `${mode} 후보 ${benchCapacity} 심판 ${referee ? "있음" : "없음"}`,
    mode,
    sideCapacity: MODE_CAPACITY[mode],
    benchCapacity,
    refereeWanted: referee,
    refereeId,
    formationMode: "prearranged",
    rules: {
      formationMode: "prearranged",
      matchPurpose: "friendly",
      gameClockEnabled: false,
      benchCapacity,
    },
  });
  assert.ok(created.postId);
  state = acceptPendingInvitations(created.state, created.postId);
  const confirmed = confirmRoom(state, created.postId);
  state = completePracticeAttendance(confirmed.state, confirmed.matchId);
  const managerId = refereeId || PRACTICE_SELF_ID;
  state = apply(state, "startMatch", [confirmed.matchId], managerId, "경기 시작");
  state = submitPracticeSampleResult(state, confirmed.matchId);
  state = approvePracticeDummyPlayers(state, confirmed.matchId);
  const match = state.matches.find((item) => item.id === confirmed.matchId);
  assert.ok(match.endedAt);
  assert.equal(match.teamA.players.length, MODE_CAPACITY[mode]);
  assert.equal(match.teamB.players.length, MODE_CAPACITY[mode]);
  assert.equal(match.reservePlayers.teamA.length, benchCapacity);
  assert.equal(match.reservePlayers.teamB.length, benchCapacity);
  assert.equal(match.refereeId || "", refereeId || "");
  assert.equal(match.status, "confirmed");
}

function getTeamMemberIds(state, teamId) {
  return state.teams
    .find((team) => team.id === teamId)
    ?.members.map((member) => member.userId) ?? [];
}

function runTeamRoom({ mode, benchCapacity, referee }) {
  let state = createPracticeState({}, { name: "프론트 시뮬 방장" });
  const refereeId = referee
    ? state.users.find((user) => user.officialReferee === true)?.id
    : "";
  const created = createPracticeRecruitingRoom(state, {
    title: `${mode} 팀전 후보 ${benchCapacity} 심판 ${referee ? "있음" : "없음"}`,
    mode,
    sideCapacity: MODE_CAPACITY[mode],
    benchCapacity,
    refereeWanted: referee,
    refereeId,
    hostJoinMode: "team",
    formationMode: "prearranged",
    rules: { formationMode: "prearranged", matchPurpose: "friendly", gameClockEnabled: false },
  });
  assert.ok(created.postId);
  state = apply(created.state, "setRecruitingRoomTeam", [
    created.postId,
    "teamA",
    PRACTICE_TEAM_A_ID,
  ], PRACTICE_SELF_ID, "A팀 선택");
  state = apply(state, "setRecruitingRoomTeam", [
    created.postId,
    "teamB",
    PRACTICE_TEAM_B_ID,
  ], PRACTICE_SELF_ID, "B팀 초대");
  state = acceptPendingInvitations(state, created.postId);

  const capacity = MODE_CAPACITY[mode];
  const teamAIds = getTeamMemberIds(state, PRACTICE_TEAM_A_ID);
  const teamBIds = getTeamMemberIds(state, PRACTICE_TEAM_B_ID);
  const lobby = getRecruitingLobby(
    state.recruitingPosts.find((post) => post.id === created.postId),
    state,
  );
  const teamAEntry = lobby.entries.find((entry) => entry.team?.id === PRACTICE_TEAM_A_ID);
  const teamBEntry = lobby.entries.find((entry) => entry.team?.id === PRACTICE_TEAM_B_ID);
  assert.ok(teamAEntry?.id);
  assert.ok(teamBEntry?.id);

  state = apply(state, "setRecruitingTeamPartyRoster", [
    created.postId,
    teamAEntry.id,
    {
      playerIds: teamAIds.slice(0, capacity),
      reservePlayerIds: teamAIds.slice(capacity, capacity + benchCapacity),
    },
  ], teamAIds[0], "A팀장 명단 확정");
  state = apply(state, "setRecruitingTeamPartyRoster", [
    created.postId,
    teamBEntry.id,
    {
      playerIds: teamBIds.slice(0, capacity),
      reservePlayerIds: teamBIds.slice(capacity, capacity + benchCapacity),
    },
  ], teamBIds[0], "B팀장 명단 확정");

  const confirmed = confirmRoom(state, created.postId);
  state = completePracticeAttendance(confirmed.state, confirmed.matchId);
  const managerId = refereeId || PRACTICE_SELF_ID;
  state = apply(state, "startMatch", [confirmed.matchId], managerId, "팀전 경기 시작");
  state = submitPracticeSampleResult(state, confirmed.matchId);
  state = approvePracticeDummyPlayers(state, confirmed.matchId);
  const match = state.matches.find((item) => item.id === confirmed.matchId);
  assert.equal(match.teamA.teamId, PRACTICE_TEAM_A_ID);
  assert.equal(match.teamB.teamId, PRACTICE_TEAM_B_ID);
  assert.equal(match.teamA.players.length, capacity);
  assert.equal(match.teamB.players.length, capacity);
  assert.equal(match.reservePlayers.teamA.length, benchCapacity);
  assert.equal(match.reservePlayers.teamB.length, benchCapacity);
  assert.equal(match.refereeId || "", refereeId || "");
  assert.ok(match.endedAt);
  assert.equal(match.status, "confirmed");
}

function runPickupRoom({
  mode,
  benchCapacity,
  referee,
  assignmentMode,
  rotationMode,
}) {
  let state = createPracticeState({}, { name: "프론트 시뮬 방장" });
  const refereeId = referee
    ? state.users.find((user) => user.officialReferee === true)?.id
    : "";
  const created = createPracticeRecruitingRoom(state, {
    title: `${mode} 픽업 후보 ${benchCapacity}`,
    mode,
    sideCapacity: MODE_CAPACITY[mode],
    benchCapacity,
    refereeWanted: referee,
    refereeId,
    formationMode: "pickup",
    matchIntent: "pickup",
    rules: {
      formationMode: "pickup",
      matchIntent: "pickup",
      matchPurpose: "friendly",
      gameClockEnabled: false,
      benchCapacity,
    },
  });
  assert.ok(created.postId);
  state = acceptPendingInvitations(created.state, created.postId);
  const confirmed = confirmRoom(state, created.postId);
  state = completePracticeAttendance(confirmed.state, confirmed.matchId);
  const managerId = refereeId || PRACTICE_SELF_ID;
  state = apply(
    state,
    "generatePickupSideAssignment",
    [confirmed.matchId, assignmentMode],
    managerId,
    `${assignmentMode} 픽업 배정`,
  );

  const draftMatch = state.matches.find((item) => item.id === confirmed.matchId);
  const firstPlayerId = draftMatch.teamA.players[0];
  const secondPlayerId = draftMatch.teamB.players[0];
  state = apply(
    state,
    "swapPickupMatchPlayers",
    [confirmed.matchId, firstPlayerId, secondPlayerId],
    managerId,
    "픽업 A/B 교환",
  );
  state = apply(
    state,
    "confirmPickupSideAssignment",
    [confirmed.matchId, {
      rotationMode,
      rotationIntervalMinutes: rotationMode === "interval" ? 3 : undefined,
    }],
    managerId,
    `${rotationMode} 교대 확정`,
  );
  state = apply(state, "startMatch", [confirmed.matchId], managerId, "픽업 경기 시작");
  state = submitPracticeSampleResult(state, confirmed.matchId);
  state = approvePracticeDummyPlayers(state, confirmed.matchId);

  const match = state.matches.find((item) => item.id === confirmed.matchId);
  assert.equal(match.rules.pickupTeamAssignmentMode, assignmentMode);
  assert.equal(match.rules.sideAssignmentStatus, "confirmed");
  assert.equal(match.rules.rotationMode, rotationMode);
  assert.equal(match.teamA.players.length, MODE_CAPACITY[mode]);
  assert.equal(match.teamB.players.length, MODE_CAPACITY[mode]);
  assert.equal(match.reservePlayers.teamA.length, benchCapacity);
  assert.equal(match.reservePlayers.teamB.length, benchCapacity);
  assert.equal(match.refereeId || "", refereeId || "");
  assert.ok(match.endedAt);
  assert.equal(match.status, "confirmed");
}

function getPastKstSchedule() {
  const date = new Date(Date.now() - 60_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return {
    scheduledDate: `${parts.year}-${parts.month}-${parts.day}`,
    scheduledTime: `${parts.hour}:${parts.minute}`,
  };
}

function approveRecordParticipants(state, matchId) {
  let next = state;
  for (const sideName of ["teamA", "teamB"]) {
    const playerIds = next.matches
      .find((match) => match.id === matchId)
      ?.rules?.recordApproverIds?.[sideName] ?? [];
    playerIds.forEach((playerId) => {
      next = apply(next, "approveMatch", [matchId, sideName, playerId], playerId, `${playerId} 기록 승인`);
    });
  }
  return next;
}

function runMatchRecord(composition, mode) {
  let state = createPracticeState({}, { name: "프론트 시뮬 방장" });
  const sideCapacity = MODE_CAPACITY[mode];
  const created = createPracticeMatchRecord(state, {
    title: `${mode} ${composition} 사후 경기기록`,
    mode,
    sideCapacity,
    recordComposition: composition,
    ...getPastKstSchedule(),
  });
  assert.ok(created.matchId, created.error);
  state = created.state;

  if (composition === "individual") {
    const playerIds = state.users
      .filter((user) => user.officialReferee !== true)
      .map((user) => user.id)
      .slice(0, sideCapacity * 2);
    state = apply(state, "setMatchRecordParticipants", [created.matchId, {
      composition,
      teamAPlayerIds: playerIds.slice(0, sideCapacity),
      teamBPlayerIds: playerIds.slice(sideCapacity, sideCapacity * 2),
    }], PRACTICE_SELF_ID, "개인 구성 참가자 확정");
  } else {
    state = apply(state, "setMatchRecordParticipants", [created.matchId, {
      composition,
      teamAId: PRACTICE_TEAM_A_ID,
      teamBId: PRACTICE_TEAM_B_ID,
    }], PRACTICE_SELF_ID, "팀 구성 선택");
    const teamAIds = getTeamMemberIds(state, PRACTICE_TEAM_A_ID);
    const teamBIds = getTeamMemberIds(state, PRACTICE_TEAM_B_ID);
    state = apply(state, "setMatchRecordTeamRoster", [
      created.matchId,
      "teamA",
      {
        playerIds: teamAIds.slice(0, sideCapacity),
        reservePlayerIds: teamAIds.slice(sideCapacity, sideCapacity + 3),
      },
    ], teamAIds[0], "A팀 사후 명단 확정");
    state = apply(state, "setMatchRecordTeamRoster", [
      created.matchId,
      "teamB",
      {
        playerIds: teamBIds.slice(0, sideCapacity),
        reservePlayerIds: teamBIds.slice(sideCapacity, sideCapacity + 3),
      },
    ], teamBIds[0], "B팀 사후 명단 확정");
  }

  state = apply(state, "submitMatchResult", [
    created.matchId,
    { scoreA: 21, scoreB: 17, playerStats: {} },
  ], PRACTICE_SELF_ID, "사후 점수 입력");
  state = approveRecordParticipants(state, created.matchId);
  const submittedAtMs = Date.parse(
    state.matches.find((match) => match.id === created.matchId).result.submittedAt,
  );
  state = runAutomaticStateMaintenance(state, new Date(submittedAtMs + 24 * 60 * 60 * 1000));
  const match = state.matches.find((item) => item.id === created.matchId);
  assert.equal(match.status, "confirmed");
  assert.equal(match.practiceMode, true);
  assert.equal(match.ranked, false);
  if (composition === "team") {
    assert.equal(match.reservePlayers.teamA.length, 3);
    assert.equal(match.reservePlayers.teamB.length, 3);
  }
}

test("프론트 연습방은 인원·후보·심판 조합을 실제 초대 대상 ID로 끝까지 진행한다", () => {
  for (const mode of Object.keys(MODE_CAPACITY)) {
    for (let benchCapacity = 0; benchCapacity <= 3; benchCapacity += 1) {
      for (const referee of [false, true]) {
        runIndividualRoom({ mode, benchCapacity, referee });
      }
    }
  }
});

test("프론트 팀전 연습방은 양 팀 선택·팀장 초대·출전/후보 명단을 실제 ID로 확정한다", () => {
  for (const mode of Object.keys(MODE_CAPACITY)) {
    for (let benchCapacity = 0; benchCapacity <= 3; benchCapacity += 1) {
      for (const referee of [false, true]) {
        runTeamRoom({ mode, benchCapacity, referee });
      }
    }
  }
});

test("프론트 픽업 연습방은 모든 인원·후보·심판·배정·교대 조합을 직렬 진행한다", () => {
  for (const mode of Object.keys(MODE_CAPACITY)) {
    for (let benchCapacity = 0; benchCapacity <= 3; benchCapacity += 1) {
      for (const referee of [false, true]) {
        for (const assignmentMode of ["manual", "random", "mmr_balanced"]) {
          for (const rotationMode of ["manual", "period", "interval"]) {
            runPickupRoom({
              mode,
              benchCapacity,
              referee,
              assignmentMode,
              rotationMode,
            });
          }
        }
      }
    }
  }
});

test("프론트 사후 경기기록은 모든 인원의 개인·팀 구성과 후보 3명·전원 자기 승인을 진행한다", () => {
  for (const mode of Object.keys(MODE_CAPACITY)) {
    runMatchRecord("individual", mode);
    runMatchRecord("team", mode);
  }
});

test("시즌 라이벌은 내 팀이 포함된 지역 매치업만 반환한다", () => {
  const teams = [
    { id: PRACTICE_TEAM_A_ID, name: "내 팀", region: "마포", mmr: 1200, wins: 1 },
    { id: PRACTICE_TEAM_B_ID, name: "상대 팀", region: "마포", mmr: 1250, wins: 1 },
    { id: "practice-team-c", name: "다른 팀", region: "광진", mmr: 1300, wins: 1 },
  ];
  const rivalries = getLocalRivalries(teams, [], "광진", 10, [PRACTICE_TEAM_A_ID]);
  assert.ok(rivalries.length);
  assert.ok(rivalries.every((pair) => (
    pair.teamA.id === PRACTICE_TEAM_A_ID || pair.teamB.id === PRACTICE_TEAM_A_ID
  )));
  assert.ok(rivalries.every((pair) => pair.teamA.region === pair.teamB.region));
});

test("시즌 라이벌 팀 선택은 빈 팀방 생성 뒤 비공개 B팀만 초대한다", () => {
  const fixture = structuredClone(demoFlowState);
  const hostId = fixture.currentUserId;
  const ownTeam = fixture.teams.find((team) => team.members?.some((member) => member.userId === hostId));
  const opponentTeam = fixture.teams.find((team) => team.id !== ownTeam?.id && team.region === ownTeam?.region);
  assert.ok(ownTeam?.id);
  assert.ok(opponentTeam?.id);

  for (const visibility of ["private", "public"]) {
    const postId = `demo-rival-${visibility}`;
    let state = createRecruitingPost({
      ...structuredClone(fixture),
      currentUserId: hostId,
      recruitingPosts: [],
      notifications: [],
    }, {
      id: postId,
      title: `라이벌 ${visibility}`,
      visibility,
      timingType: "instant",
      hostJoinMode: "team",
      teamOnly: true,
      mode: "3v3",
      sideCapacity: 3,
      benchCapacity: 1,
      ranked: false,
      formationMode: "prearranged",
      matchPurpose: "friendly",
      gameClockEnabled: false,
      court: "연습 코트",
      meetingPoint: "1번 코트 입구",
      teamId: "",
      targetTeamId: "",
      playerIds: [],
    });
    const emptyRoom = state.recruitingPosts.find((post) => post.id === postId);
    assert.equal(emptyRoom.teamId, null);
    assert.equal(emptyRoom.targetTeamId, null);

    state = setRecruitingRoomTeam(state, postId, "teamA", ownTeam.id);
    assert.equal(state.recruitingPosts.find((post) => post.id === postId).teamId, ownTeam.id);
    const afterB = setRecruitingRoomTeam(state, postId, "teamB", opponentTeam.id, "시즌 라이벌 초대");
    const room = afterB.recruitingPosts.find((post) => post.id === postId);
    assert.equal(room.targetTeamId, visibility === "private" ? opponentTeam.id : null);
    assert.equal(
      room.roomState.invitations.some((invitation) => invitation.teamId === opponentTeam.id),
      visibility === "private",
    );
  }
});

test("실제 매칭방은 공개·비공개와 개인·팀 구성을 모두 생성하고 초대·신고·차단을 처리한다", () => {
  const initial = structuredClone(demoFlowState);
  const hostId = initial.currentUserId;
  const targetId = initial.users.find((user) => user.id !== hostId && !user.anonymous)?.id;
  let state = {
    ...initial,
    notifications: [],
    reports: [],
    recruitingPosts: [],
    settings: { ...(initial.settings ?? {}), blockedUserIds: [] },
  };
  const variants = [
    { visibility: "public", hostJoinMode: "player" },
    { visibility: "private", hostJoinMode: "player", invitePlayerIds: [targetId] },
    { visibility: "public", hostJoinMode: "team", teamOnly: true },
    { visibility: "private", hostJoinMode: "team", teamOnly: true },
  ];

  variants.forEach((variant, index) => {
    state = createRecruitingPost(state, {
      ...variant,
      title: `actual-room-${index}`,
      mode: "2v2",
      sideCapacity: 2,
      benchCapacity: 1,
      timingType: "instant",
      ranked: false,
      formationMode: "prearranged",
      matchPurpose: "friendly",
      gameClockEnabled: false,
      court: "한강 노을코트",
      meetingPoint: "1번 코트 입구",
    });
  });

  assert.equal(state.recruitingPosts.length, 4);
  variants.forEach((variant, index) => {
    const room = state.recruitingPosts.find((post) => post.title === `actual-room-${index}`);
    assert.equal(room.visibility, variant.visibility);
    assert.equal(room.hostJoinMode, variant.hostJoinMode);
    assert.equal(room.teamOnly, variant.hostJoinMode === "team");
  });

  const privatePlayerRoom = state.recruitingPosts.find((post) => post.title === "actual-room-1");
  assert.ok(privatePlayerRoom.roomState.invitations.some((invitation) => invitation.targetUserId === targetId));
  state = blockUser({ ...state, currentUserId: targetId }, hostId);
  assert.equal(
    state.recruitingPosts.find((post) => post.id === privatePlayerRoom.id)
      .roomState.invitations.some((invitation) => invitation.targetUserId === targetId),
    false,
  );

  const reportMatchId = "actual-room-report-match";
  state = reportPlayer({
    ...state,
    matches: [{
      id: reportMatchId,
      title: "실제 경기방 신고 확인",
      createdBy: hostId,
      endedAt: new Date().toISOString(),
      teamA: { players: [hostId] },
      teamB: { players: [targetId] },
    }],
  }, hostId, reportMatchId, "프론트 신고 확인");
  assert.ok(state.reports.some((report) => report.type === "player" && report.targetId === hostId && report.by === targetId));
});

test("실제 경기방 8조합은 초대부터 출석·기록·최종 확정까지 완료된다", () => {
  for (const visibility of ["public", "private"]) {
    for (const teamOnly of [false, true]) {
      for (const referee of [false, true]) {
        runActualMatchLifecycle({ visibility, teamOnly, referee });
      }
    }
  }
});

test("실제 경기시계 프론트는 샷클락·다음 쿼터·연장·통합 종료 액션을 유지한다", async () => {
  const [panelSource, viewSource, serverSource] = await Promise.all([
    readFile(new URL("../src/components/match/MatchClockPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchClockPanelView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../server/api/matches/clock.js", import.meta.url), "utf8"),
  ]);
  for (const action of ["start", "resetShot", "endPeriod", "startPeriod", "startOvertime", "endClock"]) {
    assert.match(viewSource, new RegExp(`"${action}"`), `경기시계 ${action} UI`);
    assert.match(serverSource, new RegExp(`"${action}"`), `경기시계 ${action} API 허용`);
  }
  assert.match(panelSource, /const requestMatchEnd = async/);
  assert.match(panelSource, /const response = await onEndMatch\(\)/);
  assert.match(viewSource, /경기·시계 종료/);
});

test("분리된 방 렌더 모듈은 런타임 의존성을 명시적으로 전달한다", async () => {
  const [source, pickerSource, dependenciesSource, managementSource] = await Promise.all([
    readFile(
      new URL("../src/components/recruiting/RecruitingRoomCommandPanels.jsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/recruiting/RecruitingRoomPickerCore.jsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/recruiting/RecruitingRoomDependencies.js", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/recruiting/RecruitingRoomManagementSection.jsx", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(
    source,
    /import \{[\s\S]*getPartyOptionKey,[\s\S]*getPartyOptionLabel,[\s\S]*isPartyEntry,[\s\S]*\} from "\.\/RecruitingRoomSlotCore\.jsx";/,
  );
  assert.match(
    pickerSource,
    /import \{[\s\S]*getPlayerPosition,[\s\S]*\} from "\.\/RecruitingRoomSlotCore\.jsx";/,
  );
  assert.match(
    dependenciesSource,
    /import MatchClockPanel, \{[\s\S]*MatchScoreControls,[\s\S]*\} from "\.\.\/match\/MatchClockPanel\.jsx";/,
  );
  assert.match(
    dependenciesSource,
    /RECRUITING_ROOM_DEPENDENCIES = \{[\s\S]*MatchClockPanel, MatchScoreControls,/,
  );
  assert.match(
    managementSource,
    /MatchClockPanel, MatchScoreControls,/,
  );
});
