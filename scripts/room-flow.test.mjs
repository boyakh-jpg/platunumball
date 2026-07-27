import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  confirmPickupSideAssignment,
  generatePickupSideAssignment,
  startMatch,
  swapPickupMatchPlayers,
} from "../src/data/repository.js";
import {
  buildPickupTeamAssignment,
  getPickupOpenSlotPlacements,
  getPickupParticipantIds,
  getPickupParticipants,
  getPickupRerollState,
  getPickupTeamAssignmentPolicy,
  getPostgameRecordVerification,
  getRoomPhaseViewModel,
  isMatchPregameSlotManagementOpen,
  isMatchRecordParticipantSetupOpen,
} from "../src/lib/roomFlow.js";
import { getMatchSideLeaderId } from "../src/lib/matchUtils.js";
import { getMatchConfigurationChangePatch, getMatchCreationPolicyPayload } from "../src/lib/matchCreationPolicies.js";
import { getRecruitingLobby } from "../src/lib/recruiting.js";

test("cancelled instant rooms stay visible for their calendar date", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const { matchesRecruitingScheduleDate } = await vite.ssrLoadModule("/src/pages/Matches.jsx");
    const cancelledInstant = {
      status: "cancelled",
      timingType: "instant",
      scheduledAt: "즉시",
      createdAt: "2026-07-28T09:00:00.000Z",
    };
    const openInstant = { ...cancelledInstant, status: "open" };

    assert.equal(matchesRecruitingScheduleDate(cancelledInstant, "2026-07-28"), true);
    assert.equal(matchesRecruitingScheduleDate(cancelledInstant, "2026-07-27"), false);
    assert.equal(matchesRecruitingScheduleDate(openInstant, "2026-07-28"), false);
    assert.equal(matchesRecruitingScheduleDate(openInstant, ""), true);
  } finally {
    await vite.close();
  }
});

test("경기 목적과 팀 구성은 독립 필드이고 레거시 matchIntent만 호환용으로 만든다", () => {
  const competitive = getMatchConfigurationChangePatch({}, { matchPurpose: "competitive", formationMode: "prearranged" });
  assert.equal(competitive.matchPurpose, "competitive");
  assert.equal(competitive.formationMode, "prearranged");
  assert.equal(competitive.matchIntent, "standard_competitive");
  const pickup = getMatchCreationPolicyPayload({ ...competitive, formationMode: "pickup" });
  assert.equal(pickup.matchPurpose, "competitive");
  assert.equal(pickup.formationMode, "pickup");
  assert.equal(pickup.ranked, true);
});

test("픽업 모집은 A/B 대신 통합 참가자 풀을 표시한다", () => {
  const view = getRoomPhaseViewModel({ post: { formationMode: "pickup" } });
  assert.equal(view.showParticipantPool, true);
  assert.equal(view.showVersusStage, false);
  assert.deepEqual(view.sectionOrder, ["participantPool"]);
  const lobby = { entries: [
    { id: "first", status: "ready", players: ["a"], reserves: ["b"] },
    { id: "second", status: "waiting", players: ["a", "c"] },
  ] };
  assert.deepEqual(getPickupParticipantIds(lobby), ["a", "b", "c"]);
  assert.deepEqual(getPickupParticipants(lobby).map(({ playerId, entry, reserve }) => ({
    playerId,
    entryId: entry.id,
    reserve,
  })), [
    { playerId: "a", entryId: "first", reserve: false },
    { playerId: "b", entryId: "first", reserve: true },
    { playerId: "c", entryId: "second", reserve: false },
  ]);
  assert.deepEqual(getPickupOpenSlotPlacements({
    entries: [
      { side: "teamA", players: ["host"], reserves: [] },
    ],
  }, { sideCapacity: 3, benchCapacity: 3 }), [
    { side: "teamB", reserve: false },
    { side: "teamA", reserve: false },
    { side: "teamB", reserve: false },
    { side: "teamA", reserve: false },
    { side: "teamB", reserve: false },
    { side: "teamA", reserve: true },
    { side: "teamB", reserve: true },
    { side: "teamA", reserve: true },
    { side: "teamB", reserve: true },
    { side: "teamA", reserve: true },
    { side: "teamB", reserve: true },
  ]);
});

