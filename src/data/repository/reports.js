import { REPORT_MATCH_WINDOW_MS } from "../../lib/constants.js";
import { VOID_MATCH_RESTORE_REPORT_REASON } from "../../lib/reportReasons.js";
import { canRequestVoidMatchRestore } from "../../lib/matchUtils.js";
import { getReportableMatchTimeMs } from "../../lib/matchUtils.js";
import { getReportableMatchUserIds } from "../../lib/matchUtils.js";
import { getVoidMatchRestoreTargetUserId } from "../../lib/matchUtils.js";
import { makeId } from "../rowUtils.js";
import { normalizeStateSettings as normalizeSettings } from "../stateNormalizer.js";
import { getDisciplineBlockedState } from "./guards.js";

function hasUnresolvedUserReport(state, type, targetId) {
  return (state.reports ?? []).some((report) => (
    report.type === type
    && report.targetId === targetId
    && report.by === state.currentUserId
    && !["dismissed", "resolved"].includes(report.status)
  ));
}

function prependReportNotification(state, notification) {
  return {
    ...state,
    notifications: [{ id: makeId("n"), ...notification }, ...state.notifications],
  };
}

function addReportWithNotification(state, report, notification) {
  return {
    ...state,
    reports: [report, ...(state.reports ?? [])],
    notifications: [{ id: makeId("n"), ...notification }, ...state.notifications],
  };
}

export function reportMatch(state, matchId, reason = "", reportedUserIds = []) {
  const disciplineBlock = getDisciplineBlockedState(state, "경기 신고");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const safeReason = String(reason).trim();
  const isVoidRestoreRequest = safeReason.startsWith(VOID_MATCH_RESTORE_REPORT_REASON);
  if (isVoidRestoreRequest && !canRequestVoidMatchRestore(match, state.currentUserId)) return state;
  const now = Date.now();
  const reportTime = getReportableMatchTimeMs(match);
  const matchPlayerIds = new Set(getReportableMatchUserIds(match));
  if (!matchPlayerIds.has(state.currentUserId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "신고 보류",
          body: "내가 출전했거나 후보로 등록된 경기만 신고할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (reportTime < now - REPORT_MATCH_WINDOW_MS || reportTime > now) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "신고 기한 만료",
          body: "경기 기록 신고는 최근 7일 내 내 경기만 가능합니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const voidTargetUserId = isVoidRestoreRequest ? getVoidMatchRestoreTargetUserId(match) : "";
  const safeReportedUserIds = isVoidRestoreRequest
    ? [voidTargetUserId].filter(Boolean)
    : Array.from(new Set((reportedUserIds ?? []).filter((userId) => matchPlayerIds.has(userId))));
  const report = {
    id: makeId("r"),
    type: "match",
    targetId: matchId,
    by: state.currentUserId,
    reportedUserIds: safeReportedUserIds,
    reason: safeReason || "기타 운영 확인 필요",
    status: "open",
    createdAt: new Date().toISOString(),
    ...(isVoidRestoreRequest ? {
      matchReviewType: "void_restore",
      voidReason: match.voidReason ?? "",
      voidedBy: voidTargetUserId,
      matchHostId: match.createdBy ?? "",
      voidedAt: match.voidedAt ?? null,
    } : {}),
  };

  return addReportWithNotification(state, report, {
    title: "신고 접수",
    body: `${match.title} 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
    tone: "match",
    matchId,
  });
}

export function reportPlayer(state, playerId, matchId, reason = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "플레이어 신고");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const player = state.users.find((item) => item.id === playerId);
  if (!match || !player || !playerId || playerId === state.currentUserId) return state;

  const now = Date.now();
  const reportTime = getReportableMatchTimeMs(match);
  const matchPlayerIds = new Set(getReportableMatchUserIds(match));
  if (!matchPlayerIds.has(state.currentUserId) || !matchPlayerIds.has(playerId)) return state;
  if (reportTime < now - REPORT_MATCH_WINDOW_MS || reportTime > now) return state;

  const duplicate = hasUnresolvedUserReport(state, "player", playerId);
  if (duplicate) return state;

  const report = {
    id: makeId("r"),
    type: "player",
    targetId: playerId,
    by: state.currentUserId,
    reportedUserIds: [playerId],
    sourceMatchId: matchId,
    reason: String(reason).trim() || "기타 운영 확인 필요",
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return addReportWithNotification(state, report, {
    title: "신고 접수",
    body: `${player.name} 플레이어 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
    tone: "match",
    matchId,
  });
}

export function reportCourtRequest(state, requestId, reason = "허위 구장 등록", options = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 신고");
  if (disciplineBlock) return disciplineBlock;
  const request = (state.settings?.courtRequests ?? []).find((item) => item.id === requestId);
  if (!request) return state;
  if (!["pending", "reported"].includes(request.status ?? "pending")) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "구장 신고 불가",
        body: "검토 대기 중인 구장 등록요청만 신고할 수 있습니다.",
        tone: "orange",
      }, ...state.notifications],
    };
  }
  if (request.requestedBy === state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 신고 보류",
          body: "내가 올린 구장 등록요청은 직접 신고할 수 없습니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }
  const duplicate = (state.reports ?? []).some((report) => (
    report.type === "court_request" &&
    report.targetId === requestId &&
    report.by === state.currentUserId &&
    report.status !== "dismissed"
  ));
  if (duplicate) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 신고 중복",
          body: "이미 같은 구장 등록요청을 신고했습니다.",
          tone: "orange",
        },
        ...state.notifications,
      ],
    };
  }

  const hasOpenReport = (state.reports ?? []).some((report) => (
    report.type === "court_request" &&
    report.targetId === requestId &&
    report.status === "open"
  ));

  const report = {
    id: String(options.reportId ?? "").trim() || makeId("r"),
    type: "court_request",
    targetId: requestId,
    by: state.currentUserId,
    reportedUserIds: [request.requestedBy].filter(Boolean),
    reason: String(reason || "허위 구장 등록").trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  };
  const nextRequests = (state.settings?.courtRequests ?? []).map((item) => (
    item.id === requestId
      ? {
        ...item,
        status: "reported",
        reportReviewPending: true,
        latestReportId: report.id,
        latestReportedAt: report.createdAt,
      }
      : item
  ));

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      courtRequests: nextRequests,
    }),
    reports: [report, ...(state.reports ?? [])],
    notifications: [
      ...(!hasOpenReport ? [{
        id: makeId("n"),
        targetUserId: request.requestedBy,
        title: "구장 등록요청 검토 중",
        body: `${request.name} 등록요청에 신고가 접수되어 운영자가 확인 중입니다. 판정 전에는 신뢰도에 영향이 없습니다.`,
        tone: "orange",
      }] : []),
      {
        id: makeId("n"),
        title: "구장 등록요청 신고 접수",
        body: `${request.name} 등록요청 신고가 접수되었습니다. 운영자 인정 전에는 요청자 신뢰도가 차감되지 않습니다.`,
        tone: "orange",
      },
      ...state.notifications,
    ],
  };
}

