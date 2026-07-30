import { MATCH_SIDES } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { getMatchOverlapConflict } from "../../../lib/matchUtils.js";
import { getMatchReservePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchRoomPhase } from "../../../lib/matchUtils.js";
import { getMatchRosterSwapPatch } from "../../../lib/matchUtils.js";
import { getMatchScoreEditableSides } from "../../../lib/matchUtils.js";
import { getMatchSubstitutionAccess } from "../../../lib/matchUtils.js";
import { isMatchLateAttendancePlayer } from "../../../lib/matchUtils.js";
import { isMatchRecordMatch } from "../../../lib/matchUtils.js";
import { makeId } from "../../rowUtils.js";
import { getMatchOverlapConflictBlockedState } from "../guards.js";
import { finalizeMatch } from "../lifecycle.js";
import {
  currentUserCanOperateStartedMatch,
  currentUserIsEligibleMatchReferee,
  currentUserIsMatchHost,
} from "../matchAccess.js";

export function substituteMatchPlayer(state, matchId, sideName, activePlayerId, reservePlayerId, reason = "operator") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "agreed" || match.endedAt) return state;
  if (getMatchRoomPhase(match).phase !== "live") return state;
  if (!MATCH_SIDES.includes(sideName)) return state;
  if (!["self", "late", "ejection", "operator"].includes(reason)) return state;
  const substitutionAccess = getMatchSubstitutionAccess(match, state.currentUserId, sideName, {
    canOperate: currentUserIsEligibleMatchReferee(state, match),
  });
  if (!substitutionAccess.allowedReservePlayerIds.includes(reservePlayerId)) return state;
  if (!substitutionAccess.canManage && (!substitutionAccess.canSelfSubstitute || reason !== "self")) return state;
  if (reason === "late" && !isMatchLateAttendancePlayer(match, reservePlayerId)) return state;
  const finalReason = reason === "self" && isMatchLateAttendancePlayer(match, reservePlayerId) ? "late" : reason;

  const activeIds = match[sideName]?.players ?? [];
  const reserveIds = getMatchReservePlayerIds(match, sideName);
  if (!activeIds.includes(activePlayerId) || !reserveIds.includes(reservePlayerId)) return state;

  const substitutionPatch = getMatchRosterSwapPatch(match, sideName, activePlayerId, reservePlayerId);
  if (!substitutionPatch.valid || !substitutionPatch.swapped) return state;
  const now = new Date().toISOString();
  const substitutionEvent = {
    id: makeId("substitution"),
    side: sideName,
    activeOutPlayerId: activePlayerId,
    activeInPlayerId: reservePlayerId,
    reason: finalReason,
    confirmedBy: state.currentUserId,
    createdAt: now,
  };
  const nextMatch = {
    ...substitutionPatch.match,
    rules: {
      ...(substitutionPatch.match.rules ?? {}),
      lastSubstitutionAt: now,
    },
    substitutionEvents: [substitutionEvent, ...(substitutionPatch.match.substitutionEvents ?? [])],
  };

  const activeUser = state.users.find((user) => user.id === activePlayerId);
  const reserveUser = state.users.find((user) => user.id === reservePlayerId);

  return {
    ...state,
    matches: state.matches.map((item) => (
      item.id === matchId
        ? nextMatch
        : item
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "선수 교체",
        body: `${match.title} ${SIDE_LABEL_TEXT[sideName]}에서 ${reserveUser?.name ?? "후보 선수"} 선수가 출전 명단으로, ${activeUser?.name ?? "출전 선수"} 선수가 후보 명단으로 이동했습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}
export function incrementMatchScore(state, matchId, deltaA = 0, deltaB = 0, revisions = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !match.startedAt || match.confirmedAt || !Number.isInteger(deltaA) || !Number.isInteger(deltaB)) return state;
  if ((!deltaA && !deltaB) || Math.abs(deltaA) > 3 || Math.abs(deltaB) > 3) return state;
  const canOperate = currentUserCanOperateStartedMatch(state, match);
  const live = !match.endedAt && match.status === "agreed";
  const sharedRecordEntry = Boolean(
    match.endedAt &&
    isMatchRecordMatch(match) &&
    match.rules?.recordSetupReady === true &&
    match.status === "agreed" &&
    canOperate,
  );
  const refereePostgame = Boolean(
    match.endedAt &&
    ["agreed", "approval"].includes(match.status) &&
    currentUserIsEligibleMatchReferee(state, match),
  );
  if (!live && !sharedRecordEntry && !refereePostgame) return state;
  const editableSides = getMatchScoreEditableSides(match, state.currentUserId, {
    canOperatePostStart: canOperate,
    clockController: revisions.clockController === true,
  });
  if ((deltaA && !editableSides.includes("teamA")) || (deltaB && !editableSides.includes("teamB"))) return state;
  const result = match.result ?? { playerStats: {}, statSubmissions: {}, scoreSubmissions: {} };
  const revisionA = Number(result.scoreRevisionA ?? 0);
  const revisionB = Number(result.scoreRevisionB ?? 0);
  if (deltaA && (revisions.expectedRevisionA == null || Number(revisions.expectedRevisionA) !== revisionA)) return state;
  if (deltaB && (revisions.expectedRevisionB == null || Number(revisions.expectedRevisionB) !== revisionB)) return state;
  const scoreA = Number(result.scoreA ?? match.teamA?.score ?? 0) + deltaA;
  const scoreB = Number(result.scoreB ?? match.teamB?.score ?? 0) + deltaB;
  if (scoreA < 0 || scoreB < 0 || scoreA > 999 || scoreB > 999) return state;
  const now = new Date().toISOString();
  const nextResult = {
    ...result,
    scoreA,
    scoreB,
    playerStats: match.refereeId ? result.playerStats ?? {} : {},
    statSubmissions: match.refereeId ? result.statSubmissions ?? {} : {},
    scoreRevisionA: revisionA + (deltaA ? 1 : 0),
    scoreRevisionB: revisionB + (deltaB ? 1 : 0),
    submittedBy: state.currentUserId,
    submittedAt: now,
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? {
      ...item,
      teamA: { ...item.teamA, score: scoreA },
      teamB: { ...item.teamB, score: scoreB },
      result: nextResult,
      updatedAt: now,
    } : item),
  };
}
export function finalizeMatchByAuthority(state, matchId, options = {}) {
  const match = state.matches.find((item) => item.id === matchId);
  if (isMatchRecordMatch(match)) return state;
  if (!match?.endedAt || !match.result || match.confirmedAt || match.status === "disputed") return state;
  if (options.disputesAcknowledged !== true) return state;
  const submittedAtMs = new Date(match.result?.submittedAt ?? match.endedAt).getTime();
  const nowMs = new Date(options.now ?? Date.now()).getTime();
  if (!Number.isFinite(submittedAtMs) || !Number.isFinite(nowMs) || nowMs < submittedAtMs + (3 * 60 * 1000)) return state;
  const canFinalize = match.refereeId
    ? currentUserIsEligibleMatchReferee(state, match)
    : currentUserIsMatchHost(state, match);
  if (!canFinalize || (match.disputes ?? []).some((dispute) => dispute.status === "open")) return state;
  const overlapConflict = getMatchOverlapConflict(match, state.matches);
  const overlapConflictState = getMatchOverlapConflictBlockedState(state, matchId, overlapConflict);
  if (overlapConflictState) return overlapConflictState;
  const baseResult = match.result ?? {
    scoreA: Number(match.teamA?.score ?? 0),
    scoreB: Number(match.teamB?.score ?? 0),
    submittedBy: state.currentUserId,
    submittedAt: new Date().toISOString(),
  };
  const result = match.refereeId ? baseResult : { ...baseResult, playerStats: {}, statSubmissions: {} };
  return finalizeMatch(state, {
    ...match,
    result,
    finalizedBy: state.currentUserId,
    rules: {
      ...(match.rules ?? {}),
      manualFinalizationAudit: {
        actor: state.currentUserId,
        finalizedAt: new Date(nowMs).toISOString(),
        disputesAcknowledged: true,
        openDisputeCount: 0,
      },
    },
  });
}
