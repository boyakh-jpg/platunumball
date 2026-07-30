import { MATCH_SIDES } from "../../lib/constants.js";
import { RECORD_TYPES } from "../../lib/constants.js";
import { courtIdByName } from "../../lib/courts.js";
import { getCourtId } from "../../lib/courts.js";
import { getMatchCreationPolicyPayload } from "../../lib/matchCreationPolicies.js";
import { getMatchPlayerIds } from "../../lib/matchUtils.js";
import { getMatchReservePlayerIds } from "../../lib/matchUtils.js";
import { getMatchRulesPayload } from "../../lib/matchRules.js";
import { getMatchScheduledDate } from "../../lib/matchUtils.js";
import { getPickupCompatibilityPlacements } from "../../lib/roomFlow.js";
import { getPickupParticipantCapacity } from "../../lib/roomFlow.js";
import { getRecruitingBenchCapacity } from "../../lib/recruiting.js";
import { getRecruitingLobby } from "../../lib/recruiting.js";
import { getRecruitingRoomOwnerId } from "../../lib/recruiting.js";
import { getRecruitingRoomParticipantIds } from "../../lib/recruiting.js";
import { getRecruitingRuleAcknowledgement } from "../../lib/roomFlow.js";
import { getRecruitingSideCapacity } from "../../lib/recruiting.js";
import { getRegisteredCourts } from "../../lib/courts.js";
import { getRoomEditAvailability } from "../../lib/roomFlow.js";
import { getRoomScheduleProposalProgress } from "../../lib/roomFlow.js";
import { isPickupRecruitingRoom } from "../../lib/recruiting.js";
import { isRecruitingRoomOwner } from "../../lib/recruiting.js";
import { isRoomScheduleChangePending } from "../../lib/roomFlow.js";
import { isSupportedMatchMode } from "../../lib/constants.js";
import { isSupportedSoloRecordMode } from "../../lib/constants.js";
import { makeId } from "../rowUtils.js";
import { normalizeRecruitingApplicants } from "../../lib/recruiting.js";
import { normalizeRecruitingMmrRangeMode } from "../../lib/recruiting.js";
import { normalizeRecruitingRoomState } from "../../lib/recruiting.js";
import { uniquePlayerIds } from "../rowUtils.js";
import { getRecruitingReserveLimitNotification } from "./guards.js";
import { currentUserCanOperateMatchPreparation } from "./matchAccess.js";
import { getServerRatingValue } from "./runtime.js";

const ROOM_SCHEDULE_PATCH_KEYS = new Set([
  "timingType",
  "scheduledDate",
  "scheduledTime",
  "courtId",
  "court",
]);

function withoutRoomSchedulePatch(patch = {}) {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => !ROOM_SCHEDULE_PATCH_KEYS.has(key)));
}

function getRoomScheduleTarget(room = {}, patch = {}) {
  const timingType = patch.timingType === "instant"
    ? "instant"
    : patch.timingType === "scheduled" ? "scheduled" : room.timingType === "instant" ? "instant" : "scheduled";
  const scheduledDate = timingType === "instant" ? "" : String(patch.scheduledDate ?? room.scheduledDate ?? "");
  const scheduledTime = timingType === "instant" ? "" : String(patch.scheduledTime ?? room.scheduledTime ?? "").slice(0, 5);
  return {
    timingType,
    scheduledDate,
    scheduledTime,
    scheduledAt: timingType === "instant" ? "즉시" : `${scheduledDate} ${scheduledTime}`.trim(),
    courtId: String(patch.courtId ?? getCourtId(room) ?? ""),
    court: String(patch.court ?? room.court ?? "미정").slice(0, 80),
  };
}

function getRoomChangeDeadlineAt(room = {}, scheduleTarget = null) {
  const currentStart = getMatchScheduledDate(room);
  const targetStart = scheduleTarget
    ? getMatchScheduledDate({ ...room, ...scheduleTarget })
    : null;
  const candidates = [currentStart, targetStart].filter(Boolean);
  if (!candidates.length) return "";
  const earliestStartMs = Math.min(...candidates.map((date) => date.getTime()));
  return new Date(earliestStartMs - 6 * 3_600_000).toISOString();
}

function hasRoomScheduleChange(room = {}, patch = {}) {
  if (![...ROOM_SCHEDULE_PATCH_KEYS].some((key) => patch[key] !== undefined)) return false;
  const current = getRoomScheduleTarget(room);
  const target = getRoomScheduleTarget(room, patch);
  return [...ROOM_SCHEDULE_PATCH_KEYS].some((key) => String(current[key] ?? "") !== String(target[key] ?? ""));
}

