import { PLAYER_STAT_FIELDS } from "./constants.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;

export function getSideMajority(side = {}) {
  const total = side.players?.length ?? 0;
  return Math.floor(total / 2) + 1;
}

export function isCaptainApprovalRequired(match = {}) {
  return match.evidence?.some((item) => (item.id ?? item.type) === "captain") ?? false;
}

export function getTeamCaptainId(teams = [], teamId) {
  const team = teams.find((item) => item.id === teamId);
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

export function getSideCaptainId(match = {}, teams = [], sideName) {
  return getTeamCaptainId(teams, match[sideName]?.teamId);
}

function getDecisionStatus(match = {}, teams = [], sideName, decisionKey) {
  const side = match[sideName] ?? { players: [] };
  const approvals = match[decisionKey]?.[sideName] ?? [];
  const captainRequired = isCaptainApprovalRequired(match);
  const captainId = getSideCaptainId(match, teams, sideName);
  const majority = getSideMajority(side);
  const majorityApproved = approvals.length >= majority;
  const captainApproved = !captainRequired || !captainId || approvals.includes(captainId);

  return {
    approvals,
    total: side.players?.length ?? 0,
    majority,
    captainId,
    captainRequired,
    captainApproved,
    majorityApproved,
    approved: majorityApproved && captainApproved,
  };
}

export function getAgreementStatus(match = {}, teams = [], sideName) {
  return getDecisionStatus(match, teams, sideName, "agreements");
}

export function getApprovalStatus(match = {}, teams = [], sideName) {
  return getDecisionStatus(match, teams, sideName, "approvals");
}

export function getMatchPlayerIds(match = {}) {
  return [...new Set([...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])])];
}

export function getPlayerSideName(match = {}, playerId) {
  if (match.teamA?.players?.includes(playerId)) return "teamA";
  if (match.teamB?.players?.includes(playerId)) return "teamB";
  return null;
}

export function normalizePlayerStats(playerStats = {}, playerIds = []) {
  return Object.fromEntries(
    playerIds.map((playerId) => {
      const current = playerStats[playerId] ?? {};
      return [
        playerId,
        Object.fromEntries(
          PLAYER_STAT_FIELDS.map((field) => [field.id, Math.max(0, Number(current[field.id] ?? 0))]),
        ),
      ];
    }),
  );
}

export function getPlayerStatSubmitted(match = {}, playerId) {
  const submissions = match.result?.statSubmissions;
  if (submissions && Object.keys(submissions).length) return Boolean(submissions[playerId]);
  return Boolean(match.result?.playerStats?.[playerId]);
}

export function getStatSubmissionStatus(match = {}) {
  const playerIds = getMatchPlayerIds(match);
  const submittedIds = playerIds.filter((playerId) => getPlayerStatSubmitted(match, playerId));

  return {
    total: playerIds.length,
    submitted: submittedIds.length,
    submittedIds,
    missingIds: playerIds.filter((playerId) => !submittedIds.includes(playerId)),
    complete: playerIds.length > 0 && submittedIds.length === playerIds.length,
  };
}

export function getResultPointAudit(match = {}, result = match.result) {
  const auditSide = (sideName) => {
    const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
    const teamScore = Number(result?.[scoreKey] ?? match[sideName]?.score ?? 0);
    const statPoints = (match[sideName]?.players ?? []).reduce(
      (sum, playerId) => sum + Number(result?.playerStats?.[playerId]?.points ?? 0),
      0,
    );
    return {
      teamScore,
      statPoints,
      matched: teamScore === statPoints,
    };
  };
  const teamA = auditSide("teamA");
  const teamB = auditSide("teamB");
  return {
    teamA,
    teamB,
    matched: teamA.matched && teamB.matched,
  };
}

export function calculatePlayerStatBoost(match = {}, playerId, actual = 0.5) {
  const stats = match.result?.playerStats?.[playerId] ?? match.playerStats?.[playerId];
  if (!stats) return 0;

  const raw = PLAYER_STAT_FIELDS.reduce((sum, field) => sum + Number(stats[field.id] ?? 0) * field.weight, 0);
  const capped = clamp(raw, -0.8, 2.2);
  const resultFactor = actual === 1 ? 1 : actual === 0 ? 0.55 : 0.75;
  return round(capped * resultFactor);
}

export function formatStatLine(stats = {}) {
  const visible = PLAYER_STAT_FIELDS
    .filter((field) => Number(stats[field.id] ?? 0) > 0)
    .map((field) => `${field.shortLabel} ${Number(stats[field.id] ?? 0)}`);
  return visible.length ? visible.join(" · ") : "스탯 미입력";
}
