import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminUserRiskMeta,
  getAdminUserRiskSignals,
  mergeAdminRoomRemakeStats,
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
import { commitAdminReviewAction, reportPlayer } from "../data/repository.js";

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
  assert.equal(getAdminUserRiskSignals(["excessive_room_remake"])[0].label, "방 다시 만들기 주의");
});

test("room remake statistics add an explainable admin review signal", () => {
  const merged = mergeAdminRoomRemakeStats({
    ok: true,
    summary: { signalUsers: 0 },
    rows: [],
    page: { total: 0 },
  }, {
    ok: true,
    summary: {
      roomRemakeCount: 3,
      roomRemakeCount30d: 3,
      roomRemakeUsers: 1,
      roomRemakeRepeatUsers: 1,
      roomRemakeReviewUsers: 1,
    },
    rows: [{
      id: "host",
      name: "방장",
      roomRemakeCount: 3,
      roomRemakeCount30d: 3,
      maxRoomRemakeSequence: 3,
      lastRoomRemakeAt: "2026-07-24T12:00:00.000Z",
      riskScore: 0,
      riskSignals: [],
    }],
  });

  assert.equal(merged.rows[0].riskScore, 25);
  assert.deepEqual(merged.rows[0].riskSignals, ["excessive_room_remake"]);
  assert.equal(merged.summary.roomRemakeReviewUsers, 1);
  assert.equal(merged.page.total, 1);
});

test("report actions never mix the reporter into a target sanction", () => {
  const report = { by: "reporter-1", reportedUserIds: ["target-1", "referee-1"] };
  assert.deepEqual(getAdminActionTargetUserIds(report, "maliciousReporter"), ["reporter-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "suspendTarget"), ["target-1", "referee-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "refereeDiscipline", { refereeId: "referee-1" }), ["referee-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "refereeDiscipline", { formerRefereeId: "referee-1" }), ["referee-1"]);
  assert.deepEqual(getAdminActionTargetUserIds(report, "refereeDiscipline", { refereeId: "other" }), []);
  assert.equal(isHighImpactAdminReviewAction("suspendTarget"), true);
  assert.equal(isHighImpactAdminReviewAction("markCourtDuplicate"), true);
  assert.equal(isHighImpactAdminReviewAction("dismissReport"), false);
});

test("duplicate court report resolution disables the court in local fallback", () => {
  const state = {
    currentUserId: "admin-1",
    users: [{ id: "admin-1", name: "관리자" }],
    teams: [],
    affiliations: [],
    reports: [{
      id: "report-1",
      type: "court",
      targetId: "court-1",
      by: "reporter-1",
      status: "open",
      courtCorrection: { field: "duplicate", proposedValue: "중복 구장" },
      createdAt: "2026-07-27T00:00:00.000Z",
    }],
    notifications: [],
    settings: {
      approvedCourts: [{ id: "court-1", name: "중복 구장", status: "active", adminReviewCount: 0 }],
      adminAppointments: [{
        id: "appointment-1",
        source: "server_context",
        userId: "admin-1",
        role: "admin",
        grade: "matchManager",
        status: "active",
      }],
      adminAuditLog: [],
      adminDisciplinaryActions: [],
    },
  };
  const next = commitAdminReviewAction(state, {
    reportId: "report-1",
    actionType: "markCourtDuplicate",
    reason: "중복 구장 현장 확인",
    feedback: "중복 구장으로 확인되어 노출에서 제외했습니다.",
  });
  assert.equal(next.reports[0].status, "resolved");
  assert.equal(next.reports[0].resolution.actionType, "markCourtDuplicate");
  assert.equal(next.settings.approvedCourts[0].status, "disabled");
  assert.equal(next.settings.approvedCourts[0].verificationStatus, "verified");
  assert.equal(next.settings.approvedCourts[0].adminReviewScenario, "duplicate");
  assert.equal(next.settings.approvedCourts[0].adminReviewCount, 1);
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
