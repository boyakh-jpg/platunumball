import { getMatchRoomPhase, isMatchRecordMatch } from "./matchUtils.js";

export const ROOM_BODY_MODES = Object.freeze({
  pickupPool: "pickup_pool",
  pickupAssignment: "pickup_assignment",
  prearranged: "prearranged",
  live: "live",
  recordSetup: "record_setup",
  recordReview: "record_review",
  terminal: "terminal",
});

export function isPickupRoomFlow(room = {}) {
  return (room.formationMode ?? room.rules?.formationMode) === "pickup"
    || (room.matchIntent ?? room.rules?.matchIntent) === "pickup";
}

export function getPickupRotationPolicy(room = {}) {
  const periodCount = Math.max(1, Number(room.periodCount ?? room.rules?.periodCount ?? 1));
  const requestedMode = room.rotationMode ?? room.rules?.rotationMode;
  const rotationMode = ["period", "interval", "manual"].includes(requestedMode)
    ? requestedMode
    : periodCount > 1 ? "period" : "interval";
  const requestedMinutes = Number(room.rotationIntervalMinutes ?? room.rules?.rotationIntervalMinutes ?? 5);
  const rotationIntervalMinutes = [3, 5, 7, 10].includes(requestedMinutes) ? requestedMinutes : 5;
  return {
    rotationMode,
    rotationIntervalMinutes,
    label: rotationMode === "period"
      ? periodCount === 2 ? "하프 종료 시 균등 교대" : "매 쿼터 균등 교대"
      : rotationMode === "interval" ? `${rotationIntervalMinutes}분 간격 균등 교대` : "직접 교대",
  };
}

export function getPickupParticipants(lobby = {}) {
  const seenPlayerIds = new Set();
  return (lobby.entries ?? []).flatMap((entry) => [
    ...(entry.players ?? []).map((playerId) => ({ playerId, entry, reserve: false })),
    ...(entry.reserves ?? []).map((playerId) => ({ playerId, entry, reserve: true })),
  ]).filter((participant) => {
    if (!participant.playerId || seenPlayerIds.has(participant.playerId)) return false;
    seenPlayerIds.add(participant.playerId);
    return true;
  });
}

export function getPickupParticipantIds(lobby = {}) {
  return getPickupParticipants(lobby).map((participant) => participant.playerId);
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
    const activeIds = entry.reserve ? [] : (entry.players ?? []);
    const reserveIds = entry.reserve ? (entry.players ?? []) : (entry.reserves ?? []);
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
