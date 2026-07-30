import { DEFAULT_RATING } from "../../../lib/constants.js";
import { DEFAULT_TOURNAMENT_MMR_GAP } from "../../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../../lib/constants.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../../lib/tournamentGovernance.js";
import { getCourtId } from "../../../lib/courts.js";
import { getMatchRulesPayload } from "../../../lib/matchRules.js";
import { getRecruitingSideCapacity } from "../../../lib/recruiting.js";
import { getRegisteredCourts } from "../../../lib/courts.js";
import { getTeamCaptainId } from "../../../lib/matchUtils.js";
import { getTournamentRefereePoolValidation } from "../../../lib/tournamentGovernance.js";
import { getTournamentTeamStatuses } from "../../tournamentMappers.js";
import { isEligibleReferee } from "../../../lib/matchUtils.js";
import { isScheduleDateInAllowedWindow } from "../../scheduleUtils.js";
import { isTournamentGovernanceEnabled } from "../../../lib/tournamentGovernance.js";
import { makeId } from "../../rowUtils.js";
import { normalizeDisputeWindowMinutes } from "../../../lib/constants.js";
import { getDisciplineBlockedState, getInvalidScheduleNotification } from "../guards.js";
import { generateTournamentMatches, getLocalTournamentTeamSnapshot, getStateRepresentativeTeamId } from "../lifecycle.js";

