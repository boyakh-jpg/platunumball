import {
  configureServerRatingAuthority,
  confirmRecruitingMatch,
  createMatch,
  loadNormalizedRemoteStateFromClient,
} from "../lib/repositoryAdapter.js";
import { SERVER_RATING_AUTHORITY } from "../lib/ratingAuthority.js";

configureServerRatingAuthority(SERVER_RATING_AUTHORITY);

function reject(statusCode, message, details = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.details = details;
  throw error;
}

function getNewItems(beforeItems = [], afterItems = [], predicate = () => true) {
  const beforeIds = new Set(beforeItems.map((item) => item.id).filter(Boolean));
  return afterItems.filter((item) => item?.id && !beforeIds.has(item.id) && predicate(item));
}

function getCreatedItem(beforeItems = [], afterItems = []) {
  const beforeIds = new Set(beforeItems.map((item) => item.id).filter(Boolean));
  return afterItems.find((item) => item?.id && !beforeIds.has(item.id)) ?? null;
}

export function getOperation(body = {}, fallbackAction = "sync") {
  const operation = body.operation && typeof body.operation === "object" && !Array.isArray(body.operation)
    ? body.operation
    : null;
  if (!operation) return null;
  return { ...operation, action: String(operation.action || fallbackAction) };
}

function getAuthoritativeLoadScope(operation = {}) {
  if (!operation || typeof operation !== "object") return {};
  const action = String(operation.action || "");
  if (action === "approveMatch") return { clientState: true };
  if (action === "loadTournament") {
    return {
      scope: "tournaments",
      tournamentIds: [operation.tournamentId].filter(Boolean),
    };
  }
  const isRecruitingAction = action.includes("Recruiting");
  const isTournamentAction = action.includes("Tournament");
  const invite = operation.invite && typeof operation.invite === "object" ? operation.invite : {};
  const draft = operation.draft && typeof operation.draft === "object" ? operation.draft : {};
  const application = operation.application && typeof operation.application === "object" ? operation.application : {};
  const matchIds = [
    operation.matchId,
    operation.preferredMatchId,
    operation.draft?.id,
  ].filter(Boolean);
  const scope = isRecruitingAction
    ? "recruiting"
    : (!isTournamentAction && action !== "createMatch" && matchIds.length ? "matches" : undefined);
  const needsCurrentUserTeams = scope === "recruiting" && (
    action === "loadRecruitingPost"
      ? false
      : action === "createRecruitingPost"
        ? draft.hostJoinMode === "team" || Boolean(draft.teamId || draft.teamAId || draft.opponentTeamId || draft.targetTeamId)
        : action === "interestRecruitingPost"
          ? application.joinMode === "team" || Boolean(application.teamId)
          : true
  );
  return {
    scope,
    includeCurrentUserTeams: needsCurrentUserTeams,
    includeLinkedRecruitingPost: action === "loadMatch",
    matchIds,
    teamIds: [
      operation.teamId,
      operation.setup?.teamAId,
      operation.setup?.teamBId,
      operation.draft?.teamId,
      operation.draft?.teamAId,
      operation.draft?.opponentTeamId,
      operation.draft?.targetTeamId,
      operation.application?.teamId,
      operation.invite?.teamId,
      operation.roster?.teamId,
    ].filter(Boolean),
    profileIds: [
      operation.refereeId,
      operation.playerId,
      operation.activePlayerId,
      operation.reservePlayerId,
      operation.targetUserId,
      ...(Array.isArray(operation.targetUserIds) ? operation.targetUserIds : []),
      operation.invitation?.targetUserId,
      invite.playerId,
      ...(Array.isArray(invite.playerIds) ? invite.playerIds : []),
      ...(Array.isArray(operation.roster?.playerIds) ? operation.roster.playerIds : []),
      ...(Array.isArray(operation.roster?.reservePlayerIds) ? operation.roster.reservePlayerIds : []),
      ...(Array.isArray(operation.setup?.teamAPlayerIds) ? operation.setup.teamAPlayerIds : []),
      ...(Array.isArray(operation.setup?.teamBPlayerIds) ? operation.setup.teamBPlayerIds : []),
      ...(Array.isArray(operation.draft?.soloTeamAPlayerRefs)
        ? operation.draft.soloTeamAPlayerRefs.map((ref) => ref?.profileId)
        : []),
      ...(Array.isArray(operation.draft?.soloTeamBPlayerRefs)
        ? operation.draft.soloTeamBPlayerRefs.map((ref) => ref?.profileId)
        : []),
    ].filter(Boolean),
    recruitingPostIds: [
      operation.postId,
      operation.preferredPostId,
      operation.draft?.id,
    ].filter(Boolean),
    tournamentIds: [
      operation.tournamentId,
      operation.preferredTournamentId,
      operation.draft?.id,
    ].filter(Boolean),
  };
}