test("픽업 체크인은 배정 확정 전 A/B 작업대를 표시한다", () => {
  const match = { status: "agreed", timingType: "instant", formationMode: "pickup", rules: {} };
  const view = getRoomPhaseViewModel({ match });
  assert.equal(view.mode, "pickup_assignment");
  assert.equal(view.showVersusStage, true);
  assert.equal(view.assignmentConfirmed, false);
});

test("슬롯 관리는 경기 시작 전까지만 열린다", () => {
  const pregame = { status: "agreed", timingType: "instant" };
  assert.equal(isMatchPregameSlotManagementOpen(pregame), true);
  assert.equal(isMatchPregameSlotManagementOpen({ ...pregame, startedAt: "2026-07-25T10:00:00.000Z" }), false);
  assert.equal(isMatchPregameSlotManagementOpen({
    ...pregame,
    startedAt: "2026-07-25T10:00:00.000Z",
    endedAt: "2026-07-25T11:00:00.000Z",
  }), false);
  assert.equal(isMatchPregameSlotManagementOpen({
    ...pregame,
    rules: { recordType: "match_record" },
    startedAt: "2026-07-25T10:00:00.000Z",
    endedAt: "2026-07-25T11:00:00.000Z",
  }), false);
});

test("사후 경기기록방 출전자 확인은 명단 확정 전까지만 열린다", () => {
  const recordRoom = {
    status: "agreed",
    rules: { recordType: "match_record", recordSetupReady: false },
    startedAt: "2026-07-25T10:00:00.000Z",
    endedAt: "2026-07-25T11:00:00.000Z",
  };
  assert.equal(isMatchRecordParticipantSetupOpen(recordRoom), true);
  assert.equal(isMatchRecordParticipantSetupOpen({
    ...recordRoom,
    rules: { ...recordRoom.rules, recordSetupReady: true },
  }), false);
  assert.equal(isMatchRecordParticipantSetupOpen({ ...recordRoom, result: { scoreA: 21, scoreB: 18 } }), false);
});

test("pickup random and MMR modes create complete deterministic drafts", () => {
  const playerIds = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const users = playerIds.map((id, index) => ({
    id,
    ratings: { integrated: 900 + index * 100 },
  }));
  const randomFirst = buildPickupTeamAssignment({
    playerIds,
    users,
    sideCapacity: 3,
    benchCapacity: 1,
    mode: "random",
    seed: "room:1",
  });
  const randomSecond = buildPickupTeamAssignment({
    playerIds,
    users,
    sideCapacity: 3,
    benchCapacity: 1,
    mode: "random",
    seed: "room:1",
  });
  assert.deepEqual(randomFirst, randomSecond);
  assert.equal(randomFirst.teamA.active.length, 3);
  assert.equal(randomFirst.teamB.active.length, 3);
  assert.equal(randomFirst.teamA.reserve.length, 1);
  assert.equal(randomFirst.teamB.reserve.length, 1);

  const hostAnchored = buildPickupTeamAssignment({
    playerIds: ["host", "p2", "p3", "p4"],
    users: [
      { id: "host", ratings: { integrated: 1000 } },
      { id: "p2", ratings: { integrated: 1050 } },
      { id: "p3", ratings: { integrated: 1100 } },
      { id: "p4", ratings: { integrated: 1150 } },
    ],
    sideCapacity: 2,
    benchCapacity: 0,
    mode: "random",
    seed: "seed:0",
    hostPlayerId: "host",
  });
  assert.deepEqual(hostAnchored.teamA.active, ["p2", "host"]);
  assert.deepEqual(hostAnchored.teamB.active, ["p4", "p3"]);

  const mmrHostAnchored = buildPickupTeamAssignment({
    playerIds: ["host", "p2", "p3", "p4", "p5", "p6"],
    users: ["host", "p2", "p3", "p4", "p5", "p6"].map((id, index) => ({
      id,
      ratings: { integrated: 800 + index * 170 },
    })),
    sideCapacity: 3,
    benchCapacity: 0,
    mode: "mmr_balanced",
    hostPlayerId: "host",
  });
  assert.equal(mmrHostAnchored.teamA.active.includes("host"), true);
  assert.equal(mmrHostAnchored.teamB.active.includes("host"), false);

  const balanced = buildPickupTeamAssignment({
    playerIds: playerIds.slice(0, 6),
    users,
    sideCapacity: 3,
    benchCapacity: 0,
    mode: "mmr_balanced",
    seed: "room:2",
  });
  const teamATotal = [...balanced.teamA.active, ...balanced.teamA.reserve]
    .reduce((sum, id) => sum + users.find((user) => user.id === id).ratings.integrated, 0);
  const teamBTotal = [...balanced.teamB.active, ...balanced.teamB.reserve]
    .reduce((sum, id) => sum + users.find((user) => user.id === id).ratings.integrated, 0);
  assert.equal(balanced.teamA.active.length, 3);
  assert.equal(balanced.teamB.active.length, 3);
  assert.ok(Math.abs(teamATotal - teamBTotal) <= 100);
});

