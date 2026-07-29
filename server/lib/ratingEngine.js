import { uniquePlayerIds } from "../../shared/lib/playerIds.js";
import { DEFAULT_RATING, MINUTE_MS, isSupportedMatchMode } from "../../shared/lib/matchConstants.js";
import {
  evaluateRecordVerification,
  getMatchScheduledDate,
  getMatchRecordPlayerIds,
  getMatchSidePlayerIds,
  isMatchRecordMatch,
  isPersonalRecordMatch,
} from "../../shared/lib/matchUtils.js";
import { getTier, getTierDisplay, getTierDivision, getTierLabel } from "../../shared/lib/tier.js";
import { getCredibilityLevel } from "../../shared/lib/rating.js";

const MATCH_MODES = Object.freeze([
  { id: "1v1", ratingWeight: 0.78, integratedWeight: 0.25, modeCap: 25, integratedCap: 8 },
  { id: "2v2", ratingWeight: 0.9, integratedWeight: 0.45, modeCap: 28, integratedCap: 14 },
  { id: "3v3", ratingWeight: 1, integratedWeight: 0.85, modeCap: 32, integratedCap: 25 },
  { id: "5v5", ratingWeight: 1.12, integratedWeight: 1.35, modeCap: 40, integratedCap: 45, officialModeCap: 50, officialIntegratedCap: 55 },
]);
const CREDIBILITY_FACTORS = Object.freeze({
  self_record: 0.18,
  street_majority: 0.7,
  pre_registered: 1,
  evidence_verified: 1.15,
  official: 1.35,
  official_with_evidence: 1.5,
});
const EVIDENCE_FACTORS = Object.freeze({ court_reservation: 0.2 });
const POSTGAME_RECORD_MMR_SCALE_BY_MODE = Object.freeze({
  "1v1": 0.1,
  "2v2": 0.2,
  "3v3": 0.35,
  "5v5": 0.5,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
export const PLACEMENT_MATCH_TARGET = 5;
export const PLACEMENT_MIN_MMR = 800;
export const PLACEMENT_MAX_MMR = 1799;
export const PLACEMENT_PRIOR_WEIGHT = 2.5;
export const TEAM_ROSTER_MMR_LIMIT = 5;
export const TEAM_PERFORMANCE_ADJUSTMENT_LIMIT = 150;

const matchModeMap = Object.fromEntries(MATCH_MODES.map((mode) => [mode.id, mode]));

const integratedWeightMap = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = mode.integratedWeight;
  return map;
}, {});

const activeEvidenceIds = new Set(Object.keys(EVIDENCE_FACTORS));

const modeCapMap = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = { mode: mode.modeCap, integrated: mode.integratedCap, officialMode: mode.officialModeCap, officialIntegrated: mode.officialIntegratedCap };
  return map;
}, {});

export { getTier, getTierDisplay, getTierDivision, getTierLabel };

export function normalizePlacement(placement = null, integrated = DEFAULT_RATING) {
  if (!placement || typeof placement !== "object") {
    return {
      matchCount: PLACEMENT_MATCH_TARGET,
      target: PLACEMENT_MATCH_TARGET,
      completed: true,
      completedAt: null,
      evidenceWeight: 0,
      weightedTotal: Number(integrated || DEFAULT_RATING) * PLACEMENT_PRIOR_WEIGHT,
      modeCounts: {},
    };
  }
  const matchCount = clamp(Math.floor(Number(placement.matchCount) || 0), 0, PLACEMENT_MATCH_TARGET);
  const evidenceWeight = Math.max(0, Number(placement.evidenceWeight) || 0);
  const weightedTotal = Number(placement.weightedTotal);
  return {
    matchCount,
    target: PLACEMENT_MATCH_TARGET,
    completed: matchCount >= PLACEMENT_MATCH_TARGET,
    completedAt: placement.completedAt ?? null,
    evidenceWeight,
    weightedTotal: Number.isFinite(weightedTotal)
      ? weightedTotal
      : Number(integrated || DEFAULT_RATING) * (PLACEMENT_PRIOR_WEIGHT + evidenceWeight),
    modeCounts: placement.modeCounts && typeof placement.modeCounts === "object" ? { ...placement.modeCounts } : {},
  };
}

export function isPlacementComplete(ratings = {}) {
  return normalizePlacement(ratings?.placement, ratings?.integrated).completed;
}

