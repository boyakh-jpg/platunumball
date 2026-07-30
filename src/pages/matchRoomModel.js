import { MATCH_SIDES, PLAYER_STAT_FIELDS } from "../lib/constants.js";
import { getMatchRecordPlayerIds, getMatchSideRecordPlayerIds, getMergedResultScore } from "../lib/matchUtils.js";

export const statusMeta = {
  contract: { label: "대기", tone: "blue" },
  agreed: { label: "진행 예정", tone: "green" },
  approval: { label: "결과 승인 대기", tone: "orange" },
  disputed: { label: "이의제기 보류", tone: "orange" },
  confirmed: { label: "확정 완료", tone: "green" },
  void: { label: "경기 무효", tone: "neutral" },
  cancelled: { label: "취소됨", tone: "neutral" },
};

export function makeInitialStats(match) {
  if (!match) return {};
  const sourceResult = match?.disputeDraftResult ?? match?.result;
  const playerIds = getMatchRecordPlayerIds(match);
  return Object.fromEntries(
    playerIds.map((playerId) => [
      playerId,
      Object.fromEntries(PLAYER_STAT_FIELDS.map((field) => [field.id, sourceResult?.playerStats?.[playerId]?.[field.id] ?? 0])),
    ]),
  );
}

export function getTeamMmr(teams, teamId) {
  return teams.find((team) => team.id === teamId)?.mmr ?? 0;
}

export function getDisplayScore(match, sideName) {
  if (!match) return 0;
  const sourceResult = match.disputeDraftResult ?? match.result;
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  return sourceResult?.[resultKey] ?? match[sideName]?.score ?? 0;
}

export function getRecordSummaryNames(match = {}, sideName = "teamA") {
  const names = sideName === "teamA"
    ? match.rules?.recordSummary?.teamAPlayers
    : match.rules?.recordSummary?.teamBPlayers;
  return Array.isArray(names) ? names.map((name) => String(name ?? "").trim()) : [];
}

export function getRecordPlayerDisplayName(match = {}, sideName = "teamA", playerId = "", index = 0, user = null) {
  return user?.name
    || match.anonymousPlayers?.[playerId]?.name
    || getRecordSummaryNames(match, sideName)[index]
    || "플레이어";
}

export function isAnonymousDisplayUser(user = null) {
  return Boolean(user?.anonymous || user?.participationLabel === "개인참여");
}

export function getAvatarInitial(user = null, fallback = "P") {
  return isAnonymousDisplayUser(user) ? "?" : (user?.name?.slice(0, 1) ?? fallback);
}

export function getPlayerMetaLabel(user = null) {
  const position = user?.position ?? "-";
  return user?.participationLabel ? `${position} · ${user.participationLabel}` : position;
}

export function getRecordPlayerEntries(match = {}, includeReserves = false) {
  return MATCH_SIDES.flatMap((sideName) => (
    getMatchSideRecordPlayerIds(match, sideName, includeReserves).map((playerId, index) => ({ sideName, playerId, index }))
  ));
}

export function getPointAudit(match, score, sideName) {
  const teamScore = getMergedResultScore(match, score.playerStats, sideName, 0);
  const statPoints = getMatchSideRecordPlayerIds(match, sideName).reduce((sum, playerId) => sum + Number(score.playerStats[playerId]?.points ?? 0), 0);
  return {
    teamScore,
    statPoints,
    matched: teamScore === statPoints,
  };
}

export const COURT_REVIEW_FIELDS = [
  { id: "surfaceRating", label: "바닥" },
  { id: "rimRating", label: "림/골대" },
  { id: "lightingRating", label: "조명" },
  { id: "crowdRating", label: "혼잡도" },
  { id: "locationAccuracy", label: "위치 정확도" },
];

export function getCourtReviewDraft(review = {}) {
  const source = review ?? {};
  return {
    rating: source.rating ?? 0,
    surfaceRating: source.surfaceRating ?? "",
    rimRating: source.rimRating ?? "",
    lightingRating: source.lightingRating ?? "",
    crowdRating: source.crowdRating ?? "",
    locationAccuracy: source.locationAccuracy ?? "",
    memo: source.memo ?? "",
  };
}
