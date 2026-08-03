import { REFEREE_ABSENCE_TRUST_PENALTY } from "../../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { adjustUserTrust } from "../../trustUtils.js";
import { applyOperatorAttendance } from "../../../lib/matchUtils.js";
import { getActualMatchPlayerIds } from "../../../lib/matchUtils.js";
import { getMatchAttendance } from "../../../lib/matchUtils.js";
import { getMatchCancelCopy } from "../../../lib/matchUtils.js";
import { getMatchHostPlayerId as getMatchHostPlayerIdFromMatch } from "../../../lib/matchUtils.js";
import { getMatchPlayerPlacement } from "../../../lib/matchUtils.js";
import { getMatchRoomPhase } from "../../../lib/matchUtils.js";
import { getMatchScheduledDate } from "../../../lib/matchUtils.js";
import { getMissingMatchAttendance } from "../../../lib/matchUtils.js";
import { getRoomCancellationPolicy } from "../../../lib/roomFlow.js";
import { getTournamentRefereeStatus } from "../../../lib/tournamentGovernance.js";
import { isEligibleReferee } from "../../../lib/matchUtils.js";
import { isMatchRecordMatch } from "../../../lib/matchUtils.js";
import { isPersonalRecordMatch } from "../../../lib/matchUtils.js";
import { isRoomScheduleChangePending } from "../../../lib/roomFlow.js";
import { isTournamentGovernanceEnabled } from "../../../lib/tournamentGovernance.js";
import { isTournamentRefereeNeutral } from "../../../lib/tournamentGovernance.js";
import { makeId } from "../../rowUtils.js";
import { uniquePlayerIds } from "../../rowUtils.js";
import { getDisciplineBlockedState } from "../guards.js";
import {
  currentUserCanConfirmRefereeAbsence,
  currentUserCanOperateStartedMatch,
  currentUserCanResolveMatchDispute,
  currentUserCanStartMatch,
  currentUserIsMatchHost,
  getMatchHostPlayerId,
} from "../matchAccess.js";
import { getMatchChangeRequiredIds, getPendingScheduleChangeNotification, getRoomCancelLockedNotification } from "../roomRules.js";

