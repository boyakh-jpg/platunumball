import { MATCH_SIDES } from "./constants.js";
import {
  getMatchPlayerPlacement,
  getMatchReservePlayerIds,
  getMatchSidePlayerIds,
} from "./matchParticipation.js";
import { isPersonalRecordMatch } from "./matchRecordTypes.js";
import { getMatchSideResult } from "./matchSummary.js";
import { uniquePlayerIds } from "./playerIds.js";

export function isMatchSideTeamParty(match = {}, sideName = "") {
  const sourceMatch = match ?? {};
  const side = sourceMatch[sideName] ?? {};
  return Boolean(side.teamId)
    && uniquePlayerIds([
      ...(side.players ?? []),
      ...getMatchReservePlayerIds(sourceMatch, sideName),
    ]).length >= 2;
}

export function isMatchPartyTeamParty(party = {}) {
  return Boolean(party.teamId)
    && uniquePlayerIds([
      ...(party.players ?? []),
      ...(party.reserves ?? []),
    ]).length >= 2;
}

export function getMatchPlayerTeamId(match = {}, sideName, playerId) {
  const side = match[sideName] ?? {};
  if (side.playerTeams?.[playerId]) return side.playerTeams[playerId];
  const party = (match.parties ?? []).find((item) => (
    item.side === sideName
    && [...(item.players ?? []), ...(item.reserves ?? [])].includes(playerId)
  ));
  return party?.teamId ?? side.teamId ?? null;
}

export function updateMatchPartiesForPlayer(
  match = {},
  playerId = "",
  sideName = "",
  reserve = false,
  remove = false,
) {
  return (match.parties ?? [])
    .map((party) => {
      const hadPlayer = (party.players ?? []).includes(playerId)
        || (party.reserves ?? []).includes(playerId);
      const nextPlayers = uniquePlayerIds(party.players ?? [])
        .filter((id) => id !== playerId);
      const nextReserves = uniquePlayerIds(party.reserves ?? [])
        .filter((id) => id !== playerId);
      if (!remove && hadPlayer && party.side === sideName) {
        if (reserve) nextReserves.push(playerId);
        else nextPlayers.push(playerId);
      }
      const nextRosterIds = uniquePlayerIds([
        ...nextPlayers,
        ...nextReserves,
      ]);
      const currentLeaderId = party.partyLeaderId
        ?? party.leaderId
        ?? party.playerId
        ?? "";
      const nextLeaderId = currentLeaderId
        && nextRosterIds.includes(currentLeaderId)
        ? currentLeaderId
        : nextRosterIds[0] ?? "";
      return {
        ...party,
        partyLeaderId: nextLeaderId,
        players: uniquePlayerIds(nextPlayers),
        reserves: uniquePlayerIds(nextReserves),
        reserve: party.reserve && !nextPlayers.length,
      };
    })
    .filter(
      (party) => (party.players ?? []).length || (party.reserves ?? []).length,
    );
}

export function getMatchAttendance(match = {}) {
  return {
    teamA: uniquePlayerIds(match.attendance?.teamA ?? []),
    teamB: uniquePlayerIds(match.attendance?.teamB ?? []),
  };
}

export function clearMatchPlayerDecision(nextMatch, playerId) {
  const attendance = getMatchAttendance(nextMatch);
  return {
    ...nextMatch,
    agreements: {
      teamA: (nextMatch.agreements?.teamA ?? [])
        .filter((id) => id !== playerId),
      teamB: (nextMatch.agreements?.teamB ?? [])
        .filter((id) => id !== playerId),
    },
    approvals: {
      teamA: (nextMatch.approvals?.teamA ?? [])
        .filter((id) => id !== playerId),
      teamB: (nextMatch.approvals?.teamB ?? [])
        .filter((id) => id !== playerId),
    },
    attendance: {
      teamA: attendance.teamA.filter((id) => id !== playerId),
      teamB: attendance.teamB.filter((id) => id !== playerId),
    },
  };
}

export function applyOperatorAttendance(match = {}, operatorId = "") {
  const placement = getMatchPlayerPlacement(match, operatorId);
  if (!placement) return match;
  const attendance = getMatchAttendance(match);
  if (attendance[placement.side].includes(operatorId)) return match;
  return {
    ...match,
    attendance: {
      ...attendance,
      [placement.side]: uniquePlayerIds([
        ...attendance[placement.side],
        operatorId,
      ]),
    },
  };
}

