import {
  acceptRecruitingInvitation,
  addMatchLatePlayer,
  agreeMatch,
  approveMatch,
  cancelMatch,
  cancelRecruitingParticipation,
  checkInMatchPlayer,
  closeRecruitingPost,
  confirmMatchRefereeAbsence,
  confirmRecruitingMatch,
  createMatch,
  createRecruitingPost,
  createTournament,
  declineRecruitingInvitation,
  detachRecruitingPartyPlayer,
  disputeMatch,
  endMatch,
  handoffMatchRecorder,
  interestRecruitingPost,
  inviteRecruitingPlayers,
  inviteRecruitingReferee,
  joinRecruitingSideParty,
  kickRecruitingApplicant,
  loadNormalizedRemoteStateFromClient,
  removeMatchLatePlayer,
  removeMatchRoomPlayer,
  removeRecruitingPartyPlayer,
  requestMatchRefereeAbsence,
  resumeMatchApproval,
  sendRecruitingChat,
  approveTournamentTeam,
  setMatchRoomPlayerPlacement,
  setRecruitingApplicantPlacement,
  setRecruitingApplicantReserve,
  setRecruitingPartyPlayerPlacement,
  setRecruitingPartyPlayerReserve,
  setRecruitingTeamPartyRoster,
  setRecruitingReady,
  setRecruitingSlotPosition,
  setRecruitingStatRecorder,
  startMatch,
  submitMatchResult,
  submitMatchThumbs,
  toggleMatchStar,
  updateMatchRoomRules,
  updateRecruitingRoomRules,
  updateTournamentMatchSchedule,
  voidMatch,
} from "../../src/data/repository.js";

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

