import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import {
  applyAuthoritativeRecruitingOperation,
  getOperation,
  loadAuthoritativeState,
} from "../_authoritativeState.js";
import { addTeamRoster, assertProfilesExist, assertTeamRosterMembers } from "../_rosterEligibility.js";
import { getDiscordProfiles, persistMatchSnapshot, upsertDiscordDeliveryRows } from "../matches/sync-match.js";

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function toDbTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function getTimestamp(item = {}) {
  return item.updatedAt ?? item.createdAt ?? item.queuedAt ?? item.startedAt ?? item.approvedAt ?? new Date().toISOString();
}

function normalizeRoomState(roomState = {}, post = {}) {
  return {
    ...(roomState && typeof roomState === "object" ? roomState : {}),
    ownerId: post.ownerId ?? roomState?.ownerId ?? post.playerId ?? "",
    timingType: post.timingType ?? roomState?.timingType ?? "scheduled",
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getRecruitingCoreSnapshot(post = {}) {
  return {
    visibility: post.visibility === "private" ? "private" : "public",
    playerId: post.playerId ?? post.player_id ?? "",
    teamId: post.teamId ?? post.team_id ?? null,
    targetTeamId: post.targetTeamId ?? post.target_team_id ?? null,
    mode: post.mode ?? "5v5",
    scheduledDate: post.scheduledDate ?? post.scheduled_date ?? null,
    scheduledTime: toDbTime(post.scheduledTime ?? post.scheduled_time) ?? null,
    ranked: post.ranked !== false,
    official: Boolean(post.official),
    ageRestriction: post.ageRestriction ?? post.age_restriction ?? null,
    allowedAgeGroups: toArray(post.allowedAgeGroups ?? post.allowed_age_groups).map(String).sort(),
    sideCapacity: Math.max(1, Math.min(5, Number(post.sideCapacity ?? post.side_capacity ?? 5))),
    hostJoinMode: (post.hostJoinMode ?? post.host_join_mode) === "player" ? "player" : "team",
    hostSide: (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA",
    playerIds: toArray(post.playerIds ?? post.player_ids),
    refereeId: post.refereeId || post.referee_id || "",
  };
}

function toRecruitingPostRow(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  return {
    id: post.id,
    type: post.type ?? "need_player",
    title: String(post.title ?? "").trim() || "매칭방",
    visibility: post.visibility === "private" ? "private" : "public",
    player_id: post.playerId,
    team_id: post.teamId ?? null,
    region: post.region ?? null,
    court_id: post.courtId ?? null,
    court_name: post.court ?? post.courtName ?? "미정",
    mode: post.mode ?? "5v5",
    scheduled_date: post.scheduledDate || null,
    scheduled_time: toDbTime(post.scheduledTime),
    scheduled_at: post.scheduledAt && !["일정 미정", "즉시"].includes(post.scheduledAt) ? post.scheduledAt : null,
    ranked: post.ranked !== false,
    official: Boolean(post.official),
    pre_registered: post.preRegistered !== false,
    rating_scale: Number(post.ratingScale ?? 1),
    age_restriction: post.ageRestriction ?? null,
    allowed_age_groups: toArray(post.allowedAgeGroups),
    rules: post.rules ?? {},
    stakes: post.stakes ?? "",
    court_reserved: Boolean(post.courtReserved),
    court_fee: post.courtFee ?? "",
    spots: Number(post.spots ?? 0),
    target_team_id: post.targetTeamId ?? null,
    referee_id: post.refereeId || null,
    referee_trust_min: Number(post.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(post.statEntryMinutes ?? 60),
    dispute_minutes: Number(post.disputeMinutes ?? 120),
    room_state: roomState,
    host_join_mode: post.hostJoinMode === "player" ? "player" : "team",
    host_side: post.hostSide === "teamB" ? "teamB" : "teamA",
    host_ready: Boolean(post.hostReady),
    side_capacity: Math.max(1, Math.min(5, Number(post.sideCapacity ?? 5))),
    player_ids: toArray(post.playerIds),
    position: post.position ?? null,
    memo: post.memo ?? "",
    status: post.status ?? "open",
    confirmed_at: post.confirmedAt ?? null,
    created_at: post.createdAt ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function toRecruitingApplicationRows(post = {}) {
  return toArray(post.applicants).map((application) => ({
    post_id: post.id,
    player_id: application.playerId,
    team_id: application.teamId ?? null,
    kind: application.kind === "team" || application.teamId ? "team" : "player",
    side: application.side === "teamA" ? "teamA" : "teamB",
    status: ["waiting", "ready", "confirmed"].includes(application.status) ? application.status : "waiting",
    reserve: Boolean(application.reserve),
    position: application.position ?? null,
    player_ids: toArray(application.playerIds),
    source_team_id: application.sourceTeamId ?? null,
    source_entry_id: application.sourceEntryId ?? null,
    created_at: application.createdAt ?? new Date().toISOString(),
    updated_at: application.updatedAt ?? application.createdAt ?? new Date().toISOString(),
  })).filter((row) => row.player_id);
}

function toNotificationRows(notifications = [], fallbackProfileId = "") {
  return toArray(notifications).map((notification) => ({
    id: notification.id,
    user_id: notification.targetUserId ?? fallbackProfileId,
    target_user_id: notification.targetUserId ?? null,
    title: notification.title ?? "알림",
    body: notification.body ?? "",
    tone: notification.tone ?? "match",
    type: notification.type ?? null,
    match_id: notification.matchId ?? null,
    recruiting_post_id: notification.recruitingPostId ?? null,
    invitation_id: notification.invitationId ?? null,
    discord_event: notification.discordEvent ?? notification.eventType ?? null,
    read_at: notification.readAt ?? null,
    payload: notification,
    created_at: notification.createdAt ?? new Date().toISOString(),
    updated_at: getTimestamp(notification),
  })).filter((row) => row.id);
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

function getPublicAppUrl() {
  return String(process.env.VITE_PUBLIC_APP_URL || process.env.PUBLIC_APP_URL || "").trim().replace(/\/$/, "");
}

function getRecruitingWebPath(postId = "") {
  return `/app/recruiting?post=${encodeURIComponent(String(postId))}`;
}

function getRecruitingWebUrl(postId = "") {
  const baseUrl = getPublicAppUrl();
  const path = getRecruitingWebPath(postId);
  return baseUrl ? `${baseUrl}${path}` : path;
}

function getModeCapacity(mode = "5v5") {
  const match = String(mode).match(/^(\d+)/);
  const value = match ? Number(match[1]) : 5;
  return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 5));
}

function getRecruitingPlayerCount(post = {}) {
  return [
    ...(toArray(post.playerIds)),
    ...(toArray(post.applicants).flatMap((application) => [
      application.playerId,
      ...(toArray(application.playerIds)),
    ])),
  ].filter(Boolean).length;
}

function isInstantRecruitingPost(post = {}) {
  return post.timingType === "instant" || post.roomState?.timingType === "instant" || post.scheduledAt === "즉시";
}

function toRoomOpenedDiscordRows(post = {}, profiles = []) {
  const now = new Date().toISOString();
  const capacity = getModeCapacity(post.mode) * 2;
  const playerCount = getRecruitingPlayerCount(post);
  const payload = {
    title: "방 개설",
    body: [
      "즉시 매칭방이 열렸습니다.",
      post.title || "매칭방",
      `구장: ${post.court || "구장 미정"}`,
      `인원: ${playerCount}/${capacity}`,
      `방식: ${post.mode || "5v5"}`,
    ].join("\n"),
    webPath: getRecruitingWebPath(post.id),
    webUrl: getRecruitingWebUrl(post.id),
    actions: [],
  };

  return profiles.map((profile) => {
    const id = `discord-room-opened-${post.id}-${profile.id}`;
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
        status: "queued",
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

async function queueInstantRoomOpenedDiscordDeliveries(supabase, post = {}, action = "sync") {
  if (action !== "createRecruitingPost" || !isInstantRecruitingPost(post)) return 0;
  const profiles = await getDiscordProfiles(supabase, Array.from(participantIdsFromPost(post)));
  const rows = toRoomOpenedDiscordRows(post, profiles);
  return upsertDiscordDeliveryRows(supabase, rows);
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
      .filter((invitation) => invitation.role !== "referee")
      .map((invitation) => invitation.targetUserId)),
  ].filter(Boolean))];
}

const AGE_ELIGIBILITY_ACTIONS = new Set([
  "createRecruitingPost",
  "interestRecruitingPost",
  "joinRecruitingSideParty",
  "acceptRecruitingInvitation",
  "inviteRecruitingPlayers",
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

async function validateRecruitingRosterEligibility(supabase, post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  await assertProfilesExist(supabase, getPlayerEligibilityIds(post), "recruiting_player_not_found");

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
    if (invitation.role === "referee" || !invitation.teamId) return;
    addTeamRoster(rostersByTeam, invitation.teamId, [invitation.targetUserId]);
  });

  await assertTeamRosterMembers(supabase, rostersByTeam, "recruiting_team_roster_not_member");
}

function isOwner(profileId, post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return Boolean(profileId && (profileId === post.ownerId || profileId === roomState.ownerId || profileId === post.playerId || profileId === post.player_id));
}

function hasInvitationFor(profileId, post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return toArray(roomState.invitations).some((invitation) => (
    invitation.targetUserId === profileId && invitation.status !== "expired" && invitation.status !== "declined"
  ));
}

function hasRefereeInvitationFor(profileId, post = {}) {
  const roomState = normalizeRoomState(post.roomState ?? post.room_state, post);
  return toArray(roomState.invitations).some((invitation) => (
    invitation.role === "referee" &&
    invitation.targetUserId === profileId &&
    invitation.status !== "expired" &&
    invitation.status !== "declined"
  ));
}

function getSideCapacity(post = {}) {
  const modeMatch = String(post.mode ?? "").match(/^(\d+)/);
  const fallbackCapacity = modeMatch ? Number(modeMatch[1]) : 5;
  return Math.max(1, Math.min(5, Number(post.sideCapacity ?? post.side_capacity ?? fallbackCapacity)));
}

function isSoloIndividualRoom(post = {}) {
  return getSideCapacity(post) === 1 && (post.hostJoinMode ?? post.host_join_mode) === "player";
}

function validateRecruitingPostShape(post = {}) {
  const capacity = getSideCapacity(post);
  const applications = toArray(post.applicants);
  const oversizedApplication = applications.find((application) => toArray(application.playerIds).length > capacity);
  if (oversizedApplication) reject(400, "recruiting_party_exceeds_side_capacity");

  if (!isSoloIndividualRoom(post)) return;
  const roomState = normalizeRoomState(post.roomState, post);
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

const OWNER_RECRUITING_ACTIONS = new Set([
  "updateRecruitingRoomRules",
  "setRecruitingStatRecorder",
  "kickRecruitingApplicant",
  "confirmRecruitingMatch",
  "closeRecruitingPost",
  "inviteRecruitingReferee",
]);

const PARTICIPANT_RECRUITING_ACTIONS = new Set([
  "sendRecruitingChat",
  "setRecruitingReady",
  "cancelRecruitingParticipation",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "inviteRecruitingPlayers",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "setRecruitingSlotPosition",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
]);

const JOIN_RECRUITING_ACTIONS = new Set([
  "interestRecruitingPost",
  "joinRecruitingSideParty",
]);

const CORE_LOCKED_RECRUITING_ACTIONS = new Set([
  ...PARTICIPANT_RECRUITING_ACTIONS,
  ...JOIN_RECRUITING_ACTIONS,
]);

function canSyncRecruitingAction(profileId, existingPost, nextPost, action, body = {}) {
  if (!profileId || !nextPost?.id) return false;
  if (!existingPost) {
    return action === "createRecruitingPost" && participantIdsFromPost(nextPost).has(profileId) && isOwner(profileId, nextPost);
  }
  const existingParticipants = participantIdsFromPost({
    ...existingPost,
    ownerId: existingPost.room_state?.ownerId,
    playerId: existingPost.player_id,
    playerIds: existingPost.player_ids,
    applicants: [],
    roomState: existingPost.room_state,
  });
  const nextParticipants = participantIdsFromPost(nextPost);

  if (OWNER_RECRUITING_ACTIONS.has(action)) return isOwner(profileId, existingPost);
  if (JOIN_RECRUITING_ACTIONS.has(action)) {
    if (action === "interestRecruitingPost" && body.joinMode === "referee") {
      return existingPost.visibility !== "private" && nextPost.refereeId === profileId;
    }
    if (existingPost.visibility === "private" && !hasInvitationFor(profileId, existingPost)) return false;
    return nextParticipants.has(profileId);
  }
  if (PARTICIPANT_RECRUITING_ACTIONS.has(action)) {
    return existingParticipants.has(profileId) || nextParticipants.has(profileId) || hasInvitationFor(profileId, existingPost);
  }
  return existingParticipants.has(profileId) || nextParticipants.has(profileId);
}

function actionCanAssignReferee(profileId, existingPost, body = {}) {
  const action = body.action ?? "sync";
  return (
    (action === "interestRecruitingPost" && body.joinMode === "referee") ||
    (action === "acceptRecruitingInvitation" && hasRefereeInvitationFor(profileId, existingPost))
  );
}

function validateLockedRecruitingCore(profileId, existingPost, nextPost, body = {}) {
  const action = body.action ?? "sync";
  if (!existingPost || !CORE_LOCKED_RECRUITING_ACTIONS.has(action)) return;

  const existingCore = getRecruitingCoreSnapshot(existingPost);
  const nextCore = getRecruitingCoreSnapshot(nextPost);
  if (actionCanAssignReferee(profileId, existingPost, body)) existingCore.refereeId = nextCore.refereeId;

  if (!sameJson(existingCore, nextCore)) reject(403, "recruiting_core_locked");
}

async function isActiveReferee(supabase, userId) {
  if (!userId) return false;
  const { data, error } = await supabase
    .from("referee_appointments")
    .select("id, ends_at")
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  const now = Date.now();
  return toArray(data).some((row) => !row.ends_at || Date.parse(row.ends_at) > now);
}

async function validateRefereeAction(supabase, profileId, existingPost, nextPost, body) {
  const action = body.action ?? "sync";
  if (action === "inviteRecruitingReferee") {
    if (!(await isActiveReferee(supabase, body.refereeId))) reject(403, "referee_not_eligible");
    return;
  }
  if (action === "interestRecruitingPost" && body.joinMode === "referee") {
    if (!(await isActiveReferee(supabase, profileId))) reject(403, "referee_not_eligible");
    return;
  }
  if (action === "acceptRecruitingInvitation" && hasRefereeInvitationFor(profileId, existingPost)) {
    if (!(await isActiveReferee(supabase, profileId))) reject(403, "referee_not_eligible");
    return;
  }
  if (nextPost.refereeId && nextPost.refereeId !== existingPost?.referee_id && !(await isActiveReferee(supabase, nextPost.refereeId))) {
    reject(403, "referee_not_eligible");
  }
}

export async function persistRecruitingPostSnapshot(context, { post, notifications = [], action = "sync", body = {} }) {
  if (!post?.id) reject(400, "missing_recruiting_post");
  validateRecruitingPostShape(post);

  const actionBody = { ...body, action };
  const { data: existingPost, error: existingError } = await context.supabase
      .from("recruiting_posts")
      .select("id, visibility, player_id, team_id, target_team_id, mode, scheduled_date, scheduled_time, ranked, official, side_capacity, host_join_mode, host_side, player_ids, referee_id, room_state, age_restriction, allowed_age_groups")
      .eq("id", post.id)
      .maybeSingle();

  if (existingError) throw existingError;
  if (!canSyncRecruitingAction(context.profileId, existingPost, post, action, actionBody)) {
    reject(403, "recruiting_sync_permission_denied");
  }
  validateLockedRecruitingCore(context.profileId, existingPost, post, actionBody);
  await validateRefereeAction(context.supabase, context.profileId, existingPost, post, actionBody);
  await validateRecruitingRosterEligibility(context.supabase, post);
  await validateAgeEligibility(context.supabase, context.profileId, existingPost, post, actionBody);

  const postRow = toRecruitingPostRow(post);
  const applicationRows = toRecruitingApplicationRows(post);
  const notificationRows = toNotificationRows(notifications, context.profileId);

  const { data: persistResult, error: persistError } = await context.supabase.rpc("rankball_recruiting_action", {
    p_actor_profile_id: context.profileId,
    p_action: action,
    p_post_row: postRow,
    p_application_rows: applicationRows,
    p_notification_rows: notificationRows,
  });
  if (persistError) throw persistError;
  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  try {
    discordDeliveryCount = await queueInstantRoomOpenedDiscordDeliveries(context.supabase, post, action);
  } catch (deliveryError) {
    discordDeliveryError = deliveryError.message || "discord_room_opened_delivery_failed";
    console.error("Recruiting Discord delivery queue failed.", deliveryError);
  }

  return {
    ok: true,
    post,
    postId: post.id,
    applicationCount: Number(persistResult?.applicationCount ?? applicationRows.length),
    notificationCount: Number(persistResult?.notificationCount ?? notificationRows.length),
    discordDeliveryCount,
    discordDeliveryError,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const operation = getOperation(body, body.action ? String(body.action) : "sync");
    let post = body.post && typeof body.post === "object" ? body.post : null;
    let notifications = body.notifications ?? [];
    let action = body.action ? String(body.action) : "sync";
    let createdMatch = null;

    if (operation && (!post || operation.action === "createRecruitingPost")) {
      const state = await loadAuthoritativeState(context, { operation });
      const result = applyAuthoritativeRecruitingOperation(state, operation);
      post = result.post;
      createdMatch = result.createdMatch;
      notifications = result.notifications;
      action = operation.action;
    } else if (operation && post) {
      action = operation.action;
      if (body.createdMatch && typeof body.createdMatch === "object") createdMatch = body.createdMatch;
    }

    const recruitingNotifications = createdMatch
      ? notifications.filter((notification) => !notification.matchId || notification.matchId !== createdMatch.id)
      : notifications;
    const result = await persistRecruitingPostSnapshot(context, { post, notifications: recruitingNotifications, action, body: { ...body, ...(operation ?? {}) } });
    if (createdMatch) {
      const matchNotifications = notifications.filter((notification) => notification.matchId === createdMatch.id);
      const matchResult = await persistMatchSnapshot(context, {
        match: createdMatch,
        notifications: matchNotifications,
        action: "confirmRecruitingMatch",
        body: { ...body, ...(operation ?? {}) },
      });
      result.createdMatch = matchResult.match;
      result.matchId = matchResult.matchId;
    }

    sendJson(response, 200, result);
  } catch (error) {
    console.error("Recruiting post sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "recruiting_post_sync_failed" });
  }
}
