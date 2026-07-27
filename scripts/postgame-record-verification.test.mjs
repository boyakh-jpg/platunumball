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
  const status = getPostgameRecordVerification(match, { now: "2026-07-23T00:10:00.000Z" });
  assert.equal(status.verificationStatus, "partial");
  assert.equal(status.canConfirmFully, false);
  assert.equal(status.canAutoApprove, false);
  assert.deepEqual(status.unconfirmedIds, [players[13]]);
  assert.deepEqual(status.playerStatExcludedIds, [players[13]]);
});

test("이의시간이 지나고 열린 이의가 없으면 무응답자도 자동 승인한다", () => {
  const match = makeRecord({
    rules: { recordType: "match_record", participantAcceptedIds: players.slice(0, 13) },
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
  });
  const status = getPostgameRecordVerification(match, { now: "2026-07-23T00:15:00.000Z" });
  assert.equal(status.expired, true);
  assert.equal(status.requiresReview, false);
  assert.equal(status.verificationStatus, "confirmed");
  assert.deepEqual(status.unconfirmedIds, []);
  assert.deepEqual(status.playerStatEligibleIds, players);
  assert.equal(status.canConfirmFully, true);
  assert.equal(status.canAutoApprove, true);
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
  const status = getPostgameRecordVerification(match, { now: "2026-07-23T00:10:00.000Z" });
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

test("즉시·5분 알림은 미확인자에게만 보내고 중복 전송하지 않는다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
    recordNotificationSentKeys: ["postgame_record_approval_0m"],
  });
  const notifications = getDuePostgameRecordNotifications(match, { now: "2026-07-23T00:06:00.000Z" });
  assert.deepEqual(notifications.map((event) => event.afterMinutes), [5]);
  assert.ok(notifications.every((event) => event.targetUserIds.length === 1));
  assert.ok(notifications.every((event) => event.targetUserIds[0] === players[13]));
});

test("이의시간 만료 후에는 승인 독촉 알림을 더 만들지 않는다", () => {
  const match = makeRecord({
    approvals: { teamA: players.slice(0, 7), teamB: players.slice(7, 13) },
  });
  const notifications = getDuePostgameRecordNotifications(match, { now: "2026-07-23T00:15:00.000Z" });
  assert.deepEqual(notifications, []);
});

test("별도 참가 확인 경로를 닫고 최종 승인 한 번과 이의시간 자동 확정을 사용한다", async () => {
  const [serverSource, clientSource, singleApprovalMigration, consistencyMigration] = await Promise.all([
    readFile(new URL("../server/api/matches/sync-match.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useAppData.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260723114000_match_record_single_final_approval.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260726090000_match_policy_consistency.sql", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(serverSource, /rankball_match_record_participation_action/);
  assert.doesNotMatch(clientSource, /confirmMatchRecordParticipation/);
  assert.match(serverSource, /MATCH_RECORD_APPROVAL_NOTICE_PREFIXES/);
  assert.match(serverSource, /POSTGAME_RECORD_REMINDER_MINUTES\.forEach/);
  assert.match(singleApprovalMigration, /match_record_participation_required/);
  assert.match(singleApprovalMigration, /execute replace/);
  assert.match(singleApprovalMigration, /recordApprovalMode/);
  assert.match(singleApprovalMigration, /recordApproverIds/);
  assert.match(singleApprovalMigration, /update public\.matches match_row/);
  assert.doesNotMatch(singleApprovalMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
  assert.match(consistencyMigration, /match_auto_finalization_not_due/);
  assert.match(consistencyMigration, /rankball_normalize_dispute_minutes\(current_match\.dispute_minutes\)/);
  assert.match(consistencyMigration, /now_at < result_submitted_at \+ make_interval/);
  assert.match(consistencyMigration, /revoke all on function public\.rankball_match_record_participation_action/);
  assert.doesNotMatch(consistencyMigration, /delete\s+from|drop\s+table|truncate\s+table/i);
});
