import { DEFAULT_RATING } from "./constants.js";
import { getTierDivision } from "./tier.js";

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

const getPlayerMmr = (userById = {}, playerId = "") => {
  const value = Number(userById[playerId]?.ratings?.integrated);
  return Number.isFinite(value) ? value : DEFAULT_RATING;
};

const uniquePlayerIds = (playerIds = []) => [...new Set(playerIds.filter(Boolean))];

function summarizeSideMmr(playerIds = [], userById = {}) {
  const values = uniquePlayerIds(playerIds).map((playerId) => getPlayerMmr(userById, playerId));
  const averageRaw = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    count: values.length,
    average: Math.round(averageRaw),
    averageRaw,
    spread: values.length > 1 ? Math.max(...values) - Math.min(...values) : 0,
  };
}

export function isMmrBalancedRecruitingRoom(post = {}) {
  const rules = post.rules ?? {};
  const roomState = post.roomState ?? {};
  return post.visibility === "public"
    && post.ranked !== false
    && (post.hostJoinMode ?? rules.hostJoinMode) === "player"
    && post.teamOnly !== true
    && roomState.teamOnly !== true
    && (post.formationMode ?? rules.formationMode) !== "pickup"
    && (post.matchIntent ?? rules.matchIntent) !== "pickup";
}

export function getSideMmrBalance(sidePlayerIds = {}, userById = {}, rangeMode = "narrow") {
  const limit = MMR_RANGE_POLICIES[normalizeRecruitingMmrRangeMode(rangeMode)].gap;
  const teamA = summarizeSideMmr(sidePlayerIds.teamA, userById);
  const teamB = summarizeSideMmr(sidePlayerIds.teamB, userById);
  const averageGapRaw = teamA.count && teamB.count ? Math.abs(teamA.averageRaw - teamB.averageRaw) : 0;
  const violation = Math.max(0, averageGapRaw - limit)
    + Math.max(0, teamA.spread - limit)
    + Math.max(0, teamB.spread - limit);
  return {
    sides: { teamA, teamB },
    averageGap: Math.round(averageGapRaw),
    averageGapRaw,
    limit,
    violation,
    allowed: violation === 0,
  };
}

export function getRecruitingMmrBalance(post = {}, lobby = {}, userById = {}, playerKey = "projectedPlayers") {
  return getSideMmrBalance({
    teamA: lobby.sides?.teamA?.[playerKey] ?? [],
    teamB: lobby.sides?.teamB?.[playerKey] ?? [],
  }, userById, post.mmrRangeMode ?? post.roomState?.mmrRangeMode ?? post.rules?.mmrRangeMode);
}

export function isMmrBalanceTransitionAllowed(before = {}, after = {}) {
  return after.allowed === true || Number(after.violation) <= Number(before.violation);
}

export function canMoveRecruitingPlayerWithinMmrBalance(post = {}, lobby = {}, userById = {}, playerId = "", targetSide = "", reserve = false) {
  if (!isMmrBalancedRecruitingRoom(post)) return true;
  const target = lobby.sides?.[targetSide];
  if (!target || (!reserve && !target.players?.includes(playerId) && target.filled >= target.capacity)) return false;
  const current = getRecruitingMmrBalance(post, lobby, userById, "players");
  const sidePlayerIds = Object.fromEntries(["teamA", "teamB"].map((sideName) => [
    sideName,
    uniquePlayerIds((lobby.sides?.[sideName]?.players ?? []).filter((id) => id !== playerId)),
  ]));
  if (!reserve) sidePlayerIds[targetSide].push(playerId);
  return isMmrBalanceTransitionAllowed(current, getSideMmrBalance(
    sidePlayerIds,
    userById,
    post.mmrRangeMode ?? post.roomState?.mmrRangeMode ?? post.rules?.mmrRangeMode,
  ));
}

export function getRecruitingMmrBalancedPlacement(post = {}, lobby = {}, userById = {}, playerIds = [], requestedReserve = false) {
  if (!isMmrBalancedRecruitingRoom(post)) return null;
  const candidateIds = uniquePlayerIds(playerIds);
  const current = getRecruitingMmrBalance(post, lobby, userById, "players");
  const rangeMode = post.mmrRangeMode ?? post.roomState?.mmrRangeMode ?? post.rules?.mmrRangeMode;
  let placements = ["teamA", "teamB"].map((side) => {
    const sideState = lobby.sides?.[side] ?? {};
    const reserve = requestedReserve || Number(sideState.filled ?? 0) + candidateIds.length > Number(sideState.capacity ?? 0);
    const sidePlayerIds = {
      teamA: uniquePlayerIds(lobby.sides?.teamA?.players ?? []),
      teamB: uniquePlayerIds(lobby.sides?.teamB?.players ?? []),
    };
    if (!reserve) sidePlayerIds[side].push(...candidateIds);
    const balance = getSideMmrBalance(sidePlayerIds, userById, rangeMode);
    const occupancy = Number(sideState.filled ?? 0) + Number(sideState.reserveCandidates?.length ?? 0);
    const reserveRoom = occupancy < Number(sideState.capacity ?? 0) + Number(post.benchCapacity ?? post.rules?.benchCapacity ?? 0);
    return {
      side,
      reserve,
      balance,
      allowed: reserve ? reserveRoom : isMmrBalanceTransitionAllowed(current, balance),
      score: [
        reserve ? 1 : 0,
        Math.abs(balance.sides.teamA.count - balance.sides.teamB.count),
        balance.violation,
        balance.averageGapRaw,
        Math.max(balance.sides.teamA.spread, balance.sides.teamB.spread),
        occupancy,
        side === "teamA" ? 0 : 1,
      ],
    };
  }).filter((placement) => placement.allowed);
  if (!requestedReserve && !placements.length) {
    placements = ["teamA", "teamB"].map((side) => {
      const sideState = lobby.sides?.[side] ?? {};
      const occupancy = Number(sideState.filled ?? 0) + Number(sideState.reserveCandidates?.length ?? 0);
      return {
        side,
        reserve: true,
        balance: current,
        allowed: occupancy < Number(sideState.capacity ?? 0) + Number(post.benchCapacity ?? post.rules?.benchCapacity ?? 0),
        score: [1, Math.abs(current.sides.teamA.count - current.sides.teamB.count), current.violation, current.averageGapRaw, Math.max(current.sides.teamA.spread, current.sides.teamB.spread), occupancy, side === "teamA" ? 0 : 1],
      };
    }).filter((placement) => placement.allowed);
  }
  placements.sort((left, right) => left.score.reduce((result, value, index) => result || value - right.score[index], 0));
  return placements[0] ?? { allowed: false, side: "", reserve: false, balance: current };
}
