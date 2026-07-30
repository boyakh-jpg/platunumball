import { adjustUserTrust } from "../../trustUtils.js";
import { clampTrustScore } from "../../trustUtils.js";
import { getMatchTrustFeedbackLimit } from "../../../lib/matchUtils.js";
import { getMatchTrustFeedbackParticipantIds } from "../../../lib/matchUtils.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { isMatchTrustFeedbackOpen } from "../../../lib/matchUtils.js";
import { makeId } from "../../rowUtils.js";
import { normalizeCourtReviewRating } from "../../../lib/courts.js";
import { normalizeStateSettings as normalizeSettings } from "../../stateNormalizer.js";
import { getDisciplineBlockedState } from "../guards.js";

export function toggleMatchStar(state, matchId, targetUserId) {
  const disciplineBlock = getDisciplineBlockedState(state, "경기 평가");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const feedbackIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  if (!match || !isMatchTrustFeedbackOpen(match)) return state;
  if (!feedbackIds.includes(state.currentUserId) || !feedbackIds.includes(targetUserId) || targetUserId === state.currentUserId) return state;

  const maxStars = getMatchTrustFeedbackLimit(match);
  const trustFeedback = match.trustFeedback ?? {};
  const stars = trustFeedback.stars ?? {};
  const myStars = stars[state.currentUserId] ?? [];
  const alreadyStarred = myStars.includes(targetUserId);
  if (!alreadyStarred && myStars.length >= maxStars) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "추천 한도 도달",
          body: `한 경기에서 최대 ${maxStars}명에게 추천을 보낼 수 있습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const nextMyStars = alreadyStarred
    ? myStars.filter((userId) => userId !== targetUserId)
    : [...myStars, targetUserId];
  const nextStars = { ...stars, [state.currentUserId]: nextMyStars };

  return {
    ...state,
    users: adjustUserTrust(state.users, targetUserId, alreadyStarred ? -1 : 1),
    matches: state.matches.map((item) => (
      item.id === matchId
        ? {
            ...item,
            trustFeedback: {
              ...trustFeedback,
              stars: nextStars,
              updatedAt: new Date().toISOString(),
            },
          }
        : item
    )),
  };
}

export function submitMatchThumbs(state, matchId, targetUserIds = []) {
  const disciplineBlock = getDisciplineBlockedState(state, "경기 평가");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const feedbackIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  if (!match || !isMatchTrustFeedbackOpen(match)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "추천 마감",
          body: "추천은 기록 확정 후 24시간 안에만 보낼 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (!feedbackIds.includes(state.currentUserId)) return state;

  const userIds = new Set(state.users.map((user) => user.id));
  const maxThumbs = getMatchTrustFeedbackLimit(match);
  const nextMyThumbs = Array.from(new Set(targetUserIds))
    .filter((targetUserId) => feedbackIds.includes(targetUserId) && userIds.has(targetUserId) && targetUserId !== state.currentUserId)
    .slice(0, maxThumbs);
  const trustFeedback = match.trustFeedback ?? {};
  const thumbs = trustFeedback.stars ?? {};
  const previousThumbs = thumbs[state.currentUserId] ?? [];
  const previousSet = new Set(previousThumbs);
  const nextSet = new Set(nextMyThumbs);
  const adjustedUsers = state.users.map((user) => {
    if (!feedbackIds.includes(user.id) || user.id === state.currentUserId) return user;
    const gained = nextSet.has(user.id) && !previousSet.has(user.id);
    const lost = previousSet.has(user.id) && !nextSet.has(user.id);
    if (!gained && !lost) return user;
    return {
      ...user,
      trustScore: clampTrustScore((user.trustScore ?? 80) + (gained ? 1 : -1)),
    };
  });

  return {
    ...state,
    users: adjustedUsers,
    matches: state.matches.map((item) => (
      item.id === matchId
        ? {
            ...item,
            trustFeedback: {
              ...trustFeedback,
              stars: { ...thumbs, [state.currentUserId]: nextMyThumbs },
              updatedAt: new Date().toISOString(),
            },
          }
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "추천 저장 완료",
        body: `${nextMyThumbs.length}명에게 추천을 보냈습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function submitCourtReview(state, matchId, draft = {}) {
  const disciplineBlock = getDisciplineBlockedState(state, "구장 리뷰");
  if (disciplineBlock) return disciplineBlock;

  const match = state.matches.find((item) => item.id === matchId);
  const participantIds = match ? getMatchTrustFeedbackParticipantIds(match) : [];
  const currentUserId = state.currentUserId;
  const matchFinished = Boolean(match?.endedAt || match?.result || ["approval", "disputed", "confirmed"].includes(match?.status)) && !["void", "cancelled"].includes(match?.status);
  if (!match || !matchFinished || !participantIds.includes(currentUserId)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "구장 리뷰 불가",
          body: "구장 리뷰는 해당 경기 참가자만 경기 후 작성할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const rating = normalizeCourtReviewRating(draft.rating, null);
  if (!rating) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "별점 필요",
          body: "구장 별점은 1점부터 5점까지 선택해야 합니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const reviews = state.settings?.courtReviews ?? [];
  const existing = reviews.find((review) => review.matchId === matchId && review.reviewerId === currentUserId);
  const registeredCourt = getRegisteredCourts(state).find((court) => court.name === match.court);
  const now = new Date().toISOString();
  const review = {
    ...(existing ?? {}),
    id: existing?.id ?? `cvr_${matchId}_${currentUserId}`.replace(/[^a-zA-Z0-9_]/g, "_"),
    courtId: registeredCourt?.id ?? existing?.courtId ?? null,
    courtName: match.court,
    matchId,
    reviewerId: currentUserId,
    rating,
    surfaceRating: normalizeCourtReviewRating(draft.surfaceRating, null),
    rimRating: normalizeCourtReviewRating(draft.rimRating, null),
    lightingRating: normalizeCourtReviewRating(draft.lightingRating, null),
    crowdRating: normalizeCourtReviewRating(draft.crowdRating, null),
    locationAccuracy: normalizeCourtReviewRating(draft.locationAccuracy, null),
    fitModes: Array.isArray(draft.fitModes) ? draft.fitModes : existing?.fitModes ?? [],
    tags: Array.isArray(draft.tags) ? draft.tags : existing?.tags ?? [],
    memo: String(draft.memo ?? "").trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const nextReviews = existing
    ? reviews.map((item) => (item.id === existing.id ? review : item))
    : [review, ...reviews];

  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      courtReviews: nextReviews,
    }),
    notifications: [
      {
        id: makeId("n"),
        title: existing ? "구장 리뷰 수정" : "구장 리뷰 제출",
        body: `${match.court} 리뷰가 저장되었습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}
