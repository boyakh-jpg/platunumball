import { REPORT_TARGET_TYPES } from "./reportReasons.js";

const CONTEXTUAL_TARGET_TYPES = new Set([
  REPORT_TARGET_TYPES.match,
  REPORT_TARGET_TYPES.player,
]);

export function buildReportEntryPath({ targetType = "", targetId = "", sourceMatchId = "" } = {}) {
  const params = new URLSearchParams({ focus: "report" });
  if (CONTEXTUAL_TARGET_TYPES.has(targetType) && targetId) {
    params.set("targetType", targetType);
    params.set("targetId", String(targetId));
    if (sourceMatchId) params.set("sourceMatchId", String(sourceMatchId));
  }
  return `/app/settings?${params.toString()}`;
}

export function parseReportEntry(search = "") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  const targetType = params.get("targetType") ?? "";
  const targetId = params.get("targetId") ?? "";
  return {
    focus: params.get("focus") === "report",
    targetType: CONTEXTUAL_TARGET_TYPES.has(targetType) && targetId ? targetType : "",
    targetId: CONTEXTUAL_TARGET_TYPES.has(targetType) ? targetId : "",
    sourceMatchId: params.get("sourceMatchId") ?? "",
  };
}

export function isReportTargetCompatible(entryTargetType, reportTargetType) {
  if (!entryTargetType || !reportTargetType) return true;
  if (entryTargetType === REPORT_TARGET_TYPES.player) {
    return [REPORT_TARGET_TYPES.player, REPORT_TARGET_TYPES.mixed].includes(reportTargetType);
  }
  if (entryTargetType === REPORT_TARGET_TYPES.match) {
    return [REPORT_TARGET_TYPES.match, REPORT_TARGET_TYPES.mixed].includes(reportTargetType);
  }
  return false;
}

export function getCurrentUserReports(reports = [], userId = "") {
  return reports.filter((report) => report.by === userId);
}

export function getOpenReportCount(reports = [], userId = "") {
  return getCurrentUserReports(reports, userId).filter((report) => report.status === "open").length;
}