function hasNonScheduleRoomChange(room = {}, patch = {}) {
  return Object.entries(withoutRoomSchedulePatch(patch)).some(([key, value]) => {
    const currentValue = room[key] ?? room.rules?.[key] ?? room.roomState?.[key];
    return JSON.stringify(currentValue ?? null) !== JSON.stringify(value ?? null);
  });
}

function getRecruitingChangeRequiredIds(post = {}, state = {}) {
  return uniquePlayerIds([
    getRecruitingRoomOwnerId(post),
    ...getRecruitingRoomParticipantIds(post, state),
    post.refereeId,
  ]);
}

function getMatchChangeRequiredIds(match = {}) {
  return uniquePlayerIds([
    match.createdBy,
    match.refereeId,
    ...getMatchPlayerIds(match),
    ...getMatchReservePlayerIds(match, "teamA"),
    ...getMatchReservePlayerIds(match, "teamB"),
  ]);
}

function getPendingScheduleChangeNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "일정 변경 승인 대기",
    body: "현재 일정 변경안의 승인이 끝난 뒤 다시 수정할 수 있습니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

function getRoomEditLimitNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "방 수정 완료",
    body: "방 수정은 한 번만 가능합니다. 추가 변경이 필요하면 기존 방을 취소한 뒤 다시 만들어 주세요.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

function getRoomEditWindowNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "방 수정 가능 시간 종료",
    body: "방 수정은 경기 시작 12시간 전까지만 가능합니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

function getRoomCancelLockedNotification({ postId = "", matchId = "" } = {}) {
  return {
    id: makeId("n"),
    title: "취소 가능 시간 종료",
    body: "경기 시작 2시간 전부터는 방을 취소할 수 없습니다.",
    tone: "orange",
    ...(postId ? { recruitingPostId: postId } : {}),
    ...(matchId ? { matchId } : {}),
  };
}

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