export function createTournament(state, draft) {
  const disciplineBlock = getDisciplineBlockedState(state, "대회 생성");
  if (disciplineBlock) return disciplineBlock;
  const tournamentStartDate = draft.scheduledDate || draft.tournamentStartDate || "";
  const tournamentEndDate = draft.tournamentEndDate || tournamentStartDate;
  if (!isScheduleDateInAllowedWindow(tournamentStartDate) || !isScheduleDateInAllowedWindow(tournamentEndDate)) {
    return { ...state, notifications: [getInvalidScheduleNotification(), ...state.notifications] };
  }
  const teamIds = [...new Set(draft.teamIds ?? draft.tournamentTeamIds ?? [])]
    .filter((teamId) => state.teams.some((team) => team.id === teamId));
  const invitedTeams = teamIds.map((teamId) => state.teams.find((team) => team.id === teamId)).filter(Boolean);
  const mmrs = invitedTeams.map((team) => Number(team.mmr ?? DEFAULT_RATING));
  const mmrSpread = mmrs.length ? Math.max(...mmrs) - Math.min(...mmrs) : 0;
  const maxMmrGap = Number(draft.tournamentMaxMmrGap ?? draft.maxMmrGap ?? DEFAULT_TOURNAMENT_MMR_GAP);
  const mmrLimitMode = draft.mmrLimitMode ?? "warn";
  const sideCapacity = getRecruitingSideCapacity(draft);
  const tournamentRules = {
    ...(draft.rules ?? {}),
    ...getMatchRulesPayload({ ...(draft.rules ?? {}), ...draft }, { mode: draft.mode }),
    governanceVersion: 2,
    sanctionStatus: TOURNAMENT_SANCTION_STATUS.pending,
    sanctionFactor: 1,
    ratingScale: 1,
    disputeMinutes: normalizeDisputeWindowMinutes(Number.parseInt(draft.objectionWindow, 10) || draft.disputeMinutes),
    sideCapacity,
    mmrLimitMode,
    mmrRangeMode: draft.mmrRangeMode ?? draft.rules?.mmrRangeMode ?? "narrow",
    ageRestriction: draft.ageRestriction ?? draft.rules?.ageRestriction ?? "any",
    allowedAgeGroups: draft.allowedAgeGroups ?? draft.rules?.allowedAgeGroups ?? [],
    rosterReady: { teamA: false, teamB: false },
  };
  const tournamentTeamSnapshots = Object.fromEntries(invitedTeams.map((team) => [team.id, getLocalTournamentTeamSnapshot(state, team, {
    capacity: sideCapacity,
    ranked: draft.ranked,
    mmrLimitMode,
    mmrRangeMode: tournamentRules.mmrRangeMode,
    targetMmr: team.mmr,
    allowedAgeGroups: tournamentRules.allowedAgeGroups,
  })]));
  const creatorRepresentativeTeamId = getStateRepresentativeTeamId(state, state.currentUserId);
  const ineligibleTeam = invitedTeams.find((team) => !tournamentTeamSnapshots[team.id]?.allowed);
  const refereeIds = [...new Set(draft.refereeIds ?? draft.tournamentRefereeIds ?? [])]
    .filter((refereeId) => state.users.some((user) => user.id === refereeId));
  const organizer = state.users.find((user) => user.id === state.currentUserId);
  const organizerEligible = isEligibleReferee(
    organizer,
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournamentEndDate,
  );
  const refereePoolValidation = getTournamentRefereePoolValidation({
    tournament: {
      teamIds,
      refereeIds,
      endDate: tournamentEndDate,
      rules: { teamRosterSnapshot: { teams: tournamentTeamSnapshots } },
    },
    teams: invitedTeams,
    users: state.users,
    refereeAppointments: state.settings?.refereeAppointments,
  });

  if (teamIds.length < 2) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "대회 생성 불가",
          body: "비공개 대회는 최소 2개 팀을 초대해야 합니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  if (draft.ranked !== false && mmrLimitMode === "block" && mmrSpread > maxMmrGap) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "MMR 제한",
          body: `초대 팀 MMR 차이 ${mmrSpread}점이 제한 ${maxMmrGap}점을 넘었습니다.`,
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  if (!creatorRepresentativeTeamId || !teamIds.includes(creatorRepresentativeTeamId) || getTeamCaptainId(state.teams, creatorRepresentativeTeamId) !== state.currentUserId) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "대표팀 필요",
        body: "대회 생성자는 자신이 팀장인 대표팀으로만 참가할 수 있습니다.",
        tone: "match",
      }, ...state.notifications],
    };
  }

  if (!organizerEligible) {
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "심판 자격 필요",
        body: `대회 주최자는 신뢰도 ${REFEREE_TRUST_MIN} 이상인 자격심판이어야 합니다.`,
        tone: "match",
      }, ...state.notifications],
    };
  }

  if (!refereePoolValidation.allowed) {
    const body = refereePoolValidation.refereeIds.length < refereePoolValidation.requiredCount
      ? `${teamIds.length}팀 대회는 자격심판 ${refereePoolValidation.requiredCount}명 이상을 초대해야 합니다.`
      : refereePoolValidation.ineligibleRefereeId
        ? "자격 또는 신뢰도 조건을 충족하지 못한 심판이 포함되어 있습니다."
        : "모든 가능한 대진에 양 팀과 무관한 중립 심판을 배정할 수 있어야 합니다.";
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "심판 구성 필요",
        body,
        tone: "match",
      }, ...state.notifications],
    };
  }

  if (ineligibleTeam) {
    const eligibility = tournamentTeamSnapshots[ineligibleTeam.id];
    return {
      ...state,
      notifications: [{
        id: makeId("n"),
        title: "대회 참가 제한",
        body: `${ineligibleTeam.name}: 대표팀 기준 참가 가능 선수가 ${eligibility.eligibleCount}/${eligibility.capacity}명입니다.`,
        tone: "match",
      }, ...state.notifications],
    };
  }

  const createdAt = new Date().toISOString();
  const ranked = draft.ranked !== false;
  tournamentRules.teamRosterSnapshot = {
    version: 1,
    capturedAt: createdAt,
    teams: tournamentTeamSnapshots,
  };
  const teamStatuses = Object.fromEntries(
    teamIds.map((teamId) => [
      teamId,
      teamId === creatorRepresentativeTeamId ? "accepted" : "invited",
    ]),
  );
  const teamApprovals = Object.fromEntries(
    teamIds
      .filter((teamId) => teamStatuses[teamId] === "accepted")
      .map((teamId) => [teamId, { by: state.currentUserId, approvedAt: createdAt }]),
  );
  const refereeStatuses = Object.fromEntries(
    refereeIds.map((refereeId) => [
      refereeId,
      refereeId === state.currentUserId ? "accepted" : "invited",
    ]),
  );
  const refereeApprovals = state.currentUserId && refereeStatuses[state.currentUserId] === "accepted"
    ? { [state.currentUserId]: { by: state.currentUserId, approvedAt: createdAt } }
    : {};
  const selectedCourt = getRegisteredCourts(state).find((court) => court.name === draft.court || court.id === getCourtId(draft)) ?? null;
  const tournament = {
    id: draft.id || makeId("trn"),
    title: draft.title?.trim() || `${draft.mode || "5v5"} 비공개 대회`,
    format: draft.tournamentFormat ?? "league",
    visibility: "private",
    status: "draft",
    region: selectedCourt?.region ?? draft.region ?? state.users.find((user) => user.id === state.currentUserId)?.region ?? "전체",
    courtId: selectedCourt?.id ?? getCourtId(draft),
    court: draft.court || "미정",
    mode: draft.mode || "5v5",
    ranked,
    official: false,
    startDate: tournamentStartDate,
    endDate: tournamentEndDate,
    schedulePolicy: draft.tournamentSchedulePolicy ?? "weekly",
    scheduleNote: draft.tournamentScheduleNote?.trim() || "초대팀 확정 후 경기별 일정을 배정합니다.",
    mmrLimitMode,
    maxMmrGap,
    mmrPolicy: draft.tournamentMmrPolicy ?? "gap_adjusted",
    rules: tournamentRules,
    memo: draft.memo || "비공개 초대 대회입니다.",
    createdBy: state.currentUserId,
    createdAt,
    teamIds,
    teamStatuses,
    teamApprovals,
    refereeIds,
    refereeStatuses,
    refereeApprovals,
    sanctionStatus: TOURNAMENT_SANCTION_STATUS.pending,
    matchIds: [],
    bracket: null,
  };

  return {
    ...state,
    tournaments: [tournament, ...(state.tournaments ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "대회 생성",
        body: `${tournament.title} 대회방을 만들었습니다. ${teamIds.length}팀·심판 ${refereeIds.length}명 승인을 기다립니다.`,
        tone: "match",
        tournamentId: tournament.id,
      },
      ...state.notifications,
    ],
  };
}
export function getLocalTournamentReadiness(state, tournament) {
  const allTeamsAccepted = (tournament.teamIds ?? []).length >= 2
    && (tournament.teamIds ?? []).every((teamId) => getTournamentTeamStatuses(tournament)[teamId] === "accepted");
  const organizerEligible = !isTournamentGovernanceEnabled(tournament) || isEligibleReferee(
    (state.users ?? []).find((user) => user.id === tournament.createdBy),
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournament.endDate,
  );
  const refereePool = getTournamentRefereePoolValidation({
    tournament,
    teams: state.teams,
    users: state.users,
    refereeAppointments: state.settings?.refereeAppointments,
    requireAccepted: true,
  });
  return {
    ready: allTeamsAccepted && organizerEligible && refereePool.allowed,
    allTeamsAccepted,
    organizerEligible,
    refereePool,
  };
}
export function approveTournamentTeam(state, tournamentId, teamId, options = {}) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  if (!tournament || tournament.status !== "draft" || !(tournament.teamIds ?? []).includes(teamId)) return state;

  const captainId = getTeamCaptainId(state.teams, teamId);
  if (captainId !== state.currentUserId || getStateRepresentativeTeamId(state, state.currentUserId) !== teamId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "대회 승인 불가",
          body: "해당 팀을 대표팀으로 둔 팀장만 대회 참가를 승인할 수 있습니다.",
          tone: "match",
        },
        ...state.notifications,
      ],
    };
  }

  const now = new Date().toISOString();
  const teamStatuses = { ...getTournamentTeamStatuses(tournament), [teamId]: "accepted" };
  const teamApprovals = {
    ...(tournament.teamApprovals ?? {}),
    [teamId]: { by: state.currentUserId, approvedAt: now },
  };
  const approvedTournament = { ...tournament, teamStatuses, teamApprovals };
  if (!isTournamentGovernanceEnabled(approvedTournament)) {
    const allAccepted = (approvedTournament.teamIds ?? []).every((id) => teamStatuses[id] === "accepted");
    const generated = allAccepted
      ? generateTournamentMatches(state, approvedTournament, { preferredMatchIds: options.preferredMatchIds })
      : { matches: [], tournament: approvedTournament };
    return {
      ...state,
      matches: generated.matches.length ? [...generated.matches, ...state.matches] : state.matches,
      tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? generated.tournament : item)),
      notifications: [{
        id: makeId("n"),
        title: allAccepted ? "대회 시작" : "대회 참가 승인",
        body: allAccepted
          ? `${tournament.title} 대회가 시작됐습니다. 경기 ${generated.matches.length}개 생성.`
          : `${tournament.title} 참가 승인 완료. 남은 팀 승인을 기다립니다.`,
        tone: "match",
        tournamentId: tournament.id,
      }, ...state.notifications],
    };
  }
  const readiness = getLocalTournamentReadiness(state, approvedTournament);
  const nextTournament = {
    ...approvedTournament,
    sanctionStatus: readiness.ready
      ? TOURNAMENT_SANCTION_STATUS.regionalPending
      : TOURNAMENT_SANCTION_STATUS.pending,
  };

  return {
    ...state,
    tournaments: (state.tournaments ?? []).map((item) => (item.id === tournamentId ? nextTournament : item)),
    notifications: [
      {
        id: makeId("n"),
        title: readiness.ready ? "지역 승인 대기" : "대회 참가 승인",
        body: readiness.ready
          ? `${tournament.title} 팀장·심판 승인이 완료되어 지역관리자 승인을 기다립니다.`
          : `${tournament.title} 참가 승인 완료. 남은 팀장·심판 승인을 기다립니다.`,
        tone: "match",
        tournamentId: tournament.id,
      },
      ...state.notifications,
    ],
  };
}
