import { MATCH_SIDES } from "../../../lib/constants.js";
import {
  clearMatchPlayerDecision,
  getMatchParticipationCancellationPenalty,
  getMatchParticipationCancellationState,
  getMatchReservePlayerIds,
  updateMatchPartiesForPlayer,
} from "../../../lib/matchUtils.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { makeId, uniquePlayerIds } from "../../rowUtils.js";
import { autoPromoteMatchReservesForCheckin } from "./roster.js";

export function cancelMatchParticipation(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  const cancellation = getMatchParticipationCancellationState(match, state.currentUserId);
  const safeReason = String(reason).trim();
  if (!cancellation.allowed || safeReason.length < 5 || safeReason.length > 200) return state;

  const playerId = state.currentUserId;
  const cancelledAt = new Date().toISOString();
  const sideCapacity = getRecruitingSideCapacity(match);
  const penalty = getMatchParticipationCancellationPenalty(
    match,
    state.settings?.ratingPolicy?.trust,
  );
  const withoutPlayer = clearMatchPlayerDecision({
    ...match,
    status: "agreed",
    teamA: {
      ...(match.teamA ?? {}),
      players: uniquePlayerIds(match.teamA?.players ?? []).filter((id) => id !== playerId),
    },
    teamB: {
      ...(match.teamB ?? {}),
      players: uniquePlayerIds(match.teamB?.players ?? []).filter((id) => id !== playerId),
    },
    reservePlayers: {
      teamA: getMatchReservePlayerIds(match, "teamA").filter((id) => id !== playerId),
      teamB: getMatchReservePlayerIds(match, "teamB").filter((id) => id !== playerId),
    },
    parties: updateMatchPartiesForPlayer(match, playerId, cancellation.side, cancellation.reserve, true),
    agreedAt: null,
  }, playerId);
  const promotedMatch = autoPromoteMatchReservesForCheckin(withoutPlayer, [playerId]);
  const shortageSides = MATCH_SIDES.filter((sideName) => (
    uniquePlayerIds(promotedMatch[sideName]?.players ?? []).length < sideCapacity
  ));
  const pickupRoom = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  const notificationTargetIds = uniquePlayerIds([
    playerId,
    match.createdBy,
    match.refereeId,
    ...(promotedMatch[cancellation.side]?.players ?? []),
    ...getMatchReservePlayerIds(promotedMatch, cancellation.side),
  ]);
  const nextMatch = {
    ...promotedMatch,
    rules: {
      ...(promotedMatch.rules ?? {}),
      parties: promotedMatch.parties ?? [],
      rosterNeedsFill: shortageSides.length > 0,
      rosterNeedsFillSides: shortageSides,
      participationCancelledIds: uniquePlayerIds([
        ...(promotedMatch.rules?.participationCancelledIds ?? []),
        playerId,
      ]),
      ruleAcknowledgedIds: uniquePlayerIds(promotedMatch.rules?.ruleAcknowledgedIds ?? [])
        .filter((id) => id !== playerId),
      lastParticipationCancellation: {
        playerId,
        side: cancellation.side,
        reason: safeReason,
        trustPenalty: penalty,
        cancelledAt,
      },
      ...(pickupRoom ? {
        sideAssignmentStatus: "draft",
        sideAssignmentConfirmedAt: null,
        sideAssignmentConfirmedBy: null,
      } : {}),
    },
  };

  return {
    ...state,
    users: penalty > 0 ? state.users.map((user) => (
      user.id === playerId
        ? { ...user, trustScore: Math.max(0, Number(user.trustScore ?? 80) - penalty) }
        : user
    )) : state.users,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      ...notificationTargetIds.map((targetUserId) => ({
        id: makeId("n"),
        targetUserId,
        title: targetUserId === playerId ? "참가 취소 완료" : "확정 경기 참가 취소",
        body: targetUserId === playerId
          ? penalty > 0
            ? `확정 경기 참가를 취소해 신뢰도 ${penalty}점이 감소했습니다.`
            : "확정 경기 참가를 취소했습니다."
          : shortageSides.length
            ? "참가자가 빠져 출전 인원 보충이 필요합니다."
            : "참가자가 취소했습니다. 변경된 명단을 확인해 주세요.",
        tone: shortageSides.length || targetUserId === playerId ? "orange" : "match",
        matchId,
      })),
      ...state.notifications,
    ],
  };
}
