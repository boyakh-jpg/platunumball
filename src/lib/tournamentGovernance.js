import { REFEREE_TRUST_MIN } from "./constants.js";
import { isEligibleReferee } from "./matchUtils.js";

export const TOURNAMENT_COMMUNITY_RATING_SCALE = 0.8;

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
  return Number(tournament.rules?.governanceVersion ?? 0) === 2;
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
  const ineligibleRefereeId = refereeIds.find((refereeId) => (
    !isEligibleReferee(
      userById.get(refereeId),
      REFEREE_TRUST_MIN,
      refereeAppointments,
      tournament.endDate,
    )
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
