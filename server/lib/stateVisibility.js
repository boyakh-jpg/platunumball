import {
  flattenIdValues as toArray,
  uniqueValues as unique,
} from "../api/_supabaseAdmin.js";
import { isPubliclyReadableConfirmedMatch } from "../../shared/lib/matchRecordTypes.js";

function getMatchActorIds(match = {}) {
  return unique([
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...toArray(match.reservePlayers),
    ...toArray(match.playedPlayerIds),
    ...toArray(match.statRecorders),
    ...toArray(match.agreements),
    ...toArray(match.approvals),
    ...(match.disputes ?? []).map((dispute) => dispute.by),
    match.createdBy,
    match.rules?.tournamentOrganizerId,
    match.refereeId,
    match.formerRefereeId,
    match.result?.submittedBy,
  ]);
}

function isUserTeamMatch(match = {}, userTeamIds = []) {
  const teamIds = new Set(userTeamIds);
  return teamIds.has(match.teamA?.teamId) || teamIds.has(match.teamB?.teamId);
}

function canReadMatch(match = {}, profileId = "", isAdmin = false, userTeamIds = []) {
  if (isAdmin) return true;
  if (isPubliclyReadableConfirmedMatch(match)) return true;
  if ((match.visibility ?? "public") !== "private") return true;
  if (["solo", "personal_record"].includes(String(match.rules?.recordType ?? "").trim().toLowerCase())) {
    return match.createdBy === profileId;
  }
  if (isUserTeamMatch(match, userTeamIds)) return true;
  return getMatchActorIds(match).includes(profileId);
}

function sanitizeMatch(match = {}, profileId = "", isAdmin = false, userTeamIds = []) {
  if (isAdmin || isUserTeamMatch(match, userTeamIds) || getMatchActorIds(match).includes(profileId)) {
    return match;
  }
  return {
    ...match,
    disputes: [],
    disputeDraftResult: null,
    disputeDraftUpdatedAt: null,
    disputeResolvedAt: null,
  };
}

export function projectPublicMatch(match = {}) {
  if (!isPubliclyReadableConfirmedMatch(match)) return null;

  const publicFields = [
    "id",
    "title",
    "mode",
    "courtId",
    "court",
    "visibility",
    "scheduledDate",
    "scheduledTime",
    "scheduledAt",
    "timingType",
    "status",
    "official",
    "preRegistered",
    "ranked",
    "ratingScale",
    "refereeId",
    "tournamentId",
    "tournamentFormat",
    "tournamentRound",
    "tournamentFixture",
    "tournamentMmrPolicy",
    "forfeitSide",
    "forfeitReason",
    "forfeitedAt",
    "voidReason",
    "voidedAt",
    "teamA",
    "teamB",
    "playedPlayerIds",
    "reservePlayers",
    "anonymousPlayers",
    "ratingResult",
    "teamRatingResult",
    "createdAt",
    "updatedAt",
    "confirmedAt",
    "completedAt",
  ];
  const publicMatch = Object.fromEntries(
    publicFields
      .filter((field) => Object.prototype.hasOwnProperty.call(match, field))
      .map((field) => [field, match[field]]),
  );
  const result = match.result && typeof match.result === "object" ? { ...match.result } : match.result;
  if (result && typeof result === "object") delete result.submittedBy;
  const rules = match.rules && typeof match.rules === "object" ? { ...match.rules } : match.rules;
  if (rules && typeof rules === "object") delete rules.tournamentOrganizerId;

  return {
    ...publicMatch,
    ...(result === undefined ? {} : { result }),
    ...(rules === undefined ? {} : { rules }),
  };
}

function getRecruitingReaderIds(post = {}) {
  const invitations = Array.isArray(post.roomState?.invitations) ? post.roomState.invitations : [];
  return unique([
    post.playerId,
    ...(post.playerIds ?? []),
    post.refereeId,
    post.roomState?.ownerId,
    ...toArray(post.roomState?.partyLeaders),
    ...toArray(post.roomState?.partyReserves),
    ...toArray(post.roomState?.pinnedReservePlayers),
    ...toArray(post.roomState?.reserveReady),
    ...(post.applicants ?? []).flatMap((applicant) => [
      applicant.playerId,
      ...(applicant.playerIds ?? []),
    ]),
    ...invitations.flatMap((invitation) => [
      invitation.targetUserId,
      invitation.fromUserId,
      ...(invitation.playerIds ?? []),
    ]),
  ]);
}

function canReadRecruitingPost(post = {}, profileId = "", isAdmin = false) {
  if (isAdmin) return true;
  if ((post.visibility ?? "public") !== "private") return true;
  return getRecruitingReaderIds(post).includes(profileId);
}

