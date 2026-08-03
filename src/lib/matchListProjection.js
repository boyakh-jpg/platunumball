import { MATCH_SIDES } from "./constants.js";
import {
  getMatchPlayerIds,
  getMatchReservePlayerIds,
  isMatchPartyTeamParty,
  isMatchSideTeamParty,
} from "./matchUtils.js";
import { isRecruitingTeamEntry } from "./recruiting.js";

const uniqueIds = (ids = []) => [...new Set(ids.filter(Boolean))];

export function normalizeMatchupText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/\s+vs\s+/i, " vs ")
    .trim()
    .toLowerCase();
}

export function isMatchupTitleDuplicate(title = "", match = {}) {
  const matchupTitle = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return Boolean(
    matchupTitle
    && normalizeMatchupText(title) === normalizeMatchupText(matchupTitle),
  );
}

export function getMatchListRoomComposition(room = {}, lobby = null) {
  const matchTeamCount = MATCH_SIDES.filter((sideName) => (
    Boolean(room?.[sideName]?.teamId) || isMatchSideTeamParty(room, sideName)
  )).length;
  const matchPartyCount = (room.parties ?? [])
    .filter((party) => isMatchPartyTeamParty(party))
    .length;
  const lobbyTeamCount = lobby?.entries
    ?.filter((entry) => isRecruitingTeamEntry(entry))
    .length ?? 0;

  return {
    matchTeamCount,
    matchPartyCount,
    lobbyTeamCount,
  };
}

export function getMatchListRoomTypeLabel(room = {}, lobby = null) {
  const {
    matchTeamCount,
    matchPartyCount,
    lobbyTeamCount,
  } = getMatchListRoomComposition(room, lobby);
  if (matchTeamCount >= 2 || lobbyTeamCount >= 2) return "팀전";
  if (matchTeamCount > 0 || matchPartyCount > 0 || lobbyTeamCount > 0) return "팀 파티 포함";
  return "개인 매칭";
}

export function getScheduleMatchSideCount(match = {}, sideName = "") {
  const activeIds = uniqueIds(match?.[sideName]?.players ?? []);
  const declaredCount = Number(match?.[sideName]?.count);
  const activeCount = Number.isFinite(declaredCount) ? Math.max(0, declaredCount) : activeIds.length;
  const reserveCount = getMatchReservePlayerIds(match, sideName)
    .filter((playerId) => !activeIds.includes(playerId)).length;
  return activeCount + reserveCount;
}

export function getScheduleMatchRosterProjection(match = {}) {
  const teamACount = getScheduleMatchSideCount(match, "teamA");
  const teamBCount = getScheduleMatchSideCount(match, "teamB");
  return {
    participantCount: teamACount + teamBCount,
    teamACount,
    teamBCount,
  };
}

export function getPlayMatchSideCount(match = {}, sideName = "") {
  return uniqueIds([
    ...(match?.[sideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, sideName),
  ]).length;
}

export function getPlayMatchRosterProjection(match = {}) {
  const teamACount = getPlayMatchSideCount(match, "teamA");
  const teamBCount = getPlayMatchSideCount(match, "teamB");
  const reserveCount = (
    getMatchReservePlayerIds(match, "teamA").length
    + getMatchReservePlayerIds(match, "teamB").length
  );
  const participantCount = getMatchPlayerIds(match).length;

  return {
    participantCount,
    reserveCount,
    teamACount,
    teamBCount,
    meta: `참여 ${participantCount}명 · A ${teamACount} / B ${teamBCount}${reserveCount ? ` · 후보 ${reserveCount}` : ""}`,
  };
}
