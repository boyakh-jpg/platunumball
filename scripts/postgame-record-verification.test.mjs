import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getDuePostgameRecordNotifications,
  getPostgameRecordDecisionEligibility,
  getPostgameRecordVerification,
} from "../src/lib/postgameRecordVerification.js";

const submittedAt = "2026-07-23T00:00:00.000Z";
const players = Array.from({ length: 14 }, (_item, index) => `player-${index + 1}`);

function makeRecord(overrides = {}) {
  return {
    status: "approval",
    recordType: "match_record",
    ranked: true,
    createdBy: players[0],
    teamA: { players: players.slice(0, 7) },
    teamB: { players: players.slice(7) },
    result: { scoreA: 21, scoreB: 18, submittedAt },
    rules: {
      recordType: "match_record",
      participantAcceptedIds: players,
    },
    approvals: {
      teamA: players.slice(0, 7),
      teamB: players.slice(7),
    },
    ...overrides,
  };
}

test("14명 중 13명만 승인하면 전체 확정하지 않는다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
  });
  const status = getPostgameRecordVerification(match, { now: "2026-07-23T23:00:00.000Z" });
  assert.equal(status.verificationStatus, "partial");
  assert.equal(status.canConfirmFully, false);
  assert.equal(status.canAutoApprove, false);
  assert.deepEqual(status.unconfirmedIds, [players[13]]);
  assert.deepEqual(status.playerStatExcludedIds, [players[13]]);
});

test("24시간이 지나도 무응답자를 자동 승인하지 않고 부분 검증으로 남긴다", () => {
  const match = makeRecord({
    rules: { recordType: "match_record", participantAcceptedIds: players.slice(0, 13) },
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
  });
  const status = getPostgameRecordVerification(match, { now: "2026-07-24T00:00:00.000Z" });
  assert.equal(status.expired, true);
  assert.equal(status.requiresReview, true);
  assert.equal(status.verificationStatus, "partial");
  assert.deepEqual(status.timedOutUnconfirmedIds, [players[13]]);
  assert.equal(status.canConfirmFully, false);
});

test("명시적으로 반대하면 disputed가 되고 전체 통계 확정을 막는다", () => {
  const match = makeRecord({ recordRejectedIds: [players[13]] });
  const status = getPostgameRecordVerification(match);
  assert.equal(status.verificationStatus, "disputed");
  assert.deepEqual(status.rejectedIds, [players[13]]);
  assert.equal(status.canConfirmFully, false);
  assert.ok(status.playerStatExcludedIds.includes(players[13]));
});

test("최종 승인한 실명 참가자만 개인 통계 대상이다", () => {
  const match = makeRecord({
    rules: { recordType: "match_record", participantAcceptedIds: [] },
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
  });
  const status = getPostgameRecordVerification(match);
  assert.deepEqual(status.playerStatEligibleIds, players.slice(0, 13));
  assert.deepEqual(status.participationUnconfirmedIds, [players[13]]);
  assert.deepEqual(status.playerStatExcludedIds, [players[13]]);
});

test("사후 기록은 입력값과 무관하게 개인·팀 MMR을 금지한다", () => {
  const status = getPostgameRecordVerification(makeRecord());
  assert.equal(status.verificationStatus, "confirmed");
  assert.equal(status.ranked, false);
  assert.equal(status.mmrPolicy, "forbidden");
  assert.equal(status.canApplyPersonalMmr, false);
  assert.equal(status.canApplyTeamMmr, false);
});

test("본인이 아닌 참가자의 승인 대리는 허용하지 않는다", () => {
  assert.equal(getPostgameRecordDecisionEligibility(makeRecord(), players[13]).allowed, true);
  assert.deepEqual(
    getPostgameRecordDecisionEligibility(makeRecord(), "room-owner-not-player"),
    { allowed: false, reason: "실제 참가자만 본인의 참가와 결과를 확인할 수 있음" },
  );
});

test("즉시·12시간·22시간 알림은 미확인자에게만 보내고 중복 전송하지 않는다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
    recordNotificationSentKeys: ["postgame_record_approval_0h"],
  });
  const notifications = getDuePostgameRecordNotifications(match, { now: "2026-07-23T22:30:00.000Z" });
  assert.deepEqual(notifications.map((event) => event.afterHours), [12, 22]);
  assert.ok(notifications.every((event) => event.targetUserIds.length === 1));
  assert.ok(notifications.every((event) => event.targetUserIds[0] === players[13]));
});

test("24시간 만료 후에는 승인 독촉 알림을 더 만들지 않는다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
  });
  const notifications = getDuePostgameRecordNotifications(match, { now: "2026-07-24T00:00:00.000Z" });
  assert.deepEqual(notifications, []);
});

test("기존 참가 확인과 별개로 최종 승인 한 번을 DB에서 허용한다", async () => {
  const [serverSource, legacyMigration, singleApprovalMigration] = await Promise.all([
    readFile(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260723112000_match_record_participation_confirmation.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260723114000_match_record_single_final_approval.sql", import.meta.url), "utf8"),
  ]);
  assert.match(serverSource, /rankball_match_record_participation_action/);
  assert.match(serverSource, /MATCH_RECORD_APPROVAL_NOTICE_PREFIXES/);
  assert.match(serverSource, /POSTGAME_RECORD_REMINDER_HOURS\.forEach/);
  assert.match(legacyMigration, /safe_actor_id <> safe_player_id/);
  assert.match(singleApprovalMigration, /match_record_participation_required/);
  assert.match(singleApprovalMigration, /execute replace/);
  assert.match(singleApprovalMigration, /recordApprovalMode/);
  assert.match(singleApprovalMigration, /recordApproverIds/);
  assert.match(singleApprovalMigration, /update public\.matches match_row/);
  assert.doesNotMatch(singleApprovalMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
});
