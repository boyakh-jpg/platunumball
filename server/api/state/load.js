import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient } from "../../../src/data/repository.js";

function toArray(value) {
  if (Array.isArray(value)) return value.flatMap(toArray);
  if (value && typeof value === "object") return Object.values(value).flatMap(toArray);
  return value ? [String(value)] : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

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
    match.refereeId,
    match.formerRefereeId,
    match.result?.submittedBy,
  ]);
}

function canReadMatch(match = {}, profileId = "", isAdmin = false) {
  if (isAdmin) return true;
  if ((match.visibility ?? "public") !== "private") return true;
  return getMatchActorIds(match).includes(profileId);
}

function sanitizeMatch(match = {}, profileId = "", isAdmin = false) {
  if (isAdmin || getMatchActorIds(match).includes(profileId)) return match;
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
      .filter((match) => canReadMatch(match, profileId, isAdmin))
      .map((match) => sanitizeMatch(match, profileId, isAdmin)),
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
      adminAuditLog: isAdmin ? state.settings?.adminAuditLog ?? [] : [],
      adminDisciplinaryActions: isAdmin
        ? state.settings?.adminDisciplinaryActions ?? []
        : (state.settings?.adminDisciplinaryActions ?? []).filter((action) => action.userId === profileId || action.targetUserId === profileId),
    },
  };
}

function getStateLoadOptions(body = {}, meta = {}) {
  const pagination = body.pagination && typeof body.pagination === "object" ? body.pagination : {};
  return {
    clientState: true,
    isAdmin: meta.isAdmin === true,
    scope: body.scope ?? pagination.scope,
    directoryScope: body.directoryScope ?? pagination.directoryScope,
    matchListOnly: body.matchListOnly ?? pagination.matches?.listOnly,
    matchLimit: body.matchLimit ?? pagination.matches?.limit,
    matchUpdatedBefore: body.matchUpdatedBefore ?? body.matchCursor ?? pagination.matches?.updatedBefore ?? pagination.matches?.cursor,
    recruitingLimit: body.recruitingLimit ?? pagination.recruiting?.limit,
    recruitingUpdatedBefore: body.recruitingUpdatedBefore ?? body.recruitingCursor ?? pagination.recruiting?.updatedBefore ?? pagination.recruiting?.cursor,
    tournamentLimit: body.tournamentLimit ?? pagination.tournaments?.limit,
    tournamentUpdatedBefore: body.tournamentUpdatedBefore ?? body.tournamentCursor ?? pagination.tournaments?.updatedBefore ?? pagination.tournaments?.cursor,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId ? await getAdminLevel(context) : 0;
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      getStateLoadOptions(body, { isAdmin: adminLevel >= 30 }),
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const state = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    sendJson(response, 200, { ok: true, state, updatedAt: normalized?.updatedAt ?? 0 });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "state_load_failed" });
  }
}
