import { ADMIN_GRADE_META } from "../../../lib/admin.js";
import { ADMIN_REVIEW_ACTIONS } from "../../../lib/admin.js";
import { DAY_MS } from "../../../lib/constants.js";
import { FALSE_COURT_REPORT_TRUST_PENALTY } from "../../../lib/constants.js";
import { MAX_TEAM_NAME_LENGTH } from "../../../lib/constants.js";
import { REFEREE_GRADE_META } from "../../../lib/admin.js";
import { adjustUserTrust } from "../../trustUtils.js";
import { canManageAppointmentRole } from "../../../lib/admin.js";
import { findCourtDuplicate } from "../../../lib/courts.js";
import { getAdminAuthorityLevel } from "../../../lib/admin.js";
import { getAppointmentTermDays } from "../../../lib/admin.js";
import { getCourtCorrectionPatch } from "../../../lib/courts.js";
import { getCourtDuplicateMessage } from "../../../lib/courts.js";
import { getCourtFacilityBaseName } from "../../../lib/courts.js";
import { getCourtHoopCount } from "../../../lib/courts.js";
import { getCourtLocationMatches } from "../../../lib/courts.js";
import { getCourtReservationValue } from "../../../lib/courts.js";
import { getCourtStandardName } from "../../../lib/courts.js";
import { getReportTargetUserId } from "../../../lib/admin.js";
import { getSuspensionTier } from "../../../lib/admin.js";
import { hasAdminAccess } from "../../../lib/admin.js";
import { isAppointmentActive } from "../../../lib/admin.js";
import { makeId } from "../../rowUtils.js";
import { normalizeCourtAccessType } from "../../../lib/courts.js";
import { normalizeCourtKind } from "../../../lib/courts.js";
import { normalizeCourtLayout } from "../../../lib/courts.js";
import { normalizeCourtOptionalBoolean } from "../../../lib/courts.js";
import { normalizeCourtPublicAccess } from "../../../lib/courts.js";
import { normalizeCourtSigungu } from "../../../lib/courts.js";
import { normalizeCourtSourceUrl } from "../../../lib/courts.js";
import { normalizeCourtSurfaceType } from "../../../lib/courts.js";
import { normalizeCourtType } from "../../../lib/courts.js";
import { normalizeStateSettings as normalizeSettings } from "../../stateNormalizer.js";
import { finalizeMatch } from "../lifecycle.js";
import { getServerRatingValue } from "../runtime.js";

export function getAdminActionNotification(body, tone = "orange") {
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
