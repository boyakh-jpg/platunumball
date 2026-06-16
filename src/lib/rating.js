import { CREDIBILITY_LEVELS, EVIDENCE_OPTIONS, MATCH_MODES } from "./constants.js";
import { calculatePlayerStatBoost } from "./matchUtils.js";
import { getMercenaryPlayerFactor } from "./recruiting.js";
import { getTier, getTierDisplay, getTierDivision, getTierLabel } from "./tier.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;

const modeWeightMap = {
  "1v1": 0.78,
  "2v2": 0.9,
  "3v3": 1,
  "5v5": 1.12,
};

const integratedWeightMap = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = mode.integratedWeight;
  return map;
}, {});

const modeCapMap = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = { mode: mode.modeCap, integrated: mode.integratedCap, officialMode: mode.officialModeCap, officialIntegrated: mode.officialIntegratedCap };
  return map;
}, {});

export { getTier, getTierDisplay, getTierDivision, getTierLabel };

export function expectedScore(teamMmr = 1200, opponentMmr = 1200) {
  return 1 / (1 + 10 ** ((opponentMmr - teamMmr) / 400));
}

export function getKFactor(playerRating = 1200) {
  if (playerRating < 1000) return 34;
  if (playerRating < 1400) return 30;
  if (playerRating < 1700) return 26;
  if (playerRating < 1900) return 22;
  return 18;
}

export function getModeWeight(mode = "5v5") {
  return modeWeightMap[mode] ?? 1;
}

export function getCredibilityLevel(match = {}) {
  if (match.ranked === false) return "self_record";
  const hasEvidence = match.evidence?.some((item) => !["captain", "opponent_confirmation"].includes(item.id ?? item.type));
  if (match.official && hasEvidence) return "official_with_evidence";
  if (match.official) return "official";
  if (hasEvidence) return "evidence_verified";
  if (match.preRegistered) return "pre_registered";
  return "street_majority";
}

export function getCredibilityFactor(match = {}) {
  const level = getCredibilityLevel(match);
  return CREDIBILITY_LEVELS[level]?.factor ?? CREDIBILITY_LEVELS.street_majority.factor;
}

export function getScheduleFactor(match = {}) {
  if (!match.preRegistered) return 0.7;
  const created = match.createdAt ? new Date(match.createdAt) : null;
  const scheduled = match.scheduledDate ? new Date(`${match.scheduledDate}T${match.scheduledTime || "00:00"}`) : null;
  if (!created || !scheduled || Number.isNaN(created.getTime()) || Number.isNaN(scheduled.getTime())) return 1;
  const minutes = (scheduled.getTime() - created.getTime()) / 60000;
  if (minutes >= 60 * 24 * 3) return 1.15;
  if (minutes >= 60 * 24) return 1.1;
  if (minutes >= 30) return 1;
  return 0.7;
}

export function getEvidenceFactor(evidenceList = []) {
  const best = evidenceList.reduce((max, evidence) => {
    const option = EVIDENCE_OPTIONS.find((item) => item.id === evidence.id || item.id === evidence.type);
    return Math.max(max, option?.factor ?? 0);
  }, 0);
  return 1 + clamp(best, 0, 0.2);
}

export function getTrustFactor(trustScore = 80) {
  return clamp(0.82 + trustScore / 400, 0.86, 1.1);
}

export function getRepeatFactor(history = [], match = {}) {
  const recentSameCourt = history
    .filter((item) => item.status === "confirmed" && item.court === match.court)
    .slice(0, 4).length;
  return recentSameCourt >= 3 ? 0.88 : 1;
}

export function getTournamentFactor(match = {}) {
  if (!match.tournamentId) return 1;
  return match.tournamentFormat === "tournament" ? 1.18 : 1.12;
}

export function getRatingScaleFactor(match = {}) {
  const scale = Number(match.ratingScale ?? match.rules?.ratingScale ?? 1);
  return Number.isFinite(scale) ? clamp(scale, 0.2, 1.15) : 1;
}

export function getQualityFactor(match = {}, trustScore = 80, history = []) {
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

export function calculateModeDelta({
  playerRating = 1200,
  teamMmr = 1200,
  opponentMmr = 1200,
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

export function calculateIntegratedDelta(params) {
  const modeDelta = params.modeDelta ?? calculateModeDelta(params);
  const modeWeight = integratedWeightMap[params.mode ?? "5v5"] ?? 0.75;
  const cap = params.match?.official
    ? modeCapMap[params.mode]?.officialIntegrated ?? modeCapMap[params.mode]?.integrated ?? 45
    : modeCapMap[params.mode]?.integrated ?? 45;
  return round(clamp(modeDelta * modeWeight, -cap, cap));
}

export function calculateTeamDelta({
  teamMmr = 1200,
  opponentTeamMmr = 1200,
  actual = 0.5,
  match = {},
  regularRatio = 1,
}) {
  const base = 24 * (actual - expectedScore(teamMmr, opponentTeamMmr));
  const factor = getQualityFactor(match, 80, []) * clamp(regularRatio, 0.45, 1);
  return round(clamp(base * factor, -34, 34));
}

function average(values) {
  if (!values.length) return 1200;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sideAverage(side, ratings, mode) {
  return average(
    side.players.map((playerId) => ratings[playerId]?.modes?.[mode] ?? ratings[playerId]?.integrated ?? 1200),
  );
}

export function applyMatchRating(match, players, ratings, history = [], teams = []) {
  const mode = match.mode ?? "5v5";
  const scoreA = Number(match.result?.scoreA ?? match.teamA?.score ?? 0);
  const scoreB = Number(match.result?.scoreB ?? match.teamB?.score ?? 0);
  const actualA = scoreA === scoreB ? 0.5 : scoreA > scoreB ? 1 : 0;
  const actualB = 1 - actualA;
  const teamAMmr = sideAverage(match.teamA, ratings, mode);
  const teamBMmr = sideAverage(match.teamB, ratings, mode);
  const playerById = Object.fromEntries(players.map((player) => [player.id, player]));
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const nextRatings = {};
  const changes = [];

  for (const [sideName, actual, teamMmr, opponentMmr] of [
    ["teamA", actualA, teamAMmr, teamBMmr],
    ["teamB", actualB, teamBMmr, teamAMmr],
  ]) {
    for (const playerId of match[sideName].players) {
      const current = ratings[playerId] ?? { integrated: 1200, modes: {} };
      const modeRating = current.modes?.[mode] ?? current.integrated ?? 1200;
      const trustScore = playerById[playerId]?.trustScore ?? 80;
      const playerTeamId = match[sideName].playerTeams?.[playerId] ?? match[sideName].teamId;
      const playerTeam = teamById[playerTeamId];
      const role = playerTeam?.members?.find((member) => member.userId === playerId)?.role ?? "regular";
      const mercenaryFactor = getMercenaryPlayerFactor(current.integrated, playerTeam?.mmr ?? teamMmr, role);
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
      const statBoost = calculatePlayerStatBoost(match, playerId, actual);
      const adjustedModeDelta = round(clamp((modeDelta + statBoost) * mercenaryFactor, -48, 48));
      const integratedDelta = calculateIntegratedDelta({ modeDelta: adjustedModeDelta, mode, match });

      nextRatings[playerId] = {
        ...current,
        integrated: Math.max(0, Math.round((current.integrated ?? 1200) + integratedDelta)),
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
