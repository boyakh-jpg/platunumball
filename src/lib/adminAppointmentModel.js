import { DAY_MS } from "./constants.js";
import { ADMIN_GRADE_META, APPOINTMENT_ROLE_META, REFEREE_GRADE_META, calculateRefereeGrade, getAdminGrade, getDatePlusDays, getTime, makeUserMap, normalizeAppointmentRow } from "./adminPolicy.js";

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
  const refereeGradeRows = users
    .map((user) => calculateRefereeGrade(user, state))
    .filter((row) => row.matchCount > 0 || row.grade !== "candidate")
    .sort((a, b) => (REFEREE_GRADE_META[b.grade]?.level ?? 0) - (REFEREE_GRADE_META[a.grade]?.level ?? 0) || b.score - a.score)
    .slice(0, 8);

  const rowsById = new Map([...adminRows, ...refereeRows, ...currentAdminRows, ...refereeRequestRows].map((row) => [row.id, row]));
  const rows = [...rowsById.values()].sort((a, b) => {
    const aGradeMeta = a.role === "referee" ? REFEREE_GRADE_META[a.grade] : ADMIN_GRADE_META[a.grade];
    const bGradeMeta = b.role === "referee" ? REFEREE_GRADE_META[b.grade] : ADMIN_GRADE_META[b.grade];
    const gradeDiff = (bGradeMeta?.level ?? 0) - (aGradeMeta?.level ?? 0);
    return Number(b.status === "pending") - Number(a.status === "pending") ||
      Number(b.active) - Number(a.active) ||
      gradeDiff ||
      getTime(a.endsAt) - getTime(b.endsAt) ||
      a.userName.localeCompare(b.userName);
  });
  const expiringSoonMs = nowMs + 14 * DAY_MS;
  return {
    rows,
    grades: Object.entries(ADMIN_GRADE_META).map(([id, meta]) => ({ id, ...meta })),
    refereeGrades: refereeGradeRows,
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