export function getPlacementLabel(ratings = {}) {
  const placement = normalizePlacement(ratings?.placement, ratings?.integrated);
  return placement.completed ? "" : `배정 전 · ${placement.matchCount}/${PLACEMENT_MATCH_TARGET}`;
}

export function hasModeRating(ratings = {}, mode = "") {
  const placement = normalizePlacement(ratings?.placement, ratings?.integrated);
  if (!placement.completed) return false;
  if (!ratings?.placement) return Number.isFinite(Number(ratings?.modes?.[mode]));
  return Number(placement.modeCounts?.[mode] ?? 0) > 0;
}

export function calculatePlacementPerformance({
  sideSize = 1,
  opponentMmr = DEFAULT_RATING,
  teammateMmrTotal = 0,
  actual = 0.5,
}) {
  const resultAdjustment = actual === 1 ? 200 : actual === 0 ? -200 : 0;
  return Math.round(clamp(
    Math.max(1, Number(sideSize) || 1) * Number(opponentMmr || DEFAULT_RATING)
      + resultAdjustment
      - Number(teammateMmrTotal || 0),
    600,
    2000,
  ));
}

export function calculateTeamRosterMmr(team = {}, users = []) {
  const userById = Object.fromEntries(users.map((user) => [user.id, user]));
  const values = (team.members ?? [])
    .filter((member) => ["captain", "regular"].includes(member.role))
    .map((member) => Number(userById[member.userId]?.ratings?.integrated))
    .filter(Number.isFinite)
    .sort((a, b) => b - a)
    .slice(0, TEAM_ROSTER_MMR_LIMIT);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : DEFAULT_RATING;
}

export function getTeamPerformanceAdjustment(team = {}, rosterMmr = DEFAULT_RATING) {
  const explicit = Number(team.performanceAdjustment);
  if (Number.isFinite(explicit)) return clamp(explicit, -TEAM_PERFORMANCE_ADJUSTMENT_LIMIT, TEAM_PERFORMANCE_ADJUSTMENT_LIMIT);
  return clamp(Number(team.mmr ?? DEFAULT_RATING) - Number(rosterMmr || DEFAULT_RATING), -TEAM_PERFORMANCE_ADJUSTMENT_LIMIT, TEAM_PERFORMANCE_ADJUSTMENT_LIMIT);
}

export function calculateRosterBasedTeamMmr(team = {}, users = []) {
  const rosterMmr = calculateTeamRosterMmr(team, users);
  const performanceAdjustment = getTeamPerformanceAdjustment(team, rosterMmr);
  return {
    rosterMmr,
    performanceAdjustment,
    mmr: Math.round(rosterMmr + performanceAdjustment),
  };
}

function expectedScore(teamMmr = DEFAULT_RATING, opponentMmr = DEFAULT_RATING) {
  return 1 / (1 + 10 ** ((opponentMmr - teamMmr) / 400));
}

function getKFactor(playerRating = DEFAULT_RATING) {
  if (playerRating < 1000) return 34;
  if (playerRating < 1400) return 30;
  if (playerRating < 1700) return 26;
  if (playerRating < 1900) return 22;
  return 18;
}

function getModeWeight(mode = "5v5") {
  return matchModeMap[mode]?.ratingWeight ?? matchModeMap["5v5"].ratingWeight;
}

function getCredibilityFactor(match = {}) {
  const level = getCredibilityLevel(match);
  return CREDIBILITY_FACTORS[level] ?? CREDIBILITY_FACTORS.street_majority;
}

function getScheduleFactor(match = {}) {
  if (!match.preRegistered) return 0.7;
  const created = match.createdAt ? new Date(match.createdAt) : null;
  const scheduled = getMatchScheduledDate(match);
  if (!created || !scheduled || Number.isNaN(created.getTime()) || Number.isNaN(scheduled.getTime())) return 1;
  const minutes = (scheduled.getTime() - created.getTime()) / MINUTE_MS;
  if (minutes >= 60 * 24 * 3) return 1.15;
  if (minutes >= 60 * 24) return 1.1;
  if (minutes >= 30) return 1;
  return 0.7;
}

function getEvidenceFactor(evidenceList = []) {
  const best = evidenceList.reduce((max, evidence) => {
    return Math.max(max, EVIDENCE_FACTORS[evidence.id ?? evidence.type] ?? 0);
  }, 0);
  return 1 + clamp(best, 0, 0.2);
}

