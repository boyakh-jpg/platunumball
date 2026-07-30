import { MATCH_SIDES } from "../../../lib/constants.js";
import { MAX_BENCH_CAPACITY } from "../../../lib/constants.js";
import { REFEREE_ABSENCE_TRUST_PENALTY } from "../../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { SIDE_LABEL_TEXT } from "../../../lib/constants.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { adjustUserTrust } from "../../trustUtils.js";
import { applyOperatorAttendance } from "../../../lib/matchUtils.js";
import { buildPickupTeamAssignment } from "../../../lib/roomFlow.js";
import { clampTrustScore } from "../../trustUtils.js";
import { clearMatchPlayerDecision } from "../../../lib/matchUtils.js";
import { clone } from "../../rowUtils.js";
import { getActualMatchPlayerIds } from "../../../lib/matchUtils.js";
import { getAgreementStatus } from "../../../lib/matchUtils.js";
import { getMatchAttendance } from "../../../lib/matchUtils.js";
import { getMatchCancelCopy } from "../../../lib/matchUtils.js";
import { getMatchHostPlayerId as getMatchHostPlayerIdFromMatch } from "../../../lib/matchUtils.js";
import { getMatchOverlapConflict } from "../../../lib/matchUtils.js";
import { getMatchPlayerPlacement } from "../../../lib/matchUtils.js";
import { getMatchPlayerTeamId } from "../../../lib/matchUtils.js";
import { getMatchRecordPlayerIds } from "../../../lib/matchUtils.js";
import { getMatchRecordWindow } from "../../../lib/matchUtils.js";
import { getMatchReservePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchResultEntryPermission } from "../../../lib/matchUtils.js";
import { getMatchResultRevision } from "../../../lib/matchUtils.js";
import { getMatchRoomPhase } from "../../../lib/matchUtils.js";
import { getMatchRosterSideName } from "../../../lib/matchUtils.js";
import { getMatchRosterSwapPatch } from "../../../lib/matchUtils.js";
import { getMatchScheduledDate } from "../../../lib/matchUtils.js";
import { getMatchScoreEditableSides } from "../../../lib/matchUtils.js";
import { getMatchSideLeaderId } from "../../../lib/matchUtils.js";
import { getMatchSidePlayerIds } from "../../../lib/matchUtils.js";
import { getMatchStartDate } from "../../../lib/matchUtils.js";
import { getMatchSubstitutionAccess } from "../../../lib/matchUtils.js";
import { getMatchTrustFeedbackLimit } from "../../../lib/matchUtils.js";
import { getMatchTrustFeedbackParticipantIds } from "../../../lib/matchUtils.js";
import { getMergedResultScore } from "../../../lib/matchUtils.js";
import { getMissingMatchAttendance } from "../../../lib/matchUtils.js";
import { getPickupRerollState } from "../../../lib/roomFlow.js";
import { getPostgameRecordRequiredParticipantIds } from "../../../lib/postgameRecordVerification.js";
import { getRecruitingBenchCapacity } from "../../../lib/recruiting.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { getRoomCancellationPolicy } from "../../../lib/roomFlow.js";
import { getSubmittedStatPatch } from "../../../lib/matchUtils.js";
import { getTeamCaptainId } from "../../../lib/matchUtils.js";
import { getTeamEventEligibility } from "../../../lib/recruiting.js";
import { getTeamMemberIds } from "../../teamMappers.js";
import { getTournamentRefereeStatus } from "../../../lib/tournamentGovernance.js";
import { isEligibleReferee } from "../../../lib/matchUtils.js";
import { isMatchLateAttendancePlayer } from "../../../lib/matchUtils.js";
import { isMatchPartyTeamParty } from "../../../lib/matchUtils.js";
import { isMatchRecordMatch } from "../../../lib/matchUtils.js";
import { isMatchReferee } from "../../../lib/matchUtils.js";
import { isMatchSideTeamParty } from "../../../lib/matchUtils.js";
import { isMatchTrustFeedbackOpen } from "../../../lib/matchUtils.js";
import { isPersonalRecordMatch } from "../../../lib/matchUtils.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { isTournamentGovernanceEnabled } from "../../../lib/tournamentGovernance.js";
import { isTournamentRefereeNeutral } from "../../../lib/tournamentGovernance.js";
import { makeId } from "../../rowUtils.js";
import { makeUuid } from "../../rowUtils.js";
import { normalizeCourtReviewRating } from "../../../lib/courts.js";
import { normalizeDisputeRequest } from "../../../lib/matchUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { normalizePlayerStats } from "../../../lib/matchUtils.js";
import { normalizePlayerStatsDisputeRequest } from "../../../lib/matchUtils.js";
import { normalizeRecruitingRoomState } from "../../../lib/recruiting.js";
import { normalizeStateSettings as normalizeSettings } from "../../stateNormalizer.js";
import { normalizeTeamScoresDisputeRequest } from "../../../lib/matchUtils.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { updateMatchPartiesForPlayer } from "../../../lib/matchUtils.js";
import { getDisciplineBlockedState, getMatchOverlapConflictBlockedState } from "../guards.js";
import { finalizeMatch } from "../lifecycle.js";
import { canEditMatchPreparation, currentUserCanConfirmRefereeAbsence, currentUserCanFileMatchDispute, currentUserCanOperateStartedMatch, currentUserCanResolveMatchDispute, currentUserCanStartMatch, currentUserIsEligibleMatchReferee, currentUserIsMatchHost, getMatchHostPlayerId } from "../matchAccess.js";
import { getMatchChangeRequiredIds, getPendingScheduleChangeNotification, getRoomCancelLockedNotification } from "../roomRules.js";
import { getServerRatingValue } from "../runtime.js";

