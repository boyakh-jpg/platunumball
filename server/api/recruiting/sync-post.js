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

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function isTrue(value) {
  return value === true || value === "true";
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
    hostJoinMode: getCanonicalHostJoinMode(post),
    hostSide: (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA",
    playerIds: toArray(post.playerIds ?? post.player_ids),
    refereeId: post.refereeId || post.referee_id || "",
  };
}

function toRecruitingPostRow(post = {}) {
  const roomState = normalizeRoomState(post.roomState, post);
  const courtId = post.courtId ?? post.court_id ?? post.approvedCourtId ?? post.registeredCourtId ?? null;
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
    court_fee: nullableText(post.courtFee),
    spots: Number(post.spots ?? 0),
    target_team_id: nullableText(post.targetTeamId),
    referee_id: nullableText(post.refereeId),
    referee_trust_min: Number(post.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(post.statEntryMinutes ?? 60),
    dispute_minutes: Number(post.disputeMinutes ?? 120),
    room_state: roomState,
    host_join_mode: post.hostJoinMode === "player" ? "player" : "team",
    host_side: post.hostSide === "teamB" ? "teamB" : "teamA",
    host_ready: Boolean(post.hostReady),
    side_capacity: Math.max(1, Math.min(5, Number(post.sideCapacity ?? 5))),
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
      status: ["waiting", "ready", "confirmed"].includes(application.status) ? application.status : "waiting",
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

function getCanonicalSideCapacity(post = {}) {
  const modeCapacity = getModeCapacity(post.mode);
  const rawCapacity = Number(post.sideCapacity ?? post.side_capacity ?? modeCapacity);
  const safeCapacity = Number.isFinite(rawCapacity) ? rawCapacity : modeCapacity;
  return Math.max(1, Math.min(5, modeCapacity, safeCapacity));
}

function getCanonicalHostJoinMode(post = {}) {
  const teamId = nullableText(post.teamId ?? post.team_id);
  const hostJoinMode = post.hostJoinMode ?? post.host_join_mode;
  return hostJoinMode === "player" || !teamId ? "player" : "team";
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
    if (invitation.role === "referee" || !invitation.teamId || !isPendingInvitation(invitation)) return;
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

function getEntryActivePlayerIds(entry = {}, capacity = 5, fallbackPlayerId = "") {
  const playerIds = toArray(entry.playerIds ?? entry.player_ids);
  if (playerIds.length) return playerIds.slice(0, capacity);
  return fallbackPlayerId ? [fallbackPlayerId] : [];
}

function getRecruitingSideCounts(post = {}) {
  const capacity = getSideCapacity(post);
  const hostSide = (post.hostSide ?? post.host_side) === "teamB" ? "teamB" : "teamA";
  const counts = { teamA: 0, teamB: 0 };
  const seen = new Set();
  const addPlayers = (side, playerIds = []) => {
    if (!counts[side]) counts[side] = 0;
    toArray(playerIds).forEach((playerId) => {
      if (!playerId || seen.has(playerId)) return;
      seen.add(playerId);
      counts[side] += 1;
    });
  };

  const hostJoinMode = getCanonicalHostJoinMode(post);
  const hostPlayers = hostJoinMode === "team"
    ? getEntryActivePlayerIds(post, capacity, post.playerId ?? post.player_id ?? "")
    : [post.playerId ?? post.player_id].filter(Boolean);
  addPlayers(hostSide, hostPlayers);

  toArray(post.applicants).forEach((application) => {
    if (application.reserve) return;
    const side = application.side === "teamA" ? "teamA" : "teamB";
    const isTeamEntry = application.kind === "team" || application.teamId || application.team_id;
    const players = isTeamEntry
      ? getEntryActivePlayerIds(application, capacity, application.playerId ?? application.player_id ?? "")
      : [application.playerId ?? application.player_id].filter(Boolean);
    addPlayers(side, players);
  });

  return counts;
}

function validateRecruitingPostShape(post = {}) {
  const capacity = getSideCapacity(post);
  const applications = toArray(post.applicants);
  const oversizedApplication = applications.find((application) => toArray(application.playerIds).length > capacity);
  if (oversizedApplication) reject(400, "recruiting_party_exceeds_side_capacity");
  const sideCounts = getRecruitingSideCounts(post);
  if (sideCounts.teamA > capacity || sideCounts.teamB > capacity) reject(400, "recruiting_side_exceeds_capacity");

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
  "setRecruitingTeamPartyRoster",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "inviteRecruitingReferee",
]);

const JOIN_RECRUITING_ACTIONS = new Set([
  "interestRecruitingPost",
  "joinRecruitingSideParty",
]);

const MEMBERSHIP_ADD_RECRUITING_ACTIONS = new Set([
  "createRecruitingPost",
  "interestRecruitingPost",
  "joinRecruitingSideParty",
  "acceptRecruitingInvitation",
  "setRecruitingTeamPartyRoster",
]);

const AUTHORITATIVE_REPLAY_RECRUITING_ACTIONS = new Set([
  "cancelRecruitingParticipation",
  "confirmRecruitingMatch",
  "interestRecruitingPost",
  "inviteRecruitingPlayers",
  "inviteRecruitingReferee",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "joinRecruitingSideParty",
  "setRecruitingApplicantPlacement",
  "setRecruitingSlotPosition",
  "setRecruitingTeamPartyRoster",
]);

const SQL_REDUCER_RECRUITING_ACTIONS = new Set([
  "cancelRecruitingParticipation",
  "setRecruitingReady",
  "setRecruitingApplicantPlacement",
  "setRecruitingSlotPosition",
]);

const CORE_LOCKED_RECRUITING_ACTIONS = new Set([
  ...PARTICIPANT_RECRUITING_ACTIONS,
  ...JOIN_RECRUITING_ACTIONS,
]);

function shouldReplayRecruitingOperation(operation = {}) {
  return AUTHORITATIVE_REPLAY_RECRUITING_ACTIONS.has(String(operation?.action ?? ""));
}

function isMissingSqlReducer(error = {}) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "PGRST202" ||
    message.includes("rankball_recruiting_slot_position_action") ||
    message.includes("rankball_recruiting_cancel_participation_action") ||
    message.includes("rankball_recruiting_applicant_placement_action") ||
    message.includes("rankball_recruiting_ready_action") ||
    message.includes("rankball_recruiting_interest_player_action")
  );
}

