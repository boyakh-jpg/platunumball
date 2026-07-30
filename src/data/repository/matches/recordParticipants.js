import { getMatchOverlapConflict } from "../../../lib/matchUtils.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getTeamCaptainId } from "../../../lib/matchUtils.js";
import { getTeamMemberIds } from "../../teamMappers.js";
import { isMatchRecordMatch } from "../../../lib/matchUtils.js";
import { makeId } from "../../rowUtils.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { getMatchOverlapConflictBlockedState } from "../guards.js";

export function setMatchRecordParticipants(state, matchId, setup = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!isMatchRecordMatch(match) || match.createdBy !== state.currentUserId) return state;
  if (match.result || match.confirmedAt || match.cancelledAt || match.voidedAt || match.rules?.recordSetupReady === true) return state;

  const composition = match.rules?.recordComposition === "team" ? "team" : "individual";
  if (!["individual", "team"].includes(setup.composition)) return state;
  const requestedComposition = setup.composition;
  if (composition !== requestedComposition) return state;
  const sideCapacity = getRecruitingSideCapacity(match);
  const now = new Date().toISOString();
  let nextMatch = match;
  let targetIds = [];

  if (composition === "individual") {
    const knownUserIds = new Set((state.users ?? []).filter((user) => user?.id && !user.anonymous).map((user) => user.id));
    const teamAPlayerIds = uniquePlayerIds(setup.teamAPlayerIds).filter((playerId) => knownUserIds.has(playerId));
    const teamBPlayerIds = uniquePlayerIds(setup.teamBPlayerIds).filter((playerId) => knownUserIds.has(playerId));
    if (teamAPlayerIds.length !== sideCapacity || teamBPlayerIds.length !== sideCapacity) return state;
    if (!teamAPlayerIds.includes(state.currentUserId)) return state;
    if (teamAPlayerIds.some((playerId) => teamBPlayerIds.includes(playerId))) return state;
    targetIds = uniquePlayerIds([...teamAPlayerIds, ...teamBPlayerIds]);
    nextMatch = {
      ...match,
      teamA: { ...match.teamA, name: "A사이드", teamId: "", players: teamAPlayerIds, playerTeams: {} },
      teamB: { ...match.teamB, name: "B사이드", teamId: "", players: teamBPlayerIds, playerTeams: {} },
      playedPlayerIds: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
      reservePlayers: { teamA: [], teamB: [] },
      agreements: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
      approvals: { teamA: [], teamB: [] },
      rules: {
        ...(match.rules ?? {}),
        recordSetupReady: true,
        recordApprovalMode: { teamA: "all", teamB: "all" },
        recordApproverIds: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
        participantAcceptedIds: [],
        rosterReady: { teamA: true, teamB: true },
        playedPlayerIds: { teamA: teamAPlayerIds, teamB: teamBPlayerIds },
        reservePlayers: { teamA: [], teamB: [] },
      },
      updatedAt: now,
    };
  } else {
    const teamA = (state.teams ?? []).find((team) => team.id === setup.teamAId);
    const teamB = (state.teams ?? []).find((team) => team.id === setup.teamBId && team.id !== teamA?.id);
    if (!teamA || !teamB || !getTeamMemberIds(teamA).includes(state.currentUserId)) return state;
    const teamACaptainId = getTeamCaptainId(state.teams, teamA.id);
    const teamBCaptainId = getTeamCaptainId(state.teams, teamB.id);
    if (!teamACaptainId || !teamBCaptainId || teamACaptainId === teamBCaptainId) return state;
    targetIds = [teamACaptainId, teamBCaptainId];
    nextMatch = {
      ...match,
      teamA: { ...match.teamA, name: teamA.name, teamId: teamA.id, players: [teamACaptainId], playerTeams: { [teamACaptainId]: teamA.id } },
      teamB: { ...match.teamB, name: teamB.name, teamId: teamB.id, players: [teamBCaptainId], playerTeams: { [teamBCaptainId]: teamB.id } },
      playedPlayerIds: { teamA: [], teamB: [] },
      reservePlayers: { teamA: [], teamB: [] },
      agreements: { teamA: [teamACaptainId], teamB: [teamBCaptainId] },
      approvals: { teamA: [], teamB: [] },
      rules: {
        ...(match.rules ?? {}),
        recordSetupReady: false,
        recordApprovalMode: { teamA: "all", teamB: "all" },
        recordApproverIds: { teamA: [], teamB: [] },
        participantAcceptedIds: [],
        rosterReady: { teamA: false, teamB: false },
        playedPlayerIds: { teamA: [], teamB: [] },
        reservePlayers: { teamA: [], teamB: [] },
      },
      updatedAt: now,
    };
  }

  const notificationTitle = composition === "team" ? "팀 경기 기록 확인" : "경기 기록 확인 요청";
  const notificationBody = composition === "team"
    ? `${match.title} 경기 기록의 팀 명단을 확인해 주세요.`
    : `${match.title} 경기 기록에 참가자로 등록됐습니다. 기록 입력 후 최종 확인이 필요합니다.`;
  const notifications = targetIds
    .filter((playerId) => playerId && playerId !== state.currentUserId)
    .map((playerId) => ({
      id: makeId("n"),
      title: notificationTitle,
      body: notificationBody,
      tone: "match",
      type: "match_record_setup",
      actionRequired: true,
      homeAction: true,
      targetUserId: playerId,
      fromUserId: state.currentUserId,
      matchId,
      discordEvent: "match",
      webPath: `/app/recorder?match=${encodeURIComponent(matchId)}`,
      createdAt: now,
      updatedAt: now,
    }));

  const overlapConflict = getMatchOverlapConflict(nextMatch, state.matches);
  const overlapConflictState = getMatchOverlapConflictBlockedState(state, matchId, overlapConflict);
  if (overlapConflictState) return overlapConflictState;
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    notifications: [...notifications, ...(state.notifications ?? [])],
  };
}