test("pickup assignment uses checked-in players and limits paid rerolls to two distinct users", () => {
  const users = ["host", "p2", "p3", "p4", "absent1", "absent2"].map((id, index) => ({
    id,
    name: id,
    trustScore: 10,
    ratings: { integrated: 1000 + index * 50 },
  }));
  const match = {
    id: "pickup-attendance",
    title: "2v2 경쟁 픽업",
    createdBy: "host",
    mode: "2v2",
    status: "agreed",
    timingType: "instant",
    ranked: true,
    formationMode: "pickup",
    matchIntent: "pickup",
    teamA: { players: ["host", "p2"], teamId: "old-a", playerTeams: {} },
    teamB: { players: ["p3", "p4"], teamId: "old-b", playerTeams: {} },
    reservePlayers: { teamA: ["absent1"], teamB: ["absent2"] },
    attendance: { teamA: ["host", "p2"], teamB: ["p3", "p4"] },
    agreements: { teamA: ["host", "p2"], teamB: ["p3", "p4"] },
    rules: {
      formationMode: "pickup",
      matchIntent: "pickup",
      sideCapacity: 2,
      benchCapacity: 1,
      recruitingPostId: "pickup-post",
    },
  };
  const initialState = {
    currentUserId: "host",
    users,
    teams: [],
    matches: [match],
    recruitingPosts: [{ id: "pickup-post", roomState: { chatMessages: [] } }],
    notifications: [],
    settings: {},
  };

  const generated = generatePickupSideAssignment(initialState, match.id, "random");
  const generatedMatch = generated.matches[0];
  assert.equal(getPickupTeamAssignmentPolicy(generatedMatch).label, "완전 랜덤 배치");
  assert.equal(generatedMatch.rules.ratingScale, 1);
  assert.deepEqual(
    [...generatedMatch.teamA.players, ...generatedMatch.teamB.players].sort(),
    ["host", "p2", "p3", "p4"],
  );
  assert.equal(generatedMatch.teamA.players.includes("host"), true);
  assert.deepEqual(generatedMatch.reservePlayers, { teamA: [], teamB: [] });
  assert.equal(generated.users.find((user) => user.id === "host").trustScore, 10);

  const firstReroll = generatePickupSideAssignment({ ...generated, currentUserId: "p2" }, match.id, "random");
  assert.equal(getPickupRerollState(firstReroll.matches[0], "p2").count, 1);
  assert.equal(getPickupRerollState(firstReroll.matches[0], "p2").usedByCurrentUser, true);
  assert.equal(firstReroll.users.find((user) => user.id === "p2").trustScore, 9);
  assert.match(firstReroll.recruitingPosts[0].roomState.chatMessages[0].body, /신뢰도 1점/);

  const duplicateReroll = generatePickupSideAssignment(firstReroll, match.id, "random");
  assert.equal(duplicateReroll.matches[0].rules.pickupRerollCount, 1);

  const secondReroll = generatePickupSideAssignment({ ...firstReroll, currentUserId: "p3" }, match.id, "random");
  assert.equal(getPickupRerollState(secondReroll.matches[0], "p3").count, 2);
  assert.equal(secondReroll.users.find((user) => user.id === "p3").trustScore, 9);
  const blockedThird = generatePickupSideAssignment({ ...secondReroll, currentUserId: "p4" }, match.id, "random");
  assert.equal(blockedThird.matches[0].rules.pickupRerollCount, 2);
});

