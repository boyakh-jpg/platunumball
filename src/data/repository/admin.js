import { ADMIN_GRADE_META } from "../../lib/admin.js";
import { ADMIN_REVIEW_ACTIONS } from "../../lib/admin.js";
import { DAY_MS } from "../../lib/constants.js";
import { FALSE_COURT_REPORT_TRUST_PENALTY } from "../../lib/constants.js";
import { MAX_TEAM_NAME_LENGTH } from "../../lib/constants.js";
import { REFEREE_GRADE_META } from "../../lib/admin.js";
import { adjustUserTrust } from "../trustUtils.js";
import { canManageAppointmentRole } from "../../lib/admin.js";
import { findCourtDuplicate } from "../../lib/courts.js";
import { getAdminAuthorityLevel } from "../../lib/admin.js";
import { getAppointmentTermDays } from "../../lib/admin.js";
import { getCourtCorrectionPatch } from "../../lib/courts.js";
import { getCourtDuplicateMessage } from "../../lib/courts.js";
import { getCourtFacilityBaseName } from "../../lib/courts.js";
import { getCourtHoopCount } from "../../lib/courts.js";
import { getCourtLocationMatches } from "../../lib/courts.js";
import { getCourtReservationValue } from "../../lib/courts.js";
import { getCourtStandardName } from "../../lib/courts.js";
import { getReportTargetUserId } from "../../lib/admin.js";
import { getSuspensionTier } from "../../lib/admin.js";
import { hasAdminAccess } from "../../lib/admin.js";
import { isAppointmentActive } from "../../lib/admin.js";
import { makeId } from "../rowUtils.js";
import { normalizeCourtAccessType } from "../../lib/courts.js";
import { normalizeCourtKind } from "../../lib/courts.js";
import { normalizeCourtLayout } from "../../lib/courts.js";
import { normalizeCourtOptionalBoolean } from "../../lib/courts.js";
import { normalizeCourtPublicAccess } from "../../lib/courts.js";
import { normalizeCourtSigungu } from "../../lib/courts.js";
import { normalizeCourtSourceUrl } from "../../lib/courts.js";
import { normalizeCourtSurfaceType } from "../../lib/courts.js";
import { normalizeCourtType } from "../../lib/courts.js";
import { normalizeStateSettings as normalizeSettings } from "../stateNormalizer.js";
import { finalizeMatch } from "./lifecycle.js";
import { getServerRatingValue } from "./runtime.js";

function getAdminActionNotification(body, tone = "orange") {
  return {
    id: makeId("n"),
    title: "관리자 처리",
    body,
    tone,
  };
}

function makeDisciplinaryAction({ state, report, actionType, targetUserId, durationDays, reason, now }) {
  if (!["maliciousReporter", "suspendTarget", "refereeDiscipline"].includes(actionType)) return null;
  const userId = actionType === "maliciousReporter" ? report.by : targetUserId;
  if (!userId) return null;
  const startsAt = now;
  const endsAt = new Date(new Date(now).getTime() + durationDays * DAY_MS).toISOString();
  return {
    id: makeId("ad"),
    userId,
    type: actionType === "refereeDiscipline" ? "referee_discipline" : "suspension",
    actionType,
    sourceReportId: report.id,
    reason,
    startsAt,
    endsAt,
    durationDays,
    createdAt: now,
    createdBy: state.currentUserId,
    status: "active",
  };
}

