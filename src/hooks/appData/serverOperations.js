function sortByRating(items, selector) {
  return [...items].sort((a, b) => selector(b) - selector(a));
}

function isPersistentAuthUserId(authUserId) {
  return Boolean(authUserId && !String(authUserId).startsWith("test-"));
}

function makeClientNotificationId(prefix = "n") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function getServerActionErrorText(error = {}) {
  return String(error.details?.message || error.details?.notification?.body || error.details?.reason || error.code || error.message || "server_action_failed");
}

function getNewItems(before = [], after = []) {
  const beforeIds = new Set((before ?? []).map((item) => item?.id).filter(Boolean));
  return (after ?? []).filter((item) => item?.id && !beforeIds.has(item.id));
}

function getClientProfileShellId(authUserId = "") {
  const safeId = String(authUserId || "pending").replace(/[^a-zA-Z0-9]/g, "").slice(0, 18) || "pending";
  return `p_${safeId}`;
}

function isPersistentProfileId(userId = "") {
  return /^p_[a-z0-9]/i.test(String(userId || ""));
}

function getActionActorDebug(state = {}, currentUserId = "") {
  const actor = (state.users ?? []).find((user) => user.id === currentUserId) ?? null;
  return {
    currentUserId,
    actorName: actor?.name ?? "",
    trustScore: actor?.trustScore ?? "",
    authBound: Boolean(actor?.authUserId),
  };
}

const SERVER_OPERATION_ACTIONS = new Set([
  "createMatch",
  "createTournament",
  "approveTournamentTeam",
  "approveTournamentReferee",
  "declineTournamentReferee",
  "inviteTournamentReferee",
  "approveTournamentRegion",
  "rejectTournamentRegion",
  "startCommunityTournament",
  "assignTournamentMatchReferee",
  "loadTournament",
  "updateTournamentMatchSchedule",
  "forfeitTournamentMatch",
  "agreeMatch",
  "submitMatchResult",
  "substituteMatchPlayer",
  "incrementMatchScore",
  "finalizeMatch",
  "approveMatch",
  "checkInMatchPlayer",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "confirmPickupSideAssignment",
  "generatePickupSideAssignment",
  "toggleMatchStar",
  "submitMatchThumbs",
  "disputeMatch",
  "cancelMatch",
  "deleteSoloRecord",
  "voidMatch",
  "resolveMatchDispute",
  "startMatch",
  "endMatch",
  "updateMatchRoomRules",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "setMatchRecordParticipants",
  "setMatchRecordTeamRoster",
  "removeMatchRoomPlayer",
  "createRecruitingPost",
  "interestRecruitingPost",
  "setRecruitingRoomTeam",
  "inviteRecruitingReferee",
  "inviteRecruitingPlayers",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "cancelRecruitingParticipation",
  "updateRecruitingRoomRules",
  "acknowledgeRecruitingRoomRules",
  "respondRecruitingScheduleProposal",
  "acknowledgeMatchRoomRules",
  "respondMatchScheduleProposal",
  "sendRecruitingChat",
  "setRecruitingApplicantReserve",
  "setRecruitingApplicantPlacement",
  "joinRecruitingSideParty",
  "setRecruitingSlotPosition",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "kickRecruitingApplicant",
  "confirmRecruitingMatch",
  "closeRecruitingPost",
]);

const MATCH_OPERATION_ONLY_ACTIONS = new Set([
  "agreeMatch",
  "approveMatch",
  "cancelMatch",
  "checkInMatchPlayer",
  "confirmMatchRefereeAbsence",
  "confirmPickupSideAssignment",
  "generatePickupSideAssignment",
  "deleteSoloRecord",
  "disputeMatch",
  "endMatch",
  "requestMatchRefereeAbsence",
  "incrementMatchScore",
  "finalizeMatch",
  "resolveMatchDispute",
  "startMatch",
  "submitMatchThumbs",
  "submitMatchResult",
  "substituteMatchPlayer",
  "toggleMatchStar",
  "updateTournamentMatchSchedule",
  "forfeitTournamentMatch",
  "removeMatchRoomPlayer",
  "setMatchRecordParticipants",
  "setMatchRecordTeamRoster",
  "setMatchRoomPlayerPlacement",
  "swapPickupMatchPlayers",
  "updateMatchRoomRules",
  "acknowledgeMatchRoomRules",
  "respondMatchScheduleProposal",
  "voidMatch",
]);

const RECRUITING_OPERATION_ONLY_ACTIONS = new Set([
  "acceptRecruitingInvitation",
  "cancelRecruitingParticipation",
  "closeRecruitingPost",
  "confirmRecruitingMatch",
  "declineRecruitingInvitation",
  "detachRecruitingPartyPlayer",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "interestRecruitingPost",
  "setRecruitingRoomTeam",
  "joinRecruitingSideParty",
  "kickRecruitingApplicant",
  "removeRecruitingPartyPlayer",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingSlotPosition",
  "setRecruitingTeamPartyRoster",
  "updateRecruitingRoomRules",
  "acknowledgeRecruitingRoomRules",
  "respondRecruitingScheduleProposal",
]);

function getServerOperation(meta = {}) {
  if (meta.operation) {
    const explicitAction = String(meta.operation.action || meta.action || "");
    return SERVER_OPERATION_ACTIONS.has(explicitAction) ? meta.operation : null;
  }
  if (!meta.action) return null;
  if (!SERVER_OPERATION_ACTIONS.has(String(meta.action))) return null;
  const { operation: _operation, onSuccess: _onSuccess, optimisticBeforeServerCheck: _optimisticBeforeServerCheck, ...payload } = meta;
  return payload;
}

export {
  MATCH_OPERATION_ONLY_ACTIONS,
  RECRUITING_OPERATION_ONLY_ACTIONS,
  getActionActorDebug,
  getClientProfileShellId,
  getNewItems,
  getServerActionErrorText,
  getServerOperation,
  isPersistentAuthUserId,
  isPersistentProfileId,
  makeClientNotificationId,
  sortByRating,
};
