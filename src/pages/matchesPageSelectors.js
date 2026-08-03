import { uniquePlayerIds } from "../../shared/lib/playerIds.js";
import {
  getMatchHostPlayerId,
  getMatchReservePlayerIds,
  isMatchSideTeamParty,
  isPersonalRecordMatch,
} from "../lib/matchUtils.js";
import { MATCH_SIDES } from "../lib/constants.js";
import { getRecruitingLobby } from "../lib/recruiting.js";
import { getTeamCaptainMemberId as getTeamCaptainId } from "../data/teamMappers.js";

import { getRoomCapacity, getSideAgreementReady } from "./matchesPageBaseSelectors.js";
export { VIEWS, CHILD_VIEW_IDS, VIEW_IDS, PANEL_MODES, RELATION_FILTER_IDS, SCHEDULE_BRANCH_FILTERS, BRANCH_FILTER_IDS, AUTO_ROOM_TITLE_PREFIX_PATTERN, GENERIC_ROOM_TITLE_PATTERN, WEEKDAYS, tournamentFormatLabels, tournamentMmrLabels, tournamentStatusLabels, getSafeMatchSide, getExplicitMatchDate, getMatchDate, isInstantScheduleRoom, isExpiredInstantScheduleRoom, matchesRecruitingScheduleDate, hasAssignedTeamSchedule, getMonthKey, getSearchParamValue, isDateParam, isMonthParam, addMonths, shouldIncludeScheduleWindow, getCalendarDays, formatMonthLabel, formatDateLabel, formatTournamentWindow, compareSchedule, formatMatchTime, getMatchProcessMeta, shouldShowScoreBox, formatMatchRules, getRoomCardTitle, getWinner, getMatchActionLabel, shouldShowMatchForView, shouldShowMatchInList, isTournamentCaptainMatch, getMatchTeamIds, isMatchInUserTeamSchedule, getMatchScheduleRelation, getMatchTeamScheduleRelation, getRecruitingScheduleRelation, isRecruitingScheduleRelatedToUser, matchesScheduleRelation, getScheduleRoomKind, isScheduleRecordRoom, isScheduleTeamRoom, matchesScheduleBranch, getRecruitingRoomsForView, getScheduleItemsForView, getTournamentTeamRows, getRoomCapacity, getSideAgreementReady } from "./matchesPageBaseSelectors.js";

