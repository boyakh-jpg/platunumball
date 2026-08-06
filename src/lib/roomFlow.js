import {
  getMatchRoomPhase,
  getMatchScheduledDate,
  isMatchRecordMatch,
  isTournamentMatchLineupEditable,
} from "./matchUtils.js";

import {
  ROOM_BODY_MODES,
  isPickupRoomFlow,
  getPickupRotationPolicy,
  getPickupParticipantIds,
  getPickupParticipantCapacity,
} from "./roomFlowPickup.js";
import { getRecruitingEntryPlacementIds } from "./recruiting.js";
export { ROOM_BODY_MODES, isPickupRoomFlow, getPickupRotationPolicy, getPickupTeamAssignmentPolicy, getPickupRerollState, buildPickupTeamAssignment, getPickupParticipants, getPickupParticipantIds, getPickupParticipantCapacity } from "./roomFlowPickup.js";

export function getRoomScheduleProposal(room = {}) {
  const proposal = room.roomState?.scheduleProposal ?? room.rules?.scheduleProposal;
  return proposal && typeof proposal === "object" ? proposal : null;
}

export const ROOM_EDIT_LIMIT = 1;
export const ROOM_EDIT_MIN_LEAD_HOURS = 12;
export const ROOM_CANCEL_LOCK_HOURS = 2;

