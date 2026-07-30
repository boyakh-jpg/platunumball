import { isSupportedMatchMode } from "../../../shared/lib/matchConstants.js";
import { nullableText, toArray } from "../_supabaseAdmin.js";
import { isValidBenchCapacity } from "../../../shared/lib/constants.js";
import { addTeamRoster, assertProfilesExist, assertTeamRosterMembers } from "../_rosterEligibility.js";
import { normalizeRecruitingMmrRangeMode } from "../../../shared/lib/recruiting.js";
import { getAgeGroupByBirthYear } from "../../../shared/lib/profileSetup.js";
import { isActiveReferee } from "../../lib/refereeEligibilityPolicy.js";

import {
  getCanonicalBenchCapacity, getCanonicalHostJoinMode, getExplicitBenchCapacity,
  getRecruitingBenchIdsBySide, getRecruitingCoreSnapshot, normalizeRoomState,
  participantIdsFromPost, rosterIdsFromPost, sameJson,
} from "./_syncPostProjection.js";
import { isTrue, reject } from "./_syncPostCommon.js";
import {
  getSideCapacity,
  isIndividualOnlyRoom,
  getRecruitingSideCounts,
  validatePickupRecruitingShape,
} from "./_syncPostPickupPolicy.js";
export { validatePickupRecruitingShape, validatePickupRecruitingUpdate, normalizePickupRecruitingOperation, validatePickupRecruitingOperation } from "./_syncPostPickupPolicy.js";

const AGE_GROUP_IDS = ["junior", "rising", "open"];

export function normalizeAllowedAgeGroups(post = {}) {
  const explicitGroups = toArray(post.allowedAgeGroups ?? post.allowed_age_groups)
    .map((group) => String(group).toLowerCase())
    .filter((group) => AGE_GROUP_IDS.includes(group));
  if (explicitGroups.length) return [...new Set(explicitGroups)];

  const restriction = String(post.ageRestriction ?? post.age_restriction ?? "any").toLowerCase();
  if (!restriction || restriction === "any") return [];
  return [...new Set(restriction.split("_").filter((group) => AGE_GROUP_IDS.includes(group)))];
}

function getPlayerEligibilityIds(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return [...new Set([
    post.ownerId,
    roomState.ownerId,
    post.playerId,
    ...(toArray(post.playerIds)),
    ...(toArray(post.applicants).flatMap((application) => [
      application.playerId,
      ...(toArray(application.playerIds)),
      ...(toArray(application.reservePlayerIds)),
    ])),
    ...(Object.values(roomState.partyReserves ?? {}).flatMap(toArray)),
    ...(toArray(roomState.invitations)
      .filter((invitation) => invitation.role !== "referee" && isPendingInvitation(invitation))
      .map((invitation) => invitation.targetUserId)),
  ].filter(Boolean))];
}

export function isPendingInvitation(invitation = {}) {
  return String(invitation.status ?? "pending") === "pending";
}

const AGE_ELIGIBILITY_ACTIONS = new Set([
  "createRecruitingPost",
  "interestRecruitingPost",
  "joinRecruitingSideParty",
  "acceptRecruitingInvitation",
  "inviteRecruitingPlayers",
  "setRecruitingTeamPartyRoster",
]);

function shouldValidateAgeEligibility(action, profileId, existingPost, body = {}) {
  if (!AGE_ELIGIBILITY_ACTIONS.has(action)) return false;
  if (action === "interestRecruitingPost" && body.joinMode === "referee") return false;
  if (action === "acceptRecruitingInvitation" && hasRefereeInvitationFor(profileId, existingPost)) return false;
  return true;
}

export async function validateAgeEligibility(supabase, profileId, existingPost, nextPost, body = {}) {
  const action = body.action ?? "sync";
  if (!shouldValidateAgeEligibility(action, profileId, existingPost, body)) return;

  const ruleSource = existingPost
    ? {
        allowed_age_groups: existingPost.allowed_age_groups,
        age_restriction: existingPost.age_restriction,
      }
    : nextPost;
  const allowedGroups = normalizeAllowedAgeGroups(ruleSource);
  if (!allowedGroups.length || allowedGroups.length >= AGE_GROUP_IDS.length) return;

  const userIds = getPlayerEligibilityIds(nextPost);
  if (!userIds.length) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, birth_year, age_group")
    .in("id", userIds);
  if (error) throw error;

  const profilesById = new Map(toArray(data).map((profile) => [profile.id, profile]));
  const blockedUserId = userIds.find((userId) => {
    const profile = profilesById.get(userId);
    if (!profile) return true;
    const ageGroup = AGE_GROUP_IDS.includes(profile.age_group)
      ? profile.age_group
      : getAgeGroupByBirthYear(profile.birth_year) ?? "open";
    return !allowedGroups.includes(ageGroup);
  });

  if (blockedUserId) reject(403, "age_group_not_allowed");
}

