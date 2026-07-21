import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminUserRiskMeta,
  getAdminUserRiskSignals,
  normalizeAdminUserOperationAction,
  normalizeAdminUserOperationDuration,
  validateAdminUserOperationDraft,
} from "./adminUserOperations.js";
import {
  buildAdminReviewModel,
  getAdminActionTargetUserIds,
  getAdminReportTypeLabel,
  getAdminReviewMetrics,
  isHighImpactAdminReviewAction,
} from "./admin.js";
import { reportPlayer } from "../data/repository.js";

test("manual admin user operations keep a strict action and duration allowlist", () => {
  assert.equal(normalizeAdminUserOperationAction("warning"), "warning");
  assert.equal(normalizeAdminUserOperationAction("publicRoomSuspend"), "publicRoomSuspend");
  assert.equal(normalizeAdminUserOperationAction("deleteUser"), "warning");
  assert.equal(normalizeAdminUserOperationDuration(280), 280);
  assert.equal(normalizeAdminUserOperationDuration(365), 3);
});

test("manual admin user operations require separate audit reason and user message", () => {
  assert.equal(validateAdminUserOperationDraft({ targetUserId: "u1", actionType: "warning", reason: "반복 확인", message: "운영 정책을 확인해 주세요." }), "");
  assert.match(validateAdminUserOperationDraft({ targetUserId: "u1", actionType: "deleteUser", reason: "반복 확인", message: "운영 정책을 확인해 주세요." }), /운영 조치/);
  assert.match(validateAdminUserOperationDraft({ targetUserId: "u1", actionType: "warning", reason: "", message: "운영 정책을 확인해 주세요." }), /관리 사유/);
  assert.match(validateAdminUserOperationDraft({ targetUserId: "u1", actionType: "warning", reason: "반복 확인", message: "" }), /사용자 안내/);
  assert.match(validateAdminUserOperationDraft({ targetUserId: "u1", actionType: "suspendTarget", durationDays: 365, reason: "반복 확인", message: "이용이 제한되었습니다." }), /제재 기간/);
});

test("risk metadata is explainable and does not imply automatic punishment", () => {
  assert.equal(getAdminUserRiskMeta(0).label, "일반");
  assert.equal(getAdminUserRiskMeta(10).label, "주의 신호");
  assert.equal(getAdminUserRiskMeta(30).label, "검토 필요");
  assert.equal(getAdminUserRiskMeta(60).label, "우선 검토");
  assert.deepEqual(getAdminUserRiskSignals(["low_trust", "low_trust"]).map((signal) => signal.id), ["low_trust"]);
});

test("report actions never mix the reporter into a target sanction", () => {
  const report = { by: "reporter-1", reportedUserIds: ["target-1", "referee-1"] };
  assert.deepEqual(getAdminActionTargetUserIds(report, "maliciousReporter"), ["reporter-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "suspendTarget"), ["target-1", "referee-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "refereeDiscipline", { refereeId: "referee-1" }), ["referee-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "refereeDiscipline", { formerRefereeId: "referee-1" }), ["referee-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "refereeDiscipline", { refereeId: "other" }), []);
  assert.equal(isHighImpactAdminReviewAction("suspendTarget"), true);
  assert.equal(isHighImpactAdminReviewAction("dismissReport"), false);
});

test("admin review metrics do not duplicate the same report count", () => {
  const playerMetrics = getAdminReviewMetrics("players", {
    openCount: 2,
    reportCount: 5,
    matchCount: 3,
    disciplinaryActionCount: 1,
  });
  assert.deepEqual(playerMetrics.map((metric) => metric.label), ["미처리 신고", "누적 신고", "관련 경기", "최근 제재"]);
  assert.deepEqual(playerMetrics.map((metric) => metric.value), [2, 5, 3, 1]);
  assert.equal(getAdminReportTypeLabel("court_review"), "구장 리뷰");
});

test("same-name courts remain separate review entities", () => {
  const model = buildAdminReviewModel({
    users: [],
    teams: [],
    matches: [],
    reports: [
      { id: "r1", type: "court", targetId: "court-1", reason: "위치 오류", status: "open", createdAt: "2026-07-21T01:00:00Z" },
      { id: "r2", type: "court", targetId: "court-2", reason: "상태 위험", status: "open", createdAt: "2026-07-21T02:00:00Z" },
    ],
    settings: {
      approvedCourts: [
        { id: "court-1", name: "같은 이름", addressText: "주소 1" },
        { id: "court-2", name: "같은 이름", addressText: "주소 2" },
      ],
    },
  });
  assert.equal(model.courts.length, 2);
  assert.deepEqual(model.courts.map((row) => row.id).sort(), ["court:court-1", "court:court-2"]);
});

test("player reporting creates a player report with match evidence", () => {
  const now = new Date().toISOString();
  const state = {
    currentUserId: "reporter-1",
    users: [{ id: "reporter-1", name: "신고자" }, { id: "target-1", name: "대상" }],
    matches: [{
      id: "match-1",
      title: "검증 경기",
      scheduledAt: now,
      teamA: { players: ["reporter-1"] },
      teamB: { players: ["target-1"] },
    }],
    reports: [],
    notifications: [],
    settings: {},
  };
  const next = reportPlayer(state, "target-1", "match-1", "폭언 검증 메모");
  assert.equal(next.reports[0].type, "player");
  assert.equal(next.reports[0].targetId, "target-1");
  assert.equal(next.reports[0].sourceMatchId, "match-1");
  assert.deepEqual(next.reports[0].reportedUserIds, ["target-1"]);
});