function getTrustFactor(trustScore = 80) {
  return clamp(0.82 + trustScore / 400, 0.86, 1.1);
}

function getRepeatFactor(history = [], match = {}) {
  const recentSameCourt = history
    .filter((item) => item.status === "confirmed" && item.court === match.court)
    .slice(0, 4).length;
  return recentSameCourt >= 3 ? 0.88 : 1;
}

function getTournamentFactor(match = {}) {
  if (!match.tournamentId) return 1;
  return match.tournamentFormat === "tournament" ? 1.18 : 1.12;
}

function getRatingScaleFactor(match = {}) {
  const minimumScale = isMatchRecordMatch(match) ? 0.1 : 0.2;
  const rangeScale = Number(match.rules?.mmrRangeRatingScale);
  const assignmentScale = Number(match.rules?.pickupAssignmentRatingScale);
  if (Number.isFinite(rangeScale) || Number.isFinite(assignmentScale)) {
    return clamp(
      (Number.isFinite(rangeScale) ? rangeScale : 1)
        * (Number.isFinite(assignmentScale) ? assignmentScale : 1),
      minimumScale,
      1.5,
    );
  }
  const scale = Number(match.ratingScale ?? match.rules?.ratingScale ?? 1);
  return Number.isFinite(scale) ? clamp(scale, minimumScale, 1.5) : 1;
}

function getQualityFactor(match = {}, trustScore = 80, history = []) {
  return clamp(
    getCredibilityFactor(match) *
      getScheduleFactor(match) *
      getEvidenceFactor(match.evidence) *
      getTrustFactor(trustScore) *
      getRepeatFactor(history, match) *
      getTournamentFactor(match) *
      getRatingScaleFactor(match),
    0,
    2.05,
  );
}

function calculateModeDelta({
  playerRating = DEFAULT_RATING,
  teamMmr = DEFAULT_RATING,
  opponentMmr = DEFAULT_RATING,
  actual = 0.5,
  mode = "5v5",
  match = {},
  trustScore = 80,
  history = [],
}) {
  const base = getKFactor(playerRating) * (actual - expectedScore(teamMmr, opponentMmr));
  const factor = getModeWeight(mode) * getQualityFactor(match, trustScore, history);
  const cap = match.official ? modeCapMap[mode]?.officialMode ?? modeCapMap[mode]?.mode ?? 40 : modeCapMap[mode]?.mode ?? 40;

  return round(clamp(base * factor, -cap, cap));
}

function calculateIntegratedDelta(params) {
  const modeDelta = params.modeDelta ?? calculateModeDelta(params);
  const modeWeight = integratedWeightMap[params.mode ?? "5v5"] ?? integratedWeightMap["5v5"];
  const cap = params.match?.official
    ? modeCapMap[params.mode]?.officialIntegrated ?? modeCapMap[params.mode]?.integrated ?? 45
    : modeCapMap[params.mode]?.integrated ?? 45;
  return round(clamp(modeDelta * modeWeight, -cap, cap));
}

export function calculateTeamDelta({
  teamMmr = DEFAULT_RATING,
  opponentTeamMmr = DEFAULT_RATING,
  actual = 0.5,
  match = {},
  regularRatio = 1,
}) {
  const base = 24 * (actual - expectedScore(teamMmr, opponentTeamMmr));
  const factor = getQualityFactor(match, 80, []) * clamp(regularRatio, 0, 1);
  return round(clamp(base * factor, -34, 34));
}

export function teamRegularRatio(team, playerIds) {
  if (!team) return 1;
  const selected = (team.members ?? []).filter((member) => playerIds.includes(member.userId));
  if (!selected.length) return 0;
  const regularCount = selected.filter((member) => ["captain", "regular"].includes(member.role)).length;
  return regularCount / selected.length;
}

export function averageTeamMmr(groups = []) {
  if (!groups.length) return DEFAULT_RATING;
  return groups.reduce((sum, group) => sum + Number(group.team?.mmr ?? DEFAULT_RATING), 0) / groups.length;
}

