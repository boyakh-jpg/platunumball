import { EVIDENCE_OPTIONS, MATCH_MODES } from "./constants.js";
import { getTier, getTierDivision } from "./tier.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;

const modeWeightMap = {
  "1v1": 0.7,
  "2v2": 0.85,
  "3v3": 1,
  "5v5": 1.15,
};

const integratedWeightMap = MATCH_MODES.reduce((map, mode) => {
  map[mode.id] = mode.integratedWeight;
  return map;
}, {});

export { getTier, getTierDivision };

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

export function getCredibilityFactor(match = {}) {
  let factor = 1;
  if (match.official) factor += 0.2;
  if (match.preRegistered) factor += 0.12;
  return factor;
}

export function getScheduleFactor(match = {}) {
  return match.preRegistered ? 1.08 : 1;
}

export function getEvidenceFactor(evidenceList = []) {
  const total = evidenceList.reduce((sum, evidence) => {
    const option = EVIDENCE_OPTIONS.find((item) => item.id === evidence.id || item.id === evidence.type);
    return sum + (option?.factor ?? 0.03);
  }, 0);
  return 1 + clamp(total, 0, 0.2);
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
  const factor =
    getModeWeight(mode) *
    getCredibilityFactor(match) *
    getScheduleFactor(match) *
    getEvidenceFactor(match.evidence) *
    getTrustFactor(trustScore) *
    getRepeatFactor(history, match);

  return round(clamp(base * factor, -48, 48));
}

export function calculateIntegratedDelta(params) {
  const modeDelta = params.modeDelta ?? calculateModeDelta(params);
  const modeWeight = integratedWeightMap[params.mode ?? "5v5"] ?? 0.75;
  const credibilityBoost = params.match?.official ? 1.08 : 1;
  return round(clamp(modeDelta * modeWeight * credibilityBoost, -42, 42));
}

export function calculateTeamDelta({
  teamMmr = 1200,
  opponentTeamMmr = 1200,
  actual = 0.5,
  match = {},
  regularRatio = 1,
}) {
  const base = 24 * (actual - expectedScore(teamMmr, opponentTeamMmr));
  const factor = getCredibilityFactor(match) * getEvidenceFactor(match.evidence) * clamp(regularRatio, 0.45, 1);
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

export function applyMatchRating(match, players, ratings, history = []) {
  const mode = match.mode ?? "5v5";
  const scoreA = Number(match.result?.scoreA ?? match.teamA?.score ?? 0);
  const scoreB = Number(match.result?.scoreB ?? match.teamB?.score ?? 0);
  const actualA = scoreA === scoreB ? 0.5 : scoreA > scoreB ? 1 : 0;
  const actualB = 1 - actualA;
  const teamAMmr = sideAverage(match.teamA, ratings, mode);
  const teamBMmr = sideAverage(match.teamB, ratings, mode);
  const playerById = Object.fromEntries(players.map((player) => [player.id, player]));
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
      const integratedDelta = calculateIntegratedDelta({ modeDelta, mode, match });

      nextRatings[playerId] = {
        ...current,
        integrated: Math.max(0, Math.round((current.integrated ?? 1200) + integratedDelta)),
        modes: {
          ...current.modes,
          [mode]: Math.max(0, Math.round(modeRating + modeDelta)),
        },
      };
      changes.push({
        playerId,
        side: sideName,
        modeDelta,
        integratedDelta,
        result: actual === 1 ? "win" : actual === 0 ? "loss" : "draw",
      });
    }
  }

  return { ratings: nextRatings, changes };
}