export function getRoomEditCount(room = {}) {
  const count = Number(
    room.roomState?.roomEditCount
    ?? room.rules?.roomEditCount
    ?? room.roomEditCount
    ?? 0,
  );
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

export function isRoomEditAvailable(room = {}) {
  return getRoomEditCount(room) < ROOM_EDIT_LIMIT;
}

function toValidDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getRoomEditAvailability(room = {}, now = new Date()) {
  if (!isRoomEditAvailable(room)) {
    return { allowed: false, reason: "limit", code: "room_edit_limit_reached", hoursUntilStart: null };
  }
  const scheduledAt = getMatchScheduledDate(room);
  const nowAt = toValidDate(now);
  if (!scheduledAt || !nowAt) {
    return { allowed: false, reason: "schedule", code: "room_edit_window_closed", hoursUntilStart: null };
  }
  const hoursUntilStart = (scheduledAt.getTime() - nowAt.getTime()) / 3_600_000;
  if (hoursUntilStart < ROOM_EDIT_MIN_LEAD_HOURS) {
    return { allowed: false, reason: "time", code: "room_edit_window_closed", hoursUntilStart };
  }
  return { allowed: true, reason: "", code: "", hoursUntilStart };
}

export function getRoomChangeCancellationWaiver(room = {}, now = new Date()) {
  const proposal = getRoomScheduleProposal(room);
  if (["rejected", "expired"].includes(proposal?.status)) {
    return { waived: true, reason: proposal.status };
  }
  const nowAt = toValidDate(now);
  const proposalDeadline = toValidDate(proposal?.consentDeadlineAt);
  if (proposal?.status === "pending" && nowAt && proposalDeadline && nowAt >= proposalDeadline) {
    return { waived: true, reason: "schedule_consent_expired" };
  }
  const acknowledgement = getRecruitingRuleAcknowledgement(room);
  const acknowledgementDeadline = toValidDate(
    room.roomState?.ruleAcknowledgementDeadlineAt
    ?? room.rules?.ruleAcknowledgementDeadlineAt,
  );
  if (acknowledgement.remainingIds.length && nowAt && acknowledgementDeadline && nowAt >= acknowledgementDeadline) {
    return { waived: true, reason: "rule_acknowledgement_expired" };
  }
  return { waived: false, reason: "" };
}

export function getRoomCancellationPolicy(room = {}, now = new Date()) {
  const scheduledAt = getMatchScheduledDate(room);
  const nowAt = toValidDate(now);
  if (room.rules?.rosterNeedsFill === true) {
    const hoursUntilStart = scheduledAt && nowAt
      ? (scheduledAt.getTime() - nowAt.getTime()) / 3_600_000
      : null;
    return {
      allowed: true,
      penalty: 0,
      waived: true,
      waiverReason: "participant_shortage",
      hoursUntilStart,
      code: "",
    };
  }
  const waiver = getRoomChangeCancellationWaiver(room, nowAt ?? now);
  if (!scheduledAt || !nowAt) {
    return { allowed: true, penalty: 0, waived: waiver.waived, waiverReason: waiver.reason, hoursUntilStart: null };
  }
  const hoursUntilStart = (scheduledAt.getTime() - nowAt.getTime()) / 3_600_000;
  if (hoursUntilStart <= ROOM_CANCEL_LOCK_HOURS) {
    return {
      allowed: false,
      penalty: 0,
      waived: waiver.waived,
      waiverReason: waiver.reason,
      hoursUntilStart,
      code: "room_cancel_locked",
    };
  }
  const penalty = waiver.waived ? 0 : hoursUntilStart <= 6 ? 5 : hoursUntilStart <= 12 ? 3 : 0;
  return {
    allowed: true,
    penalty,
    waived: waiver.waived,
    waiverReason: waiver.reason,
    hoursUntilStart,
    code: "",
  };
}

export function getRoomCancellationActionLabel(actionLabel = "경기 취소", policy = {}) {
  const penalty = Math.max(0, Number(policy.penalty ?? 0));
  return penalty > 0 ? `${actionLabel} · 신뢰도 -${penalty}` : actionLabel;
}

export function getRoomCancellationConfirmMessage(actionLabel = "경기 취소", policy = {}) {
  const penalty = Math.max(0, Number(policy.penalty ?? 0));
  const consequence = penalty > 0
    ? `지금 취소하면 신뢰도 ${penalty}점이 차감됩니다.`
    : policy.waiverReason === "participant_shortage"
      ? "참가 취소로 출전 인원이 부족해 방장 신뢰도는 차감되지 않습니다."
      : policy.waived
        ? "일정 변경 동의가 성립되지 않은 면책 취소라 신뢰도는 차감되지 않습니다."
      : "현재 취소 신뢰도 패널티는 없습니다.";
  return `${actionLabel}할까요?\n\n${consequence}\n취소한 방은 복구되지 않습니다. 수정이 필요하면 취소 후 '같은 설정으로 다시 만들기'로 새 방을 만들어 주세요.`;
}

export function isRoomScheduleChangePending(room = {}, now = new Date()) {
  const proposal = getRoomScheduleProposal(room);
  if (proposal?.status !== "pending") return false;
  const deadline = toValidDate(proposal.consentDeadlineAt);
  const nowAt = toValidDate(now);
  return !(deadline && nowAt && nowAt >= deadline);
}

export function getRoomScheduleProposalProgress(room = {}, now = new Date()) {
  const proposal = getRoomScheduleProposal(room);
  const requiredIds = [...new Set((proposal?.requiredIds ?? []).filter(Boolean))];
  const approvedIds = [...new Set((proposal?.approvedIds ?? []).filter((playerId) => requiredIds.includes(playerId)))];
  const deadline = toValidDate(proposal?.consentDeadlineAt);
  const nowAt = toValidDate(now);
  const expired = Boolean(proposal?.status === "pending" && deadline && nowAt && nowAt >= deadline);
  return {
    proposal,
    requiredIds,
    approvedIds,
    remainingIds: requiredIds.filter((playerId) => !approvedIds.includes(playerId)),
    complete: Boolean(proposal && requiredIds.length && requiredIds.every((playerId) => approvedIds.includes(playerId))),
    expired,
    deadline,
  };
}

export function getRecruitingRuleAcknowledgement(room = {}) {
  const source = room.roomState ?? room.rules ?? {};
  const revision = Number(source.ruleRevision ?? 0);
  const requiredIds = [...new Set((source.ruleAcknowledgementRequiredIds ?? []).filter(Boolean))];
  const acknowledgedIds = [...new Set(
    (source.ruleAcknowledgedIds ?? []).filter((playerId) => requiredIds.includes(playerId)),
  )];
  return {
    revision,
    requiredIds,
    acknowledgedIds,
    remainingIds: requiredIds.filter((playerId) => !acknowledgedIds.includes(playerId)),
    complete: requiredIds.every((playerId) => acknowledgedIds.includes(playerId)),
  };
}

export function getPickupResizeValidation(lobby = {}, capacity = {}) {
  const participantCount = getPickupParticipantIds(lobby).length;
  const participantCapacity = getPickupParticipantCapacity(capacity);
  return {
    participantCount,
    participantCapacity,
    valid: participantCount <= participantCapacity,
  };
}

export function getPickupCompatibilityPlacements(
  participantCount = 0,
  { sideCapacity = 0, benchCapacity = 0, hostSide = "teamA" } = {},
) {
  const safeParticipantCount = Math.max(0, Number(participantCount) || 0);
  if (!safeParticipantCount) return [];

  const safeHostSide = hostSide === "teamB" ? "teamB" : "teamA";
  const oppositeHostSide = safeHostSide === "teamA" ? "teamB" : "teamA";
  const activePerSide = Math.max(1, Number(sideCapacity) || 1);
  const totalCapacity = getPickupParticipantCapacity({ sideCapacity: activePerSide, benchCapacity });
  const activeApplicationCapacity = activePerSide * 2 - 1;

  return Array.from({ length: Math.min(safeParticipantCount, totalCapacity) }, (_, index) => {
    if (index === 0) return { side: safeHostSide, reserve: false };
    if (index <= activeApplicationCapacity) {
      return {
        side: index % 2 === 1 ? oppositeHostSide : safeHostSide,
        reserve: false,
      };
    }
    const waitingIndex = index - activeApplicationCapacity;
    return {
      side: waitingIndex % 2 === 1 ? "teamA" : "teamB",
      reserve: true,
    };
  });
}

export function getPickupOpenSlotPlacements(lobby = {}, { sideCapacity = 0, benchCapacity = 0 } = {}) {
  const sides = ["teamA", "teamB"];
  const counts = {
    teamA: { active: 0, reserve: 0 },
    teamB: { active: 0, reserve: 0 },
  };
  const seenPlayerIds = new Set();

  (lobby.entries ?? []).forEach((entry) => {
    const side = entry.side === "teamB" ? "teamB" : "teamA";
    const { activeIds, reserveIds } = getRecruitingEntryPlacementIds(entry);
    activeIds.forEach((playerId) => {
      if (!playerId || seenPlayerIds.has(playerId)) return;
      seenPlayerIds.add(playerId);
      counts[side].active += 1;
    });
    reserveIds.forEach((playerId) => {
      if (!playerId || seenPlayerIds.has(playerId)) return;
      seenPlayerIds.add(playerId);
      counts[side].reserve += 1;
    });
  });

  const placements = [];
  const fill = (role, capacity) => {
    while (sides.some((side) => counts[side][role] < capacity)) {
      const side = [...sides]
        .filter((candidate) => counts[candidate][role] < capacity)
        .sort((left, right) => (
          counts[left][role] - counts[right][role]
          || (counts[left].active + counts[left].reserve) - (counts[right].active + counts[right].reserve)
          || sides.indexOf(left) - sides.indexOf(right)
        ))[0];
      placements.push({ side, reserve: role === "reserve" });
      counts[side][role] += 1;
    }
  };

  fill("active", Math.max(0, Number(sideCapacity) || 0));
  fill("reserve", Math.max(0, Number(benchCapacity) || 0));
  return placements;
}

export function isMatchPregameSlotManagementOpen(match = null) {
  if (!match) return true;
  const phase = getMatchRoomPhase(match).phase;
  return Boolean(
    !match.startedAt
    && !match.endedAt
    && !match.result
    && ["waiting", "locked", "checkin"].includes(phase)
  );
}

export function isMatchRecordParticipantSetupOpen(match = null) {
  return Boolean(
    isMatchRecordMatch(match)
    && match?.rules?.recordSetupReady !== true
    && !match?.result
    && !match?.confirmedAt
    && !match?.cancelledAt
    && !match?.voidedAt
  );
}

export function isMatchRecordParticipantSetupRequired(match = null) {
  if (!isMatchRecordParticipantSetupOpen(match)) return false;
  if (match?.rules?.recordComposition !== "team") return true;
  return Boolean(!match?.teamA?.teamId || !match?.teamB?.teamId);
}

export function getRoomPhaseViewModel({ post = {}, match = null } = {}) {
  const source = match ?? post;
  const phase = match ? getMatchRoomPhase(match).phase : "waiting";
  if (match && isMatchRecordMatch(match)) {
    const setupReady = match.rules?.recordSetupReady === true;
    return {
      mode: setupReady ? ROOM_BODY_MODES.recordReview : ROOM_BODY_MODES.recordSetup,
      phase,
      sectionOrder: setupReady
        ? ["recordBoard", "recordSetup", "versus"]
        : ["recordSetup", "recordBoard"],
      showVersusStage: setupReady,
      showParticipantPool: false,
      showSideReserves: false,
      showRules: false,
      primaryAction: setupReady ? "기록 확인" : "참가자 구성",
    };
  }

  if (match && isTournamentMatchLineupEditable(match)) {
    return {
      mode: ROOM_BODY_MODES.prearranged,
      phase,
      sectionOrder: ["recordSetup", "versus", "recordBoard"],
      showVersusStage: true,
      showParticipantPool: false,
      showSideReserves: true,
      showRules: true,
      primaryAction: "출전 명단 구성",
    };
  }

  if (isPickupRoomFlow(source)) {
    const assignmentConfirmed = source.rules?.sideAssignmentStatus === "confirmed";
    const assignmentPhase = phase === "checkin" && !assignmentConfirmed;
    return {
      mode: assignmentPhase ? ROOM_BODY_MODES.pickupAssignment : phase === "waiting" || phase === "locked"
        ? ROOM_BODY_MODES.pickupPool
        : phase === "live" ? ROOM_BODY_MODES.live : ROOM_BODY_MODES.prearranged,
      phase,
      sectionOrder: assignmentPhase
        ? ["participantPool", "versus", "rotation"]
        : phase === "waiting" || phase === "locked"
          ? ["participantPool"]
          : ["recordBoard", "versus", "rotation"],
      showVersusStage: assignmentPhase || assignmentConfirmed || phase === "live" || ["postgame", "dispute", "record"].includes(phase),
      showParticipantPool: phase === "waiting" || phase === "locked" || assignmentPhase,
      showSideReserves: assignmentConfirmed || phase === "live" || ["postgame", "dispute", "record"].includes(phase),
      showRules: true,
      assignmentConfirmed,
      rotation: getPickupRotationPolicy(source),
      primaryAction: assignmentPhase ? "배정 확정" : phase === "checkin" ? "경기 시작" : "참가자 모집",
    };
  }

  return {
    mode: phase === "live" ? ROOM_BODY_MODES.live : ROOM_BODY_MODES.prearranged,
    phase,
    sectionOrder: ["recordBoard", "versus"],
    showVersusStage: true,
    showParticipantPool: false,
    showSideReserves: true,
    showRules: true,
    primaryAction: phase === "checkin" ? "경기 시작" : null,
  };
}

export { getPostgameRecordVerification } from "./postgameRecordVerification.js";
