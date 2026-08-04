import { MATCH_SIDES } from "../../../lib/constants.js";
import { MAX_BENCH_CAPACITY } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { clearMatchPlayerDecision } from "../../../lib/matchUtils.js";
import { getMatchAttendance } from "../../../lib/matchUtils.js";
import { getMatchOverlapConflict } from "../../../lib/matchUtils.js";
import { getMatchPlayerPlacement } from "../../../lib/matchUtils.js";
import { getMatchPlayerTeamId } from "../../../lib/matchUtils.js";
import { getMatchReservePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchRoomPhase } from "../../../lib/matchUtils.js";
import { getMatchSideLeaderId } from "../../../lib/matchUtils.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getSideMmrBalance } from "../../../lib/recruiting.js";
import { getTeamCaptainId } from "../../../lib/matchUtils.js";
import { getTeamEventEligibility } from "../../../lib/recruiting.js";
import { getTeamMemberIds } from "../../teamMappers.js";
import { isMatchPartyTeamParty } from "../../../lib/matchUtils.js";
import { isMatchRecordMatch } from "../../../lib/matchUtils.js";
import { isMatchSideTeamParty } from "../../../lib/matchUtils.js";
import { isMmrBalanceTransitionAllowed } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { updateMatchPartiesForPlayer } from "../../../lib/matchUtils.js";
import { getMatchOverlapConflictBlockedState } from "../guards.js";
import { canEditMatchPreparation, getMatchHostPlayerId } from "../matchAccess.js";
export { setMatchRecordParticipants } from "./recordParticipants.js";


function swapMatchSideMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { teamA, teamB, ...rest } = value;
  return { ...rest, teamA: teamB, teamB: teamA };
}

function swapTournamentMatchSides(match = {}) {
  const {
    statRecorders: legacyStatRecorders,
    ...matchWithoutLegacyRecorders
  } = match;
  const {
    statRecorders: legacyRuleStatRecorders,
    ...rulesWithoutLegacyRecorders
  } = match.rules ?? {};
  void legacyStatRecorders;
  void legacyRuleStatRecorders;
  const nextTeamA = match.teamB ?? {};
  const nextTeamB = match.teamA ?? {};
  const titlePrefix = String(match.title ?? "").split("·")[0].trim();
  return {
    ...matchWithoutLegacyRecorders,
    title: `${titlePrefix ? `${titlePrefix} · ` : ""}${nextTeamA.name ?? "A"} vs ${nextTeamB.name ?? "B"}`,
    teamA: nextTeamA,
    teamB: nextTeamB,
    reservePlayers: swapMatchSideMap(match.reservePlayers),
    playedPlayerIds: swapMatchSideMap(match.playedPlayerIds),
    promotedReserveIds: swapMatchSideMap(match.promotedReserveIds),
    attendance: swapMatchSideMap(match.attendance),
    agreements: swapMatchSideMap(match.agreements),
    approvals: swapMatchSideMap(match.approvals),
    parties: (match.parties ?? []).map((party) => ({
      ...party,
      side: party.side === "teamA" ? "teamB" : party.side === "teamB" ? "teamA" : party.side,
    })),
    rules: {
      ...rulesWithoutLegacyRecorders,
      rosterReady: swapMatchSideMap(match.rules?.rosterReady),
      rosterReadyAt: swapMatchSideMap(match.rules?.rosterReadyAt),
      reservePlayers: swapMatchSideMap(match.rules?.reservePlayers),
      playedPlayerIds: swapMatchSideMap(match.rules?.playedPlayerIds),
    },
  };
}

function currentUserCanEditMatchRecordSideRoster(state, match, sideName) {
  const tournamentPregame = Boolean(
    match?.tournamentId &&
    match?.scheduledDate &&
    match?.scheduledTime &&
    !match?.startedAt &&
    !match?.endedAt
  );
  if ((!isMatchRecordMatch(match) && !tournamentPregame) || !MATCH_SIDES.includes(sideName)) return false;
  if (match.result || match.confirmedAt || match.cancelledAt || match.voidedAt) return false;
  const leaderId = tournamentPregame
    ? getTeamCaptainId(state.teams, match[sideName]?.teamId)
    : getMatchSideLeaderId(match, state.teams, sideName);
  return Boolean(leaderId && leaderId === state.currentUserId);
}