export function updateMatchRoomRules(state, matchId, patch = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt) return state;
  if (!currentUserCanOperateMatchPreparation(state, match)) return state;
  const editAvailability = getRoomEditAvailability(match);
  if (!editAvailability.allowed) {
    const notification = editAvailability.reason === "limit"
      ? getRoomEditLimitNotification({ matchId })
      : getRoomEditWindowNotification({ matchId });
    return { ...state, notifications: [notification, ...state.notifications] };
  }
  if (isRoomScheduleChangePending(match)) {
    return { ...state, notifications: [getPendingScheduleChangeNotification({ matchId }), ...state.notifications] };
  }
  const requiredIds = getMatchChangeRequiredIds(match);
  const scheduleChanged = hasRoomScheduleChange(match, patch);
  const scheduleNeedsApproval = scheduleChanged && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const matchPatch = scheduleNeedsApproval ? withoutRoomSchedulePatch(patch) : patch;
  const generalRulesChanged = hasNonScheduleRoomChange(match, matchPatch);
  const ruleAcknowledgementNeeded = generalRulesChanged
    && requiredIds.some((playerId) => playerId !== state.currentUserId);
  const scheduleTarget = getRoomScheduleTarget(match, patch);
  const changeDeadlineAt = getRoomChangeDeadlineAt(match, scheduleTarget);
  const sideCapacity = Math.max(1, Math.min(5, Number(matchPatch.sideCapacity ?? getRecruitingSideCapacity(match))));
  const nextMode = `${sideCapacity}v${sideCapacity}`;
  const isSoloRecord = match.rules?.recordType === RECORD_TYPES.personalRecord;
  if (isSoloRecord ? !isSupportedSoloRecordMode(nextMode) : !isSupportedMatchMode(nextMode)) return state;
  const benchCapacity = getRecruitingBenchCapacity({ ...match, benchCapacity: matchPatch.benchCapacity });
  const teamAActiveCount = uniquePlayerIds(match.teamA?.players ?? []).length;
  const teamBActiveCount = uniquePlayerIds(match.teamB?.players ?? []).length;
  if (teamAActiveCount > sideCapacity || teamBActiveCount > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "정원 변경 불가",
          body: "현재 출전 인원이 새 정원보다 많습니다. 먼저 미출석 인원을 후보 명단으로 이동하거나 방에서 내보내 주세요.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (getMatchReservePlayerIds(match, "teamA").length > benchCapacity || getMatchReservePlayerIds(match, "teamB").length > benchCapacity) return state;
  const convertToPlayerMatch = matchPatch.matchJoinMode === "player";
  const updatedAt = new Date().toISOString();
  const nextOperations = getMatchCreationPolicyPayload({
    ...match,
    ...(match.rules ?? {}),
    ...matchPatch,
    mode: nextMode,
  });
  const nextRules = {
    ...(match.rules ?? {}),
    ...getMatchRulesPayload({ ...(match.rules ?? {}), ...matchPatch }, { mode: nextMode }),
    ballProvider: nextOperations.ballProvider,
    vestsProvided: nextOperations.vestsProvided,
    sideCapacity,
    benchCapacity,
    roomEditCount: 1,
    roomEditedAt: updatedAt,
    roomEditedBy: state.currentUserId,
    ruleRevision: generalRulesChanged ? Number(match.rules?.ruleRevision ?? 0) + 1 : Number(match.rules?.ruleRevision ?? 0),
    ruleChangedAt: generalRulesChanged ? updatedAt : match.rules?.ruleChangedAt,
    ...(generalRulesChanged ? {
      ruleAcknowledgementRequiredIds: requiredIds,
      ruleAcknowledgedIds: [state.currentUserId],
      ruleAcknowledgementDeadlineAt: changeDeadlineAt,
    } : {
      ruleAcknowledgementRequiredIds: match.rules?.ruleAcknowledgementRequiredIds ?? [],
      ruleAcknowledgedIds: match.rules?.ruleAcknowledgedIds ?? [],
      ruleAcknowledgementDeadlineAt: match.rules?.ruleAcknowledgementDeadlineAt,
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
  };
  delete nextRules.startedAt;
  const nextCourtName = matchPatch.court === undefined ? match.court : String(matchPatch.court || match.court || "미정").slice(0, 80);
  const nextCourt = getRegisteredCourts(state).find((court) => court.name === nextCourtName || court.id === matchPatch.courtId) ?? null;
  const nextCourtId = matchPatch.court === undefined ? getCourtId(match) : (nextCourt?.id ?? courtIdByName(nextCourtName));
  if (nextCourt?.region) nextRules.region = nextCourt.region;
  const nextMatch = {
    ...match,
    mode: nextMode,
    status: "agreed",
    rules: nextRules,
    sideCapacity,
    benchCapacity,
    courtId: nextCourtId,
    court: nextCourtName,
    timingType: scheduleNeedsApproval ? match.timingType : scheduleTarget.timingType,
    scheduledDate: scheduleNeedsApproval ? match.scheduledDate : scheduleTarget.scheduledDate,
    scheduledTime: scheduleNeedsApproval ? match.scheduledTime : scheduleTarget.scheduledTime,
    scheduledAt: scheduleNeedsApproval ? match.scheduledAt : scheduleTarget.scheduledAt,
    memo: matchPatch.memo === undefined ? match.memo : String(matchPatch.memo ?? "").slice(0, 500),
    stakes: matchPatch.stakes === undefined ? match.stakes : String(matchPatch.stakes ?? "").slice(0, 500),
    teamA: {
      ...(match.teamA ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamA?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamA?.playerTeams ?? {},
    },
    teamB: {
      ...(match.teamB ?? {}),
      teamId: convertToPlayerMatch ? null : match.teamB?.teamId ?? null,
      playerTeams: convertToPlayerMatch ? {} : match.teamB?.playerTeams ?? {},
    },
    parties: convertToPlayerMatch ? [] : match.parties ?? [],
    agreements: match.agreements ?? { teamA: [], teamB: [] },
    attendance: match.attendance ?? { teamA: [], teamB: [] },
    agreedAt: match.agreedAt ?? null,
    startedAt: null,
  };
  const targetNotifications = requiredIds
    .filter((playerId) => playerId !== state.currentUserId)
    .flatMap((targetUserId) => [
      ...(ruleAcknowledgementNeeded ? [{
        id: makeId("n"),
        targetUserId,
        title: "경기 정보 변경 확인",
        body: `${match.title}의 경기 규칙이 변경되었습니다. 방에서 변경 내용을 확인해 주세요.`,
        tone: "match",
        type: "match_rules_changed",
        discordEvent: "match",
        matchId,
        actionRequired: true,
      }] : []),
      ...(scheduleNeedsApproval ? [{
        id: makeId("n"),
        targetUserId,
        title: "일정 변경 승인 요청",
        body: `${match.title}의 일정 또는 구장 변경안이 도착했습니다. 기존 일정은 전원 승인 전까지 유지됩니다.`,
        tone: "match",
        type: "match_schedule_change_requested",
        discordEvent: "match",
        matchId,
        actionRequired: true,
      }] : []),
    ]);
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [...targetNotifications, ...state.notifications],
  };
}

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

export {
  getMatchChangeRequiredIds,
  getPendingScheduleChangeNotification,
  getRecruitingChangeRequiredIds,
  getRoomCancelLockedNotification,
};
