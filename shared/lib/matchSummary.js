import {
  MATCH_SIDES,
  SOLO_RECORD_ANONYMOUS_POSITION,
  SOLO_RECORD_ANONYMOUS_SOURCE,
} from "./constants.js";
import {
  isMatchRecordMatch,
  isPersonalRecordMatch,
} from "./matchRecordTypes.js";

export function getMatchSideScore(match = {}, sideName = "") {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  if (!resultKey) return 0;
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

export function getMatchSideResult(match = {}, sideName = "") {
  if (!MATCH_SIDES.includes(sideName)) return "D";
  const otherSideName = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getMatchSideScore(match, sideName);
  const otherScore = getMatchSideScore(match, otherSideName);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

export function getSafeMatchSide(match = {}, sideName = "teamA", options = {}) {
  const side = match?.[sideName];
  const fallbackName = sideName === "teamA" ? "A" : "B";
  const teamIdFallback = options.teamIdFallback ?? "";
  const includeScore = options.includeScore === true;
  if (!side || typeof side !== "object") {
    return {
      name: fallbackName,
      teamId: teamIdFallback,
      players: [],
      ...(includeScore ? { score: 0 } : {}),
    };
  }
  return {
    ...side,
    name: side.name || fallbackName,
    teamId: side.teamId ?? teamIdFallback,
    players: Array.isArray(side.players) ? side.players : [],
    ...(includeScore ? { score: side.score ?? 0 } : {}),
  };
}

export function getProfileRecordCategory(match = {}) {
  if (isPersonalRecordMatch(match)) return "personal";
  if (match.tournamentId) return "tournament";
  return match.ranked === false || match.rules?.matchPurpose === "friendly"
    ? "friendly"
    : "competitive";
}

export function hasVerifiedPlayerStats(match = {}, playerId = "") {
  const hasStats = Boolean(
    playerId
    && Object.prototype.hasOwnProperty.call(
      match.result?.playerStats ?? {},
      playerId,
    ),
  );
  return hasStats && Boolean(match.refereeId || match.tournamentId);
}

export function getMatchParticipationType(match = {}) {
  if (isPersonalRecordMatch(match)) return "personal";
  if (isMatchRecordMatch(match) && match?.rules?.recordComposition) {
    return match.rules.recordComposition === "team" ? "team" : "individual";
  }
  const teamAId = match?.teamA?.teamId
    ?? match?.teamAId
    ?? (match?.side === "teamA" ? match?.teamId : match?.opponentTeamId);
  const teamBId = match?.teamB?.teamId
    ?? match?.teamBId
    ?? (match?.side === "teamB" ? match?.teamId : match?.opponentTeamId);
  const teamConfigured = Boolean(
    (teamAId && teamBId)
    || match?.hostJoinMode === "team"
    || match?.rules?.hostJoinMode === "team"
    || match?.teamOnly === true
    || match?.rules?.teamOnly === true,
  );
  return teamConfigured ? "team" : "individual";
}

export function getMatchRecordCompositionLabel(match = {}) {
  if (!isMatchRecordMatch(match)) return "";
  return match?.rules?.recordComposition === "team" ? "팀 구성" : "개인 구성";
}

export function getMatchRecordSetupStatus(match = {}) {
  if (!isMatchRecordMatch(match)) return null;
  const composition = match?.rules?.recordComposition === "team" ? "team" : "individual";
  if (composition === "individual") {
    return match?.rules?.recordSetupReady === true
      ? { stage: "complete", label: "참가자 확정", tone: "green" }
      : { stage: "participants", label: "참가자 선택 필요", tone: "orange" };
  }

  const teamsSelected = Boolean(match?.teamA?.teamId && match?.teamB?.teamId);
  if (!teamsSelected) {
    return { stage: "teams", label: "팀 선택 필요", tone: "orange" };
  }
  if (match?.rules?.recordSetupReady === true) {
    return { stage: "complete", label: "명단 확정 완료", tone: "green" };
  }

  const readyCount = MATCH_SIDES.filter(
    (sideName) => match?.rules?.rosterReady?.[sideName] === true,
  ).length;
  return readyCount
    ? { stage: "rosters", label: `${readyCount}/2팀 명단 확정`, tone: "orange" }
    : { stage: "rosters", label: "명단 확정 대기", tone: "orange" };
}

export function makeAnonymousMatchPlayer(
  playerId,
  name,
  position = SOLO_RECORD_ANONYMOUS_POSITION,
) {
  return {
    id: playerId,
    name: String(name || "").trim() || "무기명",
    position: String(position || SOLO_RECORD_ANONYMOUS_POSITION).trim()
      || SOLO_RECORD_ANONYMOUS_POSITION,
    anonymous: true,
    participationLabel: SOLO_RECORD_ANONYMOUS_SOURCE,
    club: SOLO_RECORD_ANONYMOUS_SOURCE,
    avatarColor: "#64748b",
    trustScore: "-",
    ratings: { integrated: 0, modes: {} },
  };
}
