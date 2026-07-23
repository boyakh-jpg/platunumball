import assert from "node:assert/strict";
import test from "node:test";
import { confirmPickupSideAssignment, startMatch, swapPickupMatchPlayers } from "../src/data/repository.js";
import { getPickupOpenSlotPlacements, getPickupParticipantIds, getPickupParticipants, getPostgameRecordVerification, getRoomPhaseViewModel } from "../src/lib/roomFlow.js";
import { getMatchConfigurationChangePatch, getMatchCreationPolicyPayload } from "../src/lib/matchCreationPolicies.js";

test("경기 목적과 팀 구성은 독립 필드이고 레거시 matchIntent만 호환용으로 만든다", () => {
  const competitive = getMatchConfigurationChangePatch({}, { matchPurpose: "competitive", formationMode: "prearranged" });
  assert.equal(competitive.matchPurpose, "competitive");
  assert.equal(competitive.formationMode, "prearranged");
  assert.equal(competitive.matchIntent, "standard_competitive");
  const pickup = getMatchCreationPolicyPayload({ ...competitive, formationMode: "pickup" });
  assert.equal(pickup.matchPurpose, "friendly");
  assert.equal(pickup.formationMode, "pickup");
  assert.equal(pickup.ranked, false);
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

  assert.equal(startMatch(state, match.id).matches[0].startedAt, undefined);
  const deniedSwap = swapPickupMatchPlayers({ ...state, currentUserId: "a2" }, match.id, "host", "b1");
  assert.equal(deniedSwap.matches[0], match);
  const deniedReserveSwap = swapPickupMatchPlayers({ ...state, currentUserId: "ra" }, match.id, "host", "b1");
  assert.equal(deniedReserveSwap.matches[0], match);
  const refereeMatch = { ...match, refereeId: "ref", refereeTrustMin: 90 };
  const refereeSwap = swapPickupMatchPlayers({
    ...state,
    currentUserId: "ref",
    matches: [refereeMatch],
  }, match.id, "host", "b1");
  assert.deepEqual(refereeSwap.matches[0].teamA.players, ["b1", "a2"]);

  const activeSwap = swapPickupMatchPlayers(state, match.id, "host", "b1");
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

test("사후 기록은 무응답자를 자동 승인하지 않는다", () => {
  const status = getPostgameRecordVerification({
    teamA: { players: ["a", "b"] },
    teamB: { players: ["c", "d"] },
    rules: { participantAcceptedIds: ["a", "b", "c"] },
    approvals: { teamA: ["a", "b"], teamB: ["c"] },
  });
  assert.equal(status.verificationStatus, "partial");
  assert.equal(status.canConfirmFully, false);
  assert.deepEqual(status.unconfirmedIds, ["d"]);
});