export function getMatchRatingCommit(beforeState = {}, afterState = {}, match = null, action = "") {
  if (!["approveMatch", "autoConfirmMatch", "resumeMatchApproval"].includes(action) || match?.status !== "confirmed" || !match?.ratingResult) return null;
  const beforeUsersById = new Map((beforeState.users ?? []).map((user) => [user.id, user]));
  const beforeTeamsById = new Map((beforeState.teams ?? []).map((team) => [team.id, team]));
  const ratingChangeByPlayerId = new Map((match.ratingResult ?? []).map((change) => [change.playerId, change]));
  const profileUpdates = (afterState.users ?? [])
    .filter((user) => {
      const before = beforeUsersById.get(user.id);
      const ratingChange = ratingChangeByPlayerId.get(user.id);
      return before && (
        ratingChange ||
        Number(before.trustScore ?? 80) !== Number(user.trustScore ?? 80)
      );
    })
    .map((user) => ({
      id: user.id,
      trustDelta: Number(user.trustScore ?? 80) - Number(beforeUsersById.get(user.id)?.trustScore ?? 80),
      streakResult: ratingChangeByPlayerId.get(user.id)?.result ?? null,
    }));
  const teamUpdates = (afterState.teams ?? [])
    .filter((team) => {
      const before = beforeTeamsById.get(team.id);
      return before && (
        Number(before.mmr ?? 1200) !== Number(team.mmr ?? 1200) ||
        Number(before.wins ?? 0) !== Number(team.wins ?? 0) ||
        Number(before.losses ?? 0) !== Number(team.losses ?? 0)
      );
    })
    .map((team) => ({
      id: team.id,
      mmrDelta: Number(team.mmr ?? 1200) - Number(beforeTeamsById.get(team.id)?.mmr ?? 1200),
      winDelta: Number(team.wins ?? 0) - Number(beforeTeamsById.get(team.id)?.wins ?? 0),
      lossDelta: Number(team.losses ?? 0) - Number(beforeTeamsById.get(team.id)?.losses ?? 0),
    }));
  return {
    matchId: match.id,
    ratingResult: match.ratingResult,
    teamRatingResult: match.teamRatingResult ?? {},
    confirmedAt: match.confirmedAt ?? new Date().toISOString(),
    profileUpdates,
    teamUpdates,
  };
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
  const scope = action.includes("Recruiting") ? "recruiting" : undefined;
  const invite = operation.invite && typeof operation.invite === "object" ? operation.invite : {};
  const draft = operation.draft && typeof operation.draft === "object" ? operation.draft : {};
  const application = operation.application && typeof operation.application === "object" ? operation.application : {};
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
    matchIds: [
      operation.matchId,
      operation.preferredMatchId,
      operation.draft?.id,
    ].filter(Boolean),
    teamIds: [
      operation.teamId,
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
      operation.targetUserId,
      operation.invitation?.targetUserId,
      invite.playerId,
      ...(Array.isArray(invite.playerIds) ? invite.playerIds : []),
      ...(Array.isArray(operation.roster?.playerIds) ? operation.roster.playerIds : []),
      ...(Array.isArray(operation.roster?.reservePlayerIds) ? operation.roster.reservePlayerIds : []),
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
  const beforePosts = state.recruitingPosts ?? [];
  const beforeMatches = state.matches ?? [];
  let next = state;

  switch (action) {
    case "createRecruitingPost":
      next = createRecruitingPost(state, {
        ...(operation.draft ?? {}),
        id: operation.preferredPostId || operation.postId || operation.draft?.id,
      });
      break;
    case "interestRecruitingPost":
      next = interestRecruitingPost(state, operation.postId, operation.application ?? {});
      break;
    case "inviteRecruitingReferee":
      next = inviteRecruitingReferee(state, operation.postId, operation.refereeId);
      break;
    case "inviteRecruitingPlayers":
      next = inviteRecruitingPlayers(state, operation.postId, operation.invite ?? {});
      break;
    case "acceptRecruitingInvitation":
      next = acceptRecruitingInvitation(state, operation.postId, operation.invitationId);
      break;
    case "declineRecruitingInvitation":
      next = declineRecruitingInvitation(state, operation.postId, operation.invitationId);
      break;
    case "cancelRecruitingParticipation":
      next = cancelRecruitingParticipation(state, operation.postId);
      break;
    case "setRecruitingReady":
      next = setRecruitingReady(state, operation.postId, operation.ready);
      break;
    case "updateRecruitingRoomRules":
      next = updateRecruitingRoomRules(state, operation.postId, operation.patch ?? {});
      break;
    case "sendRecruitingChat":
      next = sendRecruitingChat(state, operation.postId, operation.body);
      break;
    case "setRecruitingApplicantReserve":
      next = setRecruitingApplicantReserve(state, operation.postId, operation.playerId, operation.reserve);
      break;
    case "setRecruitingApplicantPlacement":
      next = setRecruitingApplicantPlacement({ ...state, currentUserId: operation.playerId || state.currentUserId }, operation.postId, operation.playerId, operation.placement);
      break;
    case "joinRecruitingSideParty":
      next = joinRecruitingSideParty(state, operation.postId, operation.teamId, operation.sideName, operation.entryId);
      break;
    case "setRecruitingSlotPosition":
      next = setRecruitingSlotPosition(state, operation.postId, operation.playerId, operation.position);
      break;
    case "setRecruitingPartyPlayerReserve":
      next = setRecruitingPartyPlayerReserve(state, operation.postId, operation.entryId, operation.playerId, operation.reserve);
      break;
    case "setRecruitingPartyPlayerPlacement":
      next = setRecruitingPartyPlayerPlacement(state, operation.postId, operation.entryId, operation.playerId, operation.placement);
      break;
    case "setRecruitingTeamPartyRoster":
      next = setRecruitingTeamPartyRoster(state, operation.postId, operation.entryId, operation.roster ?? {});
      break;
    case "detachRecruitingPartyPlayer":
      next = detachRecruitingPartyPlayer({ ...state, currentUserId: operation.playerId || state.currentUserId }, operation.postId, operation.entryId, operation.playerId, operation.placement);
      break;
    case "removeRecruitingPartyPlayer":
      next = removeRecruitingPartyPlayer(state, operation.postId, operation.entryId, operation.playerId);
      break;
    case "setRecruitingStatRecorder":
      next = setRecruitingStatRecorder(state, operation.postId, operation.sideName, operation.playerId);
      break;
    case "kickRecruitingApplicant":
      next = kickRecruitingApplicant(state, operation.postId, operation.playerId);
      break;
    case "confirmRecruitingMatch":
      next = confirmRecruitingMatch(state, operation.postId, { matchId: operation.preferredMatchId || operation.matchId });
      break;
    case "closeRecruitingPost":
      next = closeRecruitingPost(state, operation.postId);
      break;
    default:
      reject(400, "unsupported_recruiting_operation");
  }

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
  const beforeMatches = state.matches ?? [];
  let next = state;

  switch (action) {
    case "createMatch":
      next = createMatch(state, {
        ...(operation.draft ?? {}),
        id: operation.preferredMatchId || operation.matchId || operation.draft?.id,
      });
      break;
    case "updateTournamentMatchSchedule":
      next = updateTournamentMatchSchedule(state, operation.tournamentId, operation.matchId, operation.schedule ?? {});
      break;
    case "agreeMatch":
      next = agreeMatch(state, operation.matchId, operation.sideName, operation.playerId);
      break;
    case "submitMatchResult":
      next = submitMatchResult(state, operation.matchId, operation.result ?? {});
      break;
    case "handoffMatchRecorder":
      next = handoffMatchRecorder(state, operation.matchId, operation.sideName, operation.nextRecorderId);
      break;
    case "approveMatch":
      next = approveMatch(state, operation.matchId, operation.sideName, operation.playerId);
      break;
    case "checkInMatchPlayer":
      next = checkInMatchPlayer(state, operation.matchId, operation.sideName, operation.playerId);
      break;
    case "requestMatchRefereeAbsence":
      next = requestMatchRefereeAbsence(state, operation.matchId);
      break;
    case "confirmMatchRefereeAbsence":
      next = confirmMatchRefereeAbsence(state, operation.matchId);
      break;
    case "toggleMatchStar":
      next = toggleMatchStar(state, operation.matchId, operation.targetUserId);
      break;
    case "submitMatchThumbs":
      next = submitMatchThumbs(state, operation.matchId, operation.targetUserIds ?? []);
      break;
    case "disputeMatch":
      next = disputeMatch(state, operation.matchId, operation.reason);
      break;
    case "cancelMatch":
      next = cancelMatch(state, operation.matchId);
      break;
    case "voidMatch":
      next = voidMatch(state, operation.matchId);
      break;
    case "resumeMatchApproval":
      next = resumeMatchApproval(state, operation.matchId, operation.resultDraft ?? null);
      break;
    case "startMatch":
      next = startMatch(state, operation.matchId);
      break;
    case "endMatch":
      next = endMatch(state, operation.matchId);
      break;
    case "addMatchLatePlayer":
      next = addMatchLatePlayer(state, operation.matchId, operation.draft ?? {});
      break;
    case "removeMatchLatePlayer":
      next = removeMatchLatePlayer(state, operation.matchId, operation.playerId);
      break;
    case "updateMatchRoomRules":
      next = updateMatchRoomRules(state, operation.matchId, operation.patch ?? {});
      break;
    case "setMatchRoomPlayerPlacement":
      next = setMatchRoomPlayerPlacement(state, operation.matchId, operation.playerId, operation.placement);
      break;
    case "removeMatchRoomPlayer":
      next = removeMatchRoomPlayer(state, operation.matchId, operation.playerId);
      break;
    default:
      reject(400, "unsupported_match_operation");
  }

  const match = operation.matchId || operation.preferredMatchId
    ? (next.matches ?? []).find((item) => item.id === (operation.matchId || operation.preferredMatchId)) ?? null
    : getCreatedItem(beforeMatches, next.matches ?? []);
  if (!match || next === state) reject(409, "match_operation_noop");

  const notifications = getNewItems(state.notifications ?? [], next.notifications ?? [], (notification) => notification.matchId === match.id);
  return { nextState: next, match, notifications, ratingCommit: getMatchRatingCommit(state, next, match, action) };
}

export function applyAuthoritativeTournamentOperation(state, operation = {}) {
  const action = String(operation.action || "");
  const beforeTournaments = state.tournaments ?? [];
  const beforeMatches = state.matches ?? [];
  let next = state;

  switch (action) {
    case "createTournament":
      next = createTournament(state, {
        ...(operation.draft ?? {}),
        id: operation.preferredTournamentId || operation.tournamentId || operation.draft?.id,
        preferredMatchIds: operation.preferredMatchIds ?? operation.draft?.preferredMatchIds,
      });
      break;
    case "approveTournamentTeam":
      next = approveTournamentTeam(state, operation.tournamentId, operation.teamId, {
        preferredMatchIds: operation.preferredMatchIds,
      });
      break;
    default:
      reject(400, "unsupported_tournament_operation");
  }

  const tournament = operation.tournamentId || operation.preferredTournamentId
    ? (next.tournaments ?? []).find((item) => item.id === (operation.tournamentId || operation.preferredTournamentId)) ?? null
    : getCreatedItem(beforeTournaments, next.tournaments ?? []);
  if (!tournament || next === state) reject(409, "tournament_operation_noop");

  const createdMatches = getNewItems(beforeMatches, next.matches ?? [], (match) => match.tournamentId === tournament.id);
  const notifications = getNewItems(state.notifications ?? [], next.notifications ?? [], (notification) => (
    (!notification.matchId && (notification.type === "tournament" || notification.tone === "match" || !notification.targetUserId)) ||
    (notification.matchId && createdMatches.some((match) => match.id === notification.matchId))
  ));

  return { nextState: next, tournament, createdMatches, notifications };
}