export function reportCourt(state, courtId, reason = "구장 위치 오류", courtSnapshot = null) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 신고");
  if (disciplineBlock) return disciplineBlock;
  const court = (state.settings?.approvedCourts ?? []).find((item) => item.id === courtId)
    ?? (courtSnapshot?.id === courtId ? courtSnapshot : null);
  if (!court) return state;
  const duplicate = hasUnresolvedUserReport(state, "court", courtId);
  if (duplicate) {
    return prependReportNotification(state, {
      title: "구장 신고 중복",
      body: "이미 같은 구장을 신고했습니다.",
      tone: "orange",
    });
  }

  const report = {
    id: makeId("r"),
    type: "court",
    targetId: courtId,
    by: state.currentUserId,
    reportedUserIds: [],
    reason: String(reason || "구장 위치 오류").trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return addReportWithNotification(state, report, {
    title: "구장 신고 접수",
    body: `${court.name} 신고가 접수됐습니다. 운영 검토 목록에 남겼습니다.`,
    tone: "orange",
  });
}

export function reportCourtReview(state, reviewId, reason = "구장 리뷰 문제") {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 리뷰 신고");
  if (disciplineBlock) return disciplineBlock;
  const review = (state.settings?.courtReviews ?? []).find((item) => item.id === reviewId);
  if (!review || review.reviewerId === state.currentUserId) return state;
  const duplicate = hasUnresolvedUserReport(state, "court_review", reviewId);
  if (duplicate) {
    return prependReportNotification(state, {
      title: "리뷰 신고 중복",
      body: "이미 같은 구장 리뷰를 신고했습니다.",
      tone: "orange",
    });
  }

  const report = {
    id: makeId("r"),
    type: "court_review",
    targetId: reviewId,
    by: state.currentUserId,
    reportedUserIds: [review.reviewerId].filter(Boolean),
    reason: String(reason || "구장 리뷰 문제").trim(),
    status: "open",
    createdAt: new Date().toISOString(),
  };

  return addReportWithNotification(state, report, {
    title: "구장 리뷰 신고 접수",
    body: `${review.courtName ?? "구장"} 리뷰 신고가 접수됐습니다.`,
    tone: "orange",
  });
}

export function reportTeamEmblem(state, teamId, reason = "부적절한 이미지", teamSnapshot = null) {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 엠블럼 신고");
  if (disciplineBlock) return disciplineBlock;
  const team = (state.teams ?? []).find((item) => item.id === teamId)
    ?? (teamSnapshot?.id === teamId ? teamSnapshot : null);
  const captainId = team?.members?.find((member) => member.role === "captain")?.userId;
  if (!team || !captainId || captainId === state.currentUserId || team.emblemSource !== "upload" || !team.emblemKey) {
    return state;
  }
  const duplicate = hasUnresolvedUserReport(state, "team_emblem", teamId);
  if (duplicate) {
    return prependReportNotification(state, {
      title: "엠블럼 신고 중복",
      body: "이미 같은 팀 엠블럼을 신고했습니다.",
      tone: "orange",
      type: "report",
    });
  }

  const now = new Date().toISOString();
  const report = {
    id: makeId("r"),
    type: "team_emblem",
    targetId: teamId,
    by: state.currentUserId,
    reportedUserIds: [captainId],
    reason: String(reason || "부적절한 이미지").trim().slice(0, 500) || "부적절한 이미지",
    teamName: team.name,
    captainId,
    emblemKey: team.emblemKey,
    emblemSource: team.emblemSource,
    emblemUpdatedAt: team.emblemUpdatedAt,
    status: "open",
    createdAt: now,
  };
  return addReportWithNotification(state, report, {
    title: "팀 엠블럼 신고 접수",
    body: `${team.name} 엠블럼 신고를 접수했습니다. 관리자 확인 후 결과를 알려드립니다.`,
    tone: "orange",
    type: "report",
    createdAt: now,
  });
}
