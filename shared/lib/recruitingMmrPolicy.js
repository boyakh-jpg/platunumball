import { DEFAULT_RATING, DISPUTE_WINDOW_MINUTES, MATCH_SIDES, MODE_SIZES, PLAYER_POSITIONS, REFEREE_TRUST_MIN, ROOM_KINDS, STAT_ENTRY_WINDOW_MINUTES, isMercenaryTeamRole, normalizeBenchCapacity } from "./constants.js";
import { normalizeCourtOptionalBoolean } from "./courtPolicy.js";
import { isEligibleReferee, isInstantRoom } from "./matchUtils.js";
import { getAgeGroupForUser } from "./profileSetup.js";
import { TIERS, getTierDivision } from "./tier.js";

export const MMR_RANGE_POLICIES = {
  narrow: { label: "좁게", detail: "비슷한 실력만", gap: 120 },
  normal: { label: "보통", detail: "적당한 범위", gap: 220 },
  wide: { label: "넓게", detail: "대기 풀 우선", gap: 360 },
};
export function normalizeRecruitingMmrRangeMode(mode = "narrow") {
  if (mode === "standard") return "normal";
  return MMR_RANGE_POLICIES[mode] ? mode : "narrow";
}
export function getRecruitingTargetMmr(post = {}, state = {}) {
  if (post.teamId) {
    return state.teams?.find((team) => team.id === post.teamId)?.mmr ?? DEFAULT_RATING;
  }
  if (post.playerId) {
    return state.users?.find((user) => user.id === post.playerId)?.ratings?.integrated ?? DEFAULT_RATING;
  }
  return DEFAULT_RATING;
}
export function getRecruitingTierRange(targetMmr = DEFAULT_RATING, ranked = true, rangeMode = "narrow") {
  if (!ranked) {
    return {
      label: "티어 자유",
      detail: "친선은 티어 제한 없이 신뢰도만 반영합니다.",
      min: 0,
      max: 9999,
    };
  }

  const mode = normalizeRecruitingMmrRangeMode(rangeMode);
  const policy = MMR_RANGE_POLICIES[mode];
  const min = Math.max(0, Math.round(Number(targetMmr) - policy.gap));
  const max = Math.round(Number(targetMmr) + policy.gap);


  return {
    label: `${policy.label} · ${min}~${max} MMR`,
    detail: `${getTierDivision(min)} ~ ${getTierDivision(max)} · 상세 산식 비공개`,
    mode,
    min,
    max,
  };
}
export function isMmrInRecruitingRange(candidateMmr = DEFAULT_RATING, targetMmr = DEFAULT_RATING, ranked = true, rangeMode = "narrow") {
  const range = getRecruitingTierRange(targetMmr, ranked, rangeMode);
  return !ranked || (candidateMmr >= range.min && candidateMmr <= range.max);
}
export function getRecruitingFit(post = {}, candidateMmr = DEFAULT_RATING, state = {}) {
  const targetMmr = getRecruitingTargetMmr(post, state);
  const range = getRecruitingTierRange(targetMmr, post.ranked !== false, post.mmrRangeMode ?? post.roomState?.mmrRangeMode);

  if (post.ranked === false) {
    return { allowed: true, tone: "neutral", label: "친선 자유", range };
  }
  if (candidateMmr < range.min) {
    return { allowed: false, tone: "orange", label: "티어 낮음", range };
  }
  if (candidateMmr > range.max) {
    return { allowed: false, tone: "orange", label: "티어 높음", range };
  }
  return { allowed: true, tone: "green", label: "허용 구간", range };
}
