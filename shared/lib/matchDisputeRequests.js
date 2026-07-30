import { PLAYER_STAT_FIELDS } from "./constants.js";

export const MATCH_DISPUTE_REASON_OPTIONS = [
  "최종 점수 오기록",
  "내 득점 누락",
  "파울/개인 기록 오기록",
  "교체/후보 출전 누락",
  "기타",
];

export const OTHER_MATCH_DISPUTE_REASON = "기타";

export function getOpenMatchDisputes(match = {}) {
  return (match.disputes ?? []).filter((dispute) => dispute?.status === "open");
}

export function getMatchResultRevision(match = {}) {
  return Math.max(
    0,
    Number(match.result?.revision ?? 0),
    Number(match.result?.scoreRevisionA ?? 0),
    Number(match.result?.scoreRevisionB ?? 0),
  );
}

function normalizeWholeStatLine(stats = {}) {
  return Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => {
    const value = Number(stats?.[id] ?? 0);
    return [
      id,
      Number.isInteger(value) && value >= 0 && value <= 999 ? value : 0,
    ];
  }));
}

export function normalizeTeamScoresDisputeRequest({
  match = {},
  requestedScoreA,
  requestedScoreB,
  baseRevision,
  reason = "",
} = {}) {
  const scoreA = Number(requestedScoreA);
  const scoreB = Number(requestedScoreB);
  const revision = Number(baseRevision);
  if (![scoreA, scoreB, revision].every(Number.isInteger)) return null;
  if (
    scoreA < 0
    || scoreA > 999
    || scoreB < 0
    || scoreB > 999
    || revision < 0
  ) return null;
  return {
    kind: "team_scores",
    requestedScoreA: scoreA,
    requestedScoreB: scoreB,
    baseRevision: revision,
    reason: String(reason ?? "").trim(),
  };
}

export function normalizePlayerStatsDisputeRequest({
  match = {},
  playerId = "",
  requestedStats = {},
  baseRevision,
  reason = "",
} = {}) {
  const safePlayerId = String(playerId ?? "").trim();
  const revision = Number(baseRevision);
  if (!safePlayerId || !Number.isInteger(revision) || revision < 0) return null;
  const allowedIds = new Set(PLAYER_STAT_FIELDS.map(({ id }) => id));
  if (
    !requestedStats
    || typeof requestedStats !== "object"
    || Array.isArray(requestedStats)
    || Object.keys(requestedStats).some((id) => !allowedIds.has(id))
  ) return null;
  const stats = Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => {
    const value = Number(requestedStats[id] ?? 0);
    return [id, value];
  }));
  if (
    Object.values(stats).some(
      (value) => !Number.isInteger(value) || value < 0 || value > 999,
    )
  ) return null;
  return {
    kind: "player_stats",
    playerId: safePlayerId,
    requestedStats: stats,
    baseRevision: revision,
    reason: String(reason ?? "").trim(),
  };
}

export function buildMatchDisputeRequest({
  match = {},
  playerId = "",
  requestedStats = {},
  reason = "",
  customReason = "",
} = {}) {
  const currentStats = normalizeWholeStatLine(
    match.result?.playerStats?.[playerId] ?? {},
  );
  const reasonText = reason === OTHER_MATCH_DISPUTE_REASON
    ? String(customReason || OTHER_MATCH_DISPUTE_REASON).trim()
    : String(reason || MATCH_DISPUTE_REASON_OPTIONS[0]).trim();
  return normalizePlayerStatsDisputeRequest({
    match,
    playerId,
    requestedStats: { ...currentStats, ...requestedStats },
    baseRevision: getMatchResultRevision(match),
    reason: reasonText,
  });
}

export function normalizeDisputeRequest(disputeInput = "") {
  if (disputeInput && typeof disputeInput === "object") {
    return {
      ...disputeInput,
      reason: String(disputeInput.reason ?? "").trim(),
    };
  }
  return { reason: String(disputeInput ?? "").trim() };
}

export function getSubmittedStatPatch(playerStats = {}, targetPlayerIds = []) {
  const targetSet = new Set(targetPlayerIds);
  const validFieldIds = new Set(PLAYER_STAT_FIELDS.map((field) => field.id));
  return Object.fromEntries(
    Object.entries(playerStats ?? {})
      .filter(([playerId]) => targetSet.has(playerId))
      .map(([playerId, stats]) => [
        playerId,
        Object.fromEntries(
          Object.entries(stats ?? {})
            .filter(([fieldId]) => validFieldIds.has(fieldId))
            .map(([fieldId, value]) => [
              fieldId,
              Math.max(0, Number(value ?? 0)),
            ]),
        ),
      ])
      .filter(([, stats]) => Object.keys(stats).length),
  );
}

export function fillMatchDecision(match, decisionKey) {
  return {
    ...(match[decisionKey] ?? { teamA: [], teamB: [] }),
    teamA: [
      ...new Set([
        ...(match[decisionKey]?.teamA ?? []),
        ...(match.teamA?.players ?? []),
      ]),
    ],
    teamB: [
      ...new Set([
        ...(match[decisionKey]?.teamB ?? []),
        ...(match.teamB?.players ?? []),
      ]),
    ],
  };
}