export function getMatchSideTeamGroups(state, match, sideName) {
  const side = match[sideName] ?? {};
  const playerTeams = side.playerTeams ?? {};
  const excludedIds = new Set(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? []);
  const groups = new Map();
  getMatchSidePlayerIds(match, sideName).forEach((playerId) => {
    if (excludedIds.has(playerId)) return;
    const teamId = playerTeams[playerId] ?? side.teamId;
    if (!teamId) return;
    if (!groups.has(teamId)) groups.set(teamId, []);
    groups.get(teamId).push(playerId);
  });
  return Array.from(groups.entries())
    .map(([teamId, playerIds]) => ({
      team: state.teams.find((team) => team.id === teamId),
      playerIds,
    }))
    .filter((group) => group.team);
}

export function getFinalizationRatingContext(match, teams = []) {
  if (isPersonalRecordMatch(match)) {
    return { matchForRating: match, canApplyPersonalMmr: false, canApplyTeamMmr: false };
  }
  if (!isMatchRecordMatch(match) && match?.ranked === false) {
    return { matchForRating: match, canApplyPersonalMmr: false, canApplyTeamMmr: false };
  }
  if (!isMatchRecordMatch(match)) {
    return { matchForRating: match, canApplyPersonalMmr: true, canApplyTeamMmr: true };
  }
  const verification = evaluateRecordVerification(match, { teams });
  const mmrScale = POSTGAME_RECORD_MMR_SCALE_BY_MODE[match.mode] ?? 0;
  const eligibleIds = new Set(verification.mmrEligiblePlayerIds);
  const existingExcludedIds = new Set([...(match.mmrExcludedPlayerIds ?? []), ...(match.rules?.mmrExcludedPlayerIds ?? [])]);
  getMatchRecordPlayerIds(match).forEach((playerId) => {
    if (!eligibleIds.has(playerId)) existingExcludedIds.add(playerId);
  });
  const mmrExcludedPlayerIds = Array.from(existingExcludedIds);
  return {
    matchForRating: {
      ...match,
      ranked: true,
      ratingScale: mmrScale,
      mmrExcludedPlayerIds,
      rules: { ...(match.rules ?? {}), ratingScale: mmrScale, mmrExcludedPlayerIds },
    },
    canApplyPersonalMmr: verification.canApplyPersonalMmr,
    canApplyTeamMmr: verification.canApplyTeamMmr,
  };
}