function getRecruitingApplicantKey(application = {}) {
  return application.kind === "team" || application.teamId
    ? `team:${application.teamId}`
    : `player:${application.playerId}`;
}

export async function validateRecruitingRosterEligibility(supabase, post = {}, profileId = "") {
  const roomState = normalizeRoomState(post.roomState, post);
  const playerEligibilityIds = getPlayerEligibilityIds(post);

  const rostersByTeam = new Map();
  if ((post.hostJoinMode ?? post.host_join_mode) !== "player" && post.teamId) {
    addTeamRoster(rostersByTeam, post.teamId, [
      post.playerId,
      ...(toArray(post.playerIds)),
      ...(toArray(roomState.partyReserves?.host)),
    ]);
  }

  toArray(post.applicants).forEach((application) => {
    const teamId = application.teamId ?? application.sourceTeamId ?? null;
    if (!teamId) return;
    addTeamRoster(rostersByTeam, teamId, [
      application.playerId,
      ...(toArray(application.playerIds)),
      ...(toArray(application.reservePlayerIds)),
      ...(toArray(roomState.partyReserves?.[getRecruitingApplicantKey(application)])),
    ]);
  });

  toArray(roomState.invitations).forEach((invitation) => {
    if (invitation.role === "referee" || !invitation.teamId || !isPendingInvitation(invitation)) return;
    addTeamRoster(rostersByTeam, invitation.teamId, [invitation.targetUserId]);
  });

  const onlyAuthenticatedProfile = playerEligibilityIds.length === 1 && playerEligibilityIds[0] === profileId;
  if (!onlyAuthenticatedProfile || rostersByTeam.size) {
    await assertProfilesExist(supabase, playerEligibilityIds, "recruiting_player_not_found");
  }
  await assertTeamRosterMembers(supabase, rostersByTeam, "recruiting_team_roster_not_member");
}

function isOwner(profileId, post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return Boolean(profileId && (profileId === post.ownerId || profileId === roomState.ownerId || profileId === post.playerId || profileId === post.player_id));
}

export function isInvitationDecisionAction(action = "") {
  return action === "acceptRecruitingInvitation" || action === "declineRecruitingInvitation";
}

export function getRequiredInvitationId(body = {}) {
  const invitationId = String(body.invitationId ?? "").trim();
  if (!invitationId) reject(400, "missing_recruiting_invitation_id");
  return invitationId;
}

function hasInvitationFor(profileId, post = {}, invitationId = "") {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return toArray(roomState.invitations).some((invitation) => (
    invitation.targetUserId === profileId &&
    (!invitationId || invitation.id === invitationId) &&
    isPendingInvitation(invitation)
  ));
}

function getPendingPlayerInvitation(profileId, post = {}, invitationId = "") {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return toArray(roomState.invitations).find((invitation) => (
    invitation.role !== "referee" &&
    invitation.targetUserId === profileId &&
    isPendingInvitation(invitation) &&
    (!invitationId || invitation.id === invitationId)
  )) ?? null;
}

function hasRefereeInvitationFor(profileId, post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return toArray(roomState.invitations).some((invitation) => (
    invitation.role === "referee" &&
    invitation.targetUserId === profileId &&
    isPendingInvitation(invitation)
  ));
}

function getPendingRefereeInvitation(profileId, post = {}, invitationId = "") {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return toArray(roomState.invitations).find((invitation) => (
    invitation.role === "referee" &&
    invitation.targetUserId === profileId &&
    invitation.status === "pending" &&
    (!invitationId || invitation.id === invitationId)
  )) ?? null;
}

