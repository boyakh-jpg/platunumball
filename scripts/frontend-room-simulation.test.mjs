import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  acceptRecruitingInvitation,
  agreeMatch,
  blockUser,
  checkInMatchPlayer,
  confirmRecruitingMatch,
  createMatch,
  createRecruitingPost,
  declineRecruitingInvitation,
  deleteSoloRecord,
  disputeMatch,
  endMatch,
  finalizeMatchByAuthority,
  incrementMatchScore,
  interestRecruitingPost,
  inviteRecruitingPlayers,
  inviteRecruitingReferee,
  reportMatch,
  reportPlayer,
  resolveMatchDispute,
  runAutomaticStateMaintenance,
  setMatchRoomPlayerPlacement,
  setRecruitingRoomTeam,
  setRecruitingTeamPartyRoster,
  startMatch,
  submitMatchResult,
  substituteMatchPlayer,
  unblockUser,
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
import { createPracticeClockClient } from "../src/lib/practiceMatchClock.js";
import { getRecruitingEntryPlacementIds, getRecruitingLobby, isIndividualOnlyRecruitingRoom } from "../src/lib/recruiting.js";
import {
  buildMatchDisputeRequest,
  buildMatchResultSubmission,
  getActualMatchPlayerIds,
  getMatchManualFinalizationStatus,
  getMatchResultRevision,
  getOpenMatchDisputes,
  normalizeTeamScoresDisputeRequest,
} from "../src/lib/matchUtils.js";
import { inferRegionSelection } from "../src/lib/profileSetup.js";
import { getLocalRivalries, getTeamScoreSummary } from "../src/lib/season.js";
import { buildSettingsActions } from "../src/hooks/appData/actions/settingsActions.js";

const MODE_CAPACITY = Object.freeze({
  "1v1": 1,
  "2v2": 2,
  "3v3": 3,
  "5v5": 5,
});

