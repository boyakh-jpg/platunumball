import { REFEREE_ACTIVE_TRUST_MIN, REFEREE_TRUST_MIN } from "./constants.js";
import { isEligibleReferee } from "./matchUtils.js";

export const TOURNAMENT_SANCTION_STATUS = Object.freeze({
  pending: "pending",
  regionalPending: "regional_pending",
  regionalRejected: "regional_rejected",
  approved: "approved",
  community: "community",
});

export const TOURNAMENT_REFEREE_STATUS = Object.freeze({
  invited: "invited",
  accepted: "accepted",
  declined: "declined",
});

export function isTournamentGovernanceEnabled(tournament = {}) {
  return Number(tournament?.rules?.governanceVersion ?? 0) === 2;
}

export function getRequiredTournamentRefereeCount(teamCount = 0) {
  const count = Math.max(0, Number(teamCount) || 0);
  if (count >= 9) return 4;
  if (count >= 5) return 3;
  return count >= 2 ? 2 : 0;
}

export function getTournamentRefereeStatus(tournament = {}, refereeId = "") {
  return tournament.refereeStatuses?.[refereeId] ?? TOURNAMENT_REFEREE_STATUS.invited;
}

export function getActiveTournamentTeamIds(tournament = {}) {
  return [...new Set(tournament.teamIds ?? [])]
    .filter(Boolean)
    .filter((teamId) => tournament.teamStatuses?.[teamId] !== "declined");
}

export function getAcceptedTournamentRefereeIds(tournament = {}) {
  return (tournament.refereeIds ?? []).filter(
    (refereeId) => getTournamentRefereeStatus(tournament, refereeId) === TOURNAMENT_REFEREE_STATUS.accepted,
  );
}

function getSnapshotMemberIds(tournament = {}, teamId = "") {
  const snapshot = tournament.rules?.teamRosterSnapshot?.teams?.[teamId];
  if (!snapshot || typeof snapshot !== "object") return [];
  if (Array.isArray(snapshot.representativeMemberIds)) return snapshot.representativeMemberIds.filter(Boolean);
  return (snapshot.members ?? []).map((member) => member?.userId ?? member?.user_id).filter(Boolean);
}

export function getTournamentTeamMemberIds(tournament = {}, team = null, teamId = "") {
  return new Set([
    ...(team?.members ?? []).map((member) => member?.userId ?? member?.user_id).filter(Boolean),
    ...getSnapshotMemberIds(tournament, teamId || team?.id),
  ]);
}

export function isTournamentRefereeNeutral(
  tournament = {},
  refereeId = "",
  teamAId = "",
  teamBId = "",
  teams = [],
) {
  if (!refereeId || !teamAId || !teamBId || teamAId === teamBId) return false;
  const teamById = teams instanceof Map ? teams : new Map((teams ?? []).map((team) => [team.id, team]));
  return !getTournamentTeamMemberIds(tournament, teamById.get(teamAId), teamAId).has(refereeId)
    && !getTournamentTeamMemberIds(tournament, teamById.get(teamBId), teamBId).has(refereeId);
}

export function getTournamentUncoveredTeamPairs(tournament = {}, teams = [], refereeIds = null) {
  const teamIds = getActiveTournamentTeamIds(tournament);
  const acceptedRefereeIds = refereeIds ?? getAcceptedTournamentRefereeIds(tournament);
  const uncovered = [];
  for (let left = 0; left < teamIds.length - 1; left += 1) {
    for (let right = left + 1; right < teamIds.length; right += 1) {
      const teamAId = teamIds[left];
      const teamBId = teamIds[right];
      if (!acceptedRefereeIds.some((refereeId) => (
        isTournamentRefereeNeutral(tournament, refereeId, teamAId, teamBId, teams)
      ))) {
        uncovered.push({ teamAId, teamBId });
      }
    }
  }
  return uncovered;
}

export function isTournamentRefereeAuthorized(
  tournament = {},
  user = {},
  refereeAppointments = [],
) {
  if (!user?.id) return false;
  if (isEligibleReferee(
    user,
    REFEREE_TRUST_MIN,
    refereeAppointments,
    tournament.endDate,
  )) return true;
  const hasTrustAutoRevocation = refereeAppointments.some((appointment) => {
    const payload = appointment.payload && typeof appointment.payload === "object"
      ? appointment.payload
      : {};
    const startedMs = new Date(tournament.startedAt).getTime();
    const revokedMs = new Date(appointment.revokedAt ?? payload.revokedAt ?? "").getTime();
    return (
      (appointment.userId ?? appointment.user_id) === user.id
      && (appointment.role ?? "referee") === "referee"
      && appointment.status === "revoked"
      && (appointment.autoRevoked ?? payload.autoRevoked) === true
      && (appointment.revokeReason ?? payload.revokeReason) === "referee_trust_below_70"
      && Number.isFinite(startedMs)
      && Number.isFinite(revokedMs)
      && startedMs <= revokedMs
    );
  });
  return (
    Number(user?.trustScore ?? 0) < REFEREE_ACTIVE_TRUST_MIN
    && hasTrustAutoRevocation
    && tournament.status === "active"
    && (tournament.refereeIds ?? []).includes(user.id)
    && getTournamentRefereeStatus(tournament, user.id) === "accepted"
  );
}