function getRefereeTrustMin(existingPost = {}, nextPost = {}) {
  const rawValue = existingPost?.referee_trust_min ?? existingPost?.refereeTrustMin ?? nextPost?.refereeTrustMin ?? nextPost?.referee_trust_min ?? 0;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function hasOpenRefereeSlot(post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return isTrue(roomState.refereeWanted) && !nullableText(post.refereeId ?? post.referee_id);
}

export function normalizeRecruitingCreationPolicyOperation(operation = {}) {
  if (operation.action !== "createRecruitingPost") return operation;
  const draft = operation.draft && typeof operation.draft === "object" ? operation.draft : {};
  const rules = draft.rules && typeof draft.rules === "object" ? draft.rules : {};
  const matchIntent = draft.matchIntent ?? rules.matchIntent;
  const matchPurpose = draft.matchPurpose ?? rules.matchPurpose;
  const pickup = matchIntent === "pickup" || (draft.formationMode ?? rules.formationMode) === "pickup";
  const record = matchIntent === "record" || matchIntent === "match_record";
  const competitive = matchPurpose === "competitive" || (!matchPurpose && draft.ranked !== false);
  const ranked = !record && competitive;
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(draft.mmrRangeMode ?? rules.mmrRangeMode);
  const mmrLimitMode = !ranked || pickup || record ? "off" : "block";
  return {
    ...operation,
    draft: {
      ...draft,
      ranked,
      mmrRangeMode,
      mmrLimitMode,
      rules: { ...rules, ranked, mmrRangeMode, mmrLimitMode },
    },
  };
}

export function validateRecruitingPostShape(post = {}) {
  validatePickupRecruitingShape(post);
  const mode = post.mode ?? "5v5";
  if (!isSupportedMatchMode(mode)) reject(400, "unsupported_match_mode");
  const capacity = getSideCapacity(post);
  const explicitBenchCapacity = getExplicitBenchCapacity(post);
  if (explicitBenchCapacity !== undefined && !isValidBenchCapacity(explicitBenchCapacity)) reject(400, "invalid_bench_capacity");
  const benchCapacity = getCanonicalBenchCapacity(post);
  const applications = toArray(post.applicants);
  const hostJoinMode = getCanonicalHostJoinMode(post);
  const roomState = normalizeRoomState(post.roomState, post);
  const visibility = post.visibility === "private" ? "private" : "public";
  const teamOnly = isTrue(post.teamOnly ?? post.team_only ?? roomState.teamOnly);
  if (visibility === "public" && hostJoinMode === "team" && !teamOnly) reject(400, "public_team_room_requires_team_only");
  const oversizedHost = hostJoinMode === "team" && toArray(post.playerIds ?? post.player_ids).length > capacity;
  if (oversizedHost) reject(400, "recruiting_party_exceeds_side_capacity");
  const oversizedApplication = applications.find((application) => toArray(application.playerIds ?? application.player_ids).length > capacity);
  if (oversizedApplication) reject(400, "recruiting_party_exceeds_side_capacity");
  const sideCounts = getRecruitingSideCounts(post);
  if (sideCounts.crossSideDuplicate) reject(400, "recruiting_player_on_both_sides");
  if (sideCounts.crossSideTeamParty) reject(400, "recruiting_team_party_on_both_sides");
  if (sideCounts.teamA > capacity || sideCounts.teamB > capacity) reject(400, "recruiting_side_exceeds_capacity");
  const benchIds = getRecruitingBenchIdsBySide(post);
  if (benchIds.teamA.size > benchCapacity || benchIds.teamB.size > benchCapacity) reject(409, "recruiting_reserve_full");

  if (!isIndividualOnlyRoom(post)) return;
  if (post.teamId || post.targetTeamId || toArray(post.playerIds).length > 1) reject(400, "solo_room_team_party_not_allowed");
  if (Object.values(roomState.partyReserves ?? {}).flatMap(toArray).length) reject(400, "solo_room_team_party_not_allowed");

  const teamApplication = applications.find((application) => (
    application.kind === "team" ||
    application.teamId ||
    application.sourceTeamId ||
    application.sourceEntryId ||
    toArray(application.playerIds).length > 1
  ));
  if (teamApplication) reject(400, "solo_room_team_party_not_allowed");
}

function getCreatePlayerInvitations(post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return toArray(roomState.invitations).filter((invitation) => (
    invitation.role !== "referee" &&
    (invitation.status ?? "pending") === "pending"
  ));
}

export function validateRecruitingCreateBranchShape(post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  const visibility = post.visibility === "private" ? "private" : "public";
  const hostJoinMode = getCanonicalHostJoinMode(post);
  const hostSide = (post.hostSide ?? post.host_side ?? roomState.hostSide) === "teamB" ? "teamB" : "teamA";
  const teamOnly = isTrue(post.teamOnly ?? post.team_only ?? roomState.teamOnly);
  const hostTeamId = nullableText(post.teamId ?? post.team_id);
  const targetTeamId = nullableText(post.targetTeamId ?? post.target_team_id);
  const playerInvitations = getCreatePlayerInvitations(post);
  const applications = toArray(post.applicants);
  const hostPlayerIds = toArray(post.playerIds ?? post.player_ids);

  if (hostSide !== "teamA") reject(400, "recruiting_host_side_must_be_team_a");

  if (hostJoinMode === "team") {
    if (!teamOnly) reject(400, "team_room_requires_team_only");
    if (applications.length) reject(400, "team_room_create_cannot_preload_opponent_roster");
    if (hostTeamId || targetTeamId || hostPlayerIds.length || playerInvitations.length) reject(400, "team_room_must_start_without_team_selection");
    return;
  }

  if (teamOnly || hostTeamId || targetTeamId || hostPlayerIds.length > 1) reject(400, "player_room_team_shape_not_allowed");
  if (applications.some((application) => (
    application.kind === "team" ||
    application.joinMode === "team" ||
    application.teamId ||
    application.team_id ||
    toArray(application.playerIds ?? application.player_ids).length > 1
  ))) reject(400, "player_room_team_shape_not_allowed");
  if (visibility === "public" && playerInvitations.length) reject(400, "public_player_room_cannot_have_player_invites");
}

export function validateRecruitingCreateCourt(post = {}) {
  const courtId = nullableText(post.courtId ?? post.court_id ?? post.approvedCourtId ?? post.registeredCourtId);
  if (!courtId) reject(400, "missing_recruiting_court");
}

const OWNER_RECRUITING_ACTIONS = new Set([
  "updateRecruitingRoomRules",
  "setRecruitingRoomTeam",
  "kickRecruitingApplicant",
  "confirmRecruitingMatch",
  "closeRecruitingPost",
]);

const PARTICIPANT_RECRUITING_ACTIONS = new Set([
  "acknowledgeRecruitingRoomRules",
  "respondRecruitingScheduleProposal",
  "sendRecruitingChat",
  "cancelRecruitingParticipation",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "inviteRecruitingPlayers",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "setRecruitingSlotPosition",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "inviteRecruitingReferee",
]);

const JOIN_RECRUITING_ACTIONS = new Set([
  "interestRecruitingPost",
  "joinRecruitingSideParty",
]);

export const PUBLIC_ROOM_PARTICIPATION_ACTIONS = new Set([
  "interestRecruitingPost",
  "joinRecruitingSideParty",
  "acceptRecruitingInvitation",
]);

const MEMBERSHIP_ADD_RECRUITING_ACTIONS = new Set([
  "createRecruitingPost",
  "interestRecruitingPost",
  "joinRecruitingSideParty",
  "acceptRecruitingInvitation",
  "setRecruitingTeamPartyRoster",
]);

const CORE_LOCKED_RECRUITING_ACTIONS = new Set([
  ...PARTICIPANT_RECRUITING_ACTIONS,
  ...JOIN_RECRUITING_ACTIONS,
]);

export function canSyncRecruitingAction(profileId, existingPost, nextPost, action, body = {}) {
  if (!profileId || !nextPost?.id) return false;
  if (!existingPost) {
    return action === "createRecruitingPost" && participantIdsFromPost(nextPost).has(profileId) && isOwner(profileId, nextPost);
  }
  const existingParticipants = rosterIdsFromPost({
    ...existingPost,
    ownerId: existingPost.room_state?.ownerId,
    playerId: existingPost.player_id,
    playerIds: existingPost.player_ids,
    refereeId: existingPost.referee_id,
    roomState: existingPost.room_state,
  });
  const nextParticipants = rosterIdsFromPost(nextPost);

  if (OWNER_RECRUITING_ACTIONS.has(action)) return isOwner(profileId, existingPost);
  if (JOIN_RECRUITING_ACTIONS.has(action)) {
    if (action === "interestRecruitingPost" && body.joinMode === "referee") {
      return existingPost.visibility !== "private" && nextPost.refereeId === profileId;
    }
    if (existingPost.visibility === "private" && !existingParticipants.has(profileId) && !hasInvitationFor(profileId, existingPost, body.invitationId)) return false;
    return nextParticipants.has(profileId);
  }
  if (PARTICIPANT_RECRUITING_ACTIONS.has(action)) {
    if (action === "acceptRecruitingInvitation" || action === "declineRecruitingInvitation") {
      return existingParticipants.has(profileId) || hasInvitationFor(profileId, existingPost, body.invitationId);
    }
    return existingParticipants.has(profileId);
  }
  return existingParticipants.has(profileId) || nextParticipants.has(profileId);
}

function isTeamOnlyRosterSummon(existingPost = {}, body = {}) {
  if ((body.action ?? "sync") !== "inviteRecruitingPlayers") return false;
  const invite = body.invite && typeof body.invite === "object" ? body.invite : {};
  const roomState = normalizeRoomState(existingPost.roomState ?? existingPost.room_state, existingPost);
  const teamOnly = isTrue(existingPost.teamOnly ?? existingPost.team_only ?? roomState.teamOnly) ||
    getCanonicalHostJoinMode(existingPost) === "team";
  return teamOnly && (invite.joinMode === "team" || Boolean(invite.teamId));
}

export function validateNoUnexpectedRosterInsert(existingPost, nextPost, action, body = {}) {
  if (!existingPost || MEMBERSHIP_ADD_RECRUITING_ACTIONS.has(action) || isTeamOnlyRosterSummon(existingPost, body)) return;
  const existingRoster = rosterIdsFromPost(existingPost);
  const nextRoster = rosterIdsFromPost(nextPost);
  const insertedIds = [...nextRoster].filter((profileId) => !existingRoster.has(profileId));
  if (insertedIds.length) {
    reject(403, "recruiting_unexpected_participant_insert");
  }
}

function actionCanAssignReferee(profileId, existingPost, body = {}) {
  const action = body.action ?? "sync";
  return (
    (action === "interestRecruitingPost" && body.joinMode === "referee") ||
    (action === "acceptRecruitingInvitation" && getPendingRefereeInvitation(profileId, existingPost, body.invitationId))
  );
}

export function validateLockedRecruitingCore(profileId, existingPost, nextPost, body = {}) {
  const action = body.action ?? "sync";
  if (!existingPost || !CORE_LOCKED_RECRUITING_ACTIONS.has(action)) return;

  const existingCore = getRecruitingCoreSnapshot(existingPost);
  const nextCore = getRecruitingCoreSnapshot(nextPost);
  if (actionCanAssignReferee(profileId, existingPost, body)) existingCore.refereeId = nextCore.refereeId;
  const playerInvitation = action === "acceptRecruitingInvitation"
    ? getPendingPlayerInvitation(profileId, existingPost, body.invitationId)
    : null;
  if (
    playerInvitation &&
    existingCore.hostJoinMode === "team" &&
    existingCore.teamId &&
    playerInvitation.teamId === existingCore.teamId &&
    playerInvitation.side === existingCore.hostSide
  ) {
    existingCore.playerIds = nextCore.playerIds;
  }
  if (!sameJson(existingCore, nextCore)) reject(403, "recruiting_core_locked");
}

export async function validateRefereeAction(supabase, profileId, existingPost, nextPost, body) {
  const action = body.action ?? "sync";
  const minTrust = getRefereeTrustMin(existingPost, nextPost);
  if (action === "inviteRecruitingReferee") {
    if (!(await isActiveReferee(supabase, body.refereeId, minTrust))) reject(403, "referee_not_eligible");
    return;
  }
  if (action === "interestRecruitingPost" && body.joinMode === "referee") {
    if (!hasOpenRefereeSlot(existingPost)) reject(403, "referee_join_not_allowed");
    if (nextPost.refereeId !== profileId) reject(403, "referee_assignment_mismatch");
    if (!(await isActiveReferee(supabase, profileId, minTrust))) reject(403, "referee_not_eligible");
    return;
  }
  if (action === "acceptRecruitingInvitation" && getPendingRefereeInvitation(profileId, existingPost, body.invitationId)) {
    if ((nextPost.refereeId ?? null) === (existingPost?.referee_id ?? null)) return;
    if (existingPost?.referee_id) reject(403, "referee_already_assigned");
    if (nextPost.refereeId !== profileId) reject(403, "referee_assignment_mismatch");
    if (!(await isActiveReferee(supabase, profileId, minTrust))) reject(403, "referee_not_eligible");
    return;
  }
  if (nextPost.refereeId && nextPost.refereeId !== existingPost?.referee_id && !(await isActiveReferee(supabase, nextPost.refereeId, minTrust))) {
    reject(403, "referee_not_eligible");
  }
}