function getSelfDecisionId(state, match, sideName, decisionKey, playerId) {
  const currentUserId = state.currentUserId;
  if (!currentUserId || playerId !== currentUserId) return null;
  const sidePlayers = match[sideName]?.players ?? [];
  if (decisionKey === "approvals" && isMatchRecordMatch(match)) {
    const requiredIds = match.rules?.recordApproverIds?.[sideName] ?? [];
    if (!requiredIds.includes(currentUserId)) return null;
    if ((match.approvals?.[sideName] ?? []).includes(currentUserId)) return null;
    return currentUserId;
  }
  const sideTeamId = match[sideName]?.teamId;
  const captainId = decisionKey === "agreements" && sideTeamId
    ? getTeamCaptainId(state.teams, sideTeamId)
    : "";
  if (captainId) {
    if (currentUserId !== captainId) return null;
  } else if (!sidePlayers.includes(currentUserId)) {
    return null;
  }
  if ((match[decisionKey]?.[sideName] ?? []).includes(currentUserId)) return null;
  return currentUserId;
}

export function agreeMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;

  const agreementId = getSelfDecisionId(state, match, sideName, "agreements", playerId);
  if (!agreementId) return state;

  const updatedMatch = {
    ...match,
    agreements: {
      ...(match.agreements ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.agreements?.[sideName] ?? []), agreementId])),
    },
  };
  const ready =
    match.status !== "agreed" &&
    getAgreementStatus(updatedMatch, state.teams, "teamA").approved &&
    getAgreementStatus(updatedMatch, state.teams, "teamB").approved;
  const nextMatch = ready
    ? { ...updatedMatch, status: "agreed", agreedAt: updatedMatch.agreedAt ?? new Date().toISOString() }
    : updatedMatch;

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: ready
      ? [
          {
            id: makeId("n"),
            title: "경기 전 동의 완료",
            body: `${match.title} 경기 결과를 입력할 수 있습니다.`,
            tone: "match",
            matchId,
          },
          ...state.notifications,
        ]
      : state.notifications,
  };
}