test("픽업 방장 또는 심판은 출석 후 두 참가자의 A/B·출전·대기 자리를 교환하고 확정한다", () => {
  const users = ["host", "a2", "b1", "b2", "ra", "rb", "ref"].map((id) => ({
    id,
    name: id,
    trustScore: id === "ref" ? 100 : 90,
    officialReferee: id === "ref",
  }));
  const match = {
    id: "pickup-match",
    title: "2v2 픽업",
    createdBy: "host",
    mode: "2v2",
    status: "agreed",
    timingType: "instant",
    formationMode: "pickup",
    matchIntent: "pickup",
    teamA: { name: "이전 팀 A", teamId: "legacy-a", playerTeams: { host: "legacy-a" }, players: ["host", "a2"] },
    teamB: { name: "이전 팀 B", teamId: "legacy-b", playerTeams: { b1: "legacy-b" }, players: ["b1", "b2"] },
    reservePlayers: { teamA: ["ra"], teamB: ["rb"] },
    attendance: { teamA: ["host", "a2", "ra"], teamB: ["b1", "b2", "rb"] },
    agreements: { teamA: ["host", "a2", "ra"], teamB: ["b1", "b2", "rb"] },
    approvals: { teamA: [], teamB: [] },
    parties: [{ teamId: "legacy-a", players: ["host", "a2"] }],
    rules: {
      formationMode: "pickup",
      matchIntent: "pickup",
      sideCapacity: 2,
      sideAssignmentStatus: "pending",
    },
  };
  const state = { currentUserId: "host", users, teams: [], matches: [match], notifications: [], settings: {} };
  const pendingConfirm = confirmPickupSideAssignment(state, match.id, { rotationMode: "manual" });
  assert.equal(pendingConfirm.matches[0].rules.sideAssignmentStatus, "pending");
  const draftMatch = {
    ...match,
    rules: {
      ...match.rules,
      pickupTeamAssignmentMode: "manual",
      sideAssignmentStatus: "draft",
      sideAssignmentRevision: 1,
    },
  };
  const draftState = { ...state, matches: [draftMatch] };

  assert.equal(startMatch(draftState, match.id).matches[0].startedAt, undefined);
  const deniedSwap = swapPickupMatchPlayers({ ...draftState, currentUserId: "a2" }, match.id, "host", "b1");
  assert.equal(deniedSwap.matches[0], draftMatch);
  const deniedReserveSwap = swapPickupMatchPlayers({ ...draftState, currentUserId: "ra" }, match.id, "host", "b1");
  assert.equal(deniedReserveSwap.matches[0], draftMatch);
  const refereeMatch = { ...draftMatch, refereeId: "ref", refereeTrustMin: 90 };
  const refereeSwap = swapPickupMatchPlayers({
    ...draftState,
    currentUserId: "ref",
    matches: [refereeMatch],
  }, match.id, "host", "b1");
  assert.deepEqual(refereeSwap.matches[0].teamA.players, ["b1", "a2"]);

  const activeSwap = swapPickupMatchPlayers(draftState, match.id, "host", "b1");
  assert.deepEqual(activeSwap.matches[0].teamA.players, ["b1", "a2"]);
  assert.deepEqual(activeSwap.matches[0].teamB.players, ["host", "b2"]);
  assert.deepEqual(activeSwap.matches[0].attendance, {
    teamA: ["a2", "ra", "b1"],
    teamB: ["b2", "rb", "host"],
  });
  assert.equal(activeSwap.matches[0].teamA.teamId, null);
  assert.equal(activeSwap.matches[0].teamB.teamId, null);
  assert.deepEqual(activeSwap.matches[0].parties, []);

  const reserveSwap = swapPickupMatchPlayers(activeSwap, match.id, "a2", "rb");
  assert.deepEqual(reserveSwap.matches[0].teamA.players, ["b1", "rb"]);
  assert.deepEqual(reserveSwap.matches[0].reservePlayers, { teamA: ["ra"], teamB: ["a2"] });

  const confirmed = confirmPickupSideAssignment(reserveSwap, match.id, { rotationMode: "manual" });
  assert.equal(confirmed.matches[0].rules.sideAssignmentStatus, "confirmed");
  const started = startMatch(confirmed, match.id);
  assert.ok(started.matches[0].startedAt);
});

