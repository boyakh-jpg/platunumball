import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runAutomaticStateMaintenance } from "../src/data/repository.js";
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
