import { ADMIN_GRADE_META } from "../../../lib/admin.js";
import { DAY_MS, REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { REFEREE_GRADE_META } from "../../../lib/admin.js";
import { canManageAppointmentRole } from "../../../lib/admin.js";
import { getAdminAuthorityLevel } from "../../../lib/admin.js";
import { getAppointmentTermDays } from "../../../lib/admin.js";
import { hasAdminAccess } from "../../../lib/admin.js";
import { isAppointmentActive } from "../../../lib/admin.js";
import { makeId } from "../../rowUtils.js";
import { normalizeStateSettings as normalizeSettings } from "../../stateNormalizer.js";
import { getAdminActionNotification } from "./review.js";

export function commitAdminAppointmentAction(state, draft = {}) {
  if (!hasAdminAccess(state.users.find((user) => user.id === state.currentUserId), state.settings)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("관리자 권한이 없습니다."), ...state.notifications],
    };
  }

  const actionType = ["appointAdmin", "appointReferee", "extendAppointment", "revokeAppointment"].includes(draft.actionType)
    ? draft.actionType
    : "appointReferee";
  const authorityLevel = getAdminAuthorityLevel(state);
  const now = new Date().toISOString();

  if (actionType === "revokeAppointment" || actionType === "extendAppointment") {
    const appointmentId = String(draft.appointmentId ?? "");
    const adminAppointment = (state.settings?.adminAppointments ?? []).find((appointment) => appointment.id === appointmentId);
    const refereeAppointment = (state.settings?.refereeAppointments ?? []).find((appointment) => appointment.id === appointmentId);
    const appointment = adminAppointment ?? refereeAppointment;
    const role = adminAppointment ? "admin" : refereeAppointment ? "referee" : "";
    if (!appointment || !role) {
      return {
        ...state,
        notifications: [getAdminActionNotification("회수할 임명 기록을 찾을 수 없습니다."), ...state.notifications],
      };
    }
    if (!canManageAppointmentRole(authorityLevel, role)) {
      return {
        ...state,
        notifications: [getAdminActionNotification("해당 임명을 회수할 권한이 없습니다."), ...state.notifications],
      };
    }
    if (!isAppointmentActive(appointment)) {
      return {
        ...state,
        notifications: [getAdminActionNotification("이미 비활성화된 임명입니다."), ...state.notifications],
      };
    }
    const termDays = getAppointmentTermDays(role, appointment.grade, draft.termDays);
    const parsedEndMs = new Date(appointment.endsAt ?? "").getTime();
    const currentEndMs = Number.isFinite(parsedEndMs) ? parsedEndMs : Date.now();
    const nextEndsAt = actionType === "extendAppointment"
      ? new Date(Math.max(currentEndMs, Date.now()) + termDays * DAY_MS).toISOString()
      : appointment.endsAt;
    const reason = String(draft.reason ?? "").trim() || (actionType === "extendAppointment" ? "임명 연장" : "임명 회수");
    const auditLog = {
      id: makeId("aa"),
      type: "appointment_action",
      status: "committed",
      actionType,
      appointmentId,
      targetUserId: appointment.userId,
      role,
      grade: appointment.grade,
      termDays,
      reason,
      createdAt: now,
      createdBy: state.currentUserId,
    };
    const patchAppointment = (item) => (
      item.id === appointmentId
        ? actionType === "extendAppointment"
          ? { ...item, endsAt: nextEndsAt, extendedAt: now, extendedBy: state.currentUserId, extendReason: reason, status: "active" }
          : { ...item, status: "revoked", revokedAt: now, revokedBy: state.currentUserId, revokeReason: reason }
        : item
    );
    return {
      ...state,
      settings: normalizeSettings({
        ...(state.settings ?? {}),
        adminAppointments: role === "admin" ? (state.settings?.adminAppointments ?? []).map(patchAppointment) : (state.settings?.adminAppointments ?? []),
        refereeAppointments: role === "referee" ? (state.settings?.refereeAppointments ?? []).map(patchAppointment) : (state.settings?.refereeAppointments ?? []),
        adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
      }),
      notifications: [
        getAdminActionNotification(actionType === "extendAppointment" ? "임명 기간을 연장했습니다." : "임명을 회수했습니다.", "team"),
        {
          id: makeId("n"),
          targetUserId: appointment.userId,
          title: actionType === "extendAppointment" ? "임명 연장" : "임명 회수",
          body: actionType === "extendAppointment" ? `임명 기간이 ${termDays}일 연장되었습니다. 사유: ${reason}` : `임명이 회수되었습니다. 사유: ${reason}`,
          tone: actionType === "extendAppointment" ? "team" : "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const role = actionType === "appointAdmin" ? "admin" : "referee";
  if (!canManageAppointmentRole(authorityLevel, role)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("해당 임명을 처리할 권한이 없습니다."), ...state.notifications],
    };
  }
  const userId = String(draft.userId ?? "");
  const targetUser = state.users.find((user) => user.id === userId);
  if (!targetUser) {
    return {
      ...state,
      notifications: [getAdminActionNotification("임명할 플레이어를 찾을 수 없습니다."), ...state.notifications],
    };
  }
  if (role === "referee" && Number(targetUser.trustScore ?? 0) < REFEREE_TRUST_MIN) {
    return {
      ...state,
      notifications: [getAdminActionNotification(`신규 심판 임명은 신뢰도 ${REFEREE_TRUST_MIN} 이상이어야 합니다.`), ...state.notifications],
    };
  }
  const grade = role === "admin"
    ? (ADMIN_GRADE_META[draft.adminGrade] ? draft.adminGrade : "support")
    : (REFEREE_GRADE_META[draft.refereeGrade] ? draft.refereeGrade : "candidate");
  if (role === "admin" && grade === "owner") {
    return {
      ...state,
      notifications: [getAdminActionNotification("최고관리자는 추가 임명할 수 없습니다."), ...state.notifications],
    };
  }
  const targetAppointments = role === "admin" ? (state.settings?.adminAppointments ?? []) : (state.settings?.refereeAppointments ?? []);
  const duplicate = targetAppointments.some((appointment) => (
    appointment.userId === userId &&
    (appointment.role ?? role) === role &&
    isAppointmentActive(appointment)
  ));
  if (duplicate) {
    return {
      ...state,
      notifications: [getAdminActionNotification("이미 활성 임명이 있습니다."), ...state.notifications],
    };
  }
  const termDays = getAppointmentTermDays(role, grade, draft.termDays);
  const appointment = {
    id: makeId("ap"),
    role,
    grade,
    userId,
    status: "active",
    startsAt: now,
    endsAt: new Date(new Date(now).getTime() + termDays * DAY_MS).toISOString(),
    appointedBy: state.currentUserId,
    reason: String(draft.reason ?? "").trim() || "관리자 임명",
    createdAt: now,
  };
  const auditLog = {
    id: makeId("aa"),
    type: "appointment_action",
    status: "committed",
    actionType,
    appointmentId: appointment.id,
    targetUserId: userId,
    role,
    grade,
    termDays,
    reason: appointment.reason,
    createdAt: now,
    createdBy: state.currentUserId,
  };

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      adminAppointments: role === "admin" ? [appointment, ...(state.settings?.adminAppointments ?? [])] : (state.settings?.adminAppointments ?? []),
      refereeAppointments: role === "referee" ? [appointment, ...(state.settings?.refereeAppointments ?? [])] : (state.settings?.refereeAppointments ?? []),
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
    }),
    notifications: [
      getAdminActionNotification("임명 액션이 커밋되었습니다.", "team"),
      {
        id: makeId("n"),
        targetUserId: userId,
        title: role === "admin" ? "관리자 임명" : "심판 임명",
        body: `${appointment.reason} · ${termDays}일`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}
