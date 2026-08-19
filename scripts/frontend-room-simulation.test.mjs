import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { requestMatchDetailOnce } from "../src/pages/matchesPageModel.js";
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
  setRecruitingPartyPlayerReserve,
  setRecruitingRoomTeam,
  setRecruitingTeamPartyRoster,
  sendRecruitingChat,
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
import { getRecruitingEntryPlacementIds, getRecruitingLobby, getRecruitingSideCapacity, isIndividualOnlyRecruitingRoom } from "../src/lib/recruiting.js";
import {
  getMatchEndLabel,
  getMatchFormatLabel,
  getMatchPeriodLabel,
  normalizeMatchRules,
  resolveMatchRuleSource,
} from "../src/lib/matchRules.js";
import {
  buildMatchDisputeRequest,
  buildMatchResultSubmission,
  getActualMatchPlayerIds,
  getMatchManualFinalizationStatus,
  getMatchNoDisputeStatus,
  getMatchResultRevision,
  getOpenMatchDisputes,
  normalizeTeamScoresDisputeRequest,
} from "../src/lib/matchUtils.js";
import {
  getAppRedirectFromLocation,
  getLoginBackTargetFromLocation,
  getLoginPath,
  getSafeAppRedirect,
  getSafeLoginBackTarget,
  inferRegionSelection,
} from "../src/lib/profileSetup.js";
import { getLocalRivalries, getTeamScoreSummary } from "../src/lib/season.js";
import { buildSettingsActions } from "../src/hooks/appData/actions/settingsActions.js";
import {
  clearRecruitingMutationPending,
  markRecruitingMutationPending,
} from "../src/hooks/appData/orchestrator/serverActions.js";
import { useDirectoryLoaders } from "../src/hooks/appData/orchestrator/directoryLoaders.js";
import {
  mergeRemoteMatchPage,
  mergeRemoteRecruitingPage,
} from "../src/hooks/appData/remoteMerge/pages.js";
import { mergeRemoteDirectory } from "../src/hooks/appData/remoteMerge/state.js";
import {
  beginTrackedMutation,
  createMutationTracker,
  endTrackedMutation,
  getTrackedMutationVersion,
  hasTrackedMutationSince,
} from "../src/lib/asyncState.js";
import { mergeNotificationRefresh } from "../shared/lib/notifications.js";
import { canSyncRecruitingAction } from "../server/api/recruiting/_syncPostPolicy.js";

const execFileAsync = promisify(execFile);
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

function createActualTeamRosterFixture({ benchCapacity = 3 } = {}) {
  const postId = `actual-team-roster-bench-${benchCapacity}`;
  let state = {
    ...structuredClone(demoFlowState),
    currentUserId: "u2",
    matches: [],
    recruitingPosts: [],
    notifications: [],
  };
  state = createRecruitingPost(state, {
    id: postId,
    title: postId,
    visibility: "public",
    timingType: "instant",
    hostJoinMode: "team",
    teamOnly: true,
    mode: "3v3",
    sideCapacity: 3,
    benchCapacity,
    ranked: false,
    formationMode: "prearranged",
    matchPurpose: "friendly",
    court: "roster-test-court",
  });
  state = setRecruitingRoomTeam(asActor(state, "u2"), postId, "teamA", "t1");
  const entryId = getActualTeamRosterEntry(state, postId).id;
  return { entryId, postId, state };
}

function getActualTeamRosterEntry(state, postId) {
  const post = state.recruitingPosts.find((item) => item.id === postId);
  return getRecruitingLobby(post, state).entries.find((entry) => entry.kind === "team" && entry.team?.id === "t1");
}

function setActualTeamRoster(state, postId, entryId, playerIds, reservePlayerIds) {
  return setRecruitingTeamPartyRoster(asActor(state, "u2"), postId, entryId, {
    teamId: "t1",
    playerIds,
    reservePlayerIds,
  });
}

