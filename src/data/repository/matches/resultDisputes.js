import { clone } from "../../rowUtils.js";
import { getActualMatchPlayerIds } from "../../../lib/matchUtils.js";
import { getMatchRecordWindow } from "../../../lib/matchUtils.js";
import { getMatchResultRevision } from "../../../lib/matchUtils.js";
import { getMergedResultScore } from "../../../lib/matchUtils.js";
import { makeId } from "../../rowUtils.js";
import { makeUuid } from "../../rowUtils.js";
import { normalizeDisputeRequest } from "../../../lib/matchUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { normalizePlayerStats } from "../../../lib/matchUtils.js";
import { normalizePlayerStatsDisputeRequest } from "../../../lib/matchUtils.js";
import { normalizeTeamScoresDisputeRequest } from "../../../lib/matchUtils.js";
import { getDisciplineBlockedState } from "../guards.js";
import { currentUserCanFileMatchDispute, currentUserCanResolveMatchDispute } from "../matchAccess.js";

function applyDisputeRequestToResult(match = {}, baseResult = null, disputeRequest = {}) {
  const nextResult = clone(baseResult ?? match.disputeDraftResult ?? match.result);
  const nextRevision = getMatchResultRevision({ result: nextResult }) + 1;
  if (disputeRequest.kind === "team_scores") {
    const normalized = normalizeTeamScoresDisputeRequest(disputeRequest);
    if (!nextResult || !normalized) return nextResult;
    return {
      ...nextResult,
      scoreA: normalized.requestedScoreA,
      scoreB: normalized.requestedScoreB,
      revision: nextRevision,
      periodScores: [],
      playerStats: {},
      statSubmissions: {},
      updatedAt: new Date().toISOString(),
    };
  }
  const normalized = normalizePlayerStatsDisputeRequest(disputeRequest);
  if (!nextResult || !normalized || !getActualMatchPlayerIds(match).includes(normalized.playerId)) return nextResult;
  const playerStats = normalizePlayerStats(nextResult.playerStats ?? {}, getActualMatchPlayerIds(match));
  playerStats[normalized.playerId] = normalized.requestedStats;
  const scoreA = getMergedResultScore(match, playerStats, "teamA", nextResult.scoreA);
  const scoreB = getMergedResultScore(match, playerStats, "teamB", nextResult.scoreB);
  return {
    ...nextResult,
    scoreA,
    scoreB,
    revision: nextRevision,
    periodScores: scoreA === nextResult.scoreA && scoreB === nextResult.scoreB
      ? nextResult.periodScores ?? []
      : [],
    playerStats,
    updatedAt: new Date().toISOString(),
  };
}
export function disputeMatch(state, matchId, disputeInput = "") {
  const disciplineBlock = getDisciplineBlockedState(state, "이의제기");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  const canOpenDispute = ["approval", "disputed"].includes(match?.status) || Boolean(match?.status === "agreed" && match?.endedAt && match?.result);
  if (!match?.result || !canOpenDispute) return state;
  const rawRequest = normalizeDisputeRequest(disputeInput);
  const disputeRequest = match.refereeId
    ? normalizePlayerStatsDisputeRequest(rawRequest)
    : normalizeTeamScoresDisputeRequest(rawRequest);
  if (!disputeRequest || disputeRequest.baseRevision !== getMatchResultRevision(match)) return state;
  if (match.refereeId && disputeRequest.playerId !== state.currentUserId) return state;
  if (!currentUserCanFileMatchDispute(state, match)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의신청 권한 없음",
          body: "실제 경기에 참여한 선수만 이의제기할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const recordWindow = getMatchRecordWindow(match);
  if (!recordWindow.disputeOpen) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의제기 마감",
          body: `경기 종료 후 ${normalizeDisputeWindowMinutes(match.disputeMinutes)}분이 지나 이의제기를 접수할 수 없습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  if ((match.disputes ?? []).some((dispute) => dispute.status === "open" && dispute.by === state.currentUserId)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "이의제기 처리 대기",
        body: "이미 접수한 이의제기가 처리 대기 중입니다.",
        tone: "match",
        matchId,
      }, ...state.notifications],
    };
  }

  const now = new Date().toISOString();
  const dispute = {
    id: makeUuid(),
    by: state.currentUserId,
    reason: disputeRequest.reason || "스코어 또는 개인 기록 확인이 필요합니다.",
    request: disputeRequest,
    status: "open",
    createdAt: now,
  };
  const disputeDraftResult = clone(match.disputeDraftResult ?? match.result);

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            status: "disputed",
            disputes: [dispute, ...(item.disputes ?? [])],
            disputeDraftResult,
            disputeDraftUpdatedAt: now,
          }
        : item,
    ),
    notifications: [
      {
        id: makeId("n"),
        title: "이의제기 접수",
        body: `${match.title} 결과가 보류됐습니다. 방장이 이의제기 큐에서 건별로 가결 또는 부결합니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}
export function resolveMatchDispute(state, matchId, disputeId, decision, resolutionReason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  const safeDecision = decision === "accepted" ? "accepted" : decision === "rejected" ? "rejected" : "";
  const safeResolutionReason = String(resolutionReason ?? "").trim();
  const targetDispute = (match?.disputes ?? []).find((dispute) => dispute.id === disputeId && dispute.status === "open");
  if (!match?.result || match.status !== "disputed" || !targetDispute || !safeDecision || !safeResolutionReason) return state;
  if (!currentUserCanResolveMatchDispute(state, match)) return state;
  const currentRevision = getMatchResultRevision({ result: match.disputeDraftResult ?? match.result });
  const baseRevision = Number(targetDispute.request?.baseRevision);
  if (
    safeDecision === "accepted"
    && (
      baseRevision > currentRevision
      || (targetDispute.request?.kind === "team_scores" && baseRevision !== currentRevision)
    )
  ) return state;

  const resolvedAt = new Date().toISOString();
  const previousResult = clone(match.disputeDraftResult ?? match.result);
  const nextDraft = safeDecision === "accepted"
    ? applyDisputeRequestToResult(match, previousResult, targetDispute.request ?? {})
    : clone(previousResult);
  const disputes = (match.disputes ?? []).map((dispute) => dispute.id === targetDispute.id
    ? {
        ...dispute,
        status: safeDecision,
        resolution: safeDecision === "accepted" ? "request_applied" : "request_rejected",
        resolutionReason: safeResolutionReason,
        resolutionAudit: {
          handledBy: state.currentUserId,
          handledAt: resolvedAt,
          decision: safeDecision,
          previousResult,
          nextResult: clone(nextDraft),
        },
        resolvedAt,
        resolvedBy: state.currentUserId,
      }
    : dispute);
  const openCount = disputes.filter((dispute) => dispute.status === "open").length;
  const decisionLabel = safeDecision === "accepted" ? "가결" : "부결";

  if (!openCount) {
    const resolvedMatch = {
      ...match,
      status: "approval",
      result: nextDraft,
      teamA: { ...match.teamA, score: nextDraft.scoreA },
      teamB: { ...match.teamB, score: nextDraft.scoreB },
      approvals: { teamA: [], teamB: [] },
      disputes,
      disputeDraftResult: undefined,
      disputeDraftUpdatedAt: undefined,
      disputeResolvedAt: resolvedAt,
    };
    return {
      ...state,
      matches: state.matches.map((item) => item.id === matchId ? resolvedMatch : item),
      notifications: [{
        id: makeId("n"),
        title: `이의제기 ${decisionLabel}`,
        body: `${match.title} 이의제기를 모두 판정했습니다. 참가자 합의 후 ${match.refereeId ? "배정 심판" : "방장"}이 최종 승인해 주세요.`,
        tone: "match",
        matchId,
        targetUserId: targetDispute.by,
      }, ...state.notifications],
    };
  }

  const nextMatch = {
    ...match,
    disputes,
    disputeDraftResult: nextDraft,
    disputeDraftUpdatedAt: resolvedAt,
  };
  return {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? nextMatch : item),
    notifications: [{
      id: makeId("n"),
      title: `이의제기 ${decisionLabel}`,
      body: `${match.title} 이의제기 1건을 ${decisionLabel}했습니다. 남은 요청 ${openCount}건을 처리해 주세요.`,
      tone: "match",
      matchId,
      targetUserId: targetDispute.by,
    }, ...state.notifications],
  };
}