export function submitMatchResult(state, matchId, result) {
  const disciplineBlock = getDisciplineBlockedState(state, "기록 저장");
  if (disciplineBlock) return disciplineBlock;
  const storedMatch = state.matches.find((item) => item.id === matchId);
  if (!storedMatch) return state;
  if (isMatchRecordMatch(storedMatch) && storedMatch.rules?.recordSetupReady !== true) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "기록 참가자 확인 필요",
        body: "방에서 A/B 참가자 또는 양 팀 출전 명단을 먼저 확정해 주세요.",
        tone: "orange",
        matchId,
      }, ...(state.notifications ?? [])],
    };
  }
  const match = storedMatch;
  const currentUserId = state.currentUserId;
  const hasReferee = Boolean(match.refereeId);
  const currentUser = state.users.find((user) => user.id === currentUserId);
  const currentUserIsReferee = isMatchReferee(match, currentUserId);
  const currentUserIsEligibleReferee = currentUserIsReferee && isEligibleReferee(currentUser, match.refereeTrustMin, state.settings?.refereeAppointments);
  const currentUserCanOperatePostStart = currentUserCanOperateStartedMatch(state, match);
  const resultEntryPermission = getMatchResultEntryPermission(match, currentUserId, {
    canOperatePostStart: currentUserCanOperatePostStart,
    refereeEligible: currentUserIsEligibleReferee,
  });
  const currentUserCanDisputeDraft = resultEntryPermission.canEditDisputeDraft;
  const currentUserCanRecord = currentUserCanDisputeDraft
    || resultEntryPermission.editablePlayerIds.length > 0
    || (isMatchRecordMatch(match) && resultEntryPermission.canSubmit);

  if (hasReferee && !currentUserIsEligibleReferee) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "심판 기록 전용",
          body: "심판이 초대된 경기는 해당 심판만 스코어와 개인 활약을 입력할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  if (!hasReferee && !currentUserCanRecord) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "개인 기록 입력 불가",
          body: "일반 무심판 경기는 개인 기록을 입력하지 않습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (match.status === "contract") {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "경기 전 동의 필요",
          body: `${match.title}는 양팀 동의가 끝나야 결과를 입력할 수 있습니다.`,
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (match.status === "disputed" && !currentUserCanDisputeDraft) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의신청 처리 중",
          body: "이의신청 중에는 심판 또는 방장만 임시 수정안을 저장할 수 있습니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (["confirmed", "void", "cancelled"].includes(match.status)) return state;
  const recordWindow = getMatchRecordWindow(match);
  const matchStartsAt = getMatchStartDate(match);
  const beforeStart = !matchStartsAt || (Number.isFinite(matchStartsAt.getTime()) && Date.now() < matchStartsAt.getTime());
  const liveRecordAllowed = resultEntryPermission.canSubmitLive;
  if (currentUserCanDisputeDraft && !recordWindow.disputeOpen) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "이의 처리 마감",
          body: "이의 처리 시간이 지나 수정안을 저장할 수 없습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  if (!resultEntryPermission.canSubmit) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: beforeStart ? "경기 시작 전" : recordWindow.beforeEnd ? "실시간 기록 권한 없음" : "기록 입력 마감",
          body: beforeStart
            ? "경기 시작 후 배정 심판만 개인 기록을 저장할 수 있습니다."
            : recordWindow.beforeEnd
              ? "경기 중 실시간 기록은 심판이 있으면 심판만 저장할 수 있습니다."
            : "경기 종료 후 1시간이 지나 개인 기록 입력이 마감됐습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const draftEntry = currentUserCanDisputeDraft;
  const liveEntry = !draftEntry && liveRecordAllowed;
  const matchRecordRoom = isMatchRecordMatch(match);
  const recordPlayerIds = getMatchRecordPlayerIds(match);
  const existingStats = normalizePlayerStats((draftEntry ? match.disputeDraftResult : match.result)?.playerStats ?? match.result?.playerStats ?? {}, recordPlayerIds);
  const endedAt = liveEntry ? match.endedAt : match.endedAt ?? recordWindow.endAt?.toISOString() ?? now;
  const targetPlayerIds = resultEntryPermission.editablePlayerIds;
  const submittedStatPatch = getSubmittedStatPatch(result.playerStats ?? {}, targetPlayerIds);
  const touchedPlayerIds = Object.keys(submittedStatPatch);
  const nextPlayerStats = matchRecordRoom ? {} : { ...existingStats };
  touchedPlayerIds.forEach((playerId) => {
    const allowedFieldIds = new Set(
      resultEntryPermission.getEditableStatFields(playerId).map((field) => field.id),
    );
    const currentStats = nextPlayerStats[playerId] ?? {};
    nextPlayerStats[playerId] = {
      ...currentStats,
      ...Object.fromEntries(
        Object.entries(submittedStatPatch[playerId])
          .filter(([fieldId]) => currentUserIsEligibleReferee || draftEntry || allowedFieldIds.has(fieldId)),
      ),
    };
  });
  const scoringMatch = match;
  const nextSubmissions = {
    ...(match.result?.statSubmissions ?? {}),
    ...Object.fromEntries(touchedPlayerIds.map((playerId) => {
      const sideName = getMatchRosterSideName(scoringMatch, playerId);
      const source = currentUserIsEligibleReferee
        ? "referee"
        : "dispute_operator";
      return [playerId, { by: currentUserId, side: sideName, source, submittedAt: now }];
    })),
  };
  const currentResult = draftEntry ? match.disputeDraftResult ?? match.result : match.result;
  const nextScoreA = Number(matchRecordRoom ? result.scoreA : currentResult?.scoreA ?? match.teamA?.score ?? 0);
  const nextScoreB = Number(matchRecordRoom ? result.scoreB : currentResult?.scoreB ?? match.teamB?.score ?? 0);
  if (
    !Number.isInteger(nextScoreA) || nextScoreA < 0 || nextScoreA > 999
    || !Number.isInteger(nextScoreB) || nextScoreB < 0 || nextScoreB > 999
  ) return state;
  const nextResult = {
    scoreA: nextScoreA,
    scoreB: nextScoreB,
    playerStats: nextPlayerStats,
    statSubmissions: nextSubmissions,
    submittedBy: currentUserId,
    submittedAt: (draftEntry ? match.disputeDraftResult?.submittedAt : match.result?.submittedAt) ?? now,
    updatedAt: now,
  };

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? draftEntry
          ? {
              ...item,
              disputeDraftResult: nextResult,
              disputeDraftUpdatedAt: now,
            }
          : {
            ...item,
            playedPlayerIds: item.playedPlayerIds,
            status: liveEntry ? item.status : "approval",
            teamA: { ...item.teamA, score: nextResult.scoreA },
            teamB: { ...item.teamB, score: nextResult.scoreB },
            approvals: liveEntry ? item.approvals : { teamA: [], teamB: [] },
            result: nextResult,
            endedAt,
          }
        : item,
    ),
    notifications: [
      {
        id: makeId("n"),
        title: matchRecordRoom ? "참가 확인 요청" : draftEntry ? "이의 수정안 저장" : "심판 기록 제출",
        body: draftEntry
          ? `${match.title} 이의 수정안이 임시 저장됐습니다. ${match.refereeId ? "배정 심판" : "방장"}이 최종 승인해야 확정됩니다.`
          : matchRecordRoom
            ? `${match.title} 점수가 저장됐습니다. 참가자 ${getPostgameRecordRequiredParticipantIds(match).length}명에게 내 참가 확인을 요청합니다.`
            : `${match.title} 스코어와 전체 개인 활약이 저장됐습니다.`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

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

export function approveMatch(state, matchId, sideName, playerId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!isMatchRecordMatch(match) || match.rules?.recordSetupReady !== true) return state;
  if (!match?.result || match.confirmedAt || match.cancelledAt || match.voidedAt || match.status === "disputed") return state;
  const approvalId = getSelfDecisionId(state, match, sideName, "approvals", playerId);
  if (!approvalId) return state;

  const updatedMatch = {
    ...match,
    approvals: {
      ...(match.approvals ?? { teamA: [], teamB: [] }),
      [sideName]: Array.from(new Set([...(match.approvals?.[sideName] ?? []), approvalId])),
    },
    rules: {
      ...(match.rules ?? {}),
      participantAcceptedIds: Array.from(new Set([
        ...(match.rules?.participantAcceptedIds ?? []),
        approvalId,
      ])),
    },
  };
  const stateWithApproval = {
    ...state,
    matches: state.matches.map((item) => item.id === matchId ? updatedMatch : item),
  };
  return stateWithApproval;
}

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
      playerStats: {},
      statSubmissions: {},
      updatedAt: new Date().toISOString(),
    };
  }
  const normalized = normalizePlayerStatsDisputeRequest(disputeRequest);
  if (!nextResult || !normalized || !getActualMatchPlayerIds(match).includes(normalized.playerId)) return nextResult;
  const playerStats = normalizePlayerStats(nextResult.playerStats ?? {}, getActualMatchPlayerIds(match));
  playerStats[normalized.playerId] = normalized.requestedStats;
  return {
    ...nextResult,
    scoreA: getMergedResultScore(match, playerStats, "teamA", nextResult.scoreA),
    scoreB: getMergedResultScore(match, playerStats, "teamB", nextResult.scoreB),
    revision: nextRevision,
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
  if (!match.refereeId
    && disputeRequest.requestedScoreA === Number(match.result.scoreA ?? 0)
    && disputeRequest.requestedScoreB === Number(match.result.scoreB ?? 0)) return state;
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
  if (
    safeDecision === "accepted"
    && Number(targetDispute.request?.baseRevision) !== getMatchResultRevision({ result: match.disputeDraftResult ?? match.result })
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
