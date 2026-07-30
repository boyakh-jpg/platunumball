import {
  getRecruitingBenchCapacity,
  getRecruitingEntryParticipantIds,
  getRecruitingSideCapacity,
  isPickupRecruitingRoom,
  unique,
} from "./recruitingPolicy.js";

function getNonNegativeListCount(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

export function getRecruitingListCardCounts(post = {}, lobby = {}, options = {}) {
  const projected = options.projected === true;
  const countKey = projected ? "projectedFilled" : "filled";
  const teamA = {
    filled: getNonNegativeListCount(lobby.sides?.teamA?.[countKey]),
    capacity: getNonNegativeListCount(lobby.sides?.teamA?.capacity, getRecruitingSideCapacity(post)),
  };
  const teamB = {
    filled: getNonNegativeListCount(lobby.sides?.teamB?.[countKey]),
    capacity: getNonNegativeListCount(lobby.sides?.teamB?.capacity, getRecruitingSideCapacity(post)),
  };
  const listCounts = post.listCounts && typeof post.listCounts === "object" ? post.listCounts : {};
  const pickup = isPickupRecruitingRoom(post) || listCounts.pickup === true || listCounts.pk === true;
  const sideFilled = teamA.filled + teamB.filled;
  const sideCapacity = teamA.capacity + teamB.capacity;

  if (!pickup) {
    return {
      layout: "sides",
      filled: sideFilled,
      capacity: sideCapacity,
      teamA,
      teamB,
    };
  }

  const lobbyParticipantCount = unique(
    (lobby.entries ?? []).flatMap((entry) => getRecruitingEntryParticipantIds(entry)),
  ).length;
  const fallbackParticipantCapacity = (
    getRecruitingSideCapacity(post) + getRecruitingBenchCapacity(post)
  ) * 2;
  const savedParticipantCapacity = getNonNegativeListCount(
    listCounts.participantCapacity ?? listCounts.pickupCapacity,
  );
  const participantCapacity = Math.max(
    1,
    savedParticipantCapacity || fallbackParticipantCapacity,
  );
  const participantFilled = Math.min(
    participantCapacity,
    getNonNegativeListCount(
      listCounts.participantFilled ?? listCounts.participantCount,
      lobbyParticipantCount || sideFilled,
    ),
  );

  return {
    layout: "unified",
    filled: participantFilled,
    capacity: participantCapacity,
    teamA,
    teamB,
  };
}
