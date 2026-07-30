import { getCourtHoopCount } from "../../../lib/courts.js";
import { normalizeCourtOptionalBoolean } from "../../../lib/courts.js";
import { makeClientNotificationId } from "../serverOperations.js";
import { normalizeServerState } from "../stateNormalization.js";
import { mergeMatchesById, mergeRecruitingPostsById, preserveOptimisticMatchAttendance } from "./entities.js";
import { mergeRemoteMatchPage, mergeRemoteRecruitingPage } from "./pages.js";

export function mergeCourtApprovalResult(state, requestId, result = {}, currentUserId = "") {
  const safeRequestId = String(result?.requestId ?? requestId ?? "").trim();
  const approvedCourtId = String(result?.approvedCourtId ?? "").trim();
  if (!safeRequestId || !approvedCourtId) return state;

  const request = (state.settings?.courtRequests ?? []).find((item) => item.id === safeRequestId);
  if (!request) return state;
  const approvedName = String(result?.approvedName ?? request.name ?? "").trim();

  const now = new Date().toISOString();
  const approvedCourt = {
    ...request,
    name: approvedName,
    id: approvedCourtId,
    sourceRequestId: safeRequestId,
    approvedBy: currentUserId,
    approvedAt: now,
    status: "active",
    hoopCount: getCourtHoopCount(request),
    lighting: normalizeCourtOptionalBoolean(request.lighting),
    favorite: false,
  };
  const nextApprovedCourts = [
    approvedCourt,
    ...(state.settings?.approvedCourts ?? []).filter((court) => (
      court.id !== approvedCourtId &&
      court.sourceRequestId !== safeRequestId
    )),
  ];

  return {
    ...state,
    settings: {
      ...(state.settings ?? {}),
      approvedCourts: nextApprovedCourts,
      courtRequests: (state.settings?.courtRequests ?? []).map((item) => (
        item.id === safeRequestId
          ? { ...item, name: approvedName, status: "approved", approvedAt: now, approvedBy: currentUserId, approvedCourtId }
          : item
      )),
    },
    notifications: [
      {
        id: makeClientNotificationId("n"),
        title: "구장 승인 완료",
        body: `${approvedName} 등록 구장이 승인되었습니다.`,
        tone: "team",
        createdAt: now,
      },
      ...(state.notifications ?? []),
    ],
  };
}
export function mergeServerRoomResult(state, result = {}, options = {}) {
  if (!result || typeof result !== "object") return state;
  const nextPost = result.post ?? null;
  const rawNextMatch = result.createdMatch ?? result.match ?? null;
  const remoteState = result.state ? normalizeServerState(result.state) : null;
  const forcePostIds = new Set([nextPost?.id, ...(remoteState?.recruitingPosts ?? []).map((post) => post?.id)].filter(Boolean));
  const forceMatchIds = new Set([rawNextMatch?.id, ...(remoteState?.matches ?? []).map((match) => match?.id)].filter(Boolean));
  const baseState = remoteState
    ? (nextPost
      ? mergeRemoteRecruitingPage(state, remoteState, { forceRecruitingPostIds: forcePostIds })
      : mergeRemoteMatchPage(state, remoteState, { forceMatchIds, forceRecruitingPostIds: forcePostIds }))
    : state;
  const existingMatch = rawNextMatch
    ? (baseState.matches ?? []).find((match) => match.id === rawNextMatch.id) ?? null
    : null;
  const nextMatch = rawNextMatch && options.preserveMatchAttendance === true
    ? preserveOptimisticMatchAttendance(rawNextMatch, existingMatch)
    : rawNextMatch;
  if (!nextPost && !nextMatch) return baseState;
  return {
    ...baseState,
    recruitingPosts: nextPost ? mergeRecruitingPostsById(baseState.recruitingPosts ?? [], [nextPost], forcePostIds) : baseState.recruitingPosts,
    matches: nextMatch ? mergeMatchesById(baseState.matches ?? [], [nextMatch], forceMatchIds) : baseState.matches,
  };
}
export function mergeMatchThumbsResult(state, result = {}, operation = {}) {
  const matchId = result.matchId ?? operation.matchId ?? "";
  const actorProfileId = result.actorProfileId ?? "";
  if (!matchId || !actorProfileId) return state;
  const targetUserIds = Array.isArray(result.targetUserIds)
    ? result.targetUserIds.filter(Boolean)
    : [];
  return {
    ...state,
    matches: (state.matches ?? []).map((match) => {
      if (match.id !== matchId) return match;
      const trustFeedback = match.trustFeedback ?? {};
      return {
        ...match,
        trustFeedback: {
          ...trustFeedback,
          stars: {
            ...(trustFeedback.stars ?? {}),
            [actorProfileId]: targetUserIds,
          },
          updatedAt: new Date().toISOString(),
        },
      };
    }),
  };
}
