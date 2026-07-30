import { getMatchPlayerIds } from "./matchUtils.js";
import { DAY_MS } from "./constants.js";
import { isHighImpactAdminReviewAction } from "../../shared/lib/adminReview.js";

export const ADMIN_PERMISSION_NOTICE = "관리자 권한이 있는 계정만 이 메뉴를 사용할 수 있습니다.";
const ADMIN_STATUS_LABELS = Object.freeze({
  resolved: "처리됨",
  dismissed: "기각됨",
  reported: "신고 검토 중",
  disputed: "이의신청 중",
  pending: "대기 중",
  approved: "승인됨",
  rejected: "반려됨",
  open: "검토 대기",
  active: "적용 중",
  hidden: "숨김 처리",
  disabled: "비활성",
  cancelled: "취소됨",
  closed: "종료됨",
  completed: "완료됨",
  void: "경기 무효",
  voided: "경기 무효",
});
export function getAdminStatusLabel(status = "") {
  return ADMIN_STATUS_LABELS[String(status ?? "").trim()] ?? "상태 확인 중";
}
export const ADMIN_GRADE_META = {
  owner: { label: "최고관리자", level: 100, defaultTermDays: 3650, scope: "전체 권한 · 1명" },
  senior: { label: "선임관리자", level: 80, defaultTermDays: 180, scope: "관리자/심판 임명" },
  regionManager: { label: "지역관리자", level: 60, defaultTermDays: 120, scope: "지역 구장/대회 관리" },
  matchManager: { label: "경기관리자", level: 50, defaultTermDays: 90, scope: "플레이어/경기 신고 처리" },
  support: { label: "보조관리자", level: 30, defaultTermDays: 30, scope: "큐 검토" },
};
const ADMIN_GRADE_ALIASES = {
  opsLead: "senior",
  moderator: "matchManager",
};
export const REFEREE_GRADE_META = {
  official: { label: "공인심판", level: 100, requirement: "공인 자격증 인증" },
  platinum: { label: "플래티넘 심판", level: 80, requirement: "경기 수행 우수 · 신고 낮음 · 추천 높음" },
  gold: { label: "골드 심판", level: 60, requirement: "안정적 경기 수행" },
  silver: { label: "실버 심판", level: 40, requirement: "기본 자격 유지" },
  candidate: { label: "자격심판", level: 20, requirement: "커뮤니티 시험/심사 통과" },
};
export const SUSPENSION_TIERS = [
  { id: "3d", label: "3일 정지", days: 3 },
  { id: "1w", label: "1주일 정지", days: 7 },
  { id: "2w", label: "2주일 정지", days: 14 },
  { id: "4w", label: "4주 정지", days: 28 },
  { id: "6w", label: "6주 정지", days: 42 },
  { id: "8w", label: "8주 정지", days: 56 },
  { id: "24w", label: "24주 정지", days: 168 },
  { id: "40w", label: "40주 정지", days: 280 },
];
export const ADMIN_REVIEW_ACTIONS = {
  applyCourtCorrection: {
    label: "제안값 반영",
    reason: "구조화된 구장 정보 수정 제안 확인",
    feedback: "제안한 구장 정보가 관리자 확인 후 반영되었습니다.",
  },
  markCourtDuplicate: {
    label: "중복 구장 확정",
    reason: "동일 시설 중복 등록 확인",
    feedback: "신고된 구장이 중복으로 확인되어 서비스 노출에서 제외되었습니다.",
  },
  keepMatchVoid: { label: "경기 무효 유지", feedback: "검토 결과 경기 무효 처리를 유지했습니다." },
  restoreMatchHalf: { label: "경기 복구 · MMR 50%", feedback: "경기를 복구하고 MMR을 50% 반영했습니다." },
  restoreMatchFull: { label: "경기 복구 · MMR 100%", feedback: "경기를 복구하고 MMR을 정상 반영했습니다." },
  validReport: { label: "신고 인정", feedback: "신고가 인정되어 조치되었습니다." },
  dismissReport: { label: "신고 기각", feedback: "확인 결과 신고가 기각되었습니다." },
  maliciousReporter: { label: "악성신고자 제재", feedback: "악성 신고로 판단되어 신고자에게 제재가 적용되었습니다." },
  suspendTarget: { label: "대상 제재", feedback: "신고 대상에게 제재가 적용되었습니다." },
  refereeDiscipline: { label: "심판 조치", feedback: "심판 권한 또는 등급 검토 조치가 등록되었습니다." },
  hideCourt: { label: "구장 숨김", feedback: "신고된 구장이 숨김 처리되었습니다." },
  hideCourtReview: { label: "구장 리뷰 숨김", feedback: "신고된 구장 리뷰가 숨김 처리되었습니다." },
  resetTeamEmblem: { label: "엠블럼 기본값 전환", feedback: "신고된 팀 엠블럼을 기본값으로 전환했습니다." },
  renameTeam: { label: "팀명 수정", feedback: "신고된 팀명을 운영 정책에 따라 수정했습니다." },
  renameAffiliation: { label: "소속명 수정", feedback: "신고된 소속명을 운영 정책에 따라 수정했습니다." },
  mergeAffiliation: { label: "소속 통합", feedback: "중복 소속을 선택한 소속으로 통합했습니다." },
};
export const ADMIN_REPORT_TYPE_META = {
  player: { label: "플레이어", section: "players" },
  match: { label: "경기", section: "matches" },
  court: { label: "승인 구장", section: "courts" },
  court_request: { label: "구장 신청", section: "courts" },
  court_review: { label: "구장 리뷰", section: "courts" },
  team_emblem: { label: "팀 엠블럼", section: "teams" },
  team_name: { label: "팀명", section: "teams" },
  affiliation_name: { label: "소속명", section: "teams" },
};
export function getAdminReportTypeLabel(type = "") {
  return ADMIN_REPORT_TYPE_META[type]?.label ?? "기타 신고";
}
export function getAdminActionTargetUserIds(report = {}, actionType = "", match = {}) {
  const safeReport = report ?? {};
  if (actionType === "maliciousReporter") return [safeReport.by].filter(Boolean);
  const reportedUserIds = [...new Set(safeReport.reportedUserIds ?? [])].filter(Boolean);
  if (actionType === "suspendTarget") return reportedUserIds;
  if (actionType === "refereeDiscipline") {
    const refereeIds = [match?.refereeId, match?.formerRefereeId].filter(Boolean);
    return refereeIds.filter((refereeId) => reportedUserIds.includes(refereeId));
  }
  return [];
}
export function getAdminReviewMetrics(view = "players", row = {}) {
  if (view === "courts") {
    return [
      { label: "신청 대기", value: (row.courtRequests ?? []).filter((request) => ["pending", "reported"].includes(request.status ?? "pending")).length },
      { label: "미처리 신고", value: row.openCount ?? 0 },
      { label: "누적 신고", value: row.reportCount ?? 0 },
      { label: "관련 리뷰", value: row.courtReviewCount ?? 0 },
    ];
  }
  if (view === "matches") {
    return [
      { label: "미처리 신고", value: row.openCount ?? 0 },
      { label: "누적 신고", value: row.reportCount ?? 0 },
      { label: "참여 인원", value: row.match ? getMatchPlayerIds(row.match).length : 0 },
      { label: "경기 상태", value: getAdminStatusLabel(row.match?.status) },
    ];
  }
  if (view === "teams") {
    return [
      { label: "미처리 신고", value: row.openCount ?? 0 },
      { label: "누적 신고", value: row.reportCount ?? 0 },
      { label: "대상", value: row.entityKind === "affiliation" ? "소속" : "팀" },
      { label: "엠블럼 위반", value: row.team?.emblemViolationCount ?? 0 },
    ];
  }
  return [
    { label: "미처리 신고", value: row.openCount ?? 0 },
    { label: "누적 신고", value: row.reportCount ?? 0 },
    { label: "관련 경기", value: row.matchCount ?? 0 },
    { label: "최근 제재", value: row.disciplinaryActionCount ?? 0 },
  ];
}
export const APPOINTMENT_ROLE_META = {
  admin: { label: "관리자", defaultTermDays: 90 },
  referee: { label: "심판", defaultTermDays: 90 },
};
export const APPOINTMENT_TERM_OPTIONS = [
  { id: "30d", label: "30일", days: 30 },
  { id: "90d", label: "90일", days: 90 },
  { id: "180d", label: "180일", days: 180 },
  { id: "365d", label: "1년", days: 365 },
];
function normalizeAdminGrade(grade = "") {
  return ADMIN_GRADE_ALIASES[grade] ?? grade;
}
export function getAdminGrade() {
  return "";
}
function getAdminGradeMeta(grade) {
  return ADMIN_GRADE_META[normalizeAdminGrade(grade)] ?? null;
}
export function isAppointmentActive(appointment = {}, nowMs = Date.now()) {
  const startsAt = getTime(appointment.startsAt);
  const endsAt = getTime(appointment.endsAt);
  const afterStart = !startsAt || startsAt <= nowMs;
  const beforeEnd = !endsAt || endsAt >= nowMs;
  return appointment.status === "active" && afterStart && beforeEnd;
}
export function hasAdminAccess(user = {}, settings = {}) {
  const appointments = settings.adminAppointments ?? [];
  return Boolean(
    user.id &&
    appointments.some((appointment) => (
      appointment.source === "server_context" &&
      appointment.userId === user.id &&
      appointment.role === "admin" &&
      isAppointmentActive(appointment)
    ))
  );
}
export function getReportTargetUserId(report = {}, fallbackUserId = "") {
  return report.reportedUserIds?.[0] ?? fallbackUserId ?? "";
}
export function getAdminAuthorityLevel(state = {}) {
  const appointmentLevel = (state.settings?.adminAppointments ?? [])
    .filter((appointment) => (
      appointment.source === "server_context"
      && appointment.userId === state.currentUserId
      && appointment.role === "admin"
      && isAppointmentActive(appointment)
    ))
    .reduce((max, appointment) => Math.max(max, getAdminGradeMeta(appointment.grade)?.level ?? 0), 0);
  return appointmentLevel;
}
export function getAppointmentTermDays(role, grade, termDays) {
  const requestedDays = Number(termDays);
  if (Number.isFinite(requestedDays) && requestedDays > 0) return requestedDays;
  if (role === "admin") return ADMIN_GRADE_META[grade]?.defaultTermDays ?? 90;
  return 90;
}
export function canManageAppointmentRole(authorityLevel, role) {
  if (role === "admin") return authorityLevel >= ADMIN_GRADE_META.senior.level;
  if (role === "referee") return authorityLevel >= ADMIN_GRADE_META.matchManager.level;
  return false;
}
export function getTime(value) {
  const time = new Date(value ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
}
export function getOpenCount(reports = []) {
  return reports.filter((report) => report.status !== "resolved" && report.status !== "dismissed").length;
}
export function sortReviewRows(a, b) {
  return (b.issueCount ?? b.openCount) - (a.issueCount ?? a.openCount) ||
    b.openCount - a.openCount ||
    b.reportCount - a.reportCount ||
    b.latestAt - a.latestAt ||
    a.title.localeCompare(b.title);
}
export function isRecordIssueMatch(match = {}) {
  return match.status === "disputed" || match.status === "approval";
}
export function makeUserMap(users = []) {
  return Object.fromEntries(users.map((user) => [user.id, user]));
}
export function makeMatchMap(matches = []) {
  return Object.fromEntries(matches.map((match) => [match.id, match]));
}
export function pushGrouped(map, key, base, patch = {}) {
  if (!key) return null;
  if (!map.has(key)) {
    map.set(key, {
      id: key,
      title: key,
      subtitle: "",
      reports: [],
      matches: [],
      players: [],
      courtRequests: [],
      courtReviews: [],
      disciplinaryActions: [],
      team: null,
      reportCount: 0,
      openCount: 0,
      latestAt: 0,
      ...base,
    });
  }
  const row = map.get(key);
  Object.assign(row, patch);
  return row;
}
export function addReport(row, report) {
  if (!row || !report) return;
  row.reports.push(report);
  row.reportCount = row.reports.length;
  row.openCount = getOpenCount(row.reports);
  row.latestAt = Math.max(row.latestAt, getTime(report.createdAt));
}
export function finalizeReviewRow(row = {}) {
  const reports = [...(row.reports ?? [])].sort((a, b) => (
    Number(b.status === "open") - Number(a.status === "open") ||
    getTime(b.createdAt) - getTime(a.createdAt) ||
    String(a.id ?? "").localeCompare(String(b.id ?? ""))
  ));
  return {
    ...row,
    reports,
    latestReport: reports[0] ?? null,
  };
}
export function getDatePlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}
export function getSuspensionTier(days = 0) {
  return SUSPENSION_TIERS.find((tier) => tier.days === Number(days)) ?? SUSPENSION_TIERS[0];
}
export function getActiveUserDiscipline(settings = {}, userId = "", nowMs = Date.now()) {
  if (!userId) return null;
  return [...(settings.adminDisciplinaryActions ?? [])]
    .filter((action) => (
      action.userId === userId &&
      action.type === "suspension" &&
      action.status !== "revoked" &&
      isAppointmentActive(action, nowMs)
    ))
    .sort((a, b) => getTime(b.endsAt) - getTime(a.endsAt) || Number(b.durationDays ?? 0) - Number(a.durationDays ?? 0))[0] ?? null;
}
export function getActivePublicRoomDiscipline(settings = {}, userId = "", nowMs = Date.now()) {
  if (!userId) return null;
  return [...(settings.adminDisciplinaryActions ?? [])]
    .filter((action) => (
      action.userId === userId &&
      action.type === "public_room_suspension" &&
      action.status !== "revoked" &&
      isAppointmentActive(action, nowMs)
    ))
    .sort((a, b) => getTime(b.endsAt) - getTime(a.endsAt) || Number(b.durationDays ?? 0) - Number(a.durationDays ?? 0))[0] ?? null;
}
function matchIncludesReferee(report = {}, matches = [], userId = "") {
  const match = matches.find((item) => item.id === report.targetId);
  return Boolean(match?.refereeId && match.refereeId === userId);
}
export function calculateRefereeGrade(user = {}, state = {}) {
  const userId = user.id ?? "";
  const matches = state.matches ?? [];
  const reports = state.reports ?? [];
  const refereeMatches = matches.filter((match) => match.refereeId === userId && match.status !== "cancelled").length;
  const refereeReports = reports.filter((report) => (
    report.status !== "dismissed" &&
    (
      (report.reportedUserIds ?? []).includes(userId) ||
      (matchIncludesReferee(report, matches, userId) && String(report.reason ?? "").includes("심판"))
    )
  )).length;
  const thumbsUp = matches.reduce((sum, match) => {
    const stars = match.trustFeedback?.stars ?? {};
    return sum + Object.values(stars).filter((ids) => Array.isArray(ids) && ids.includes(userId)).length;
  }, 0);
  const score = refereeMatches * 2 + thumbsUp * 3 - refereeReports * 8;
  let grade = "candidate";
  if (user.refereeGrade === "official" || user.officialReferee === true) grade = "official";
  else if (refereeMatches >= 50 && refereeReports <= 1 && score >= 110) grade = "platinum";
  else if (refereeMatches >= 20 && refereeReports <= 2 && score >= 45) grade = "gold";
  else if (refereeMatches >= 5 && refereeReports <= 3 && score >= 10) grade = "silver";
  return {
    userId,
    userName: user.name ?? "이름 없음",
    grade,
    gradeLabel: REFEREE_GRADE_META[grade]?.label ?? grade,
    matchCount: refereeMatches,
    reportCount: refereeReports,
    thumbsUp,
    score,
  };
}
export function normalizeAppointmentRow(appointment = {}, userMap = {}, fallbackRole = "admin") {
  const role = appointment.role === "referee" ? "referee" : fallbackRole;
  const grade = role === "admin" ? normalizeAdminGrade(appointment.grade || "support") : (appointment.grade || "candidate");
  const user = userMap[appointment.userId];
  const active = appointment.status === "pending" ? false : isAppointmentActive(appointment);
  const endsAt = appointment.endsAt || getDatePlusDays(APPOINTMENT_ROLE_META[role]?.defaultTermDays ?? 90);
  return {
    id: appointment.id ?? `${role}:${appointment.userId ?? "unknown"}`,
    role,
    roleLabel: APPOINTMENT_ROLE_META[role]?.label ?? role,
    grade,
    gradeLabel: role === "referee" ? (REFEREE_GRADE_META[grade]?.label ?? grade) : (ADMIN_GRADE_META[grade]?.label ?? grade),
    userId: appointment.userId,
    userName: user?.name ?? appointment.userName ?? "알 수 없음",
    status: appointment.status ?? (active ? "active" : "expired"),
    startsAt: appointment.startsAt ?? "",
    endsAt,
    appointedBy: appointment.appointedBy ?? "",
    source: appointment.source ?? "appointment",
    reason: appointment.reason ?? "",
    active,
  };
}