function commitVoidMatchReviewAction(state, report, draft = {}) {
  const actionType = ["keepMatchVoid", "restoreMatchHalf", "restoreMatchFull"].includes(draft.actionType)
    ? draft.actionType
    : "keepMatchVoid";
  const match = (state.matches ?? []).find((item) => item.id === report.targetId);
  if (!match || match.status !== "void") return state;
  const now = new Date().toISOString();
  const reason = String(draft.reason ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].label;
  const feedback = String(draft.feedback ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].feedback;
  const durationDays = getSuspensionTier(draft.durationDays).days;
  const penaltyType = ["public_room_suspension", "suspension"].includes(draft.penaltyType) ? draft.penaltyType : "";
  const targetUserId = String(draft.targetUserId ?? report.reportedUserIds?.[0] ?? "").trim();
  if (penaltyType && !targetUserId) return state;
  const actionLabel = actionType === "restoreMatchHalf"
    ? "경기 복구 · MMR 50% 반영"
    : actionType === "restoreMatchFull"
      ? "경기 복구 · MMR 100% 반영"
      : "경기 무효 유지";
  const disciplinaryAction = penaltyType ? {
    id: makeId("ad"),
    userId: targetUserId,
    type: penaltyType,
    actionType: penaltyType === "public_room_suspension" ? "publicRoomSuspend" : "suspendTarget",
    sourceReportId: report.id,
    reason,
    startsAt: now,
    endsAt: new Date(new Date(now).getTime() + durationDays * DAY_MS).toISOString(),
    durationDays,
    createdAt: now,
    createdBy: state.currentUserId,
    status: "active",
  } : null;
  const resolution = { actionType, actionLabel, feedback, reason, targetUserId: targetUserId || null, penaltyType: penaltyType || null, durationDays };
  const nextReport = { ...report, status: "resolved", resolvedAt: now, resolvedBy: state.currentUserId, resolution };
  const auditLog = {
    id: makeId("aa"), type: "void_match_review", status: "committed", reportId: report.id,
    actionType, reason, feedback, targetUserId, penaltyType, durationDays, createdAt: now, createdBy: state.currentUserId,
  };
  const reviewState = {
    ...state,
    reports: (state.reports ?? []).map((item) => item.id === report.id ? nextReport : item),
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
      adminDisciplinaryActions: disciplinaryAction
        ? [disciplinaryAction, ...(state.settings?.adminDisciplinaryActions ?? [])]
        : (state.settings?.adminDisciplinaryActions ?? []),
    }),
    notifications: [
      {
        id: makeId("n"), targetUserId: report.by, title: "신고 처리 결과",
        body: `신고 처리 결과는 ${actionLabel}입니다. ${feedback}`, tone: "team", type: "report", matchId: match.id,
      },
      ...(disciplinaryAction ? [{
        id: makeId("n"), targetUserId, title: "운영 제재 안내",
        body: `${penaltyType === "public_room_suspension" ? "공개방 참가" : "서비스 활동"}이 ${durationDays}일간 제한됩니다. 사유: ${reason}`,
        tone: "orange", type: "disciplinary",
      }] : []),
      ...state.notifications,
    ],
  };
  if (actionType === "keepMatchVoid") {
    return {
      ...reviewState,
      matches: reviewState.matches.map((item) => item.id === match.id ? { ...item, voidReview: resolution } : item),
    };
  }

  const ratingFactor = getServerRatingValue("getAdminRestoreRatingFactor", actionType);
  const snapshotResult = match.voidSnapshot?.result ?? match.result;
  if (!snapshotResult) return state;
  const restoredMatch = {
    ...match,
    status: "disputed",
    ranked: match.voidSnapshot?.ranked !== false,
    result: snapshotResult,
    disputeDraftResult: snapshotResult,
    rules: {
      ...(match.rules ?? {}),
      ratingScale: Number(match.voidSnapshot?.ratingScale ?? match.rules?.ratingScale ?? 1) * ratingFactor,
    },
    voidReview: resolution,
  };
  return finalizeMatch({
    ...reviewState,
    matches: reviewState.matches.map((item) => item.id === match.id ? restoredMatch : item),
  }, restoredMatch);
}