function shouldUseSqlRecruitingAction(operation = {}) {
  return SQL_REDUCER_RECRUITING_ACTIONS.has(String(operation?.action ?? ""));
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

async function timeStep(timing, name, callback) {
  return timing ? timing.track(name, callback) : callback();
}

async function loadSyncedRecruitingPost(context, postId = "") {
  if (!postId) return null;
  const state = await loadAuthoritativeState(context, { operation: { action: "loadRecruitingPost", postId } });
  return (state.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
}

async function applySqlRecruitingAction(context, operation = {}) {
  if (operation.action === "setRecruitingReady") {
    const { data, error } = await context.supabase.rpc("rankball_recruiting_ready_action", {
      p_actor_profile_id: context.profileId,
      p_post_id: operation.postId,
      p_ready: operation.ready !== false,
    });
    if (error) {
      if (isMissingSqlReducer(error)) return null;
      throw error;
    }
    if (data?.fallback) return null;
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
    if (data?.fallback) return null;
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
    if (data?.fallback) return null;
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
    if (existingPost.visibility === "private" && !hasInvitationFor(profileId, existingPost)) return false;
    return nextParticipants.has(profileId);
  }
  if (PARTICIPANT_RECRUITING_ACTIONS.has(action)) {
    if (action === "acceptRecruitingInvitation" || action === "declineRecruitingInvitation") {
      return existingParticipants.has(profileId) || hasInvitationFor(profileId, existingPost);
    }
    return existingParticipants.has(profileId);
  }
  return existingParticipants.has(profileId) || nextParticipants.has(profileId);
}

function validateNoUnexpectedRosterInsert(existingPost, nextPost, action) {
  if (!existingPost || MEMBERSHIP_ADD_RECRUITING_ACTIONS.has(action)) return;
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

export async function persistRecruitingPostSnapshot(context, { post, notifications = [], action = "sync", body = {}, expectedUpdatedAt = null, timing = null }) {
  if (!post?.id) reject(400, "missing_recruiting_post");
  validateRecruitingPostShape(post);

  const actionBody = { ...body, action };
  const { data: existingPost, error: existingError } = await timeStep(timing, "persistExistingPost", () => context.supabase
      .from("recruiting_posts")
      .select("id, visibility, player_id, team_id, target_team_id, mode, scheduled_date, scheduled_time, ranked, official, side_capacity, host_join_mode, host_side, player_ids, referee_id, referee_trust_min, room_state, age_restriction, allowed_age_groups, updated_at")
      .eq("id", post.id)
      .maybeSingle());

  if (existingError) throw existingError;
  const { data: existingApplications, error: existingApplicationsError } = await timeStep(timing, "persistExistingApplications", () => existingPost
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
    if (!canSyncRecruitingAction(context.profileId, existingPostSnapshot, post, action, actionBody)) {
      reject(403, "recruiting_sync_permission_denied");
    }
    validateNoUnexpectedRosterInsert(existingPostSnapshot, post, action);
    validateLockedRecruitingCore(context.profileId, existingPostSnapshot, post, actionBody);
  });
  await timeStep(timing, "validateReferee", () => validateRefereeAction(context.supabase, context.profileId, existingPostSnapshot, post, actionBody));
  await timeStep(timing, "validateRoster", () => validateRecruitingRosterEligibility(context.supabase, post));
  await timeStep(timing, "validateAge", () => validateAgeEligibility(context.supabase, context.profileId, existingPostSnapshot, post, actionBody));

  const postRow = toRecruitingPostRow(post);
  const applicationRows = toRecruitingApplicationRows(post);
  const notificationRows = toNotificationRows(notifications, context.profileId);

  const { data: persistResult, error: persistError } = await timeStep(timing, "persistRpc", () => context.supabase.rpc("rankball_recruiting_action", {
    p_actor_profile_id: context.profileId,
    p_action: action,
    p_post_row: postRow,
    p_application_rows: applicationRows,
    p_notification_rows: notificationRows,
    p_expected_updated_at: expectedUpdatedAt,
  }));
  if (persistError) {
    if (persistError.code === "40001" || String(persistError.message ?? "").includes("recruiting_stale_snapshot")) {
      reject(409, "recruiting_stale_snapshot");
    }
    throw persistError;
  }
  let discordDeliveryCount = 0;
  let discordDeliveryError = null;
  try {
    discordDeliveryCount = await timeStep(timing, "discordQueue", () => queueInstantRoomOpenedDiscordDeliveries(context.supabase, post, action));
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
  const timing = createTimingProbe();
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
    const operation = getOperation(body, body.action ? String(body.action) : "sync");
    let post = body.post && typeof body.post === "object" ? body.post : null;
    let notifications = body.notifications ?? [];
    let action = body.action ? String(body.action) : "sync";
    let createdMatch = null;
    let replayResult = null;

    if (operation && shouldUseSqlRecruitingAction(operation)) {
      const sqlResult = await timing.track("sqlReducer", () => applySqlRecruitingAction(context, operation));
      if (sqlResult) {
        const syncedPost = await timing.track("loadSyncedAfterSql", () => loadSyncedRecruitingPost(context, sqlResult.postId ?? operation.postId));
        sendTimedJson(response, 200, {
          ...sqlResult,
          ...(syncedPost ? { post: syncedPost } : {}),
        }, timing, debugTiming);
        return;
      }
    }

    if (operation && (!post || operation.action === "createRecruitingPost" || shouldReplayRecruitingOperation(operation))) {
      const state = await timing.track("authoritativeLoad", () => loadAuthoritativeState(context, { operation }));
      const result = await timing.track("authoritativeReplay", () => applyAuthoritativeRecruitingOperation(state, operation));
      replayResult = result;
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
    const result = await timing.track("persistSnapshot", () => persistRecruitingPostSnapshot(context, {
      post,
      notifications: recruitingNotifications,
      action,
      body: { ...body, ...(operation ?? {}) },
      expectedUpdatedAt: operation ? replayResult?.baseUpdatedAt ?? null : null,
      timing,
    }));
    if (result?.postId && action !== "createRecruitingPost") {
      const syncedPost = await timing.track("loadSyncedAfterPersist", () => loadSyncedRecruitingPost(context, result.postId));
      if (syncedPost) result.post = syncedPost;
    }
    if (createdMatch) {
      const matchNotifications = notifications.filter((notification) => notification.matchId === createdMatch.id);
      const matchResult = await timing.track("persistCreatedMatch", () => persistMatchSnapshot(context, {
        match: createdMatch,
        notifications: matchNotifications,
        action: "confirmRecruitingMatch",
        body: { ...body, ...(operation ?? {}) },
      }));
      result.createdMatch = matchResult.match;
      result.matchId = matchResult.matchId;
    }

    sendTimedJson(response, 200, result, timing, debugTiming);
  } catch (error) {
    console.error("Recruiting post sync failed.", error);
    sendTimedJson(response, error.statusCode || 500, {
      error: error.message || "recruiting_post_sync_failed",
      details: {
        ...(error.details && typeof error.details === "object" ? error.details : {}),
        reason: error.message || "recruiting_post_sync_failed",
        statusCode: error.statusCode || 500,
      },
    }, timing, debugTiming);
  }
}