export function getTournamentRefereePoolValidation({
  tournament = {},
  teams = [],
  users = [],
  refereeAppointments = [],
  requireAccepted = false,
} = {}) {
  const refereeIds = requireAccepted
    ? getAcceptedTournamentRefereeIds(tournament)
    : [...new Set(tournament.refereeIds ?? [])].filter(Boolean);
  const requiredCount = getRequiredTournamentRefereeCount(getActiveTournamentTeamIds(tournament).length);
  const userById = new Map((users ?? []).map((user) => [user.id, user]));
  const ineligibleRefereeId = refereeIds.find((refereeId) => !isTournamentRefereeAuthorized(
    tournament,
    userById.get(refereeId),
    refereeAppointments,
  ));
  const uncoveredPairs = getTournamentUncoveredTeamPairs(tournament, teams, refereeIds);
  return {
    allowed: refereeIds.length >= requiredCount && !ineligibleRefereeId && uncoveredPairs.length === 0,
    refereeIds,
    requiredCount,
    ineligibleRefereeId: ineligibleRefereeId ?? "",
    uncoveredPairs,
  };
}

export function getTournamentSanctionLabel(tournament = {}) {
  const sanctionStatus = tournament.sanctionStatus ?? TOURNAMENT_SANCTION_STATUS.pending;
  if (sanctionStatus === TOURNAMENT_SANCTION_STATUS.approved) return "지역 승인 공식 대회";
  if (sanctionStatus === TOURNAMENT_SANCTION_STATUS.community) return "지역 비승인 대회";
  if (sanctionStatus === TOURNAMENT_SANCTION_STATUS.regionalPending) return "지역관리자 승인 대기";
  if (sanctionStatus === TOURNAMENT_SANCTION_STATUS.regionalRejected) return "지역 비승인";
  return "팀장·심판 승인 대기";
}

export function getTournamentMatchScheduleDurationMinutes(match = {}) {
  const rules = match.rules ?? {};
  const periodCount = Math.min(4, Math.max(1, Number(rules.periodCount ?? 1) || 1));
  const periodMinutes = Math.min(60, Math.max(1, Number(rules.periodMinutes ?? rules.timeLimit ?? 12) || 12));
  const periodBreakMinutes = Math.min(30, Math.max(0, Number(rules.periodBreakMinutes ?? 2) || 0));
  const halftimeMinutes = Math.min(30, Math.max(0, Number(rules.halftimeMinutes ?? 5) || 0));
  const overtimeMinutes = Math.min(20, Math.max(0, Number(rules.overtimeMinutes ?? 3) || 0));
  const breakMinutes = periodCount === 4
    ? periodBreakMinutes * 2 + halftimeMinutes
    : periodCount === 2 ? halftimeMinutes : 0;
  return Math.min(90, Math.max(15, periodCount * periodMinutes + breakMinutes + overtimeMinutes + 5));
}

export function getTournamentMatchScheduleWindow(match = {}, schedule = {}) {
  const scheduledDate = String(schedule.scheduledDate ?? match.scheduledDate ?? "").slice(0, 10);
  const scheduledTime = String(schedule.scheduledTime ?? match.scheduledTime ?? "").slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^\d{2}:\d{2}$/.test(scheduledTime)) return null;
  const startMs = new Date(`${scheduledDate}T${scheduledTime}:00+09:00`).getTime();
  if (!Number.isFinite(startMs)) return null;
  return {
    startMs,
    endMs: startMs + getTournamentMatchScheduleDurationMinutes(match) * 60_000,
  };
}

export function doTournamentMatchSchedulesOverlap(leftMatch = {}, rightMatch = {}, leftSchedule = {}) {
  const left = getTournamentMatchScheduleWindow(leftMatch, leftSchedule);
  const right = getTournamentMatchScheduleWindow(rightMatch);
  return Boolean(left && right && left.startMs < right.endMs && right.startMs < left.endMs);
}