export function setMatchRecordTeamRoster(state, matchId, sideName, roster = {}) {
  const sourceMatch = state.matches.find((item) => item.id === matchId);
  if (isMatchRecordMatch(sourceMatch) && sourceMatch?.rules?.recordSetupReady === true) return state;
  if (!currentUserCanEditMatchRecordSideRoster(state, sourceMatch, sideName)) return state;
  const tournamentPregame = Boolean(sourceMatch.tournamentId && !sourceMatch.startedAt && !sourceMatch.endedAt);
  let match = sourceMatch;
  if (tournamentPregame && match.rules?.tournamentSideAssignmentLocked !== true) {
    const organizerId = match.rules?.tournamentOrganizerId || match.createdBy || "";
    const hostPlayerId = getTeamCaptainId(state.teams, match[sideName]?.teamId);
    if (!hostPlayerId) return state;
    if (sideName === "teamB") match = swapTournamentMatchSides(match);
    sideName = "teamA";
    match = {
      ...match,
      createdBy: hostPlayerId,
      rules: {
        ...(match.rules ?? {}),
        tournamentOrganizerId: organizerId,
        tournamentSideAssignmentLocked: true,
        tournamentHostSide: "teamA",
        tournamentHostTeamId: match.teamA?.teamId ?? "",
        tournamentHostPlayerId: hostPlayerId,
      },
    };
  }
  const side = match[sideName] ?? {};
  const team = state.teams.find((item) => item.id === side.teamId);
  if (!team) return state;

  const sideCapacity = getRecruitingSideCapacity(match);
  const benchCapacity = isMatchRecordMatch(match)
    ? MAX_BENCH_CAPACITY
    : getRecruitingBenchCapacity(match);
  const eligibility = getTeamEventEligibility(team, state.users, {
    capacity: sideCapacity,
    ranked: match.ranked,
    mmrLimitMode: match.rules?.mmrLimitMode ?? match.mmrLimitMode,
    mmrRangeMode: match.rules?.mmrRangeMode,
    targetMmr: team.mmr,
    allowedAgeGroups: match.rules?.allowedAgeGroups,
  });
  const snapshotEligibleIds = match.rules?.teamRosterSnapshot?.teams?.[team.id]?.eligiblePlayerIds;
  const allowedIds = new Set(tournamentPregame
    ? (Array.isArray(snapshotEligibleIds) ? snapshotEligibleIds : eligibility.eligiblePlayerIds)
    : getTeamMemberIds(team));
  const otherSideName = sideName === "teamA" ? "teamB" : "teamA";
  const otherRosterIds = new Set([
    ...(match[otherSideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, otherSideName),
  ]);
  const normalizeRosterIds = (ids = []) => uniquePlayerIds(ids)
    .filter((playerId) => allowedIds.has(playerId) && !otherRosterIds.has(playerId));
  const nextActiveIds = normalizeRosterIds(roster.playerIds).slice(0, sideCapacity);
  const nextReserveIds = normalizeRosterIds(roster.reservePlayerIds)
    .filter((playerId) => !nextActiveIds.includes(playerId))
    .slice(0, benchCapacity);
  const leaderId = tournamentPregame
    ? getTeamCaptainId(state.teams, team.id)
    : getMatchSideLeaderId(match, state.teams, sideName);
  const matchRecordRoom = isMatchRecordMatch(match);
  if ((tournamentPregame || matchRecordRoom) && nextActiveIds.length !== sideCapacity) return state;
  if (!tournamentPregame && leaderId && ![...nextActiveIds, ...nextReserveIds].includes(leaderId)) return state;

  const previousRosterIds = uniquePlayerIds([
    ...(match[sideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, sideName),
  ]);
  const nextRosterIds = new Set([...nextActiveIds, ...nextReserveIds]);
  const tournamentHostPlayerId = tournamentPregame ? match.rules?.tournamentHostPlayerId ?? "" : "";
  const tournamentHostTeamId = tournamentPregame ? match.rules?.tournamentHostTeamId ?? "" : "";
  const nextPlayerTeams = Object.fromEntries(
    Object.entries(side.playerTeams ?? {}).filter(([playerId]) => nextRosterIds.has(playerId)),
  );
  nextRosterIds.forEach((playerId) => {
    nextPlayerTeams[playerId] = team.id;
  });
  const rosterSavedAt = new Date().toISOString();
  const nextReservePlayers = {
    ...(match.reservePlayers ?? {}),
    [sideName]: nextReserveIds,
  };
  let nextMatch = {
    ...match,
    [sideName]: {
      ...side,
      players: nextActiveIds,
      playerTeams: nextPlayerTeams,
    },
    reservePlayers: nextReservePlayers,
    rules: tournamentPregame ? {
      ...(match.rules ?? {}),
      rosterReady: {
        ...(match.rules?.rosterReady ?? {}),
        [sideName]: true,
      },
      rosterReadyAt: {
        ...(match.rules?.rosterReadyAt ?? {}),
        [sideName]: rosterSavedAt,
      },
      lineupDeadlineState: "pending",
      lineupDeadlineCheckedAt: null,
      tournamentHostRosterSelected: tournamentHostPlayerId && team.id === tournamentHostTeamId
        ? nextRosterIds.has(tournamentHostPlayerId)
        : match.rules?.tournamentHostRosterSelected === true,
    } : matchRecordRoom ? {
      ...(match.rules ?? {}),
      rosterReady: {
        ...(match.rules?.rosterReady ?? {}),
        [sideName]: true,
      },
      rosterReadyAt: {
        ...(match.rules?.rosterReadyAt ?? {}),
        [sideName]: rosterSavedAt,
      },
      recordSetupReady: Boolean(
        sideName === "teamA"
          ? match.rules?.rosterReady?.teamB === true
          : match.rules?.rosterReady?.teamA === true
      ),
      recordApprovalMode: { teamA: "all", teamB: "all" },
      recordApproverIds: {
        ...(match.rules?.recordApproverIds ?? {}),
        [sideName]: nextActiveIds,
      },
      participantAcceptedIds: [],
      playedPlayerIds: {
        ...(match.rules?.playedPlayerIds ?? match.playedPlayerIds ?? {}),
        [sideName]: nextActiveIds,
      },
      reservePlayers: nextReservePlayers,
    } : match.rules,
    playedPlayerIds: matchRecordRoom ? {
      ...(match.playedPlayerIds ?? {}),
      [sideName]: nextActiveIds,
    } : match.playedPlayerIds,
  };
  previousRosterIds
    .filter((playerId) => !nextRosterIds.has(playerId))
    .forEach((playerId) => {
      nextMatch = clearMatchPlayerDecision(nextMatch, playerId);
  });
  const resolvedNotifications = (state.notifications ?? []).map((notification) => (
    tournamentPregame &&
    notification.type === "tournament_match_schedule" &&
    notification.matchId === matchId &&
    notification.targetUserId === state.currentUserId
      ? { ...notification, readAt: rosterSavedAt, actionRequired: false, homeAction: false }
      : notification
  ));

  const recordAssignmentNotifications = matchRecordRoom
    ? nextActiveIds
      .filter((playerId) => !previousRosterIds.includes(playerId) && playerId !== state.currentUserId)
      .map((playerId) => ({
        id: makeId("n"),
        title: "팀 경기 기록 명단",
        body: `${match.title} ${SIDE_LABEL_TEXT[sideName] ?? "사이드"} 출전 명단에 등록됐습니다. 기록을 확인해 주세요.`,
        tone: "match",
        type: "match_record_roster",
        targetUserId: playerId,
        matchId,
        discordEvent: "match",
        webPath: `/app/recorder?match=${encodeURIComponent(matchId)}`,
        createdAt: rosterSavedAt,
      }))
    : [];

  const overlapConflict = matchRecordRoom ? getMatchOverlapConflict(nextMatch, state.matches) : null;
  const overlapConflictState = getMatchOverlapConflictBlockedState(state, matchId, overlapConflict);
  if (overlapConflictState) return overlapConflictState;
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: tournamentPregame ? [
      ...[...nextActiveIds, ...nextReserveIds].map((playerId) => ({
        id: makeId("n"),
        title: "대회 출전 명단",
        body: `${match.title} ${sideName === "teamA" ? "A" : "B"}사이드 명단에 배정됐습니다.`,
        tone: "match",
        type: "tournament_roster_assignment",
        discordEvent: "match",
        targetUserId: playerId,
        matchId,
        tournamentId: match.tournamentId,
        webPath: `/app/matches?match=${encodeURIComponent(matchId)}`,
        createdAt: rosterSavedAt,
      })),
      ...resolvedNotifications,
    ] : [...recordAssignmentNotifications, ...resolvedNotifications],
  };
}

function autoPromoteMatchReservesForCheckin(match = {}, excludedPlayerIds = []) {
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return match;
  const excludedIds = new Set(excludedPlayerIds);
  const sideCapacity = getRecruitingSideCapacity(match);
  let nextMatch = match;

  for (const sideName of MATCH_SIDES) {
    let activeIds = uniquePlayerIds(nextMatch[sideName]?.players ?? []);
    while (activeIds.length < sideCapacity) {
      const attendance = getMatchAttendance(nextMatch);
      const reserveId = getMatchReservePlayerIds(nextMatch, sideName).find((playerId) => (
        !excludedIds.has(playerId) && attendance[sideName].includes(playerId)
      ));
      if (!reserveId) break;

      const playerTeams = { ...(nextMatch[sideName]?.playerTeams ?? {}) };
      const teamId = getMatchPlayerTeamId(nextMatch, sideName, reserveId);
      if (teamId) playerTeams[reserveId] = teamId;
      activeIds = uniquePlayerIds([...activeIds, reserveId]);
      nextMatch = {
        ...nextMatch,
        [sideName]: {
          ...(nextMatch[sideName] ?? {}),
          players: activeIds,
          playerTeams,
        },
        reservePlayers: {
          ...(nextMatch.reservePlayers ?? {}),
          [sideName]: getMatchReservePlayerIds(nextMatch, sideName).filter((playerId) => playerId !== reserveId),
        },
        parties: updateMatchPartiesForPlayer(nextMatch, reserveId, sideName, false),
        promotedReserveIds: {
          ...(nextMatch.promotedReserveIds ?? {}),
          [sideName]: uniquePlayerIds([...(nextMatch.promotedReserveIds?.[sideName] ?? []), reserveId]),
        },
      };
    }
  }

  return nextMatch;
}

export function setMatchRoomPlayerPlacement(state, matchId, playerId, placement = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditMatchPreparation(state, match) || !playerId) return state;
  const currentPlacement = getMatchPlayerPlacement(match, playerId);
  if (!currentPlacement) return state;
  const targetSide = MATCH_SIDES.includes(placement.side) ? placement.side : currentPlacement.side;
  const targetReserve = Boolean(placement.reserve);
  const pickupRoom = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  const hostPlayerId = getMatchHostPlayerId(state, match);
  if (!pickupRoom && hostPlayerId && playerId === hostPlayerId && targetSide !== currentPlacement.side) return state;
  const sideCapacity = getRecruitingSideCapacity(match);
  const teamMatchLocked = Boolean(
    isMatchSideTeamParty(match, "teamA") ||
    isMatchSideTeamParty(match, "teamB") ||
    (match.parties ?? []).some((party) => isMatchPartyTeamParty(party))
  );
  if (teamMatchLocked && targetSide !== currentPlacement.side) return state;

  const baseTeamAPlayers = uniquePlayerIds(match.teamA?.players ?? []).filter((id) => id !== playerId);
  const baseTeamBPlayers = uniquePlayerIds(match.teamB?.players ?? []).filter((id) => id !== playerId);
  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextTeamAPlayers = targetSide === "teamA" && !targetReserve ? uniquePlayerIds([...baseTeamAPlayers, playerId]) : baseTeamAPlayers;
  const nextTeamBPlayers = targetSide === "teamB" && !targetReserve ? uniquePlayerIds([...baseTeamBPlayers, playerId]) : baseTeamBPlayers;
  if (targetReserve) nextReservePlayers[targetSide] = uniquePlayerIds([...nextReservePlayers[targetSide], playerId]);
  if (nextTeamAPlayers.length > sideCapacity || nextTeamBPlayers.length > sideCapacity) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "출전 이동 불가",
          body: "해당 사이드 출전 슬롯이 가득 찼습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (match.rules?.mmrBalancedSides === true) {
    const userById = Object.fromEntries((state.users ?? []).map((user) => [user.id, user]));
    const rangeMode = match.mmrRangeMode ?? match.rules?.mmrRangeMode;
    const currentBalance = getSideMmrBalance({
      teamA: match.teamA?.players ?? [],
      teamB: match.teamB?.players ?? [],
    }, userById, rangeMode);
    const nextBalance = getSideMmrBalance({ teamA: nextTeamAPlayers, teamB: nextTeamBPlayers }, userById, rangeMode);
    if (!isMmrBalanceTransitionAllowed(currentBalance, nextBalance)) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "MMR 균형 이동 불가",
          body: `평균 차이와 사이드 내부 MMR 폭은 ${nextBalance.limit} 이하여야 합니다.`,
          tone: "orange",
          matchId,
        }, ...state.notifications],
      };
    }
  }

  const movedMatch = {
    ...match,
    status: "agreed",
    teamA: { ...(match.teamA ?? {}), players: nextTeamAPlayers },
    teamB: { ...(match.teamB ?? {}), players: nextTeamBPlayers },
    reservePlayers: nextReservePlayers,
    parties: updateMatchPartiesForPlayer(match, playerId, targetSide, targetReserve),
    agreedAt: null,
    ...(pickupRoom ? {
      attendance: Object.fromEntries(MATCH_SIDES.map((sideName) => [
        sideName,
        uniquePlayerIds([
          ...(match.attendance?.[sideName] ?? []).filter((id) => id !== playerId),
          ...(sideName === targetSide && MATCH_SIDES.some((candidateSide) => (match.attendance?.[candidateSide] ?? []).includes(playerId)) ? [playerId] : []),
        ]),
      ])),
      agreements: Object.fromEntries(MATCH_SIDES.map((sideName) => [
        sideName,
        uniquePlayerIds([
          ...(match.agreements?.[sideName] ?? []).filter((id) => id !== playerId),
          ...(sideName === targetSide && MATCH_SIDES.some((candidateSide) => (match.agreements?.[candidateSide] ?? []).includes(playerId)) ? [playerId] : []),
        ]),
      ])),
      rules: {
        ...(match.rules ?? {}),
        sideAssignmentStatus: "draft",
        sideAssignmentConfirmedAt: null,
        sideAssignmentConfirmedBy: null,
      },
    } : {}),
  };
  const nextMatch = autoPromoteMatchReservesForCheckin(
    pickupRoom ? movedMatch : clearMatchPlayerDecision(movedMatch, playerId),
    targetReserve ? [playerId] : [],
  );

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
  };
}

export function removeMatchRoomPlayer(state, matchId, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!canEditMatchPreparation(state, match) || !playerId || playerId === state.currentUserId) return state;
  const placement = getMatchPlayerPlacement(match, playerId);
  if (!placement) return state;

  const nextReservePlayers = {
    teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
    teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
  };
  const nextMatch = autoPromoteMatchReservesForCheckin(clearMatchPlayerDecision({
    ...match,
    status: "agreed",
    teamA: { ...(match.teamA ?? {}), players: uniquePlayerIds(match.teamA?.players ?? []).filter((id) => id !== playerId) },
    teamB: { ...(match.teamB ?? {}), players: uniquePlayerIds(match.teamB?.players ?? []).filter((id) => id !== playerId) },
    reservePlayers: nextReservePlayers,
    parties: updateMatchPartiesForPlayer(match, playerId, placement.side, placement.reserve, true),
    agreedAt: null,
  }, playerId));

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "미출석 인원 강퇴",
        body: "경기준비방에서 미출석 인원을 정리했습니다.",
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}
