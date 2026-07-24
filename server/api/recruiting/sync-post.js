import { randomUUID } from "node:crypto";
import { getDbScheduleParts, toDbTime } from "../../../src/data/scheduleUtils.js";
import { getAuthenticatedContext, nullableText, readJsonBody, sendJson, toArray, toNotificationRows } from "../_supabaseAdmin.js";
import { DEFAULT_RATING, MATCH_SIDES, getModeSize, isSupportedMatchMode, isValidBenchCapacity, normalizeDisputeWindowMinutes, normalizeMmrLimitMode } from "../../../src/lib/constants.js";
import {
  ROOM_CHAT_MESSAGE_COLUMNS,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  fromRoomChatMessageRow,
  normalizeRoomChatBody,
} from "../../../src/lib/roomChat.js";
import {
  applyAuthoritativeRecruitingOperation,
  getOperation,
  loadAuthoritativeState,
} from "../_authoritativeState.js";
import { syncRoomChatMessageToDiscord } from "../discord/_roomChatBridge.js";
import { addTeamRoster, assertProfilesExist, assertTeamRosterMembers } from "../_rosterEligibility.js";
import { getDiscordProfiles, persistMatchSnapshot, upsertDiscordDeliveryRows } from "../matches/sync-match.js";
import { getPublicAppWebUrl } from "../_publicAppUrl.js";
import { getRecruitingBenchCapacity, normalizeRecruitingApplicationStatus } from "../../../src/lib/recruiting.js";
import { assertSafeUserText } from "../../../src/lib/inputSecurity.js";

function isTrue(value) {
  return value === true || value === "true";
}

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

export function getRecruitingBenchPolicyError(error = {}) {
  const errorText = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  if (errorText.includes("invalid_bench_capacity")) return { statusCode: 400, message: "invalid_bench_capacity" };
  if (errorText.includes("recruiting_side_capacity_below_roster")) return { statusCode: 409, message: "recruiting_side_capacity_below_roster" };
  if (errorText.includes("recruiting_bench_capacity_below_roster")) return { statusCode: 409, message: "recruiting_bench_capacity_below_roster" };
  if (errorText.includes("pickup_participant_capacity_below_pool")) return { statusCode: 409, message: "pickup_participant_capacity_below_pool" };
  if (errorText.includes("recruiting_reserve_full")) return { statusCode: 409, message: "recruiting_reserve_full" };
  if (errorText.includes("room_edit_limit_reached")) return { statusCode: 409, message: "room_edit_limit_reached" };
  if (errorText.includes("room_edit_window_closed")) return { statusCode: 409, message: "room_edit_window_closed" };
  if (errorText.includes("room_schedule_target_too_soon")) return { statusCode: 409, message: "room_schedule_target_too_soon" };
  if (errorText.includes("room_cancel_locked")) return { statusCode: 409, message: "room_cancel_locked" };
  if (errorText.includes("recruiting_room_edit_locked")) return { statusCode: 409, message: "recruiting_room_edit_locked" };
  if (errorText.includes("room_meeting_point_required")) return { statusCode: 400, message: "room_meeting_point_required" };
  if (errorText.includes("court_not_found") || errorText.includes("invalid_room_court")) return { statusCode: 400, message: "invalid_room_court" };
  return null;
}

function getTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString();
}