test("사후 기록은 이의시간 전에는 부분 확인, 만료 뒤에는 자동 승인한다", () => {
  const record = {
    teamA: { players: ["a", "b"] },
    teamB: { players: ["c", "d"] },
    result: { submittedAt: "2026-07-26T00:00:00.000Z" },
    rules: { participantAcceptedIds: ["a", "b", "c"] },
    approvals: { teamA: ["a", "b"], teamB: ["c"] },
  };
  const status = getPostgameRecordVerification(record, { now: "2026-07-26T00:10:00.000Z" });
  assert.equal(status.verificationStatus, "partial");
  assert.equal(status.canConfirmFully, false);
  assert.deepEqual(status.unconfirmedIds, ["d"]);
  const expired = getPostgameRecordVerification(record, { now: "2026-07-26T00:15:00.000Z" });
  assert.equal(expired.verificationStatus, "confirmed");
  assert.equal(expired.canAutoApprove, true);
  assert.deepEqual(expired.unconfirmedIds, []);
});

test("픽업 팀 나누기 작업판은 공용 모달 안에서 전용 반응형 grid를 사용한다", () => {
  const recruitingSource = readFileSync(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8");
  const recruitingStyles = readFileSync(new URL("../src/styles/recruiting-arena.css", import.meta.url), "utf8");

  assert.match(recruitingSource, /arena-host-kick-panel\$\{pickupAssignmentMode \? " is-pickup-assignment" : ""\}/);
  assert.match(recruitingStyles, /\.arena-host-kick-panel\.is-pickup-assignment \.arena-host-kick-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
  assert.match(recruitingStyles, /\.pickup-rotation-panel \.ui-status-strip\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/s);
  assert.match(recruitingStyles, /\.pickup-rotation-panel \.arena-room-edit-actions > \.button\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/s);
  assert.match(recruitingStyles, /\.arena-lobby-modal \.arena-lobby-actions > div\s*\{[^}]*min-height:\s*var\(--ui-button-height\);/s);
  assert.match(recruitingStyles, /\.arena-host-kick-panel\.is-pickup-assignment \.arena-host-kick-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(recruitingStyles, /\.pickup-rotation-panel \.arena-room-edit-actions\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,/s);
  assert.match(recruitingSource, /sideLeader:\s*\{\s*tone:\s*"captain",\s*label:\s*"사이드장"\s*\}/);
  assert.match(recruitingSource, /const slotTrackCount = Math\.max\(1,\s*Number\(side\.capacity\) \|\| activeSlots\.length \|\| 1\)/);
  assert.match(recruitingSource, /displayedSideLeaderId = \([\s\S]*playerId === hostPlayerId[\s\S]*\) \? "" : sideLeaderId/);
  assert.match(recruitingSource, /showCaptainBadge=\{!sourceMatch && showCaptainBadge\}/);
  assert.equal(getMatchSideLeaderId({
    createdBy: "host",
    teamA: { players: ["other", "host"] },
    reservePlayers: { teamA: [] },
    parties: [],
  }, [], "teamA"), "host");
  assert.doesNotMatch(recruitingSource, /selfRow \? <span className="form-chip">본인<\/span>/);
});

test("확정 픽업 방모달은 실제 A/B 출전·후보 명단을 그대로 표시한다", async () => {
  const { createServer } = await import("vite");
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const { getMatchRoomPost } = await vite.ssrLoadModule("/src/pages/Matches.jsx");
    const userIds = ["host", "a1", "a2", "a3", "b1", "b2", "b3", "ra", "rb"];
    const users = userIds.map((id) => ({ id, name: id }));
    const sourcePost = {
      id: "pickup-room-post",
      title: "3v3 픽업",
      playerId: "host",
      ownerId: "host",
      hostSide: "teamA",
      hostJoinMode: "player",
      sideCapacity: 3,
      benchCapacity: 1,
      formationMode: "pickup",
      matchIntent: "pickup",
      applicants: [],
      roomState: { ownerId: "host", hostReserve: false },
    };
    const match = {
      id: "pickup-room-match",
      recruitingPostId: sourcePost.id,
      title: sourcePost.title,
      createdBy: "host",
      mode: "3v3",
      status: "agreed",
      formationMode: "pickup",
      matchIntent: "pickup",
      teamA: { players: ["a1", "a2", "a3"], teamId: null },
      teamB: { players: ["b1", "host", "b2"], teamId: null },
      reservePlayers: { teamA: ["ra"], teamB: ["rb"] },
      parties: [{ side: "teamA", players: ["host", "a1"] }],
      rules: {
        formationMode: "pickup",
        matchIntent: "pickup",
        sideCapacity: 3,
        benchCapacity: 1,
        sideAssignmentStatus: "confirmed",
        sideAssignmentRevision: 1,
      },
      createdAt: "2026-07-25T00:00:00.000Z",
    };
    const state = {
      currentUserId: "host",
      users,
      teams: [],
      matches: [match],
      recruitingPosts: [sourcePost],
      settings: {},
    };

    const roomPost = getMatchRoomPost(match, state);
    const lobby = getRecruitingLobby(roomPost, state);
    assert.equal(roomPost.hostSide, "teamB");
    assert.equal(roomPost.roomState.hostReserve, false);
    assert.deepEqual([...lobby.sides.teamA.projectedPlayers].sort(), ["a1", "a2", "a3"]);
    assert.deepEqual([...lobby.sides.teamB.projectedPlayers].sort(), ["b1", "b2", "host"]);
    assert.equal(lobby.sides.teamA.projectedPlayers.includes("host"), false);

    const reserveMatch = {
      ...match,
      teamB: { players: ["b1", "b2", "b3"], teamId: null },
      reservePlayers: { teamA: ["ra"], teamB: ["host"] },
    };
    const reserveState = { ...state, matches: [reserveMatch] };
    const reserveRoomPost = getMatchRoomPost(reserveMatch, reserveState);
    const reserveLobby = getRecruitingLobby(reserveRoomPost, reserveState);
    assert.equal(reserveRoomPost.hostSide, "teamB");
    assert.equal(reserveRoomPost.roomState.hostReserve, true);
    assert.deepEqual([...reserveLobby.sides.teamB.projectedPlayers].sort(), ["b1", "b2", "b3"]);
    assert.equal(
      reserveLobby.sides.teamB.reserveCandidates.some((candidate) => candidate.playerId === "host"),
      true,
    );
  } finally {
    await vite.close();
  }
});
