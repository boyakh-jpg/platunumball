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
import { getPendingScheduleChangeNotification, getRecruitingChangeRequiredIds, getRoomChangeDeadlineAt, getRoomEditLimitNotification, getRoomEditWindowNotification, getRoomScheduleTarget, hasNonScheduleRoomChange, hasRoomScheduleChange, withoutRoomSchedulePatch } from "./helpers.js";

export function updateRecruitingRoomRules(state, postId, patch = {}) {
  const post = state.recruitingPosts?.find((item) => item.id === postId);
  if (!post || post.status !== "open" || !isRecruitingRoomOwner(post, state.currentUserId)) return state;
  const editAvailability = getRoomEditAvailability(post);
  if (!editAvailability.allowed) {
    const notification = editAvailability.reason === "limit"
      ? getRoomEditLimitNotification({ postId })
      : getRoomEditWindowNotification({ postId });
    return { ...state, notifications: [notification, ...state.notifications] };
  }
  if (isRoomScheduleChangePending(post)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ postId }), ...state.notifications] };
  }

  const requiredIds = getRecruitingChangeRequiredIds(post, state);
  const scheduleChanged = hasRoomScheduleChange(post, patch);
  const scheduleNeedsApproval = scheduleChanged && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const roomPatch = scheduleNeedsApproval ? withoutRoomSchedulePatch(patch) : patch;
  const generalRulesChanged = hasNonScheduleRoomChange(post, roomPatch);
  const ruleAcknowledgementNeeded = generalRulesChanged
    && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const scheduleTarget = getRoomScheduleTarget(post, patch);
  const changeDeadlineAt = getRoomChangeDeadlineAt(post, scheduleTarget);

  const currentCapacity = getRecruitingSideCapacity(post);
  const sideCapacity = Math.max(1, Math.min(5, Number(roomPatch.sideCapacity ?? currentCapacity)));
  const nextMode = `${sideCapacity}v${sideCapacity}`;
  if (!isSupportedMatchMode(nextMode)) return state;
  const benchCapacity = getRecruitingBenchCapacity({ ...post, benchCapacity: roomPatch.benchCapacity });
  const currentLobby = getRecruitingLobby(post, state);
  const pickupRoom = isPickupRecruitingRoom(post);
  const pickupParticipantIds = pickupRoom ? getRecruitingRoomParticipantIds(post, state) : [];
  const pickupParticipantCapacity = getPickupParticipantCapacity({ sideCapacity, benchCapacity });
  if (pickupRoom && pickupParticipantIds.length > pickupParticipantCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: `현재 참가자가 ${pickupParticipantIds.length}명이므로 전체 참가 정원을 ${pickupParticipantCapacity}명으로 줄일 수 없습니다.`,
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  if (!pickupRoom && (currentLobby.sides.teamA.projectedFilled > sideCapacity || currentLobby.sides.teamB.projectedFilled > sideCapacity)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: "현재 출전 인원이 새 정원보다 많습니다. 먼저 후보 명단으로 이동한 뒤 다시 변경해 주세요.",
          tone: "orange",
          recruitingPostId: postId,
        },
        ...state.notifications,
      ],
    };
  }
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  if (!pickupRoom && (currentLobby.sides.teamA.reserveCandidates.length > benchCapacity || currentLobby.sides.teamB.reserveCandidates.length > benchCapacity)) {
    return {
      ...state,
      notifications: [getRecruitingReserveLimitNotification(postId, "teamA", benchCapacity), ...state.notifications],
    };
  }
  const nextMmrRangeMode = normalizeRecruitingMmrRangeMode(roomPatch.mmrRangeMode ?? post.mmrRangeMode ?? roomState.mmrRangeMode);
  const nextOperations = getMatchCreationPolicyPayload({
    ...post,
    ...(post.rules ?? {}),
    ...roomPatch,
    mode: nextMode,
  });
  const nextRules = {
    ...getMatchRulesPayload({ ...(post.rules ?? {}), ...roomPatch }, { mode: nextMode }),
    ballProvider: nextOperations.ballProvider,
    vestsProvided: nextOperations.vestsProvided,
  };
  const updatedAt = new Date().toISOString();
  const nextCourtName = roomPatch.court === undefined ? post.court : String(roomPatch.court || post.court || "미정").slice(0, 80);
  const nextCourt = getRegisteredCourts(state).find((court) => court.name === nextCourtName || court.id === roomPatch.courtId) ?? null;
  const nextCourtId = roomPatch.court === undefined ? getCourtId(post) : (nextCourt?.id ?? courtIdByName(nextCourtName));
  const pickupPlacements = pickupRoom
    ? getPickupCompatibilityPlacements(pickupParticipantIds.length, {
        sideCapacity,
        benchCapacity,
        hostSide: post.hostSide,
      })
    : [];
  const pickupPlacementByPlayerId = pickupRoom
    ? Object.fromEntries(pickupParticipantIds.map((playerId, index) => [playerId, pickupPlacements[index]]))
    : {};
  const nextApplicants = normalizeRecruitingApplicants(post.applicants ?? []).map((applicant) => {
    const placement = pickupPlacementByPlayerId[applicant.playerId];
    return placement ? { ...applicant, ...placement } : applicant;
  });
  const nextPinnedReservePlayers = pickupRoom
    ? MATCH_SIDES.reduce((result, sideName) => {
        const playerIds = nextApplicants
          .filter((applicant) => applicant.side === sideName && applicant.reserve)
          .map((applicant) => applicant.playerId)
          .filter(Boolean);
        if (playerIds.length) result[sideName] = playerIds;
        return result;
      }, {})
    : roomState.pinnedReservePlayers;
  const nextInvitations = pickupRoom
    ? (roomState.invitations ?? []).map((invitation) => (
        invitation.role === "referee"
          ? invitation
          : { ...invitation, joinMode: "player", teamId: "", reserve: false }
      ))
    : roomState.invitations;
  const nextPost = {
    ...post,
    mode: nextMode,
    sideCapacity,
    benchCapacity,
    region: nextCourt?.region ?? post.region,
    courtId: nextCourtId,
    court: nextCourtName,
    timingType: scheduleNeedsApproval ? post.timingType : scheduleTarget.timingType,
    scheduledDate: scheduleNeedsApproval ? post.scheduledDate : scheduleTarget.scheduledDate,
    scheduledTime: scheduleNeedsApproval ? post.scheduledTime : scheduleTarget.scheduledTime,
    scheduledAt: scheduleNeedsApproval ? post.scheduledAt : scheduleTarget.scheduledAt,
    mmrRangeMode: nextMmrRangeMode,
    ratingScale: post.ranked === false ? 0 : getServerRatingValue("getRecruitingRatingScale", { ...post, mmrRangeMode: nextMmrRangeMode }),
    rules: {
      ...(post.rules ?? {}),
      ...nextRules,
      sideCapacity,
      benchCapacity,
      onCourtCount: sideCapacity,
      starterCount: sideCapacity,
      teamCapacity: sideCapacity + benchCapacity,
      ...(pickupRoom ? {
        participantCapacity: pickupParticipantCapacity,
        waitingPlayerCapacity: benchCapacity * 2,
      } : {}),
      mmrRangeMode: nextMmrRangeMode,
      ratingScale: post.ranked === false ? 0 : getServerRatingValue("getRecruitingRatingScale", { ...post, mmrRangeMode: nextMmrRangeMode }),
    },
    memo: roomPatch.memo === undefined ? post.memo : String(roomPatch.memo ?? "").slice(0, 500),
    stakes: roomPatch.stakes === undefined ? post.stakes : String(roomPatch.stakes ?? "").slice(0, 500),
    hostReady: true,
    applicants: nextApplicants,
    roomState: {
      ...roomState,
      ...(pickupRoom ? {
        hostReserve: false,
        partyLeaders: {},
        partySides: {},
        partyReserves: {},
        pinnedReservePlayers: nextPinnedReservePlayers,
        invitations: nextInvitations,
      } : {}),
      mmrRangeMode: nextMmrRangeMode,
      roomEditCount: 1,
      roomEditedAt: updatedAt,
      roomEditedBy: state.currentUserId,
      ruleRevision: generalRulesChanged ? Number(roomState.ruleRevision ?? 0) + 1 : Number(roomState.ruleRevision ?? 0),
      ruleChangedAt: generalRulesChanged ? updatedAt : roomState.ruleChangedAt,
      ...(generalRulesChanged ? {
        ruleAcknowledgementRequiredIds: requiredIds,
        ruleAcknowledgedIds: [state.currentUserId],
        ruleAcknowledgementDeadlineAt: changeDeadlineAt,
      } : {
        ruleAcknowledgementRequiredIds: roomState.ruleAcknowledgementRequiredIds ?? [],
        ruleAcknowledgedIds: roomState.ruleAcknowledgedIds ?? [],
        ruleAcknowledgementDeadlineAt: roomState.ruleAcknowledgementDeadlineAt,
      }),
      ...(scheduleNeedsApproval ? {
        scheduleProposal: {
          id: makeId("schedule"),
          status: "pending",
          proposedBy: state.currentUserId,
          proposedAt: updatedAt,
          consentDeadlineAt: changeDeadlineAt,
          ...scheduleTarget,
          requiredIds,
          approvedIds: [state.currentUserId],
        },
      } : {}),
    },
  };
  const targetNotifications = requiredIds
    .filter((playerId) => playerId !== state.currentUserId)
    .flatMap((targetUserId) => [
      ...(ruleAcknowledgementNeeded ? [{
        id: makeId("n"),
        targetUserId,
        title: "방 정보 변경 확인",
        body: `${post.title}의 경기 규칙이 변경되었습니다. 방에서 변경 내용을 확인해 주세요.`,
        tone: "match",
        type: "recruiting_rules_changed",
        discordEvent: "match",
        recruitingPostId: postId,
        actionRequired: true,
      }] : []),
      ...(scheduleNeedsApproval ? [{
        id: makeId("n"),
        targetUserId,
        title: "일정 변경 승인 요청",
        body: `${post.title}의 일정 또는 구장 변경안이 도착했습니다. 기존 일정은 전원 승인 전까지 유지됩니다.`,
        tone: "match",
        type: "recruiting_schedule_change_requested",
        discordEvent: "match",
        recruitingPostId: postId,
        actionRequired: true,
      }] : []),
    ]);
  return {
    ...state,
    recruitingPosts: (state.recruitingPosts ?? []).map((item) => (item.id === postId ? nextPost : item)),
    notifications: [...targetNotifications, ...state.notifications],
  };
}
