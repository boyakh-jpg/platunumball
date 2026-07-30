import { ADMIN_GRADE_META } from "../../lib/admin.js";
import { DEFAULT_RATING } from "../../lib/constants.js";
import { DEFAULT_TOURNAMENT_MMR_GAP } from "../../lib/constants.js";
import { MATCH_SIDES } from "../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../lib/constants.js";
import { ROOM_SCHEDULE_MAX_DAYS } from "../../lib/constants.js";
import { SCHEDULE_MAX_DAYS } from "../../lib/constants.js";
import { TOURNAMENT_SANCTION_STATUS } from "../../lib/tournamentGovernance.js";
import { doTournamentMatchSchedulesOverlap } from "../../lib/tournamentGovernance.js";
import { getAdminAuthorityLevel } from "../../lib/admin.js";
import { getCourtId } from "../../lib/courts.js";
import { getMatchRulesPayload } from "../../lib/matchRules.js";
import { getMatchScheduledDate } from "../../lib/matchUtils.js";
import { getRecruitingSideCapacity } from "../../lib/recruiting.js";
import { getRegisteredCourts } from "../../lib/courts.js";
import { getScheduleText } from "../scheduleUtils.js";
import { getTeamCaptainId } from "../../lib/matchUtils.js";
import { getTournamentRefereePoolValidation } from "../../lib/tournamentGovernance.js";
import { getTournamentRefereeStatus } from "../../lib/tournamentGovernance.js";
import { getTournamentScheduleEditPolicy } from "../../lib/matchUtils.js";
import { getTournamentTeamStatuses } from "../tournamentMappers.js";
import { isAppointmentActive } from "../../lib/admin.js";
import { isEligibleReferee } from "../../lib/matchUtils.js";
import { isSameRegion } from "../../lib/constants.js";
import { isScheduleDateInAllowedWindow } from "../scheduleUtils.js";
import { isTournamentGovernanceEnabled } from "../../lib/tournamentGovernance.js";
import { isTournamentRefereeNeutral } from "../../lib/tournamentGovernance.js";
import { makeId } from "../rowUtils.js";
import { normalizeDisputeWindowMinutes } from "../../lib/constants.js";
import { getDisciplineBlockedState, getInvalidScheduleNotification } from "./guards.js";
import { advanceTournamentAfterMatch, generateTournamentMatches, getLocalTournamentTeamSnapshot, getStateRepresentativeTeamId } from "./lifecycle.js";
import { getServerRatingValue } from "./runtime.js";

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

function getLocalTournamentReadiness(state, tournament) {
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
    const refereeEligible = refereeAccepted && isEligibleReferee(
      referee,
      REFEREE_TRUST_MIN,
      state.settings?.refereeAppointments,
      tournament.endDate,
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

export function assignTournamentMatchReferee(state, tournamentId, matchId, refereeId) {
  const tournament = (state.tournaments ?? []).find((item) => item.id === tournamentId);
  const match = (state.matches ?? []).find((item) => item.id === matchId && item.tournamentId === tournamentId);
  if (!tournament || !match || tournament.createdBy !== state.currentUserId || match.startedAt || match.endedAt) return state;
  if (getTournamentRefereeStatus(tournament, refereeId) !== "accepted") return state;
  if (!isEligibleReferee(
    state.users.find((user) => user.id === refereeId),
    REFEREE_TRUST_MIN,
    state.settings?.refereeAppointments,
    tournament.endDate,
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
  const excludedPlayerIds = Array.from(new Set([
    ...(match.teamA?.players ?? []).map((player) => player.id),
    ...(match.teamB?.players ?? []).map((player) => player.id),
  ].filter(Boolean)));
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
