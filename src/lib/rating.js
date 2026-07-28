const PLACEMENT_MATCH_TARGET = 5;

export { getTier, getTierDisplay, getTierDivision, getTierLabel } from "./tier.js";

export function normalizePlacement(placement = null) {
  const target = Math.max(1, Number(placement?.target) || PLACEMENT_MATCH_TARGET);
  const matchCount = Math.max(0, Math.min(target, Math.floor(Number(placement?.matchCount) || 0)));
  return {
    matchCount,
    target,
    completed: placement?.completed === true || matchCount >= target,
    completedAt: placement?.completedAt ?? null,
    modeCounts: placement?.modeCounts && typeof placement.modeCounts === "object" ? { ...placement.modeCounts } : {},
  };
}

export function isPlacementComplete(ratings = {}) {
  if (!ratings?.placement) return true;
  return normalizePlacement(ratings.placement).completed;
}

export function getPlacementLabel(ratings = {}) {
  const placement = normalizePlacement(ratings?.placement);
  return placement.completed ? "" : `배정 전 · ${placement.matchCount}/${placement.target}`;
}

export function hasModeRating(ratings = {}, mode = "") {
  if (!ratings?.placement) return Number.isFinite(Number(ratings?.modes?.[mode]));
  const placement = normalizePlacement(ratings?.placement);
  if (!placement.completed) return false;
  return Number(placement.modeCounts?.[mode] ?? 0) > 0;
}

export function getCredibilityLevel(match = {}) {
  if (match.ranked === false) return "self_record";
  const hasEvidence = Boolean(match.evidence?.length);
  if (match.official && hasEvidence) return "official_with_evidence";
  if (match.official) return "official";
  if (hasEvidence) return "evidence_verified";
  if (match.preRegistered) return "pre_registered";
  return "street_majority";
}
