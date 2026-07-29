// Shared rating-scale policy. Server authority composes these pure values with persistence.
const RECRUITING_RANGE_SCALES = Object.freeze({
  narrow: 1.1,
  normal: 1,
  wide: 0.8,
});
const PICKUP_ASSIGNMENT_SCALES = Object.freeze({
  manual: 0.9,
  random: 1,
  balanced: 1.1,
});
const POSTGAME_RECORD_SCALES = Object.freeze({
  "1v1": 0.1,
  "2v2": 0.2,
  "3v3": 0.35,
  "5v5": 0.5,
});
const TOURNAMENT_COMMUNITY_SCALE = 0.8;

export function getAdminRestoreRatingFactor(actionType) {
  return actionType === "restoreMatchHalf" ? 0.5 : 1;
}

export function getPickupTeamAssignmentRatingScale(mode) {
  return PICKUP_ASSIGNMENT_SCALES[mode] ?? PICKUP_ASSIGNMENT_SCALES.balanced;
}

export function getPostgameRecordMmrScale(match = {}) {
  return POSTGAME_RECORD_SCALES[match.mode] ?? 0;
}

export function getRecruitingRatingScale({ ranked = true, mmrRangeMode = "normal" } = {}) {
  if (ranked === false) return 0;
  return RECRUITING_RANGE_SCALES[mmrRangeMode] ?? RECRUITING_RANGE_SCALES.normal;
}

export function getTournamentRatingScale(official) {
  return official ? 1 : TOURNAMENT_COMMUNITY_SCALE;
}
