import { MATCH_SIDES } from "../../../lib/constants.js";
import { ROOM_SCHEDULE_MAX_DAYS } from "../../../lib/constants.js";
import { SCHEDULE_MAX_DAYS } from "../../../lib/constants.js";
import { doTournamentMatchSchedulesOverlap } from "../../../lib/tournamentGovernance.js";
import { getMatchScheduledDate, getMatchSidePlayerIds } from "../../../lib/matchUtils.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { getScheduleText } from "../../scheduleUtils.js";
import { getTeamCaptainId } from "../../../lib/matchUtils.js";
import { getTournamentRefereeStatus } from "../../../lib/tournamentGovernance.js";
import { getTournamentScheduleEditPolicy } from "../../../lib/matchUtils.js";
import { isScheduleDateInAllowedWindow } from "../../scheduleUtils.js";
import { isTournamentGovernanceEnabled } from "../../../lib/tournamentGovernance.js";
import { isTournamentRefereeAuthorized, isTournamentRefereeNeutral } from "../../../lib/tournamentGovernance.js";
import { makeId } from "../../rowUtils.js";
import { getInvalidScheduleNotification } from "../guards.js";
import { advanceTournamentAfterMatch } from "../lifecycle.js";

export function updateTournamentMatchSchedule(state, tournamentId, matchId, schedule = {}) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = state.matches.find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match) return state;

  if (tournament.createdBy !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "일정 수정 불가",
          body: "대회 생성자만 경기 일정을 수정할 수 있습니다.",
          tone: "match",
          matchId,
        },
        ...state.notifications,
      ],
    };
  }

  const scheduledDate = String(schedule.scheduledDate ?? "").slice(0, 10);
  const scheduledTime = String(schedule.scheduledTime ?? "").slice(0, 5);
  const allowedCourtIds = new Set([
    tournament.courtId,
    ...(tournament.rules?.allowedCourtIds ?? []),
  ].filter(Boolean));
  const courtId = String(schedule.courtId ?? match.courtId ?? tournament.courtId ?? "");
  const selectedCourt = getRegisteredCourts(state).find((court) => court.id === courtId) ?? null;
  if (!selectedCourt || (allowedCourtIds.size && !allowedCourtIds.has(courtId))) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "일정 수정 불가",
        body: "대회 사용 구장으로 등록된 승인 구장만 선택할 수 있습니다.",
        tone: "match",
        matchId,
      }, ...state.notifications],
    };
  }
  const maxDays = match.tournamentId ? SCHEDULE_MAX_DAYS : ROOM_SCHEDULE_MAX_DAYS;
  if (!isScheduleDateInAllowedWindow(scheduledDate, new Date(), maxDays)) {
    return { ...state, notifications: [getInvalidScheduleNotification(maxDays), ...state.notifications] };
  }
  const scheduleChanged = (
    match.scheduledDate !== scheduledDate ||
    String(match.scheduledTime ?? "").slice(0, 5) !== scheduledTime ||
    String(match.courtId ?? "") !== selectedCourt.id
  );
  if (!scheduleChanged) return state;
  const scheduleEditPolicy = getTournamentScheduleEditPolicy(match);
  if (!scheduleEditPolicy.allowed) {
    const body = scheduleEditPolicy.reason === "lineup_submitted"
      ? "한 팀이라도 출전 명단을 제출한 뒤에는 경기 일정을 변경할 수 없습니다."
      : scheduleEditPolicy.reason === "revision_limit"
        ? "경기 일정은 최초 지정 후 한 번만 변경할 수 있습니다."
        : "이미 시작·종료·취소·무효 처리된 경기는 일정을 변경할 수 없습니다.";
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "일정 수정 불가",
        body,
        tone: "match",
        matchId,
      }, ...state.notifications],
    };
  }
  if (isTournamentGovernanceEnabled(tournament)) {
    const referee = (state.users ?? []).find((user) => user.id === match.refereeId);
    const teamAId = match.teamA?.teamId ?? match.teamAId;
    const teamBId = match.teamB?.teamId ?? match.teamBId;
    const refereeAccepted = Boolean(match.refereeId)
      && getTournamentRefereeStatus(tournament, match.refereeId) === "accepted";
    const refereeEligible = refereeAccepted && isTournamentRefereeAuthorized(
      tournament,
      referee,
      state.settings?.refereeAppointments,
    );
    const refereeNeutral = refereeEligible
      && isTournamentRefereeNeutral(tournament, match.refereeId, teamAId, teamBId, state.teams);
    if (!refereeNeutral) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "일정 수정 불가",
          body: "자격이 유효한 승인 중립 심판을 먼저 배정해야 대회 경기 일정을 수정할 수 있습니다.",
          tone: "match",
          matchId,
        }, ...state.notifications],
      };
    }
    const refereeScheduleConflict = scheduledDate && scheduledTime && (state.matches ?? []).some((item) => (
      item.id !== match.id
      && item.refereeId === match.refereeId
      && doTournamentMatchSchedulesOverlap(match, item, { scheduledDate, scheduledTime })
      && !["confirmed", "cancelled", "void", "voided", "closed"].includes(item.status)
      && !item.endedAt
    ));
    if (refereeScheduleConflict) {
      return {
        ...state,
        notifications: [{
          id: makeId("n"),
          title: "일정 수정 불가",
          body: "배정 심판의 다른 경기와 일정이 겹칩니다.",
          tone: "match",
          matchId,
        }, ...state.notifications],
      };
    }
  }
  const now = new Date().toISOString();
  const scheduleRevisionCount = scheduleEditPolicy.revisionCount + (scheduleEditPolicy.hasSchedule ? 1 : 0);
  const updatedMatch = {
    ...match,
    scheduledDate,
    scheduledTime,
    scheduledAt: getScheduleText(scheduledDate, scheduledTime),
    courtId: selectedCourt.id,
    court: selectedCourt.name,
    rules: {
      ...(match.rules ?? {}),
      tournamentScheduleRevisionCount: scheduleRevisionCount,
      tournamentScheduleSetAt: match.rules?.tournamentScheduleSetAt ?? now,
      tournamentScheduleUpdatedAt: scheduleEditPolicy.hasSchedule ? now : null,
      lineupDeadlineState: "pending",
      lineupDeadlineCheckedAt: null,
    },
  };
  const captainNotifications = MATCH_SIDES.map((sideName) => {
    const teamId = match[sideName]?.teamId;
    const captainId = getTeamCaptainId(state.teams, teamId);
    if (!teamId || !captainId) return null;
    return {
      id: makeId("n"),
      title: scheduleEditPolicy.hasSchedule ? "대회 경기 일정 변경" : "대회 경기 일정 확정",
      body: `${updatedMatch.scheduledAt} 경기의 출전 선수와 후보 선수를 구성해 주세요.`,
      tone: "match",
      type: "tournament_match_schedule",
      discordEvent: "match",
      targetUserId: captainId,
      matchId,
      tournamentId,
      teamId,
      sideName,
      actionRequired: true,
      homeAction: true,
      webPath: `/app/matches?match=${encodeURIComponent(matchId)}`,
      createdAt: now,
    };
  }).filter(Boolean);

  return {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? updatedMatch : item)),
    notifications: [
      ...captainNotifications,
      {
        id: makeId("n"),
        title: scheduleEditPolicy.hasSchedule ? "대회 일정 수정" : "대회 일정 확정",
        body: scheduleEditPolicy.hasSchedule
          ? `${match.title} 경기 일정이 변경되었습니다. 새 일정: ${updatedMatch.scheduledAt}`
          : `${match.title} 경기 일정이 확정되었습니다: ${updatedMatch.scheduledAt}`,
        tone: "match",
        matchId,
      },
      ...state.notifications,
    ],
  };
}
export function assignTournamentMatchReferee(state, tournamentId, matchId, refereeId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = (state.matches ?? []).find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match || tournament.createdBy !== state.currentUserId || match.startedAt || match.endedAt) return state;
  if (getTournamentRefereeStatus(tournament, refereeId) !== "accepted") return state;
  if (!isTournamentRefereeAuthorized(
    tournament,
    state.users.find((user) => user.id === refereeId),
    state.settings?.refereeAppointments,
  )) return state;
  const teamAId = match.teamA?.teamId ?? match.teamAId;
  const teamBId = match.teamB?.teamId ?? match.teamBId;
  if (!isTournamentRefereeNeutral(tournament, refereeId, teamAId, teamBId, state.teams)) return state;
  if (match.scheduledDate && match.scheduledTime && (state.matches ?? []).some((item) => (
    item.id !== match.id
    && item.refereeId === refereeId
    && doTournamentMatchSchedulesOverlap(match, item)
    && !["confirmed", "cancelled", "void", "voided", "closed"].includes(item.status)
    && !item.endedAt
  ))) return state;
  return {
    ...state,
    matches: (state.matches ?? []).map((item) => (
      item.id === matchId ? { ...item, refereeId } : item
    )),
  };
}
export function forfeitTournamentMatch(state, tournamentId, matchId, losingSide, reason = "팀 불참") {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = (state.matches ?? []).find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match || !MATCH_SIDES.includes(losingSide)) return state;

  if (tournament.createdBy !== state.currentUserId) {
    return {
      ...state,
      notifications: [{ id: makeId("n"), title: "몰수 처리 불가", body: "대회 개최자만 불참을 확정할 수 있습니다.", tone: "match", matchId }, ...state.notifications],
    };
  }

  const scheduledAt = getMatchScheduledDate(match)?.getTime();
  const locked = ["confirmed", "cancelled", "void", "voided", "closed"].includes(match.status) || match.startedAt || match.endedAt || match.result;
  if (locked || !Number.isFinite(scheduledAt) || Date.now() < scheduledAt) {
    return {
      ...state,
      notifications: [{ id: makeId("n"), title: "몰수 처리 불가", body: "확정된 경기 시작 시각 이후, 시작 전 경기만 몰수 처리할 수 있습니다.", tone: "match", matchId }, ...state.notifications],
    };
  }

  const scoreA = losingSide === "teamA" ? 0 : 1;
  const scoreB = losingSide === "teamB" ? 0 : 1;
  const now = new Date().toISOString();
  const excludedPlayerIds = Array.from(new Set(
    MATCH_SIDES.flatMap((sideName) => getMatchSidePlayerIds(match, sideName)),
  ));
  const confirmedMatch = {
    ...match,
    status: "confirmed",
    result: {
      scoreA,
      scoreB,
      playerStats: {},
      statSubmissions: {},
      submittedBy: state.currentUserId,
      submittedAt: now,
    },
    teamA: { ...match.teamA, score: scoreA },
    teamB: { ...match.teamB, score: scoreB },
    forfeitSide: losingSide,
    forfeitReason: reason,
    forfeitedAt: now,
    forfeitedBy: state.currentUserId,
    mmrExcludedPlayerIds: excludedPlayerIds,
    rules: {
      ...(match.rules ?? {}),
      forfeit: { losingSide, reason, decidedBy: state.currentUserId, decidedAt: now, mmrCommitted: false },
    },
    endedAt: now,
    confirmedAt: now,
  };
  const winnerName = losingSide === "teamA" ? match.teamB?.name ?? "B팀" : match.teamA?.name ?? "A팀";
  const nextState = {
    ...state,
    matches: state.matches.map((item) => (item.id === matchId ? confirmedMatch : item)),
    notifications: [{
      id: makeId("n"),
      title: "대회 경기 몰수 확정",
      body: `${winnerName} 1:0 몰수승. MMR에는 반영하지 않습니다.`,
      tone: "match",
      type: "tournament_match_forfeit",
      matchId,
      tournamentId,
      createdAt: now,
    }, ...state.notifications],
  };
  return advanceTournamentAfterMatch(nextState, confirmedMatch);
}
