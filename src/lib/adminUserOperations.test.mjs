import assert from "node:assert/strict";
import test from "node:test";
import {
  getAdminUserRiskMeta,
  getAdminUserRiskSignals,
  normalizeAdminUserOperationAction,
  normalizeAdminUserOperationDuration,
  validateAdminUserOperationDraft,
} from "./adminUserOperations.js";

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