function getKstSchedule(offsetMs) {
  const date = new Date(Date.now() + offsetMs);
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

function runActualMatchLifecycle({
  visibility,
  teamOnly,
  referee,
  benchCapacity,
  timingType = "instant",
  qrAttendanceEnabled = false,
  gameClockEnabled = true,
  acceptReferee = true,
  exerciseSubstitution = false,
  exerciseDispute = false,
}) {
  const hostId = "u1";
  const refereeId = "u11";
  const hasReferee = referee && acceptReferee;
  const postId = `actual-${visibility}-${teamOnly ? "team" : "player"}-${referee ? "referee" : "no-referee"}-bench-${benchCapacity}`;
  const schedule = timingType === "scheduled" ? getKstSchedule(10 * 60_000) : {};
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
    timingType,
    ...schedule,
    hostJoinMode: teamOnly ? "team" : "player",
    teamOnly,
    mode: "2v2",
    sideCapacity: 2,
    benchCapacity,
    ranked: false,
    formationMode: "prearranged",
    matchPurpose: "friendly",
    gameClockEnabled,
    qrAttendanceEnabled,
    periodCount: 2,
    periodMinutes: 1,
    overtimeMinutes: 1,
    shotClockSeconds: 24,
    refereeWanted: referee,
    refereeId: referee ? refereeId : "",
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
        {
          playerIds: teamA ? [hostId, "u2"] : ["u6", "u7"],
          reservePlayerIds: benchCapacity ? [teamA ? "u3" : "u8"] : [],
        },
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
    if (benchCapacity) {
      for (const [side, playerId] of [["teamA", "u3"], ["teamB", "u8"]]) {
        state = inviteRecruitingPlayers(asActor(state, hostId), postId, {
          side,
          reserve: true,
          playerIds: [playerId],
          joinMode: "player",
        });
        state = acceptActualInvitation(state, postId, playerId);
      }
    }
  }

  if (referee) {
    assert.equal(
      state.recruitingPosts.find((post) => post.id === postId).roomState.invitations.some((invitation) => invitation.role === "referee"),
      false,
      `${postId}: referee invite starts in room modal`,
    );
    state = inviteRecruitingReferee(asActor(state, hostId), postId, refereeId);
    if (acceptReferee) state = acceptActualInvitation(state, postId, refereeId, "referee");
  }
  state = confirmRecruitingMatch(asActor(state, hostId), postId);
  let match = state.matches[0];
  assert.ok(match?.id, `${postId}: 경기 확정`);
  assert.equal(match.refereeId ?? "", hasReferee ? refereeId : "", `${postId}: 심판 배정`);
  assert.equal(match.rules?.timingType, timingType, `${postId}: 일정 방식 저장`);
  assert.equal(match.rules?.qrAttendanceEnabled, qrAttendanceEnabled, `${postId}: QR 출석 저장`);
  assert.equal(match.teamA.teamId, teamOnly ? "t1" : null, `${postId}: A사이드 팀 정체성`);
  assert.equal(match.teamB.teamId, teamOnly ? "t2" : null, `${postId}: B사이드 팀 정체성`);
  if (benchCapacity) {
    const placementOperatorId = hasReferee ? refereeId : hostId;
    const placementUnauthorizedId = hasReferee ? hostId : "u6";
    state = setMatchRoomPlayerPlacement(asActor(state, placementUnauthorizedId), match.id, hostId, { side: "teamA", reserve: true });
    assert.ok(state.matches[0].teamA.players.includes(hostId), `${postId}: 비운영자 슬롯 이동 차단`);
    state = setMatchRoomPlayerPlacement(asActor(state, placementOperatorId), match.id, hostId, { side: "teamA", reserve: true });
    assert.ok(state.matches[0].reservePlayers.teamA.includes(hostId), `${postId}: 방장 후보 이동`);
    state = setMatchRoomPlayerPlacement(asActor(state, placementOperatorId), match.id, hostId, { side: "teamA", reserve: false });
    assert.ok(state.matches[0].teamA.players.includes(hostId), `${postId}: 방장 출전 복귀`);
    state = agreeMatch(asActor(state, hostId), match.id, "teamA", hostId);
    match = state.matches[0];
  }

  const operatorId = hasReferee ? refereeId : hostId;
  const unauthorizedId = hasReferee ? hostId : "u6";
  if (timingType === "scheduled" && qrAttendanceEnabled) {
    state = startMatch(asActor(state, operatorId), match.id);
    assert.equal(state.matches[0].startedAt, undefined, `${postId}: 예정시간 전 미출석 시작 차단`);
  }
  for (const sideName of ["teamA", "teamB"]) {
    for (const playerId of [...match[sideName].players, ...(match.reservePlayers?.[sideName] ?? [])]) {
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

  let substitutedPlayerId = "";
  if (exerciseSubstitution) {
    const activeOutPlayerId = match.teamA.players.find((playerId) => playerId !== hostId);
    const reserveInPlayerId = match.reservePlayers.teamA[0];
    assert.ok(activeOutPlayerId && reserveInPlayerId, `${postId}: 교체 대상`);

    const blocked = substituteMatchPlayer(
      asActor(state, hostId),
      match.id,
      "teamA",
      activeOutPlayerId,
      reserveInPlayerId,
      "operator",
    );
    assert.ok(blocked.matches[0].teamA.players.includes(activeOutPlayerId), `${postId}: 방장의 타인 교체 차단`);

    state = substituteMatchPlayer(
      asActor(state, reserveInPlayerId),
      match.id,
      "teamA",
      activeOutPlayerId,
      reserveInPlayerId,
      "self",
    );
    match = state.matches[0];
    substitutedPlayerId = reserveInPlayerId;
    assert.ok(match.teamA.players.includes(reserveInPlayerId), `${postId}: 후보 자진 출전`);
    assert.ok(match.reservePlayers.teamA.includes(activeOutPlayerId), `${postId}: 기존 출전자 후보 이동`);
    assert.ok(match.playedPlayerIds.teamA.includes(activeOutPlayerId), `${postId}: 기존 출전자 이력 보존`);
    assert.ok(match.playedPlayerIds.teamA.includes(reserveInPlayerId), `${postId}: 교체 출전자 이력 추가`);

    state = substituteMatchPlayer(
      asActor(state, hasReferee ? refereeId : activeOutPlayerId),
      match.id,
      "teamA",
      reserveInPlayerId,
      activeOutPlayerId,
      hasReferee ? "operator" : "self",
    );
    match = state.matches[0];
    assert.ok(match.teamA.players.includes(activeOutPlayerId), `${postId}: 기존 출전자 복귀`);
    assert.ok(match.reservePlayers.teamA.includes(reserveInPlayerId), `${postId}: 교체 후보 복귀`);
    assert.ok(match.playedPlayerIds.teamA.includes(reserveInPlayerId), `${postId}: 복귀 뒤 출전 이력 보존`);
  }

  const scoreOptions = hasReferee || !gameClockEnabled ? {} : { clockController: true };
  state = incrementMatchScore(asActor(state, unauthorizedId), match.id, 1, 0, {
    expectedRevisionA: 0,
  });
  assert.equal(state.matches[0].result, null, `${postId}: 비운영자 점수 차단`);
  state = incrementMatchScore(asActor(state, operatorId), match.id, 2, 0, {
    ...scoreOptions,
    expectedRevisionA: 0,
  });
  state = incrementMatchScore(asActor(state, operatorId), match.id, 1, 0, {
    ...scoreOptions,
    expectedRevisionA: 0,
  });
  assert.equal(state.matches[0].result.scoreA, 2, `${postId}: 오래된 점수 revision 차단`);
  state = incrementMatchScore(asActor(state, operatorId), match.id, 0, 2, {
    ...scoreOptions,
    expectedRevisionB: 0,
  });
  if (!hasReferee) {
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

  if (hasReferee) {
    const playerStats = Object.fromEntries(
      getActualMatchPlayerIds(match).map((playerId) => [
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
    if (substitutedPlayerId) {
      assert.ok(Object.hasOwn(match.result.playerStats, substitutedPlayerId), `${postId}: 교체 출전자 기록 보존`);
    }
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

  if (exerciseDispute) {
    const request = hasReferee
      ? buildMatchDisputeRequest({
        match,
        playerId: hostId,
        requestedStats: {
          ...match.result.playerStats[hostId],
          points: 4,
        },
        reason: "프론트 이의 큐 저장 검증",
      })
      : normalizeTeamScoresDisputeRequest({
        match,
        requestedScoreA: 4,
        requestedScoreB: 2,
        baseRevision: getMatchResultRevision(match),
        reason: "프론트 팀 점수 이의 큐 저장 검증",
      });
    state = disputeMatch(asActor(state, hostId), match.id, request);
    match = state.matches[0];
    assert.equal(match.status, "disputed", `${postId}: 이의 접수`);
    assert.equal(getOpenMatchDisputes(match).length, 1, `${postId}: 이의 큐 표시`);
    const pendingFinalize = finalizeMatchByAuthority(asActor(state, operatorId), match.id, {
      disputesAcknowledged: true,
      now: new Date(new Date(match.result.submittedAt).getTime() + (4 * 60 * 1000)).toISOString(),
    });
    assert.equal(pendingFinalize.matches[0].status, "disputed", `${postId}: 열린 이의 최종 확정 차단`);
    state = resolveMatchDispute(
      asActor(state, operatorId),
      match.id,
      getOpenMatchDisputes(match)[0].id,
      "accepted",
      "현장 기록 확인 완료",
    );
    match = state.matches[0];
    assert.equal(match.status, "approval", `${postId}: 이의 판정 후 승인 대기`);
    assert.equal(getOpenMatchDisputes(match).length, 0, `${postId}: 이의 큐 비움`);
    assert.deepEqual([match.teamA.score, match.teamB.score], [4, 2], `${postId}: 가결 기록 반영`);
  }

  const finalizeOptions = {
    disputesAcknowledged: true,
    now: new Date(new Date(match.result.submittedAt).getTime() + (4 * 60 * 1000)).toISOString(),
  };
  state = finalizeMatchByAuthority(asActor(state, operatorId), match.id, {
    disputesAcknowledged: true,
    now: new Date(new Date(match.result.submittedAt).getTime() + (2 * 60 * 1000)).toISOString(),
  });
  assert.notEqual(state.matches[0].status, "confirmed", `${postId}: 3분 전 최종 확정 차단`);
  state = finalizeMatchByAuthority(asActor(state, operatorId), match.id, {
    disputesAcknowledged: false,
    now: finalizeOptions.now,
  });
  assert.notEqual(state.matches[0].status, "confirmed", `${postId}: 이의 확인 없는 최종 확정 차단`);
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
  return getKstSchedule(-60_000);
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

test("1v1 팀방은 A팀 선택 전에도 개인방으로 오인하지 않는다", () => {
  assert.equal(isIndividualOnlyRecruitingRoom({
    visibility: "public",
    hostJoinMode: "team",
    teamOnly: true,
    teamId: null,
    mode: "1v1",
    sideCapacity: 1,
  }), false);
});

test("대표 한 명만 참가한 팀도 내 슬롯에서 개인 참여로 표시하지 않는다", async () => {
  const source = await readFile(new URL("../src/components/recruiting/RecruitingRoomCommandPanels.jsx", import.meta.url), "utf8");
  assert.match(source, /entry\?\.kind === "team" && entry\?\.team/);
  assert.match(source, /"팀 참여 중"/);
});

test("경기 종료 뒤 이의제기 점수 초깃값은 최신 팀 점수를 따라간다", async () => {
  const source = await readFile(new URL("../src/components/recruiting/useRecruitingRoomController.js", import.meta.url), "utf8");
  assert.match(source, /const resultKey = `\$\{sourceMatch\.result\?\.[^`]+:\$\{scoreA\}:\$\{scoreB\}`/);
  assert.match(source, /requestedScoreA: String\(scoreA\)/);
  assert.match(source, /requestedScoreB: String\(scoreB\)/);
});

test("비관리자의 관리자 컨텍스트 거절은 정상 권한 판정으로 캐시한다", async () => {
  const source = await readFile(new URL("../src/hooks/appData/orchestrator/admin.js", import.meta.url), "utf8");
  assert.match(source, /expectedNonAdmin = error\?\.code === "admin_required" \|\| error\?\.message === "admin_required"/);
  assert.match(source, /if \(expectedNonAdmin\) adminContextLoadedAuthRef\.current = authUserId/);
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
    { id: "practice-team-own-b", name: "내 다른 팀", region: "마포", mmr: 1210, wins: 1 },
    { id: PRACTICE_TEAM_B_ID, name: "상대 팀", region: "마포", mmr: 1250, wins: 1 },
    { id: "practice-team-c", name: "다른 팀", region: "광진", mmr: 1300, wins: 1 },
  ];
  const ownIds = [PRACTICE_TEAM_A_ID, "practice-team-own-b"];
  const rivalries = getLocalRivalries(teams, [], "광진", 10, ownIds);
  assert.ok(rivalries.length);
  assert.ok(rivalries.every((pair) => (
    ownIds.includes(pair.teamA.id) !== ownIds.includes(pair.teamB.id)
  )));
  assert.ok(rivalries.every((pair) => pair.teamA.region === pair.teamB.region));
});

test("팀 득실 통계는 현재 상세과 archive 중복을 제거한다", () => {
  const matches = [{
    id: "match-1",
    status: "confirmed",
    result: { scoreA: 21, scoreB: 18 },
    teamA: { teamId: "team-a" },
    teamB: { teamId: "team-b" },
  }];
  const summary = getTeamScoreSummary(matches, [
    { matchId: "match-1", score: 21, opponentScore: 18 },
    { matchId: "match-2", score: 14, opponentScore: 16 },
  ], "team-a");
  assert.deepEqual(summary, {
    games: 2,
    pointsFor: 35,
    pointsAgainst: 34,
    wins: 1,
    losses: 1,
    draws: 0,
    highestPointsFor: 21,
    lowestPointsAgainst: 16,
    largestWinMargin: 3,
    averagePointsFor: 17.5,
    averagePointsAgainst: 17,
    averageMargin: 0.5,
  });
});

test("시즌 directory 실패 응답은 같은 사용자 재시도를 열어 둔다", async () => {
  const source = await readFile(new URL("../src/pages/Season.jsx", import.meta.url), "utf8");
  assert.match(source, /const \[loadRetrySequence, setLoadRetrySequence\] = useState\(0\)/);
  assert.match(source, /if \(result === false\) \{[\s\S]*directoryLoadKeyRef\.current = "";[\s\S]*setDirectoryLoadFailed\(true\)/);
  assert.match(source, /setLoadRetrySequence\(\(current\) => current \+ 1\)/);
  assert.match(source, /시즌 정보를 불러오지 못했습니다\./);
  assert.match(source, />다시 시도<\/Button>/);
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
  assert.ok(state.settings.blockedUserIds.includes(hostId));
  assert.equal(
    state.recruitingPosts.find((post) => post.id === privatePlayerRoom.id)
      .roomState.invitations.some((invitation) => invitation.targetUserId === targetId),
    false,
  );
  state = unblockUser(state, hostId);
  assert.equal(state.settings.blockedUserIds.includes(hostId), false);

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
  state = reportMatch(state, reportMatchId, "허위 경기 결과", [hostId]);
  assert.ok(state.reports.some((report) => report.type === "match" && report.targetId === reportMatchId && report.by === targetId));
});

test("개인 매칭방의 팀 파티는 사이드 전체 팀으로 확대하지 않는다", () => {
  const postId = "actual-player-room-with-team-party";
  let state = {
    ...structuredClone(demoFlowState),
    currentUserId: "u1",
    matches: [],
    recruitingPosts: [],
    notifications: [],
  };
  state = createRecruitingPost(state, {
    id: postId,
    title: postId,
    visibility: "public",
    timingType: "instant",
    hostJoinMode: "player",
    teamOnly: false,
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity: 0,
    ranked: false,
    formationMode: "prearranged",
    matchPurpose: "friendly",
    court: "실제 야외 코트",
  });
  state = inviteRecruitingPlayers(asActor(state, "u1"), postId, {
    side: "teamA",
    playerIds: ["u2", "u3"],
    joinMode: "player",
  });
  state = acceptActualInvitation(state, postId, "u2");
  state = acceptActualInvitation(state, postId, "u3");
  state = inviteRecruitingPlayers(asActor(state, "u1"), postId, {
    side: "teamB",
    playerIds: ["u5"],
    joinMode: "player",
  });
  state = acceptActualInvitation(state, postId, "u5");
  state = interestRecruitingPost(asActor(state, "u6"), postId, {
    side: "teamB",
    joinMode: "team",
    teamId: "t2",
    playerIds: ["u6", "u7"],
  });

  assert.equal(getRecruitingLobby(state.recruitingPosts[0], state).canConfirm, true);
  state = confirmRecruitingMatch(asActor(state, "u1"), postId);
  const match = state.matches[0];
  assert.ok(match?.id);
  assert.equal(match.teamA.teamId, null);
  assert.equal(match.teamB.teamId, null);
  assert.equal(match.teamB.playerTeams.u6, "t2");
  assert.equal(match.teamB.playerTeams.u7, "t2");
  assert.ok(match.parties.some((party) => party.teamId === "t2"));
});

test("실제 경기방 16조합은 후보 이동부터 출석·기록·최종 확정까지 완료된다", () => {
  for (const visibility of ["public", "private"]) {
    for (const teamOnly of [false, true]) {
      for (const referee of [false, true]) {
        for (const benchCapacity of [0, 1]) {
          runActualMatchLifecycle({ visibility, teamOnly, referee, benchCapacity });
        }
      }
    }
  }
});

test("예약 QR 심판 경기방은 전원 출석 뒤 조기 시작하고 이의 큐 판정까지 완료된다", () => {
  runActualMatchLifecycle({
    visibility: "private",
    teamOnly: false,
    referee: true,
    benchCapacity: 1,
    timingType: "scheduled",
    qrAttendanceEnabled: true,
    exerciseSubstitution: true,
    exerciseDispute: true,
  });
});

test("미수락 심판 초대가 있는 무심판·시계 미사용 경기방도 교체·점수·이의·확정까지 완료된다", () => {
  runActualMatchLifecycle({
    visibility: "private",
    teamOnly: false,
    referee: true,
    benchCapacity: 1,
    gameClockEnabled: false,
    acceptReferee: false,
    exerciseSubstitution: true,
    exerciseDispute: true,
  });
});

test("로컬 프론트 경기시계는 정규 쿼터와 반복 연장을 순서대로 진행한다", async () => {
  let state = createPracticeState({}, { name: "프론트 시계 방장" });
  const created = createPracticeRecruitingRoom(state, {
    title: "2쿼터 연장 프론트 시뮬",
    mode: "1v1",
    sideCapacity: 1,
    benchCapacity: 0,
    formationMode: "prearranged",
    rules: {
      formationMode: "prearranged",
      matchPurpose: "friendly",
      gameClockEnabled: true,
      qrAttendanceEnabled: true,
      periodCount: 2,
      periodMinutes: 1,
      overtimeMinutes: 1,
      shotClockSeconds: 24,
    },
  });
  assert.ok(created.postId);
  state = acceptPendingInvitations(created.state, created.postId);
  const confirmed = confirmRoom(state, created.postId);
  state = completePracticeAttendance(confirmed.state, confirmed.matchId);
  state = apply(state, "startMatch", [confirmed.matchId], PRACTICE_SELF_ID, "시계 경기 시작");

  const nowMs = Date.now();
  const stateRef = { current: state };
  const clockClient = createPracticeClockClient(
    () => stateRef.current,
    () => PRACTICE_SELF_ID,
    null,
    () => nowMs,
  );
  for (const shotClockSeconds of [0, 24, 30, 60]) {
    const configured = await clockClient(confirmed.matchId, "configure", {
      controllerId: PRACTICE_SELF_ID,
      shotClockSeconds,
    });
    assert.equal(configured.clock.shotClockSeconds, shotClockSeconds);
    assert.equal(configured.clock.shotRemainingMs, shotClockSeconds * 1000);
  }
  assert.equal((await clockClient(confirmed.matchId, "start")).clock.status, "running");
  assert.equal((await clockClient(confirmed.matchId, "resetShot")).clock.shotRemainingMs, 60_000);
  assert.equal((await clockClient(confirmed.matchId, "endPeriod")).clock.status, "break");
  let clock = (await clockClient(confirmed.matchId, "startPeriod")).clock;
  assert.equal(clock.currentPeriod, 2);
  assert.equal(clock.status, "running");
  assert.equal((await clockClient(confirmed.matchId, "endPeriod")).clock.status, "break");
  clock = (await clockClient(confirmed.matchId, "startOvertime")).clock;
  assert.equal(clock.overtimeCount, 1);
  assert.equal(clock.periodRemainingMs, 60_000);
  await clockClient(confirmed.matchId, "endPeriod");
  clock = (await clockClient(confirmed.matchId, "startOvertime")).clock;
  assert.equal(clock.overtimeCount, 2);
  assert.equal((await clockClient(confirmed.matchId, "endClock")).clock.status, "ended");
});

test("최종 승인은 결과 제출과 경기 종료 중 늦은 시각부터 3분 뒤 열린다", () => {
  const match = {
    endedAt: "2026-07-31T12:10:00.000Z",
    result: { submittedAt: "2026-07-31T12:00:00.000Z" },
  };
  assert.equal(getMatchManualFinalizationStatus(match, "2026-07-31T12:12:59.999Z").ready, false);
  assert.equal(getMatchManualFinalizationStatus(match, "2026-07-31T12:13:00.000Z").ready, true);
});

test("최종 승인 버튼은 방에 머물러도 3분 경계에서 다시 계산된다", async () => {
  const [matchRoomSource, recruitingControllerSource] = await Promise.all([
    readFile(new URL("../src/pages/MatchRoom.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomController.js", import.meta.url), "utf8"),
  ]);
  assert.match(matchRoomSource, /manualFinalizationStatus\.remainingMs \+ 50/);
  assert.match(recruitingControllerSource, /sourceFinalizationStatus\.remainingMs \+ 50/);
});

test("확정 경기방 슬롯 관리는 경기 액션과 운영 권한을 사용한다", async () => {
  const [modelSource, rendererSource, rosterPropsSource] = await Promise.all([
    readFile(new URL("../src/components/recruiting/RecruitingRoomMatchModel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomSlotRenderers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomRosterProps.js", import.meta.url), "utf8"),
  ]);
  assert.match(modelSource, /sourceMatchPhase\?\.phase === "checkin" && sourceMatch\.refereeId[\s\S]*currentUserIsSourceReferee[\s\S]*: mine/);
  assert.match(rendererSource, /if \(sourceMatch\) \{[\s\S]*setMatchRoomPlayerPlacement\(sourceMatch\.id/);
  assert.match(rendererSource, /if \(sourceMatch && !canManageMatchCheckin\) return null/);
  assert.match(rendererSource, /targetIsParty[\s\S]*!active && canMovePlayerTo\(selectedPost, lobby, targetPlayerId, action\.side, action\.reserve\)/);
  assert.match(rosterPropsSource, /sourceMatchSlotManagementOpen && \(!sourceMatch \|\| canManageMatchCheckin\)/);
  assert.doesNotMatch(rendererSource, /onPositionChange=\{targetIsCurrentUser \? \(position\)/);
});

test("배정 심판 UI 권한은 확정 경기의 심판 ID를 기준으로 복원한다", async () => {
  const modelSource = await readFile(
    new URL("../src/components/recruiting/RecruitingRoomMatchModel.jsx", import.meta.url),
    "utf8",
  );
  assert.match(modelSource, /currentUserIsSourceReferee = Boolean\(\s*sourceMatch\s*&& isMatchReferee\(sourceMatch, app\.currentUser\.id\)\s*,?\s*\)/);
  assert.doesNotMatch(modelSource, /currentUserIsSourceReferee = Boolean\([\s\S]{0,240}canOperateAssignedMatchReferee/);
});

test("심판 개인 득점 제출은 읽기 전용 팀 점수에 합산된다", () => {
  const match = {
    teamA: { players: ["a"], score: 0 },
    teamB: { players: ["b"], score: 0 },
  };
  const result = buildMatchResultSubmission(
    match,
    { playerStats: { a: { points: 2 }, b: { points: 1 } } },
    () => [{ id: "points" }],
    { editableScoreSides: [] },
  );
  assert.equal(result.scoreA, 2);
  assert.equal(result.scoreB, 1);
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
  assert.match(viewSource, /시계 종료/);
  assert.match(viewSource, /경기 종료/);
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
    /import \{[\s\S]*getPlayerPosition,[\s\S]*RoomSlotAvatar,[\s\S]*\} from "\.\/RecruitingRoomSlotCore\.jsx";/,
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

test("경기 만들기 구장 선택은 지역 필터 값을 시도·시군구 형식으로 정규화한다", async () => {
  assert.deepEqual(inferRegionSelection("마포구"), {
    sido: "서울특별시",
    district: "마포구",
  });
  const source = await readFile(
    new URL("../src/components/match/useCreateMatchValidationController.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /inferRegionSelection\(\[court\.sido, court\.sigungu, court\.region\]/);
  assert.doesNotMatch(source, /setCourtRegion\(court\.region\)/);
});

test("방 모달은 후보 자동충원 예상치를 출전 슬롯으로 표시하지 않는다", async () => {
  const [rosterSource, rendererSource, primarySource] = await Promise.all([
    readFile(new URL("../src/components/recruiting/RecruitingRoomRosterPanels.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomMatchRenderers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomPrimarySection.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(rosterSource, /side\.capacity - side\.filled/);
  assert.doesNotMatch(rosterSource, /side\.fillSlots\.map/);
  assert.match(rendererSource, /\.\.\.lobby\.sides\[sideName\]\.fillSlots,[\s\S]*\.\.\.lobby\.sides\[sideName\]\.reserveCandidates/);
  assert.doesNotMatch(primarySource, /lobby\.sides\.team[AB]\.projectedFilled/);
});

test("공용 경기방은 모든 진입점에서 렌더 실패와 삭제 실패를 방 안에서 복구한다", async () => {
  const [modalSource, interactionsSource, matchModelSource, layoutSource] = await Promise.all([
    readFile(new URL("../src/components/recruiting/RecruitingRoomModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomModalInteractions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomMatchModel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomLayout.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(modalSource, /class RecruitingRoomRenderBoundary extends Component/);
  assert.match(modalSource, /<RecruitingRoomLoadFailedView onClose=\{this\.props\.onClose\} onRetry=\{this\.retry\} retrying=\{this\.state\.retrying\}/);
  assert.match(modalSource, /props\.sourceMatch\?\.id[\s\S]*loadMatchDetail\?\.\(props\.sourceMatch\.id\)[\s\S]*loadRecruitingPost/);
  assert.match(modalSource, /const result = await this\.props\.onRetry\?\.\(\)[\s\S]*result !== false && result !== 0/);
  assert.match(interactionsSource, /const result = await app\.actions\.deleteSoloRecord\?\.\(matchId\)/);
  assert.match(interactionsSource, /if \(!matchId \|\| soloRecordDeletePendingRef\.current\) return/);
  assert.match(interactionsSource, /setSoloRecordDeleteTarget\(null\);\s+closeModal\(\)/);
  assert.doesNotMatch(interactionsSource, /request\.finally\(closeModal\)/);
  assert.match(matchModelSource, /refereeAbsenceRequest\?\.status === "pending"/);
  assert.match(layoutSource, /className="arena-lobby-drag-handle"[\s\S]*onClick=\{closeFromBackdrop\}/);
});

test("서버 action 실패는 기존 화면 상태를 보존하고 같은 영역에서 재시도할 수 있다", async () => {
  const [serverActionsSource, settingsActionsSource, notificationsSource, reviewSource, teamDetailSource, teamDetailViewSource, teamsSource, profileIconSource, profileAchievementsSource, profileTeamActionsSource] = await Promise.all([
    readFile(new URL("../src/hooks/appData/orchestrator/serverActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/settingsActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Notifications.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoomReviewPanels.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetailView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Teams.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/profile/ProfileIconDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/ProfileAchievements.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/profileTeamActions.js", import.meta.url), "utf8"),
  ]);

  assert.match(serverActionsSource, /!result \|\| result\.ok === false \|\| !Array\.isArray\(result\.notifications\)\) return false/);
  assert.match(settingsActionsSource, /restoreNotificationsAfterReadFailure/);
  assert.match(settingsActionsSource, /notifications: previousNotifications/);
  assert.match(notificationsSource, /if \(notificationsLoaded === false\) throw new Error\("notification_load_failed"\)/);
  assert.match(reviewSource, /reportPending \? "접수 중" : "신고 접수"/);
  assert.match(reviewSource, /신고를 접수하지 못했습니다\. 다시 시도해 주세요\./);
  assert.match(teamDetailSource, /setEmblemStatusError\("이전 엠블럼 상태를 확인하지 못했습니다\."\)/);
  assert.match(teamDetailSource, /const retryTeamEmblemStatus = \(\) =>/);
  assert.match(teamDetailViewSource, /emblemStatusError[\s\S]*retryTeamEmblemStatus/);
  assert.match(teamsSource, /representativeSavePendingId === team\.id \? "저장 중"/);
  assert.match(teamsSource, /대표팀을 설정하지 못했습니다\. 다시 시도해 주세요\./);
  assert.match(profileIconSource, /if \(!result \|\| result\?\.ok === false\)/);
  assert.match(profileAchievementsSource, /if \(!result \|\| result\?\.ok === false\)/);
  assert.match(profileTeamActionsSource, /if \(!result \|\| result\.ok === false\) return result;[\s\S]*sourceByteSize/);
  assert.match(teamDetailSource, /setEmblemFeedback\(!result \|\| result\?\.ok === false/);
});

test("팀 슬롯 명단 저장은 중복 요청을 막고 실패 시 편집 상태를 유지한다", async () => {
  const source = await readFile(new URL("../src/components/recruiting/RecruitingRoomPickerCore.jsx", import.meta.url), "utf8");
  assert.match(source, /if \(commitPending\) return/);
  assert.match(source, /result === false \|\| result\?\.ok === false/);
  assert.match(source, /선수 명단을 저장하지 못했습니다/);
  assert.match(source, /disabled=\{commitPending/);
});

test("알림 읽음 저장과 재조회가 모두 실패하면 낙관 상태를 되돌린다", async () => {
  const originalNotifications = [
    { id: "n1", readAt: null },
    { id: "n2", readAt: null },
  ];
  const stateRef = { current: { notifications: originalNotifications } };
  const setState = (update) => {
    stateRef.current = typeof update === "function" ? update(stateRef.current) : update;
  };
  const actions = buildSettingsActions({
    currentUserId: "u1",
    isSupabaseConfigured: true,
    loadNotifications: async () => false,
    markAllNotificationsRead: (state) => ({
      ...state,
      notifications: state.notifications.map((notification) => ({ ...notification, readAt: "now" })),
    }),
    markNotificationRead: (state, notificationId) => ({
      ...state,
      notifications: state.notifications.map((notification) => (
        notification.id === notificationId ? { ...notification, readAt: "now" } : notification
      )),
    }),
    markNotificationReadServer: async () => ({ ok: false, error: "offline" }),
    setState,
    stateRef,
  });

  await actions.markNotificationRead("n1");
  assert.deepEqual(stateRef.current.notifications, originalNotifications);
  await actions.markAllNotificationsRead();
  assert.deepEqual(stateRef.current.notifications, originalNotifications);
});

test("초대와 알림 읽음 UI는 중복 요청을 막고 실패를 같은 영역에 남긴다", async () => {
  const [invitePanels, participation, home, homeRail, notifications] = await Promise.all([
    readFile(new URL("../src/components/recruiting/RecruitingRoomInvitePanels.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomParticipationActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Home.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/home/HomeRightRail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Notifications.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(invitePanels, /invitePendingRef\.current/);
  assert.match(invitePanels, /pendingKeysRef\.current\.has\(invitationId\)/);
  assert.match(invitePanels, /심판 초대를 보내지 못했습니다\. 다시 시도해 주세요\./);
  assert.match(invitePanels, /초대를 처리하지 못했습니다\. 다시 시도해 주세요\./);
  assert.match(participation, /setInviteError\("초대를 수락하지 못했습니다\. 다시 시도해 주세요\."\)/);
  assert.match(participation, /return result/);
  assert.match(home, /processingInviteIdRef\.current/);
  assert.match(home, /setInviteActionError\(\{ key, message: "초대를 처리하지 못했습니다\. 다시 시도해 주세요\." \}\)/);
  assert.match(homeRail, /disabled=\{Boolean\(processingInviteId\)\}/);
  assert.equal((homeRail.match(/directNavigation key=\{team\.id\} team=\{team\}/g) ?? []).length, 2);
  assert.match(notifications, /notificationReadPendingRef\.current/);
  assert.match(notifications, /읽음 상태를 저장하지 못했습니다\. 다시 시도해 주세요\./);
  assert.match(notifications, /disabled=\{Boolean\(notificationReadPendingId\)\}/);
});

test("슬롯·경기·이의제기 action은 서버 결과를 기다리고 실패 시 현재 화면을 유지한다", async () => {
  const [actions, recruitingActions, controller, slotRenderers, disputeInteractions, actionSection, tournamentActions, participation, matchRenderers, matchController, matchReview, matchRoom, matchRoomView, matchDialog, disputeQueue] = await Promise.all([
    readFile(new URL("../src/hooks/appData/actions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/recruitingActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomSlotRenderers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomModalInteractions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomActionSection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/matchActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomParticipationActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomMatchRenderers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/matchRoomControllerParts.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoomReviewPanels.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoom.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoomView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchVoidDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/match/MatchDisputeQueue.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(actions, /if \(!ensureRemoteReady\("방 변경"\)\)[\s\S]*return false/);
  assert.match(actions, /if \(!ensureRemoteReady\("경기 변경"\)\) return false/);
  assert.match(recruitingActions, /setRecruitingApplicantPlacement:[^\n]+=> applyRecruitingPostMutation/);
  assert.match(recruitingActions, /setRecruitingTeamPartyRoster:[^\n]+=> applyRecruitingPostMutation/);
  assert.match(controller, /const result = await action\(\)[\s\S]*슬롯을 변경하지 못했습니다/);
  assert.match(slotRenderers, /runRoomSlotAction\(\(\) => app\.actions\.setRecruitingApplicantPlacement/);
  assert.match(slotRenderers, /if \(result && result\.ok !== false\) setSlotActionDraft\(null\)/);
  assert.match(disputeInteractions, /sourceDisputePendingRef\.current[\s\S]*이의제기를 접수하지 못했습니다/);
  assert.match(actionSection, /sourceMatchActionPending === "start" \? "처리 중"/);
  assert.match(actionSection, /runSourceMatchAction\("cancel-participation"[\s\S]*cancelRecruitingParticipation/);
  assert.match(tournamentActions, /return rollbackIfServerFailed\(syncTournamentServer\(syncedTournament/);
  assert.match(participation, /if \(!result \|\| result\?\.ok === false\) throw new Error\(result\?\.error \|\| "chat_send_failed"\)/);
  assert.match(matchRenderers, /if \(!result \|\| result\?\.ok === false\)[\s\S]*취소하지 못했습니다/);
  assert.match(matchController, /if \(!result \|\| result\?\.ok === false\) return;[\s\S]*setVoidDialogOpen\(false\)/);
  assert.match(matchController, /setResultSaveFeedback\(!response \|\| response\?\.ok === false/);
  assert.match(matchController, /const submitDispute = async[\s\S]*return app\.actions\.disputeMatch/);
  assert.match(matchController, /catch \{\s*setVoidRestoreStatus\("복구 심사 요청을 접수하지 못했습니다\."\)/);
  assert.match(matchReview, /if \(!canRequestMatchDispute \|\| disputePending\) return/);
  assert.match(matchReview, /const result = await submitDispute\(\)[\s\S]*이의제기를 접수하지 못했습니다/);
  assert.match(matchRoom, /const runManagementAction = async[\s\S]*const result = await operation\(\)[\s\S]*managementActionPendingRef\.current = false/);
  assert.match(matchRoom, /runManagementAction\("cancel"[\s\S]*app\.actions\.cancelMatch\(match\.id\)/);
  assert.match(matchRoom, /runManagementAction\("delete"[\s\S]*app\.actions\.deleteSoloRecord\?\.\(match\.id\)[\s\S]*setSoloRecordDeleteOpen\(false\)/);
  assert.match(matchRoom, /await app\.actions\.finalizeMatch\?\.\(match\.id, options\)[\s\S]*if \(!result \|\| result\?\.ok === false\)/);
  assert.match(matchRoomView, /managementActionPending === "delete" \? "삭제 중"/);
  assert.match(matchDialog, /error \? <small role="status" className="form-warning">/);
  assert.match(disputeQueue, /if \(result && result\?\.ok !== false\)[\s\S]*resolutionError\.id === dispute\.id/);
});

test("모집 목록은 공용 경기 생성 경로만 사용한다", async () => {
  const [app, page, view] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/RecruitingPageView.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /<Route path="\/app\/create" element=\{<CreateMatch app=\{app\} \/>\}/);
  assert.match(view, /to="\/app\/create"/);
  assert.match(view, /to="\/app\/create\?intent=record"/);
  assert.doesNotMatch(page, /composeOpen|setComposeOpen|createPending|createRecruitingPost/);
  assert.doesNotMatch(view, /arena-compose-drawer|arena-compose-form/);
});

test("후보 전용 entry는 참가자 관리에서도 출전자로 바뀌지 않는다", () => {
  assert.deepEqual(
    getRecruitingEntryPlacementIds({ reserve: true, players: ["reserve-player"], reserves: [] }),
    { activeIds: [], reserveIds: ["reserve-player"] },
  );
});

test("경기 결과 제출은 진행 중 중복 요청을 막고 실패 후 다시 제출할 수 있다", async () => {
  const [matchRoomSource, actionSource, viewSource, modalEditorSource] = await Promise.all([
    readFile(new URL("../src/pages/MatchRoom.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/matchRoomControllerParts.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoomView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingSourceMatchPanels.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(matchRoomSource, /const resultSavePendingRef = useRef\(false\)/);
  assert.match(actionSource, /if \(!canSubmitResult \|\| resultSavePendingRef\.current\) return/);
  assert.match(actionSource, /resultSavePendingRef\.current = true[\s\S]*finally \{[\s\S]*resultSavePendingRef\.current = false/);
  assert.match(viewSource, /disabled=\{!canSubmitResult \|\| resultSavePending\}/);
  assert.match(modalEditorSource, /if \(!canSaveDraft \|\| savePendingRef\.current \|\| !onSave\) return/);
  assert.match(modalEditorSource, /const result = await onSave\(getDerivedDraft\(\)\)/);
  assert.match(modalEditorSource, /입력을 유지했으니 다시 시도해 주세요/);
});

test("사후 경기기록 참가 확인은 중복 승인을 막고 실패를 확인 패널에 남긴다", async () => {
  const source = await readFile(new URL("../src/components/match/ApprovalPanel.jsx", import.meta.url), "utf8");
  assert.match(source, /const approvalPendingRef = useRef\(false\)/);
  assert.match(source, /if \(approvalPendingRef\.current \|\| !onApprove\) return/);
  assert.match(source, /const result = await onApprove\(sideName, playerId\)/);
  assert.match(source, /role="alert" className="form-warning"/);
  assert.match(source, /disabled = locked \|\| approvalPending/);
  assert.match(source, /status\.requiredIds\.map\(\(playerId\) =>/);
});

test("팀·대회·설정 mutation은 재입력과 실패를 화면 경계에서 막는다", async () => {
  const [teams, teamDetail, teamDetailView, tournament, favorites, settings, primary, reports, courtDetail, gettingStarted, matchRoom, matchRoomView, nameReport, notifications, affiliations, settingsCourt, settingsReferee] = await Promise.all([
    readFile(new URL("../src/pages/Teams.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TeamDetailView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/TournamentDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsFavorites.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsPageController.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/SettingsPrimaryColumn.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsReportController.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/CourtDetail.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/GettingStarted.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoom.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoomView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/common/NameReportForm.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Notifications.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/Affiliations.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsCourtRequestController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsRefereeController.js", import.meta.url), "utf8"),
  ]);

  assert.match(teams, /representativeSavePendingRef\.current/);
  assert.match(teamDetail, /teamInvitePendingRef\.current/);
  assert.match(teamDetail, /emblemPendingRef\.current/);
  assert.match(teamDetail, /setEmblemClock[\s\S]*window\.setTimeout/);
  assert.match(teamDetail, /const result = await app\.actions\.toggleFavoriteTeam\(team\.id, team\)/);
  assert.match(teamDetailView, /favoritePending \? "저장 중"/);
  assert.match(tournament, /savingScheduleRef\.current/);
  assert.match(tournament, /savingForfeitRef\.current/);
  assert.match(tournament, /governanceActionRef\.current/);
  assert.match(favorites, /if \(!result \|\| result\?\.ok === false\)/);
  assert.match(favorites, /favoriteActionPendingRef\.current/);
  assert.match(primary, /favoriteActionError/);
  assert.match(settings, /blockSavePendingRef\.current/);
  assert.match(settings, /discordLinkPendingRef\.current/);
  assert.match(reports, /reportSubmitPendingRef\.current/);
  assert.match(courtDetail, /savingRef\.current/);
  assert.match(courtDetail, /correctionSavingRef\.current/);
  assert.match(gettingStarted, /homeGuideCardSavePendingRef\.current/);
  assert.match(matchRoom, /const agreeCurrentUser = [^\n]*runManagementAction\("agree"/);
  assert.match(matchRoomView, /disabled=\{Boolean\(managementActionPending\)\}[^\n]*agreeCurrentUser\(\)/);
  assert.doesNotMatch(matchRoomView, /app\.actions\.agreeMatch/);
  assert.match(nameReport, /pendingRef\.current/);
  assert.match(notifications, /notificationDeletePendingRef\.current/);
  assert.match(notifications, /try \{ directoryLoaded = await app\.actions\.loadDirectory/);
  assert.match(affiliations, /directoryLoadPendingRef\.current/);
  assert.match(settingsCourt, /if \(!normalizedAddressQuery\)/);
  assert.match(settingsReferee, /window\.setTimeout\(\(\) => setRefereeClock\(Date\.now\(\)\)/);
});

test("actual player invitation decline permits a clean reinvite and acceptance", () => {
  const postId = "actual-invitation-decline-reinvite";
  let state = {
    ...structuredClone(demoFlowState),
    currentUserId: "u1",
    matches: [],
    recruitingPosts: [],
    notifications: [],
  };
  state = createRecruitingPost(state, {
    id: postId,
    title: postId,
    visibility: "private",
    timingType: "instant",
    hostJoinMode: "player",
    mode: "1v1",
    sideCapacity: 1,
    benchCapacity: 0,
    ranked: false,
    formationMode: "prearranged",
    matchPurpose: "friendly",
    gameClockEnabled: false,
    court: "Simulation Court",
  });
  state = inviteRecruitingPlayers(asActor(state, "u1"), postId, {
    side: "teamB",
    playerIds: ["u6"],
    joinMode: "player",
  });
  const firstInviteId = state.recruitingPosts[0].roomState.invitations[0].id;
  state = declineRecruitingInvitation(asActor(state, "u6"), postId, firstInviteId);
  assert.equal(state.recruitingPosts[0].roomState.invitations.length, 0);

  state = inviteRecruitingPlayers(asActor(state, "u1"), postId, {
    side: "teamB",
    playerIds: ["u6"],
    joinMode: "player",
  });
  state = acceptActualInvitation(state, postId, "u6");
  const lobby = getRecruitingLobby(state.recruitingPosts[0], state);
  assert.ok(lobby.sides.teamB.players.includes("u6"));
});

test("personal record creation and owner-only deletion complete in local frontend state", () => {
  const schedule = getKstSchedule(-60_000);
  let state = {
    ...structuredClone(demoFlowState),
    currentUserId: "u1",
    matches: [],
    notifications: [],
  };
  state = createMatch(state, {
    id: "actual-personal-record",
    title: "actual-personal-record",
    recordType: "solo",
    recordEntryMode: "quick",
    visibility: "public",
    mode: "3v3",
    ...schedule,
    soloScoreFor: 21,
    soloScoreAgainst: 18,
    soloStats: {
      points: 7,
      rebounds: 4,
      assists: 3,
      steals: 2,
      blocks: 1,
      turnovers: 2,
      fouls: 1,
    },
  });
  const created = state.matches[0];
  assert.equal(created.status, "confirmed");
  assert.equal(created.result.scoreA, 21);
  assert.equal(created.result.playerStats.u1.turnovers, 2);
  assert.equal(created.ratingScale, 0);
  assert.deepEqual(created.ratingResult, []);

  state = deleteSoloRecord(asActor(state, "u6"), created.id);
  assert.equal(state.matches[0].status, "confirmed");
  state = deleteSoloRecord(asActor(state, "u1"), created.id);
  assert.equal(state.matches[0].status, "cancelled");
});
