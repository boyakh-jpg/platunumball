import { MATCH_SIDES } from "../../../lib/constants.js";
import { RECORD_TYPES } from "../../../lib/constants.js";
import { courtIdByName } from "../../../lib/courts.js";
import { getCourtId } from "../../../lib/courts.js";
import { getMatchCreationPolicyPayload } from "../../../lib/matchCreationPolicies.js";
import { getMatchPlayerIds } from "../../../lib/matchUtils.js";
import { getMatchReservePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchRulesPayload } from "../../../lib/matchRules.js";
import { getMatchScheduledDate } from "../../../lib/matchUtils.js";
import { getPickupCompatibilityPlacements } from "../../../lib/roomFlow.js";
import { getPickupParticipantCapacity } from "../../../lib/roomFlow.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingLobby } from "../../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../../lib/recruiting.js";
import { getRecruitingRoomParticipantIds } from "../../../lib/recruiting.js";
import { getRecruitingRuleAcknowledgement } from "../../../lib/roomFlow.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { getRoomEditAvailability } from "../../../lib/roomFlow.js";
import { getRoomScheduleProposalProgress } from "../../../lib/roomFlow.js";
import { isPickupRecruitingRoom } from "../../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { isSupportedMatchMode } from "../../../lib/constants.js";
import { isSupportedSoloRecordMode } from "../../../lib/constants.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../../lib/recruiting.js";
import { normalizeRecruitingMmrRangeMode } from "../../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { getRecruitingReserveLimitNotification } from "../guards.js";
import { currentUserCanOperateMatchPreparation } from "../matchAccess.js";
import { getServerRatingValue } from "../runtime.js";

