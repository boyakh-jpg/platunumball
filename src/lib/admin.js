import { getMatchPlayerIds } from "./matchUtils.js";

export const ADMIN_BACKEND_TODO = "TODO backend: server-side admin auth, RLS, auditLog required before deployment.";

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
  platinum: { label: "플래티넘 심판", level: 80, requirement: "경기 수행 우수 · 신고 낮음 · 따봉 높음" },
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
  validReport: { label: "신고 인정", feedback: "신고가 인정되어 조치되었습니다." },
  dismissReport: { label: "신고 기각", feedback: "확인 결과 신고가 기각되었습니다." },
  maliciousReporter: { label: "악성신고자 제재", feedback: "악성 신고로 판단되어 신고자에게 제재가 적용되었습니다." },
  suspendTarget: { label: "대상 제재", feedback: "신고 대상에게 제재가 적용되었습니다." },
  refereeDiscipline: { label: "심판 조치", feedback: "심판 권한 또는 등급 검토 조치가 등록되었습니다." },
};

export const APPOINTMENT_ROLE_META = {
  admin: { label: "관리자", defaultTermDays: 90 },
  referee: { label: "심판", defaultTermDays: 90 },
};

function hasPermission(user = {}, permission) {
  return Array.isArray(user.adminPermissions) && user.adminPermissions.includes(permission);
}

function normalizeAdminGrade(grade = "") {
  return ADMIN_GRADE_ALIASES[grade] ?? grade;
}

export function getAdminGrade(user = {}) {
  const grade = normalizeAdminGrade(user.adminGrade);
  if (ADMIN_GRADE_META[grade]) return grade;
  if (user.id === "u1") return "owner";
  if (user.role === "admin" || user.isAdmin === true) return "senior";
  if (hasPermission(user, "region")) return "regionManager";
  if (hasPermission(user, "operations")) return "matchManager";
  if (hasPermission(user, "admin")) return "support";
  return "";
}

export function getAdminGradeMeta(grade) {
  return ADMIN_GRADE_META[normalizeAdminGrade(grade)] ?? null;
}

export function isAppointmentActive(appointment = {}, nowMs = Date.now()) {
  const startsAt = getTime(appointment.startsAt);
  const endsAt = getTime(appointment.endsAt);
  const afterStart = !startsAt || startsAt <= nowMs;
  const beforeEnd = !endsAt || endsAt >= nowMs;
  return appointment.status !== "revoked" && appointment.status !== "expired" && afterStart && beforeEnd;
}

export function hasAdminAccess(user = {}, settings = {}) {
  const grade = getAdminGrade(user);
  if (grade) return true;
  const appointments = settings.adminAppointments ?? [];
  return Boolean(
    user.id &&
    appointments.some((appointment) => (
      appointment.userId === user.id &&
      appointment.role === "admin" &&
      isAppointmentActive(appointment)
    ))
  );
}