function normalizeRoomState(roomState = {}, post = {}) {
  const source = roomState && typeof roomState === "object" ? roomState : {};
  return {
    ...source,
    ownerId: post.ownerId ?? source.ownerId ?? post.playerId ?? "",
    timingType: post.timingType ?? source.timingType ?? "scheduled",
    mmrLimitMode: normalizeMmrLimitMode(post.mmrLimitMode ?? source.mmrLimitMode),
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getRecruitingCoreSnapshot(post = {}) {
  const teamId = nullableText(post.teamId ?? post.team_id);
  return {
    visibility: post.visibility === "private" ? "private" : "public",
    playerId: post.playerId ?? post.player_id ?? "",
    teamId,
    targetTeamId: nullableText(post.targetTeamId ?? post.target_team_id),
    mode: post.mode ?? "5v5",
    scheduledDate: post.scheduledDate ?? post.scheduled_date ?? null,
    scheduledTime: toDbTime(post.scheduledTime ?? post.scheduled_time) ?? null,
    ranked: post.ranked !== false,
    official: Boolean(post.official),
    ageRestriction: post.ageRestriction ?? post.age_restriction ?? "any",
    allowedAgeGroups: toArray(post.allowedAgeGroups ?? post.allowed_age_groups).map(String).sort(),
    sideCapacity: getCanonicalSideCapacity(post),
    benchCapacity: getCanonicalBenchCapacity(post),
    hostJoinMode: getCanonicalHostJoinMode(post),
    hostSide: (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA",
    playerIds: toArray(post.playerIds ?? post.player_ids),
    refereeId: post.refereeId || post.referee_id || "",
  };
}

function toRecruitingPostRow(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  const benchCapacity = getCanonicalBenchCapacity(post);
  const courtId = post.courtId ?? post.court_id ?? post.approvedCourtId ?? post.registeredCourtId ?? null;
  const schedule = getDbScheduleParts({ ...post, roomState });
  return {
    id: post.id,
    type: post.type ?? "need_player",
    title: String(post.title ?? "").trim() || "매칭방",
    visibility: post.visibility === "private" ? "private" : "public",
    player_id: post.playerId,
    team_id: nullableText(post.teamId),
    region: nullableText(post.region),
    court_id: nullableText(courtId),
    court_name: post.court ?? post.courtName ?? "미정",
    mode: post.mode ?? "5v5",
    scheduled_date: schedule.scheduledDate,
    scheduled_time: schedule.scheduledTime,
    scheduled_at: schedule.scheduledAt,
    ranked: post.ranked !== false,
    official: Boolean(post.official),
    pre_registered: post.preRegistered !== false,
    rating_scale: Number(post.ratingScale ?? 1),
    age_restriction: post.ageRestriction ?? null,
    allowed_age_groups: toArray(post.allowedAgeGroups),
    rules: { ...(post.rules ?? {}), benchCapacity },
    stakes: post.stakes ?? "",
    court_reserved: Boolean(post.courtReserved),
    court_fee: nullableText(post.courtFee),
    spots: Number(post.spots ?? 0),
    target_team_id: nullableText(post.targetTeamId),
    referee_id: nullableText(post.refereeId),
    referee_trust_min: Number(post.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(post.statEntryMinutes ?? 60),
    dispute_minutes: normalizeDisputeWindowMinutes(post.disputeMinutes),
    room_state: { ...roomState, timingType: schedule.timingType },
    host_join_mode: post.hostJoinMode === "player" ? "player" : "team",
    host_side: post.hostSide === "teamB" ? "teamB" : "teamA",
    host_ready: Boolean(post.hostReady),
    side_capacity: getCanonicalSideCapacity(post),
    bench_capacity: benchCapacity,
    player_ids: toArray(post.playerIds),
    position: roomState.slotPositions?.[post.playerId] ?? post.position ?? null,
    memo: post.memo ?? "",
    status: post.status ?? "open",
    confirmed_at: post.confirmedAt ?? null,
    created_at: post.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function toRecruitingApplicationRows(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return toArray(post.applicants).map((application) => {
    const teamId = nullableText(application.teamId);
    return {
      post_id: post.id,
      player_id: application.playerId,
      team_id: teamId,
      kind: application.kind === "team" || teamId ? "team" : "player",
      side: application.side === "teamA" ? "teamA" : "teamB",
      status: normalizeRecruitingApplicationStatus(application.status),
      reserve: Boolean(application.reserve),
      position: roomState.slotPositions?.[application.playerId] ?? application.position ?? null,
      player_ids: toArray(application.playerIds),
      source_team_id: nullableText(application.sourceTeamId),
      source_entry_id: nullableText(application.sourceEntryId),
      created_at: application.createdAt ?? new Date().toISOString(),
      updated_at: application.updatedAt ?? application.createdAt ?? new Date().toISOString(),
    };
  }).filter((row) => row.player_id);
}

function fromRecruitingApplicationRows(rows = []) {
  return toArray(rows).map((application) => ({
    kind: application.kind === "team" || application.team_id ? "team" : "player",
    joinMode: application.kind === "team" || application.team_id ? "team" : "player",
    teamId: application.team_id ?? null,
    playerId: application.player_id,
    side: application.side,
    status: application.status,
    reserve: application.reserve,
    position: application.position,
    playerIds: toArray(application.player_ids),
    sourceTeamId: application.source_team_id ?? null,
    sourceEntryId: application.source_entry_id ?? null,
    createdAt: application.created_at,
    updatedAt: application.updated_at,
  })).filter((application) => application.playerId);
}

function participantIdsFromPost(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return new Set([
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
    ...(toArray(roomState.invitations).map((invitation) => invitation.targetUserId)),
    ...(toArray(roomState.invitations).map((invitation) => invitation.fromUserId)),
  ].filter(Boolean));
}

function rosterIdsFromPost(post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return new Set([
    post.ownerId,
    roomState.ownerId,
    post.playerId,
    post.player_id,
    post.refereeId,
    post.referee_id,
    ...(toArray(post.playerIds ?? post.player_ids)),
    ...(toArray(post.applicants).flatMap((application) => [
      application.playerId,
      application.player_id,
      ...(toArray(application.playerIds ?? application.player_ids)),
      ...(toArray(application.reservePlayerIds)),
    ])),
    ...(Object.values(roomState.partyReserves ?? {}).flatMap(toArray)),
    ...(Object.values(roomState.pinnedReservePlayers ?? {}).flatMap(toArray)),
  ].filter(Boolean));
}

function getRecruitingWebPath(postId = "") {
  return `/app/recruiting?post=${encodeURIComponent(String(postId))}`;
}

function getRecruitingWebUrl(postId = "") {
  const path = getRecruitingWebPath(postId);
  return getPublicAppWebUrl(path);
}

function getCanonicalSideCapacity(post = {}) {
  const modeCapacity = getModeSize(post.mode);
  const rawCapacity = Number(post.sideCapacity ?? post.side_capacity ?? modeCapacity);
  const safeCapacity = Number.isFinite(rawCapacity) ? rawCapacity : modeCapacity;
  return Math.max(1, Math.min(5, modeCapacity, safeCapacity));
}

function getCanonicalBenchCapacity(post = {}) {
  return getRecruitingBenchCapacity(post);
}

function getExplicitBenchCapacity(post = {}) {
  if (post.benchCapacity !== undefined) return post.benchCapacity;
  if (post.bench_capacity !== undefined) return post.bench_capacity;
  if (post.rules && Object.prototype.hasOwnProperty.call(post.rules, "benchCapacity")) return post.rules.benchCapacity;
  return undefined;
}

function getRecruitingBenchIdsBySide(post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  const result = { teamA: new Set(), teamB: new Set() };
  const add = (side, ids = []) => {
    if (!MATCH_SIDES.includes(side)) return;
    toArray(ids).filter(Boolean).forEach((playerId) => result[side].add(playerId));
  };
  const hostSide = (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA";
  add(hostSide, roomState.partyReserves?.host);
  toArray(post.applicants).forEach((application) => {
    const side = application.side === "teamA" ? "teamA" : "teamB";
    const teamId = nullableText(application.teamId ?? application.team_id);
    const applicationKey = teamId ? `team:${teamId}` : `player:${application.playerId ?? application.player_id ?? ""}`;
    if (application.reserve) {
      const playerIds = toArray(application.playerIds ?? application.player_ids);
      add(side, playerIds.length ? playerIds : [application.playerId ?? application.player_id]);
    }
    add(side, roomState.partyReserves?.[applicationKey]);
  });
  MATCH_SIDES.forEach((side) => add(side, roomState.pinnedReservePlayers?.[side]));
  toArray(roomState.invitations).forEach((invitation) => {
    if (invitation.role !== "referee" && invitation.status === "pending" && invitation.reserve) {
      add(invitation.side === "teamA" ? "teamA" : "teamB", [invitation.targetUserId]);
    }
  });
  return result;
}

function getCanonicalHostJoinMode(post = {}) {
  const teamId = nullableText(post.teamId ?? post.team_id);
  const hostJoinMode = post.hostJoinMode ?? post.host_join_mode;
  return hostJoinMode === "player" || !teamId ? "player" : "team";
}

function getRoomCancelledPayload(post = {}) {
  return {
    title: "방 취소",
    body: [
      `${post.title || "매칭방"} 방이 취소되었습니다.`,
      `구장: ${post.court || "구장 미정"}`,
      `방식: ${post.mode || "5v5"}`,
    ].join("\n"),
    webPath: getRecruitingWebPath(post.id),
    webUrl: getRecruitingWebUrl(post.id),
    actions: [],
  };
}

function toRoomCancelledNotificationRows(post = {}, participantIds = []) {
  const now = new Date().toISOString();
  const payload = getRoomCancelledPayload(post);
  const fromUserId = post.ownerId ?? post.roomState?.ownerId ?? post.playerId ?? "";
  return toNotificationRows(participantIds.map((profileId) => ({
    id: `discord-room-cancelled-${post.id}-${profileId}`,
    targetUserId: profileId,
    fromUserId,
    title: payload.title,
    body: payload.body,
    tone: "match",
    type: "recruiting_cancelled",
    discordEvent: "match",
    recruitingPostId: post.id,
    webPath: payload.webPath,
    webUrl: payload.webUrl,
    targetStatus: "closed",
    targetUnavailable: true,
    status: "cancelled",
    actionRequired: false,
    homeAction: false,
    skipDiscordSync: true,
    sendAt: now,
    createdAt: now,
    updatedAt: now,
  })), "", { coalesce: "nullish" });
}

function toRoomCancelledDiscordRows(post = {}, profiles = []) {
  const now = new Date().toISOString();
  const payload = getRoomCancelledPayload(post);
  const fromUserId = post.ownerId ?? post.roomState?.ownerId ?? post.playerId ?? "";
  return profiles.map((profile) => {
    const id = `discord-room-cancelled-${post.id}-${profile.id}`;
    return {
      id,
      notification_id: id,
      target_user_id: profile.id,
      discord_user_id: profile.discord_user_id,
      event: "match",
      status: "queued",
      payload: {
        ...payload,
        id,
        recruitingPostId: post.id,
        targetUserId: profile.id,
        fromUserId,
        targetStatus: "closed",
        targetUnavailable: true,
        status: "cancelled",
        queuedAt: now,
        sendAt: now,
      },
      queued_at: now,
      send_at: now,
      sent_at: null,
      failed_at: null,
      last_error: null,
      created_at: now,
      updated_at: now,
    };
  });
}

export async function queueRecruitingRoomCancelledDeliveries(supabase, post = {}, action = "sync") {
  if (action !== "closeRecruitingPost" || !post?.id) return 0;
  const participantIds = Array.from(participantIdsFromPost(post));
  const notificationRows = toRoomCancelledNotificationRows(post, participantIds);
  if (notificationRows.length) {
    const { error } = await supabase
      .from("notifications")
      .upsert(notificationRows, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
  }
  const profiles = await getDiscordProfiles(supabase, participantIds);
  return upsertDiscordDeliveryRows(supabase, toRoomCancelledDiscordRows(post, profiles));
}

const AGE_GROUP_IDS = ["junior", "rising", "open"];

function getAgeGroupByBirthYear(birthYear, now = new Date()) {
  const year = Number(birthYear);
  if (!Number.isInteger(year) || year < 1900 || year > now.getFullYear()) return null;
  const age = now.getFullYear() - year;
  if (age <= 12) return "junior";
  if (age <= 19) return "rising";
  return "open";
}

function normalizeAllowedAgeGroups(post = {}) {
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

function isPendingInvitation(invitation = {}) {
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

async function validateAgeEligibility(supabase, profileId, existingPost, nextPost, body = {}) {
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

async function validateRecruitingRosterEligibility(supabase, post = {}, profileId = "") {
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

function isInvitationDecisionAction(action = "") {
  return action === "acceptRecruitingInvitation" || action === "declineRecruitingInvitation";
}

function getRequiredInvitationId(body = {}) {
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

function getSideCapacity(post = {}) {
  return getCanonicalSideCapacity(post);
}

function isSoloIndividualRoom(post = {}) {
  const teamId = nullableText(post.teamId ?? post.team_id);
  return getSideCapacity(post) === 1 && (getCanonicalHostJoinMode(post) === "player" || !teamId);
}

function isPickupRoom(post = {}) {
  const rules = post.rules && typeof post.rules === "object" ? post.rules : {};
  return (post.formationMode ?? post.formation_mode ?? rules.formationMode) === "pickup"
    || (post.matchIntent ?? post.match_intent ?? rules.matchIntent) === "pickup";
}

function isIndividualOnlyRoom(post = {}) {
  return isPickupRoom(post) || isSoloIndividualRoom(post);
}

function getEntryActivePlayerIds(entry = {}, capacity = 5, fallbackPlayerId = "") {
  const playerIds = toArray(entry.playerIds ?? entry.player_ids);
  if (playerIds.length) return playerIds;
  return fallbackPlayerId ? [fallbackPlayerId] : [];
}

function getRecruitingSideCounts(post = {}) {
  const capacity = getSideCapacity(post);
  const hostSide = (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA";
  const counts = { teamA: 0, teamB: 0 };
  const seen = new Set();
  const seenSides = new Map();
  const teamPartySides = new Map();
  let crossSideDuplicate = false;
  let crossSideTeamParty = false;
  const addPlayers = (side, playerIds = []) => {
    if (!counts[side]) counts[side] = 0;
    toArray(playerIds).forEach((playerId) => {
      if (!playerId) return;
      const seenSide = seenSides.get(playerId);
      if (seenSide && seenSide !== side) crossSideDuplicate = true;
      seenSides.set(playerId, side);
      if (!playerId || seen.has(playerId)) return;
      seen.add(playerId);
      counts[side] += 1;
    });
  };
  const addTeamParty = (side, teamId) => {
    const normalizedTeamId = nullableText(teamId);
    if (!normalizedTeamId) return;
    const seenSide = teamPartySides.get(normalizedTeamId);
    if (seenSide && seenSide !== side) crossSideTeamParty = true;
    teamPartySides.set(normalizedTeamId, side);
  };

  const hostJoinMode = getCanonicalHostJoinMode(post);
  if (hostJoinMode === "team") addTeamParty(hostSide, post.teamId ?? post.team_id);
  const hostPlayers = hostJoinMode === "team"
    ? getEntryActivePlayerIds(post, capacity, post.playerId ?? post.player_id ?? "")
    : [post.playerId ?? post.player_id].filter(Boolean);
  addPlayers(hostSide, hostPlayers);

  toArray(post.applicants).forEach((application) => {
    const side = application.side === "teamA" ? "teamA" : "teamB";
    const applicationTeamId = application.teamId ?? application.team_id;
    const isTeamEntry = application.kind === "team" || applicationTeamId;
    if (isTeamEntry) addTeamParty(side, applicationTeamId);
    if (application.reserve) return;
    const players = isTeamEntry
      ? getEntryActivePlayerIds(application, capacity, application.playerId ?? application.player_id ?? "")
      : [application.playerId ?? application.player_id].filter(Boolean);
    addPlayers(side, players);
  });

  counts.crossSideDuplicate = crossSideDuplicate;
  counts.crossSideTeamParty = crossSideTeamParty;
  return counts;
}

export function validatePickupRecruitingShape(post = {}) {
  const rules = post.rules && typeof post.rules === "object" ? post.rules : {};
  const matchIntent = post.matchIntent ?? post.match_intent ?? rules.matchIntent;
  const formationMode = post.formationMode ?? post.formation_mode ?? rules.formationMode;
  if (formationMode !== "pickup" && matchIntent !== "pickup") return;

  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  const teamOnly = isTrue(post.teamOnly ?? post.team_only ?? roomState.teamOnly);
  const requestedHostJoinMode = post.hostJoinMode ?? post.host_join_mode;
  if ((requestedHostJoinMode !== undefined && requestedHostJoinMode !== "player") || getCanonicalHostJoinMode(post) !== "player" || teamOnly) {
    reject(400, "pickup_requires_player_room");
  }
  if (isTrue(post.official)) reject(400, "pickup_official_not_supported");
  if ((post.playingTimePolicy ?? rules.playingTimePolicy) !== "equal_rotation") reject(400, "pickup_requires_equal_rotation");
  if ((post.lineupSelectionPolicy ?? rules.lineupSelectionPolicy) !== "no_fixed_starter") reject(400, "pickup_requires_no_fixed_starter");
}

export function validatePickupRecruitingUpdate(existingPost = {}, patch = {}) {
  const currentRules = existingPost.rules && typeof existingPost.rules === "object" ? existingPost.rules : {};
  const patchRules = patch.rules && typeof patch.rules === "object" ? patch.rules : {};
  const currentIntent = existingPost.matchIntent ?? existingPost.match_intent ?? currentRules.matchIntent;
  const requestedIntent = patch.matchIntent ?? patch.match_intent ?? patchRules.matchIntent;
  if (currentIntent !== "pickup" && requestedIntent !== "pickup") return;
  if (currentIntent !== "pickup") reject(400, "pickup_intent_cannot_be_added_by_room_update");
  if (requestedIntent !== undefined && requestedIntent !== "pickup") reject(400, "pickup_intent_cannot_be_removed_by_room_update");

  validatePickupRecruitingShape({
    ...existingPost,
    ...patch,
    matchIntent: "pickup",
    rules: {
      ...currentRules,
      ...patchRules,
      ...(patch.playingTimePolicy === undefined ? {} : { playingTimePolicy: patch.playingTimePolicy }),
      ...(patch.lineupSelectionPolicy === undefined ? {} : { lineupSelectionPolicy: patch.lineupSelectionPolicy }),
      matchIntent: "pickup",
    },
  });
}

const PICKUP_PARTY_ACTIONS = new Set([
  "joinRecruitingSideParty",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
]);

const PICKUP_POLICY_OPERATION_ACTIONS = new Set([
  "acceptRecruitingInvitation",
  "interestRecruitingPost",
  "inviteRecruitingPlayers",
  "updateRecruitingRoomRules",
  ...PICKUP_PARTY_ACTIONS,
]);

export function normalizePickupRecruitingOperation(existingPost = {}, operation = {}) {
  if (!isPickupRoom(existingPost)) return operation;

  if (PICKUP_PARTY_ACTIONS.has(operation.action)) reject(409, "pickup_party_not_allowed");

  if (operation.action === "inviteRecruitingPlayers") {
    return {
      ...operation,
      invite: {
        ...(operation.invite && typeof operation.invite === "object" ? operation.invite : {}),
        joinMode: "player",
        teamId: "",
      },
    };
  }

  if (operation.action === "interestRecruitingPost") {
    return {
      ...operation,
      joinMode: "player",
      application: {
        ...(operation.application && typeof operation.application === "object" ? operation.application : {}),
        joinMode: "player",
        teamId: "",
      },
    };
  }

  return operation;
}

async function validatePickupRecruitingOperation(context, operation = {}) {
  if (operation.action === "createRecruitingPost") {
    validatePickupRecruitingShape(operation.draft ?? {});
    return operation;
  }
  if (!PICKUP_POLICY_OPERATION_ACTIONS.has(operation.action)) return operation;
  const postId = String(operation.postId ?? "").trim();
  if (!postId) return operation;
  const { data, error } = await context.supabase
    .from("recruiting_posts")
    .select("id,ranked,official,host_join_mode,team_id,room_state,rules")
    .eq("id", postId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return operation;
  if (operation.action === "updateRecruitingRoomRules") validatePickupRecruitingUpdate(data, operation.patch ?? {});
  return normalizePickupRecruitingOperation(data, operation);
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

function validateRecruitingCreateBranchShape(post = {}) {
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
    if (!hostTeamId) reject(400, "team_room_requires_host_team");
    if (!teamOnly) reject(400, "team_room_requires_team_only");
    if (hostPlayerIds.length !== 1) reject(400, "team_room_requires_single_host_representative");
    if (applications.length) reject(400, "team_room_create_cannot_preload_opponent_roster");
    if (visibility === "private") {
      const representativeInvites = playerInvitations.filter((invitation) => (
        nullableText(invitation.teamId ?? invitation.team_id) === targetTeamId &&
        (invitation.joinMode ?? invitation.join_mode) === "team" &&
        (invitation.side ?? "teamB") === "teamB"
      ));
      if (!targetTeamId || targetTeamId === hostTeamId || representativeInvites.length !== 1 || playerInvitations.length !== 1) {
        reject(400, "private_team_room_requires_one_team_representative_invite");
      }
    } else if (playerInvitations.length) {
      reject(400, "public_team_room_cannot_have_player_invites");
    }
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

function validateRecruitingCreateCourt(post = {}) {
  const courtId = nullableText(post.courtId ?? post.court_id ?? post.approvedCourtId ?? post.registeredCourtId);
  if (!courtId) reject(400, "missing_recruiting_court");
}

const OWNER_RECRUITING_ACTIONS = new Set([
  "updateRecruitingRoomRules",
  "setRecruitingStatRecorder",
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

const PUBLIC_ROOM_PARTICIPATION_ACTIONS = new Set([
  "interestRecruitingPost",
  "joinRecruitingSideParty",
  "acceptRecruitingInvitation",
]);

async function expireRecruitingRoomChangeIfDue(context, postId = "", roomState = null) {
  const proposal = roomState?.scheduleProposal;
  const deadlineMs = proposal?.consentDeadlineAt ? new Date(proposal.consentDeadlineAt).getTime() : Number.NaN;
  if (roomState && (
    proposal?.status !== "pending"
    || !Number.isFinite(deadlineMs)
    || deadlineMs > Date.now()
  )) return proposal?.status ?? "none";
  const { data, error } = await context.supabase.rpc("rankball_recruiting_expire_room_change", {
    p_post_id: postId,
  });
  if (error) throw error;
  return data?.status ?? proposal?.status ?? "none";
}

async function assertPublicRoomParticipationAllowed(context, operation = {}) {
  if (!PUBLIC_ROOM_PARTICIPATION_ACTIONS.has(operation.action)) return;
  const postId = String(operation.postId ?? "").trim();
  if (!postId) return;
  const [{ data: post, error: postError }, { data: discipline, error: disciplineError }] = await Promise.all([
    context.supabase.from("recruiting_posts").select("visibility,room_state").eq("id", postId).maybeSingle(),
    context.supabase
      .from("admin_disciplinary_actions")
      .select("id,ends_at")
      .eq("user_id", context.profileId)
      .eq("type", "public_room_suspension")
      .eq("status", "active")
      .lte("starts_at", new Date().toISOString())
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      .limit(1)
      .maybeSingle(),
  ]);
  if (postError) throw postError;
  if (disciplineError) throw disciplineError;
  const proposalStatus = await expireRecruitingRoomChangeIfDue(context, postId, post?.room_state ?? {});
  if (proposalStatus === "pending") reject(409, "recruiting_schedule_change_pending");
  if ((post?.visibility ?? "public") === "public" && discipline?.id) reject(403, "public_room_participation_suspended");
}

async function assertRecruitingRoomChangeComplete(context, postId = "") {
  const safePostId = String(postId ?? "").trim();
  if (!safePostId) reject(400, "recruiting_post_id_required");
  await expireRecruitingRoomChangeIfDue(context, safePostId);
  const { data: post, error } = await context.supabase
    .from("recruiting_posts")
    .select("room_state")
    .eq("id", safePostId)
    .maybeSingle();
  if (error) throw error;
  if (!post) reject(404, "recruiting_post_not_found");
  const roomState = post.room_state ?? {};
  if (roomState.scheduleProposal?.status === "pending") {
    reject(409, "recruiting_schedule_change_pending");
  }
  const requiredIds = [...new Set((roomState.ruleAcknowledgementRequiredIds ?? []).filter(Boolean))];
  const acknowledgedIds = new Set((roomState.ruleAcknowledgedIds ?? []).filter(Boolean));
  if (requiredIds.some((profileId) => !acknowledgedIds.has(profileId))) {
    reject(409, "recruiting_rule_acknowledgement_pending");
  }
}

const MEMBERSHIP_ADD_RECRUITING_ACTIONS = new Set([
  "createRecruitingPost",
  "interestRecruitingPost",
  "joinRecruitingSideParty",
  "acceptRecruitingInvitation",
  "setRecruitingTeamPartyRoster",
]);

const SQL_REDUCER_RECRUITING_ACTIONS = new Set([
  "acknowledgeRecruitingRoomRules",
  "createRecruitingPost",
  "acceptRecruitingInvitation",
  "cancelRecruitingParticipation",
  "declineRecruitingInvitation",
  "interestRecruitingPost",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "closeRecruitingPost",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "setRecruitingStatRecorder",
  "setRecruitingSlotPosition",
  "updateRecruitingRoomRules",
  "respondRecruitingScheduleProposal",
  "joinRecruitingSideParty",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "kickRecruitingApplicant",
]);

const MANAGEMENT_SQL_RECRUITING_ACTIONS = new Set([
  "createRecruitingPost",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "updateRecruitingRoomRules",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "joinRecruitingSideParty",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "kickRecruitingApplicant",
]);

const CORE_LOCKED_RECRUITING_ACTIONS = new Set([
  ...PARTICIPANT_RECRUITING_ACTIONS,
  ...JOIN_RECRUITING_ACTIONS,
]);

function isMissingSqlReducer(error = {}) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "PGRST202" ||
    message.includes("rankball_recruiting_invitation_decision_action") ||
    message.includes("rankball_recruiting_invite_players_action") ||
    message.includes("rankball_recruiting_close_action") ||
    message.includes("rankball_recruiting_stat_recorder_action") ||
    message.includes("rankball_recruiting_slot_position_action") ||
    message.includes("rankball_recruiting_cancel_participation_action") ||
    message.includes("rankball_recruiting_applicant_placement_action") ||
    message.includes("rankball_recruiting_interest_player_action") ||
    message.includes("rankball_recruiting_side_party_join_action") ||
    message.includes("rankball_recruiting_room_update_action") ||
    message.includes("rankball_recruiting_rule_ack_action") ||
    message.includes("rankball_recruiting_schedule_response_action") ||
    message.includes("rankball_recruiting_management_action")
  );
}

function shouldUseSqlRecruitingAction(operation = {}) {
  return SQL_REDUCER_RECRUITING_ACTIONS.has(String(operation?.action ?? ""));
}

function withRecruitingCreatePostId(operation = null) {
  if (!operation || operation.action !== "createRecruitingPost") return operation;
  if (operation.preferredPostId || operation.postId || operation.draft?.id) return operation;
  return {
    ...operation,
    preferredPostId: `q_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 10)}`,
  };
}

function rejectSqlRecruitingFallback(data = {}) {
  if (!data?.fallback) return;
  reject(409, String(data.reason || "recruiting_operation_blocked"));
}

function createTimingProbe() {
  const startedAt = Date.now();
  const steps = [];
  return {
    async track(name, callback) {
      const stepStartedAt = Date.now();
      try {
        return await callback();
      } finally {
        steps.push({ name, ms: Date.now() - stepStartedAt });
      }
    },
    payload() {
      return { totalMs: Date.now() - startedAt, steps };
    },
    header() {
      const timing = this.payload();
      return [
        `total;dur=${Math.max(0, timing.totalMs)}`,
        ...timing.steps.map((step) => `${step.name};dur=${Math.max(0, step.ms)}`),
      ].join(", ");
    },
  };
}

function hasDebugTimingParam(request) {
  try {
    const url = new URL(request.url ?? "", "http://localhost");
    return isTrue(url.searchParams.get("debugTiming"));
  } catch {
    return false;
  }
}

function sendTimedJson(response, statusCode, payload, timing, includeTiming = false) {
  if (timing) response.setHeader("Server-Timing", timing.header());
  sendJson(response, statusCode, includeTiming && timing
    ? { ...payload, debugTiming: timing.payload() }
    : payload);
}

function isMissingRoomChatMessages(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST205" || error?.code === "42P01" || message.includes("room_chat_messages");
}

async function timeStep(timing, name, callback) {
  return timing ? timing.track(name, callback) : callback();
}

async function loadSyncedRecruitingState(context, postId = "") {
  if (!postId) return { state: null, post: null };
  const state = await loadAuthoritativeState(context, { operation: { action: "loadRecruitingPost", postId } });
  return {
    state,
    post: (state.recruitingPosts ?? []).find((post) => post.id === postId) ?? null,
  };
}

function getRequestedRecruitingRoster(operation = {}) {
  const activeIds = toArray(operation.roster?.playerIds).map((id) => String(id ?? "").trim()).filter(Boolean);
  const reserveIds = toArray(operation.roster?.reservePlayerIds).map((id) => String(id ?? "").trim()).filter(Boolean);
  return { activeIds, reserveIds, allIds: [...activeIds, ...reserveIds] };
}

async function loadRecruitingPartyGuardSnapshot(context, operation = {}) {
  const postId = String(operation.postId ?? "").trim();
  const entryId = String(operation.entryId ?? "").trim();
  if (!postId || !entryId) reject(400, "recruiting_party_target_missing");

  const { data: post, error: postError } = await context.supabase
    .from("recruiting_posts")
    .select("id,team_id,player_id,host_side,ranked,allowed_age_groups,age_restriction,rules,room_state,side_capacity,bench_capacity")
    .eq("id", postId)
    .maybeSingle();
  if (postError) throw postError;
  if (!post) reject(404, "recruiting_post_not_found");

  let application = null;
  const targetTeamId = entryId === "host"
    ? post.team_id
    : (entryId.startsWith("team:") ? entryId.slice(5).trim() : "");
  if (entryId !== "host" && targetTeamId) {
    const { data, error } = await context.supabase
      .from("recruiting_applications")
      .select("team_id,side")
      .eq("post_id", postId)
      .eq("team_id", targetTeamId)
      .eq("kind", "team")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    application = data;
  }

  const partySide = post.room_state?.partySides?.[entryId];
  const expectedSide = MATCH_SIDES.includes(partySide)
    ? partySide
    : (entryId === "host" ? post.host_side : application?.side);
  return { post, targetTeamId, expectedSide };
}

async function assertRecruitingPartyManagementGuard(context, operation = {}) {
  if (!["detachRecruitingPartyPlayer", "setRecruitingTeamPartyRoster"].includes(operation.action)) return;
  const snapshot = await loadRecruitingPartyGuardSnapshot(context, operation);

  if (operation.action === "detachRecruitingPartyPlayer") {
    const requestedSide = MATCH_SIDES.includes(operation.placement?.side)
      ? operation.placement.side
      : null;
    if (requestedSide && snapshot.expectedSide && requestedSide !== snapshot.expectedSide) {
      reject(409, "recruiting_party_side_locked");
    }
    return;
  }

  if (!snapshot.targetTeamId) reject(404, "recruiting_team_not_found");
  const { activeIds, reserveIds, allIds } = getRequestedRecruitingRoster(operation);
  const uniqueIds = new Set(allIds);
  if (uniqueIds.size !== allIds.length) reject(409, "recruiting_party_roster_duplicate");
  if (activeIds.length > Number(snapshot.post.side_capacity ?? 5)) reject(409, "recruiting_side_full");
  if (reserveIds.length > getCanonicalBenchCapacity(snapshot.post)) reject(409, "recruiting_reserve_full");
  if (!allIds.length) return;

  const { data: members, error: memberError } = await context.supabase
    .from("team_members")
    .select("user_id")
    .eq("team_id", snapshot.targetTeamId)
    .in("user_id", allIds);
  if (memberError) throw memberError;
  const memberIds = new Set(toArray(members).map((row) => row.user_id));
  if (allIds.some((playerId) => !memberIds.has(playerId))) reject(403, "recruiting_team_roster_not_member");

  let targetMmr = DEFAULT_RATING;
  if (snapshot.post.team_id) {
    const { data: hostTeam, error: teamError } = await context.supabase
      .from("teams")
      .select("mmr")
      .eq("id", snapshot.post.team_id)
      .is("deleted_at", null)
      .maybeSingle();
    if (teamError) throw teamError;
    if (!hostTeam) reject(404, "recruiting_host_team_not_found");
    targetMmr = Number(hostTeam.mmr ?? DEFAULT_RATING);
  } else if (snapshot.post.player_id) {
    const { data, error } = await context.supabase.rpc("rankball_event_profile_mmr", {
      p_profile_id: snapshot.post.player_id,
    });
    if (error) throw error;
    targetMmr = Number(data ?? DEFAULT_RATING);
  }

  const roomState = snapshot.post.room_state ?? {};
  const rules = snapshot.post.rules ?? {};
  const mmrRangeMode = ["narrow", "normal", "wide"].includes(roomState.mmrRangeMode ?? rules.mmrRangeMode)
    ? (roomState.mmrRangeMode ?? rules.mmrRangeMode)
    : "narrow";
  const mmrLimitMode = normalizeMmrLimitMode(roomState.mmrLimitMode ?? rules.mmrLimitMode);
  const allowedAgeGroups = normalizeAllowedAgeGroups(snapshot.post);
  const eligibilityResults = await Promise.all(allIds.map(async (playerId) => {
    const { data, error } = await context.supabase.rpc("rankball_event_profile_eligible", {
      p_profile_id: playerId,
      p_ranked: snapshot.post.ranked !== false,
      p_mmr_limit_mode: mmrLimitMode,
      p_target_mmr: targetMmr,
      p_mmr_range_mode: mmrRangeMode,
      p_allowed_age_groups: allowedAgeGroups,
    });
    if (error) throw error;
    return data === true;
  }));
  if (eligibilityResults.some((eligible) => !eligible)) reject(403, "team_roster_player_ineligible");
}

async function applyRecruitingManagementAction(context, operation = {}) {
  await assertRecruitingPartyManagementGuard(context, operation);
  const { data, error } = await context.supabase.rpc("rankball_recruiting_management_action", {
    p_actor_profile_id: context.profileId,
    p_operation: operation,
  });
  if (error) {
    if (isMissingSqlReducer(error)) reject(503, "recruiting_management_rpc_unavailable");
    throw error;
  }
  return {
    ok: true,
    ...(data && typeof data === "object" ? data : {}),
    postId: data?.postId ?? operation.postId ?? operation.preferredPostId ?? operation.draft?.id,
  };
}

async function applySqlRecruitingAction(context, operation = {}) {
  if (operation.action === "acknowledgeRecruitingRoomRules" && operation.postId) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_rule_ack_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_rule_revision: Number(operation.revision ?? 0),
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_rule_ack_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), postId: operation.postId };
  }

  if (operation.action === "respondRecruitingScheduleProposal" && operation.postId) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_schedule_response_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_proposal_id: operation.proposalId ?? "",
      p_decision: operation.decision ?? "approve",
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_schedule_response_rpc_required");
      throw error;
    }
    return { ok: true, ...(data && typeof data === "object" ? data : {}), postId: operation.postId };
  }

  if (operation.action === "updateRecruitingRoomRules" && operation.postId) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_room_update_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_patch: operation.patch ?? {},
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_room_update_rpc_required");
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "joinRecruitingSideParty" && (operation.entryId === "host" || String(operation.entryId ?? "").startsWith("team:"))) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_side_party_join_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_team_id: operation.teamId,
      p_side: operation.sideName ?? "",
      p_entry_id: operation.entryId ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) reject(503, "recruiting_side_party_join_rpc_unavailable");
      throw error;
    }
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (MANAGEMENT_SQL_RECRUITING_ACTIONS.has(operation.action)) {
    return applyRecruitingManagementAction(context, operation);
  }

  if (operation.action === "closeRecruitingPost") {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_close_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "setRecruitingStatRecorder") {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_stat_recorder_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_side: operation.sideName ?? "",
      p_player_id: operation.playerId ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "inviteRecruitingPlayers") {
    const invite = operation.invite && typeof operation.invite === "object"
      ? operation.invite
      : {};
    const { data, error } = await context.supabase.rpc("rankball_recruiting_invite_players_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_target_user_ids: invite.playerIds ?? [invite.playerId].filter(Boolean),
      p_side: invite.side ?? "teamB",
      p_reserve: Boolean(invite.reserve),
      p_join_mode: invite.joinMode ?? "player",
      p_team_id: invite.teamId ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (["acceptRecruitingInvitation", "declineRecruitingInvitation"].includes(operation.action)) {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_invitation_decision_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_invitation_id: operation.invitationId ?? "",
      p_action: operation.action,
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "interestRecruitingPost") {
    const application = operation.application && typeof operation.application === "object"
      ? operation.application
      : {};
    const { data, error } = await context.supabase.rpc("rankball_recruiting_interest_player_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_join_mode: application.joinMode ?? operation.joinMode ?? "",
      p_team_id: application.teamId ?? "",
      p_side: application.side ?? "",
      p_reserve: Boolean(application.reserve),
      p_position: application.position ?? "",
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    if (data?.fallback) return applyRecruitingManagementAction(context, operation);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "cancelRecruitingParticipation") {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_cancel_participation_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action === "setRecruitingApplicantPlacement") {
    const placement = operation.placement && typeof operation.placement === "object"
      ? operation.placement
      : {};
    const { data, error } = await context.supabase.rpc("rankball_recruiting_applicant_placement_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_player_id: operation.playerId ?? context.profileId,
      p_side: placement.side ?? "",
      p_reserve: Boolean(placement.reserve),
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    rejectSqlRecruitingFallback(data);
    return {
      ok: true,
      ...(data && typeof data === "object" ? data : {}),
      postId: operation.postId,
    };
  }

  if (operation.action !== "setRecruitingSlotPosition") return null;
  const { data, error } = await context.supabase.rpc("rankball_recruiting_slot_position_action", {
    p_actor_profile_id: context.profileId,
    p_post_id: operation.postId,
    p_player_id: operation.playerId ?? context.profileId,
    p_position: operation.position ?? "",
  });
  if (error) {
    if (isMissingSqlReducer(error)) return null;
    throw error;
  }
  return {
    ok: true,
    ...(data && typeof data === "object" ? data : {}),
    postId: operation.postId,
  };
}

async function loadRecruitingChatPermissionSnapshot(context, postId = "") {
  const safePostId = String(postId ?? "").trim();
  if (!safePostId) reject(400, "missing_recruiting_post");
  const { data: existingPost, error: existingError } = await context.supabase
    .from("recruiting_posts")
    .select("id, visibility, player_id, player_ids, referee_id, room_state")
    .eq("id", safePostId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (!existingPost) reject(404, "recruiting_post_not_found");
  const { data: existingApplications, error: applicationsError } = await context.supabase
    .from("recruiting_applications")
    .select("kind,team_id,player_id,side,status,reserve,position,player_ids,source_team_id,source_entry_id,created_at,updated_at")
    .eq("post_id", safePostId);
  if (applicationsError) throw applicationsError;
  return {
    ...existingPost,
    ownerId: existingPost.room_state?.ownerId,
    playerId: existingPost.player_id,
    playerIds: existingPost.player_ids,
    refereeId: existingPost.referee_id,
    roomState: existingPost.room_state,
    applicants: fromRecruitingApplicationRows(existingApplications),
  };
}

async function persistRecruitingRoomChatMessage(context, operation = {}) {
  const postId = String(operation.postId ?? "").trim();
  const text = normalizeRoomChatBody(operation.body);
  if (!postId) reject(400, "missing_recruiting_post");
  if (!text) reject(400, "empty_chat_message");
  if (text.includes("\n") || text.includes("\r")) reject(400, "single_line_chat_required");
  if (text.length > ROOM_CHAT_MESSAGE_MAX_LENGTH) reject(400, "chat_message_too_long");
  assertSafeUserText(text, { maxLength: ROOM_CHAT_MESSAGE_MAX_LENGTH, path: "$body.operation.body" });
  const existingPostSnapshot = await loadRecruitingChatPermissionSnapshot(context, postId);
  if (!canSyncRecruitingAction(context.profileId, existingPostSnapshot, existingPostSnapshot, "sendRecruitingChat", { action: "sendRecruitingChat", body: text, postId })) {
    reject(403, "recruiting_sync_permission_denied");
  }
  const { data, error } = await context.supabase
    .from("room_chat_messages")
    .insert({
      room_type: "recruiting",
      room_id: postId,
      user_id: context.profileId,
      body: text,
    })
    .select(ROOM_CHAT_MESSAGE_COLUMNS)
    .single();
  if (error) {
    if (isMissingRoomChatMessages(error)) return null;
    throw error;
  }
  let discordChatSync = null;
  try {
    discordChatSync = await syncRoomChatMessageToDiscord(context.supabase, {
      roomType: "recruiting",
      roomId: postId,
      userId: context.profileId,
      body: text,
    });
  } catch (discordChatError) {
    discordChatSync = { sent: false, error: discordChatError.message || "discord_room_chat_sync_failed" };
    console.error("Recruiting Discord room chat sync failed.", discordChatError);
  }

  return {
    ok: true,
    postId,
    message: fromRoomChatMessageRow(data, { fallbackCreatedAt: new Date().toISOString() }),
    discordChatSync,
  };
}

function canSyncRecruitingAction(profileId, existingPost, nextPost, action, body = {}) {
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

function validateNoUnexpectedRosterInsert(existingPost, nextPost, action, body = {}) {
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

function validateLockedRecruitingCore(profileId, existingPost, nextPost, body = {}) {
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

async function isActiveReferee(supabase, userId, minTrust = 0) {
  if (!userId) return false;
  const [{ data, error }, { data: profile, error: profileError }] = await Promise.all([
    supabase
    .from("referee_appointments")
    .select("id, ends_at")
    .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("profiles")
      .select("id, trust_score")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (profileError) throw profileError;
  if (Number(profile?.trust_score ?? 0) < Number(minTrust || 0)) return false;
  const now = Date.now();
  return toArray(data).some((row) => !row.ends_at || Date.parse(row.ends_at) > now);
}

async function validateRefereeAction(supabase, profileId, existingPost, nextPost, body) {
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

export async function persistRecruitingPostSnapshot(context, { post, notifications = [], action = "sync", body = {}, expectedUpdatedAt = null, timing = null, afterResponseTasks = null, prepareOnly = false }) {
  if (!post?.id) reject(400, "missing_recruiting_post");
  validateRecruitingPostShape(post);

  const actionBody = { ...body, action };
  const isCreateAction = action === "createRecruitingPost";
  const { data: existingPost, error: existingError } = await timeStep(timing, "persistExistingPost", () => context.supabase
      .from("recruiting_posts")
      .select(isCreateAction ? "id" : "id, visibility, player_id, team_id, target_team_id, mode, scheduled_date, scheduled_time, ranked, official, side_capacity, bench_capacity, host_join_mode, host_side, player_ids, referee_id, referee_trust_min, room_state, rules, age_restriction, allowed_age_groups, updated_at")
      .eq("id", post.id)
      .maybeSingle());

  if (existingError) throw existingError;
  if (isCreateAction && existingPost) reject(409, "recruiting_post_already_exists");
  if (isCreateAction) {
    validateRecruitingCreateCourt(post);
    validateRecruitingCreateBranchShape(post);
  }
  const { data: existingApplications, error: existingApplicationsError } = await timeStep(timing, "persistExistingApplications", () => existingPost && !isCreateAction
    ? context.supabase
      .from("recruiting_applications")
      .select("kind,team_id,player_id,side,status,reserve,position,player_ids,source_team_id,source_entry_id,created_at,updated_at")
      .eq("post_id", post.id)
    : { data: [], error: null });
  if (existingApplicationsError) throw existingApplicationsError;
  const existingPostSnapshot = existingPost
    ? {
        ...existingPost,
        ownerId: existingPost.room_state?.ownerId,
        playerId: existingPost.player_id,
        playerIds: existingPost.player_ids,
        refereeId: existingPost.referee_id,
        roomState: existingPost.room_state,
        applicants: fromRecruitingApplicationRows(existingApplications),
      }
    : null;
  await timeStep(timing, "permissionValidation", () => {
    if (isInvitationDecisionAction(action)) getRequiredInvitationId(actionBody);
    if (!canSyncRecruitingAction(context.profileId, existingPostSnapshot, post, action, actionBody)) {
      reject(403, "recruiting_sync_permission_denied");
    }
    validateNoUnexpectedRosterInsert(existingPostSnapshot, post, action, actionBody);
    validateLockedRecruitingCore(context.profileId, existingPostSnapshot, post, actionBody);
  });
  await timeStep(timing, "validateReferee", () => validateRefereeAction(context.supabase, context.profileId, existingPostSnapshot, post, actionBody));
  await timeStep(timing, "validateRoster", () => validateRecruitingRosterEligibility(context.supabase, post, context.profileId));
  await timeStep(timing, "validateAge", () => validateAgeEligibility(context.supabase, context.profileId, existingPostSnapshot, post, actionBody));

  const postRow = toRecruitingPostRow(post);
  const applicationRows = toRecruitingApplicationRows(post);
  const notificationRows = toNotificationRows(notifications, context.profileId, { coalesce: "nullish", getUpdatedAt: getTimestamp });
  const persistence = {
    p_actor_profile_id: context.profileId,
    p_action: action,
    p_post_row: postRow,
    p_application_rows: applicationRows,
    p_notification_rows: notificationRows,
    p_expected_updated_at: expectedUpdatedAt,
  };

  if (prepareOnly) {
    return {
      ok: true,
      post,
      postId: post.id,
      applicationCount: applicationRows.length,
      notificationCount: notificationRows.length,
      persistence,
    };
  }

  const { data: persistResult, error: persistError } = await timeStep(timing, "persistRpc", () => context.supabase.rpc("rankball_recruiting_action", persistence));
  if (persistError) {
    if (persistError.code === "40001" || String(persistError.message ?? "").includes("recruiting_stale_snapshot")) {
      reject(409, "recruiting_stale_snapshot");
    }
    throw persistError;
  }
  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  let discordDeliveryDeferred = false;
  if (action === "closeRecruitingPost") {
    try {
      discordDeliveryCount = await timeStep(timing, "discordQueue", () => queueRecruitingRoomCancelledDeliveries(context.supabase, post, action));
    } catch (deliveryError) {
      discordDeliveryError = deliveryError.message || "discord_recruiting_delivery_failed";
      console.error("Recruiting Discord delivery queue failed.", deliveryError);
    }
  }

  return {
    ok: true,
    post,
    postId: post.id,
    applicationCount: Number(persistResult?.applicationCount ?? applicationRows.length),
    notificationCount: Number(persistResult?.notificationCount ?? notificationRows.length),
    discordDeliveryCount,
    discordDeliveryError,
    discordDeliveryDeferred,
  };
}

export default async function handler(request, response) {
  const timing = createTimingProbe();
  const afterResponseTasks = [];
  let debugTiming = hasDebugTimingParam(request);
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendTimedJson(response, 405, { error: "method_not_allowed" }, timing, debugTiming);
    return;
  }

  try {
    const body = await timing.track("body", () => readJsonBody(request));
    debugTiming = debugTiming || isTrue(body.debugTiming);
    const context = await timing.track("auth", () => getAuthenticatedContext(request));
    let operation = withRecruitingCreatePostId(getOperation(body, body.action ? String(body.action) : "sync"));
    if (!operation) reject(400, "recruiting_operation_required");
    operation = await timing.track("pickupPolicy", () => validatePickupRecruitingOperation(context, operation));
    if (!SQL_REDUCER_RECRUITING_ACTIONS.has(operation.action) && !["sendRecruitingChat", "confirmRecruitingMatch"].includes(operation.action)) {
      reject(400, "unsupported_recruiting_operation");
    }
    await timing.track("publicRoomDiscipline", () => assertPublicRoomParticipationAllowed(context, operation));
    let post = null;
    let notifications = [];
    let action = operation.action;
    let createdMatch = null;
    let replayResult = null;

    if (operation?.action === "sendRecruitingChat") {
      const chatResult = await timing.track("persistRoomChatMessage", () => persistRecruitingRoomChatMessage(context, operation));
      if (chatResult) {
        sendTimedJson(response, 200, chatResult, timing, debugTiming);
        return;
      }
      reject(503, "recruiting_chat_rpc_unavailable");
    }

    if (operation && shouldUseSqlRecruitingAction(operation)) {
      const sqlResult = await timing.track("sqlReducer", () => applySqlRecruitingAction(context, operation));
      if (sqlResult) {
        let synced = await timing.track("loadSyncedAfterSql", () => loadSyncedRecruitingState(context, sqlResult.postId ?? operation.postId));
        let discordDeliveryCount = 0;
        let discordDeliveryError = null;
        if (operation.action === "closeRecruitingPost" && synced.post) {
          try {
            discordDeliveryCount = await timing.track("discordQueue", () => queueRecruitingRoomCancelledDeliveries(context.supabase, synced.post, operation.action));
            synced = await timing.track("reloadAfterCancelNotice", () => loadSyncedRecruitingState(context, synced.post.id));
          } catch (deliveryError) {
            discordDeliveryError = deliveryError.message || "discord_recruiting_delivery_failed";
            console.error("Recruiting Discord delivery queue failed.", deliveryError);
          }
        }
        sendTimedJson(response, 200, {
          ...sqlResult,
          discordDeliveryCount,
          discordDeliveryError,
          ...(synced.post ? { post: synced.post } : {}),
          ...(synced.state ? { state: synced.state } : {}),
        }, timing, debugTiming);
        return;
      }
      reject(503, "recruiting_sql_reducer_unavailable");
    }

    if (operation.action === "confirmRecruitingMatch") {
      await timing.track("roomChangeApproval", () => assertRecruitingRoomChangeComplete(context, operation.postId));
      const state = await timing.track("authoritativeLoad", () => loadAuthoritativeState(context, { operation }));
      const result = await timing.track("authoritativeReplay", () => applyAuthoritativeRecruitingOperation(state, operation));
      replayResult = result;
      post = result.post;
      createdMatch = result.createdMatch;
      notifications = result.notifications;
      action = operation.action;
    }

    const recruitingNotifications = createdMatch
      ? notifications.filter((notification) => !notification.matchId || notification.matchId !== createdMatch.id)
      : notifications;
    let result;
    if (createdMatch) {
      const preparedRecruiting = await timing.track("prepareRecruitingSnapshot", () => persistRecruitingPostSnapshot(context, {
        post,
        notifications: recruitingNotifications,
        action,
        body: { ...body, ...(operation ?? {}) },
        expectedUpdatedAt: operation ? replayResult?.baseUpdatedAt ?? null : null,
        timing,
        prepareOnly: true,
      }));
      const matchNotifications = notifications.filter((notification) => notification.matchId === createdMatch.id);
      const matchResult = await timing.track("persistAtomicConfirmation", () => persistMatchSnapshot(context, {
        match: createdMatch,
        notifications: matchNotifications,
        action: "confirmRecruitingMatch",
        body: { ...body, ...(operation ?? {}) },
        recruitingPersistence: preparedRecruiting.persistence,
      }));
      result = {
        ok: true,
        post,
        postId: post.id,
        applicationCount: Number(matchResult.recruitingPersistResult?.applicationCount ?? preparedRecruiting.applicationCount),
        notificationCount: Number(matchResult.recruitingPersistResult?.notificationCount ?? preparedRecruiting.notificationCount),
        discordDeliveryCount: 0,
        discordDeliveryError: null,
        discordDeliveryDeferred: false,
        createdMatch: matchResult.match,
        matchId: matchResult.matchId,
        confirmationAtomic: Boolean(matchResult.confirmationAtomic),
      };
    } else {
      result = await timing.track("persistSnapshot", () => persistRecruitingPostSnapshot(context, {
        post,
        notifications: recruitingNotifications,
        action,
        body: { ...body, ...(operation ?? {}) },
        expectedUpdatedAt: operation ? replayResult?.baseUpdatedAt ?? null : null,
        timing,
        afterResponseTasks,
      }));
    }
    if (result?.postId && action !== "createRecruitingPost") {
      const synced = await timing.track("loadSyncedAfterPersist", () => loadSyncedRecruitingState(context, result.postId));
      if (synced.post) result.post = synced.post;
      if (synced.state) result.state = synced.state;
    }
    sendTimedJson(response, 200, result, timing, debugTiming);
    afterResponseTasks.forEach((task) => {
      Promise.resolve()
        .then(task)
        .catch((error) => console.error("Recruiting deferred task failed.", error));
    });
  } catch (error) {
    console.error("Recruiting post sync failed.", error);
    const benchPolicyError = getRecruitingBenchPolicyError(error);
    const statusCode = benchPolicyError?.statusCode ?? error.statusCode ?? 500;
    const errorMessage = benchPolicyError?.message ?? error.message ?? "recruiting_post_sync_failed";
    sendTimedJson(response, statusCode, {
      error: errorMessage,
      details: {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        reason: errorMessage,
        statusCode,
      },
    }, timing, debugTiming);
  }
}
