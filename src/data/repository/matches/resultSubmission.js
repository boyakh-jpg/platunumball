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
