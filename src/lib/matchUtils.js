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

export function getApprovalStatus(match = {}, teams = [], sideName) {
  const side = match[sideName] ?? { players: [] };
  const approvals = match.approvals?.[sideName] ?? [];
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