export function checkInMatchPlayer(state, matchId, sideName, playerId) {
  const disciplineBlock = getDisciplineBlockedState(state, "출석 처리");
  if (disciplineBlock) return disciplineBlock;
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !playerId) return state;
  if (!currentUserCanStartMatch(state, match)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  const placement = getMatchPlayerPlacement(match, playerId);
  if (!placement || placement.side !== sideName) return state;

  const attendance = getMatchAttendance(match);
  const nextMatch = {
    ...match,
    attendance: {
      ...attendance,
      [sideName]: uniquePlayerIds([...attendance[sideName], playerId]),
    },
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "출석 완료", body: "경기준비방 출석체크가 완료됐습니다.", tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function requestMatchRefereeAbsence(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.refereeId || !currentUserIsMatchHost(state, match)) return state;
  const tournament = match.tournamentId
    ? (state.tournaments ?? []).find((item) => item.id === match.tournamentId)
    : null;
  if (isTournamentGovernanceEnabled(tournament)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  if (match.refereeAbsenceRequest?.status === "pending" || match.refereeAbsenceRequest?.confirmedAt) return state;
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    refereeAbsenceRequest: {
      by: state.currentUserId,
      createdAt: match.refereeAbsenceRequest?.createdAt ?? now,
      status: "pending",
    },
  };

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 미출석 요청",
        body: "상대 사이드장이 인정하면 심판 없는 경기로 전환됩니다.",
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function confirmMatchRefereeAbsence(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match?.refereeId || !match.refereeAbsenceRequest || match.refereeAbsenceRequest.confirmedAt) return state;
  const tournament = match.tournamentId
    ? (state.tournaments ?? []).find((item) => item.id === match.tournamentId)
    : null;
  if (isTournamentGovernanceEnabled(tournament)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin" || match.startedAt || match.endedAt || match.result) return state;
  if (!currentUserCanConfirmRefereeAbsence(state, match)) return state;
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    formerRefereeId: match.formerRefereeId ?? match.refereeId,
    refereeId: "",
    refereeAbsenceRequest: {
      ...match.refereeAbsenceRequest,
      status: "confirmed",
      confirmedBy: state.currentUserId,
      confirmedAt: now,
    },
  };

  return {
    ...state,
    users: adjustUserTrust(state.users, match.refereeId, -REFEREE_ABSENCE_TRUST_PENALTY),
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      {
        id: makeId("n"),
        title: "심판 미출석 인정",
        body: "심판 없는 경기로 전환됐습니다. 이후 출석, 시작, 종료, 결과 처리는 방장이 맡습니다.",
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}

export function startMatch(state, matchId) {
  const rawMatch = state.matches.find((item) => item.id === matchId);
  const qrAttendanceEnabled = rawMatch?.rules?.qrAttendanceEnabled === true;
  const match = qrAttendanceEnabled
    ? rawMatch
    : applyOperatorAttendance(rawMatch, state.currentUserId);
  if (!match || !["contract", "agreed"].includes(match.status) || match.result || match.endedAt) return state;
  const actualPlayerIds = getActualMatchPlayerIds(match);
  const activeConflict = state.matches.find((item) => (
    item.id !== match.id
    && item.startedAt
    && !item.endedAt
    && !item.cancelledAt
    && !item.voidedAt
    && getActualMatchPlayerIds(item).some((playerId) => actualPlayerIds.includes(playerId))
  ));
  if (activeConflict) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "중복 경기 차단",
        body: `${activeConflict.title}에 같은 출전선수가 경기 중입니다.`,
        tone: "orange",
        matchId,
      }, ...state.notifications],
    };
  }
  if (!currentUserCanStartMatch(state, match)) return state;
  if (getMatchRoomPhase(match).phase !== "checkin") return state;
  if (match.tournamentId) {
    const tournament = (state.tournaments ?? []).find((item) => item.id === match.tournamentId);
    if (isTournamentGovernanceEnabled(tournament)) {
      const teamAId = match.teamA?.teamId ?? match.teamAId;
      const teamBId = match.teamB?.teamId ?? match.teamBId;
      const refereeReady = [TOURNAMENT_SANCTION_STATUS.approved, TOURNAMENT_SANCTION_STATUS.community].includes(tournament.sanctionStatus)
        && match.refereeId
        && getTournamentRefereeStatus(tournament, match.refereeId) === "accepted"
        && isEligibleReferee(
          (state.users ?? []).find((user) => user.id === match.refereeId),
          REFEREE_TRUST_MIN,
          state.settings?.refereeAppointments,
          tournament.endDate,
        )
        && isTournamentRefereeNeutral(tournament, match.refereeId, teamAId, teamBId, state.teams);
      if (!refereeReady) {
        return {
          ...state,
          notifications: [{
            id: makeId("n"),
            title: "중립 심판 필요",
            body: "승인된 대회 심판 중 양 팀에 속하지 않은 심판을 배정해야 경기를 시작할 수 있습니다.",
            tone: "orange",
            matchId,
          }, ...state.notifications],
        };
      }
    }
  }
  if (isRoomScheduleChangePending(match)) {
    return {
      ...state,
      notifications: [getPendingScheduleChangeNotification({ matchId }), ...state.notifications],
    };
  }
  const currentRequiredIds = getMatchChangeRequiredIds(match);
  const ruleRequiredIds = uniquePlayerIds(match.rules?.ruleAcknowledgementRequiredIds ?? [])
    .filter((playerId) => currentRequiredIds.includes(playerId));
  const ruleAcknowledgedIds = new Set(match.rules?.ruleAcknowledgedIds ?? []);
  if (ruleRequiredIds.some((playerId) => !ruleAcknowledgedIds.has(playerId))) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "변경 내용 확인 필요",
        body: "현재 참가자 전원이 최신 경기 규칙을 확인해야 시작할 수 있습니다.",
        tone: "orange",
        matchId,
      }, ...state.notifications],
    };
  }
  const pickup = (match.formationMode ?? match.rules?.formationMode) === "pickup"
    || (match.matchIntent ?? match.rules?.matchIntent) === "pickup";
  if (pickup && match.rules?.sideAssignmentStatus !== "confirmed") {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "팀 배정 확정 필요",
        body: "출석한 참가자의 A/B사이드와 대기 선수를 배정한 뒤 배정 확정을 눌러 주세요.",
        tone: "orange",
        matchId,
      }, ...state.notifications],
    };
  }
  if (match.tournamentId && (!match.rules?.rosterReady?.teamA || !match.rules?.rosterReady?.teamB)) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "출전 명단 미확정",
        body: "양 팀장이 출전·후보 명단을 확정해야 경기를 시작할 수 있습니다.",
        tone: "orange",
        matchId,
      }, ...state.notifications],
    };
  }
  const missingAttendance = getMissingMatchAttendance(match);
  const scheduledAt = getMatchScheduledDate(match);
  const scheduledStartReached = match.rules?.timingType === "instant"
    || (scheduledAt && Date.now() >= scheduledAt.getTime());
  if (missingAttendance.length && (!qrAttendanceEnabled || !scheduledStartReached)) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "출석체크 필요",
          body: "출전선수와 후보 전원이 출석체크되거나 미도착 정리되어야 경기 시작이 가능합니다.",
          tone: "orange",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    status: "agreed",
    agreedAt: match.agreedAt ?? now,
    startedAt: match.startedAt ?? now,
    rules: {
      ...(match.rules ?? {}),
      startedAt: match.rules?.startedAt ?? now,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: state.notifications,
  };
}