function getTime(value) {
  const time = new Date(value ?? 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getOpenCount(reports = []) {
  return reports.filter((report) => report.status !== "resolved" && report.status !== "dismissed").length;
}

function sortReviewRows(a, b) {
  return (b.issueCount ?? b.openCount) - (a.issueCount ?? a.openCount) ||
    b.openCount - a.openCount ||
    b.reportCount - a.reportCount ||
    b.latestAt - a.latestAt ||
    a.title.localeCompare(b.title);
}

function isRecordIssueMatch(match = {}) {
  return match.status === "disputed" || match.status === "approval";
}

function makeUserMap(users = []) {
  return Object.fromEntries(users.map((user) => [user.id, user]));
}

function makeMatchMap(matches = []) {
  return Object.fromEntries(matches.map((match) => [match.id, match]));
}

function pushGrouped(map, key, base, patch = {}) {
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
      disciplinaryActions: [],
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

function addReport(row, report) {
  if (!row || !report) return;
  row.reports.push(report);
  row.reportCount = row.reports.length;
  row.openCount = getOpenCount(row.reports);
  row.latestAt = Math.max(row.latestAt, getTime(report.createdAt));
}

function getDatePlusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function getSuspensionTier(days = 0) {
  return SUSPENSION_TIERS.find((tier) => tier.days === Number(days)) ?? SUSPENSION_TIERS[0];
}

function normalizeAppointmentRow(appointment = {}, userMap = {}, fallbackRole = "admin") {
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

export function buildAdminAppointmentModel(state = {}) {
  const users = state.users ?? [];
  const settings = state.settings ?? {};
  const userMap = makeUserMap(users);
  const nowMs = Date.now();
  const adminRows = (settings.adminAppointments ?? [])
    .map((appointment) => normalizeAppointmentRow(appointment, userMap, "admin"));
  const refereeRows = (settings.refereeAppointments ?? [])
    .map((appointment) => normalizeAppointmentRow({ ...appointment, role: "referee" }, userMap, "referee"));
  const currentAdminRows = users
    .map((user) => {
      const grade = getAdminGrade(user);
      if (!grade) return null;
      return normalizeAppointmentRow({
        id: `current-admin:${user.id}`,
        role: "admin",
        grade,
        userId: user.id,
        status: "active",
        startsAt: "",
        endsAt: "",
        source: "current_profile",
        reason: "현재 프로필 권한",
      }, userMap, "admin");
    })
    .filter(Boolean);
  const refereeRequestRows = (settings.refereeRequests ?? []).map((request) => normalizeAppointmentRow({
    id: `referee-request:${request.id}`,
    role: "referee",
    grade: "candidate",
    userId: request.userId,
    userName: userMap[request.userId]?.name,
    status: request.status === "pending" ? "pending" : request.status,
    startsAt: "",
    endsAt: getDatePlusDays(APPOINTMENT_ROLE_META.referee.defaultTermDays),
    source: "referee_request",
    reason: request.memo || request.qualification,
  }, userMap, "referee"));

  const rowsById = new Map([...adminRows, ...refereeRows, ...currentAdminRows, ...refereeRequestRows].map((row) => [row.id, row]));
  const rows = [...rowsById.values()].sort((a, b) => {
    const gradeDiff = (ADMIN_GRADE_META[b.grade]?.level ?? 0) - (ADMIN_GRADE_META[a.grade]?.level ?? 0);
    return Number(b.status === "pending") - Number(a.status === "pending") ||
      Number(b.active) - Number(a.active) ||
      gradeDiff ||
      getTime(a.endsAt) - getTime(b.endsAt) ||
      a.userName.localeCompare(b.userName);
  });
  const expiringSoonMs = nowMs + 14 * 24 * 60 * 60 * 1000;
  return {
    rows,
    grades: Object.entries(ADMIN_GRADE_META).map(([id, meta]) => ({ id, ...meta })),
    summary: {
      adminAppointmentCount: rows.filter((row) => row.role === "admin" && row.active).length,
      refereeAppointmentCount: rows.filter((row) => row.role === "referee" && row.active).length,
      pendingAppointmentCount: rows.filter((row) => row.status === "pending").length,
      expiringSoonCount: rows.filter((row) => {
        const endsAt = getTime(row.endsAt);
        return row.active && endsAt && endsAt <= expiringSoonMs;
      }).length,
    },
  };
}

export function buildAdminReviewModel(state = {}) {
  const users = state.users ?? [];
  const matches = state.matches ?? [];
  const reports = state.reports ?? [];
  const courtRequests = state.settings?.courtRequests ?? [];
  const disciplinaryActions = state.settings?.adminDisciplinaryActions ?? [];
  const userMap = makeUserMap(users);
  const matchMap = makeMatchMap(matches);
  const courtMap = new Map();
  const playerMap = new Map();
  const matchReviewMap = new Map();

  matches.forEach((match) => {
    const courtName = match.court || "미정 구장";
    const courtRow = pushGrouped(courtMap, courtName, {
      title: courtName,
      subtitle: `${match.region ?? "지역 미정"} · 경기 ${matches.filter((item) => item.court === courtName).length}건`,
    });
    courtRow.matches.push(match);

    const matchRow = pushGrouped(matchReviewMap, match.id, {
      title: match.title ?? `${match.teamA?.name ?? "A"} vs ${match.teamB?.name ?? "B"}`,
      subtitle: `${match.court ?? "미정 구장"} · ${match.scheduledDate ?? ""} ${match.scheduledTime ?? ""}`.trim(),
      match,
    });
    matchRow.matches = [match];

    getMatchPlayerIds(match).forEach((playerId) => {
      const player = userMap[playerId];
      const playerRow = pushGrouped(playerMap, playerId, {
        title: player?.name ?? "알 수 없음",
        subtitle: `${player?.region ?? "지역 미정"} · ${player?.position ?? "-"} · 신뢰도 ${player?.trustScore ?? "-"}`,
        player,
      });
      playerRow.matches.push(match);
    });
  });

  courtRequests.forEach((request) => {
    const courtName = request.name || "미정 구장요청";
    const row = pushGrouped(courtMap, courtName, {
      title: courtName,
      subtitle: `${request.region ?? "지역 미정"} · 등록요청`,
    });
    row.courtRequests.push(request);

    const requesterRow = pushGrouped(playerMap, request.requestedBy, {
      title: userMap[request.requestedBy]?.name ?? "요청자",
      subtitle: `${userMap[request.requestedBy]?.region ?? "지역 미정"} · 구장 등록요청자`,
      player: userMap[request.requestedBy],
    });
    requesterRow.courtRequests.push(request);
  });

  disciplinaryActions.forEach((action) => {
    const player = userMap[action.userId];
    const playerRow = pushGrouped(playerMap, action.userId, {
      title: player?.name ?? "알 수 없음",
      subtitle: `${player?.region ?? "지역 미정"} · ${player?.position ?? "-"} · 신뢰도 ${player?.trustScore ?? "-"}`,
      player,
    });
    playerRow.disciplinaryActions.push(action);
    playerRow.latestAt = Math.max(playerRow.latestAt, getTime(action.createdAt));
  });

  reports.forEach((report) => {
    if (report.type === "match") {
      const match = matchMap[report.targetId];
      const matchRow = pushGrouped(matchReviewMap, report.targetId, {
        title: match?.title ?? "알 수 없는 경기",
        subtitle: `${match?.court ?? "미정 구장"} · ${match?.scheduledDate ?? ""} ${match?.scheduledTime ?? ""}`.trim(),
        match,
      });
      addReport(matchRow, report);

      const courtRow = pushGrouped(courtMap, match?.court || "미정 구장", {
        title: match?.court || "미정 구장",
        subtitle: `${match?.region ?? "지역 미정"} · 경기 신고`,
      });
      addReport(courtRow, report);

      const targetPlayerIds = report.reportedUserIds?.length ? report.reportedUserIds : getMatchPlayerIds(match);
      targetPlayerIds.forEach((playerId) => {
        const player = userMap[playerId];
        const playerRow = pushGrouped(playerMap, playerId, {
          title: player?.name ?? "알 수 없음",
          subtitle: `${player?.region ?? "지역 미정"} · ${player?.position ?? "-"} · 신뢰도 ${player?.trustScore ?? "-"}`,
          player,
        });
        addReport(playerRow, report);
      });
      return;
    }

    if (report.type === "court_request") {
      const request = courtRequests.find((item) => item.id === report.targetId);
      const courtRow = pushGrouped(courtMap, request?.name || "구장 등록요청", {
        title: request?.name || "구장 등록요청",
        subtitle: `${request?.region ?? "지역 미정"} · 구장 등록 신고`,
      });
      addReport(courtRow, report);

      (report.reportedUserIds ?? [request?.requestedBy]).filter(Boolean).forEach((playerId) => {
        const player = userMap[playerId];
        const playerRow = pushGrouped(playerMap, playerId, {
          title: player?.name ?? "알 수 없음",
          subtitle: `${player?.region ?? "지역 미정"} · ${player?.position ?? "-"} · 신뢰도 ${player?.trustScore ?? "-"}`,
          player,
        });
        addReport(playerRow, report);
      });
    }
  });

  const courtRows = [...courtMap.values()].map((row) => ({
    ...row,
    matchCount: row.matches.length,
    courtRequestCount: row.courtRequests.length,
    issueCount: row.openCount + row.matches.filter(isRecordIssueMatch).length,
  })).sort(sortReviewRows);
  const playerRows = [...playerMap.values()].map((row) => ({
    ...row,
    matchCount: row.matches.length,
    courtRequestCount: row.courtRequests.length,
    disciplinaryActionCount: row.disciplinaryActions.length,
    issueCount: row.openCount + row.matches.filter(isRecordIssueMatch).length,
  })).filter((row) => row.reportCount > 0 || row.courtRequestCount > 0 || row.disciplinaryActionCount > 0).sort(sortReviewRows);
  const matchRows = [...matchReviewMap.values()].map((row) => ({
    ...row,
    matchCount: row.matches.length,
    courtRequestCount: row.courtRequests.length,
    issueCount: row.openCount + (isRecordIssueMatch(row.match) ? 1 : 0),
  })).sort(sortReviewRows);

  return {
    summary: {
      reportCount: reports.length,
      openReportCount: getOpenCount(reports),
      courtCount: courtRows.length,
      playerCount: playerRows.length,
      matchIssueCount: matchRows.filter((row) => row.reportCount > 0 || isRecordIssueMatch(row.match)).length,
      courtRequestCount: courtRequests.length,
      disciplinaryActionCount: disciplinaryActions.length,
    },
    courts: courtRows,
    players: playerRows,
    matches: matchRows,
  };
}