function getMatchAttendanceTargetIds(match = {}, sideName) {
  return uniquePlayerIds([
    ...(match[sideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, sideName),
  ]);
}

export function getMissingMatchAttendance(match = {}) {
  const attendance = getMatchAttendance(match);
  return MATCH_SIDES.flatMap((sideName) => (
    getMatchAttendanceTargetIds(match, sideName)
      .filter((playerId) => !attendance[sideName].includes(playerId))
      .map((playerId) => ({ sideName, playerId }))
  ));
}

export function getMatchSideLeaderId(match = {}, teams = [], sideName) {
  const sourceMatch = match ?? {};
  const sidePlayerIds = getMatchSidePlayerIds(match, sideName);
  const sideReserveIds = getMatchReservePlayerIds(match, sideName);
  const sideRosterIds = uniquePlayerIds([
    ...sidePlayerIds,
    ...sideReserveIds,
  ]);
  const partyLeaderId = (sourceMatch.parties ?? [])
    .filter((party) => party.side === sideName)
    .flatMap((party) => [
      party.partyLeaderId,
      party.leaderId,
      party.playerId,
      ...(party.players ?? []),
      ...(party.reserves ?? []),
    ])
    .find((playerId) => playerId && sideRosterIds.includes(playerId));
  if (partyLeaderId) return partyLeaderId;
  const hostPlayerId = sourceMatch.createdBy ?? "";
  if (hostPlayerId && sideRosterIds.includes(hostPlayerId)) {
    return hostPlayerId;
  }
  return sidePlayerIds[0] ?? sideReserveIds[0] ?? "";
}

export function getMatchSideRecordPlayerIds(
  match = {},
  sideName,
  includeReserves = false,
) {
  return uniquePlayerIds([
    ...getMatchSidePlayerIds(match, sideName),
    ...(includeReserves ? getMatchReservePlayerIds(match, sideName) : []),
  ]);
}

export function getMatchRecordPlayerIds(
  match = {},
  includeReserves = false,
) {
  return uniquePlayerIds([
    ...getMatchSideRecordPlayerIds(match, "teamA", includeReserves),
    ...getMatchSideRecordPlayerIds(match, "teamB", includeReserves),
  ]);
}

export function getPlayerSideName(match = {}, playerId) {
  if (getMatchSidePlayerIds(match, "teamA").includes(playerId)) return "teamA";
  if (getMatchSidePlayerIds(match, "teamB").includes(playerId)) return "teamB";
  return null;
}

export function getActualMatchPlayerSideName(match = {}, playerId = "") {
  if (!playerId) return null;
  if (isPersonalRecordMatch(match)) return getPlayerSideName(match, playerId);
  const playedPlayerIds = match.playedPlayerIds
    ?? match.rules?.playedPlayerIds
    ?? {};
  const playedSide = MATCH_SIDES.find(
    (sideName) => (playedPlayerIds?.[sideName] ?? []).includes(playerId),
  );
  if (playedSide) return playedSide;
  const currentSide = getPlayerSideName(match, playerId);
  if (!currentSide) return null;
  return getMatchReservePlayerIds(match, currentSide).includes(playerId)
    ? null
    : currentSide;
}

export function getPlayerMatchResult(match = {}, playerId = "") {
  return getMatchSideResult(match, getPlayerSideName(match, playerId));
}

export function getMatchRosterSideName(match = {}, playerId) {
  return getPlayerSideName(match, playerId)
    ?? (getMatchReservePlayerIds(match, "teamA").includes(playerId)
      ? "teamA"
      : null)
    ?? (getMatchReservePlayerIds(match, "teamB").includes(playerId)
      ? "teamB"
      : null);
}

export function getMatchUserParticipantSideName(
  match = {},
  userId = "",
) {
  return getMatchRosterSideName(match, userId);
}

export function isMatchRelatedToUser(match = {}, userId = "") {
  return Boolean(
    userId
    && (
      getMatchUserParticipantSideName(match, userId)
      || match.createdBy === userId
      || match.refereeId === userId
      || match.formerRefereeId === userId
    ),
  );
}