export function endMatch(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "agreed" || !match.startedAt || match.endedAt) return state;
  if (!currentUserCanOperateStartedMatch(state, match)) return state;
  const now = new Date().toISOString();
  const nextMatch = {
    ...match,
    status: match.status,
    approvals: match.approvals,
    startedAt: match.startedAt,
    endedAt: now,
    rules: {
      ...(match.rules ?? {}),
      startedAt: match.rules?.startedAt ?? match.startedAt,
    },
  };
  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? nextMatch : item)),
    notifications: [
      { id: makeId("n"), title: "경기 종료", body: `${match.title} 경기가 종료됐습니다. 결과 입력이 열렸습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function deleteSoloRecord(state, matchId) {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !isPersonalRecordMatch(match) || match.createdBy !== state.currentUserId || match.status === "cancelled") return state;
  const nowIso = new Date().toISOString();

  return {
    ...state,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? { ...item, status: "cancelled", cancelledAt: nowIso, updatedAt: nowIso }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "개인 기록 삭제", body: `${match.title} 기록을 삭제했습니다.`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}

export function cancelMatch(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || !["contract", "agreed"].includes(match.status)) return state;
  const cancellationReason = String(reason).trim();
  if (cancellationReason.length < 5 || cancellationReason.length > 200) return state;
  const afterStart = Boolean(match.startedAt || match.endedAt || match.result || ["live", "postgame", "dispute", "record"].includes(getMatchRoomPhase(match).phase));
  if (afterStart ? !currentUserCanOperateStartedMatch(state, match) : !currentUserIsMatchHost(state, match)) return state;
  const cancellationPolicy = isMatchRecordMatch(match)
    ? { allowed: true, penalty: 0, waived: false, waiverReason: "" }
    : getRoomCancellationPolicy(match);
  if (!cancellationPolicy.allowed) {
    return {
      ...state,
      notifications: [getRoomCancelLockedNotification({ matchId }), ...state.notifications],
    };
  }
  const cancelCopy = getMatchCancelCopy(match);
  const hostPlayerId = getMatchHostPlayerIdFromMatch(match);
  const cancelledAt = new Date().toISOString();

  return {
    ...state,
    users: cancellationPolicy.penalty > 0 && hostPlayerId
      ? adjustUserTrust(state.users, hostPlayerId, -cancellationPolicy.penalty)
      : state.users,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            status: "cancelled",
            cancelledAt,
            rules: {
              ...(item.rules ?? {}),
              cancellationReason,
              cancelledBy: state.currentUserId,
              cancelPenalty: cancellationPolicy.penalty,
              cancelPenaltyWaived: cancellationPolicy.waived,
              cancelWaiverReason: cancellationPolicy.waiverReason,
            },
          }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: cancelCopy.notificationTitle, body: cancelCopy.notificationBody, tone: "match", matchId },
      ...(cancellationPolicy.penalty > 0 ? [{
        id: makeId("n"),
        targetUserId: hostPlayerId,
        title: "경기 취소 신뢰도 반영",
        body: `경기 시작 12시간 이내에 취소해 신뢰도 ${cancellationPolicy.penalty}점이 감소했습니다.`,
        tone: "orange",
        matchId,
      }] : []),
      ...state.notifications,
    ],
  };
}

export function voidMatch(state, matchId, reason = "") {
  const match = state.matches.find((item) => item.id === matchId);
  if (!match || match.status !== "disputed") return state;
  if (!currentUserCanResolveMatchDispute(state, match)) return state;
  const safeReason = String(reason).trim();
  if (safeReason.length < 10 || safeReason.length > 500) return state;
  const now = new Date().toISOString();
  const hostPenalty = Math.max(0, Math.min(10, Number(state.settings?.ratingPolicy?.trust?.matchVoidHostPenalty ?? 2)));
  const hostPlayerId = getMatchHostPlayerId(state, match);

  return {
    ...state,
    users: hostPlayerId ? adjustUserTrust(state.users, hostPlayerId, -hostPenalty) : state.users,
    matches: state.matches.map((item) =>
      item.id === matchId
        ? {
            ...item,
            status: "void",
            ranked: false,
            voidedAt: now,
            voidedBy: state.currentUserId,
            voidReason: safeReason,
            voidSnapshot: {
              ranked: item.ranked !== false,
              ratingScale: Number(item.rules?.ratingScale ?? 1),
              result: item.result ? JSON.parse(JSON.stringify(item.result)) : null,
            },
            disputes: (item.disputes ?? []).map((dispute) => dispute.status === "open"
              ? { ...dispute, status: "accepted", resolution: "match_voided", resolvedAt: now, resolvedBy: state.currentUserId }
              : dispute),
          }
        : item,
    ),
    notifications: [
      { id: makeId("n"), title: "경기 무효 처리", body: `${match.title} 경기가 무효 처리됐습니다. 사유: ${safeReason}`, tone: "match", matchId },
      ...state.notifications,
    ],
  };
}