export async function loadAuthoritativeState(context, options = {}) {
  const result = await loadNormalizedRemoteStateFromClient(
    context.supabase,
    context.authUserId,
    context.authUser?.email ?? "",
    getAuthoritativeLoadScope(options.operation),
  );
  return {
    ...(result?.state ?? {}),
    currentUserId: context.profileId,
  };
}

export function applyAuthoritativeRecruitingOperation(state, operation = {}) {
  const action = String(operation.action || "");
  if (action !== "confirmRecruitingMatch") reject(400, "unsupported_recruiting_operation");
  const beforePosts = state.recruitingPosts ?? [];
  const beforeMatches = state.matches ?? [];
  const next = confirmRecruitingMatch(
    state,
    operation.postId,
    { matchId: operation.preferredMatchId || operation.matchId },
  );

  const post = operation.postId || operation.preferredPostId
    ? (next.recruitingPosts ?? []).find((item) => item.id === (operation.postId || operation.preferredPostId)) ?? null
    : getCreatedItem(beforePosts, next.recruitingPosts ?? []);
  if (!post || next === state) reject(409, "recruiting_operation_noop");

  const createdMatch = getCreatedItem(beforeMatches, next.matches ?? []);
  const allNewNotifications = getNewItems(state.notifications ?? [], next.notifications ?? []);
  const notifications = allNewNotifications.filter((notification) => (
    notification.recruitingPostId === post.id ||
    notification.invitationId ||
    (createdMatch && notification.matchId === createdMatch.id)
  ));
  const beforePost = beforePosts.find((item) => item.id === post.id) ?? null;
  if (beforePost && JSON.stringify(beforePost) === JSON.stringify(post)) {
    const notification = notifications[0] ?? allNewNotifications[0] ?? null;
    reject(409, "recruiting_operation_blocked", {
      notification,
      title: notification?.title ?? "",
      message: notification?.body ?? "",
    });
  }

  return { nextState: next, post, createdMatch, notifications, baseUpdatedAt: beforePost?.updatedAt ?? null };
}

export function applyAuthoritativeMatchOperation(state, operation = {}) {
  const action = String(operation.action || "");
  if (action !== "createMatch") reject(400, "unsupported_match_operation");
  const beforeMatches = state.matches ?? [];
  const next = createMatch(state, {
    ...(operation.draft ?? {}),
    id: operation.preferredMatchId || operation.matchId || operation.draft?.id,
  });

  const match = operation.matchId || operation.preferredMatchId
    ? (next.matches ?? []).find((item) => item.id === (operation.matchId || operation.preferredMatchId)) ?? null
    : getCreatedItem(beforeMatches, next.matches ?? []);
  if (!match || next === state) reject(409, "match_operation_noop");

  const allNewNotifications = getNewItems(state.notifications ?? [], next.notifications ?? []);
  const notifications = allNewNotifications.filter((notification) => notification.matchId === match.id);
  return {
    nextState: next,
    match,
    notifications,
    tournament: null,
    createdTournamentMatches: [],
    tournamentNotifications: [],
    ratingCommit: null,
    trustCommit: null,
  };
}
