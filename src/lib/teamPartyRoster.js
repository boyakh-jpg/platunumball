import { MAX_RECRUITING_RESERVES_PER_SIDE } from "./constants.js";
import { getSelectableTeamPlayerIds } from "./recruiting.js";
import { uniquePlayerIds } from "../../shared/lib/playerIds.js";

export function selectPartyPlayerIds({
  eligiblePlayerIds = [],
  playerIds,
  excludedIds = [],
  requiredPlayerId = "",
  capacity = Infinity,
} = {}) {
  const excludedSet = new Set(excludedIds);
  const availablePlayerIds = uniquePlayerIds(eligiblePlayerIds)
    .filter((playerId) => !excludedSet.has(playerId));
  const availableSet = new Set(availablePlayerIds);
  const selectedPlayerIds = uniquePlayerIds(Array.isArray(playerIds) ? playerIds : availablePlayerIds)
    .filter((playerId) => availableSet.has(playerId));

  if (!requiredPlayerId || !availableSet.has(requiredPlayerId)) {
    return selectedPlayerIds.slice(0, capacity);
  }
  return [
    requiredPlayerId,
    ...selectedPlayerIds.filter((playerId) => playerId !== requiredPlayerId),
  ].slice(0, capacity);
}

export function selectPartyReserveIds({
  eligiblePlayerIds = [],
  reserveIds,
  activeIds = [],
  excludedIds = [],
  capacity = Infinity,
} = {}) {
  if (!Array.isArray(reserveIds)) return [];
  const eligibleSet = new Set(eligiblePlayerIds);
  const unavailableSet = new Set([...activeIds, ...excludedIds]);
  return uniquePlayerIds(reserveIds)
    .filter((playerId) => eligibleSet.has(playerId) && !unavailableSet.has(playerId))
    .slice(0, capacity);
}

function getAllTeamPlayerIds(team = {}) {
  return (team.members ?? []).map((member) => member.userId);
}

export function getCreateDefaultTeamPlayerIds(
  team,
  capacity,
  excludedIds = [],
  preferredPlayerId = "",
) {
  if (!team) return [];
  return selectPartyPlayerIds({
    eligiblePlayerIds: getSelectableTeamPlayerIds(team),
    excludedIds,
    requiredPlayerId: preferredPlayerId,
    capacity,
  });
}

export function getCreatePartyPlayerIds(team, playerIds, capacity, excludedIds = []) {
  if (!team) return [];
  return selectPartyPlayerIds({
    eligiblePlayerIds: getSelectableTeamPlayerIds(team),
    playerIds,
    excludedIds,
    capacity,
  });
}

export function getCreatePartyReserveIds(
  team,
  reserveIds,
  activeIds = [],
  capacity = MAX_RECRUITING_RESERVES_PER_SIDE,
  excludedIds = [],
) {
  if (!team) return [];
  return selectPartyReserveIds({
    eligiblePlayerIds: getAllTeamPlayerIds(team),
    reserveIds,
    activeIds,
    excludedIds,
    capacity,
  });
}

export function getRecruitingDefaultTeamPlayerIds(
  team,
  capacity,
  requiredPlayerId = "",
) {
  if (!team) return [];
  return selectPartyPlayerIds({
    eligiblePlayerIds: getSelectableTeamPlayerIds(team),
    requiredPlayerId,
    capacity,
  });
}

export function getRecruitingTeamRepresentativePlayerIds(team, userId = "") {
  if (!team) return [];
  return selectPartyPlayerIds({
    eligiblePlayerIds: getSelectableTeamPlayerIds(team),
    playerIds: userId ? [userId] : [],
    requiredPlayerId: userId,
    capacity: 1,
  });
}

export function getRecruitingPartyPlayerIds(
  team,
  playerIds,
  capacity,
  requiredPlayerId = "",
) {
  if (!team) return [];
  return selectPartyPlayerIds({
    eligiblePlayerIds: getSelectableTeamPlayerIds(team),
    playerIds,
    requiredPlayerId,
    capacity,
  });
}

export function getRecruitingPartyReserveIds(
  team,
  reserveIds,
  activeIds = [],
  capacity = MAX_RECRUITING_RESERVES_PER_SIDE,
) {
  if (!team) return [];
  return selectPartyReserveIds({
    eligiblePlayerIds: getSelectableTeamPlayerIds(team),
    reserveIds,
    activeIds,
    capacity,
  });
}

export function getRecruitingDefaultTeamReserveIds(
  team,
  activeIds = [],
  capacity = MAX_RECRUITING_RESERVES_PER_SIDE,
) {
  if (!team) return [];
  const selectablePlayerIds = getSelectableTeamPlayerIds(team);
  return selectPartyReserveIds({
    eligiblePlayerIds: selectablePlayerIds,
    reserveIds: selectablePlayerIds,
    activeIds,
    capacity,
  });
}