export function acknowledgeRecruitingRoomRules(state, postId, revision = 0) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const acknowledgement = getRecruitingRuleAcknowledgement(post);
  if (acknowledgement.revision !== Number(revision)
    || !acknowledgement.requiredIds.includes(state.currentUserId)
    || acknowledgement.acknowledgedIds.includes(state.currentUserId)) return state;
  const nextAcknowledgedIds = uniquePlayerIds([...acknowledgement.acknowledgedIds, state.currentUserId]);
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => item.id === postId ? {
      ...item,
      roomState: {
        ...(item.roomState ?? {}),
        ruleAcknowledgedIds: nextAcknowledgedIds,
      },
    } : item),
  };
}
export function acknowledgeMatchRoomRules(state, matchId, revision = 0) {
  const match = state.matches.find((item) => item.id === matchId);
  const requiredIds = uniquePlayerIds(match?.rules?.ruleAcknowledgementRequiredIds ?? []);
  const acknowledgedIds = uniquePlayerIds(match?.rules?.ruleAcknowledgedIds ?? []);
  if (!match || Number(match.rules?.ruleRevision ?? 0) !== Number(revision)
    || !requiredIds.includes(state.currentUserId)
    || acknowledgedIds.includes(state.currentUserId)) return state;
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      rules: {
        ...(item.rules ?? {}),
        ruleAcknowledgedIds: uniquePlayerIds([...acknowledgedIds, state.currentUserId]),
      },
    } : item),
  };
}
function resolveScheduleProposal({ room = {}, proposalId = "", actorId = "", decision = "approve" } = {}) {
  const progress = getRoomScheduleProposalProgress(room);
  const proposal = progress.proposal;
  if (!proposal || proposal.status !== "pending" || proposal.id !== proposalId
    || !progress.requiredIds.includes(actorId)) return null;
  if (progress.expired) {
    return {
      status: "expired",
      proposal: { ...proposal, status: "expired", expiredAt: new Date().toISOString() },
    };
  }
  if (decision === "reject") {
    return {
      status: "rejected",
      proposal: { ...proposal, status: "rejected", rejectedBy: actorId, rejectedAt: new Date().toISOString() },
    };
  }
  const approvedIds = uniquePlayerIds([...progress.approvedIds, actorId]);
  const complete = progress.requiredIds.every((playerId) => approvedIds.includes(playerId));
  return {
    status: complete ? "approved" : "pending",
    proposal: {
      ...proposal,
      approvedIds,
      status: complete ? "approved" : "pending",
      ...(complete ? { appliedAt: new Date().toISOString() } : {}),
    },
  };
}
function getScheduleProposalResolutionCopy(roomTitle, status) {
  const title = status === "approved" ? "일정 변경 확정"
    : status === "rejected" ? "일정 변경 반려"
      : status === "expired" ? "일정 변경 기한 만료" : "일정 변경 승인";
  const body = status === "approved"
    ? `${roomTitle}의 새 일정과 구장이 확정되었습니다.`
    : status === "rejected"
      ? `${roomTitle}의 일정 변경안이 반려되어 기존 일정이 유지됩니다.`
      : status === "expired"
        ? `${roomTitle}의 일정 변경 동의 기한이 지나 기존 일정이 유지됩니다.`
        : `${roomTitle} 일정 변경안에 승인했습니다.`;
  return { title, body };
}
function getScheduleProposalResolutionNotifications(
  resolution,
  { roomTitle, typePrefix, entityKey, entityId },
) {
  if (resolution.status === "pending") return [];
  const { title, body } = getScheduleProposalResolutionCopy(roomTitle, resolution.status);
  const typeSuffix = resolution.status === "approved"
    ? "applied"
    : resolution.status === "expired" ? "expired" : "rejected";
  return resolution.proposal.requiredIds.map((targetUserId) => ({
    id: makeId("n"),
    targetUserId,
    title,
    body,
    tone: "match",
    type: `${typePrefix}_schedule_change_${typeSuffix}`,
    discordEvent: "match",
    [entityKey]: entityId,
  }));
}
export function respondRecruitingScheduleProposal(state, postId, proposalId, decision = "approve") {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open") return state;
  const resolution = resolveScheduleProposal({
    room: post,
    proposalId,
    actorId: state.currentUserId,
    decision,
  });
  if (!resolution) return state;
  const applied = resolution.status === "approved";
  const selectedCourt = applied
    ? getRegisteredCourts(state).find((court) => court.id === resolution.proposal.courtId) ?? null
    : null;
  const nextPost = {
    ...post,
    ...(applied ? {
      timingType: resolution.proposal.timingType,
      scheduledDate: resolution.proposal.scheduledDate,
      scheduledTime: resolution.proposal.scheduledTime,
      scheduledAt: resolution.proposal.scheduledAt,
      courtId: resolution.proposal.courtId,
      court: selectedCourt?.name ?? resolution.proposal.court,
      region: selectedCourt?.region ?? post.region,
    } : {}),
    roomState: {
      ...(post.roomState ?? {}),
      scheduleProposal: resolution.proposal,
    },
  };
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => item.id === postId ? nextPost : item),
    notifications: [
      ...getScheduleProposalResolutionNotifications(resolution, {
        roomTitle: post.title,
        typePrefix: "recruiting",
        entityKey: "recruitingPostId",
        entityId: postId,
      }),
      ...state.notifications,
    ],
  };
}
export function respondMatchScheduleProposal(state, matchId, proposalId, decision = "approve") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match) return state;
  const resolution = resolveScheduleProposal({
    room: match,
    proposalId,
    actorId: state.currentUserId,
    decision,
  });
  if (!resolution) return state;
  const applied = resolution.status === "approved";
  const selectedCourt = applied
    ? getRegisteredCourts(state).find((court) => court.id === resolution.proposal.courtId) ?? null
    : null;
  const nextMatch = {
    ...match,
    ...(applied ? {
      timingType: resolution.proposal.timingType,
      scheduledDate: resolution.proposal.scheduledDate,
      scheduledTime: resolution.proposal.scheduledTime,
      scheduledAt: resolution.proposal.scheduledAt,
      courtId: resolution.proposal.courtId,
      court: selectedCourt?.name ?? resolution.proposal.court,
    } : {}),
    rules: {
      ...(match.rules ?? {}),
      scheduleProposal: resolution.proposal,
      ...(applied && selectedCourt?.region ? { region: selectedCourt.region } : {}),
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    notifications: [
      ...getScheduleProposalResolutionNotifications(resolution, {
        roomTitle: match.title,
        typePrefix: "match",
        entityKey: "matchId",
        entityId: matchId,
      }),
      ...state.notifications,
    ],
  };
}