function assertRosterInvariants(entry, expectedPlayerIds, capacity, benchCapacity) {
  const activeIds = entry.players ?? [];
  const reserveIds = entry.reserves ?? [];
  assert.equal(new Set(activeIds).size, activeIds.length);
  assert.equal(new Set(reserveIds).size, reserveIds.length);
  assert.deepEqual(activeIds.filter((playerId) => reserveIds.includes(playerId)), []);
  assert.equal(activeIds.length <= capacity, true);
  assert.equal(reserveIds.length <= benchCapacity, true);
  assert.deepEqual([...activeIds, ...reserveIds].sort(), [...expectedPlayerIds].sort());
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
  assert.equal(match.rules?.qrAttendanceEnabled, true, `${postId}: QR 출석 강제 저장`);
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
  state = {
    ...state,
    matches: state.matches.map((item) => item.id === match.id
      ? {
          ...item,
          result: {
            ...item.result,
            periodScores: [{ label: "1Q", scoreA: 2, scoreB: 0 }],
          },
        }
      : item),
  };
  state = incrementMatchScore(asActor(state, operatorId), match.id, 1, 0, {
    ...scoreOptions,
    expectedRevisionA: 0,
  });
  assert.equal(state.matches[0].result.scoreA, 2, `${postId}: 오래된 점수 revision 차단`);
  state = incrementMatchScore(asActor(state, operatorId), match.id, 0, 2, {
    ...scoreOptions,
    expectedRevisionB: 0,
  });
  assert.deepEqual(state.matches[0].result.periodScores, [], `${postId}: 점수 변경 시 기존 구간 점수 제거`);
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

function createScopedStateSupabase(seed = {}) {
  const calls = [];
  const getRowValue = (row, column) => {
    const jsonTextMatch = String(column || "").match(/^([a-z_]+)->>([A-Za-z0-9_]+)$/);
    if (jsonTextMatch) return row?.[jsonTextMatch[1]]?.[jsonTextMatch[2]];
    return row?.[column];
  };
  return {
    calls,
    from(table) {
      const state = { table, filters: [], from: 0, to: Number.MAX_SAFE_INTEGER };
      const execute = async () => {
        calls.push({ table, filters: state.filters.map((filter) => ({ ...filter })) });
        let rows = [...(seed[table] ?? [])];
        state.filters.forEach((filter) => {
          if (filter.op === "eq") {
            rows = rows.filter((row) => String(getRowValue(row, filter.column) ?? "") === String(filter.value ?? ""));
          }
          if (filter.op === "in") {
            const values = new Set(filter.values.map(String));
            rows = rows.filter((row) => values.has(String(getRowValue(row, filter.column) ?? "")));
          }
          if (filter.op === "lt") {
            rows = rows.filter((row) => String(getRowValue(row, filter.column) ?? "") < String(filter.value ?? ""));
          }
        });
        return { data: rows.slice(state.from, state.to + 1), error: null };
      };
      const query = {
        select() { return query; },
        limit(count) { state.to = state.from + Math.max(0, Number(count) || 0) - 1; return query; },
        range(from, to) { state.from = from; state.to = to; return query; },
        eq(column, value) { state.filters.push({ op: "eq", column, value }); return query; },
        in(column, values) { state.filters.push({ op: "in", column, values: [...values] }); return query; },
        lt(column, value) { state.filters.push({ op: "lt", column, value }); return query; },
        or() { return query; },
        filter() { return query; },
        order() { return execute(); },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("실제 출전자 2/3가 이의 없음을 누르면 3분 전에도 최종 승인할 수 있다", () => {
  const match = {
    teamA: { players: ["a", "b"] },
    teamB: { players: ["c"] },
    reservePlayers: { teamA: ["reserve"], teamB: [] },
    endedAt: "2026-07-31T12:10:00.000Z",
    result: { submittedAt: "2026-07-31T12:10:00.000Z" },
    rules: { noDisputeUserIds: ["a", "b"] },
  };
  assert.deepEqual(getMatchNoDisputeStatus(match).participantIds.sort(), ["a", "b", "c"]);
  assert.equal(getMatchManualFinalizationStatus(match, "2026-07-31T12:10:01.000Z").ready, true);
  match.disputes = [{ by: "b", status: "resolved" }];
  assert.equal(getMatchManualFinalizationStatus(match, "2026-07-31T12:10:01.000Z").ready, false);
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
  assert.match(rendererSource, /targetIsParty[\s\S]*!active && canMovePlayerTo\(selectedPost, lobby, targetPlayerId, action\.side, action\.reserve, userById\)/);
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

test("비공개 팀방은 수락 전 B주장을 빈 슬롯 대신 초대 대기로 표시한다", async () => {
  const [primarySource, rosterSource] = await Promise.all([
    readFile(new URL("../src/components/recruiting/RecruitingRoomPrimarySection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomRosterPanels.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(primarySource, /invitation\.joinMode === "team"[\s\S]*invitation\.side === sideName/);
  assert.match(primarySource, /pendingLeader=\{pendingSideLeader\}/);
  assert.match(rosterSource, /title="초대 대기"/);
  assert.match(rosterSource, /side\.capacity - side\.filled - Number\(pendingLeaderVisible\)/);
});

test("구장 등록요청은 주소 경로에서 사진 없이 활성화될 수 있다", async () => {
  const [viewSource, controllerSource] = await Promise.all([
    readFile(new URL("../src/pages/SettingsSideColumn.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/useSettingsCourtRequestController.js", import.meta.url), "utf8"),
  ]);
  assert.match(viewSource, /disabled=\{!canSubmitCourtRequest \|\| courtSubmitPending \|\| courtPinPending \|\| courtPhotoPending\}/);
  assert.match(controllerSource, /&& !courtNearbyLookupFailed/);
  assert.match(controllerSource, /if \(!courtDisplayName\)[\s\S]*시설\/장소명을 입력해 주세요\./);
  assert.match(controllerSource, /if \(!courtAddressSelected \|\| !courtHasMapPin\)[\s\S]*실제 구장 위치를 확정해 주세요\./);
  assert.match(controllerSource, /\(!onsiteCourtEntry \|\| courtReadyPhotos\.length > 0\)/);
  assert.match(controllerSource, /if \(onsiteCourtEntry && !courtReadyPhotos\.length\)/);
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

test("주장 후보 이동은 lobby와 TeamMemberPicker 투영에서 동일하게 유지된다", async () => {
  const fixture = createActualTeamRosterFixture();
  let state = setActualTeamRoster(
    fixture.state,
    fixture.postId,
    fixture.entryId,
    ["u2", "u1", "u5"],
    ["u3"],
  );
  state = setRecruitingPartyPlayerReserve(asActor(state, "u2"), fixture.postId, fixture.entryId, "u2", true);
  const entry = getActualTeamRosterEntry(state, fixture.postId);

  assert.deepEqual(entry.players, ["u1", "u5"]);
  assert.deepEqual(entry.reserves, ["u3", "u2"]);

  const source = await readFile(new URL("../src/components/recruiting/RecruitingRoomSlotRenderers.jsx", import.meta.url), "utf8");
  assert.match(source, /const teamRosterActiveIds = canManageTeamRoster \? targetEntry\.players \?\? \[\] : \[\]/);
  assert.match(source, /const teamRosterReserveIds = canManageTeamRoster \? targetEntry\.reserves \?\? \[\] : \[\]/);
  assert.doesNotMatch(source, /getPartyPlayerIds\(targetEntry\.team/);
  assert.doesNotMatch(source, /getPartyReserveIds\(targetEntry\.team/);
  assert.doesNotMatch(source, /requiredActive/);
});

test("captain can move active to reserve and back without roster projection changes", () => {
  const fixture = createActualTeamRosterFixture();
  let state = setActualTeamRoster(
    fixture.state,
    fixture.postId,
    fixture.entryId,
    ["u2", "u1"],
    ["u3"],
  );

  state = setRecruitingPartyPlayerReserve(
    asActor(state, "u2"), fixture.postId, fixture.entryId, "u2", true,
  );
  assert.deepEqual(getActualTeamRosterEntry(state, fixture.postId).players, ["u1"]);
  assert.deepEqual(getActualTeamRosterEntry(state, fixture.postId).reserves, ["u3", "u2"]);

  state = setRecruitingPartyPlayerReserve(
    asActor(state, "u2"), fixture.postId, fixture.entryId, "u2", false,
  );
  assert.deepEqual(getActualTeamRosterEntry(state, fixture.postId).players, ["u1", "u2"]);
  assert.deepEqual(getActualTeamRosterEntry(state, fixture.postId).reserves, ["u3"]);
});

test("all party members can move active to reserve and back without disappearing", () => {
  const fixture = createActualTeamRosterFixture();
  let state = setActualTeamRoster(
    fixture.state,
    fixture.postId,
    fixture.entryId,
    ["u2", "u1"],
    [],
  );

  for (const playerId of ["u2", "u1"]) {
    state = setRecruitingPartyPlayerReserve(
      asActor(state, "u2"), fixture.postId, fixture.entryId, playerId, true,
    );
  }
  let entry = getActualTeamRosterEntry(state, fixture.postId);
  assert.deepEqual(entry.players, []);
  assert.deepEqual(entry.reserves, ["u2", "u1"]);
  assertRosterInvariants(entry, ["u1", "u2"], 3, 3);

  for (const playerId of ["u2", "u1"]) {
    state = setRecruitingPartyPlayerReserve(
      asActor(state, "u2"), fixture.postId, fixture.entryId, playerId, false,
    );
  }
  entry = getActualTeamRosterEntry(state, fixture.postId);
  assert.deepEqual(entry.players, ["u2", "u1"]);
  assert.deepEqual(entry.reserves, []);
  assertRosterInvariants(entry, ["u1", "u2"], 3, 3);
});

test("다른 선수 명단 저장은 후보 주장을 출전으로 되돌리지 않는다", () => {
  const fixture = createActualTeamRosterFixture();
  let state = setActualTeamRoster(
    fixture.state,
    fixture.postId,
    fixture.entryId,
    ["u2", "u1", "u5"],
    ["u3"],
  );
  state = setRecruitingPartyPlayerReserve(asActor(state, "u2"), fixture.postId, fixture.entryId, "u2", true);
  state = setActualTeamRoster(state, fixture.postId, fixture.entryId, ["u1", "u5", "u4"], ["u3", "u2"]);

  const entry = getActualTeamRosterEntry(state, fixture.postId);
  assert.deepEqual(entry.players, ["u1", "u5", "u4"]);
  assert.deepEqual(entry.reserves, ["u3", "u2"]);
});

test("주장은 후보가 될 수 있지만 파티에서 완전히 해제할 수 없다", () => {
  const fixture = createActualTeamRosterFixture();
  let state = setActualTeamRoster(
    fixture.state,
    fixture.postId,
    fixture.entryId,
    ["u2", "u1", "u5"],
    ["u3"],
  );
  const captainReserveState = setActualTeamRoster(state, fixture.postId, fixture.entryId, ["u1", "u5"], ["u3", "u2"]);
  assert.notStrictEqual(captainReserveState, state);
  assert.deepEqual(getActualTeamRosterEntry(captainReserveState, fixture.postId).reserves, ["u3", "u2"]);

  state = captainReserveState;
  const captainRemovedState = setRecruitingTeamPartyRoster(
    state,
    fixture.postId,
    fixture.entryId,
    {
      teamId: "t1",
      playerIds: ["u1", "u5"],
      reservePlayerIds: ["u3"],
    },
  );
  assert.strictEqual(captainRemovedState, state);
});

test("출전과 후보가 가득 차면 양방향 개별 이동은 자동 맞교환 없이 no-op이다", () => {
  const fixture = createActualTeamRosterFixture({ benchCapacity: 2 });
  const state = setActualTeamRoster(
    fixture.state,
    fixture.postId,
    fixture.entryId,
    ["u2", "u1", "u5"],
    ["u3", "u4"],
  );
  const activeToFullReserve = setRecruitingPartyPlayerReserve(
    state, fixture.postId, fixture.entryId, "u1", true,
  );
  const reserveToFullActive = setRecruitingPartyPlayerReserve(
    state, fixture.postId, fixture.entryId, "u3", false,
  );

  assert.strictEqual(activeToFullReserve, state);
  assert.strictEqual(reserveToFullActive, state);
  assert.deepEqual(getActualTeamRosterEntry(state, fixture.postId).players, ["u2", "u1", "u5"]);
  assert.deepEqual(getActualTeamRosterEntry(state, fixture.postId).reserves, ["u3", "u4"]);
});

test("일반 선수와 주장 출전 후보 이동 20회는 명단 불변식을 지킨다", () => {
  const fixture = createActualTeamRosterFixture({ benchCapacity: 3 });
  let state = setActualTeamRoster(
    fixture.state,
    fixture.postId,
    fixture.entryId,
    ["u2", "u1", "u5"],
    ["u3", "u4"],
  );
  const expectedPlayerIds = ["u1", "u2", "u3", "u4", "u5"];

  for (const playerId of ["u1", "u2"]) {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      state = setRecruitingPartyPlayerReserve(asActor(state, "u2"), fixture.postId, fixture.entryId, playerId, true);
      let entry = getActualTeamRosterEntry(state, fixture.postId);
      assert.equal(entry.reserves.includes(playerId), true);
      assertRosterInvariants(entry, expectedPlayerIds, 3, 3);

      state = setRecruitingPartyPlayerReserve(asActor(state, "u2"), fixture.postId, fixture.entryId, playerId, false);
      entry = getActualTeamRosterEntry(state, fixture.postId);
      assert.equal(entry.players.includes(playerId), true);
      assertRosterInvariants(entry, expectedPlayerIds, 3, 3);
    }
  }
});

test("팀 슬롯 action과 명단 저장은 중복 요청을 막고 실패 시 편집 상태를 유지한다", async () => {
  const [pickerSource, controllerSource, slotRendererSource] = await Promise.all([
    readFile(new URL("../src/components/recruiting/RecruitingRoomPickerCore.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomSlotRenderers.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(pickerSource, /if \(commitPendingRef\.current \|\| externalPending\) return/);
  assert.match(pickerSource, /commitPendingRef\.current = true/);
  assert.match(pickerSource, /result === false \|\| result\?\.ok === false/);
  assert.match(pickerSource, /선수 명단을 저장하지 못했습니다/);
  assert.match(pickerSource, /const actionPending = commitPending \|\| externalPending/);
  assert.match(pickerSource, /disabled=\{actionPending/);
  assert.match(controllerSource, /if \(slotActionPendingRef\.current\) return false/);
  assert.match(controllerSource, /slotActionPendingRef\.current = true/);
  assert.match(controllerSource, /result === false \|\| result\?\.ok === false/);
  assert.match(slotRendererSource, /const popoverPending = Boolean\(slotActionPending \|\| joiningPartyKey\)/);
  assert.match(slotRendererSource, /externalPending=\{popoverPending\}/);
  assert.match(slotRendererSource, /pending=\{popoverPending\}/);
  assert.match(slotRendererSource, /runRoomSlotAction\(\(\) => joinSideParty/);
  assert.match(slotRendererSource, /onInvitePlayers=\{\(playerIds, teamId, joinMode\) => runRoomSlotAction\(/);
  assert.match(slotRendererSource, /onRosterChange=\{\(\{ selectedIds, reserveIds \}\) => runRoomSlotAction\(/);
  assert.match(slotRendererSource, /\{ close: false \},?\s*\)\}/);

  const runnerSource = controllerSource.match(
    /const runRoomSlotAction = (async \(action, \{ close = true \} = \{\}\) => \{[\s\S]*?\r?\n  \});/,
  )?.[1];
  assert.ok(runnerSource, "runRoomSlotAction source must be executable in this test");

  const pendingRef = { current: false };
  const runRoomSlotAction = new Function(
    "slotActionPendingRef",
    "setSlotActionPending",
    "setInviteDraft",
    "setSlotActionDraft",
    "showRoomShareStatus",
    `return ${runnerSource};`,
  )(pendingRef, () => {}, () => {}, () => {}, () => {});

  let resolveRosterSave;
  let rpcCalls = 0;
  const rosterSave = runRoomSlotAction(() => {
    rpcCalls += 1;
    return new Promise((resolve) => {
      resolveRosterSave = resolve;
    });
  }, { close: false });
  const slotMove = runRoomSlotAction(async () => {
    rpcCalls += 1;
    return true;
  }, { close: false });

  assert.equal(await slotMove, false);
  assert.equal(rpcCalls, 1);
  resolveRosterSave(true);
  assert.equal(await rosterSave, true);
});

test("room slot popover browser layout, lock, resize, and keyboard contract", async (t) => {
  const chromePath = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean).find(existsSync);
  if (!chromePath) {
    t.skip("Chrome executable is not available");
    return;
  }

  const fixtureDirectory = await mkdtemp(join(process.cwd(), ".room-ui-browser-"));
  const chromeProfile = await mkdtemp(join(tmpdir(), "boxtier-room-chrome-"));
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });

  const fixtureSource = String.raw`
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SlotCommandPanel } from "/src/components/recruiting/RecruitingRoomCommandPanels.jsx";
import { InvitePanel } from "/src/components/recruiting/RecruitingRoomInvitePanels.jsx";
import { TeamMemberPicker } from "/src/components/recruiting/RecruitingRoomPickerCore.jsx";
import "/src/styles/tokens.css";
import "/src/styles/globals.css";
import "/src/styles/ui-primitives.css";
import "/src/styles/recruiting-arena.css";

const users = {
  u1: { id: "u1", name: "Captain", handle: "captain", position: "PG", region: "Seoul", avatarColor: "#345", ratings: { integrated: 1200 } },
  u2: { id: "u2", name: "Member", handle: "member", position: "SG", region: "Seoul", avatarColor: "#456", ratings: { integrated: 1210 } },
};
const team = {
  id: "team-1",
  name: "Party",
  handle: "party",
  mmr: 1200,
  members: [{ userId: "u1", role: "captain" }, { userId: "u2", role: "member" }],
};
const waitFrames = async (count = 2) => {
  await new Promise((resolve) => setTimeout(resolve, count * 16));
};
const measureOrder = (prefix) => {
  const ids = [prefix + "-empty", prefix + "-second", prefix + "-first"];
  return {
    ids,
    lefts: ids.map((id) => Math.round(document.getElementById(id).getBoundingClientRect().left)),
    rowDirection: getComputedStyle(document.getElementById(prefix + "-row")).direction,
    partyDirection: getComputedStyle(document.getElementById(prefix + "-party")).direction,
    slotDirections: ids.map((id) => getComputedStyle(document.getElementById(id)).direction),
  };
};
const Slot = ({ id, empty = false }) => (
  <div id={id} className="arena-room-player-slot-wrap">
    <button type="button" className={empty ? "arena-room-player-slot empty" : "arena-room-player-slot ready"}>{id}</button>
  </div>
);
function LayoutFixture() {
  return (
    <div className="arena-lobby-modal">
      <div className="arena-lobby-arena" style={{ width: 300 }}>
        <section className="arena-lobby-team-panel team-b">
          <div id="active-row" className="arena-room-slot-row" style={{ "--slot-count": 3 }}>
            <div id="active-party" className="arena-room-party-group" style={{ "--party-slot-count": 2, gridColumn: "span 2" }}>
              <Slot id="active-first" />
              <Slot id="active-second" />
            </div>
            <Slot id="active-empty" empty />
          </div>
        </section>
        <div className="arena-reserve-line team-b" style={{ width: 260 }}>
          <div id="reserve-row" className="arena-room-reserve-row" style={{ "--slot-count": 3 }}>
            <div id="reserve-party" className="arena-room-party-group" style={{ "--party-slot-count": 2, gridColumn: "span 2" }}>
              <Slot id="reserve-first" />
              <Slot id="reserve-second" />
            </div>
            <Slot id="reserve-empty" empty />
          </div>
        </div>
      </div>
    </div>
  );
}
function App() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState(["u2"]);
  return (
    <>
      <LayoutFixture />
      <button id="slot-trigger" type="button" onClick={() => setOpen(true)}>open</button>
      {open ? (
        <SlotCommandPanel
          sideName="teamB"
          floating
          anchor={{ x: 1120, y: 80, width: 560, placement: "bottom" }}
          canMoveHere
          partyJoinOptions={[{ sideName: "teamB", team, entry: { id: "entry-1", user: users.u1 } }]}
          pending={pending}
          onMoveHere={() => {}}
          onJoinParty={() => {}}
          onClose={() => setOpen(false)}
        >
          <TeamMemberPicker
            team={team}
            userById={users}
            selectedIds={["u1"]}
            reserveIds={[]}
            capacity={2}
            reserveCapacity={2}
            requiredPlayerId="u1"
            externalPending={pending}
            deferCommit
            onRosterChange={() => {
              setPending(true);
              return new Promise((resolve) => {
                window.__resolveRoster = () => {
                  setPending(false);
                  resolve(true);
                };
              });
            }}
          />
          <InvitePanel
            sideName="teamB"
            query={query}
            onQueryChange={setQuery}
            users={Object.values(users)}
            teams={[team]}
            userById={users}
            disabledPlayerIds={[]}
            selectedPlayerIds={selectedPlayerIds}
            favoritePlayerIds={[]}
            favoriteTeamIds={[]}
            remoteSearchEnabled={false}
            externalPending={pending}
            onTogglePlayer={(playerId) => setSelectedPlayerIds((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId])}
            onInvitePlayers={() => Promise.resolve(true)}
            onClose={() => {}}
          />
        </SlotCommandPanel>
      ) : null}
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

(async () => {
  await waitFrames(3);
  const layout = { active: measureOrder("active"), reserve: measureOrder("reserve") };
  const trigger = document.getElementById("slot-trigger");
  trigger.focus();
  trigger.click();
  await waitFrames(3);
  const dialog = document.querySelector('[role="dialog"]');
  const focusEntered = Boolean(dialog && dialog.contains(document.activeElement));
  document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await waitFrames(3);
  const escaped = !document.querySelector('[role="dialog"]');
  const focusRestored = document.activeElement === trigger;

  trigger.click();
  await waitFrames(3);
  const memberCards = [...document.querySelectorAll(".arena-party-member-card")];
  memberCards[1].querySelectorAll(".arena-party-role-buttons button")[1].click();
  await waitFrames();
  document.querySelector(".arena-party-picker > button").click();
  await waitFrames(3);
  const pendingDialog = document.querySelector('[role="dialog"]');
  const pendingControls = [...pendingDialog.querySelectorAll("button, input, select, textarea")];
  const lock = {
    allControlsDisabled: pendingControls.length > 0 && pendingControls.every((control) => control.disabled),
    moveAndJoinDisabled: [...pendingDialog.querySelectorAll(".arena-slot-command-actions button")].every((button) => button.disabled),
    inviteDisabled: [...pendingDialog.querySelectorAll(".arena-invite-panel button, .arena-invite-panel input")].every((control) => control.disabled),
  };
  document.querySelector(".arena-slot-popover-backdrop").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  await waitFrames();
  lock.backdropBlocked = Boolean(document.querySelector('[role="dialog"]'));

  window.__resolveRoster();
  await waitFrames(3);
  window.frameElement.style.width = "800px";
  await new Promise((resolve) => setTimeout(resolve, 80));
  await waitFrames(4);
  const resizedDialog = document.querySelector('[role="dialog"]');
  const rect = resizedDialog.getBoundingClientRect();
  const resize = {
    viewportWidth: window.innerWidth,
    left: Math.round(rect.left),
    right: Math.round(rect.right),
    inside: rect.left >= 0 && rect.right <= window.innerWidth,
  };
  window.parent.postMessage({ layout, focus: { focusEntered, escaped, focusRestored }, lock, resize }, "*");
})().catch((error) => window.parent.postMessage({ error: error.stack || String(error) }, "*"));
`;

  try {
    await Promise.all([
      writeFile(join(fixtureDirectory, "index.html"), `<!doctype html><html><body><iframe id="fixture" src="./fixture.html" style="width:1200px;height:900px;border:0"></iframe><script>addEventListener("message",(event)=>{document.body.dataset.result=btoa(unescape(encodeURIComponent(JSON.stringify(event.data))))})</script></body></html>`, "utf8"),
      writeFile(join(fixtureDirectory, "fixture.html"), `<!doctype html><html><body><div id="root"></div><script>addEventListener("error",(event)=>parent.postMessage({error:event.message||"module error"},"*"));addEventListener("unhandledrejection",(event)=>parent.postMessage({error:String(event.reason)},"*"))</script><script type="module" src="./room-browser-fixture.jsx" onerror="parent.postMessage({error:'module load failed'},'*')"></script></body></html>`, "utf8"),
      writeFile(join(fixtureDirectory, "room-browser-fixture.jsx"), fixtureSource, "utf8"),
    ]);
    await server.listen();
    const address = server.httpServer.address();
    const port = typeof address === "object" && address ? address.port : 5173;
    const url = `http://127.0.0.1:${port}/${basename(fixtureDirectory)}/index.html`;
    const { stdout, stderr } = await execFileAsync(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${chromeProfile}`,
      "--window-size=1400,1000",
      "--virtual-time-budget=12000",
      "--dump-dom",
      url,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
    const encodedResult = stdout.match(/data-result="([^"]+)"/)?.[1];
    assert.ok(encodedResult, `browser fixture must publish a result\n${stderr}\n${stdout.slice(-3000)}`);
    const result = JSON.parse(Buffer.from(encodedResult, "base64").toString("utf8"));
    assert.equal(result.error, undefined, result.error);
    for (const line of [result.layout.active, result.layout.reserve]) {
      assert.equal(line.rowDirection, "rtl");
      assert.equal(line.partyDirection, "rtl");
      assert.deepEqual(line.slotDirections, ["ltr", "ltr", "ltr"]);
      assert.ok(line.lefts[0] < line.lefts[1] && line.lefts[1] < line.lefts[2], JSON.stringify(line));
    }
    assert.deepEqual(result.focus, { focusEntered: true, escaped: true, focusRestored: true });
    assert.deepEqual(result.lock, {
      allControlsDisabled: true,
      moveAndJoinDisabled: true,
      inviteDisabled: true,
      backdropBlocked: true,
    });
    assert.equal(result.resize.viewportWidth, 800);
    assert.equal(result.resize.inside, true, JSON.stringify(result.resize));
    t.diagnostic(`active x=${result.layout.active.lefts.join(",")}; reserve x=${result.layout.reserve.lefts.join(",")}; resized=${result.resize.left}-${result.resize.right}/${result.resize.viewportWidth}`);
  } finally {
    await server.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(chromeProfile, { recursive: true, force: true });
  }
});

test("mobile scoreboard hides wake lock control and player activity route changes are isolated in Chromium", async (t) => {
  const chromePath = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean).find(existsSync);
  if (!chromePath) {
    t.skip("Chrome executable is not available");
    return;
  }

  const fixtureDirectory = await mkdtemp(join(process.cwd(), ".async-ui-browser-"));
  const chromeProfile = await mkdtemp(join(tmpdir(), "boxtier-async-chrome-"));
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });

  const fixtureSource = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import MatchClockPanel from "/src/components/match/MatchClockPanel.jsx";
import PlayerCommunityActivity from "/src/pages/PlayerCommunityActivity.jsx";
import "/src/styles/tokens.css";
import "/src/styles/globals.css";
import "/src/styles/ui-primitives.css";

const waitFrames = async (count = 2) => {
  await new Promise((resolve) => setTimeout(resolve, count * 16));
};
const waitFor = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await waitFrames();
  }
  throw new Error(message);
};

const match = {
  id: "match-1",
  mode: "3v3",
  status: "live",
  rules: { periodCount: 2, periodMinutes: 8, halftimeMinutes: 3, periodBreakMinutes: 1 },
  result: { scoreA: 0, scoreB: 0 },
  teamA: { name: "Team A" },
  teamB: { name: "Team B" },
};
const clockResponse = {
  clock: {
    status: "paused",
    currentPeriod: 1,
    expectedPeriodCount: 2,
    overtimeCount: 0,
    periodRemainingMs: 480000,
    shotClockSeconds: 0,
    shotRemainingMs: 0,
    activeElapsedMs: 0,
    minimumActiveMs: 0,
    serverNow: new Date().toISOString(),
    canControl: false,
    controllerId: "",
  },
  score: { a: 0, b: 0, revisionA: 0, revisionB: 0, updatedAt: null },
  activePlayers: [],
  attendanceQr: null,
};
const clockClient = async () => clockResponse;

const clockRoot = createRoot(document.getElementById("clock-root"));
clockRoot.render(<MatchClockPanel match={match} clockClient={clockClient} />);

const activityRequests = [];
const activityApp = {
  remoteReady: true,
  actions: {
    community(action, payload) {
      return new Promise((resolve) => activityRequests.push({ action, payload, resolve }));
    },
  },
};
const playerA = { id: "player-a", privacy: { communityPosts: true, communityComments: true } };
const playerB = { id: "player-b", privacy: { communityPosts: false, communityComments: true } };
const activityRoot = createRoot(document.getElementById("activity-root"));
const renderActivity = (player) => activityRoot.render(
  <MemoryRouter>
    <PlayerCommunityActivity key={player.id} app={activityApp} player={player} isOwnProfile={false} />
  </MemoryRouter>,
);

(async () => {
  await waitFor(() => document.querySelector(".ui-match-clock-device-tools"), "device tools missing");
  const deviceToolText = document.querySelector(".ui-match-clock-device-tools").textContent;
  const scoreboard = {
    wakeControlHidden: !deviceToolText.includes("화면 유지")
      && !deviceToolText.includes("유지 켜짐")
      && !deviceToolText.includes("유지 재연결"),
    fullscreenVisible: deviceToolText.includes("전체화면"),
    buzzerVisible: deviceToolText.includes("부저"),
  };
  clockRoot.unmount();

  renderActivity(playerA);
  await waitFor(() => activityRequests.length === 1, "player A first page request missing");
  activityRequests[0].resolve({
    ok: true,
    items: [{ id: "post-a-1", title: "A FIRST PAGE", createdAt: "2026-01-01T00:00:00Z", viewCount: 0, likeCount: 0, commentCount: 0 }],
    page: { total: 31, limit: 30 },
  });
  await waitFrames(4);
  [...document.querySelectorAll(".ui-pagination button")].find((button) => button.textContent.trim() === "2").click();
  await waitFor(() => activityRequests.length === 2, "player A second page request missing");
  activityRequests[1].resolve({
    ok: true,
    items: [{ id: "post-a-2", title: "A SECOND PAGE", createdAt: "2026-01-02T00:00:00Z", viewCount: 0, likeCount: 0, commentCount: 0 }],
    page: { total: 31, limit: 30 },
  });
  await waitFrames(4);
  document.querySelectorAll('[role="tab"]')[1].click();
  await waitFor(() => activityRequests.length === 3, "player A stale request missing");

  renderActivity(playerB);
  await waitFor(() => activityRequests.length === 4, "player B first request missing");
  const oldContentHiddenBeforeBResponse = !document.body.textContent.includes("A SECOND PAGE");
  const playerBRequest = { ...activityRequests[3].payload };
  activityRequests[2].resolve({
    ok: true,
    items: [{ id: "comment-a", body: "A LATE COMMENT", createdAt: "2026-01-03T00:00:00Z", post: { id: "post-a-3", title: "A LATE TITLE" } }],
    page: { total: 1, limit: 30 },
  });
  await waitFrames(4);
  const staleAResponseIgnored = !document.body.textContent.includes("A LATE TITLE");
  activityRequests[3].resolve({
    ok: true,
    items: [{ id: "comment-b", body: "B COMMENT", createdAt: "2026-01-04T00:00:00Z", post: { id: "post-b", title: "B TITLE" } }],
    page: { total: 1, limit: 30 },
  });
  await waitFrames(4);

  window.parent.postMessage({
    scoreboard,
    activity: {
      oldContentHiddenBeforeBResponse,
      playerBRequest,
      staleAResponseIgnored,
      bContentVisible: document.body.textContent.includes("B TITLE"),
    },
  }, "*");
})().catch((error) => window.parent.postMessage({ error: error.stack || String(error) }, "*"));
`;

  try {
    await Promise.all([
      writeFile(join(fixtureDirectory, "index.html"), `<!doctype html><html><body><iframe src="./fixture.html" style="width:390px;height:844px;border:0"></iframe><script>addEventListener("message",(event)=>{document.body.dataset.result=btoa(unescape(encodeURIComponent(JSON.stringify(event.data))))})</script></body></html>`, "utf8"),
      writeFile(join(fixtureDirectory, "fixture.html"), `<!doctype html><html><body><div id="clock-root"></div><div id="activity-root"></div><script>addEventListener("error",(event)=>parent.postMessage({error:event.message||"module error"},"*"));addEventListener("unhandledrejection",(event)=>parent.postMessage({error:String(event.reason)},"*"))</script><script type="module" src="./async-browser-fixture.jsx" onerror="parent.postMessage({error:'module load failed'},'*')"></script></body></html>`, "utf8"),
      writeFile(join(fixtureDirectory, "async-browser-fixture.jsx"), fixtureSource, "utf8"),
    ]);
    await server.listen();
    const address = server.httpServer.address();
    const port = typeof address === "object" && address ? address.port : 5173;
    const url = `http://127.0.0.1:${port}/${basename(fixtureDirectory)}/index.html`;
    const { stdout, stderr } = await execFileAsync(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${chromeProfile}`,
      "--window-size=1400,1000",
      "--virtual-time-budget=12000",
      "--dump-dom",
      url,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
    const encodedResult = stdout.match(/data-result="([^"]+)"/)?.[1];
    assert.ok(encodedResult, `browser fixture must publish a result\n${stderr}\n${stdout.slice(-3000)}`);
    const result = JSON.parse(Buffer.from(encodedResult, "base64").toString("utf8"));
    assert.equal(result.error, undefined, result.error);
    assert.deepEqual(result.scoreboard, {
      wakeControlHidden: true,
      fullscreenVisible: true,
      buzzerVisible: true,
    });
    assert.deepEqual(result.activity, {
      oldContentHiddenBeforeBResponse: true,
      playerBRequest: { profileId: "player-b", kind: "comments", offset: 0 },
      staleAResponseIgnored: true,
      bContentVisible: true,
    });
  } finally {
    await server.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(chromeProfile, { recursive: true, force: true });
  }
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
  const [actions, recruitingActions, controller, slotRenderers, disputeInteractions, actionSection, dialogSection, tournamentActions, participation, matchRenderers, managementSection, matchController, matchReview, matchRoom, matchRoomView, matchDialog, disputeQueue] = await Promise.all([
    readFile(new URL("../src/hooks/appData/actions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/recruitingActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomSlotRenderers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomModalInteractions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomActionSection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomDialogSection.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/appData/actions/matchActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/useRecruitingRoomParticipationActions.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomMatchRenderers.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingRoomManagementSection.jsx", import.meta.url), "utf8"),
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
  assert.match(matchRenderers, /runSourceMatchAction\("cancel", \(\) => app\.actions\.cancelMatch/);
  assert.match(
    managementSection,
    /onEndMatch=\{\(\) => runSourceMatchAction\("end", \(\) => app\.actions\.endMatch\(sourceMatch\.id\)\)\}/,
  );
  assert.match(
    actionSection,
    /const sourceMatchMutationBusy = Boolean\(sourceMatchActionPending\) \|\| roomCancellationTarget\?\.kind === "match"/,
  );
  assert.match(
    actionSection,
    /requestSourceMatchFinalization\(\s*sourceMatch\.id,\s*sourceFinalAuthorityLabel,\s*\)/,
  );
  assert.match(controller, /setFinalizeMatchTarget\(\{ matchId, authorityLabel \}\)/);
  assert.match(dialogSection, /openDisputeCount=\{sourceOpenDisputes\.length\}/);
  assert.match(dialogSection, /eligible=\{sourceManualFinalizationStatus\.ready\}/);
  assert.doesNotMatch(controller, /openDisputeCount, authorityLabel, eligible/);
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
  assert.match(matchDialog, /\{openDisputeCount > 0\s*\?\s*`열린 이의신청/);
  assert.doesNotMatch(matchDialog, /\{blocked\s*\?\s*`열린 이의신청/);
  assert.match(matchDialog, /disabled=\{blocked \|\| pending\}/);
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

test("경기 결과 작업은 같은 경기 중복을 막고 다른 경기 화면에 완료 상태를 남기지 않는다", async () => {
  const [matchRoomSource, actionSource, viewSource, modalEditorSource] = await Promise.all([
    readFile(new URL("../src/pages/MatchRoom.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/matchRoomControllerParts.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/MatchRoomView.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/recruiting/RecruitingSourceMatchPanels.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(matchRoomSource, /const resultSavePendingRef = useRef\(false\)/);
  assert.match(matchRoomSource, /resetMatchRoomScopedOperations\(\{ courtReviewOperationRef, matchRefreshOperationRef, resultSaveOperationRef/);
  assert.match(matchRoomSource, /resultSave: resultSavePending && resultSaveOperationRef\.current\?\.scopeId === matchId/);
  assert.match(matchRoomSource, /courtReviewSaving: scopedPending\.courtReview, matchDetailRefreshing: scopedPending\.refresh/);
  assert.match(actionSource, /if \(!canSubmitResult \|\| resultSaveOperationRef\.current\?\.scopeId === match\.id\) return/);
  assert.match(actionSource, /const operation = \{ scopeId: match\.id, operationId: \+\+matchOperationSequenceRef\.current \}/);
  assert.match(actionSource, /isCurrentScopedOperation\(resultSaveOperationRef\.current, operation, currentMatchIdRef\.current\)/);
  assert.match(actionSource, /isCurrentScopedOperation\(matchRefreshOperationRef\.current, operation, currentMatchIdRef\.current\)/);
  assert.match(actionSource, /isCurrentScopedOperation\(courtReviewOperationRef\.current, operation, currentMatchIdRef\.current\)/);
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

test("a stale directory response preserves newer profile, settings, and favorites", async () => {
  const tracker = createMutationTracker(["profile", "settings", "favorites"]);
  const snapshot = Object.fromEntries(["profile", "settings", "favorites"].map((key) => [
    key,
    getTrackedMutationVersion(tracker, key),
  ]));
  const staleDirectory = createDeferred();
  let state = {
    currentUserId: "u1",
    users: [{ id: "u1", authUserId: "auth-u1", name: "old name" }],
    teams: [],
    teamInvitations: [],
    affiliations: [],
    seasons: [],
    reports: [],
    settings: {
      favoritePlayerIds: [],
      notificationChannels: { discord: true },
      privacy: { regionRanking: true },
    },
  };
  const completion = staleDirectory.promise.then((remoteState) => {
    state = mergeRemoteDirectory(state, remoteState, {
      includeDirectorySettings: true,
      includeFavoriteSettings: true,
      preserveCurrentUserProfile: hasTrackedMutationSince(tracker, "profile", snapshot.profile),
      preserveFavoriteSettings: hasTrackedMutationSince(tracker, "favorites", snapshot.favorites),
      preserveUserSettings: hasTrackedMutationSince(tracker, "settings", snapshot.settings),
    });
  });

  beginTrackedMutation(tracker, "profile");
  state = { ...state, users: [{ ...state.users[0], name: "new name" }] };
  endTrackedMutation(tracker, "profile");
  beginTrackedMutation(tracker, "settings");
  state = {
    ...state,
    settings: {
      ...state.settings,
      notificationChannels: { discord: false },
      privacy: { regionRanking: false },
    },
  };
  endTrackedMutation(tracker, "settings");
  beginTrackedMutation(tracker, "favorites");
  state = { ...state, settings: { ...state.settings, favoritePlayerIds: ["u2"] } };
  endTrackedMutation(tracker, "favorites");
  staleDirectory.resolve({
    users: [{ id: "u1", authUserId: "auth-u1", name: "old name" }],
    settings: {
      favoritePlayerIds: [],
      notificationChannels: { discord: true },
      privacy: { regionRanking: true },
    },
  });
  await completion;

  assert.equal(state.users[0].name, "new name");
  assert.deepEqual(state.settings.favoritePlayerIds, ["u2"]);
  assert.deepEqual(state.settings.notificationChannels, { discord: false });
  assert.deepEqual(state.settings.privacy, { regionRanking: false });

  const freshSnapshot = Object.fromEntries(["profile", "settings", "favorites"].map((key) => [
    key,
    getTrackedMutationVersion(tracker, key),
  ]));
  state = mergeRemoteDirectory(state, {
    users: [{ id: "u1", authUserId: "auth-u1", name: "server newest" }],
    settings: {
      favoritePlayerIds: ["u3"],
      notificationChannels: { discord: true },
      privacy: { regionRanking: true },
    },
  }, {
    includeDirectorySettings: true,
    includeFavoriteSettings: true,
    preserveCurrentUserProfile: hasTrackedMutationSince(tracker, "profile", freshSnapshot.profile),
    preserveFavoriteSettings: hasTrackedMutationSince(tracker, "favorites", freshSnapshot.favorites),
    preserveUserSettings: hasTrackedMutationSince(tracker, "settings", freshSnapshot.settings),
  });
  assert.equal(state.users[0].name, "server newest");
  assert.deepEqual(state.settings.favoritePlayerIds, ["u3"]);
  assert.deepEqual(state.settings.notificationChannels, { discord: true });
  assert.deepEqual(state.settings.privacy, { regionRanking: true });
});

test("affiliation directory loads replace only authoritative first pages", async () => {
  const first = { id: "affiliation-1", type: "team", name: "Old team" };
  const second = { id: "affiliation-2", type: "tournament", name: "New tournament" };
  const load = async ({ kind, offset = 0, affiliations, reject = false }) => {
    let state = {
      currentUserId: "u1",
      users: [],
      teams: [],
      teamInvitations: [],
      affiliations: [first],
      seasons: [],
      reports: [],
      settings: {},
    };
    const tracker = createMutationTracker(["profile", "settings", "favorites"]);
    const { loadDirectory } = useDirectoryLoaders({
      DIRECTORY_CACHE_TTL_MS: 60_000,
      authEmail: "player@example.com",
      authUserId: "u1",
      demoPreview: false,
      directoryCacheRef: { current: new Map() },
      directoryPromiseRef: { current: new Map() },
      getDirectoryPageRequest: (options) => ({ limit: 30, offset: Number(options.offset) || 0 }),
      getTrackedMutationVersion,
      hasTrackedMutationSince,
      isSupabaseConfigured: true,
      latestDirectoryRequestRef: { current: "" },
      mergeRemoteDirectory,
      normalizeDirectoryRankingSort: (value) => String(value ?? ""),
      recruitingPagination: {},
      setDirectoryStatus: () => {},
      setState: (updater) => {
        state = updater(state);
      },
      trackedPostServerAction: async () => {
        if (reject) throw new Error("directory_failed");
        return { state: { affiliations } };
      },
      userMutationTrackerRef: { current: tracker },
      useCallback: (callback) => callback,
    });
    await loadDirectory({ kind, offset, force: true });
    return state.affiliations;
  };

  assert.deepEqual(await load({ kind: "affiliations", affiliations: [] }), []);
  assert.deepEqual(await load({ kind: "self", affiliations: [] }), [first]);
  assert.deepEqual(await load({ kind: "affiliations", affiliations: [second] }), [second]);
  assert.deepEqual(await load({ kind: "affiliations", offset: 30, affiliations: [second] }), [first, second]);
  assert.deepEqual(await load({ kind: "affiliations", offset: 30, affiliations: [] }), [first]);
  assert.deepEqual(await load({ kind: "affiliations", affiliations: [], reject: true }), [first]);
});

test("late recruiting and match detail responses stay scoped to the selected id", async () => {
  let state = {
    currentUserId: "viewer",
    users: [],
    teams: [],
    tournaments: [],
    recruitingPosts: [
      { id: "room-a", title: "A list", listCardOnly: true, updatedAt: "2026-08-16T00:00:01.000Z" },
      { id: "room-b", title: "B list", listCardOnly: true, updatedAt: "2026-08-16T00:00:02.000Z" },
    ],
    matches: [
      { id: "match-1", title: "M1 list", matchListOnly: true, updatedAt: "2026-08-16T00:00:01.000Z" },
      { id: "match-2", title: "M2 list", matchListOnly: true, updatedAt: "2026-08-16T00:00:02.000Z" },
    ],
  };
  let selectedPostId = "room-a";
  const roomA = createDeferred();
  const roomB = createDeferred();
  const applyRoom = (postId, request) => request.promise.then((remoteState) => {
    state = mergeRemoteRecruitingPage(state, remoteState);
    return selectedPostId === postId;
  });
  const roomACompletion = applyRoom("room-a", roomA);
  selectedPostId = "room-b";
  const roomBCompletion = applyRoom("room-b", roomB);

  roomB.resolve({
    users: [{ id: "player-b", name: "Player B" }],
    teams: [{ id: "team-b", name: "Team B", members: [{ userId: "player-b" }] }],
    recruitingPosts: [{
      id: "room-b",
      title: "B full",
      updatedAt: "2026-08-16T00:00:04.000Z",
      applicants: [{ id: "application-b", playerId: "player-b" }],
      roomState: { chatMessages: [{ id: "chat-b", userId: "player-b", body: "B only" }] },
    }],
  });
  assert.equal(await roomBCompletion, true);
  roomA.resolve({
    users: [{ id: "player-a", name: "Player A" }],
    teams: [{ id: "team-a", name: "Team A", members: [{ userId: "player-a" }] }],
    recruitingPosts: [{
      id: "room-a",
      title: "A full",
      updatedAt: "2026-08-16T00:00:03.000Z",
      applicants: [{ id: "application-a", playerId: "player-a" }],
      roomState: { chatMessages: [{ id: "chat-a", userId: "player-a", body: "A only" }] },
    }],
  });
  assert.equal(await roomACompletion, false);
  assert.equal(selectedPostId, "room-b");
  const loadedRoomB = state.recruitingPosts.find((post) => post.id === "room-b");
  assert.deepEqual(loadedRoomB.applicants.map((application) => application.id), ["application-b"]);
  assert.deepEqual(loadedRoomB.roomState.chatMessages.map((message) => message.id), ["chat-b"]);
  assert.equal(loadedRoomB.roomState.chatMessages.some((message) => message.id === "chat-a"), false);

  state = mergeRemoteRecruitingPage(state, {
    recruitingPosts: [{
      id: "room-b",
      title: "B late list",
      listCardOnly: true,
      listCounts: { applicants: 9 },
      updatedAt: "2026-08-16T00:00:05.000Z",
    }],
  });
  const roomBAfterList = state.recruitingPosts.find((post) => post.id === "room-b");
  assert.equal(roomBAfterList.title, "B full");
  assert.equal(roomBAfterList.listCardOnly, undefined);
  assert.deepEqual(roomBAfterList.applicants.map((application) => application.id), ["application-b"]);
  assert.deepEqual(roomBAfterList.roomState.chatMessages.map((message) => message.id), ["chat-b"]);
  assert.deepEqual(roomBAfterList.listCounts, { applicants: 9 });

  let selectedMatchId = "match-1";
  const match1 = createDeferred();
  const match2 = createDeferred();
  const applyMatch = (matchId, request) => request.promise.then((remoteState) => {
    state = mergeRemoteMatchPage(state, remoteState);
    return selectedMatchId === matchId;
  });
  const match1Completion = applyMatch("match-1", match1);
  selectedMatchId = "match-2";
  const match2Completion = applyMatch("match-2", match2);
  match2.resolve({
    users: [{ id: "match-player-2", name: "Match Player 2" }],
    teams: [],
    tournaments: [],
    recruitingPosts: [],
    matches: [{
      id: "match-2",
      title: "M2 full",
      updatedAt: "2026-08-16T00:00:04.000Z",
      teamA: { players: ["match-player-2"] },
      teamB: { players: [] },
      rules: { periodCount: 4 },
      result: { teamAScore: 8, teamBScore: 4 },
    }],
  });
  assert.equal(await match2Completion, true);
  match1.resolve({
    users: [{ id: "match-player-1", name: "Match Player 1" }],
    teams: [],
    tournaments: [],
    recruitingPosts: [],
    matches: [{
      id: "match-1",
      title: "M1 full",
      updatedAt: "2026-08-16T00:00:03.000Z",
      teamA: { players: ["match-player-1"] },
      teamB: { players: [] },
      rules: { periodCount: 1 },
      result: { teamAScore: 3, teamBScore: 2 },
    }],
  });
  assert.equal(await match1Completion, false);
  assert.equal(selectedMatchId, "match-2");
  const loadedMatch2 = state.matches.find((match) => match.id === "match-2");
  assert.deepEqual(loadedMatch2.teamA.players, ["match-player-2"]);
  assert.deepEqual(loadedMatch2.result, { teamAScore: 8, teamBScore: 4 });

  state = mergeRemoteMatchPage(state, {
    users: [],
    teams: [],
    tournaments: [],
    recruitingPosts: [],
    matches: [{
      id: "match-2",
      title: "M2 late list",
      matchListOnly: true,
      updatedAt: "2026-08-16T00:00:05.000Z",
      teamA: { name: "Team A summary" },
      teamB: { name: "Team B summary" },
    }],
  });
  const match2AfterList = state.matches.find((match) => match.id === "match-2");
  assert.equal(match2AfterList.title, "M2 late list");
  assert.equal(match2AfterList.matchListOnly, undefined);
  assert.deepEqual(match2AfterList.teamA.players, ["match-player-2"]);
  assert.deepEqual(match2AfterList.rules, { periodCount: 4 });
  assert.deepEqual(match2AfterList.result, { teamAScore: 8, teamBScore: 4 });
});

test("a stale notification refresh preserves newer reads and deletions", async () => {
  const tracker = createMutationTracker(["notifications"]);
  const deletedIds = new Set();
  const staleRefresh = createDeferred();
  const requestVersion = getTrackedMutationVersion(tracker, "notifications");
  let notifications = [
    { id: "n1", readAt: null },
    { id: "n2", readAt: null },
  ];
  const completion = staleRefresh.promise.then((remoteNotifications) => {
    notifications = mergeNotificationRefresh(notifications, remoteNotifications, {
      deletedIds,
      preserveLocalChanges: hasTrackedMutationSince(tracker, "notifications", requestVersion),
    });
  });

  beginTrackedMutation(tracker, "notifications");
  notifications = notifications.map((notification) => (
    notification.id === "n1" ? { ...notification, readAt: "2026-08-10T01:00:00.000Z" } : notification
  ));
  endTrackedMutation(tracker, "notifications");
  beginTrackedMutation(tracker, "notifications");
  deletedIds.add("n2");
  notifications = notifications.filter((notification) => notification.id !== "n2");
  endTrackedMutation(tracker, "notifications");
  staleRefresh.resolve([
    { id: "n1", readAt: null },
    { id: "n2", readAt: null },
  ]);
  await completion;

  assert.equal(notifications.find((notification) => notification.id === "n1")?.readAt, "2026-08-10T01:00:00.000Z");
  assert.equal(notifications.some((notification) => notification.id === "n2"), false);
});

test("notification pagination appends without removing the visible page", () => {
  const current = [
    { id: "n1", title: "first", readAt: "2026-08-10T01:00:00.000Z" },
    { id: "n2", title: "second", readAt: null },
  ];
  const merged = mergeNotificationRefresh(current, [
    { id: "n2", title: "second updated", readAt: null },
    { id: "n3", title: "third", readAt: null },
  ], { append: true, preserveLocalChanges: true });

  assert.deepEqual(merged.map((notification) => notification.id), ["n1", "n2", "n3"]);
  assert.equal(merged.find((notification) => notification.id === "n2")?.title, "second updated");
});

test("overlapping recruiting mutations keep the room protected until every request settles", () => {
  const pendingCounts = new Map();
  const pendingIds = new Set();

  markRecruitingMutationPending(pendingCounts, pendingIds, "room-1");
  markRecruitingMutationPending(pendingCounts, pendingIds, "room-1");
  assert.equal(pendingCounts.get("room-1"), 2);
  assert.equal(pendingIds.has("room-1"), true);

  clearRecruitingMutationPending(pendingCounts, pendingIds, "room-1");
  assert.equal(pendingCounts.get("room-1"), 1);
  assert.equal(pendingIds.has("room-1"), true);

  clearRecruitingMutationPending(pendingCounts, pendingIds, "room-1");
  assert.equal(pendingCounts.has("room-1"), false);
  assert.equal(pendingIds.has("room-1"), false);
});

test("referee, query error, and profile hash route state stay synchronized in Chromium", async (t) => {
  const chromePath = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean).find(existsSync);
  if (!chromePath) {
    t.skip("Chromium executable is unavailable.");
    return;
  }

  const fixtureDirectory = await mkdtemp(join(process.cwd(), ".tmp-route-state-"));
  const fixtureName = basename(fixtureDirectory);
  const chromeProfile = await mkdtemp(join(tmpdir(), "boxtier-route-state-chrome-"));
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify("https://example.supabase.co"),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify("test-key"),
    },
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  await writeFile(join(fixtureDirectory, "index.html"), `<!doctype html>
<html><body>
  <div id="referee-root"></div><div id="boundary-root"></div><div id="profile-root"></div>
  <script>
    const reportFixtureError = (error) => {
      const message = error?.stack || error?.message || String(error);
      document.body.dataset.result = btoa(unescape(encodeURIComponent(JSON.stringify({ error: message }))));
    };
    addEventListener("error", (event) => reportFixtureError(event.error || event.message));
    addEventListener("unhandledrejection", (event) => reportFixtureError(event.reason));
  </script>
  <script type="module" src="./main.jsx"></script>
</body></html>`, "utf8");
  await writeFile(join(fixtureDirectory, "main.jsx"), `
import React, { useEffect } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AppErrorBoundary, getAppErrorBoundaryResetKey } from "/src/App.jsx";
import Profile from "/src/pages/Profile.jsx";
import RefereeDetail from "/src/pages/RefereeDetail.jsx";
import { demoFlowState } from "/src/lib/demoFlowState.js";
import "/src/styles/tokens.css";
import "/src/styles/globals.css";
import "/src/styles/ui-primitives.css";

const waitFrames = (count = 2) => new Promise((resolve) => setTimeout(resolve, count * 16));
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (predicate()) return;
    await waitFrames(1);
  }
  throw new Error("Timed out waiting for fixture state.");
};

const baseUser = demoFlowState.users.find((user) => user.id === demoFlowState.currentUserId) ?? demoFlowState.users[0];
const refereeRequests = [];
const refereeApp = {
  remoteReady: true,
  currentUser: baseUser,
  state: { users: [], matches: [], teams: [], settings: { refereeAppointments: [] } },
  actions: {
    loadRefereeDetail(refereeId) {
      return new Promise((resolve, reject) => refereeRequests.push({ refereeId, resolve, reject }));
    },
  },
  matchEntities: {},
};
const refereeResult = (id, name) => ({
  ok: true,
  referee: { ...baseUser, id, name, region: "서울", trustScore: 80, refereeProfile: { grade: "candidate" } },
  state: { matches: [], teams: [] },
  stats: { completed: 0, ranked: 0, official: 0, recent: 0 },
});
let navigateReferee;
function RefereeHarness() {
  const navigate = useNavigate();
  useEffect(() => { navigateReferee = navigate; }, [navigate]);
  return <Routes><Route path="/app/referees/:refereeId" element={<RefereeDetail app={refereeApp} />} /></Routes>;
}
const refereeRoot = createRoot(document.getElementById("referee-root"));
refereeRoot.render(<MemoryRouter initialEntries={["/app/referees/ref-a"]}><RefereeHarness /></MemoryRouter>);
await waitFor(() => refereeRequests.length === 1);
refereeRequests[0].resolve(refereeResult("ref-a", "REF_A_UNIQUE"));
await waitFor(() => document.getElementById("referee-root").textContent.includes("REF_A_UNIQUE"));
navigateReferee("/app/referees/ref-b");
await waitFor(() => refereeRequests.length === 2);
const oldRefereeHiddenDuringLoad = !document.getElementById("referee-root").textContent.includes("REF_A_UNIQUE");
refereeRequests[1].reject(new Error("ref-b failed"));
await waitFor(() => document.querySelector("#referee-root .ui-empty-state-compact button"));
const failedRefereeState = {
  oldNameHidden: !document.getElementById("referee-root").textContent.includes("REF_A_UNIQUE"),
  retryVisible: Boolean(document.querySelector("#referee-root .ui-empty-state-compact button")),
};

navigateReferee("/app/referees/ref-a-late");
await waitFor(() => refereeRequests.length === 3);
await waitFor(() => !document.querySelector("#referee-root .ui-empty-state-compact button"));
navigateReferee("/app/referees/ref-b-latest");
await waitFor(() => refereeRequests.length === 4);
refereeRequests[3].reject(new Error("latest failed"));
await waitFor(() => document.querySelector("#referee-root .ui-empty-state-compact button"));
refereeRequests[2].resolve(refereeResult("ref-a-late", "REF_A_LATE_UNIQUE"));
await waitFrames(2);
const lateRefereeIgnored = !document.getElementById("referee-root").textContent.includes("REF_A_LATE_UNIQUE");

let navigateBoundary;
function BrokenChild() { throw new Error("broken query modal"); }
function BoundaryHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => { navigateBoundary = navigate; }, [navigate]);
  return <AppErrorBoundary resetKey={getAppErrorBoundaryResetKey(location)}>
    {location.search ? <BrokenChild /> : <div id="boundary-normal">NORMAL CHILD</div>}
  </AppErrorBoundary>;
}
const boundaryRoot = createRoot(document.getElementById("boundary-root"));
boundaryRoot.render(<MemoryRouter initialEntries={["/app/matches?match=broken"]}><BoundaryHarness /></MemoryRouter>);
await waitFor(() => document.querySelector("#boundary-root .auth-card"));
const boundaryFallbackVisible = Boolean(document.querySelector("#boundary-root .auth-card"));
navigateBoundary("/app/matches");
await waitFor(() => document.querySelector("#boundary-normal"));
const boundaryRecovered = document.querySelector("#boundary-normal")?.textContent === "NORMAL CHILD";

const profileUser = demoFlowState.users.find((user) => user.id === demoFlowState.currentUserId) ?? demoFlowState.users[0];
const profileApp = {
  currentUser: profileUser,
  remoteReady: true,
  state: { ...demoFlowState, matches: [], teams: [], affiliations: [] },
  actions: {
    profileRecordsLoaded: true,
    updateProfile: async () => ({ ok: true }),
    loadProfileIconAchievements: async () => ({ ok: true, unlockedIconKeys: [] }),
    saveProfileIconSettings: async () => ({ ok: true }),
    setProfileAffiliation: async () => ({ ok: true }),
  },
  recordArchives: { profile: {} },
  matchEntities: {},
};
let navigateProfile;
let profileLocation = "";
function ProfileHarness() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { navigateProfile = navigate; }, [navigate]);
  profileLocation = location.pathname + location.search + location.hash;
  return <Profile app={profileApp} />;
}
const profileRoot = createRoot(document.getElementById("profile-root"));
const renderProfile = (entry, key) => flushSync(() => profileRoot.render(
  <MemoryRouter key={key} initialEntries={[entry]}><ProfileHarness /></MemoryRouter>,
));
renderProfile("/app/profile?tab=me#icons", "initial");
await waitFor(() => document.querySelector("#profile-root .profile-icon-dialog"));
document.querySelector("#profile-root .profile-icon-dialog-header button").click();
await waitFor(() => !document.querySelector("#profile-root .profile-icon-dialog"));
const closeRemovedOnlyIconHash = profileLocation === "/app/profile?tab=me";
renderProfile(profileLocation, "refresh");
const refreshStayedClosed = !document.querySelector("#profile-root .profile-icon-dialog");
navigateProfile("/app/profile?tab=me#icons");
await waitFor(() => document.querySelector("#profile-root .profile-icon-dialog"));
navigateProfile(-1);
await waitFor(() => !document.querySelector("#profile-root .profile-icon-dialog"));
const backClosedDialog = profileLocation === "/app/profile?tab=me";
navigateProfile(1);
await waitFor(() => document.querySelector("#profile-root .profile-icon-dialog"));
const forwardOpenedDialog = profileLocation === "/app/profile?tab=me#icons";
navigateProfile("/app/profile?tab=me#other");
await waitFor(() => !document.querySelector("#profile-root .profile-icon-dialog"));
document.querySelector("#profile-root .profile-icon-card-actions button").click();
await waitFor(() => document.querySelector("#profile-root .profile-icon-dialog"));
document.querySelector("#profile-root .profile-icon-dialog-header button").click();
await waitFor(() => !document.querySelector("#profile-root .profile-icon-dialog"));
const otherHashPreserved = profileLocation === "/app/profile?tab=me#other";

document.body.dataset.result = btoa(JSON.stringify({
  referee: { oldRefereeHiddenDuringLoad, ...failedRefereeState, lateRefereeIgnored },
  boundary: { boundaryFallbackVisible, boundaryRecovered },
  profile: { closeRemovedOnlyIconHash, refreshStayedClosed, backClosedDialog, forwardOpenedDialog, otherHashPreserved },
}));
`, "utf8");

  try {
    await server.listen();
    const address = server.httpServer.address();
    const port = typeof address === "object" && address ? address.port : 5173;
    const pageUrl = `http://127.0.0.1:${port}/${fixtureName}/index.html`;
    const { stdout, stderr } = await execFileAsync(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${chromeProfile}`,
      "--window-size=1400,1000",
      "--virtual-time-budget=18000",
      "--dump-dom",
      pageUrl,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 40000 });
    const encodedResult = stdout.match(/data-result="([^"]+)"/)?.[1];
    assert.ok(encodedResult, `Chromium fixture did not expose its result.\n${stderr}\n${stdout.slice(-3000)}`);
    const result = JSON.parse(Buffer.from(encodedResult, "base64").toString("utf8"));
    assert.equal(result.error, undefined, result.error);
    assert.deepEqual(result.referee, {
      oldRefereeHiddenDuringLoad: true,
      oldNameHidden: true,
      retryVisible: true,
      lateRefereeIgnored: true,
    });
    assert.deepEqual(result.boundary, { boundaryFallbackVisible: true, boundaryRecovered: true });
    assert.deepEqual(result.profile, {
      closeRemovedOnlyIconHash: true,
      refreshStayedClosed: true,
      backClosedDialog: true,
      forwardOpenedDialog: true,
      otherHashPreserved: true,
    });
  } finally {
    await server.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
    await rm(chromeProfile, { recursive: true, force: true });
  }
});

test("recruiting login round trip preserves the exact deep link once", () => {
  const recruitingDeepLink = "/app/recruiting?post=room-1&region=%EC%84%9C%EC%9A%B8#room-chat";
  const loginPath = getLoginPath(recruitingDeepLink);
  const loginUrl = new URL(loginPath, "https://boxtier.kr");

  assert.equal(loginUrl.pathname, "/login");
  assert.equal(loginUrl.searchParams.get("redirect"), recruitingDeepLink);
  assert.equal(loginUrl.searchParams.get("backTo"), recruitingDeepLink);
  assert.equal(getAppRedirectFromLocation({ search: loginUrl.search }), recruitingDeepLink);
  assert.equal(getLoginBackTargetFromLocation({ search: loginUrl.search }), recruitingDeepLink);
  assert.equal(getAppRedirectFromLocation({
    search: "",
    state: { from: { pathname: "/app/recruiting", search: "?post=room-2&tab=all", hash: "#room" } },
  }), "/app/recruiting?post=room-2&tab=all#room");
  assert.equal(getSafeAppRedirect("https://attacker.example/app/recruiting?post=room-1"), "/app");
  assert.equal(getSafeAppRedirect("/app/signup?redirect=%2Fapp%2Frecruiting"), "/app");
  assert.equal(getSafeLoginBackTarget("https://attacker.example/app/recruiting?post=room-1"), "/");
  assert.equal(getSafeLoginBackTarget("/login?redirect=%2Fapp%2Frecruiting"), "/");
});

test("canonical match format drives label slots score rules and period labels", () => {
  const cases = [
    {
      name: "standard 3v3",
      primary: { mode: "3v3", rules: { ruleSet: "standard" } },
      fallback: {},
      format: "3v3",
      capacity: 3,
      normalized: { periodCount: 1, periodMinutes: 12, endCondition: "target_or_time", targetScore: 21 },
    },
    {
      name: "canonical FIBA 3x3",
      primary: { mode: "3v3", rules: { ruleSet: "fiba_3x3" } },
      fallback: {},
      format: "3x3",
      capacity: 3,
      normalized: { periodCount: 1, periodMinutes: 12, endCondition: "target_or_time", targetScore: 21 },
    },
    {
      name: "legacy FIBA 3x3",
      primary: {
        mode: "3v3",
        rules: { targetScore: 21, periodCount: 1, periodMinutes: 12, endCondition: "target_or_time", winByTwo: true },
      },
      fallback: {},
      format: "3x3",
      capacity: 3,
      normalized: { periodCount: 1, periodMinutes: 12, endCondition: "target_or_time", targetScore: 21 },
    },
    {
      name: "standard 5v5",
      primary: { mode: "5v5", rules: { ruleSet: "standard" } },
      fallback: {},
      format: "5v5",
      capacity: 5,
      normalized: { periodCount: 4, periodMinutes: 10, endCondition: "time", targetScore: 21 },
    },
    {
      name: "custom four-quarter 5v5",
      primary: { mode: "5v5", rules: { periodCount: 4, periodMinutes: 8, endCondition: "time" } },
      fallback: {},
      format: "5v5",
      capacity: 5,
      normalized: { periodCount: 4, periodMinutes: 8, endCondition: "time", targetScore: 21 },
    },
    {
      name: "empty match rules use recruiting rules",
      primary: { mode: "3v3", rules: {} },
      fallback: { mode: "3v3", rules: { ruleSet: "fiba_3x3", periodCount: 1, periodMinutes: 12 } },
      format: "3x3",
      capacity: 3,
      normalized: { periodCount: 1, periodMinutes: 12, endCondition: "target_or_time", targetScore: 21 },
    },
    {
      name: "explicit match rules win conflicting legacy recruiting rules",
      primary: { mode: "3v3", rules: { ruleSet: "standard", periodCount: 2, periodMinutes: 9, endCondition: "time" } },
      fallback: { mode: "3v3", rules: { ruleSet: "fiba_3x3", periodCount: 1, periodMinutes: 12, targetScore: 21 } },
      format: "3v3",
      capacity: 3,
      normalized: { periodCount: 2, periodMinutes: 9, endCondition: "time", targetScore: 21 },
    },
  ];

  for (const scenario of cases) {
    const resolved = resolveMatchRuleSource(scenario.primary, scenario.fallback);
    const normalized = normalizeMatchRules(resolved.rules, { mode: resolved.mode });
    assert.equal(getMatchFormatLabel(resolved.mode, resolved.rules), scenario.format, `${scenario.name}: format`);
    assert.equal(getRecruitingSideCapacity(resolved), scenario.capacity, `${scenario.name}: slots`);
    assert.deepEqual({
      periodCount: normalized.periodCount,
      periodMinutes: normalized.periodMinutes,
      endCondition: normalized.endCondition,
      targetScore: normalized.targetScore,
    }, scenario.normalized, `${scenario.name}: normalized rules`);
    assert.equal(getMatchPeriodLabel(resolved.rules, resolved.mode), getMatchPeriodLabel(normalized, resolved.mode), `${scenario.name}: period label`);
    assert.equal(getMatchEndLabel(resolved.rules, resolved.mode), getMatchEndLabel(normalized, resolved.mode), `${scenario.name}: score end label`);
  }
});

test("recruiting chat writes stop at confirmation while existing messages remain readable", () => {
  const openPost = {
    id: "room-chat-lock",
    status: "open",
    confirmedAt: null,
    visibility: "public",
    playerId: "p1",
    playerIds: ["p1"],
    roomState: {
      ownerId: "p1",
      chatMessages: [{ id: "old", userId: "p1", body: "old", createdAt: "2026-08-16T00:00:00.000Z" }],
    },
    applicants: [],
  };
  const state = { currentUserId: "p1", recruitingPosts: [openPost] };
  const openResult = sendRecruitingChat(state, openPost.id, "new");
  assert.deepEqual(
    openResult.recruitingPosts[0].roomState.chatMessages.map((message) => message.body),
    ["old", "new"],
  );

  const confirmedPost = { ...openPost, confirmedAt: "2026-08-16T00:01:00.000Z" };
  const confirmedState = { ...state, recruitingPosts: [confirmedPost] };
  assert.equal(sendRecruitingChat(confirmedState, confirmedPost.id, "blocked"), confirmedState);
  assert.deepEqual(confirmedState.recruitingPosts[0].roomState.chatMessages, openPost.roomState.chatMessages);

  const serverOpenPost = {
    id: openPost.id,
    status: "open",
    confirmed_at: null,
    visibility: "public",
    player_id: "p1",
    player_ids: ["p1"],
    referee_id: null,
    room_state: openPost.roomState,
  };
  assert.equal(canSyncRecruitingAction("p1", serverOpenPost, serverOpenPost, "sendRecruitingChat"), true);
  assert.equal(canSyncRecruitingAction("outsider", serverOpenPost, serverOpenPost, "sendRecruitingChat"), false);
  assert.equal(canSyncRecruitingAction("p1", { ...serverOpenPost, status: "closed" }, serverOpenPost, "sendRecruitingChat"), false);
  assert.equal(canSyncRecruitingAction("p1", { ...serverOpenPost, confirmed_at: confirmedPost.confirmedAt }, serverOpenPost, "sendRecruitingChat"), false);
});

test("guest room targeting and chat scroll policy preserve exact-link and reading state", async () => {
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });

  try {
    const [{
      isRoomChatNearBottom,
      shouldAutoScrollRoomChat,
    }, {
      getGuestRecruitingUnavailableCopy,
      resolveGuestRecruitingTarget,
    }, {
      getCurrentUserTeams,
    }, {
      getMatchFormatLabel,
      resolveMatchRuleSource,
    }] = await Promise.all([
      server.ssrLoadModule("/src/components/recruiting/RecruitingRoomRosterPanels.jsx"),
      server.ssrLoadModule("/src/pages/Recruiting.jsx"),
      server.ssrLoadModule("/src/components/recruiting/useRecruitingRoomController.js"),
      server.ssrLoadModule("/src/lib/matchRules.js"),
    ]);

    assert.equal(isRoomChatNearBottom({ scrollHeight: 1_000, scrollTop: 100, clientHeight: 400 }), false);
    assert.equal(shouldAutoScrollRoomChat(true, false), false);
    assert.equal(shouldAutoScrollRoomChat(false, false), true);
    assert.equal(isRoomChatNearBottom({ scrollHeight: 1_000, scrollTop: 550, clientHeight: 400 }), true);

    const outsideFeedPost = { id: "outside-feed-room", title: "shared room" };
    assert.deepEqual(resolveGuestRecruitingTarget({
      loading: false,
      error: false,
      posts: [],
      requestedRecruitingId: outsideFeedPost.id,
      requestedRecruiting: { status: "open", post: outsideFeedPost },
    }, outsideFeedPost.id), { post: outsideFeedPost, status: "open" });
    assert.deepEqual(resolveGuestRecruitingTarget({
      loading: false,
      error: false,
      posts: [],
      requestedRecruitingId: "private-room",
      requestedRecruiting: { status: "not_found", post: null },
    }, "private-room"), { post: null, status: "not_found" });
    assert.deepEqual(resolveGuestRecruitingTarget({
      loading: false,
      error: false,
      posts: [],
      requestedRecruitingId: "missing-room",
      requestedRecruiting: { status: "not_found", post: null },
    }, "missing-room"), { post: null, status: "not_found" });
    assert.deepEqual(resolveGuestRecruitingTarget({
      loading: false,
      error: false,
      posts: [],
      requestedRecruitingId: "old-room",
      requestedRecruiting: { status: "closed", post: null },
    }, "next-room"), { post: null, status: "loading" });
    assert.deepEqual(resolveGuestRecruitingTarget({
      loading: false,
      error: false,
      posts: [],
      requestedRecruitingId: "closed-room",
      requestedRecruiting: { status: "closed", post: null },
    }, "closed-room"), { post: null, status: "closed" });
    assert.equal(getGuestRecruitingUnavailableCopy("private").title, "비공개 방입니다");
    assert.equal(getGuestRecruitingUnavailableCopy("not_found").title, "방을 찾을 수 없습니다");
    assert.deepEqual(getCurrentUserTeams([{ id: "public-team" }], "p_pending"), []);
    assert.deepEqual(
      getCurrentUserTeams([{ id: "mine", members: [{ userId: "p1" }] }], "p1").map((team) => team.id),
      ["mine"],
    );
    const fibaFallback = resolveMatchRuleSource(
      { mode: "3v3", rules: {} },
      { mode: "3v3", rules: { ruleSet: "fiba_3x3" } },
    );
    assert.equal(getMatchFormatLabel(fibaFallback.mode, fibaFallback.rules), "3x3");
    const explicitSourceRule = resolveMatchRuleSource(
      { mode: "3v3", rules: { ruleSet: "standard" } },
      { mode: "3v3", rules: { ruleSet: "fiba_3x3", periodCount: 1 } },
    );
    assert.equal(getMatchFormatLabel(explicitSourceRule.mode, explicitSourceRule.rules), "3v3");
    assert.equal(explicitSourceRule.rules.periodCount, 1);
  } finally {
    await server.close();
  }
});

test("match detail retry recovers from synchronous and asynchronous loader failures", async () => {
  const requestedMatchDetails = new Set(["other-match"]);
  let unavailableCount = 0;
  let settledCount = 0;
  const callbacks = {
    onUnavailable: () => { unavailableCount += 1; },
    onSettled: () => { settledCount += 1; },
  };

  assert.doesNotThrow(() => requestMatchDetailOnce({
    matchId: "target-match",
    requestedMatchDetails,
    loadMatchDetail: () => { throw new Error("network setup failed"); },
    ...callbacks,
  }));
  assert.equal(requestedMatchDetails.has("target-match"), false);
  assert.equal(requestedMatchDetails.has("other-match"), true);
  assert.equal(unavailableCount, 1);
  assert.equal(settledCount, 1);

  await requestMatchDetailOnce({
    matchId: "target-match",
    requestedMatchDetails,
    loadMatchDetail: async () => 1,
    ...callbacks,
  });
  assert.equal(requestedMatchDetails.has("target-match"), true);
  assert.equal(unavailableCount, 1);
  assert.equal(settledCount, 2);

  await requestMatchDetailOnce({
    matchId: "missing-match",
    requestedMatchDetails,
    loadMatchDetail: async () => 0,
    ...callbacks,
  });
  assert.equal(requestedMatchDetails.has("missing-match"), false);
  assert.equal(unavailableCount, 2);
  assert.equal(settledCount, 3);
});

test("single match remote load reads and merges only the linked room directory scope", async () => {
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  const now = "2026-08-16T00:00:00.000Z";
  const currentProfile = {
    id: "p-current", auth_user_id: "auth-current", name: "Current", handle: "current",
    position: "PG", ratings: { integrated: 1200 }, onboarding_complete: true,
    created_at: now, updated_at: now,
  };
  const playerProfile = {
    id: "p-player", name: "Player", handle: "player", position: "SG",
    ratings: { integrated: 1200 }, onboarding_complete: true, created_at: now, updated_at: now,
  };
  const unrelatedProfile = {
    id: "p-other", auth_user_id: "auth-other", name: "Other", handle: "other",
    position: "C", ratings: { integrated: 1200 }, onboarding_complete: true,
    created_at: now, updated_at: now,
  };
  const client = createScopedStateSupabase({
    profiles: [currentProfile, unrelatedProfile],
    public_profiles: [currentProfile, playerProfile, unrelatedProfile],
    matches: [{
      id: "m1", title: "M1", mode: "3v3", status: "contract", visibility: "public",
      ranked: false, official: false, verified: false, created_by: "p-current", referee_id: "p-player",
      rules: { recruitingPostId: "r1" }, team_a_name: "A", team_b_name: "B",
      team_a_score: 0, team_b_score: 0, scheduled_date: "2026-08-16", scheduled_time: "10:00",
      court_id: "c1", created_at: now, updated_at: now,
    }, {
      id: "m2", title: "M2", mode: "5v5", status: "live", visibility: "private",
      created_by: "p-other", rules: { recruitingPostId: "r2" }, created_at: now, updated_at: now,
    }],
    match_players: [
      { id: "mp1", match_id: "m1", user_id: "p-player", side: "teamA", slot_order: 0 },
      { id: "mp2", match_id: "m2", user_id: "p-other", side: "teamA", slot_order: 0 },
    ],
    recruiting_posts: [{
      id: "r1", type: "pickup", title: "R1", visibility: "public", mode: "3v3", status: "closed",
      player_id: "p-current", player_ids: ["p-current", "p-player"], room_state: {}, rules: {},
      ranked: false, official: false, pre_registered: true, spots: 6, court_id: "c1",
      scheduled_date: "2026-08-16", scheduled_time: "10:00", created_at: now, updated_at: now,
    }, {
      id: "r2", type: "pickup", title: "R2", visibility: "private", mode: "5v5", status: "open",
      player_id: "p-other", player_ids: ["p-other"], room_state: {}, rules: {}, created_at: now, updated_at: now,
    }],
    recruiting_applications: [
      { id: "a1", post_id: "r1", kind: "individual", player_id: "p-player", player_ids: ["p-player"], side: "teamA", status: "accepted", reserve: false, created_at: now, updated_at: now },
      { id: "a2", post_id: "r2", kind: "individual", player_id: "p-other", player_ids: ["p-other"], side: "teamA", status: "accepted", reserve: false, created_at: now, updated_at: now },
    ],
    referee_appointments: [
      { id: "ra1", user_id: "p-player", created_at: now },
      { id: "ra2", user_id: "p-other", created_at: now },
    ],
    approved_courts: [
      { id: "c1", name: "Court 1", status: "active", created_at: now, updated_at: now },
      { id: "c2", name: "Court 2", status: "active", created_at: now, updated_at: now },
    ],
  });

  try {
    const { loadNormalizedRemoteStateFromClient } = await server.ssrLoadModule(
      "/src/data/repository/remote/stateLoader.js",
    );
    const result = await loadNormalizedRemoteStateFromClient(
      client,
      "auth-current",
      "current@example.com",
      { scope: "matches", matchIds: ["m1"], includeLinkedRecruitingPost: true },
    );
    const ids = (rows = []) => rows.map((row) => row.id).sort();

    assert.deepEqual(ids(result.state.matches), ["m1"]);
    assert.deepEqual(ids(result.state.recruitingPosts), ["r1"]);
    assert.deepEqual(
      result.state.recruitingPosts[0].applicants.map((applicant) => applicant.playerId),
      ["p-player"],
    );
    assert.equal(result.state.users.some((user) => user.id === "p-other"), false);
    assert.deepEqual(ids(result.state.settings.refereeAppointments), ["ra1"]);
    assert.equal(result.state.matches[0].courtId, "c1");
    assert.equal(result.state.matches[0].court, "Court 1");
    assert.equal(
      client.calls.some((call) => call.table === "profiles" && !call.filters.some((filter) => filter.op === "eq" && filter.column === "auth_user_id" && filter.value === "auth-current")),
      false,
    );
    assert.equal(
      client.calls.some((call) => call.table === "referee_appointments" && !call.filters.some((filter) => filter.op === "in" && filter.column === "user_id")),
      false,
    );
    assert.equal(
      client.calls.some((call) => call.table === "approved_courts" && !call.filters.some((filter) => filter.column === "id" && (filter.op === "eq" || filter.op === "in"))),
      false,
    );
  } finally {
    await server.close();
  }
});

test("lost recruiting confirmation response replays the authoritative linked match without side effects", async () => {
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { middlewareMode: true, hmr: false },
    appType: "custom",
  });
  const now = "2026-08-16T00:00:00.000Z";
  const seed = {
    profiles: [{
      id: "p-host", auth_user_id: "auth-host", name: "Host", handle: "host",
      position: "PG", ratings: { integrated: 1200 }, onboarding_complete: true,
      created_at: now, updated_at: now,
    }],
    public_profiles: [{
      id: "p-host", name: "Host", handle: "host", position: "PG",
      ratings: { integrated: 1200 }, onboarding_complete: true,
      created_at: now, updated_at: now,
    }],
    matches: [{
      id: "m-confirmed", title: "Confirmed", mode: "3v3", status: "contract", visibility: "public",
      ranked: false, official: false, verified: false, created_by: "p-host",
      rules: { recruitingPostId: "r-confirmed" }, team_a_name: "A", team_b_name: "B",
      team_a_score: 0, team_b_score: 0, scheduled_date: "2026-08-16", scheduled_time: "10:00",
      created_at: now, updated_at: now,
    }],
    recruiting_posts: [{
      id: "r-confirmed", type: "pickup", title: "Confirmed room", visibility: "public",
      mode: "3v3", status: "closed", player_id: "p-host", player_ids: ["p-host"],
      room_state: { ownerId: "p-host" }, rules: {}, ranked: false, official: false,
      pre_registered: true, spots: 6, scheduled_date: "2026-08-16", scheduled_time: "10:00",
      created_at: now, updated_at: now,
    }],
  };

  try {
    const { loadExistingRecruitingConfirmation } = await server.ssrLoadModule(
      "/server/api/_authoritativeState.js",
    );
    const context = {
      supabase: createScopedStateSupabase(seed),
      authUserId: "auth-host",
      authUser: { email: "host@example.com" },
      profileId: "p-host",
    };
    const replay = await loadExistingRecruitingConfirmation(context, {
      action: "confirmRecruitingMatch",
      postId: "r-confirmed",
      preferredMatchId: "m-confirmed",
    });

    assert.equal(replay.ok, true);
    assert.equal(replay.alreadyConfirmed, true);
    assert.equal(replay.matchId, "m-confirmed");
    assert.equal(replay.createdMatch.rules.recruitingPostId, "r-confirmed");
    assert.equal(replay.notificationCount, 0);
    assert.equal(replay.discordDeliveryCount, 0);

    await assert.rejects(
      () => loadExistingRecruitingConfirmation(context, {
        action: "confirmRecruitingMatch",
        postId: "r-confirmed",
        preferredMatchId: "m-other",
      }),
      (error) => error?.statusCode === 409 && error?.message === "recruiting_post_already_linked",
    );
    await assert.rejects(
      () => loadExistingRecruitingConfirmation({ ...context, profileId: "p-intruder" }, {
        action: "confirmRecruitingMatch",
        postId: "r-confirmed",
        preferredMatchId: "m-confirmed",
      }),
      (error) => error?.statusCode === 403 && error?.message === "recruiting_room_owner_required",
    );
  } finally {
    await server.close();
  }
});

test("ReserveLine keeps real component order, direction, placement, and overflow contracts in Chromium", async (t) => {
  const chromePath = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean).find(existsSync);
  if (!chromePath) {
    t.skip("Chrome executable is not available");
    return;
  }

  const fixtureDirectory = await mkdtemp(join(process.cwd(), ".reserve-line-browser-"));
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  const fixtureSource = String.raw`
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MemoryRouter } from "react-router-dom";
import BottomNav from "/src/components/layout/BottomNav.jsx";
import { ReserveLine, SideRoster } from "/src/components/recruiting/RecruitingRoomRosterPanels.jsx";
import "/src/styles/tokens.css";
import "/src/styles/globals.css";
import "/src/styles/ui-primitives.css";
import "/src/styles/recruiting-arena.css";

const scenarioCounts = { all: 3, mixed: 2, none: 0, overflow: 18 };
const makeUser = (side, index) => ({
  id: side + "-p" + index,
  name: side.toUpperCase() + String(index).padStart(2, "0") + " Long Name",
  handle: side + index,
  position: index % 2 ? "PG" : "SF",
  avatarColor: index % 2 ? "#315a78" : "#784631",
  ratings: { integrated: 1200 + index },
});
const allUsers = Object.fromEntries(["a", "b"].flatMap((side) => (
  Array.from({ length: 18 }, (_, offset) => makeUser(side, offset + 1))
)).map((user) => [user.id, user]));
const makeSide = (side, count) => {
  const playerIds = Array.from({ length: count }, (_, offset) => side + "-p" + (offset + 1));
  const partyIds = playerIds.slice(0, 2);
  const partyEntry = partyIds.length === 2 ? [{
    id: side + "-party",
    kind: "team",
    team: { id: side + "-team", name: side.toUpperCase() + " Party", members: partyIds.map((userId) => ({ userId })) },
    players: [],
    reserves: partyIds,
    status: "ready",
  }] : [];
  const individualEntries = playerIds.slice(partyIds.length).map((playerId) => ({
    id: side + "-entry-" + playerId,
    kind: "player",
    user: allUsers[playerId],
    players: [],
    reserves: [playerId],
    status: "ready",
  }));
  const candidates = playerIds.map((playerId, index) => ({
    playerId,
    entryId: index < partyIds.length ? side + "-party" : side + "-entry-" + playerId,
    status: "ready",
  }));
  return { candidates, entries: [...partyEntry, ...individualEntries] };
};
const makeActiveSide = (side) => {
  const playerIds = Array.from({ length: 3 }, (_, offset) => side + "-p" + (offset + 1));
  return {
    entries: [{
      id: side + "-active-party",
      kind: "team",
      team: { id: side + "-active-team", name: side.toUpperCase() + " Active", members: playerIds.map((userId) => ({ userId })) },
      players: playerIds,
      reserves: [],
      status: "ready",
    }],
    filled: 3,
    capacity: 3,
    fillSlots: [],
  };
};
function Line({ sideName, scenario }) {
  const side = sideName === "teamA" ? "a" : "b";
  const count = scenarioCounts[scenario];
  const capacity = scenario === "overflow" ? 18 : 3;
  const data = makeSide(side, count);
  return (
    <ReserveLine
      sideName={sideName}
      candidates={data.candidates}
      playingIds={[]}
      lobby={{ entries: data.entries }}
      userById={allUsers}
      teams={[]}
      capacity={capacity}
      canManageEntry={() => true}
      onSelfSlotAction={() => {}}
    />
  );
}
function App() {
  const [scenario, setScenario] = useState("mixed");
  window.__setReserveScenario = (next) => flushSync(() => setScenario(next));
  return (
    <>
      <main className="arena-lobby-modal" data-scenario={scenario}>
        <div className="arena-lobby-arena">
          <div className="arena-lobby-versus-stage">
            <section className="arena-lobby-team-panel team-a">
              <SideRoster sideName="teamA" side={makeActiveSide("a")} userById={allUsers} teams={[]} />
              <div className="arena-side-inline-reserve" data-placement="inline-a"><Line sideName="teamA" scenario={scenario} /></div>
            </section>
            <div className="arena-lobby-score-core"><strong>VS</strong></div>
            <section className="arena-lobby-team-panel team-b">
              <SideRoster sideName="teamB" side={makeActiveSide("b")} userById={allUsers} teams={[]} />
              <div className="arena-side-inline-reserve" data-placement="inline-b"><Line sideName="teamB" scenario={scenario} /></div>
            </section>
          </div>
          <div className="arena-reserve-panel" data-placement="desktop">
            <Line sideName="teamA" scenario={scenario} />
            <Line sideName="teamB" scenario={scenario} />
          </div>
        </div>
      </main>
      <MemoryRouter initialEntries={["/app"]}><BottomNav /></MemoryRouter>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
window.__fixtureReady = true;
`;
  const fixtureStyle = `
html, body, #root { min-width: 0; margin: 0; }
.arena-lobby-modal { width: 100%; max-width: none; min-width: 0; padding: 16px; }
.arena-lobby-arena { min-width: 0; }
.arena-lobby-team-panel { min-width: 0; min-height: 180px; }
`;

  let browser;
  try {
    await writeFile(join(fixtureDirectory, "index.html"), `<!doctype html><html data-theme="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${fixtureStyle}</style></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>`, "utf8");
    await writeFile(join(fixtureDirectory, "fixture.jsx"), fixtureSource, "utf8");
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/${basename(fixtureDirectory)}/index.html`);
    await page.waitForFunction(() => window.__fixtureReady === true && typeof window.__setReserveScenario === "function");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click(".bottom-nav-more > summary");
    assert.equal(await page.locator(".bottom-nav-more").evaluate((node) => node.open), true, "mobile more menu opens");
    await page.mouse.click(8, 8);
    assert.equal(await page.locator(".bottom-nav-more").evaluate((node) => node.open), false, "mobile more menu closes on outside pointer input");

    const widths = [1101, 1100, 720, 719];
    const themes = ["dark", "light"];
    const scenarios = ["all", "mixed", "none", "overflow"];
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of themes) {
        await page.evaluate((nextTheme) => { document.documentElement.dataset.theme = nextTheme; }, theme);
        for (const scenario of scenarios) {
          await page.evaluate((nextScenario) => window.__setReserveScenario(nextScenario), scenario);
          await page.waitForFunction((nextScenario) => document.querySelector(".arena-lobby-modal")?.dataset.scenario === nextScenario, scenario);
          const result = await page.evaluate(({ width: viewportWidth, scenario: currentScenario }) => {
            const desktop = document.querySelector('[data-placement="desktop"]');
            const inlineA = document.querySelector('[data-placement="inline-a"]');
            const inlineB = document.querySelector('[data-placement="inline-b"]');
            const useDesktop = viewportWidth > 1100;
            const container = useDesktop ? desktop : document;
            const lineA = useDesktop
              ? desktop.querySelector(".arena-reserve-line.team-a")
              : inlineA.querySelector(".arena-reserve-line.team-a");
            const lineB = useDesktop
              ? desktop.querySelector(".arena-reserve-line.team-b")
              : inlineB.querySelector(".arena-reserve-line.team-b");
            const readLine = (line, descending) => {
              const row = line.querySelector(".arena-room-reserve-row");
              const wrappers = [...row.querySelectorAll(".arena-room-player-slot-wrap")];
              const cards = wrappers.map((wrapper) => wrapper.querySelector(".arena-room-player-slot"));
              const records = wrappers.map((wrapper) => {
                const rect = wrapper.getBoundingClientRect();
                const empty = Boolean(wrapper.querySelector(".arena-room-player-slot.empty"));
                return {
                  name: empty ? "EMPTY" : wrapper.querySelector("strong")?.textContent?.trim(),
                  empty,
                  left: rect.left,
                  right: rect.right,
                  top: rect.top,
                };
              });
              const visual = [...records].sort((left, right) => {
                if (Math.abs(left.top - right.top) > 2) return left.top - right.top;
                return descending ? right.left - left.left : left.left - right.left;
              });
              const party = row.querySelector(".arena-room-party-group");
              const partyGlow = party ? getComputedStyle(party, "::before") : null;
              const innerNodes = [
                ...wrappers,
                ...cards,
                ...row.querySelectorAll(".avatar, strong, button"),
              ];
              const rowRect = row.getBoundingClientRect();
              const initialScrollLeft = row.scrollLeft;
              const firstReal = wrappers.find((wrapper) => !wrapper.querySelector(".empty"));
              const firstRealRect = firstReal?.getBoundingClientRect();
              const firstRealVisibleAtInitial = !firstRealRect
                || (firstRealRect.right > rowRect.left && firstRealRect.left < rowRect.right);
              let focusInside = true;
              if (firstReal) {
                const button = firstReal.querySelector("button");
                button.focus();
                button.scrollIntoView({ block: "nearest", inline: "nearest" });
                const focusedRect = button.getBoundingClientRect();
                const focusedRowRect = row.getBoundingClientRect();
                focusInside = focusedRect.left >= focusedRowRect.left - 1
                  && focusedRect.right <= focusedRowRect.right + 1
                  && focusedRect.top >= focusedRowRect.top - 1
                  && focusedRect.bottom <= focusedRowRect.bottom + 1;
              }
              const scrollable = row.scrollWidth > row.clientWidth + 1;
              const reachable = wrappers.every((wrapper) => {
                wrapper.scrollIntoView({ block: "nearest", inline: "nearest" });
                const itemRect = wrapper.getBoundingClientRect();
                const currentRowRect = row.getBoundingClientRect();
                return itemRect.right > currentRowRect.left && itemRect.left < currentRowRect.right;
              });
              row.scrollLeft = 0;
              return {
                direction: getComputedStyle(row).direction,
                partyDirection: party ? getComputedStyle(party).direction : null,
                partyGlowInset: partyGlow
                  ? [partyGlow.top, partyGlow.right, partyGlow.bottom, partyGlow.left]
                  : null,
                partyGlowBoxShadow: partyGlow?.boxShadow ?? null,
                innerDirections: innerNodes.map((node) => getComputedStyle(node).direction),
                names: visual.map((record) => record.name),
                realNames: visual.filter((record) => !record.empty).map((record) => record.name),
                emptyFlags: visual.map((record) => record.empty),
                firstRealAtStartEdge: !visual.some((record) => !record.empty)
                  || (descending
                    ? visual.find((record) => !record.empty).right >= Math.max(...visual.map((record) => record.right)) - 1
                    : visual.find((record) => !record.empty).left <= Math.min(...visual.map((record) => record.left)) + 1),
                initialScrollLeft,
                firstRealVisibleAtInitial,
                scrollable,
                reachable,
                focusInside,
              };
            };
            const readCardSize = (node) => {
              const rect = node?.getBoundingClientRect();
              return rect ? { width: rect.width, height: rect.height } : null;
            };
            const activeA = document.querySelector(".arena-lobby-team-panel.team-a .arena-room-slot-row .arena-room-player-slot");
            const activeB = document.querySelector(".arena-lobby-team-panel.team-b .arena-room-slot-row .arena-room-player-slot");
            return {
              desktopDisplay: getComputedStyle(desktop).display,
              inlineADisplay: getComputedStyle(inlineA).display,
              inlineBDisplay: getComputedStyle(inlineB).display,
              pageFits: document.documentElement.scrollWidth <= window.innerWidth,
              activeLineCount: container.querySelectorAll?.(".arena-reserve-line").length ?? 0,
              a: readLine(lineA, false),
              b: readLine(lineB, true),
              activeASize: readCardSize(activeA),
              activeBSize: readCardSize(activeB),
              reserveASize: readCardSize(lineA.querySelector(".arena-room-player-slot")),
              reserveBSize: readCardSize(lineB.querySelector(".arena-room-player-slot")),
              currentScenario,
            };
          }, { width, scenario });

          const label = `${width}px/${theme}/${scenario}`;
          assert.equal(result.pageFits, true, `${label}: page overflow`);
          assert.equal(result.desktopDisplay !== "none", width > 1100, `${label}: desktop reserve placement`);
          assert.equal(result.inlineADisplay !== "none", width <= 1100, `${label}: Team A inline placement`);
          assert.equal(result.inlineBDisplay !== "none", width <= 1100, `${label}: Team B inline placement`);
          assert.equal(result.a.direction, "ltr", `${label}: Team A row direction`);
          assert.equal(result.b.direction, "rtl", `${label}: Team B row direction`);
          assert.ok(result.a.innerDirections.every((direction) => direction === "ltr"), `${label}: Team A inner LTR`);
          assert.ok(result.b.innerDirections.every((direction) => direction === "ltr"), `${label}: Team B inner LTR`);
          if (scenario !== "none") {
            assert.equal(result.a.partyDirection, "ltr", `${label}: Team A party direction`);
            assert.equal(result.b.partyDirection, "rtl", `${label}: Team B party direction`);
            assert.deepEqual(result.a.partyGlowInset, ["0px", "0px", "0px", "0px"], `${label}: Team A party glow covers four edges`);
            assert.deepEqual(result.b.partyGlowInset, ["0px", "0px", "0px", "0px"], `${label}: Team B party glow covers four edges`);
            assert.notEqual(result.a.partyGlowBoxShadow, "none", `${label}: Team A party glow visible`);
            assert.notEqual(result.b.partyGlowBoxShadow, "none", `${label}: Team B party glow visible`);
            assert.doesNotMatch(result.a.partyGlowBoxShadow, /\binset\b/, `${label}: Team A party glow is not an inner border`);
            assert.doesNotMatch(result.b.partyGlowBoxShadow, /\binset\b/, `${label}: Team B party glow is not an inner border`);
            assert.equal(result.a.firstRealAtStartEdge, true, `${label}: Team A first candidate edge`);
            assert.equal(result.b.firstRealAtStartEdge, true, `${label}: Team B first candidate edge`);
            assert.equal(result.a.firstRealVisibleAtInitial, true, `${label}: Team A first candidate visible at start`);
            assert.equal(result.b.firstRealVisibleAtInitial, true, `${label}: Team B first candidate visible at start`);
            assert.equal(result.a.focusInside, true, `${label}: Team A focus bounds`);
            assert.equal(result.b.focusInside, true, `${label}: Team B focus bounds`);
          }
          const expectedCount = scenario === "overflow" ? 18 : scenario === "all" ? 3 : scenario === "mixed" ? 2 : 0;
          const expectedA = Array.from({ length: expectedCount }, (_, index) => `A${String(index + 1).padStart(2, "0")} Long Name`);
          const expectedB = Array.from({ length: expectedCount }, (_, index) => `B${String(index + 1).padStart(2, "0")} Long Name`);
          assert.deepEqual(result.a.realNames, expectedA, `${label}: Team A visual data order`);
          assert.deepEqual(result.b.realNames, expectedB, `${label}: Team B visual data order`);
          const firstEmptyA = result.a.emptyFlags.indexOf(true);
          const firstEmptyB = result.b.emptyFlags.indexOf(true);
          assert.ok(firstEmptyA < 0 || result.a.emptyFlags.slice(firstEmptyA).every(Boolean), `${label}: Team A empty slots follow candidates`);
          assert.ok(firstEmptyB < 0 || result.b.emptyFlags.slice(firstEmptyB).every(Boolean), `${label}: Team B empty slots follow candidates`);
          assert.equal(result.a.reachable, true, `${label}: Team A all slots reachable`);
          assert.equal(result.b.reachable, true, `${label}: Team B all slots reachable`);
          if (width <= 720) {
            assert.ok(result.activeASize && result.reserveASize, `${label}: Team A slot dimensions available`);
            assert.ok(result.activeBSize && result.reserveBSize, `${label}: Team B slot dimensions available`);
            assert.ok(Math.abs(result.activeASize.width - result.reserveASize.width) <= 1, `${label}: Team A active/reserve width`);
            assert.ok(Math.abs(result.activeASize.height - result.reserveASize.height) <= 1, `${label}: Team A active/reserve height`);
            assert.ok(Math.abs(result.activeBSize.width - result.reserveBSize.width) <= 1, `${label}: Team B active/reserve width`);
            assert.ok(Math.abs(result.activeBSize.height - result.reserveBSize.height) <= 1, `${label}: Team B active/reserve height`);
          }
          if (scenario === "overflow" && width > 720) {
            assert.equal(result.a.scrollable, result.b.scrollable, `${label}: A/B overflow symmetry`);
            if (result.a.scrollable) {
              assert.equal(Math.abs(result.a.initialScrollLeft), 0, `${label}: Team A starts left`);
              assert.equal(Math.abs(result.b.initialScrollLeft), 0, `${label}: Team B starts right`);
            }
          }
        }
      }
    }
  } finally {
    await browser?.close();
    await server.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test("stat editor and expanded QR dialogs lock scroll and keep keyboard focus in Chromium", async (t) => {
  const chromePath = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean).find(existsSync);
  if (!chromePath) {
    t.skip("Chrome executable is not available");
    return;
  }

  const matchRoomSource = await readFile(join(process.cwd(), "src/pages/MatchRoom.jsx"), "utf8");
  assert.match(
    matchRoomSource,
    /useBodyScrollLock\(Boolean\(statEditorPlayerId \|\| soloRecordDeleteOpen \|\| voidDialogOpen \|\| finalizeDialogOpen\)\)/,
    "the no-referee stat editor must participate in MatchRoom's shared body lock",
  );

  const fixtureDirectory = await mkdtemp(join(process.cwd(), ".match-dialog-browser-"));
  const server = await createServer({
    root: process.cwd(),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  const fixtureSource = String.raw`
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import QrCode from "/src/components/common/QrCode.jsx";
import useBodyScrollLock from "/src/hooks/useBodyScrollLock.js";
import { MatchRoomStatEditor } from "/src/pages/MatchRoomStatEditor.jsx";
import "/src/styles/tokens.css";
import "/src/styles/globals.css";
import "/src/styles/ui-primitives.css";

function StatHarness() {
  const [playerId, setPlayerId] = useState(null);
  useBodyScrollLock(Boolean(playerId));
  return (
    <>
      <button id="stat-trigger" type="button" onClick={() => setPlayerId("player-1")}>open stat</button>
      <MatchRoomStatEditor controller={{
        statEditorPlayerId: playerId,
        setStatEditorPlayerId: setPlayerId,
        statEditorPlayer: playerId ? { id: "player-1", name: "Player One" } : null,
        hasReferee: false,
        isSoloRecord: true,
        score: { playerStats: { "player-1": { points: 2 } } },
        editableStatFields: [{ id: "points", label: "Points", shortLabel: "PTS" }],
        canEditPlayerStat: () => true,
        updatePlayerStat: () => {},
      }} />
    </>
  );
}

function App() {
  return (
    <main style={{ minHeight: "2000px" }}>
      <StatHarness />
      <QrCode value="https://boxtier.kr/check-in" label="Attendance QR" expandable />
      <button id="background-action" type="button">background</button>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
window.__fixtureReady = true;
`;

  let browser;
  try {
    await writeFile(join(fixtureDirectory, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.jsx"></script></body></html>', "utf8");
    await writeFile(join(fixtureDirectory, "fixture.jsx"), fixtureSource, "utf8");
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${address.port}/${basename(fixtureDirectory)}/index.html`);
    await page.waitForFunction(() => window.__fixtureReady === true);

    await page.locator("#stat-trigger").click();
    const statDialog = page.locator('.stat-editor-modal[role="dialog"][aria-modal="true"]');
    await statDialog.waitFor();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-dialog-initial-focus")), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('.stat-editor-modal button:not([disabled])')].at(-1)), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-dialog-initial-focus")), true);
    await page.keyboard.press("Escape");
    await statDialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "stat-trigger");

    const qrTrigger = page.locator(".ui-qr-expand-trigger");
    await qrTrigger.click();
    const qrDialog = page.locator('.ui-qr-expand-dialog[role="dialog"][aria-modal="true"]');
    await qrDialog.waitFor();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "hidden");
    assert.equal(await page.evaluate(() => document.querySelector(".ui-qr-expand-dialog")?.contains(document.activeElement)), true);
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.querySelector(".ui-qr-expand-dialog")?.contains(document.activeElement)), true);
    await page.keyboard.press("Escape");
    await qrDialog.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("ui-qr-expand-trigger")), true);
  } finally {
    await browser?.close();
    await server.close();
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