export function getMatchRoomPost(match, state) {
  if (!match) return null;
  const sourceMatch = match;
  const sourceState = state ?? {};
  const sourcePost = sourceMatch.recruitingPostId
    ? sourceState.recruitingPosts?.find((post) => post.id === sourceMatch.recruitingPostId)
    : null;
  const sourcePostLobby = sourcePost ? getRecruitingLobby(sourcePost, sourceState) : null;
  const tournamentRoom = Boolean(sourceMatch.tournamentId && !sourcePost);
  const tournamentReadySide = tournamentRoom
    ? MATCH_SIDES.find((sideName) => sourceMatch.rules?.rosterReady?.[sideName] === true) ?? ""
    : "";
  const configuredTournamentHostSide = MATCH_SIDES.includes(sourceMatch.rules?.tournamentHostSide)
    ? sourceMatch.rules.tournamentHostSide
    : "";
  const tournamentHostClaimed = Boolean(
    tournamentRoom && (sourceMatch.rules?.tournamentSideAssignmentLocked === true || tournamentReadySide),
  );
  const projectedTournamentHostSide = tournamentRoom
    ? configuredTournamentHostSide || tournamentReadySide || "teamA"
    : "";
  const projectedTournamentHostTeam = projectedTournamentHostSide
    ? sourceState.teams?.find((team) => team.id === sourceMatch[projectedTournamentHostSide]?.teamId) ?? null
    : null;
  const projectedTournamentCaptainId = projectedTournamentHostTeam
    ? getTeamCaptainId(projectedTournamentHostTeam)
    : "";
  const hostPlayerId = tournamentRoom
    ? (tournamentHostClaimed
        ? sourceMatch.rules?.tournamentHostPlayerId || projectedTournamentCaptainId
        : sourceMatch.rules?.tournamentProvisionalHostPlayerId || projectedTournamentCaptainId)
    : getMatchHostPlayerId(sourceMatch, sourcePost);
  const sideCapacity = getRoomCapacity(sourceMatch);
  const hasExplicitSideTeam = (sideName) => Boolean(sourceMatch[sideName]?.teamId);
  const explicitTeamRoom = MATCH_SIDES.some(hasExplicitSideTeam);
  const soloRecord = isPersonalRecordMatch(sourceMatch);
  const soloPlayedPlayerIds = sourceMatch.playedPlayerIds ?? sourceMatch.rules?.playedPlayerIds ?? {};
  const pickupAssignmentUsesMatchRoster = (
    (sourceMatch.formationMode ?? sourceMatch.rules?.formationMode) === "pickup"
    || (sourceMatch.matchIntent ?? sourceMatch.rules?.matchIntent) === "pickup"
  );
  const detailedMatchRosterAvailable = (
    Array.isArray(sourceMatch.teamA?.players)
    && Array.isArray(sourceMatch.teamB?.players)
  );
  const matchRosterIsAuthoritative = pickupAssignmentUsesMatchRoster || detailedMatchRosterAvailable;
  const sourceTeamAPlayers = uniquePlayerIds(soloRecord ? soloPlayedPlayerIds.teamA ?? [] : sourceMatch.teamA?.players ?? []);
  const sourceTeamBPlayers = uniquePlayerIds(soloRecord ? soloPlayedPlayerIds.teamB ?? [] : sourceMatch.teamB?.players ?? []);
  const fallbackTeamAPlayers = uniquePlayerIds(sourcePostLobby?.sides?.teamA?.projectedPlayers ?? []);
  const fallbackTeamBPlayers = uniquePlayerIds(sourcePostLobby?.sides?.teamB?.projectedPlayers ?? []);
  const teamAPlayers = matchRosterIsAuthoritative || sourceTeamAPlayers.length ? sourceTeamAPlayers : fallbackTeamAPlayers;
  const teamBPlayers = matchRosterIsAuthoritative || sourceTeamBPlayers.length ? sourceTeamBPlayers : fallbackTeamBPlayers;
  const sourceTeamAReserves = uniquePlayerIds(getMatchReservePlayerIds(sourceMatch, "teamA"));
  const sourceTeamBReserves = uniquePlayerIds(getMatchReservePlayerIds(sourceMatch, "teamB"));
  const fallbackTeamAReserves = uniquePlayerIds((sourcePostLobby?.sides?.teamA?.reserveCandidates ?? []).map((candidate) => candidate.playerId));
  const fallbackTeamBReserves = uniquePlayerIds((sourcePostLobby?.sides?.teamB?.reserveCandidates ?? []).map((candidate) => candidate.playerId));
  const teamAReserves = matchRosterIsAuthoritative || sourceTeamAReserves.length ? sourceTeamAReserves : fallbackTeamAReserves;
  const teamBReserves = matchRosterIsAuthoritative || sourceTeamBReserves.length ? sourceTeamBReserves : fallbackTeamBReserves;
  const assignedHostSide = MATCH_SIDES.find((sideName) => (
    sideName === "teamA"
      ? [...sourceTeamAPlayers, ...sourceTeamAReserves].includes(hostPlayerId)
      : [...sourceTeamBPlayers, ...sourceTeamBReserves].includes(hostPlayerId)
  )) ?? "";
  const applicants = [];
  const partyReserves = {};
  const matchParties = (pickupAssignmentUsesMatchRoster ? [] : match.parties ?? [])
    .map((party, index) => ({
      ...party,
      index,
      side: MATCH_SIDES.includes(party.side) ? party.side : "teamB",
      players: uniquePlayerIds(party.players ?? []),
      reserves: uniquePlayerIds(party.reserves ?? []),
    }))
    .filter((party) => party.teamId
      ? Boolean(party.playerId || party.players.length || party.reserves.length)
      : Boolean(party.players.length || party.reserves.length || party.playerId));
  const partyHasHost = (party) => (
    party.playerId === hostPlayerId ||
    party.players.includes(hostPlayerId) ||
    party.reserves.includes(hostPlayerId)
  );
  const hostParty = matchParties.find(partyHasHost) ?? matchParties.find((party) => party.side === "teamA") ?? null;
  const hostSide = tournamentRoom
    ? projectedTournamentHostSide || "teamA"
    : assignedHostSide || hostParty?.side || "teamA";
  const hostReserve = assignedHostSide
    ? (assignedHostSide === "teamA" ? sourceTeamAReserves : sourceTeamBReserves).includes(hostPlayerId)
    : Boolean(hostParty?.reserves.includes(hostPlayerId) || sourcePost?.roomState?.hostReserve);
  const hostJoinMode = tournamentRoom
    ? (hasExplicitSideTeam(hostSide) ? "team" : "player")
    : (hostParty?.teamId || hasExplicitSideTeam(hostSide) || isMatchSideTeamParty(match, hostSide) ? "team" : "player");
  const hostTeamId = hostJoinMode === "team" ? (hostParty?.teamId ?? match[hostSide]?.teamId ?? null) : null;
  const hostPlayers = hostJoinMode === "team"
    ? uniquePlayerIds(hostParty?.players?.length ? hostParty.players : match[hostSide]?.players ?? [])
    : [hostPlayerId].filter(Boolean);
  const pushPlayerApplicant = (playerId, side, reserve = false, status = "ready") => {
    if (!playerId || playerId === hostPlayerId) return;
    applicants.push({
      kind: "player",
      joinMode: "player",
      playerId,
      side,
      status,
      reserve,
      createdAt: match.createdAt,
      updatedAt: match.createdAt,
    });
  };

  if (matchParties.length) {
    matchParties.forEach((party) => {
      const isHostParty = party === hostParty;
      const sideReady = getSideAgreementReady(match, party.side) ? "ready" : "waiting";
      if (isHostParty) {
        if (party.teamId) partyReserves.host = party.reserves;
        else {
          party.players.forEach((playerId) => pushPlayerApplicant(playerId, party.side, false, sideReady));
          party.reserves.forEach((playerId) => pushPlayerApplicant(playerId, party.side, true));
        }
        return;
      }

      if (party.teamId) {
        const reserveKey = `team:${party.teamId}`;
        applicants.push({
          kind: "team",
          joinMode: "team",
          teamId: party.teamId,
          playerId: party.playerId ?? party.players[0] ?? party.reserves[0] ?? null,
          playerIds: party.players,
          side: party.side,
          status: sideReady,
          reserve: Boolean(party.reserve && !party.players.length),
          createdAt: match.createdAt,
          updatedAt: match.createdAt,
        });
        partyReserves[reserveKey] = party.reserves;
        return;
      }

      party.players.forEach((playerId) => pushPlayerApplicant(playerId, party.side, false, sideReady));
      party.reserves.forEach((playerId) => pushPlayerApplicant(playerId, party.side, true));
    });
  } else if (hostJoinMode === "player") {
    const hostSidePlayers = hostSide === "teamA" ? teamAPlayers : teamBPlayers;
    const hostSideReserves = hostSide === "teamA" ? teamAReserves : teamBReserves;
    hostSidePlayers
      .filter((playerId) => playerId !== hostPlayerId)
      .forEach((playerId) => {
        applicants.push({
          kind: "player",
          joinMode: "player",
          playerId,
          side: hostSide,
          status: getSideAgreementReady(match, hostSide) ? "ready" : "waiting",
          reserve: false,
          createdAt: match.createdAt,
          updatedAt: match.createdAt,
        });
      });
    hostSideReserves.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: hostSide,
        status: "ready",
        reserve: true,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
  } else {
    partyReserves.host = hostSide === "teamA" ? teamAReserves : teamBReserves;
  }

  const opponentSide = hostSide === "teamA" ? "teamB" : "teamA";
  const opponentPlayers = opponentSide === "teamA" ? teamAPlayers : teamBPlayers;
  const opponentReserves = opponentSide === "teamA" ? teamAReserves : teamBReserves;
  const opponentTeam = sourceState.teams?.find((team) => team.id === match[opponentSide]?.teamId) ?? null;
  if (!matchParties.length && (hasExplicitSideTeam(opponentSide) || isMatchSideTeamParty(match, opponentSide))) {
    applicants.push({
      kind: "team",
      joinMode: "team",
      teamId: match[opponentSide]?.teamId,
      playerId: getTeamCaptainId(opponentTeam) ?? opponentPlayers[0] ?? null,
      playerIds: opponentPlayers,
      side: opponentSide,
      status: getSideAgreementReady(match, opponentSide) ? "ready" : "waiting",
      reserve: false,
      createdAt: match.createdAt,
      updatedAt: match.createdAt,
    });
    partyReserves[`team:${match[opponentSide]?.teamId}`] = opponentReserves;
  } else if (!matchParties.length) {
    opponentPlayers.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: opponentSide,
        status: getSideAgreementReady(match, opponentSide) ? "ready" : "waiting",
        reserve: false,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
    opponentReserves.forEach((playerId) => {
      applicants.push({
        kind: "player",
        joinMode: "player",
        playerId,
        side: opponentSide,
        status: "ready",
        reserve: true,
        createdAt: match.createdAt,
        updatedAt: match.createdAt,
      });
    });
  }

  if (matchParties.length) {
    const representedPlayerIds = new Set([hostPlayerId, ...hostPlayers].filter(Boolean));
    applicants.forEach((applicant) => {
      if (applicant.playerId) representedPlayerIds.add(applicant.playerId);
      (applicant.playerIds ?? []).forEach((playerId) => representedPlayerIds.add(playerId));
    });
    Object.values(partyReserves).flat().forEach((playerId) => representedPlayerIds.add(playerId));
    teamAPlayers.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamA", false, getSideAgreementReady(match, "teamA") ? "ready" : "waiting"));
    teamAReserves.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamA", true));
    teamBPlayers.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamB", false, getSideAgreementReady(match, "teamB") ? "ready" : "waiting"));
    teamBReserves.filter((playerId) => !representedPlayerIds.has(playerId)).forEach((playerId) => pushPlayerApplicant(playerId, "teamB", true));
  }

  const baseRoomState = {
    ...(sourcePost?.roomState ?? {}),
    ruleRevision: sourcePost?.roomState?.ruleRevision ?? 1,
    matchRosterProjection: true,
    hostReserve,
    partyReserves,
    pinnedReservePlayers: {
      ...(sourcePost?.roomState?.pinnedReservePlayers ?? {}),
      teamA: teamAReserves,
      teamB: teamBReserves,
    },
  };

  if (sourcePost) {
    return {
      ...sourcePost,
      status: "open",
      title: match.title ?? sourcePost.title,
      tournamentId: match.tournamentId ?? sourcePost.tournamentId,
      mode: match.mode ?? sourcePost.mode,
      court: match.court ?? sourcePost.court,
      scheduledDate: match.scheduledDate ?? sourcePost.scheduledDate,
      scheduledTime: match.scheduledTime ?? sourcePost.scheduledTime,
      scheduledAt: match.scheduledAt ?? sourcePost.scheduledAt,
      timingType: match.timingType ?? sourcePost.timingType ?? match.rules?.timingType ?? sourcePost.roomState?.timingType ?? "scheduled",
      ranked: match.ranked ?? sourcePost.ranked,
      official: match.official ?? sourcePost.official,
      preRegistered: match.preRegistered ?? sourcePost.preRegistered,
      refereeId: match.refereeId ?? sourcePost.refereeId ?? "",
      refereeTrustMin: match.refereeTrustMin ?? sourcePost.refereeTrustMin,
      sideCapacity,
      hostSide,
      hostJoinMode,
      hostReady: getSideAgreementReady(match, hostSide),
      teamOnly: Boolean(sourcePost.teamOnly || explicitTeamRoom),
      teamId: hostTeamId,
      playerId: hostPlayerId,
      playerIds: hostPlayers,
      applicants,
      rules: { ...(sourcePost.rules ?? {}), ...(match.rules ?? {}) },
      memo: match.memo ?? sourcePost.memo,
      stakes: match.stakes ?? sourcePost.stakes,
      visibility: sourcePost.visibility ?? "public",
      ownerId: hostPlayerId,
      roomState: { ...baseRoomState, ownerId: hostPlayerId },
    };
  }

  return {
    id: match.recruitingPostId || `match-room-${match.id}`,
    title: match.title,
    tournamentId: match.tournamentId,
    type: "need_player",
    mode: match.mode,
    court: match.court,
    scheduledDate: match.scheduledDate ?? "",
    scheduledTime: match.scheduledTime ?? "",
    scheduledAt: match.scheduledAt,
    timingType: match.timingType ?? match.rules?.timingType ?? "scheduled",
    status: "open",
    visibility: match.tournamentId ? "private" : match.recruitingPostId ? "public" : "private",
    ranked: match.ranked !== false,
    official: Boolean(match.official),
    preRegistered: Boolean(match.preRegistered),
    refereeId: match.refereeId ?? "",
    refereeTrustMin: match.refereeTrustMin,
    hostSide,
    hostJoinMode,
    hostReady: getSideAgreementReady(match, hostSide),
    teamOnly: explicitTeamRoom,
    ownerId: hostPlayerId,
    playerId: hostPlayerId,
    teamId: hostTeamId,
    playerIds: hostPlayers,
    sideCapacity,
    mmrRangeMode: match.mmrRangeMode ?? match.rules?.mmrRangeMode ?? "narrow",
    ratingScale: match.ratingScale ?? match.rules?.ratingScale ?? 1,
    rules: { ...(match.rules ?? {}), timingType: match.timingType ?? match.rules?.timingType ?? "scheduled" },
    memo: match.memo ?? match.stakes ?? "",
    stakes: match.stakes ?? "",
    applicants,
    roomState: {
      ...baseRoomState,
      ownerId: hostPlayerId,
      timingType: match.timingType ?? match.rules?.timingType ?? "scheduled",
      partyReserves,
      chatMessages: [],
      invitations: [],
    },
    createdAt: match.createdAt,
  };
}
