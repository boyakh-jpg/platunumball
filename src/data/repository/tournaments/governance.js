import { ADMIN_GRADE_META } from "../../../lib/admin.js";
import { DEFAULT_RATING } from "../../../lib/constants.js";
import { DEFAULT_TOURNAMENT_MMR_GAP } from "../../../lib/constants.js";
import { MATCH_SIDES } from "../../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { ROOM_SCHEDULE_MAX_DAYS } from "../../../lib/constants.js";
import { SCHEDULE_MAX_DAYS } from "../../../lib/constants.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { doTournamentMatchSchedulesOverlap } from "../../../lib/tournamentGovernance.js";
import { getAdminAuthorityLevel } from "../../../lib/admin.js";
import { getCourtId } from "../../../lib/courts.js";
import { getMatchRulesPayload } from "../../../lib/matchRules.js";
import { getMatchScheduledDate } from "../../../lib/matchUtils.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { getScheduleText } from "../../scheduleUtils.js";
import { getTeamCaptainId } from "../../../lib/matchUtils.js";
import { getTournamentRefereePoolValidation } from "../../../lib/tournamentGovernance.js";
import { getTournamentRefereeStatus } from "../../../lib/tournamentGovernance.js";
import { getTournamentScheduleEditPolicy } from "../../../lib/matchUtils.js";
import { getTournamentTeamStatuses } from "../../tournamentMappers.js";
import { isAppointmentActive } from "../../../lib/admin.js";
import { isEligibleReferee } from "../../../lib/matchUtils.js";
import { isSameRegion } from "../../../lib/constants.js";
import { isScheduleDateInAllowedWindow } from "../../scheduleUtils.js";
import { isTournamentGovernanceEnabled } from "../../../lib/tournamentGovernance.js";
import { isTournamentRefereeNeutral } from "../../../lib/tournamentGovernance.js";
import { makeId } from "../../rowUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { getDisciplineBlockedState, getInvalidScheduleNotification } from "../guards.js";
import { advanceTournamentAfterMatch, generateTournamentMatches, getLocalTournamentTeamSnapshot, getStateRepresentativeTeamId } from "../lifecycle.js";
import { getServerRatingValue } from "../runtime.js";
import { getLocalTournamentReadiness } from "./creation.js";

