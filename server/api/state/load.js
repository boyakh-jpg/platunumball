import { flattenIdValues as toArray, getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson, uniqueValues as unique } from "../_supabaseAdmin.js";
import { loadCurrentProfileState, PROFILE_ME_COLUMNS } from "../profile/me.js";
import { loadNormalizedDirectoryStateFromClient } from "../../../src/data/repository.js";

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
  if ((match.visibility ?? "public") !== "private") return true;
  if (isUserTeamMatch(match, userTeamIds)) return true;
  return getMatchActorIds(match).includes(profileId);
}

function sanitizeMatch(match = {}, profileId = "", isAdmin = false, userTeamIds = []) {
  if (isAdmin || isUserTeamMatch(match, userTeamIds) || getMatchActorIds(match).includes(profileId)) return match;
  return {
    ...match,
    disputes: [],
    disputeDraftResult: null,
    disputeDraftUpdatedAt: null,
    disputeResolvedAt: null,
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
    testPassword: _testPassword,
    ...publicUser
  } = user;
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
    recruitingPosts: (state.recruitingPosts ?? []).filter((post) => canReadRecruitingPost(post, profileId, isAdmin)),
    tournaments: (state.tournaments ?? []).filter((tournament) => canReadTournament(tournament, profileId, userTeamIds, isAdmin)),
    reports: isAdmin
      ? state.reports ?? []
      : (state.reports ?? []).filter((report) => (
        report.by === profileId ||
        report.targetId === profileId ||
        (report.reportedUserIds ?? []).includes(profileId)
      )),
    discordNotificationDeliveries: (state.discordNotificationDeliveries ?? []).filter((delivery) => delivery.targetUserId === profileId),
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
        : (state.settings?.refereeRequests ?? []).filter((request) => request.requestedBy === profileId || request.userId === profileId),
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
        : (state.settings?.adminDisciplinaryActions ?? []).filter((action) => action.userId === profileId || action.targetUserId === profileId),
    },
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS });
    const requestedScope = String(body.scope ?? body.pagination?.scope ?? "").trim();
    if (requestedScope && !["profile", "admin"].includes(requestedScope)) {
      sendJson(response, 410, {
        error: "state_scope_deprecated",
        message: "Use screen-specific endpoints instead of broad /api/state/load scope.",
      });
      return;
    }
    if (requestedScope === "admin") {
      const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
      if (adminLevel < 30) {
        sendJson(response, 403, { error: "admin_required" });
        return;
      }
      const result = await loadNormalizedDirectoryStateFromClient(
        context.supabase,
        context.authUserId,
        context.authUser?.email ?? "",
        { isAdmin: true },
      );
      sendJson(response, 200, { ok: true, state: result.state, updatedAt: result.updatedAt ?? 0 });
      return;
    }
    const result = await loadCurrentProfileState(context, { includeTeamMemberProfiles: false });
    sendJson(response, 200, { ok: true, state: result.state, updatedAt: result.updatedAt ?? 0 });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "state_load_failed" });
  }
}
