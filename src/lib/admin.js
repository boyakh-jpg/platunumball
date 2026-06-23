import { getMatchPlayerIds } from "./matchUtils.js";

export const ADMIN_BACKEND_TODO = "TODO backend: server-side admin auth, RLS, auditLog required before deployment.";

export const ADMIN_GRADE_META = {
  owner: { label: "오너", level: 100, defaultTermDays: 365, scope: "전체 권한" },
  opsLead: { label: "운영장", level: 70, defaultTermDays: 180, scope: "관리자/심판 임명 제안" },
  moderator: { label: "운영관리자", level: 50, defaultTermDays: 90, scope: "신고/기록 처리" },
  support: { label: "보조관리자", level: 30, defaultTermDays: 30, scope: "큐 검토" },
};

export const APPOINTMENT_ROLE_META = {
  admin: { label: "관리자", defaultTermDays: 90 },
  referee: { label: "심판", defaultTermDays: 90 },
};

function hasPermission(user = {}, permission) {
  return Array.isArray(user.adminPermissions) && user.adminPermissions.includes(permission);
}

export function getAdminGrade(user = {}) {
  if (ADMIN_GRADE_META[user.adminGrade]) return user.adminGrade;
  if (user.id === "u1") return "owner";
  if (user.role === "admin" || user.isAdmin === true) return "opsLead";
  if (hasPermission(user, "operations")) return "moderator";
  if (hasPermission(user, "admin")) return "support";
  return "";
}

export function getAdminGradeMeta(grade) {
  return ADMIN_GRADE_META[grade] ?? null;
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

function normalizeAppointmentRow(appointment = {}, userMap = {}, fallbackRole = "admin") {
  const role = appointment.role === "referee" ? "referee" : fallbackRole;
  const grade = role === "admin" ? (appointment.grade || "support") : (appointment.grade || "referee");
  const user = userMap[appointment.userId];
  const active = appointment.status === "pending" ? false : isAppointmentActive(appointment);
  const endsAt = appointment.endsAt || getDatePlusDays(APPOINTMENT_ROLE_META[role]?.defaultTermDays ?? 90);
  return {
    id: appointment.id ?? `${role}:${appointment.userId ?? "unknown"}`,
    role,
    roleLabel: APPOINTMENT_ROLE_META[role]?.label ?? role,
    grade,
    gradeLabel: ADMIN_GRADE_META[grade]?.label ?? (grade === "referee" ? "심판" : grade),
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
    grade: "referee",
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
    issueCount: row.openCount + row.matches.filter(isRecordIssueMatch).length,
  })).sort(sortReviewRows);
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
      playerCount: playerRows.filter((row) => row.reportCount > 0).length,
      matchIssueCount: matchRows.filter((row) => row.reportCount > 0 || isRecordIssueMatch(row.match)).length,
      courtRequestCount: courtRequests.length,
    },
    courts: courtRows,
    players: playerRows,
    matches: matchRows,
  };
}