export function approveTournamentReferee(state, tournamentId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (!tournament || !["draft", "active"].includes(tournament.status)) return state;
  const refereeId = state.currentUserId;
  if (!(tournament.refereeIds ?? []).includes(refereeId)) return state;
  const referee = state.users.find((user) => user.id === refereeId);
  if (!isEligibleReferee(
    referee,
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournament.endDate,
  )) return state;

  const now = new Date().toISOString();
  const approvedTournament = {
    ...tournament,
    refereeStatuses: { ...(tournament.refereeStatuses ?? {}), [refereeId]: "accepted" },
    refereeApprovals: {
      ...(tournament.refereeApprovals ?? {}),
      [refereeId]: { by: refereeId, approvedAt: now },
    },
  };
  const readiness = getLocalTournamentReadiness(state, approvedTournament);
  const nextTournament = {
    ...approvedTournament,
    sanctionStatus: tournament.status === "draft" && readiness.ready
      ? TOURNAMENT_SANCTION_STATUS.regionalPending
      : tournament.sanctionStatus,
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? nextTournament : item)),
    notifications: [{
      id: makeId("n"),
      title: readiness.ready ? "지역 승인 대기" : "대회 심판 승인",
      body: readiness.ready
        ? `${tournament.title} 팀장·심판 승인이 완료되어 지역관리자 승인을 기다립니다.`
        : `${tournament.title} 심판 참여를 승인했습니다.`,
      tone: "match",
      tournamentId,
    }, ...state.notifications],
  };
}
export function declineTournamentReferee(state, tournamentId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const refereeId = state.currentUserId;
  const currentStatus = tournament ? getTournamentRefereeStatus(tournament, refereeId) : "";
  if (
    !tournament
    || !["draft", "active"].includes(tournament.status)
    || !(tournament.refereeIds ?? []).includes(refereeId)
    || (tournament.status === "active" && currentStatus === "accepted")
  ) {
    return state;
  }
  const declinedTournament = {
    ...tournament,
    refereeStatuses: { ...(tournament.refereeStatuses ?? {}), [refereeId]: "declined" },
    refereeApprovals: Object.fromEntries(
      Object.entries(tournament.refereeApprovals ?? {}).filter(([id]) => id !== refereeId),
    ),
  };
  const readiness = getLocalTournamentReadiness(state, declinedTournament);
  const nextTournament = {
    ...declinedTournament,
    sanctionStatus: tournament.status === "draft"
      ? readiness.ready ? TOURNAMENT_SANCTION_STATUS.regionalPending : TOURNAMENT_SANCTION_STATUS.pending
      : tournament.sanctionStatus,
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? nextTournament : item)),
    matches: (state.matches ?? []).map((match) => (
      match.tournamentId === tournamentId && match.refereeId === refereeId && !match.startedAt && !match.endedAt
        ? { ...match, refereeId: "" }
        : match
    )),
  };
}
export function inviteTournamentReferee(state, tournamentId, refereeId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const referee = (state.users ?? []).find((user) => user.id === refereeId);
  if (
    !tournament
    || tournament.createdBy !== state.currentUserId
    || !["draft", "active"].includes(tournament.status)
    || !isEligibleReferee(
      referee,
      REFEREE_TRUST_MIN,
      state.settings?.refereeAppointments,
      tournament.endDate,
    )
  ) {
    return state;
  }
  const invitedTournament = {
    ...tournament,
    refereeIds: [...new Set([...(tournament.refereeIds ?? []), refereeId])],
    refereeStatuses: { ...(tournament.refereeStatuses ?? {}), [refereeId]: "invited" },
    refereeApprovals: Object.fromEntries(
      Object.entries(tournament.refereeApprovals ?? {}).filter(([id]) => id !== refereeId),
    ),
    sanctionStatus: tournament.status === "draft"
      ? TOURNAMENT_SANCTION_STATUS.pending
      : tournament.sanctionStatus,
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? invitedTournament : item)),
    notifications: [{
      id: makeId("n"),
      title: "대회 심판 초대",
      body: `${tournament.title} 심판으로 초대했습니다.`,
      tone: "match",
      tournamentId,
      targetUserId: refereeId,
    }, ...state.notifications],
  };
}
function currentUserCanReviewTournamentRegion(state, tournament) {
  const authorityLevel = getAdminAuthorityLevel(state);
  if (authorityLevel >= ADMIN_GRADE_META.senior.level) return true;
  if (authorityLevel < ADMIN_GRADE_META.regionManager.level) return false;
  const currentUser = (state.users ?? []).find((user) => user.id === state.currentUserId);
  const regionalAppointment = (state.settings?.adminAppointments ?? []).find((appointment) => (
    appointment.source === "server_context"
    && appointment.userId === state.currentUserId
    && appointment.role === "admin"
    && appointment.grade === "regionManager"
    && isAppointmentActive(appointment)
  ));
  const assignedRegion = regionalAppointment?.payload?.region
    ?? regionalAppointment?.region
    ?? currentUser?.region;
  return isSameRegion(assignedRegion, tournament?.region ?? tournament?.rules?.region);
}
export function activateTournamentSanction(state, tournamentId, sanctionStatus, reviewerId = "") {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (!tournament || tournament.status !== "draft") return state;
  if (![TOURNAMENT_SANCTION_STATUS.approved, TOURNAMENT_SANCTION_STATUS.community].includes(sanctionStatus)) return state;
  if (
    sanctionStatus === TOURNAMENT_SANCTION_STATUS.approved
      ? !currentUserCanReviewTournamentRegion(state, tournament)
      : tournament.createdBy !== state.currentUserId
  ) return state;
  const readiness = getLocalTournamentReadiness(state, tournament);
  if (!readiness.ready) return state;
  const official = sanctionStatus === TOURNAMENT_SANCTION_STATUS.approved;
  const ratingScale = getServerRatingValue("getTournamentRatingScale", official);
  const now = new Date().toISOString();
  const approvedTournament = {
    ...tournament,
    official,
    sanctionStatus,
    sanctionReviewedBy: reviewerId || null,
    sanctionReviewedAt: reviewerId ? now : null,
    rules: {
      ...(tournament.rules ?? {}),
      sanctionStatus,
      sanctionFactor: ratingScale,
      ratingScale,
    },
  };
  const generated = generateTournamentMatches(state, approvedTournament);
  return {
    ...state,
    matches: generated.matches.length ? [...generated.matches, ...state.matches] : state.matches,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? generated.tournament : item)),
    notifications: [{
      id: makeId("n"),
      title: official ? "공식 대회 시작" : "지역 비승인 대회 시작",
      body: official
        ? `${tournament.title} 지역 승인이 완료되어 공식 대회가 시작됐습니다.`
        : `${tournament.title} 지역 비승인 대회가 시작됐습니다. MMR은 0.8 계수로 반영됩니다.`,
      tone: "match",
      tournamentId,
    }, ...state.notifications],
  };
}
export function rejectTournamentRegion(state, tournamentId, note = "") {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (
    !tournament
    || tournament.status !== "draft"
    || !isTournamentGovernanceEnabled(tournament)
    || !currentUserCanReviewTournamentRegion(state, tournament)
  ) return state;
  const readiness = getLocalTournamentReadiness(state, tournament);
  if (!readiness.ready) return state;
  const now = new Date().toISOString();
  const rejectedTournament = {
    ...tournament,
    official: false,
    sanctionStatus: TOURNAMENT_SANCTION_STATUS.regionalRejected,
    sanctionReviewedBy: state.currentUserId,
    sanctionReviewedAt: now,
    sanctionReviewNote: String(note ?? "").trim().slice(0, 500),
    rules: {
      ...(tournament.rules ?? {}),
      sanctionStatus: TOURNAMENT_SANCTION_STATUS.regionalRejected,
    },
  };
  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (
      item.id === tournamentId ? rejectedTournament : item
    )),
    notifications: [{
      id: makeId("n"),
      title: "대회 지역 비승인",
      body: `${tournament.title}은 지역 비승인 대회로 개최할 수 있습니다. 필수 심판 조건은 그대로 유지됩니다.`,
      tone: "match",
      tournamentId,
      targetUserId: tournament.createdBy,
    }, ...state.notifications],
  };
}
