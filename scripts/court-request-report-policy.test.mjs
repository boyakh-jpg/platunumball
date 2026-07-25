import assert from "node:assert/strict";
import test from "node:test";

import {
  approveCourtRequest,
  commitAdminReviewAction,
  reportCourt,
  reportCourtRequest,
} from "../src/data/repository.js";

function makeState() {
  return {
    currentUserId: "reporter-1",
    users: [
      { id: "admin", name: "관리자", trustScore: 100 },
      { id: "requester", name: "요청자", trustScore: 80 },
      { id: "reporter-1", name: "신고자 1", trustScore: 80 },
      { id: "reporter-2", name: "신고자 2", trustScore: 80 },
    ],
    teams: [],
    affiliations: [],
    matches: [],
    reports: [],
    notifications: [],
    settings: {
      approvedCourts: [],
      courtReviews: [],
      courtRequests: [{
        id: "court-request-1",
        requestedBy: "requester",
        status: "pending",
        name: "검증용 구장",
      }],
      adminAppointments: [{
        id: "admin-appointment-1",
        userId: "admin",
        role: "admin",
        grade: "owner",
        status: "active",
        source: "server_context",
      }],
      adminAuditLog: [],
      adminDisciplinaryActions: [],
      ratingPolicy: {
        trust: { falseCourtReportPenalty: 8 },
      },
    },
  };
}

function getRequester(state) {
  return state.users.find((user) => user.id === "requester");
}

function getCourtRequest(state) {
  return state.settings.courtRequests.find((request) => request.id === "court-request-1");
}

function submitReport(state, reporterId, reportId) {
  return reportCourtRequest(
    { ...state, currentUserId: reporterId },
    "court-request-1",
    "허위 구장 등록",
    { reportId },
  );
}

function decideReport(state, reportId, actionType) {
  return commitAdminReviewAction(
    { ...state, currentUserId: "admin" },
    {
      reportId,
      actionType,
      reason: "검증 결과를 확인했습니다.",
      feedback: "검토 결과를 반영했습니다.",
    },
  );
}

test("구장 요청 신고 접수만으로 요청자 신뢰도를 차감하지 않는다", () => {
  const next = submitReport(makeState(), "reporter-1", "report-1");

  assert.equal(getRequester(next).trustScore, 80);
  assert.equal(getCourtRequest(next).status, "reported");
  assert.equal(getCourtRequest(next).reportReviewPending, true);
  assert.equal(next.reports[0].id, "report-1");
  assert.equal(next.reports[0].status, "open");
  assert.ok(next.notifications.some((notification) => /신뢰도에 영향이 없습니다/.test(notification.body)));
  assert.ok(next.notifications.some((notification) => /차감되지 않습니다/.test(notification.body)));
});

test("구장 상세 snapshot만 있어도 승인 구장 신고를 만든다", () => {
  const next = reportCourt(
    makeState(),
    "approved-court-1",
    "위치·주소 수정 요청: 실제 주소를 확인해 주세요.",
    { id: "approved-court-1", name: "상세에서 불러온 구장" },
  );

  assert.equal(next.reports.length, 1);
  assert.equal(next.reports[0].type, "court");
  assert.equal(next.reports[0].targetId, "approved-court-1");
  assert.match(next.notifications[0].body, /상세에서 불러온 구장/);
});

test("승인 또는 반려된 구장 요청은 다시 신고 상태로 되돌리지 않는다", () => {
  for (const status of ["approved", "rejected"]) {
    const state = makeState();
    state.settings.courtRequests[0].status = status;
    const next = submitReport(state, "reporter-1", `report-${status}`);

    assert.equal(next.reports.length, 0);
    assert.equal(getCourtRequest(next).status, status);
    assert.match(next.notifications[0].title, /신고 불가/);
  }
});

test("관리자가 신고를 인정할 때만 정책값을 요청별 1회 차감한다", () => {
  let state = submitReport(makeState(), "reporter-1", "report-1");
  state = submitReport(state, "reporter-2", "report-2");
  state = decideReport(state, "report-1", "validReport");

  assert.equal(getRequester(state).trustScore, 72);
  assert.equal(getCourtRequest(state).status, "rejected");
  assert.equal(getCourtRequest(state).trustPenaltyApplied, true);
  assert.equal(getCourtRequest(state).trustPenaltyReportId, "report-1");

  state = decideReport(state, "report-2", "validReport");

  assert.equal(getRequester(state).trustScore, 72);
  assert.equal(getCourtRequest(state).status, "rejected");
  assert.equal(getCourtRequest(state).trustPenaltyReportId, "report-1");
});

test("신고 기각은 신뢰도를 유지하고 남은 미처리 신고에 따라 상태를 복원한다", () => {
  let state = submitReport(makeState(), "reporter-1", "report-1");
  state = submitReport(state, "reporter-2", "report-2");
  state = decideReport(state, "report-1", "dismissReport");

  assert.equal(getRequester(state).trustScore, 80);
  assert.equal(getCourtRequest(state).status, "reported");
  assert.equal(getCourtRequest(state).reportReviewPending, true);

  state = decideReport(state, "report-2", "dismissReport");

  assert.equal(getRequester(state).trustScore, 80);
  assert.equal(getCourtRequest(state).status, "pending");
  assert.equal(getCourtRequest(state).reportReviewPending, false);
});

test("신고 검토 중이거나 신고가 인정된 요청은 승인하지 않는다", () => {
  const approval = {
    addressVerified: true,
    multipleCourtsVerified: true,
  };
  const reported = submitReport(makeState(), "reporter-1", "report-1");
  const reportedApproval = approveCourtRequest(
    { ...reported, currentUserId: "admin" },
    "court-request-1",
    approval,
  );

  assert.equal(reportedApproval.settings.approvedCourts.length, 0);
  assert.equal(getCourtRequest(reportedApproval).status, "reported");

  const rejected = decideReport(reported, "report-1", "validReport");
  const rejectedApproval = approveCourtRequest(
    { ...rejected, currentUserId: "admin" },
    "court-request-1",
    approval,
  );

  assert.equal(rejectedApproval.settings.approvedCourts.length, 0);
  assert.equal(getCourtRequest(rejectedApproval).status, "rejected");
});
