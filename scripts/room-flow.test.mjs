import assert from "node:assert/strict";
import test from "node:test";
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
