import {
  getPickupTeamAssignmentMode,
  getPickupTeamAssignmentModeOption,
} from "./matchCreationPolicies.js";

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

export function getPickupTeamAssignmentPolicy(room = {}) {
  const rules = room?.rules && typeof room.rules === "object" ? room.rules : {};
  const decided = Number(rules.sideAssignmentRevision ?? room.sideAssignmentRevision ?? 0) > 0
    || ["draft", "confirmed"].includes(rules.sideAssignmentStatus ?? room.sideAssignmentStatus);
  if (!decided) {
    return {
      mode: "",
      label: "현장 합의 후 결정",
      description: "출석자끼리 현장 직접, 완전 랜덤, MMR 균형 중 하나를 정합니다.",
      automatic: false,
      decided: false,
    };
  }
  const mode = getPickupTeamAssignmentMode(room);
  const option = getPickupTeamAssignmentModeOption(mode);
  return {
    mode,
    label: option.label,
    description: option.description,
    automatic: mode !== "manual",
    decided: true,
  };
}

export function getPickupRerollState(room = {}, userId = "") {
  const rules = room?.rules && typeof room.rules === "object" ? room.rules : {};
  const usedByIds = [...new Set(Array.isArray(rules.pickupRerollUserIds) ? rules.pickupRerollUserIds.filter(Boolean) : [])];
  const count = Math.max(0, Number(rules.pickupRerollCount ?? usedByIds.length) || 0);
  return {
    count,
    limit: 2,
    usedByIds,
    usedByCurrentUser: Boolean(userId && usedByIds.includes(userId)),
    remaining: Math.max(0, 2 - count),
  };
}

function stableAssignmentScore(seed = "", playerId = "") {
  const source = `${seed}:${playerId}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getPickupPlayerMmr(users = [], playerId = "") {
  const user = users.find((item) => item?.id === playerId);
  const mmr = Number(user?.ratings?.integrated ?? user?.mmr);
  return Number.isFinite(mmr) ? mmr : 1200;
}

export function buildPickupTeamAssignment({
  playerIds = [],
  users = [],
  sideCapacity = 0,
  benchCapacity = 0,
  mode = "manual",
  seed = "",
  hostPlayerId = "",
} = {}) {
  const uniqueIds = [...new Set(playerIds.filter(Boolean))];
  const activeCapacity = Math.max(1, Number(sideCapacity) || 1);
  const reserveCapacity = Math.max(0, Number(benchCapacity) || 0);
  const perSideCapacity = activeCapacity + reserveCapacity;
  const assignmentMode = getPickupTeamAssignmentMode({ pickupTeamAssignmentMode: mode });
  if (uniqueIds.length > perSideCapacity * 2) return null;

  const orderedIds = assignmentMode === "random"
    ? [...uniqueIds].sort((left, right) => (
      stableAssignmentScore(seed, left) - stableAssignmentScore(seed, right)
      || left.localeCompare(right)
    ))
    : assignmentMode === "mmr_balanced"
      ? [...uniqueIds].sort((left, right) => (
        getPickupPlayerMmr(users, right) - getPickupPlayerMmr(users, left)
        || left.localeCompare(right)
      ))
      : [...uniqueIds];

  const sides = {
    teamA: { ids: [], mmr: 0 },
    teamB: { ids: [], mmr: 0 },
  };
  orderedIds.forEach((playerId, index) => {
    const availableSides = ["teamA", "teamB"].filter((sideName) => sides[sideName].ids.length < perSideCapacity);
    const targetSide = assignmentMode === "mmr_balanced"
      ? [...availableSides].sort((left, right) => (
        sides[left].mmr - sides[right].mmr
        || sides[left].ids.length - sides[right].ids.length
        || (index % 2 === 0 ? ["teamA", "teamB"] : ["teamB", "teamA"]).indexOf(left)
          - (index % 2 === 0 ? ["teamA", "teamB"] : ["teamB", "teamA"]).indexOf(right)
      ))[0]
      : availableSides[index % availableSides.length] ?? availableSides[0];
    if (!targetSide) return;
    sides[targetSide].ids.push(playerId);
    sides[targetSide].mmr += getPickupPlayerMmr(users, playerId);
  });

  if (hostPlayerId && sides.teamB.ids.includes(hostPlayerId)) {
    [sides.teamA, sides.teamB] = [sides.teamB, sides.teamA];
  }

  const splitSide = (sideName) => ({
    active: sides[sideName].ids.slice(0, activeCapacity),
    reserve: sides[sideName].ids.slice(activeCapacity, perSideCapacity),
    mmr: sides[sideName].mmr,
  });
  return {
    mode: assignmentMode,
    teamA: splitSide("teamA"),
    teamB: splitSide("teamB"),
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

export function getPickupParticipantCapacity({ sideCapacity = 0, benchCapacity = 0 } = {}) {
  const activePerSide = Math.max(0, Number(sideCapacity) || 0);
  const waitingPerSide = Math.max(0, Number(benchCapacity) || 0);
  return (activePerSide + waitingPerSide) * 2;
}
