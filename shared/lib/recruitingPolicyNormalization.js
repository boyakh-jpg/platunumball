import { DISPUTE_WINDOW_MINUTES, PLAYER_POSITIONS, REFEREE_TRUST_MIN, STAT_ENTRY_WINDOW_MINUTES } from "./constants.js";
import { normalizeRecruitingMmrRangeMode } from "./recruitingMmrPolicy.js";
import { RECRUITING_TYPES, VALID_SIDES, getRecruitingBenchCapacity, getRecruitingJoinMode, getRecruitingSideCapacity, isTeamOnlyRecruitingRoom, normalizeRecruitingApplicationStatus, unique } from "./recruitingPolicyCore.js";

export function isRecruitingTeamSideLocked(post = {}) {
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const teamOnly = isTeamOnlyRecruitingRoom({ ...post, roomState });
  return Boolean(
    (post.hostJoinMode === "team" || post.teamId) &&
    (post.visibility === "private" || teamOnly)
  );
}
export function normalizeRecruitingApplicant(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return {
      kind: "player",
      joinMode: "player",
      playerId: entry,
      teamId: null,
      side: "teamB",
      status: "waiting",
      reserve: false,
      position: null,
      playerIds: [],
      sourceEntryId: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  const joinMode = getRecruitingJoinMode(entry);
  const kind = joinMode === "team" ? "team" : "player";
  const side = VALID_SIDES.has(entry.side) ? entry.side : "teamB";
  const status = normalizeRecruitingApplicationStatus(entry.status);

  if (kind === "team" && entry.teamId) {
    return {
      kind,
      joinMode,
      teamId: entry.teamId,
      playerId: entry.playerId ?? null,
      side,
      status,
      reserve: Boolean(entry.reserve),
      position: entry.position ?? null,
      playerIds: unique(entry.playerIds ?? entry.players ?? []),
      createdAt: entry.createdAt ?? null,
      updatedAt: entry.updatedAt ?? null,
    };
  }
  if (entry.playerId) {
    return {
      kind,
      joinMode,
      playerId: entry.playerId,
      teamId: null,
      sourceTeamId: entry.sourceTeamId ?? entry.partyTeamId ?? null,
      sourceEntryId: entry.sourceEntryId ?? entry.partyEntryId ?? null,
      side,
      status,
      reserve: Boolean(entry.reserve),
      position: entry.position ?? null,
      playerIds: [],
      createdAt: entry.createdAt ?? null,
      updatedAt: entry.updatedAt ?? null,
    };
  }
  return null;
}
export function normalizeRecruitingApplicants(applicants = []) {
  return applicants.map(normalizeRecruitingApplicant).filter(Boolean);
}
export function normalizeRecruitingRoomState(roomState = {}) {
  roomState = roomState && typeof roomState === "object" ? roomState : {};
  const chatMessages = Array.isArray(roomState.chatMessages)
    ? roomState.chatMessages
        .map((message) => ({
          id: message.id ?? "",
          userId: message.userId ?? message.playerId ?? "",
          body: String(message.body ?? "").slice(0, 500),
          createdAt: message.createdAt ?? null,
        }))
        .filter((message) => message.userId && message.body.trim())
    : [];
  const kickLog = Array.isArray(roomState.kickLog)
    ? roomState.kickLog.map((item) => ({
        id: item.id ?? "",
        targetUserId: item.targetUserId ?? "",
        by: item.by ?? "",
        penalty: Number(item.penalty ?? 0),
        createdAt: item.createdAt ?? null,
      }))
    : [];
  const hostPenalties = Array.isArray(roomState.hostPenalties)
    ? roomState.hostPenalties.map((item) => ({
        id: item.id ?? "",
        by: item.by ?? "",
        penalty: Number(item.penalty ?? 0),
        reason: item.reason ?? "",
        createdAt: item.createdAt ?? null,
      }))
    : [];
  const invitations = Array.isArray(roomState.invitations)
    ? roomState.invitations
        .map((item) => ({
          id: item.id ?? "",
          role: item.role === "referee" ? "referee" : "player",
          targetUserId: item.targetUserId ?? item.userId ?? "",
          fromUserId: item.fromUserId ?? item.by ?? "",
          teamId: item.teamId ?? null,
          joinMode: item.joinMode === "player" ? "player" : (item.joinMode === "team" || item.teamId ? "team" : ""),
          side: VALID_SIDES.has(item.side) ? item.side : "teamB",
          reserve: Boolean(item.reserve),
          status: ["pending", "accepted", "declined", "expired"].includes(item.status) ? item.status : "pending",
          createdAt: item.createdAt ?? null,
          updatedAt: item.updatedAt ?? null,
        }))
        .filter((item) => item.id && item.targetUserId)
    : [];
  const partyReserves = roomState.partyReserves && typeof roomState.partyReserves === "object"
    ? Object.fromEntries(
        Object.entries(roomState.partyReserves)
          .map(([key, ids]) => [key, unique(Array.isArray(ids) ? ids : [])])
          .filter(([, ids]) => ids.length),
      )
    : {};
  const reserveReady = roomState.reserveReady && typeof roomState.reserveReady === "object"
    ? Object.fromEntries(Object.entries(roomState.reserveReady).filter(([playerId, ready]) => playerId && ready))
    : {};
  const pinnedReservePlayers = roomState.pinnedReservePlayers && typeof roomState.pinnedReservePlayers === "object"
    ? Object.fromEntries(
        Object.entries(roomState.pinnedReservePlayers)
          .map(([sideName, ids]) => [sideName, unique(Array.isArray(ids) ? ids : [])])
          .filter(([sideName, ids]) => VALID_SIDES.has(sideName) && ids.length),
      )
    : {};
  const slotPositions = roomState.slotPositions && typeof roomState.slotPositions === "object"
    ? Object.fromEntries(
        Object.entries(roomState.slotPositions)
          .map(([playerId, position]) => [playerId, String(position ?? "").trim()])
          .filter(([playerId, position]) => playerId && PLAYER_POSITIONS.includes(position)),
      )
    : {};

  return {
    ...roomState,
    hostReserve: Boolean(roomState.hostReserve),
    refereeWanted: Boolean(roomState.refereeWanted),
    chatMessages,
    kickLog,
    hostPenalties,
    invitations,
    partyReserves,
    reserveReady,
    pinnedReservePlayers,
    slotPositions,
  };
}
export function getRecruitingApplicantKey(entry) {
  const applicant = normalizeRecruitingApplicant(entry);
  if (!applicant) return "";
  return applicant.kind === "team" ? `team:${applicant.teamId}` : `player:${applicant.playerId}`;
}
export function hasRecruitingApplicant(post = {}, entry) {
  const key = getRecruitingApplicantKey(entry);
  if (!key) return false;
  return normalizeRecruitingApplicants(post.applicants ?? []).some((applicant) => getRecruitingApplicantKey(applicant) === key);
}
export function getPendingRecruitingInvitations(state = {}, userId) {
  if (!userId) return [];
  return (state.recruitingPosts ?? [])
    .filter((post) => post.status === "open")
    .flatMap((post) => normalizeRecruitingRoomState(post.roomState ?? {}).invitations
      .filter((invitation) => invitation.targetUserId === userId && invitation.status === "pending")
      .map((invitation) => ({ post, invitation })));
}
export function getRecruitingInvitationSenderName(state = {}, invitation = {}) {
  const senderId = String(invitation.fromUserId ?? "").trim();
  const sender = (state.users ?? []).find((user) => user.id === senderId);
  return sender?.name || invitation.fromUserName || "방 참가자";
}
export function hasPendingRecruitingInvitation(post = {}, userId) {
  if (!userId || post.status !== "open") return false;
  const hasInvitationSnapshot = post.__invitationsPartial === true || Object.prototype.hasOwnProperty.call(post.roomState ?? {}, "invitations");
  const hasPendingInvitation = normalizeRecruitingRoomState(post.roomState ?? {}).invitations.some((invitation) => (
    invitation.targetUserId === userId && invitation.status === "pending"
  ));
  if (hasInvitationSnapshot) return hasPendingInvitation;
  if (Array.isArray(post.__feedRelations) && post.__feedRelations.includes("invited")) return true;
  return hasPendingInvitation;
}
export function getRecruitingRoomOwnerId(post = {}) {
  const safePost = post ?? {};
  const roomState = normalizeRecruitingRoomState(safePost.roomState ?? {});
  return safePost.ownerId || roomState.ownerId || safePost.createdBy || safePost.createdPlayerId || safePost.playerId || "";
}
export function isRecruitingRoomOwner(post = {}, userId = "") {
  return Boolean(userId && getRecruitingRoomOwnerId(post) === userId);
}
export function isRecruitingPostForUser(post = {}, userId, teamIds = []) {
  if (!userId) return false;
  if (Array.isArray(post.__feedRelations) && post.__feedRelations.some((relation) => ["owner", "participant", "referee"].includes(relation))) return true;
  if (getRecruitingRoomOwnerId(post) === userId) return true;
  if (post.playerId === userId) return true;
  if (post.refereeId === userId) return true;
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  if (unique(post.playerIds ?? post.players ?? []).includes(userId)) return true;
  if ((roomState.partyReserves.host ?? []).includes(userId)) return true;
  return normalizeRecruitingApplicants(post.applicants ?? []).some((applicant) => {
    if (applicant.playerId === userId) return true;
    if ((applicant.playerIds ?? []).includes(userId)) return true;
    const reserveKey = getRecruitingApplicantKey(applicant);
    return Boolean(reserveKey && (roomState.partyReserves[reserveKey] ?? []).includes(userId));
  });
}
export function getRecruitingEntryForUser(lobby = {}, userId) {
  if (!userId) return null;
  return (lobby.entries ?? []).find((entry) => (
    (entry.players ?? []).includes(userId) ||
    (entry.reserves ?? []).includes(userId)
  )) ?? null;
}
export function normalizeRecruitingPost(post = {}) {
  post = post && typeof post === "object" ? post : {};
  const type = RECRUITING_TYPES[post.type] ? post.type : "need_player";
  const hostJoinMode = post.hostJoinMode === "team"
    || (post.hostJoinMode !== "player" && Boolean(post.teamId))
    ? "team"
    : "player";
  const playerIds = unique(post.playerIds ?? post.players ?? []);
  const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
  const ownerId = getRecruitingRoomOwnerId({ ...post, roomState });
  const hostPlayerId = post.playerId || ownerId;
  const mmrRangeMode = normalizeRecruitingMmrRangeMode(post.mmrRangeMode ?? roomState.mmrRangeMode);
  const timingType = post.timingType === "instant" || roomState.timingType === "instant" || post.scheduledAt === "즉시" ? "instant" : "scheduled";
  const ruleRevision = Number(roomState.ruleRevision ?? 0);
  const applicants = normalizeRecruitingApplicants(post.applicants ?? []);
  const acceptedApplicants = applicants.map((applicant) => ({ ...applicant, status: "ready" }));
  const refereeWanted = Boolean(post.refereeWanted ?? roomState.refereeWanted ?? post.refereeId);
  const benchCapacity = getRecruitingBenchCapacity(post);
  return {
    ...post,
    type,
    mmrRangeMode,
    hostJoinMode,
    hostSide: VALID_SIDES.has(post.hostSide) ? post.hostSide : "teamA",
    hostReady: true,
    sideCapacity: getRecruitingSideCapacity(post),
    benchCapacity,
    ownerId,
    refereeWanted,
    refereeId: post.refereeId ?? "",
    refereeTrustMin: Number(post.refereeTrustMin ?? REFEREE_TRUST_MIN),
    statEntryMinutes: Number(post.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    disputeMinutes: Number(post.disputeMinutes ?? DISPUTE_WINDOW_MINUTES),
    timingType,
    rules: { ...(post.rules ?? {}), benchCapacity },
    roomState: { ...roomState, ownerId, mmrRangeMode, timingType, refereeWanted },
    playerId: hostPlayerId,
    playerIds,
    applicants: acceptedApplicants,
  };
}