export function getAveragePlayerMmr(state = {}, playerIds = [], fallback = DEFAULT_RATING) {
  const values = uniquePlayerIds(playerIds)
    .map((playerId) => Number(state.users?.find((user) => user.id === playerId)?.ratings?.integrated))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return fallback;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function average(values) {
  if (!values.length) return DEFAULT_RATING;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sideAverage(match, sideName, ratings, mode) {
  return average(
    getRatedSidePlayerIds(match, sideName).map((playerId) => ratings[playerId]?.modes?.[mode] ?? ratings[playerId]?.integrated ?? DEFAULT_RATING),
  );
}

function getRatedSidePlayerIds(match, sideName) {
  const excludedIds = new Set(match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? []);
  return getMatchSidePlayerIds(match, sideName).filter((playerId) => !excludedIds.has(playerId));
}

export function applyMatchRating(match, players, ratings, history = [], teams = []) {
  const mode = isSupportedMatchMode(match.mode) ? match.mode : "5v5";
  const scoreA = Number(match.result?.scoreA ?? match.teamA?.score ?? 0);
  const scoreB = Number(match.result?.scoreB ?? match.teamB?.score ?? 0);
  const actualA = scoreA === scoreB ? 0.5 : scoreA > scoreB ? 1 : 0;
  const actualB = 1 - actualA;
  const teamAMmr = sideAverage(match, "teamA", ratings, mode);
  const teamBMmr = sideAverage(match, "teamB", ratings, mode);
  const playerById = Object.fromEntries(players.map((player) => [player.id, player]));
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const nextRatings = {};
  const changes = [];

  for (const [sideName, actual, teamMmr, opponentMmr] of [
    ["teamA", actualA, teamAMmr, teamBMmr],
    ["teamB", actualB, teamBMmr, teamAMmr],
  ]) {
    const sidePlayerIds = getRatedSidePlayerIds(match, sideName);
    for (const playerId of sidePlayerIds) {
      const current = ratings[playerId] ?? { integrated: DEFAULT_RATING, modes: {} };
      const modeRating = current.modes?.[mode] ?? current.integrated ?? DEFAULT_RATING;
      const placement = normalizePlacement(current.placement, current.integrated);
      if (!placement.completed) {
        const teammateMmrTotal = sidePlayerIds
          .filter((candidateId) => candidateId !== playerId)
          .reduce((sum, candidateId) => (
            sum + Number(ratings[candidateId]?.modes?.[mode] ?? ratings[candidateId]?.integrated ?? DEFAULT_RATING)
          ), 0);
        const performanceMmr = calculatePlacementPerformance({
          sideSize: sidePlayerIds.length,
          opponentMmr,
          teammateMmrTotal,
          actual,
        });
        const weight = getRatingScaleFactor(match);
        const nextCount = Math.min(PLACEMENT_MATCH_TARGET, placement.matchCount + 1);
        const nextEvidenceWeight = placement.evidenceWeight + weight;
        const nextWeightedTotal = placement.weightedTotal + performanceMmr * weight;
        const rawMmr = nextWeightedTotal / (PLACEMENT_PRIOR_WEIGHT + nextEvidenceWeight);
        const nextIntegrated = Math.round(nextCount >= PLACEMENT_MATCH_TARGET
          ? clamp(rawMmr, PLACEMENT_MIN_MMR, PLACEMENT_MAX_MMR)
          : clamp(rawMmr, 600, 2000));
        const nextPlacement = {
          ...placement,
          matchCount: nextCount,
          completed: nextCount >= PLACEMENT_MATCH_TARGET,
          completedAt: nextCount >= PLACEMENT_MATCH_TARGET
            ? match.confirmedAt ?? match.endedAt ?? match.scheduledAt ?? match.createdAt ?? null
            : null,
          evidenceWeight: nextEvidenceWeight,
          weightedTotal: nextWeightedTotal,
          modeCounts: {
            ...placement.modeCounts,
            [mode]: Number(placement.modeCounts?.[mode] ?? 0) + 1,
          },
        };
        nextRatings[playerId] = {
          ...current,
          integrated: nextIntegrated,
          modes: { ...current.modes, [mode]: nextIntegrated },
          placement: nextPlacement,
        };
        changes.push({
          playerId,
          side: sideName,
          modeDelta: nextIntegrated - modeRating,
          integratedDelta: nextIntegrated - Number(current.integrated ?? DEFAULT_RATING),
          statBoost: 0,
          mercenaryFactor: 1,
          placement: true,
          placementMatchCount: nextCount,
          placementPerformanceMmr: performanceMmr,
          result: actual === 1 ? "win" : actual === 0 ? "loss" : "draw",
        });
        continue;
      }
      const trustScore = playerById[playerId]?.trustScore ?? 80;
      const playerTeamId = match[sideName].playerTeams?.[playerId] ?? match[sideName].teamId;
      const playerTeam = teamById[playerTeamId];
      const role = playerTeam?.members?.find((member) => member.userId === playerId)?.role ?? "regular";
      const teamRating = Number(playerTeam?.mmr ?? teamMmr ?? DEFAULT_RATING);
      const playerRating = Number(current.integrated ?? DEFAULT_RATING);
      const mercenaryFactor = role !== "mercenary"
        ? 1
        : playerRating >= teamRating + 140
          ? 0.62
          : playerRating <= teamRating - 140
            ? 0.96
            : 0.82;
      const modeDelta = calculateModeDelta({
        playerRating: modeRating,
        teamMmr,
        opponentMmr,
        actual,
        mode,
        match,
        trustScore,
        history,
      });
      const statBoost = 0;
      const adjustedModeDelta = round(clamp((modeDelta + statBoost) * mercenaryFactor, -48, 48));
      const integratedDelta = calculateIntegratedDelta({ modeDelta: adjustedModeDelta, mode, match });

      nextRatings[playerId] = {
        ...current,
        integrated: Math.max(0, Math.round((current.integrated ?? DEFAULT_RATING) + integratedDelta)),
        modes: {
          ...current.modes,
          [mode]: Math.max(0, Math.round(modeRating + adjustedModeDelta)),
        },
      };
      changes.push({
        playerId,
        side: sideName,
        modeDelta: adjustedModeDelta,
        integratedDelta,
        statBoost,
        mercenaryFactor,
        result: actual === 1 ? "win" : actual === 0 ? "loss" : "draw",
      });
    }
  }

  return { ratings: nextRatings, changes };
}
