import { MATCH_SIDES } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { adjustUserTrust } from "../../trustUtils.js";
import { buildPickupTeamAssignment } from "../../../lib/roomFlow.js";
import { getMatchAttendance } from "../../../lib/matchUtils.js";
import { getMatchPlayerPlacement } from "../../../lib/matchUtils.js";
import { getMatchReservePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchRoomPhase } from "../../../lib/matchUtils.js";
import { getMatchSidePlayerIds } from "../../../lib/matchUtils.js";
import { getMissingMatchAttendance } from "../../../lib/matchUtils.js";
import { getPickupRerollState } from "../../../lib/roomFlow.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { makeId } from "../../rowUtils.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { canEditMatchPreparation, currentUserCanStartMatch } from "../matchAccess.js";
import { getServerRatingValue } from "../runtime.js";

export function confirmPickupSideAssignment(state, matchId, rotation = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  if (!currentUserCanStartMatch(state, match)) return state;
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  if (!pickup || getMissingMatchAttendance(match).length) return state;
  if (match.rules?.sideAssignmentStatus !== "draft"
    || Number(match.rules?.sideAssignmentRevision ?? 0) < 1) return state;
  const sideCapacity = getRecruitingSideCapacity(match);
  if (getMatchSidePlayerIds(match, "teamA").length !== sideCapacity || getMatchSidePlayerIds(match, "teamB").length !== sideCapacity) return state;
  const rotationMode = ["period", "interval", "manual"].includes(rotation.rotationMode)
    ? rotation.rotationMode
    : "manual";
  const rotationIntervalMinutes = [3, 5, 7, 10].includes(Number(rotation.rotationIntervalMinutes))
    ? Number(rotation.rotationIntervalMinutes)
    : 5;
  const nextMatch = {
    ...match,
    rules: {
      ...(match.rules ?? {}),
      sideAssignmentStatus: "confirmed",
      sideAssignmentConfirmedAt: new Date().toISOString(),
      sideAssignmentConfirmedBy: state.currentUserId,
      rotationMode,
      rotationIntervalMinutes: rotationMode === "interval" ? rotationIntervalMinutes : undefined,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
  };
}

export function generatePickupSideAssignment(state, matchId, assignmentMode = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  const safeMode = ["manual", "random", "mmr_balanced"].includes(assignmentMode)
    ? assignmentMode
    : "manual";
  if (!pickup) return state;

  const attendance = getMatchAttendance(match);
  const playerIds = uniquePlayerIds(MATCH_SIDES.flatMap((sideName) => attendance[sideName] ?? []));
  const sideCapacity = getRecruitingSideCapacity(match);
  const benchCapacity = getRecruitingBenchCapacity(match);
  if (playerIds.length < sideCapacity * 2 || playerIds.length > (sideCapacity + benchCapacity) * 2) return state;

  const assignmentRevision = Number(match.rules?.sideAssignmentRevision ?? 0);
  const operator = currentUserCanStartMatch(state, match);
  const currentUserAttended = playerIds.includes(state.currentUserId);
  const reroll = assignmentRevision > 0 && safeMode !== "manual";
  const rerollState = getPickupRerollState(match, state.currentUserId);
  if (!reroll && !operator) return state;
  if (reroll && (!operator && !currentUserAttended || rerollState.count >= rerollState.limit || rerollState.usedByCurrentUser)) return state;
  const currentUser = state.users.find((user) => user.id === state.currentUserId);
  if (reroll && Number(currentUser?.trustScore ?? 0) < 1) return state;

  const assignment = buildPickupTeamAssignment({
    playerIds,
    users: state.users,
    sideCapacity,
    benchCapacity,
    mode: safeMode,
    seed: `${matchId}:${assignmentRevision}:${playerIds.join(",")}`,
    hostPlayerId: match.createdBy,
  });
  if (!assignment || assignment.teamA.active.length !== sideCapacity
    || assignment.teamB.active.length !== sideCapacity) return state;

  const agreedIds = new Set([
    ...(match.agreements?.teamA ?? []),
    ...(match.agreements?.teamB ?? []),
  ]);
  const nextAgreements = Object.fromEntries(MATCH_SIDES.map((sideName) => [
    sideName,
    [...assignment[sideName].active, ...assignment[sideName].reserve].filter((playerId) => agreedIds.has(playerId)),
  ]));
  const nextAttendance = Object.fromEntries(MATCH_SIDES.map((sideName) => [
    sideName,
    uniquePlayerIds([...assignment[sideName].active, ...assignment[sideName].reserve]),
  ]));
  const generatedAt = new Date().toISOString();
  const pickupRerollUserIds = reroll
    ? [...rerollState.usedByIds, state.currentUserId]
    : rerollState.usedByIds;
  const pickupRerollCount = reroll ? rerollState.count + 1 : rerollState.count;
  const mmrRangeRatingScale = Number(
    match.rules?.mmrRangeRatingScale
      ?? match.ratingScale
      ?? match.rules?.ratingScale
      ?? 1,
  );
  const pickupAssignmentRatingScale = getServerRatingValue("getPickupTeamAssignmentRatingScale", safeMode);
  const ratingScale = match.ranked === false
    ? 0
    : mmrRangeRatingScale * pickupAssignmentRatingScale;
  const nextMatch = {
    ...match,
    teamA: { ...(match.teamA ?? {}), name: SIDE_LABEL_TEXT.teamA, teamId: null, playerTeams: {}, players: assignment.teamA.active },
    teamB: { ...(match.teamB ?? {}), name: SIDE_LABEL_TEXT.teamB, teamId: null, playerTeams: {}, players: assignment.teamB.active },
    reservePlayers: { teamA: assignment.teamA.reserve, teamB: assignment.teamB.reserve },
    attendance: nextAttendance,
    agreements: nextAgreements,
    approvals: { teamA: [], teamB: [] },
    parties: [],
    rules: {
      ...(match.rules ?? {}),
      pickupTeamAssignmentMode: safeMode,
      sideAssignmentStatus: "draft",
      sideAssignmentGeneratedAt: generatedAt,
      sideAssignmentGeneratedBy: state.currentUserId,
      sideAssignmentRevision: assignmentRevision + 1,
      sideAssignmentConfirmedAt: null,
      sideAssignmentConfirmedBy: null,
      pickupRerollUserIds,
      pickupRerollCount,
      mmrRangeRatingScale,
      pickupAssignmentRatingScale,
      ratingScale,
    },
    ratingScale,
    agreedAt: null,
  };
  const rerollMessage = reroll ? {
    id: makeId("chat"),
    userId: state.currentUserId,
    body: `${currentUser?.name ?? "참가자"}님이 신뢰도 1점을 사용해 ${safeMode === "random" ? "랜덤" : "MMR 균형"} 배치를 다시 돌렸습니다.`,
    createdAt: generatedAt,
  } : null;
  return {
    ...state,
    users: reroll ? adjustUserTrust(state.users, state.currentUserId, -1) : state.users,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    recruitingPosts: rerollMessage && (match.recruitingPostId || match.rules?.recruitingPostId)
      ? (state.recruitingPosts ?? []).map((post) => {
          if (post.id !== (match.recruitingPostId || match.rules?.recruitingPostId)) return post;
          const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
          return { ...post, roomState: { ...roomState, chatMessages: [...roomState.chatMessages, rerollMessage] } };
        })
      : state.recruitingPosts,
  };
}

export function swapPickupMatchPlayers(state, matchId, firstPlayerId, secondPlayerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !firstPlayerId || !secondPlayerId || firstPlayerId === secondPlayerId) return state;
  if (!canEditMatchPreparation(state, match) || getMatchRoomPhase(match).phase !== "checkin") return state;
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  if (!pickup
    || match.rules?.sideAssignmentStatus !== "draft"
    || Number(match.rules?.sideAssignmentRevision ?? 0) < 1) return state;

  const firstPlacement = getMatchPlayerPlacement(match, firstPlayerId);
  const secondPlacement = getMatchPlayerPlacement(match, secondPlayerId);
  if (!firstPlacement || !secondPlacement || firstPlacement.side === secondPlacement.side) return state;

  const swapIds = (playerIds = []) => uniquePlayerIds(playerIds.map((playerId) => (
    playerId === firstPlayerId
      ? secondPlayerId
      : playerId === secondPlayerId
        ? firstPlayerId
        : playerId
  )));
  const firstAttended = MATCH_SIDES.some((sideName) => getMatchAttendance(match)[sideName].includes(firstPlayerId));
  const secondAttended = MATCH_SIDES.some((sideName) => getMatchAttendance(match)[sideName].includes(secondPlayerId));
  const nextAttendance = Object.fromEntries(MATCH_SIDES.map((sideName) => {
    const existingIds = getMatchAttendance(match)[sideName].filter((playerId) => (
      playerId !== firstPlayerId && playerId !== secondPlayerId
    ));
    return [sideName, uniquePlayerIds([
      ...existingIds,
      ...(firstAttended && secondPlacement.side === sideName ? [firstPlayerId] : []),
      ...(secondAttended && firstPlacement.side === sideName ? [secondPlayerId] : []),
    ])];
  }));
  const nextAgreements = Object.fromEntries(MATCH_SIDES.map((sideName) => {
    const existingIds = (match.agreements?.[sideName] ?? []).filter((playerId) => (
      playerId !== firstPlayerId && playerId !== secondPlayerId
    ));
    const firstAgreed = MATCH_SIDES.some((candidateSide) => (match.agreements?.[candidateSide] ?? []).includes(firstPlayerId));
    const secondAgreed = MATCH_SIDES.some((candidateSide) => (match.agreements?.[candidateSide] ?? []).includes(secondPlayerId));
    return [sideName, uniquePlayerIds([
      ...existingIds,
      ...(firstAgreed && secondPlacement.side === sideName ? [firstPlayerId] : []),
      ...(secondAgreed && firstPlacement.side === sideName ? [secondPlayerId] : []),
    ])];
  }));

  const nextMatch = {
    ...match,
    teamA: {
      ...(match.teamA ?? {}),
      name: SIDE_LABEL_TEXT.teamA,
      teamId: null,
      playerTeams: {},
      players: swapIds(match.teamA?.players ?? []),
    },
    teamB: {
      ...(match.teamB ?? {}),
      name: SIDE_LABEL_TEXT.teamB,
      teamId: null,
      playerTeams: {},
      players: swapIds(match.teamB?.players ?? []),
    },
    reservePlayers: {
      teamA: swapIds(getMatchReservePlayerIds(match, "teamA")),
      teamB: swapIds(getMatchReservePlayerIds(match, "teamB")),
    },
    attendance: nextAttendance,
    agreements: nextAgreements,
    approvals: { teamA: [], teamB: [] },
    parties: [],
    rules: {
      ...(match.rules ?? {}),
      sideAssignmentStatus: "draft",
      sideAssignmentConfirmedAt: null,
      sideAssignmentConfirmedBy: null,
    },
    agreedAt: null,
  };

  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
  };
}
