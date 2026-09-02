import assert from "node:assert/strict";
import test from "node:test";
import { REPORT_TARGET_TYPES } from "../src/lib/reportReasons.js";
import {
  buildReportEntryPath,
  getCurrentUserReports,
  getOpenReportCount,
  isReportTargetCompatible,
  parseReportEntry,
} from "../src/lib/reportEntry.js";

test("일반 신고 진입은 공용 신고 카드만 지정한다", () => {
  assert.equal(buildReportEntryPath(), "/app/settings?focus=report");
  assert.deepEqual(parseReportEntry("?focus=report"), {
    focus: true,
    targetType: "",
    targetId: "",
    sourceMatchId: "",
  });
});

test("문맥형 신고 진입은 허용한 대상과 원본 경기만 전달한다", () => {
  const path = buildReportEntryPath({
    targetType: REPORT_TARGET_TYPES.player,
    targetId: "player-1",
    sourceMatchId: "match-1",
  });
  assert.deepEqual(parseReportEntry(path.split("?")[1]), {
    focus: true,
    targetType: REPORT_TARGET_TYPES.player,
    targetId: "player-1",
    sourceMatchId: "match-1",
  });
  assert.equal(
    buildReportEntryPath({ targetType: REPORT_TARGET_TYPES.court, targetId: "court-1" }),
    "/app/settings?focus=report",
  );
});

test("선택 대상은 호환되는 사유 유형에서만 유지한다", () => {
  assert.equal(isReportTargetCompatible(REPORT_TARGET_TYPES.player, REPORT_TARGET_TYPES.player), true);
  assert.equal(isReportTargetCompatible(REPORT_TARGET_TYPES.player, REPORT_TARGET_TYPES.mixed), true);
  assert.equal(isReportTargetCompatible(REPORT_TARGET_TYPES.player, REPORT_TARGET_TYPES.match), false);
  assert.equal(isReportTargetCompatible(REPORT_TARGET_TYPES.match, REPORT_TARGET_TYPES.match), true);
  assert.equal(isReportTargetCompatible(REPORT_TARGET_TYPES.match, REPORT_TARGET_TYPES.player), false);
});

test("내 신고 내역과 검토 중 수는 현재 사용자 open 신고만 집계한다", () => {
  const reports = [
    { id: "r1", by: "me", status: "open" },
    { id: "r2", by: "me", status: "resolved" },
    { id: "r3", by: "other", status: "open" },
  ];
  assert.deepEqual(getCurrentUserReports(reports, "me").map((report) => report.id), ["r1", "r2"]);
  assert.equal(getOpenReportCount(reports, "me"), 1);
});