export function commitAdminReviewAction(state, draft = {}) {
  if (!hasAdminAccess(state.users.find((user) => user.id === state.currentUserId), state.settings)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("관리자 권한이 없습니다."), ...state.notifications],
    };
  }

  const reportId = draft.reportId;
  const report = (state.reports ?? []).find((item) => item.id === reportId);
  if (!report) {
    return {
      ...state,
      notifications: [getAdminActionNotification("처리할 신고를 찾을 수 없습니다."), ...state.notifications],
    };
  }

  const alreadyCommitted = (state.settings?.adminAuditLog ?? []).some((item) => item.reportId === reportId && item.status === "committed");
  if (alreadyCommitted || report.status !== "open") {
    return {
      ...state,
      notifications: [getAdminActionNotification("이미 다른 관리자 처리 또는 이전 처리 결과가 있습니다."), ...state.notifications],
    };
  }

  const actionType = ADMIN_REVIEW_ACTIONS[draft.actionType] ? draft.actionType : "validReport";
  const reason = String(draft.reason ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].label;
  const feedback = String(draft.feedback ?? "").trim() || ADMIN_REVIEW_ACTIONS[actionType].feedback;
  const durationDays = getSuspensionTier(draft.durationDays).days;
  const targetUserId = draft.targetUserId || getReportTargetUserId(report);
  const needsTarget = ["suspendTarget", "refereeDiscipline"].includes(actionType);
  if (needsTarget && !targetUserId) {
    return {
      ...state,
      notifications: [getAdminActionNotification("제재 대상을 선택해야 합니다."), ...state.notifications],
    };
  }
  if (actionType === "hideCourt" && report.type !== "court") {
    return {
      ...state,
      notifications: [getAdminActionNotification("구장 신고만 구장 숨김 처리할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "hideCourtReview" && report.type !== "court_review") {
    return {
      ...state,
      notifications: [getAdminActionNotification("구장 리뷰 신고만 리뷰 숨김 처리할 수 있습니다."), ...state.notifications],
    };
  }
  if (
    actionType === "markCourtDuplicate"
    && (report.type !== "court" || report.courtCorrection?.field !== "duplicate")
  ) {
    return {
      ...state,
      notifications: [getAdminActionNotification("중복 구장 신고만 중복으로 확정할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "markCourtDuplicate" && getAdminAuthorityLevel(state) < 50) {
    return {
      ...state,
      notifications: [getAdminActionNotification("경기관리자 이상만 중복 구장을 확정할 수 있습니다."), ...state.notifications],
    };
  }
  const courtCorrectionPatch = actionType === "applyCourtCorrection"
    ? getCourtCorrectionPatch(report.courtCorrection)
    : null;
  if (actionType === "applyCourtCorrection" && (report.type !== "court" || !courtCorrectionPatch)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("구조화된 구장 정보 수정 신고만 바로 반영할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "applyCourtCorrection" && getAdminAuthorityLevel(state) < 50) {
    return {
      ...state,
      notifications: [getAdminActionNotification("경기관리자 이상만 구장 정보를 바로 반영할 수 있습니다."), ...state.notifications],
    };
  }

  if (report.matchReviewType === "void_restore") {
    return commitVoidMatchReviewAction(state, report, draft);
  }
  if (actionType === "resetTeamEmblem" && report.type !== "team_emblem") {
    return {
      ...state,
      notifications: [getAdminActionNotification("팀 엠블럼 신고만 기본값으로 전환할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "resetTeamEmblem" && getAdminAuthorityLevel(state) < 50) {
    return {
      ...state,
      notifications: [getAdminActionNotification("경기관리자 이상만 팀 엠블럼을 강제 전환할 수 있습니다."), ...state.notifications],
    };
  }
  const nameAction = ["renameTeam", "renameAffiliation", "mergeAffiliation"].includes(actionType);
  if (nameAction && getAdminAuthorityLevel(state) < 50) {
    return {
      ...state,
      notifications: [getAdminActionNotification("경기관리자 이상만 이름을 수정하거나 소속을 통합할 수 있습니다."), ...state.notifications],
    };
  }
  if (actionType === "renameTeam" && report.type !== "team_name") return state;
  if (["renameAffiliation", "mergeAffiliation"].includes(actionType) && report.type !== "affiliation_name") return state;
  const replacementName = String(draft.replacementName ?? "").trim().replace(/\s+/g, " ");
  const mergeTargetId = String(draft.mergeTargetId ?? "").trim();
  if (actionType === "renameTeam" && (!replacementName || replacementName.length > MAX_TEAM_NAME_LENGTH)) return state;
  if (actionType === "renameAffiliation" && (replacementName.length < 2 || replacementName.length > 40)) return state;
  if (actionType === "mergeAffiliation" && (!mergeTargetId || mergeTargetId === report.targetId)) return state;

  const now = new Date().toISOString();
  const moderatedTeam = actionType === "resetTeamEmblem"
    ? (state.teams ?? []).find((team) => team.id === report.targetId)
    : null;
  const emblemViolationCount = Number(moderatedTeam?.emblemViolationCount ?? 0) + (moderatedTeam ? 1 : 0);
  const emblemBlockDays = emblemViolationCount <= 1 ? 30 : emblemViolationCount === 2 ? 90 : 365;
  const emblemUploadBlockedUntil = moderatedTeam
    ? new Date(new Date(now).getTime() + emblemBlockDays * DAY_MS).toISOString()
    : null;
  const disciplinaryAction = makeDisciplinaryAction({ state, report, actionType, targetUserId, durationDays, reason, now });
  const nextStatus = actionType === "dismissReport" || actionType === "maliciousReporter" ? "dismissed" : "resolved";
  const nextReports = (state.reports ?? []).map((item) => (
    item.id === reportId
      ? {
        ...item,
        status: nextStatus,
        resolvedAt: now,
        resolvedBy: state.currentUserId,
        resolution: {
          actionType,
          feedback,
          reason,
          targetUserId,
          durationDays,
          ...(moderatedTeam ? { teamId: moderatedTeam.id, violationCount: emblemViolationCount, blockedUntil: emblemUploadBlockedUntil } : {}),
        },
      }
      : item
  ));
  const auditLog = {
    id: makeId("aa"),
    type: "report_action",
    status: "committed",
    reportId,
    actionType,
    reason,
    feedback,
    targetUserId,
    durationDays,
    reportVersion: report.updatedAt ?? report.createdAt ?? "",
    createdAt: now,
    createdBy: state.currentUserId,
  };
  const nextApprovedCourts = ["hideCourt", "markCourtDuplicate", "applyCourtCorrection"].includes(actionType)
    ? (state.settings?.approvedCourts ?? []).map((court) => (
      court.id === report.targetId
        ? actionType === "applyCourtCorrection"
          ? { ...court, ...courtCorrectionPatch, updatedAt: now }
          : actionType === "markCourtDuplicate"
          ? {
            ...court,
            status: "disabled",
            verificationStatus: "verified",
            adminReviewCount: Number(court.adminReviewCount ?? 0) + 1,
            adminReviewedAt: now,
            adminReviewedBy: state.currentUserId,
            adminReviewScenario: "duplicate",
          }
          : { ...court, status: "hidden", hiddenAt: now, hiddenBy: state.currentUserId, hiddenReason: reason }
        : court
    ))
    : (state.settings?.approvedCourts ?? []);
  const nextCourtReviews = actionType === "hideCourtReview"
    ? (state.settings?.courtReviews ?? []).map((review) => (
      review.id === report.targetId
        ? { ...review, status: "hidden", hiddenAt: now, hiddenBy: state.currentUserId, hiddenReason: reason }
        : review
    ))
    : (state.settings?.courtReviews ?? []);
  const reviewedCourtRequest = report.type === "court_request"
    ? (state.settings?.courtRequests ?? []).find((request) => request.id === report.targetId)
    : null;
  const configuredCourtRequestPenalty = Number(
    state.settings?.ratingPolicy?.trust?.falseCourtReportPenalty ?? FALSE_COURT_REPORT_TRUST_PENALTY,
  );
  const courtRequestPenalty = Number.isFinite(configuredCourtRequestPenalty)
    ? Math.max(0, Math.min(20, Math.round(configuredCourtRequestPenalty)))
    : FALSE_COURT_REPORT_TRUST_PENALTY;
  const courtRequestPenaltyApplied = Boolean(
    reviewedCourtRequest?.trustPenaltyApplied || reviewedCourtRequest?.status === "rejected",
  );
  const shouldApplyCourtRequestPenalty = Boolean(
    reviewedCourtRequest && nextStatus === "resolved" && !courtRequestPenaltyApplied,
  );
  const hasAcceptedCourtRequestReport = reviewedCourtRequest && nextReports.some((item) => (
    item.type === "court_request" && item.targetId === report.targetId && item.status === "resolved"
  ));
  const hasOpenCourtRequestReport = reviewedCourtRequest && nextReports.some((item) => (
    item.type === "court_request" && item.targetId === report.targetId && item.status === "open"
  ));
  const nextCourtRequests = reviewedCourtRequest
    ? (state.settings?.courtRequests ?? []).map((request) => {
      if (request.id !== reviewedCourtRequest.id) return request;
      if (hasAcceptedCourtRequestReport || courtRequestPenaltyApplied) {
        return {
          ...request,
          status: "rejected",
          reportReviewPending: false,
          trustPenaltyApplied: true,
          trustPenalty: request.trustPenalty ?? courtRequestPenalty,
          trustPenaltyAppliedAt: request.trustPenaltyAppliedAt ?? now,
          trustPenaltyReportId: request.trustPenaltyReportId ?? report.id,
          trustPenaltyActionType: request.trustPenaltyActionType ?? actionType,
        };
      }
      return {
        ...request,
        status: hasOpenCourtRequestReport ? "reported" : "pending",
        reportReviewPending: Boolean(hasOpenCourtRequestReport),
        lastDismissedReportId: report.id,
        lastReviewedAt: now,
      };
    })
    : (state.settings?.courtRequests ?? []);
  const nextTeams = moderatedTeam
    ? (state.teams ?? []).map((team) => team.id === moderatedTeam.id ? {
      ...team,
      emblemKey: null,
      emblemSource: "initial",
      emblemUpdatedAt: now,
      emblemViolationCount,
      emblemUploadBlockedUntil,
      emblemModeratedAt: now,
      emblemModerationReason: reason,
    } : team)
    : actionType === "renameTeam"
      ? (state.teams ?? []).map((team) => team.id === report.targetId ? { ...team, name: replacementName, updatedAt: now } : team)
      : (state.teams ?? []);
  const mergedAffiliation = actionType === "mergeAffiliation"
    ? (state.affiliations ?? []).find((affiliation) => affiliation.id === mergeTargetId && (affiliation.status ?? "active") === "active")
    : null;
  if (actionType === "mergeAffiliation" && !mergedAffiliation) return state;
  const nextAffiliations = (state.affiliations ?? []).map((affiliation) => {
    if (actionType === "renameAffiliation" && affiliation.id === report.targetId) return { ...affiliation, name: replacementName, updatedAt: now };
    if (actionType === "mergeAffiliation" && affiliation.id === report.targetId) return { ...affiliation, status: "merged", mergedIntoId: mergeTargetId, memberCount: 0, updatedAt: now };
    return affiliation;
  });
  const affiliationAdjustedUsers = actionType === "mergeAffiliation" && mergedAffiliation
    ? (state.users ?? []).map((user) => user.affiliationId === report.targetId ? {
      ...user,
      affiliationId: mergedAffiliation.id,
      affiliationName: mergedAffiliation.name,
    } : user)
    : (state.users ?? []);
  const nextUsers = shouldApplyCourtRequestPenalty
    ? adjustUserTrust(affiliationAdjustedUsers, reviewedCourtRequest.requestedBy, -courtRequestPenalty)
    : affiliationAdjustedUsers;
  const reporterNotification = report.by
    ? {
      id: makeId("n"),
      targetUserId: report.by,
      title: "신고 처리 결과",
      body: feedback,
      tone: nextStatus === "resolved" ? "team" : "orange",
    }
    : null;
  const targetNotification = disciplinaryAction?.userId
    ? {
      id: makeId("n"),
      targetUserId: disciplinaryAction.userId,
      title: "운영 제재 안내",
      body: `운영 조치가 적용되었습니다. 기간: ${durationDays}일. 사유: ${reason}`,
      tone: "orange",
    }
    : null;
  const teamModerationNotification = moderatedTeam
    ? {
      id: makeId("n"),
      targetUserId: moderatedTeam.members?.find((member) => member.role === "captain")?.userId,
      title: "팀 엠블럼 운영 조치",
      body: `신고가 인정되어 엠블럼이 기본값으로 전환되었습니다. ${emblemBlockDays}일 동안 사진을 업로드할 수 없습니다.`,
      tone: "orange",
      type: "team_emblem_moderation",
    }
    : null;
  const courtRequestDecisionNotification = shouldApplyCourtRequestPenalty
    ? {
      id: makeId("n"),
      targetUserId: reviewedCourtRequest.requestedBy,
      title: "구장 등록요청 신고 인정",
      body: courtRequestPenalty > 0
        ? `${reviewedCourtRequest.name} 등록요청 신고가 인정되어 신뢰도 ${courtRequestPenalty}점이 차감되었습니다.`
        : `${reviewedCourtRequest.name} 등록요청 신고가 인정되었습니다. 현재 정책상 신뢰도 차감은 없습니다.`,
      tone: "orange",
    }
    : null;

  return {
    ...state,
    users: nextUsers,
    teams: nextTeams,
    affiliations: nextAffiliations,
    reports: nextReports,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      approvedCourts: nextApprovedCourts,
      courtReviews: nextCourtReviews,
      courtRequests: nextCourtRequests,
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
      adminDisciplinaryActions: disciplinaryAction
        ? [disciplinaryAction, ...(state.settings?.adminDisciplinaryActions ?? [])]
        : (state.settings?.adminDisciplinaryActions ?? []),
    }),
    notifications: [
      getAdminActionNotification("관리자 처리 결과가 커밋되었습니다.", "team"),
      ...[reporterNotification, targetNotification, teamModerationNotification, courtRequestDecisionNotification].filter((notification) => notification?.targetUserId),
      ...state.notifications,
    ],
  };
}

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
    const currentEndMs = getTime(appointment.endsAt);
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
  if (!state.users.some((user) => user.id === userId)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("임명할 플레이어를 찾을 수 없습니다."), ...state.notifications],
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

export function approveCourtRequest(state, requestId, approval = {}) {
  if (!hasAdminAccess(state.users.find((user) => user.id === state.currentUserId), state.settings)) {
    return {
      ...state,
      notifications: [getAdminActionNotification("관리자 권한이 없습니다."), ...state.notifications],
    };
  }
  const request = (state.settings?.courtRequests ?? []).find((item) => item.id === requestId);
  if (!request) {
    return {
      ...state,
      notifications: [getAdminActionNotification("승인할 구장 요청을 찾을 수 없습니다."), ...state.notifications],
    };
  }
  const hasOpenReport = (state.reports ?? []).some((report) => (
    report.type === "court_request" && report.targetId === requestId && report.status === "open"
  ));
  if (request.status !== "pending" || hasOpenReport) {
    return {
      ...state,
      notifications: [getAdminActionNotification("신고 검토 중이거나 종결된 구장 요청은 승인할 수 없습니다."), ...state.notifications],
    };
  }
  if (!approval.addressVerified) {
    return {
      ...state,
      notifications: [getAdminActionNotification("주소와 지도 위치 확인이 필요합니다."), ...state.notifications],
    };
  }
  const approvedSigungu = normalizeCourtSigungu(
    request.sigungu,
    request.addressText || request.roadAddress || request.jibunAddress,
    request.sido,
    request.region,
  );
  const approvedFacilityName = getCourtFacilityBaseName(
    approval.approvedName || request.facilityName || request.baseName || request.name,
    approvedSigungu,
    request.courtUnit,
  );
  const approvedName = getCourtStandardName({ ...request, name: approvedFacilityName, facilityName: approvedFacilityName });
  const approvalCourt = { ...request, name: approvedName, facilityName: approvedFacilityName, canonicalBaseName: approvedName };
  if (!approvedName) {
    return {
      ...state,
      notifications: [getAdminActionNotification("시군구와 시설명을 확인해야 합니다."), ...state.notifications],
    };
  }
  const sameLocationCourts = getCourtLocationMatches(
    approvalCourt,
    state,
    { excludeRequestId: requestId, includeRequests: false },
  );
  if (sameLocationCourts.length && !approval.multipleCourtsVerified) {
    return {
      ...state,
      notifications: [getAdminActionNotification("같은 장소의 복수 코트 여부를 확인해야 합니다."), ...state.notifications],
    };
  }
  const duplicateCourt = findCourtDuplicate(
    approvalCourt,
    state,
    { excludeRequestId: requestId, includeRequests: false },
  );
  if (duplicateCourt) {
    return {
      ...state,
      notifications: [getAdminActionNotification(getCourtDuplicateMessage(duplicateCourt)), ...state.notifications],
    };
  }
  const now = new Date().toISOString();
  const approvedCourt = {
    id: makeId("court"),
    name: approvedName,
    baseName: approvedFacilityName,
    facilityName: approvedFacilityName,
    courtUnit: request.courtUnit,
    sido: request.sido,
    sigungu: approvedSigungu,
    hashtag: request.hashtag,
    region: request.region,
    type: normalizeCourtType(request.type),
    addressText: request.addressText,
    roadAddress: request.roadAddress,
    jibunAddress: request.jibunAddress,
    addressDong: request.addressDong,
    zonecode: request.zonecode,
    detailAddress: request.detailAddress,
    locationNote: request.locationNote,
    lat: request.lat,
    lng: request.lng,
    courtKind: normalizeCourtKind(request.courtKind),
    surfaceType: normalizeCourtSurfaceType(request.surfaceType),
    courtLayout: normalizeCourtLayout(request.courtLayout),
    hoopCount: getCourtHoopCount(request),
    accessType: normalizeCourtAccessType(request.accessType, request.reservation),
    publicAccess: normalizeCourtPublicAccess(request.publicAccess),
    reservation: getCourtReservationValue(request),
    lighting: normalizeCourtOptionalBoolean(request.lighting),
    paid: normalizeCourtOptionalBoolean(request.paid),
    sourceUrl: normalizeCourtSourceUrl(request.sourceUrl),
    favorite: false,
    approvedAt: now,
    approvedBy: state.currentUserId,
    sourceRequestId: requestId,
  };
  const auditLog = {
    id: makeId("aa"),
    type: "court_approval",
    status: "committed",
    requestId,
    courtId: approvedCourt.id,
    targetUserId: request.requestedBy,
    createdAt: now,
    createdBy: state.currentUserId,
  };
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      approvedCourts: [approvedCourt, ...(state.settings?.approvedCourts ?? [])],
      courtRequests: (state.settings?.courtRequests ?? []).map((item) => (
        item.id === requestId
          ? { ...item, name: approvedName, status: "approved", approvedAt: now, approvedBy: state.currentUserId, approvedCourtId: approvedCourt.id }
          : item
      )),
      adminAuditLog: [auditLog, ...(state.settings?.adminAuditLog ?? [])],
    }),
    notifications: [
      getAdminActionNotification("구장 등록요청이 승인되어 등록 구장에 추가되었습니다.", "team"),
      {
        id: makeId("n"),
        targetUserId: request.requestedBy,
        title: "구장 등록 승인",
        body: `${approvedName} 구장 등록요청이 승인되었습니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}