function getUserTeamIds(teams = [], profileId = "") {
  return teams
    .filter((team) => (team.members ?? []).some((member) => member.userId === profileId))
    .map((team) => team.id);
}

function canReadTournament(tournament = {}, profileId = "", userTeamIds = [], isAdmin = false) {
  if (isAdmin) return true;
  if ((tournament.visibility ?? "private") === "public") return true;
  if (tournament.createdBy === profileId) return true;
  return (tournament.teamIds ?? []).some((teamId) => userTeamIds.includes(teamId));
}

function sanitizeUser(user = {}, profileId = "", isAdmin = false) {
  if (isAdmin || user.id === profileId) return user;
  const {
    authUserId: _authUserId,
    birthYear: _birthYear,
    ...publicUser
  } = user;
  return publicUser;
}

export function projectPublicUser(user = {}) {
  const publicUser = {};
  [
    "id",
    "name",
    "handle",
    "hashtag",
    "position",
    "region",
    "regionSido",
    "regionDistrict",
    "trustScore",
    "streak",
    "avatarColor",
    "ratings",
    "ageGroup",
    "ageGroupCheckedSeason",
    "onboardingComplete",
    "updatedAt",
    "avatarKey",
    "avatarSource",
    "avatarIconKey",
    "avatarUpdatedAt",
    "avatarBackgroundEnabled",
    "avatarBorderEnabled",
    "avatarBorderColor",
    "discordAvatarUrl",
    "affiliationId",
    "foundingPlayer",
  ].forEach((key) => {
    if (user[key] !== undefined) publicUser[key] = user[key];
  });
  return publicUser;
}

export function filterStateForProfile(state = {}, profileId = "", isAdmin = false) {
  const userTeamIds = getUserTeamIds(state.teams ?? [], profileId);
  return {
    ...state,
    users: (state.users ?? []).map((user) => sanitizeUser(user, profileId, isAdmin)),
    matches: (state.matches ?? [])
      .filter((match) => canReadMatch(match, profileId, isAdmin, userTeamIds))
      .map((match) => sanitizeMatch(match, profileId, isAdmin, userTeamIds)),
    recruitingPosts: (state.recruitingPosts ?? []).filter((post) => (
      canReadRecruitingPost(post, profileId, isAdmin)
    )),
    tournaments: (state.tournaments ?? []).filter((tournament) => (
      canReadTournament(tournament, profileId, userTeamIds, isAdmin)
    )),
    reports: isAdmin
      ? state.reports ?? []
      : (state.reports ?? []).filter((report) => (
        report.by === profileId
        || report.targetId === profileId
        || (report.reportedUserIds ?? []).includes(profileId)
      )),
    discordNotificationDeliveries: (state.discordNotificationDeliveries ?? []).filter((delivery) => (
      delivery.targetUserId === profileId
    )),
    settings: {
      ...(state.settings ?? {}),
      courtRequests: isAdmin
        ? state.settings?.courtRequests ?? []
        : (state.settings?.courtRequests ?? []).filter((request) => request.requestedBy === profileId),
      courtReviews: isAdmin
        ? state.settings?.courtReviews ?? []
        : (state.settings?.courtReviews ?? []).filter((review) => (review.status ?? "active") === "active"),
      approvedCourts: isAdmin
        ? state.settings?.approvedCourts ?? []
        : (state.settings?.approvedCourts ?? []).filter((court) => (court.status ?? "active") === "active"),
      refereeRequests: isAdmin
        ? state.settings?.refereeRequests ?? []
        : (state.settings?.refereeRequests ?? []).filter((request) => (
          request.requestedBy === profileId || request.userId === profileId
        )),
      refereeExamAttempts: isAdmin
        ? state.settings?.refereeExamAttempts ?? []
        : (state.settings?.refereeExamAttempts ?? []).filter((attempt) => attempt.userId === profileId),
      adminAppointments: isAdmin
        ? state.settings?.adminAppointments ?? []
        : (state.settings?.adminAppointments ?? []).filter((appointment) => appointment.userId === profileId),
      refereeAppointments: isAdmin
        ? state.settings?.refereeAppointments ?? []
        : (state.settings?.refereeAppointments ?? []).filter((appointment) => appointment.userId === profileId),
      adminAuditLog: isAdmin ? state.settings?.adminAuditLog ?? [] : [],
      adminDisciplinaryActions: isAdmin
        ? state.settings?.adminDisciplinaryActions ?? []
        : (state.settings?.adminDisciplinaryActions ?? []).filter((action) => (
          action.userId === profileId || action.targetUserId === profileId
        )),
    },
  };
}
