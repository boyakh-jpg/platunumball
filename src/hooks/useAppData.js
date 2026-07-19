import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptTeamInvitation,
  addMatchLatePlayer,
  acceptRecruitingInvitation,
  agreeMatch,
  approveTournamentTeam,
  approveCourtRequest,
  approveMatch,
  blockUser,
  cancelMatch,
  cancelRecruitingParticipation,
  checkInMatchPlayer,
  closeRecruitingPost,
  commitAdminReviewAction,
  commitAdminAppointmentAction,
  confirmMatchRefereeAbsence,
  createMatch,
  createProfileShell,
  createRecruitingPost,
  createTeam,
  createTournament,
  deleteNotification,
  deleteSoloRecord,
  deleteTeam,
  detachRecruitingPartyPlayer,
  declineTeamInvitation,
  declineRecruitingInvitation,
  disputeMatch,
  endMatch,
  interestRecruitingPost,
  inviteRecruitingReferee,
  inviteRecruitingPlayers,
  joinRecruitingSideParty,
  handoffMatchRecorder,
  hasDemoInitialState,
  kickRecruitingApplicant,
  loadRemoteState,
  loadState,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeState,
  reportCourt,
  reportCourtRequest,
  reportCourtReview,
  reportMatch,
  resetState,
  requestMatchRefereeAbsence,
  resumeMatchApproval,
  removeMatchLatePlayer,
  removeMatchRoomPlayer,
  removeRecruitingPartyPlayer,
  runAutomaticStateMaintenance,
  saveState,
  sendRecruitingChat,
  setRecruitingApplicantPlacement,
  setRecruitingApplicantReserve,
  setDemoInitialState,
  setRecruitingSlotPosition,
  setMatchRoomPlayerPlacement,
  setMatchRecordTeamRoster,
  setRecruitingPartyPlayerPlacement,
  setRecruitingPartyPlayerReserve,
  setRecruitingTeamPartyRoster,
  setRecruitingStatRecorder,
  startMatch,
  substituteMatchPlayer,
  startRefereeExamAttempt,
  submitCourtRequest,
  submitCourtReview,
  finishRefereeExamAttempt,
  forfeitTournamentMatch,
  submitRefereeRequest,
  submitMatchThumbs,
  submitMatchResult,
  subscribeRemoteState,
  syncNotificationDeliveries,
  removeTeamMember,
  cancelTeamInvitation,
  toggleFavoriteCourt,
  toggleFavoritePlayer,
  toggleFavoriteReferee,
  toggleFavoriteTeam,
  toggleMatchStar,
  updateSettings,
  updateTeamMemberRole,
  inviteTeamMember,
  updateMatchRoomRules,
  updateTournamentMatchSchedule,
  updatePrivacySettings,
  updateProfile,
  updateRecruitingRoomRules,
  unblockUser,
  voidMatch,
} from "../data/repository.js";
import {
  REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
  REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../lib/constants.js";
import { isSupabaseConfigured, supabase } from "../lib/supabase.js";
import { readProfileBindings, readProfileCache, writeProfileBindings, writeProfileCache } from "../lib/storage.js";
import { findDiscordConnectionOwner, getDiscordConnectionUserId } from "../lib/discord.js";
import { isNotificationFromBlockedUser } from "../lib/notifications.js";
import { getServerActionAvailability, postServerAction } from "../lib/serverActions.js";

const LOCAL_MAINTENANCE_INTERVAL_MS = 60000;
const ROOM_CHAT_MESSAGE_SELECT = "id,room_type,room_id,user_id,body,created_at,message_seq";
const ROOM_CHAT_INITIAL_LIMIT = 30;
const ROOM_CHAT_POLL_LIMIT = 20;
const ROOM_CHAT_POLL_INTERVAL_MS = 3000;

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
  "loadTournament",
  "updateTournamentMatchSchedule",
  "forfeitTournamentMatch",
  "agreeMatch",
  "submitMatchResult",
  "handoffMatchRecorder",
  "substituteMatchPlayer",
  "approveMatch",
  "checkInMatchPlayer",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "toggleMatchStar",
  "submitMatchThumbs",
  "disputeMatch",
  "cancelMatch",
  "deleteSoloRecord",
  "voidMatch",
  "resumeMatchApproval",
  "startMatch",
  "endMatch",
  "addMatchLatePlayer",
  "removeMatchLatePlayer",
  "updateMatchRoomRules",
  "setMatchRoomPlayerPlacement",
  "setMatchRecordTeamRoster",
  "removeMatchRoomPlayer",
  "createRecruitingPost",
  "interestRecruitingPost",
  "inviteRecruitingReferee",
  "inviteRecruitingPlayers",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "cancelRecruitingParticipation",
  "updateRecruitingRoomRules",
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
  "setRecruitingStatRecorder",
  "kickRecruitingApplicant",
  "confirmRecruitingMatch",
  "closeRecruitingPost",
]);

const MATCH_OPERATION_ONLY_ACTIONS = new Set([
  "agreeMatch",
  "addMatchLatePlayer",
  "approveMatch",
  "cancelMatch",
  "checkInMatchPlayer",
  "confirmMatchRefereeAbsence",
  "deleteSoloRecord",
  "disputeMatch",
  "endMatch",
  "handoffMatchRecorder",
  "requestMatchRefereeAbsence",
  "resumeMatchApproval",
  "removeMatchLatePlayer",
  "startMatch",
  "submitMatchThumbs",
  "submitMatchResult",
  "substituteMatchPlayer",
  "toggleMatchStar",
  "updateTournamentMatchSchedule",
  "forfeitTournamentMatch",
  "removeMatchRoomPlayer",
  "setMatchRecordTeamRoster",
  "setMatchRoomPlayerPlacement",
  "updateMatchRoomRules",
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
  "joinRecruitingSideParty",
  "kickRecruitingApplicant",
  "removeRecruitingPartyPlayer",
  "setRecruitingApplicantPlacement",
  "setRecruitingApplicantReserve",
  "setRecruitingPartyPlayerPlacement",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingSlotPosition",
  "setRecruitingStatRecorder",
  "setRecruitingTeamPartyRoster",
  "updateRecruitingRoomRules",
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

function mergeRemoteById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function mergeTeamsById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (existing && item.membersPartial) {
      merged.set(item.id, {
        ...existing,
        ...item,
        members: existing.members?.length ? existing.members : item.members ?? [],
      });
      return;
    }
    merged.set(item.id, item);
  });
  return [...merged.values()];
}

function hasItems(value) {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.values(value).some((item) => (
    Array.isArray(item) ? item.length > 0 : item !== null && item !== undefined && item !== ""
  )));
}

function preserveExistingWhenEmpty(incoming, existing, keys = []) {
  if (!existing) return incoming;
  const next = { ...existing, ...incoming };
  keys.forEach((key) => {
    if (!hasItems(incoming?.[key]) && hasItems(existing?.[key])) next[key] = existing[key];
  });
  return next;
}

function mergeRoomInvitations(existing = [], incoming = []) {
  return mergeRemoteById(existing, incoming);
}

function shouldUseIncomingRoomRow(incoming, existing) {
  if (!existing) return true;
  const incomingTime = new Date(incoming?.updatedAt ?? incoming?.createdAt ?? 0).getTime();
  const existingTime = new Date(existing?.updatedAt ?? existing?.createdAt ?? 0).getTime();
  if (!Number.isFinite(incomingTime) || !Number.isFinite(existingTime)) return true;
  return incomingTime >= existingTime;
}

function shouldUseIncomingRecruitingPostRow(incoming, existing) {
  if (!existing) return true;
  const incomingListOnly = incoming?.listCardOnly === true;
  const existingListOnly = existing?.listCardOnly === true;
  if (existingListOnly && !incomingListOnly) return true;
  if (incomingListOnly && !existingListOnly) return false;
  return shouldUseIncomingRoomRow(incoming, existing);
}

function getTournamentMatchKey(match = {}) {
  if (!match?.tournamentId) return "";
  const round = Number(match.tournamentRound ?? 0);
  const fixture = Number(match.tournamentFixture ?? 0);
  return round && fixture ? `${match.tournamentId}:${round}:${fixture}` : "";
}

function mergeMatchesById(current = [], incoming = [], forceIds = new Set()) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const tournamentKey = getTournamentMatchKey(item);
    if (tournamentKey) {
      [...merged.entries()].forEach(([existingId, existingMatch]) => {
        if (existingId !== item.id && getTournamentMatchKey(existingMatch) === tournamentKey) merged.delete(existingId);
      });
    }
    const existing = merged.get(item.id);
    if (!forceIds.has(item.id) && !shouldUseIncomingRoomRow(item, existing)) return;
    if (item.tournamentListOnly === true && existing && existing.tournamentListOnly !== true) {
      const next = { ...existing, ...item, rules: existing.rules };
      delete next.tournamentListOnly;
      merged.set(item.id, next);
      return;
    }
    const next = preserveExistingWhenEmpty(item, existing, [
      "agreements",
      "approvals",
      "disputes",
      "playedPlayerIds",
      "reservePlayers",
      "anonymousPlayers",
      "parties",
      "result",
    ]);
    if (item.tournamentListOnly !== true) delete next.tournamentListOnly;
    merged.set(item.id, next);
  });
  return [...merged.values()];
}

function mergeAttendanceBySide(incoming = {}, existing = {}) {
  return {
    teamA: Array.from(new Set([...(incoming.teamA ?? []), ...(existing.teamA ?? [])].filter(Boolean))),
    teamB: Array.from(new Set([...(incoming.teamB ?? []), ...(existing.teamB ?? [])].filter(Boolean))),
  };
}

function preserveOptimisticMatchAttendance(incoming = {}, existing = null) {
  if (!existing) return incoming;
  return {
    ...incoming,
    attendance: mergeAttendanceBySide(incoming.attendance ?? {}, existing.attendance ?? {}),
  };
}

function mergeRecruitingPostsById(current = [], incoming = [], forceIds = new Set()) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (!forceIds.has(item.id) && !shouldUseIncomingRecruitingPostRow(item, existing)) return;
    const preserveKeys = Object.prototype.hasOwnProperty.call(item, "applicants") && item.listCardOnly !== true ? [] : ["applicants"];
    const next = preserveExistingWhenEmpty(item, existing, preserveKeys);
    if (item.listCardOnly !== true) {
      delete next.listCardOnly;
      delete next.listCounts;
    }
    if (item.__invitationsPartial !== true) delete next.__invitationsPartial;
    if (existing?.roomState && item?.roomState) {
      next.roomState = preserveExistingWhenEmpty(item.roomState, existing.roomState, ["chatMessages", "kickLog"]);
      if (item.__invitationsPartial === true) {
        next.roomState.invitations = mergeRoomInvitations(existing.roomState.invitations, item.roomState.invitations);
      }
    }
    merged.set(item.id, next);
  });
  return [...merged.values()];
}

function normalizeRecruitingChatMessage(message = {}) {
  return {
    id: String(message.id ?? ""),
    messageSeq: Number(message.messageSeq ?? message.message_seq ?? 0),
    userId: message.userId ?? message.user_id ?? "",
    body: String(message.body ?? "").slice(0, 60),
    createdAt: message.createdAt ?? message.created_at ?? new Date().toISOString(),
  };
}

function isLikelyOptimisticChatMessage(message = {}) {
  return !message.id || String(message.id).startsWith("chat_");
}

function mergeRecruitingChatMessages(currentMessages = [], incomingMessage = {}) {
  const message = normalizeRecruitingChatMessage(incomingMessage);
  if (!message.userId || !message.body.trim()) return currentMessages ?? [];
  const next = (currentMessages ?? []).map(normalizeRecruitingChatMessage);
  const exactIndex = next.findIndex((item) => message.id && item.id === message.id);
  if (exactIndex >= 0) {
    next[exactIndex] = message;
    return sortRecruitingChatMessages(next).slice(-50);
  }
  const messageTime = Date.parse(message.createdAt || 0);
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = next[index];
    if (!isLikelyOptimisticChatMessage(item)) continue;
    if (item.userId !== message.userId || item.body !== message.body) continue;
    const itemTime = Date.parse(item.createdAt || 0);
    if (Number.isFinite(messageTime) && Number.isFinite(itemTime) && Math.abs(messageTime - itemTime) <= 30000) {
      next[index] = message;
      return sortRecruitingChatMessages(next).slice(-50);
    }
  }
  return sortRecruitingChatMessages([...next, message]).slice(-50);
}

function sortRecruitingChatMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const seqA = Number(a.messageSeq ?? 0);
    const seqB = Number(b.messageSeq ?? 0);
    if (seqA || seqB) return seqA - seqB;
    return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
  });
}

function mergeRecruitingChatMessage(state, postId = "", incomingMessage = {}) {
  const roomId = String(postId ?? "").trim();
  if (!roomId) return state;
  let changed = false;
  const recruitingPosts = (state.recruitingPosts ?? []).map((post) => {
    if (post.id !== roomId) return post;
    const roomState = post.roomState ?? {};
    const nextMessages = mergeRecruitingChatMessages(roomState.chatMessages ?? [], incomingMessage);
    if (nextMessages === roomState.chatMessages) return post;
    changed = true;
    return { ...post, roomState: { ...roomState, chatMessages: nextMessages } };
  });
  return changed ? { ...state, recruitingPosts } : state;
}

function mergeRecruitingChatMessageBatch(state, postId = "", messages = []) {
  return (messages ?? []).reduce((nextState, message) => (
    mergeRecruitingChatMessage(nextState, postId, message)
  ), state);
}

function getRecruitingChatLastSeq(state = {}, postId = "") {
  const roomId = String(postId ?? "").trim();
  const post = (state.recruitingPosts ?? []).find((item) => item.id === roomId);
  const messages = post?.roomState?.chatMessages ?? [];
  return Math.max(0, ...messages.map((message) => Number(message.messageSeq ?? 0)).filter(Number.isFinite));
}

function sortMatchesByRemoteCursor(matches = []) {
  return [...matches].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
}

function getMatchPaginationCursor(matches = []) {
  const oldest = sortMatchesByRemoteCursor(matches).at(-1);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}

function sortRecruitingByRemoteCursor(posts = []) {
  return [...posts].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
}

function getRecruitingPaginationCursor(posts = []) {
  const oldest = sortRecruitingByRemoteCursor(posts).at(-1);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}

function getRecruitingPaginationOffset(page = null, fallbackOffset = 0) {
  const nextOffset = Number(page?.nextOffset ?? page?.cursor);
  if (Number.isFinite(nextOffset) && nextOffset >= 0) return Math.floor(nextOffset);

  const offset = Number(page?.offset);
  const count = Number(page?.count);
  if (Number.isFinite(offset) && offset >= 0 && Number.isFinite(count) && count >= 0) {
    return Math.floor(offset + count);
  }

  const fallback = Number(fallbackOffset);
  return Number.isFinite(fallback) && fallback >= 0 ? Math.floor(fallback) : 0;
}

function getStateRecruitingPostIds(state = {}) {
  return (state.recruitingPosts ?? []).map((post) => post?.id).filter(Boolean);
}

function getRecruitingRegionRequest(page = {}) {
  const regionScope = page.regionScope === "region" ? "region" : "local";
  const regionKey = regionScope === "region" ? String(page.regionKey ?? "").trim() : "";
  return { regionScope, regionKey };
}

function getRecruitingStartFilterRequest(page = {}) {
  const startFilter = String(page.startFilter ?? "").trim();
  if (startFilter === "instant") return { startFilter, timingType: "instant", scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(startFilter)) return { startFilter, timingType: "", scheduledDate: startFilter };
  const timingType = String(page.timingType ?? "").trim() === "instant" ? "instant" : "";
  const scheduledDate = String(page.scheduledDate ?? "").trim();
  if (timingType === "instant") return { startFilter: "instant", timingType, scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { startFilter: scheduledDate, timingType: "", scheduledDate };
  return { startFilter: "all", timingType: "", scheduledDate: "" };
}

function getBlockedUserIdsFromState(state = {}) {
  return Array.isArray(state.settings?.blockedUserIds) ? state.settings.blockedUserIds : [];
}

function filterBlockedIncomingInvitations(invitations = [], state = {}) {
  const blockedUserIds = new Set(getBlockedUserIdsFromState(state));
  const currentUserId = state.currentUserId ?? "";
  if (!currentUserId || !blockedUserIds.size) return invitations;
  return invitations.filter((invitation) => !(
    invitation?.targetUserId === currentUserId && blockedUserIds.has(invitation?.fromUserId)
  ));
}

function filterBlockedIncomingRecruitingPosts(posts = [], state = {}) {
  const blockedUserIds = new Set(getBlockedUserIdsFromState(state));
  const currentUserId = state.currentUserId ?? "";
  if (!currentUserId || !blockedUserIds.size) return posts;
  return posts.map((post) => {
    const invitations = post?.roomState?.invitations;
    if (!Array.isArray(invitations)) return post;
    const visibleInvitations = invitations.filter((invitation) => !(
      invitation?.targetUserId === currentUserId && blockedUserIds.has(invitation?.fromUserId)
    ));
    return visibleInvitations.length === invitations.length
      ? post
      : { ...post, roomState: { ...post.roomState, invitations: visibleInvitations } };
  });
}

function filterBlockedIncomingNotifications(notifications = [], state = {}) {
  const blockedUserIds = getBlockedUserIdsFromState(state);
  const currentUserId = state.currentUserId ?? "";
  if (!currentUserId || !blockedUserIds.length) return notifications;
  return notifications.filter((notification) => !(
    notification?.targetUserId === currentUserId && isNotificationFromBlockedUser(notification, blockedUserIds)
  ));
}

function mergeRemoteMatchPage(state, remoteState = {}, options = {}) {
  const nextMatches = remoteState.matches ?? [];
  const nextPosts = filterBlockedIncomingRecruitingPosts(remoteState.recruitingPosts ?? [], state);
  if (!nextMatches.length && !nextPosts.length) return state;
  const forceMatchIds = options.forceMatchIds instanceof Set ? options.forceMatchIds : new Set();
  const forceRecruitingPostIds = options.forceRecruitingPostIds instanceof Set ? options.forceRecruitingPostIds : new Set();
  return {
    ...state,
    users: mergeRemoteById(state.users, remoteState.users),
    teams: mergeTeamsById(state.teams, remoteState.teams),
    matches: nextMatches.length ? sortMatchesByRemoteCursor(mergeMatchesById(state.matches, nextMatches, forceMatchIds)) : state.matches,
    tournaments: mergeRemoteById(state.tournaments, remoteState.tournaments),
    recruitingPosts: nextPosts.length ? mergeRecruitingPostsById(state.recruitingPosts, nextPosts, forceRecruitingPostIds) : state.recruitingPosts,
  };
}

function mergeRemoteRecruitingPage(state, remoteState = {}, options = {}) {
  const nextPosts = filterBlockedIncomingRecruitingPosts(remoteState.recruitingPosts ?? [], state);
  if (!nextPosts.length) return state;
  const forceRecruitingPostIds = options.forceRecruitingPostIds instanceof Set ? options.forceRecruitingPostIds : new Set();
  return {
    ...state,
    users: mergeRemoteById(state.users, remoteState.users),
    teams: mergeTeamsById(state.teams, remoteState.teams),
    recruitingPosts: sortRecruitingByRemoteCursor(mergeRecruitingPostsById(state.recruitingPosts, nextPosts, forceRecruitingPostIds)),
  };
}

function filterPendingRecruitingPosts(remoteState = {}, pendingIds = new Set(), recentMutationTimes = new Map()) {
  const nextPosts = remoteState.recruitingPosts ?? [];
  if ((!pendingIds.size && !recentMutationTimes.size) || !nextPosts.length) return remoteState;
  const filteredPosts = nextPosts.filter((post) => {
    if (pendingIds.has(post.id)) return false;
    const mutationStartedAt = recentMutationTimes.get(post.id);
    if (!mutationStartedAt) return true;
    const rowUpdatedAt = new Date(post.updatedAt ?? post.createdAt ?? 0).getTime();
    return Number.isFinite(rowUpdatedAt) && rowUpdatedAt >= mutationStartedAt;
  });
  return filteredPosts.length === nextPosts.length ? remoteState : { ...remoteState, recruitingPosts: filteredPosts };
}

function filterPendingMatches(remoteState = {}, pendingIds = new Set(), recentMutationTimes = new Map()) {
  const nextMatches = remoteState.matches ?? [];
  if ((!pendingIds.size && !recentMutationTimes.size) || !nextMatches.length) return remoteState;
  const filteredMatches = nextMatches.filter((match) => !pendingIds.has(match.id) && !recentMutationTimes.has(match.id));
  return filteredMatches.length === nextMatches.length ? remoteState : { ...remoteState, matches: filteredMatches };
}

const DIRECTORY_SETTING_ARRAY_KEYS = [
  "approvedCourts",
  "courtMetrics",
  "courtRequests",
  "courtReviews",
  "refereeRequests",
  "refereeExamAttempts",
  "adminAppointments",
  "refereeAppointments",
  "adminAuditLog",
  "adminDisciplinaryActions",
];

function getRemoteDirectorySettings(settings = null, { includeTheme = false, includeDirectorySettings = false } = {}) {
  if (!settings) return null;
  const settingsPatch = {};
  if (includeTheme && (settings.theme === "light" || settings.theme === "dark")) settingsPatch.theme = settings.theme;
  if (settings.privacy && typeof settings.privacy === "object" && !Array.isArray(settings.privacy)) settingsPatch.privacy = settings.privacy;
  if (settings.notificationChannels && typeof settings.notificationChannels === "object" && !Array.isArray(settings.notificationChannels)) {
    settingsPatch.notificationChannels = settings.notificationChannels;
  }
  if (includeDirectorySettings) {
    DIRECTORY_SETTING_ARRAY_KEYS.forEach((key) => {
      if (Array.isArray(settings[key])) settingsPatch[key] = settings[key];
    });
  }
  return Object.keys(settingsPatch).length ? settingsPatch : null;
}

function mergeRemoteDirectory(state, remoteState = {}, options = {}) {
  const settingsPatch = getRemoteDirectorySettings(remoteState.settings, options);
  const includeDirectorySettings = options.includeDirectorySettings === true;
  const visibleTeamInvitations = filterBlockedIncomingInvitations(remoteState.teamInvitations ?? [], state);
  return {
    ...state,
    users: mergeRemoteById(state.users, remoteState.users),
    teams: mergeRemoteById(state.teams, remoteState.teams),
    teamInvitations: mergeRemoteById(state.teamInvitations, visibleTeamInvitations),
    affiliations: remoteState.affiliations?.length ? remoteState.affiliations : state.affiliations,
    seasons: remoteState.seasons?.length ? remoteState.seasons : state.seasons,
    reports: includeDirectorySettings && Array.isArray(remoteState.reports) ? mergeRemoteById(state.reports, remoteState.reports) : state.reports,
    settings: settingsPatch ? { ...state.settings, ...settingsPatch } : state.settings,
  };
}

function mergeRemoteProfileState(state, remoteState = {}) {
  const profileUserId = remoteState.currentUserId ?? state.currentUserId;
  const includeTheme = remoteState.settingsMeta?.themeExplicit === true || remoteState.settings?.theme === "light" || remoteState.settings?.theme === "dark";
  const nextState = mergeRemoteDirectory(state, remoteState, { includeTheme });
  if (!Array.isArray(remoteState.teamInvitations) || !profileUserId) return nextState;
  const visibleRemoteInvitations = filterBlockedIncomingInvitations(remoteState.teamInvitations, nextState);
  const unrelatedInvitations = (state.teamInvitations ?? []).filter((invitation) => (
    invitation.fromUserId !== profileUserId &&
    invitation.targetUserId !== profileUserId
  ));
  return {
    ...nextState,
    teamInvitations: [...visibleRemoteInvitations, ...unrelatedInvitations],
  };
}

function mergeRemoteHomeState(state, remoteState = {}) {
  const nextState = mergeRemoteProfileState(state, remoteState);
  const mergedState = mergeRemoteMatchPage(nextState, remoteState);
  return {
    ...mergedState,
    notifications: Array.isArray(remoteState.notifications)
      ? mergeRemoteById(mergedState.notifications, filterBlockedIncomingNotifications(remoteState.notifications, mergedState))
      : mergedState.notifications,
  };
}

function mergeRemoteTournamentState(state, remoteState = {}) {
  return {
    ...state,
    users: mergeRemoteById(state.users, remoteState.users),
    teams: mergeTeamsById(state.teams, remoteState.teams),
    matches: Array.isArray(remoteState.matches) ? mergeMatchesById(state.matches, remoteState.matches) : state.matches,
    tournaments: Array.isArray(remoteState.tournaments) ? mergeRemoteById(state.tournaments, remoteState.tournaments) : state.tournaments,
  };
}

function mergeRemoteAdminState(state, remoteState = {}) {
  const nextState = mergeRemoteDirectory(state, remoteState, { includeTheme: true, includeDirectorySettings: true });
  return {
    ...nextState,
    matches: Array.isArray(remoteState.matches) ? mergeRemoteById(state.matches, remoteState.matches) : state.matches,
    recruitingPosts: Array.isArray(remoteState.recruitingPosts) ? mergeRemoteById(state.recruitingPosts, remoteState.recruitingPosts) : state.recruitingPosts,
    tournaments: Array.isArray(remoteState.tournaments) ? mergeRemoteById(state.tournaments, remoteState.tournaments) : state.tournaments,
    reports: Array.isArray(remoteState.reports) ? mergeRemoteById(state.reports, remoteState.reports) : nextState.reports,
  };
}

function mergeCourtApprovalResult(state, requestId, result = {}, currentUserId = "") {
  const safeRequestId = String(result?.requestId ?? requestId ?? "").trim();
  const approvedCourtId = String(result?.approvedCourtId ?? "").trim();
  if (!safeRequestId || !approvedCourtId) return state;

  const request = (state.settings?.courtRequests ?? []).find((item) => item.id === safeRequestId);
  if (!request) return state;
  const approvedName = String(result?.approvedName ?? request.name ?? "").trim();

  const now = new Date().toISOString();
  const approvedCourt = {
    ...request,
    name: approvedName,
    id: approvedCourtId,
    sourceRequestId: safeRequestId,
    approvedBy: currentUserId,
    approvedAt: now,
    status: "active",
    hoopCount: ["half", "single_hoop"].includes(request.courtLayout) ? 1 : 2,
    lighting: request.lighting ?? false,
    favorite: false,
  };
  const nextApprovedCourts = [
    approvedCourt,
    ...(state.settings?.approvedCourts ?? []).filter((court) => (
      court.id !== approvedCourtId &&
      court.sourceRequestId !== safeRequestId
    )),
  ];

  return {
    ...state,
    settings: {
      ...(state.settings ?? {}),
      approvedCourts: nextApprovedCourts,
      courtRequests: (state.settings?.courtRequests ?? []).map((item) => (
        item.id === safeRequestId
          ? { ...item, name: approvedName, status: "approved", approvedAt: now, approvedBy: currentUserId, approvedCourtId }
          : item
      )),
    },
    notifications: [
      {
        id: makeClientNotificationId("n"),
        title: "구장 승인 완료",
        body: `${approvedName} 등록 구장이 승인되었습니다.`,
        tone: "team",
        createdAt: now,
      },
      ...(state.notifications ?? []),
    ],
  };
}

function mergeServerRoomResult(state, result = {}, options = {}) {
  if (!result || typeof result !== "object") return state;
  const nextPost = result.post ?? null;
  const rawNextMatch = result.createdMatch ?? result.match ?? null;
  const remoteState = result.state ? normalizeServerState(result.state) : null;
  const forcePostIds = new Set([nextPost?.id, ...(remoteState?.recruitingPosts ?? []).map((post) => post?.id)].filter(Boolean));
  const forceMatchIds = new Set([rawNextMatch?.id, ...(remoteState?.matches ?? []).map((match) => match?.id)].filter(Boolean));
  const baseState = remoteState
    ? (nextPost
      ? mergeRemoteRecruitingPage(state, remoteState, { forceRecruitingPostIds: forcePostIds })
      : mergeRemoteMatchPage(state, remoteState, { forceMatchIds, forceRecruitingPostIds: forcePostIds }))
    : state;
  const existingMatch = rawNextMatch
    ? (baseState.matches ?? []).find((match) => match.id === rawNextMatch.id) ?? null
    : null;
  const nextMatch = rawNextMatch && options.preserveMatchAttendance === true
    ? preserveOptimisticMatchAttendance(rawNextMatch, existingMatch)
    : rawNextMatch;
  if (!nextPost && !nextMatch) return baseState;
  return {
    ...baseState,
    recruitingPosts: nextPost ? mergeRecruitingPostsById(baseState.recruitingPosts ?? [], [nextPost], forcePostIds) : baseState.recruitingPosts,
    matches: nextMatch ? mergeMatchesById(baseState.matches ?? [], [nextMatch], forceMatchIds) : baseState.matches,
  };
}

function attachRemoteMeta(state = null, meta = {}) {
  if (!state || typeof state !== "object") return state;
  Object.defineProperty(state, "__rankballLoadMeta", {
    value: meta,
    enumerable: false,
    configurable: true,
  });
  return state;
}

function getRemoteMeta(state = null) {
  return state?.__rankballLoadMeta ?? {};
}

function getBoundAuthProfileId(state, authUserId, profileBindings, profileKey) {
  const users = state.users ?? [];
  if (isPersistentAuthUserId(authUserId)) {
    const currentUser = users.find((user) => user.id === state.currentUserId);
    if (currentUser?.authUserId === authUserId) return currentUser.id;

    const shellId = getClientProfileShellId(authUserId);
    const ownedUsers = users.filter((user) => user.authUserId === authUserId);
    const realOwnedUser = ownedUsers.find((user) => user.id !== shellId);
    if (realOwnedUser) return realOwnedUser.id;
    if (ownedUsers[0]) return ownedUsers[0].id;

    const boundUser = users.find((user) => user.id === profileBindings[profileKey]);
    if (boundUser && (boundUser.authUserId === authUserId || (!boundUser.authUserId && isPersistentProfileId(boundUser.id)))) return boundUser.id;

    if (currentUser && !currentUser.authUserId && isPersistentProfileId(currentUser.id)) return currentUser.id;

    return getClientProfileShellId(authUserId);
  }

  return profileBindings[profileKey] ?? state.currentUserId ?? users[0]?.id;
}

function isLinkedDiscordConnection(connection) {
  return Boolean(connection?.status === "linked" && connection.userId);
}

function preserveLocalDiscordState(localState, remoteState) {
  const localUsersById = new Map((localState?.users ?? []).map((user) => [user.id, user]));
  const remoteUsers = remoteState?.users ?? [];
  const users = remoteUsers.map((remoteUser) => {
    const localConnection = localUsersById.get(remoteUser.id)?.discordConnection;
    if (!isLinkedDiscordConnection(localConnection) || isLinkedDiscordConnection(remoteUser.discordConnection)) return remoteUser;
    if (findDiscordConnectionOwner(remoteUsers, localConnection, remoteUser.id)) return remoteUser;
    return { ...remoteUser, discordConnection: localConnection, discordUserId: getDiscordConnectionUserId(localConnection) || null };
  });
  const localDiscordChannel = localState?.settings?.notificationChannels?.discord;
  const remoteDiscordChannel = remoteState?.settings?.notificationChannels?.discord;
  if (!users.some((user, index) => user !== remoteUsers[index]) && (!localDiscordChannel?.enabled || remoteDiscordChannel?.enabled)) {
    return remoteState;
  }
  return {
    ...remoteState,
    users,
    settings: {
      ...remoteState.settings,
      notificationChannels: {
        ...remoteState.settings?.notificationChannels,
        discord: localDiscordChannel?.enabled && !remoteDiscordChannel?.enabled ? localDiscordChannel : remoteDiscordChannel,
      },
    },
  };
}

const EMPTY_ADMIN_CONTEXT = { profileId: "", level: 0, grade: "" };

function normalizeAdminContext(result = {}) {
  const level = Number(result.adminLevel ?? 0);
  return {
    profileId: result.profileId ?? "",
    level: Number.isFinite(level) ? level : 0,
    grade: result.adminGrade ?? "",
  };
}

function withServerAdminContext(state, context = EMPTY_ADMIN_CONTEXT) {
  const settings = state.settings ?? {};
  const adminAppointments = (settings.adminAppointments ?? []).filter((appointment) => appointment.source !== "server_context");
  if (!context.profileId || context.level < 30 || !context.grade) {
    return {
      ...state,
      settings: {
        ...settings,
        adminAppointments,
      },
    };
  }
  return {
    ...state,
    settings: {
      ...settings,
      adminAppointments: [
        {
          id: `server-admin-context:${context.profileId}`,
          role: "admin",
          grade: context.grade,
          userId: context.profileId,
          status: "active",
          startsAt: "",
          endsAt: "",
          appointedBy: "server",
          reason: "서버 권한",
          source: "server_context",
        },
        ...adminAppointments,
      ],
    },
  };
}

function getRoutePathname(location = null) {
  const rawPathname = location?.pathname ?? (typeof window !== "undefined" ? window.location.pathname : "");
  return String(rawPathname || "").replace(/\/$/, "");
}

function getRouteSearchParams(location = null) {
  const rawSearch = location?.search ?? (typeof window !== "undefined" ? window.location.search : "");
  return new URLSearchParams(rawSearch || "");
}

function getInitialStateLoadOptions(location = null) {
  const pathname = getRoutePathname(location);
  const searchParams = getRouteSearchParams(location);
  const teamDetailMatch = pathname.match(/^\/app\/teams\/([^/]+)$/);
  if (teamDetailMatch) {
    return { endpoint: "teamDetail", teamId: decodeURIComponent(teamDetailMatch[1]), matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/teams") {
    return { endpoint: "teamsList", matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/admin") {
    return { endpoint: "adminState", matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/matches") {
    if (searchParams?.get("match")) return { profileOnly: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
    return { endpoint: "matchesList", matchLimit: REMOTE_CLIENT_MATCH_LIMIT, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/recruiting") {
    if (searchParams?.get("post")) return { profileOnly: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
    return { endpoint: "recruitingList", matchLimit: 0, recruitingLimit: REMOTE_CLIENT_RECRUITING_LIMIT, tournamentLimit: 0, startFilter: "instant" };
  }
  if (pathname === "/app/recorder") {
    return { endpoint: "recorderMatches", matchLimit: REMOTE_CLIENT_MATCH_LIMIT, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/profile") {
    return { endpoint: "profileMe", matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/profile/records") {
    return { endpoint: "profileRecords", matchLimit: REMOTE_CLIENT_RECORD_MATCH_LIMIT, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app" || pathname === "/login") {
    return { endpoint: "homeLoad", matchLimit: REMOTE_CLIENT_MATCH_LIMIT, recruitingLimit: REMOTE_CLIENT_RECRUITING_LIMIT, tournamentLimit: 0 };
  }
  return { profileOnly: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
}

function getHomeRouteLoadKey(location = null) {
  return getRoutePathname(location) === "/app" ? "homeLoad" : "";
}

function normalizeServerState(state) {
  return state ? normalizeState(state, { includeDemo: false }) : state;
}

let demoInitialStatePromise = null;
async function ensureLocalDemoInitialState() {
  if (isSupabaseConfigured || hasDemoInitialState()) return null;
  if (!import.meta.env.DEV) return null;
  if (!demoInitialStatePromise) {
    // P-DEMO-CLEANUP: local development fallback only. Do not load demo data in production builds.
    demoInitialStatePromise = import(/* @vite-ignore */ "/src/lib/mockData.js").then((module) => {
      setDemoInitialState(module.initialState);
      return module.initialState;
    });
  }
  return demoInitialStatePromise;
}

function getCachedBootstrapState(authUserId, authEmail) {
  const baseState = loadState({ includeDemo: !isSupabaseConfigured, authUserId, email: authEmail });
  if (!isSupabaseConfigured || !authUserId) return baseState;
  const cached = readProfileCache(authUserId);
  if (!cached?.user?.id) return baseState;
  return normalizeState({
    ...baseState,
    currentUserId: cached.user.id,
    users: [cached.user, ...(baseState.users ?? []).filter((user) => user.id !== cached.user.id)],
    settings: { ...(baseState.settings ?? {}), ...(cached.settings ?? {}) },
  }, { includeDemo: false });
}

function cacheCurrentProfileState(authUserId, state = {}) {
  if (!isSupabaseConfigured || !authUserId) return;
  const currentUser = (state.users ?? []).find((user) => user.id === state.currentUserId);
  if (!currentUser?.id) return;
  writeProfileCache(authUserId, {
    user: currentUser,
    settings: state.settings ?? {},
  });
}

function getThinProfilePayload(authUserId, authEmail) {
  return {
    authUserId,
    authEmail,
    includeFavorites: false,
    includeTeamInvitations: false,
    includeTeams: false,
    includeExtraProfiles: false,
    includeMatchSummary: true,
  };
}

async function loadProfileState(authUserId, authEmail, options = {}) {
  try {
    const payload = options.thin === true
      ? getThinProfilePayload(authUserId, authEmail)
      : { authUserId, authEmail };
    const result = await postServerAction(
      "/api/profile/me",
      payload,
      { allowWhenDisabled: true },
    );
    if (result?.state) return normalizeServerState(result.state);
  } catch (error) {
    console.warn("Server profile load failed. Falling back to direct profile read.", error.message);
  }
  return loadRemoteState(authUserId, authEmail, {
    scope: "profile",
    matchLimit: 0,
    recruitingLimit: 0,
    tournamentLimit: 0,
  });
}

function getEndpointFallbackMeta(options = {}, errorMessage = "") {
  const error = String(errorMessage ?? "").trim();
  return {
    matchPage: {
      exhausted: true,
      recruitingScheduleChecked: true,
      ...(error ? { error } : {}),
    },
    recruitingPage: {
      exhausted: true,
      feedCounts: null,
      regionScope: "local",
      regionKey: "",
      ...getRecruitingStartFilterRequest({ startFilter: options.startFilter ?? "all" }),
      ...(error ? { error } : {}),
    },
    directoryLoaded: ["teamsList", "teamDetail"].includes(options.endpoint),
    profileRecordsLoaded: false,
  };
}

async function loadBackendState(authUserId, authEmail, options = getInitialStateLoadOptions()) {
  const loadOptions = {
    scope: options.scope,
    matchLimit: options.matchLimit ?? REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
    recruitingLimit: options.recruitingLimit ?? REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
    tournamentLimit: options.tournamentLimit,
    matchListOnly: true,
    directoryScope: "related",
    adminContext: false,
  };
  let fallbackErrorMessage = "";
  try {
    if (options.endpoint === "teamsList") {
      const result = await postServerAction(
        "/api/teams/list",
        { authUserId, authEmail },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { directoryLoaded: true });
    }
    if (options.endpoint === "teamDetail") {
      const result = await postServerAction(
        "/api/teams/detail",
        { authUserId, authEmail, teamId: options.teamId },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { directoryLoaded: true });
    }
    if (options.endpoint === "matchesList") {
      const result = await postServerAction(
        "/api/matches/list",
        {
          authUserId,
          authEmail,
          limit: loadOptions.matchLimit,
          listOnly: true,
          activeOnly: true,
          includeRecentCompleted: false,
          includeRecruitingSchedule: true,
          adminContext: false,
          preferFreshRows: true,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { matchPage: result.page ?? null });
    }
    if (options.endpoint === "recruitingList") {
      const result = await postServerAction(
        "/api/recruiting/list",
        {
          authUserId,
          authEmail,
          limit: loadOptions.recruitingLimit,
          regionScope: "local",
          ...(options.startFilter ? { startFilter: options.startFilter } : {}),
          listOnly: true,
          adminContext: false,
          includeFeedCounts: false,
          preferFreshRows: true,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { recruitingPage: result.page ?? null });
    }
    if (options.endpoint === "recorderMatches") {
      const result = await postServerAction(
        "/api/matches/list",
        {
          authUserId,
          authEmail,
          limit: loadOptions.matchLimit,
          listOnly: false,
          recorderOnly: true,
          adminContext: false,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { matchPage: result.page ?? null, recorderMatchesLoaded: true });
    }
    if (options.endpoint === "profileRecords") {
      const result = await postServerAction(
        "/api/matches/list",
        {
          authUserId,
          authEmail,
          limit: options.matchLimit ?? REMOTE_CLIENT_RECORD_MATCH_LIMIT,
          completedMonths: REMOTE_CLIENT_RECORD_MONTHS,
          listOnly: false,
          completedOnly: true,
          includeRecruitingSchedule: false,
          adminContext: false,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { matchPage: result.page ?? null, profileRecordsLoaded: true });
    }
    if (options.endpoint === "profileMe") {
      const result = await postServerAction(
        "/api/profile/me",
        {
          authUserId,
          authEmail,
          includeFavorites: false,
          includeTeamInvitations: false,
          includeTeams: false,
          includeExtraProfiles: false,
          includeMatchSummary: true,
          includeRecentRecords: true,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { profileRecordsLoaded: result.profileRecordsLoaded === true });
    }
    if (options.endpoint === "homeLoad") {
      const result = await postServerAction(
        "/api/home/load",
        {
          authUserId,
          authEmail,
          matchLimit: loadOptions.matchLimit,
          recruitingLimit: loadOptions.recruitingLimit,
          adminContext: false,
          includeFeedCounts: false,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), {
        matchPage: result.page ?? null,
        recruitingPage: result.recruitingPage ?? null,
        directoryLoaded: false,
      });
    }
    if (options.endpoint === "adminState") {
      const result = await postServerAction(
        "/api/state/load",
        { authUserId, authEmail, scope: "admin" },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { directoryLoaded: true });
    }
    if (options.endpoint) {
      return attachRemoteMeta(await loadProfileState(authUserId, authEmail, { thin: true }), getEndpointFallbackMeta(options));
    }
    const result = await postServerAction(
      "/api/state/load",
      { authUserId, authEmail, ...loadOptions },
      { allowWhenDisabled: true },
    );
    if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { recruitingPage: result.page ?? null });
  } catch (error) {
    console.warn("Server state load failed. Falling back to profile-only state.", error.message);
    fallbackErrorMessage = error.message ?? "state_load_failed";
  }
  if (options.endpoint) {
    return attachRemoteMeta(await loadProfileState(authUserId, authEmail, { thin: true }), getEndpointFallbackMeta(options, fallbackErrorMessage));
  }
  return attachRemoteMeta(await loadProfileState(authUserId, authEmail, { thin: true }), {
    matchPage: { exhausted: true, recruitingScheduleChecked: true },
    recruitingPage: { exhausted: true, feedCounts: null },
    directoryLoaded: false,
    profileRecordsLoaded: false,
  });
}

export function useAppData(authUser = null, appLocation = null) {
  const authUserId = typeof authUser === "string" ? authUser : authUser?.id ?? null;
  const authEmail = typeof authUser === "object" ? authUser?.email ?? authUser?.user_metadata?.email ?? "" : "";
  const [state, setRawState] = useState(() => syncNotificationDeliveries(getCachedBootstrapState(authUserId, authEmail)));
  const setState = useCallback((updater) => {
    setRawState((prev) => syncNotificationDeliveries(typeof updater === "function" ? updater(prev) : updater));
  }, []);
  const [profileBindings, setProfileBindings] = useState(() => readProfileBindings());
  const [adminContext, setAdminContext] = useState(EMPTY_ADMIN_CONTEXT);
  const [matchPagination, setMatchPagination] = useState({ loading: false, exhausted: !isSupabaseConfigured, error: "", cursor: "", recruitingScheduleChecked: false, recruitingScheduleLoading: false, recruitingSchedulePostIds: [], teamScheduleChecked: false, teamScheduleLoading: false, teamScheduleError: "" });
  const [recruitingPagination, setRecruitingPagination] = useState({ loading: false, exhausted: !isSupabaseConfigured, error: "", loadMoreError: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", startFilter: "all", timingType: "", scheduledDate: "", feedCounts: null });
  const [directoryStatus, setDirectoryStatus] = useState({ loading: false, loaded: !isSupabaseConfigured, error: "" });
  const [profileRecordsLoaded, setProfileRecordsLoaded] = useState(false);
  const [recorderMatchesLoaded, setRecorderMatchesLoaded] = useState(false);
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);
  const [serverActionPendingCount, setServerActionPendingCount] = useState(0);
  const homeRouteLoadKey = useMemo(() => getHomeRouteLoadKey(appLocation), [appLocation?.pathname]);
  const stateRef = useRef(state);
  const adminContextRef = useRef(EMPTY_ADMIN_CONTEXT);
  const remoteReadyRef = useRef(!isSupabaseConfigured);
  const directoryPromiseRef = useRef(null);
  const profileRefreshPromiseRef = useRef(null);
  const matchDetailPromiseRef = useRef(new Map());
  const matchPagePromiseRef = useRef(null);
  const matchRecruitingSchedulePromiseRef = useRef(null);
  const matchTeamSchedulePromiseRef = useRef(null);
  const settingsAuthUserIdRef = useRef(authUserId);
  const settingsSyncQueueRef = useRef(Promise.resolve(null));
  const themeMutationVersionRef = useRef(0);
  const themeCommittedValueRef = useRef(state.settings?.theme ?? "dark");
  const blockedSettingsSyncRef = useRef(Promise.resolve(true));
  const blockedSettingsCommittedIdsRef = useRef(getBlockedUserIdsFromState(state));
  const blockedSettingsPendingCountRef = useRef(0);
  const recruitingPagePromiseRef = useRef(null);
  const recorderMatchesPromiseRef = useRef(null);
  const reportableMatchesPromiseRef = useRef(null);
  const profileRecordsPromiseRef = useRef(null);
  const recruitingRegionPromiseRef = useRef(new Map());
  const latestRecruitingRegionRequestRef = useRef("");
  const latestRecruitingLoadMoreRequestRef = useRef("");
  const homeRouteLoadKeyRef = useRef("");
  const recruitingPostPromiseRef = useRef(new Map());
  const pendingRecruitingPostIdsRef = useRef(new Set());
  const recentRecruitingMutationTimesRef = useRef(new Map());
  const pendingMatchIdsRef = useRef(new Set());
  const pendingMatchMutationCountsRef = useRef(new Map());
  const recentMatchMutationTimesRef = useRef(new Map());
  const syncedDiscordDeliveryIdsRef = useRef(new Set());
  const authIdentityRef = useRef(authUserId);
  const authGenerationRef = useRef(0);
  if (authIdentityRef.current !== authUserId) {
    authIdentityRef.current = authUserId;
    authGenerationRef.current += 1;
  }
  const profileKey = authUserId ?? "local-demo";
  const profileLocked = isPersistentAuthUserId(authUserId);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    settingsAuthUserIdRef.current = authUserId;
    settingsSyncQueueRef.current = Promise.resolve(null);
    themeMutationVersionRef.current += 1;
    themeCommittedValueRef.current = null;
  }, [authUserId]);
  const serverProfileBound = profileLocked;
  const effectiveProfileBindings = isSupabaseConfigured ? {} : profileBindings;
  const currentUserId = getBoundAuthProfileId(state, authUserId, effectiveProfileBindings, profileKey);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId) return;
    setState((prev) => {
      if (prev.users.some((user) => user.authUserId === authUserId)) return prev;
      const shellUser = createProfileShell(authUserId, authEmail);
      return { ...prev, currentUserId: shellUser.id, users: [shellUser, ...prev.users] };
    });
  }, [authEmail, authUserId, setState]);

  useEffect(() => {
    if (!isSupabaseConfigured && hasDemoInitialState()) saveState(state);
    return undefined;
  }, [state]);

  useEffect(() => {
    if (isSupabaseConfigured || hasDemoInitialState()) return undefined;
    let mounted = true;
    ensureLocalDemoInitialState()
      .then(() => {
        if (!mounted) return;
        setState(loadState({ includeDemo: true, authUserId, email: authEmail }));
      })
      .catch((error) => console.warn("Local demo state load failed.", error.message));
    return () => {
      mounted = false;
    };
  }, [authEmail, authUserId, setState]);

  useEffect(() => {
    if (isSupabaseConfigured) return undefined;
    setState((prev) => runAutomaticStateMaintenance(prev));
    const interval = window.setInterval(() => {
      setState((prev) => runAutomaticStateMaintenance(prev));
    }, LOCAL_MAINTENANCE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId || !remoteReady) return;
    cacheCurrentProfileState(authUserId, state);
  }, [authUserId, remoteReady, state.currentUserId, state.settings, state.users]);

  useEffect(() => {
    if (blockedSettingsPendingCountRef.current > 0) return;
    blockedSettingsCommittedIdsRef.current = getBlockedUserIdsFromState(state);
  }, [state.settings?.blockedUserIds]);

  useEffect(() => {
    blockedSettingsSyncRef.current = Promise.resolve(true);
    blockedSettingsCommittedIdsRef.current = getBlockedUserIdsFromState(stateRef.current);
    blockedSettingsPendingCountRef.current = 0;
    if (!isSupabaseConfigured || !authUserId) {
      remoteReadyRef.current = !isSupabaseConfigured;
      profileRefreshPromiseRef.current = null;
      matchDetailPromiseRef.current = new Map();
      matchPagePromiseRef.current = null;
      matchRecruitingSchedulePromiseRef.current = null;
      matchTeamSchedulePromiseRef.current = null;
      recruitingPagePromiseRef.current = null;
      recorderMatchesPromiseRef.current = null;
      reportableMatchesPromiseRef.current = null;
      profileRecordsPromiseRef.current = null;
      recruitingRegionPromiseRef.current = new Map();
      latestRecruitingRegionRequestRef.current = "";
      latestRecruitingLoadMoreRequestRef.current = "";
      homeRouteLoadKeyRef.current = "";
      recruitingPostPromiseRef.current = new Map();
      pendingRecruitingPostIdsRef.current = new Set();
      recentRecruitingMutationTimesRef.current = new Map();
      pendingMatchIdsRef.current = new Set();
      pendingMatchMutationCountsRef.current = new Map();
      recentMatchMutationTimesRef.current = new Map();
      syncedDiscordDeliveryIdsRef.current = new Set();
      setRemoteReady(!isSupabaseConfigured);
      setMatchPagination({ loading: false, exhausted: true, error: "", cursor: "", recruitingScheduleChecked: false, recruitingScheduleLoading: false, recruitingSchedulePostIds: [], teamScheduleChecked: false, teamScheduleLoading: false, teamScheduleError: "" });
      setRecruitingPagination({ loading: false, exhausted: true, error: "", loadMoreError: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", startFilter: "all", timingType: "", scheduledDate: "", feedCounts: null });
      setDirectoryStatus({ loading: false, loaded: true, error: "" });
      setProfileRecordsLoaded(false);
      setRecorderMatchesLoaded(false);
      return undefined;
    }

    let mounted = true;
    remoteReadyRef.current = false;
    setRemoteReady(false);
    directoryPromiseRef.current = null;
    profileRefreshPromiseRef.current = null;
    matchDetailPromiseRef.current = new Map();
    matchPagePromiseRef.current = null;
    matchRecruitingSchedulePromiseRef.current = null;
    matchTeamSchedulePromiseRef.current = null;
    recruitingPagePromiseRef.current = null;
    recorderMatchesPromiseRef.current = null;
    reportableMatchesPromiseRef.current = null;
    profileRecordsPromiseRef.current = null;
    recruitingRegionPromiseRef.current = new Map();
    latestRecruitingRegionRequestRef.current = "";
    latestRecruitingLoadMoreRequestRef.current = "";
    homeRouteLoadKeyRef.current = "";
    recruitingPostPromiseRef.current = new Map();
    pendingRecruitingPostIdsRef.current = new Set();
    recentRecruitingMutationTimesRef.current = new Map();
    pendingMatchIdsRef.current = new Set();
    pendingMatchMutationCountsRef.current = new Map();
    recentMatchMutationTimesRef.current = new Map();
    syncedDiscordDeliveryIdsRef.current = new Set();
    setState(getCachedBootstrapState(authUserId, authEmail));
    setDirectoryStatus({ loading: false, loaded: false, error: "" });
    setProfileRecordsLoaded(false);
    setRecorderMatchesLoaded(false);
    const initialLoadOptions = getInitialStateLoadOptions(appLocation);
    homeRouteLoadKeyRef.current = initialLoadOptions.endpoint === "homeLoad" ? "homeLoad" : getHomeRouteLoadKey(appLocation);
    const initialLoad = initialLoadOptions.profileOnly
      ? loadProfileState(authUserId, authEmail, { thin: true })
      : loadBackendState(authUserId, authEmail, initialLoadOptions);
    initialLoad
      .then((remoteState) => {
        if (!mounted) return;
        if (remoteState) {
          const remoteMeta = getRemoteMeta(remoteState);
          const maintainedState = isSupabaseConfigured ? remoteState : runAutomaticStateMaintenance(remoteState);
          const initialMatchLimit = Number(initialLoadOptions.matchLimit ?? 0);
          const initialRecruitingLimit = Number(initialLoadOptions.recruitingLimit ?? 0);
          const matchPageHasExhausted = typeof remoteMeta.matchPage?.exhausted === "boolean";
          const recruitingPageHasExhausted = typeof remoteMeta.recruitingPage?.exhausted === "boolean";
          const recruitingScheduleChecked = Boolean(remoteMeta.matchPage?.recruitingScheduleChecked);
          cacheCurrentProfileState(authUserId, maintainedState);
          setState((prev) => withServerAdminContext(preserveLocalDiscordState(prev, maintainedState), adminContextRef.current));
          setMatchPagination({
            loading: false,
            exhausted: initialMatchLimit <= 0 || (matchPageHasExhausted ? remoteMeta.matchPage.exhausted : (maintainedState.matches?.length ?? 0) < initialMatchLimit),
            error: remoteMeta.matchPage?.error ?? "",
            cursor: remoteMeta.matchPage?.cursor ?? getMatchPaginationCursor(maintainedState.matches),
            recruitingScheduleChecked,
            recruitingScheduleLoading: false,
            recruitingSchedulePostIds: recruitingScheduleChecked ? getStateRecruitingPostIds(maintainedState) : [],
            teamScheduleChecked: false,
            teamScheduleLoading: false,
            teamScheduleError: "",
          });
          setRecruitingPagination({
            loading: false,
            exhausted: initialRecruitingLimit <= 0 || (recruitingPageHasExhausted ? remoteMeta.recruitingPage.exhausted : (maintainedState.recruitingPosts?.length ?? 0) < initialRecruitingLimit),
            error: remoteMeta.recruitingPage?.error ?? "",
            loadMoreError: "",
            cursor: remoteMeta.recruitingPage?.cursor ?? getRecruitingPaginationCursor(maintainedState.recruitingPosts),
            offset: getRecruitingPaginationOffset(remoteMeta.recruitingPage, maintainedState.recruitingPosts?.length ?? 0),
            ...getRecruitingRegionRequest(remoteMeta.recruitingPage),
            ...getRecruitingStartFilterRequest(remoteMeta.recruitingPage),
            feedCounts: remoteMeta.recruitingPage?.feedCounts ?? null,
          });
          if (remoteMeta.directoryLoaded) {
            setDirectoryStatus({ loading: false, loaded: true, error: "" });
          }
          setProfileRecordsLoaded(remoteMeta.profileRecordsLoaded === true);
          setRecorderMatchesLoaded(remoteMeta.recorderMatchesLoaded === true);
        }
        remoteReadyRef.current = true;
        setRemoteReady(true);
      })
      .catch((error) => {
        if (!mounted) return;
        console.warn("Supabase hydration failed. Remote state remains empty.", error.message);
        remoteReadyRef.current = true;
        setMatchPagination({ loading: false, exhausted: true, error: error.message ?? "state_load_failed", cursor: "", recruitingScheduleChecked: true, recruitingScheduleLoading: false, recruitingSchedulePostIds: [], teamScheduleChecked: false, teamScheduleLoading: false, teamScheduleError: "" });
        setRecruitingPagination({ loading: false, exhausted: true, error: error.message ?? "state_load_failed", loadMoreError: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", startFilter: "all", timingType: "", scheduledDate: "", feedCounts: null });
        if (mounted) setRemoteReady(true);
      });

    const unsubscribe = subscribeRemoteState((remoteState) => {
      const maintainedState = isSupabaseConfigured ? remoteState : runAutomaticStateMaintenance(remoteState);
      setState((prev) => withServerAdminContext(preserveLocalDiscordState(prev, maintainedState), adminContextRef.current));
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [authEmail, authUserId]);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId || !remoteReady || homeRouteLoadKey !== "homeLoad") return undefined;
    if (homeRouteLoadKeyRef.current === homeRouteLoadKey) return undefined;
    let mounted = true;
    homeRouteLoadKeyRef.current = homeRouteLoadKey;
    setMatchPagination((prev) => ({ ...prev, loading: true, error: "" }));
    const homeLoadOptions = {
      endpoint: "homeLoad",
      matchLimit: REMOTE_CLIENT_MATCH_LIMIT,
      recruitingLimit: REMOTE_CLIENT_RECRUITING_LIMIT,
      tournamentLimit: 0,
    };
    loadBackendState(authUserId, authEmail, homeLoadOptions)
      .then((remoteState) => {
        if (!mounted) return;
        const remoteMeta = getRemoteMeta(remoteState);
        const maintainedState = isSupabaseConfigured ? remoteState : runAutomaticStateMaintenance(remoteState);
        if (maintainedState) {
          cacheCurrentProfileState(authUserId, maintainedState);
          setState((prev) => withServerAdminContext(mergeRemoteHomeState(prev, preserveLocalDiscordState(prev, maintainedState)), adminContextRef.current));
        }
        setMatchPagination((prev) => ({
          ...prev,
          loading: false,
          exhausted: remoteMeta.matchPage?.exhausted ?? prev.exhausted,
          error: remoteMeta.matchPage?.error ?? "",
          cursor: remoteMeta.matchPage?.cursor ?? prev.cursor,
          recruitingScheduleChecked: prev.recruitingScheduleChecked || Boolean(remoteMeta.matchPage?.recruitingScheduleChecked),
          recruitingScheduleLoading: false,
          recruitingSchedulePostIds: remoteMeta.matchPage?.recruitingScheduleChecked ? getStateRecruitingPostIds(maintainedState) : prev.recruitingSchedulePostIds,
        }));
        setRecruitingPagination((prev) => ({
          ...prev,
          exhausted: remoteMeta.recruitingPage?.exhausted ?? prev.exhausted,
          error: remoteMeta.recruitingPage?.error ?? "",
          cursor: remoteMeta.recruitingPage?.cursor ?? prev.cursor,
          offset: getRecruitingPaginationOffset(remoteMeta.recruitingPage, prev.offset),
          feedCounts: remoteMeta.recruitingPage?.feedCounts ?? prev.feedCounts,
        }));
      })
      .catch((error) => {
        console.warn("Home route load failed.", error.message);
        homeRouteLoadKeyRef.current = "";
        if (mounted) {
          setMatchPagination((prev) => ({ ...prev, loading: false, error: error.message ?? "home_route_load_failed" }));
        }
      });
    return () => {
      mounted = false;
      if (homeRouteLoadKeyRef.current === homeRouteLoadKey) homeRouteLoadKeyRef.current = "";
      setMatchPagination((prev) => (prev.loading ? { ...prev, loading: false } : prev));
    };
  }, [authEmail, authUserId, homeRouteLoadKey, remoteReady, setState]);

  useEffect(() => {
    adminContextRef.current = EMPTY_ADMIN_CONTEXT;
    setAdminContext(EMPTY_ADMIN_CONTEXT);
    setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
  }, [authUserId, setState]);

  const trackedPostServerAction = useCallback((path, payload = {}, options = {}) => {
    const requestGeneration = authGenerationRef.current;
    const showBlockingLoader = options.blocking === true;
    const actionOptions = { ...options };
    delete actionOptions.blocking;
    if (showBlockingLoader) setServerActionPendingCount((count) => count + 1);
    return postServerAction(path, payload, actionOptions).then((result) => {
      if (requestGeneration !== authGenerationRef.current) {
        const error = new Error("stale_auth_request");
        error.code = "stale_auth_request";
        throw error;
      }
      return result;
    }).finally(() => {
      if (showBlockingLoader) setServerActionPendingCount((count) => Math.max(0, count - 1));
    });
  }, []);

  const loadAdminContext = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) {
      adminContextRef.current = EMPTY_ADMIN_CONTEXT;
      setAdminContext(EMPTY_ADMIN_CONTEXT);
      setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
      return EMPTY_ADMIN_CONTEXT;
    }
    try {
      const result = await trackedPostServerAction("/api/admin/context", {}, { allowWhenDisabled: true });
      const context = normalizeAdminContext(result);
      adminContextRef.current = context;
      setAdminContext(context);
      setState((prev) => withServerAdminContext(prev, context));
      return context;
    } catch (error) {
      console.warn("Admin context failed.", error.message);
      adminContextRef.current = EMPTY_ADMIN_CONTEXT;
      setAdminContext(EMPTY_ADMIN_CONTEXT);
      setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
      return EMPTY_ADMIN_CONTEXT;
    }
  }, [authUserId, setState, trackedPostServerAction]);

  const refreshAdminState = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    try {
      const result = await trackedPostServerAction(
        "/api/state/load",
        { authUserId, authEmail, scope: "admin" },
        { allowWhenDisabled: true },
      );
      if (!result?.state) return false;
      const remoteState = normalizeServerState(result.state);
      setState((prev) => withServerAdminContext(mergeRemoteAdminState(prev, remoteState ?? {}), adminContextRef.current));
      return true;
    } catch (error) {
      console.warn("Admin state refresh failed.", error.message);
      return false;
    }
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  useEffect(() => {
    if (!profileLocked || !authUserId || !currentUserId || isSupabaseConfigured) return;
    if (profileBindings[profileKey] !== currentUserId) {
      setProfileBindings((current) => {
        const next = { ...current, [profileKey]: currentUserId };
        writeProfileBindings(next);
        return next;
      });
    }
    setState((prev) => {
      const profile = prev.users.find((user) => user.id === currentUserId);
      if (!profile || profile.authUserId === authUserId || (profile.authUserId && profile.authUserId !== authUserId)) return prev;
      return updateProfile({ ...prev, currentUserId }, { authUserId }, currentUserId);
    });
  }, [authUserId, currentUserId, profileKey, profileLocked, profileBindings]);

  const currentUser = useMemo(() => {
    const boundUser = state.users.find((user) => user.id === currentUserId);
    if (boundUser) return boundUser;
    const ownedUser = authUserId ? state.users.find((user) => user.authUserId === authUserId) : null;
    if (ownedUser) return ownedUser;
    if (profileLocked || authUserId) return createProfileShell(authUserId, authEmail);
    return state.users[0] ?? createProfileShell("", authEmail);
  }, [authEmail, authUserId, currentUserId, profileLocked, state.users]);
  const pushLocalWarning = useCallback((title, body, payload = {}) => {
    setState((prev) => ({
      ...prev,
      notifications: [
        {
          id: makeClientNotificationId("n"),
          title,
          body,
          tone: "orange",
          createdAt: new Date().toISOString(),
          ...payload,
        },
        ...(prev.notifications ?? []),
      ],
    }));
  }, [setState]);
  const ensureRemoteReady = useCallback((label = "저장") => {
    if (!isSupabaseConfigured || remoteReadyRef.current) return true;
    pushLocalWarning("서버 데이터 로드 중", `${label}은 서버 데이터 로드가 끝난 뒤 다시 시도하세요. 새로고침 후 사라지는 로컬 임시 데이터를 만들지 않기 위해 차단했습니다.`);
    return false;
  }, [pushLocalWarning]);
  const ensureServerActionAvailable = useCallback(async (path, label = "저장", options = {}) => {
    if (!isSupabaseConfigured) return true;
    const availability = await getServerActionAvailability(path);
    if (availability.ok) return true;
    const errorCode = availability.error || "server_action_unavailable";
    console.warn(`Server action unavailable before optimistic update: ${path}`, {
      reason: errorCode,
      path,
    });
    if (options.quiet !== true) {
      pushLocalWarning("서버 저장 실패", `${label}이 서버에 저장되지 않았습니다. 이유: ${errorCode}`, {
        payload: { path, error: errorCode },
      });
    }
    return { ok: false, error: errorCode, path };
  }, [pushLocalWarning]);
  const runServerAction = useCallback((path, payload) => {
    return trackedPostServerAction(path, payload).then((result) => {
      if (!result) throw new Error("server_action_unavailable");
      return result;
    }).catch((error) => {
      const errorCode = getServerActionErrorText(error);
      if (errorCode === "stale_auth_request") {
        return { ok: false, error: errorCode, stale: true, path };
      }
      console.warn(`Server action skipped: ${path}`, {
        reason: errorCode,
        statusCode: error.statusCode ?? null,
        details: error.details ?? null,
      });
      pushLocalWarning("서버 저장 실패", `서버에 저장되지 않았습니다. 이유: ${errorCode}`, {
        payload: { path, error: errorCode, statusCode: error.statusCode ?? null, details: error.details ?? null },
      });
      return { ok: false, error: errorCode, statusCode: error.statusCode ?? null, path, details: error.details ?? null };
    });
  }, [pushLocalWarning, trackedPostServerAction]);
  const persistProfileServer = useCallback((profile) => {
    const promise = trackedPostServerAction("/api/profile/upsert", { profile }, { allowWhenDisabled: true }).then((result) => {
      if (!result) throw new Error("profile_server_action_unavailable");
      return result;
    });
    promise.catch((error) => {
      console.warn("Profile server action failed.", error.message);
    });
    return promise;
  }, [trackedPostServerAction]);
  const syncRecruitingPostServer = useCallback((post, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!post?.id && !operation) return Promise.resolve(false);
    const pendingPostId = post?.id ?? operation?.postId ?? meta.postId ?? "";
    const mutationStartedAt = Date.now();
    const requestGeneration = authGenerationRef.current;
    if (pendingPostId) {
      pendingRecruitingPostIdsRef.current.add(pendingPostId);
      recentRecruitingMutationTimesRef.current.set(pendingPostId, mutationStartedAt);
    }
    const clearPendingRecruitingPost = () => {
      if (requestGeneration !== authGenerationRef.current) return;
      if (!pendingPostId) return;
      pendingRecruitingPostIdsRef.current.delete(pendingPostId);
      if (recentRecruitingMutationTimesRef.current.get(pendingPostId) === mutationStartedAt) {
        recentRecruitingMutationTimesRef.current.delete(pendingPostId);
      }
    };
    const payload = operation ? { operation } : { post, notifications, ...meta };
    return runServerAction("/api/recruiting/sync-post", payload).then(async (result) => {
      if (result?.message && (result?.postId || pendingPostId)) {
        setState((prev) => mergeRecruitingChatMessage(prev, result.postId ?? pendingPostId, result.message));
      }
      if (result?.post || result?.createdMatch) {
        setState((prev) => mergeServerRoomResult(prev, result));
        const changedPostId = result?.post?.id;
        if (changedPostId) {
          setMatchPagination((prev) => {
            const ids = Array.isArray(prev.recruitingSchedulePostIds) ? prev.recruitingSchedulePostIds : [];
            return ids.includes(changedPostId)
              ? prev
              : { ...prev, recruitingSchedulePostIds: [...ids, changedPostId] };
          });
        }
      }
      if (result && result.ok !== false && typeof meta.onSuccess === "function") {
        try {
          await meta.onSuccess(result);
        } catch (error) {
          console.warn("Recruiting post refresh hook failed.", error.message);
        }
      }
      return result;
    }).finally(() => {
      clearPendingRecruitingPost();
    });
  }, [runServerAction, setState]);
  const syncMatchServer = useCallback((match, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!match?.id && !operation) return Promise.resolve(false);
    const pendingMatchId = match?.id ?? operation?.matchId ?? meta.matchId ?? "";
    const mutationStartedAt = Date.now();
    const requestGeneration = authGenerationRef.current;
    if (pendingMatchId) {
      pendingMatchMutationCountsRef.current.set(
        pendingMatchId,
        (pendingMatchMutationCountsRef.current.get(pendingMatchId) ?? 0) + 1,
      );
      pendingMatchIdsRef.current.add(pendingMatchId);
      recentMatchMutationTimesRef.current.set(pendingMatchId, mutationStartedAt);
    }
    const clearPendingMatch = () => {
      if (requestGeneration !== authGenerationRef.current) return;
      if (!pendingMatchId) return;
      const pendingCount = pendingMatchMutationCountsRef.current.get(pendingMatchId) ?? 0;
      if (pendingCount > 1) {
        pendingMatchMutationCountsRef.current.set(pendingMatchId, pendingCount - 1);
      } else {
        pendingMatchMutationCountsRef.current.delete(pendingMatchId);
        pendingMatchIdsRef.current.delete(pendingMatchId);
      }
      if (recentMatchMutationTimesRef.current.get(pendingMatchId) === mutationStartedAt) {
        recentMatchMutationTimesRef.current.delete(pendingMatchId);
      }
    };
    const payload = operation ? { operation } : { match, notifications, ...meta };
    return runServerAction("/api/matches/sync-match", payload).then((result) => {
      if (result?.match) {
        setState((prev) => mergeServerRoomResult(prev, result, {
          preserveMatchAttendance: operation?.action === "checkInMatchPlayer",
        }));
      }
      return result;
    }).finally(() => {
      clearPendingMatch();
    });
  }, [runServerAction, setState]);
  const submitReportServer = useCallback((report, notifications = []) => {
    if (!report?.id) return;
    runServerAction("/api/reports/submit", { report, notifications });
  }, [runServerAction]);
  const syncTeamServer = useCallback((team, notifications = []) => {
    if (!team?.id) return Promise.resolve(false);
    return runServerAction("/api/teams/sync-team", { team, notifications });
  }, [runServerAction]);
  const deleteTeamServer = useCallback((deletedTeamId, notifications = []) => {
    if (!deletedTeamId) return Promise.resolve(false);
    return runServerAction("/api/teams/sync-team", { deletedTeamId, notifications });
  }, [runServerAction]);
  const syncTeamInvitationServer = useCallback((teamInviteAction, payload = {}) => {
    if (!teamInviteAction) return Promise.resolve(false);
    return runServerAction("/api/teams/sync-team", { teamInviteAction, ...payload }).then((result) => {
      if (result?.state) {
        const remoteState = normalizeServerState(result.state);
        setState((prev) => mergeRemoteProfileState(prev, remoteState ?? {}));
      }
      return result;
    });
  }, [runServerAction, setState]);
  const syncTournamentServer = useCallback((tournament, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!tournament?.id && !operation) return Promise.resolve(false);
    const payload = operation ? { operation } : { tournament, notifications, ...meta };
    return runServerAction("/api/tournaments/sync-tournament", payload).then((result) => {
      if (result?.state) {
        const remoteState = normalizeServerState(result.state);
        setState((prev) => mergeRemoteTournamentState(prev, remoteState ?? {}));
      } else if (result?.tournament || result?.createdMatches?.length) {
        setState((prev) => mergeRemoteTournamentState(prev, {
          tournaments: result.tournament ? [result.tournament] : [],
          matches: result.createdMatches ?? [],
        }));
      }
      return result;
    });
  }, [runServerAction, setState]);
  const syncRefereeServer = useCallback((action, payload = {}) => {
    if (!action) return Promise.resolve(null);
    return runServerAction("/api/referee/sync", { action, ...payload });
  }, [runServerAction]);
  const syncFavoriteServer = useCallback((targetType, targetId, active) => {
    if (!targetType || !targetId) return;
    runServerAction("/api/favorites/sync", { targetType, targetId, active });
  }, [runServerAction]);
  const markNotificationReadServer = useCallback((payload = {}) => {
    runServerAction("/api/notifications/read", payload);
  }, [runServerAction]);
  const loadNotifications = useCallback(() => {
    if (!isSupabaseConfigured) return Promise.resolve(stateRef.current.notifications ?? []);
    return runServerAction("/api/notifications/list", { limit: 80 }).then((result) => {
      if (Array.isArray(result?.notifications)) {
        setState((prev) => ({
          ...prev,
          notifications: filterBlockedIncomingNotifications(result.notifications, prev),
        }));
      }
      return result?.notifications ?? [];
    });
  }, [runServerAction, setState]);
  const syncSettingsServer = useCallback((settingsPatch = {}, options = {}) => {
    const requestedAuthUserId = authUserId;
    const requestedCurrentUserId = currentUserId;
    const shouldApply = typeof options.shouldApply === "function" ? options.shouldApply : () => true;
    const request = settingsSyncQueueRef.current.catch(() => null).then(async () => {
      if (settingsAuthUserIdRef.current !== requestedAuthUserId) return { ok: false, stale: true };
      const result = await runServerAction("/api/settings/sync", { settings: settingsPatch });
      if (settingsAuthUserIdRef.current !== requestedAuthUserId) return { ...result, ok: false, stale: true };
      if (result?.settings && settingsAuthUserIdRef.current === requestedAuthUserId && shouldApply()) {
        setState((prev) => {
          if (settingsAuthUserIdRef.current !== requestedAuthUserId) return prev;
          const nextState = updateSettings({ ...prev, currentUserId: requestedCurrentUserId }, result.settings);
          cacheCurrentProfileState(requestedAuthUserId, nextState);
          return nextState;
        });
      }
      return result;
    });
    settingsSyncQueueRef.current = request.catch(() => null);
    return request;
  }, [authUserId, currentUserId, runServerAction, setState]);

  const refreshCurrentProfile = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (profileRefreshPromiseRef.current) return profileRefreshPromiseRef.current;
    const promise = (async () => {
      try {
        const remoteState = await loadProfileState(authUserId, authEmail);
        setState((prev) => {
          const nextState = mergeRemoteProfileState(prev, remoteState ?? {});
          cacheCurrentProfileState(authUserId, nextState);
          return nextState;
        });
        return true;
      } catch (error) {
        console.warn("Profile refresh failed.", error.message);
        return false;
      }
    })().finally(() => {
      profileRefreshPromiseRef.current = null;
    });
    profileRefreshPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState]);

  const loadMoreMatches = useCallback(async (options = {}) => {
    const force = options?.force === true;
    if (!isSupabaseConfigured || !authUserId || matchPagination.loading || (!force && matchPagination.exhausted)) return false;
    if (matchPagePromiseRef.current) return matchPagePromiseRef.current;
    const cursor = force ? "" : matchPagination.cursor || getMatchPaginationCursor(state.matches);
    if (!force && !cursor && (state.matches?.length ?? 0) > 0) {
      setMatchPagination((prev) => ({ ...prev, loading: false, exhausted: true, error: "", cursor: "" }));
      return false;
    }
    const pageLimit = cursor ? REMOTE_CLIENT_MATCH_LIMIT : REMOTE_CLIENT_INITIAL_MATCH_LIMIT;
    setMatchPagination((prev) => ({ ...prev, loading: true, error: "" }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: pageLimit,
            ...(cursor ? { cursor } : {}),
            listOnly: true,
            activeOnly: true,
            includeRecentCompleted: false,
            includeRecruitingSchedule: false,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const rawRemoteState = result?.state ?? {};
        const rawMatchCount = rawRemoteState.matches?.length ?? 0;
        const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
        const remoteState = normalizeServerState(filterPendingMatches(rawRemoteState, pendingMatchIdsRef.current, recentMatchMutationTimesRef.current));
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        setMatchPagination((prev) => ({
          ...prev,
          loading: false,
          exhausted: pageHasExhausted ? result.page.exhausted : rawMatchCount < pageLimit,
          error: "",
          cursor: result?.page?.cursor ?? cursor,
          recruitingScheduleChecked: prev.recruitingScheduleChecked || Boolean(result?.page?.recruitingScheduleChecked),
          recruitingScheduleLoading: prev.recruitingScheduleLoading,
        }));
        return nextMatches.length;
      } catch (error) {
        console.warn("More match load failed.", error.message);
        setMatchPagination((prev) => ({ ...prev, loading: false, exhausted: false, error: error.message ?? "match_page_load_failed", cursor }));
        return false;
      }
    })().finally(() => {
      if (matchPagePromiseRef.current === promise) matchPagePromiseRef.current = null;
    });
    matchPagePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, matchPagination.cursor, matchPagination.exhausted, matchPagination.loading, setState, state.matches, trackedPostServerAction]);

  const loadMatchRecruitingSchedule = useCallback(async (options = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const force = options?.force === true;
    if (matchRecruitingSchedulePromiseRef.current && !force) return matchRecruitingSchedulePromiseRef.current;
    if (matchPagination.recruitingScheduleLoading && !force) return false;
    const promise = (async () => {
      setMatchPagination((prev) => ({ ...prev, recruitingScheduleLoading: true, error: "" }));
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_MATCH_LIMIT,
            listOnly: true,
            activeOnly: true,
            includeRecentCompleted: false,
            includeRecruitingSchedule: true,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(result?.state ?? {}, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        setState((prev) => mergeRemoteMatchPage(prev, remoteState, { forceRecruitingPostIds: new Set(getStateRecruitingPostIds(remoteState)) }));
        setMatchPagination((prev) => ({
          ...prev,
          recruitingScheduleLoading: false,
          error: "",
          recruitingScheduleChecked: true,
          recruitingSchedulePostIds: getStateRecruitingPostIds(remoteState),
          cursor: prev.cursor || result?.page?.cursor || getMatchPaginationCursor(remoteState.matches ?? []),
        }));
        return remoteState.recruitingPosts?.length ?? 0;
      } catch (error) {
        console.warn("Match recruiting schedule load failed.", error.message);
        setMatchPagination((prev) => ({ ...prev, recruitingScheduleLoading: false, recruitingScheduleChecked: true, error: error.message ?? "match_recruiting_schedule_load_failed" }));
        return false;
      }
    })().finally(() => {
      if (matchRecruitingSchedulePromiseRef.current === promise) matchRecruitingSchedulePromiseRef.current = null;
    });
    matchRecruitingSchedulePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, matchPagination.recruitingScheduleLoading, setState, trackedPostServerAction]);

  const loadMatchTeamSchedule = useCallback(async (options = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const force = options?.force === true;
    if (matchTeamSchedulePromiseRef.current && !force) return matchTeamSchedulePromiseRef.current;
    if ((matchPagination.teamScheduleChecked || matchPagination.teamScheduleLoading) && !force) return true;
    const promise = (async () => {
      setMatchPagination((prev) => ({ ...prev, teamScheduleLoading: true, teamScheduleError: "" }));
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_MATCH_LIMIT,
            listOnly: true,
            activeOnly: true,
            includeRecentCompleted: false,
            includeRecruitingSchedule: false,
            includeTeamSchedule: true,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(result?.state ?? {});
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        setMatchPagination((prev) => ({
          ...prev,
          teamScheduleLoading: false,
          teamScheduleChecked: true,
          error: "",
          teamScheduleError: "",
          cursor: prev.cursor || result?.page?.cursor || getMatchPaginationCursor(remoteState.matches ?? []),
        }));
        return (remoteState.matches ?? []).filter((match) => match.__feedRelations?.includes("team")).length;
      } catch (error) {
        console.warn("Match team schedule load failed.", error.message);
        setMatchPagination((prev) => ({
          ...prev,
          teamScheduleLoading: false,
          teamScheduleChecked: true,
          teamScheduleError: error.message ?? "match_team_schedule_load_failed",
        }));
        return false;
      }
    })().finally(() => {
      if (matchTeamSchedulePromiseRef.current === promise) matchTeamSchedulePromiseRef.current = null;
    });
    matchTeamSchedulePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, matchPagination.teamScheduleChecked, matchPagination.teamScheduleLoading, setState, trackedPostServerAction]);

  const loadMatchDetail = useCallback(async (matchId) => {
    if (!isSupabaseConfigured || !authUserId || !matchId) return false;
    const safeMatchId = String(matchId);
    const currentPromise = matchDetailPromiseRef.current.get(safeMatchId);
    if (currentPromise) return currentPromise;
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/matches/detail",
          {
            authUserId,
            authEmail,
            matchId: safeMatchId,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(result?.state ?? {});
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState, { forceMatchIds: new Set([safeMatchId]) }));
        return nextMatches.length;
      } catch (error) {
        console.warn("Match detail load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (matchDetailPromiseRef.current.get(safeMatchId) === promise) matchDetailPromiseRef.current.delete(safeMatchId);
    });
    matchDetailPromiseRef.current.set(safeMatchId, promise);
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadRecorderMatches = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (recorderMatchesPromiseRef.current) return recorderMatchesPromiseRef.current;
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_MATCH_LIMIT,
            listOnly: false,
            recorderOnly: true,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(filterPendingMatches(result?.state ?? {}, pendingMatchIdsRef.current, recentMatchMutationTimesRef.current));
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        setRecorderMatchesLoaded(true);
        return nextMatches.length;
      } catch (error) {
        console.warn("Recorder match load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (recorderMatchesPromiseRef.current === promise) recorderMatchesPromiseRef.current = null;
    });
    recorderMatchesPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadReportableMatches = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (reportableMatchesPromiseRef.current) return reportableMatchesPromiseRef.current;
    const completedSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const promise = (async () => {
      try {
        const [activeResult, completedResult] = await Promise.all([
          trackedPostServerAction(
            "/api/matches/list",
            {
              authUserId,
              authEmail,
              limit: REMOTE_CLIENT_MATCH_LIMIT,
              listOnly: false,
              activeOnly: true,
              includeRecentCompleted: false,
              includeClosedNotices: false,
              adminContext: false,
            },
            { allowWhenDisabled: true },
          ),
          trackedPostServerAction(
            "/api/matches/list",
            {
              authUserId,
              authEmail,
              limit: REMOTE_CLIENT_MATCH_LIMIT,
              listOnly: false,
              completedOnly: true,
              completedSince,
              includeRecruitingSchedule: false,
              adminContext: false,
            },
            { allowWhenDisabled: true },
          ),
        ]);
        const activeState = normalizeServerState(activeResult?.state ?? {});
        const completedState = normalizeServerState(completedResult?.state ?? {});
        setState((prev) => mergeRemoteMatchPage(mergeRemoteMatchPage(prev, activeState), completedState));
        return true;
      } catch (error) {
        console.warn("Reportable match load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (reportableMatchesPromiseRef.current === promise) reportableMatchesPromiseRef.current = null;
    });
    reportableMatchesPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadProfileRecords = useCallback(async (options = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const force = options?.force === true;
    if (profileRecordsLoaded && !force) return true;
    if (profileRecordsPromiseRef.current) return profileRecordsPromiseRef.current;
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/matches/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_RECORD_MATCH_LIMIT,
            completedMonths: REMOTE_CLIENT_RECORD_MONTHS,
            listOnly: false,
            completedOnly: true,
            includeRecruitingSchedule: false,
            adminContext: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(result?.state ?? {});
        const nextMatches = remoteState.matches ?? [];
        setState((prev) => mergeRemoteMatchPage(prev, remoteState));
        setProfileRecordsLoaded(true);
        return nextMatches.length;
      } catch (error) {
        console.warn("Profile records load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (profileRecordsPromiseRef.current === promise) profileRecordsPromiseRef.current = null;
    });
    profileRecordsPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, profileRecordsLoaded, setState, trackedPostServerAction]);

  const loadMoreRecruiting = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId || recruitingPagination.loading || recruitingPagination.exhausted) return false;
    if (recruitingPagePromiseRef.current) return recruitingPagePromiseRef.current;
    const offset = getRecruitingPaginationOffset(recruitingPagination, recruitingPagination.offset ?? 0);
    const regionRequest = getRecruitingRegionRequest(recruitingPagination);
    const startFilterRequest = getRecruitingStartFilterRequest(recruitingPagination);
    const requestKey = `${regionRequest.regionScope}:${regionRequest.regionKey}:${startFilterRequest.startFilter}:${offset}`;
    latestRecruitingLoadMoreRequestRef.current = requestKey;
    setRecruitingPagination((prev) => ({ ...prev, loading: true, error: "", loadMoreError: "" }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/recruiting/list",
          {
            authUserId,
            authEmail,
            limit: REMOTE_CLIENT_RECRUITING_LIMIT,
            offset,
            regionScope: regionRequest.regionScope,
            ...(regionRequest.regionKey ? { regionKey: regionRequest.regionKey } : {}),
            ...startFilterRequest,
            listOnly: true,
            adminContext: false,
            includeFeedCounts: false,
            preferFreshRows: true,
          },
          { allowWhenDisabled: true },
        );
        const rawRemoteState = result?.state ?? {};
        const rawPostCount = rawRemoteState.recruitingPosts?.length ?? 0;
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        if (latestRecruitingLoadMoreRequestRef.current !== requestKey) return false;
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, { forceRecruitingPostIds: new Set(getStateRecruitingPostIds(remoteState)) }));
        const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
        setRecruitingPagination({
          loading: false,
          exhausted: pageHasExhausted ? result.page.exhausted : rawPostCount < REMOTE_CLIENT_RECRUITING_LIMIT,
          error: "",
          loadMoreError: "",
          cursor: result?.page?.cursor ?? String(offset + rawPostCount),
          offset: getRecruitingPaginationOffset(result?.page, offset + rawPostCount),
          ...regionRequest,
          ...startFilterRequest,
          feedCounts: result?.page?.feedCounts ?? recruitingPagination.feedCounts ?? null,
        });
        return nextPosts.length;
      } catch (error) {
        console.warn("More recruiting load failed.", error.message);
        if (latestRecruitingLoadMoreRequestRef.current !== requestKey) return false;
        setRecruitingPagination((prev) => ({ ...prev, loading: false, exhausted: false, error: "", loadMoreError: error.message ?? "recruiting_page_load_failed" }));
        return false;
      }
    })().finally(() => {
      if (recruitingPagePromiseRef.current === promise) recruitingPagePromiseRef.current = null;
    });
    recruitingPagePromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, recruitingPagination, setState, state.recruitingPosts, trackedPostServerAction]);

  const loadRecruitingRegion = useCallback(async ({ regionKey = "", regionScope = "local", limit = REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT, startFilter = "", includeFeedCounts = false } = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const pageLimit = Math.max(1, Math.min(REMOTE_CLIENT_RECRUITING_LIMIT, Number(limit) || REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT));
    const regionRequest = getRecruitingRegionRequest({ regionScope: regionScope === "region" && regionKey ? "region" : "local", regionKey });
    const startFilterRequest = getRecruitingStartFilterRequest({ startFilter });
    const shouldIncludeFeedCounts = includeFeedCounts === true;
    const promiseKey = `${regionRequest.regionScope}:${regionRequest.regionKey}:${startFilterRequest.startFilter}:${pageLimit}:${shouldIncludeFeedCounts ? "counts" : "plain"}`;
    latestRecruitingRegionRequestRef.current = promiseKey;
    latestRecruitingLoadMoreRequestRef.current = "";
    const currentPromise = recruitingRegionPromiseRef.current.get(promiseKey);
    if (currentPromise) {
      setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, ...startFilterRequest, loading: true, exhausted: false, error: "", loadMoreError: "", cursor: "", offset: 0 }));
      return currentPromise;
    }
    setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, ...startFilterRequest, loading: true, exhausted: false, error: "", loadMoreError: "", cursor: "", offset: 0 }));
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/recruiting/list",
          {
            authUserId,
            authEmail,
            limit: pageLimit,
            offset: 0,
            regionScope: regionRequest.regionScope,
            ...(regionRequest.regionKey ? { regionKey: regionRequest.regionKey } : {}),
            ...startFilterRequest,
            listOnly: true,
            adminContext: false,
            includeFeedCounts: shouldIncludeFeedCounts,
            preferFreshRows: true,
          },
          { allowWhenDisabled: true },
        );
        const rawRemoteState = result?.state ?? {};
        const rawPostCount = rawRemoteState.recruitingPosts?.length ?? 0;
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        if (latestRecruitingRegionRequestRef.current !== promiseKey) return false;
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, { forceRecruitingPostIds: new Set(getStateRecruitingPostIds(remoteState)) }));
        const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
        setRecruitingPagination({
          loading: false,
          exhausted: pageHasExhausted ? result.page.exhausted : rawPostCount < pageLimit,
          error: "",
          loadMoreError: "",
          cursor: result?.page?.cursor ?? String(rawPostCount),
          offset: getRecruitingPaginationOffset(result?.page, rawPostCount),
          ...regionRequest,
          ...startFilterRequest,
          feedCounts: shouldIncludeFeedCounts ? (result?.page?.feedCounts ?? recruitingPagination.feedCounts ?? null) : (recruitingPagination.feedCounts ?? null),
        });
        return nextPosts.length;
      } catch (error) {
        console.warn("Recruiting region load failed.", error.message);
        if (latestRecruitingRegionRequestRef.current !== promiseKey) return false;
        setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, ...startFilterRequest, loading: false, exhausted: false, error: error.message ?? "recruiting_region_load_failed", loadMoreError: "", cursor: "", offset: 0 }));
        return false;
      }
    })().finally(() => {
      if (recruitingRegionPromiseRef.current.get(promiseKey) === promise) recruitingRegionPromiseRef.current.delete(promiseKey);
    });
    recruitingRegionPromiseRef.current.set(promiseKey, promise);
    return promise;
  }, [authEmail, authUserId, recruitingPagination.feedCounts, setState, trackedPostServerAction]);

  const loadRecruitingPost = useCallback(async (postId) => {
    if (!isSupabaseConfigured || !authUserId || !postId) return false;
    const safePostId = String(postId);
    const currentPromise = recruitingPostPromiseRef.current.get(safePostId);
    if (currentPromise) return currentPromise;
    const promise = (async () => {
      try {
        const result = await trackedPostServerAction(
          "/api/recruiting/list",
          {
            authUserId,
            authEmail,
            postId: safePostId,
            limit: 1,
            adminContext: false,
            includeFeedCounts: false,
          },
          { allowWhenDisabled: true },
        );
        const remoteState = normalizeServerState(filterPendingRecruitingPosts(result?.state ?? {}, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
        const nextPosts = remoteState.recruitingPosts ?? [];
        setState((prev) => mergeRemoteRecruitingPage(prev, remoteState, { forceRecruitingPostIds: new Set([safePostId]) }));
        setRecruitingPagination((prev) => ({
          ...prev,
          feedCounts: result?.page?.feedCounts ?? prev.feedCounts ?? null,
        }));
        return nextPosts.length;
      } catch (error) {
        console.warn("Recruiting post load failed.", error.message);
        return false;
      }
    })().finally(() => {
      if (recruitingPostPromiseRef.current.get(safePostId) === promise) recruitingPostPromiseRef.current.delete(safePostId);
    });
    recruitingPostPromiseRef.current.set(safePostId, promise);
    return promise;
  }, [authEmail, authUserId, setState, trackedPostServerAction]);

  const loadDirectory = useCallback(async (force = false) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (directoryStatus.loaded && !force) return true;
    if (directoryPromiseRef.current) return directoryPromiseRef.current;

    const pathname = typeof window !== "undefined" ? window.location.pathname.replace(/\/$/, "") : "";
    const useTeamDirectory = pathname === "/app/teams" || pathname.startsWith("/app/teams/");
    const endpoint = useTeamDirectory ? "/api/teams/list" : "/api/directory/load";
    setDirectoryStatus((prev) => ({ ...prev, loading: true, error: "" }));
    const promise = trackedPostServerAction(
      endpoint,
      { authUserId, authEmail },
      { allowWhenDisabled: true },
    ).then((result) => {
      const remoteState = result?.state ?? {};
      setState((prev) => mergeRemoteDirectory(prev, remoteState, { includeDirectorySettings: true }));
      setDirectoryStatus({ loading: false, loaded: true, error: "" });
      return true;
    }).catch((error) => {
      console.warn("Directory load failed.", error.message);
      setDirectoryStatus({ loading: false, loaded: false, error: error.message ?? "directory_load_failed" });
      return false;
    }).finally(() => {
      directoryPromiseRef.current = null;
    });
    directoryPromiseRef.current = promise;
    return promise;
  }, [authEmail, authUserId, directoryStatus.loaded, setState, trackedPostServerAction]);

  const loadCourtDetail = useCallback(async (courtId) => {
    if (!isSupabaseConfigured || !authUserId || !courtId) {
      const error = new Error("court_detail_unavailable");
      error.code = "court_detail_unavailable";
      throw error;
    }
    return trackedPostServerAction(
      "/api/courts/detail",
      { courtId: String(courtId), authUserId, authEmail },
      { allowWhenDisabled: true },
    );
  }, [authEmail, authUserId, trackedPostServerAction]);

  const submitCourtDetailReview = useCallback((matchId, draft = {}) => {
    if (!isSupabaseConfigured || !matchId) return Promise.resolve({ ok: false, error: "remote_not_configured" });
    return runServerAction("/api/courts/submit-review", {
      review: {
        matchId: String(matchId),
        rating: Number(draft.rating),
        surfaceRating: draft.surfaceRating ?? null,
        rimRating: draft.rimRating ?? null,
        lightingRating: draft.lightingRating ?? null,
        crowdRating: draft.crowdRating ?? null,
        locationAccuracy: draft.locationAccuracy ?? null,
        fitModes: Array.isArray(draft.fitModes) ? draft.fitModes : [],
        tags: Array.isArray(draft.tags) ? draft.tags : [],
        memo: String(draft.memo ?? "").trim().slice(0, 240),
      },
    });
  }, [runServerAction]);

  useEffect(() => {
    if (!isSupabaseConfigured || !remoteReadyRef.current || !currentUserId) return;
    const deliveries = (state.discordNotificationDeliveries ?? [])
      .filter((delivery) => delivery?.id && delivery.status === "queued")
      .filter((delivery) => delivery.targetUserId === currentUserId)
      .filter((delivery) => !syncedDiscordDeliveryIdsRef.current.has(delivery.id));
    if (!deliveries.length) return;

    deliveries.forEach((delivery) => syncedDiscordDeliveryIdsRef.current.add(delivery.id));
    postServerAction("/api/discord/sync-deliveries", { deliveries }, { allowWhenDisabled: true }).catch((error) => {
      deliveries.forEach((delivery) => syncedDiscordDeliveryIdsRef.current.delete(delivery.id));
      console.warn("Discord delivery sync failed.", error.message);
    });
  }, [currentUserId, state.discordNotificationDeliveries]);

  const rankings = useMemo(
    () => ({
      players: sortByRating(state.users, (user) => user.ratings?.integrated ?? 1200),
      mode: (mode) => sortByRating(state.users, (user) => user.ratings?.modes?.[mode] ?? user.ratings?.integrated ?? 1200),
      teams: sortByRating(state.teams, (team) => team.mmr),
      affiliations: sortByRating(state.affiliations.filter((affiliation) => affiliation.type !== "club"), (affiliation) => affiliation.score),
    }),
    [state.affiliations, state.teams, state.users],
  );

  const actions = useMemo(
    () => {
      const getNewRecruitingNotifications = (prev, next, postId) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.recruitingPostId === postId || notification.invitationId)
        ));
      };
      const getNewMatchNotifications = (prev, next, matchId) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => !beforeIds.has(notification.id) && notification.matchId === matchId);
      };
      const getNewReportNotifications = (prev, next, report) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.matchId === report?.targetId || notification.type === "report" || !notification.targetUserId)
        ));
      };
      const getNewTeamNotifications = (prev, next) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.tone === "team" || notification.type === "team" || !notification.targetUserId)
        ));
      };
      const getNewTournamentNotifications = (prev, next) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          !notification.matchId &&
          (notification.type === "tournament" || notification.tone === "match" || !notification.targetUserId)
        ));
      };
      const getNewRefereeNotifications = (prev, next) => {
        const beforeIds = new Set((prev.notifications ?? []).map((notification) => notification.id));
        return (next.notifications ?? []).filter((notification) => (
          !beforeIds.has(notification.id) &&
          (notification.type === "referee" || notification.tone === "team" || !notification.targetUserId)
        ));
      };
      const upsertRefereeExamAttempt = (attempt) => {
        if (!attempt?.id) return;
        setState((prev) => {
          const attempts = prev.settings?.refereeExamAttempts ?? [];
          return {
            ...prev,
            settings: {
              ...(prev.settings ?? {}),
              refereeExamAttempts: [attempt, ...attempts.filter((item) => item.id !== attempt.id)],
            },
          };
        });
      };
      const rollbackServerMutation = (snapshot, label, payload = {}) => {
        if (!snapshot) return;
        const reason = payload.error ? ` 이유: ${payload.error}` : "";
        setState({
          ...snapshot,
          notifications: [
            {
              id: makeClientNotificationId("n"),
              title: "서버 저장 실패",
              body: `${label}이 서버에 저장되지 않아 화면 변경을 되돌렸습니다.${reason}`,
              tone: "orange",
              createdAt: new Date().toISOString(),
              payload,
            },
            ...(snapshot.notifications ?? []),
          ],
        });
      };
      const rollbackIfServerFailed = (promise, snapshot, label, payload = {}) => {
        return Promise.resolve(promise).then((result) => {
          if (!result || result.ok === false) {
            rollbackServerMutation(snapshot, label, {
              ...payload,
              error: result?.error ?? payload.error,
              statusCode: result?.statusCode ?? payload.statusCode,
              details: result?.details ?? payload.details,
            });
            return result || false;
          }
          return result;
        });
      };
      const applyBlockedUserMutation = (userId, shouldBlock) => {
        if (!userId) return Promise.resolve(false);
        if (!isSupabaseConfigured) {
          setState((prev) => (shouldBlock
            ? blockUser({ ...prev, currentUserId }, userId)
            : unblockUser({ ...prev, currentUserId }, userId)));
          return Promise.resolve(true);
        }
        const runMutation = async () => {
          const blockedUserIds = blockedSettingsCommittedIdsRef.current;
          const nextBlockedUserIds = shouldBlock
            ? Array.from(new Set([...blockedUserIds, userId]))
            : blockedUserIds.filter((blockedUserId) => blockedUserId !== userId);
          const result = await syncSettingsServer({ blockedUserIds: nextBlockedUserIds });
          if (!result || result.ok === false) return result || false;
          blockedSettingsCommittedIdsRef.current = nextBlockedUserIds;
          setState((prev) => (shouldBlock
            ? blockUser({ ...prev, currentUserId }, userId)
            : unblockUser({ ...prev, currentUserId }, userId)));
          return result;
        };
        blockedSettingsPendingCountRef.current += 1;
        const queuedMutation = blockedSettingsSyncRef.current
          .catch(() => false)
          .then(runMutation)
          .finally(() => {
            blockedSettingsPendingCountRef.current = Math.max(0, blockedSettingsPendingCountRef.current - 1);
          });
        blockedSettingsSyncRef.current = queuedMutation;
        return queuedMutation;
      };
      const applyRecruitingPostMutation = async (postId, reducer, meta = {}) => {
        const operation = getServerOperation({ ...meta, postId });
        const optimisticBeforeServerCheck = meta.optimisticBeforeServerCheck === true;
        let rollbackState = null;
        let syncedPost = null;
        let syncedNotifications = [];
        const directServerOperation = isSupabaseConfigured && operation && RECRUITING_OPERATION_ONLY_ACTIONS.has(operation.action);
        const applyLocalMutation = () => setState((prev) => {
          rollbackState = prev;
          const beforePost = (prev.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          const next = reducer(prev);
          const nextPost = (next.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          syncedPost = nextPost && nextPost !== beforePost ? nextPost : null;
          syncedNotifications = syncedPost ? getNewRecruitingNotifications(prev, next, postId) : [];
          return !syncedPost && operation && isSupabaseConfigured ? prev : next;
        });
        if (optimisticBeforeServerCheck && !directServerOperation) applyLocalMutation();
        const serverReady = await ensureServerActionAvailable("/api/recruiting/sync-post", "방 변경", { quiet: optimisticBeforeServerCheck });
        if (serverReady !== true) {
          if (optimisticBeforeServerCheck) rollbackServerMutation(rollbackState, "방 변경", { action: meta.action, postId, error: serverReady?.error });
          return serverReady;
        }
        if (!ensureRemoteReady("방 변경")) {
          if (optimisticBeforeServerCheck) rollbackServerMutation(rollbackState, "방 변경", { action: meta.action, postId, error: "remote_not_ready" });
          return;
        }
        if (directServerOperation) {
          return syncRecruitingPostServer(null, [], { ...meta, postId });
        }
        if (!optimisticBeforeServerCheck) applyLocalMutation();
        if (operation?.action === "sendRecruitingChat" || RECRUITING_OPERATION_ONLY_ACTIONS.has(operation?.action)) return rollbackIfServerFailed(syncRecruitingPostServer(null, [], { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
        if (syncedPost) return rollbackIfServerFailed(syncRecruitingPostServer(syncedPost, syncedNotifications, { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
        if (operation) return rollbackIfServerFailed(syncRecruitingPostServer(null, [], { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
        return true;
      };
      const applyMatchMutation = async (matchId, reducer, meta = {}) => {
        const serverReady = await ensureServerActionAvailable("/api/matches/sync-match", "경기 변경");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("경기 변경")) return;
        const operation = getServerOperation({ ...meta, matchId });
        if (isSupabaseConfigured && operation && MATCH_OPERATION_ONLY_ACTIONS.has(operation.action)) {
          const currentMatch = (stateRef.current.matches ?? []).find((match) => match.id === matchId) ?? null;
          return syncMatchServer(null, [], {
            ...meta,
            matchId,
            baseUpdatedAt: currentMatch?.updatedAt ?? currentMatch?.createdAt ?? null,
          });
        }
        let rollbackState = null;
        let baseUpdatedAt = null;
        let syncedMatch = null;
        let syncedNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const beforeMatch = (prev.matches ?? []).find((match) => match.id === matchId) ?? null;
          baseUpdatedAt = beforeMatch?.updatedAt ?? beforeMatch?.createdAt ?? null;
          const next = reducer(prev);
          const nextMatch = (next.matches ?? []).find((match) => match.id === matchId) ?? null;
          syncedMatch = nextMatch && nextMatch !== beforeMatch ? nextMatch : null;
          syncedNotifications = syncedMatch ? getNewMatchNotifications(prev, next, matchId) : [];
          return !syncedMatch && operation && isSupabaseConfigured ? prev : next;
        });
        const syncMeta = { ...meta, matchId, baseUpdatedAt };
        if (operation && MATCH_OPERATION_ONLY_ACTIONS.has(operation.action)) {
          return rollbackIfServerFailed(syncMatchServer(null, [], syncMeta), rollbackState, "경기 변경", { action: meta.action, matchId });
        }
        if (syncedMatch) return rollbackIfServerFailed(syncMatchServer(syncedMatch, syncedNotifications, syncMeta), rollbackState, "경기 변경", { action: meta.action, matchId });
        if (operation) return rollbackIfServerFailed(syncMatchServer(null, [], syncMeta), rollbackState, "경기 변경", { action: meta.action, matchId });
        return true;
      };
      const applyTeamMutation = async (teamId, reducer) => {
        const serverReady = await ensureServerActionAvailable("/api/teams/sync-team", "팀 변경");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("팀 변경")) return;
        let rollbackState = null;
        let syncedTeam = null;
        let syncedNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const beforeTeam = (prev.teams ?? []).find((team) => team.id === teamId) ?? null;
          const next = reducer(prev);
          const nextTeam = (next.teams ?? []).find((team) => team.id === teamId) ?? null;
          syncedTeam = nextTeam && nextTeam !== beforeTeam ? nextTeam : null;
          syncedNotifications = syncedTeam ? getNewTeamNotifications(prev, next) : [];
          return next;
        });
        if (syncedTeam) rollbackIfServerFailed(syncTeamServer(syncedTeam, syncedNotifications), rollbackState, "팀 변경", { teamId });
      };
      const applyTeamInvitationMutation = async (label, reducer, action, payloadFactory) => {
        const serverReady = await ensureServerActionAvailable("/api/teams/sync-team", label);
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady(label)) return;
        let rollbackState = null;
        let nextStateSnapshot = null;
        setState((prev) => {
          rollbackState = prev;
          const next = reducer(prev);
          nextStateSnapshot = next;
          return next;
        });
        const payload = payloadFactory?.(rollbackState, nextStateSnapshot) ?? {};
        return rollbackIfServerFailed(syncTeamInvitationServer(action, payload), rollbackState, label, { action, ...payload });
      };
      const refreshRecruitingRelations = (result = {}, fallbackPostId = "") => {
        const refreshPostId = result?.post?.id ?? result?.postId ?? fallbackPostId;
        if (!refreshPostId) return Promise.resolve(true);
        return loadRecruitingPost(refreshPostId);
      };

      return ({
        loadMatchDetail,
        loadCourtDetail,
        loadMatchRecruitingSchedule,
        loadMatchTeamSchedule,
        refreshCurrentProfile,
        loadDirectory,
        loadAdminContext,
        loadMoreMatches,
        loadMoreRecruiting,
        loadRecruitingRegion,
        loadRecruitingPost,
        loadRecorderMatches,
        loadReportableMatches,
        loadProfileRecords,
        submitCourtDetailReview,
        profileRecordsLoaded,
        switchUser: (userId) => {
        if (profileLocked) return false;
        setProfileBindings((current) => {
          const next = { ...current, [profileKey]: userId };
          writeProfileBindings(next);
          return next;
        });
        setProfileRecordsLoaded(false);
        setState((prev) => ({ ...prev, currentUserId: userId }));
        return true;
      },
      createMatch: async (draft) => {
        const serverReady = await ensureServerActionAvailable("/api/matches/sync-match", "경기 생성");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("경기 생성")) return null;
        if (isSupabaseConfigured) {
          return syncMatchServer(null, [], { action: "createMatch", draft }).then((result) => {
            if (!result || result?.ok === false) return result;
            return result?.matchId ?? result?.match?.id ?? null;
          });
        }
        let rollbackState = null;
        let createdId = null;
        let createdMatch = null;
        let syncedNotifications = [];
        let localBlockNotification = null;
        let localBlockDebug = {};
        setState((prev) => {
          rollbackState = prev;
          const existingIds = new Set((prev.matches ?? []).map((match) => match.id));
          const next = createMatch({ ...prev, currentUserId }, draft);
          createdMatch = (next.matches ?? []).find((match) => !existingIds.has(match.id)) ?? null;
          createdId = createdMatch?.id ?? null;
          syncedNotifications = createdMatch ? getNewMatchNotifications(prev, next, createdMatch.id) : [];
          localBlockNotification = createdMatch ? null : getNewItems(prev.notifications ?? [], next.notifications ?? [])[0] ?? null;
          localBlockDebug = createdMatch ? {} : getActionActorDebug(prev, currentUserId);
          return !createdMatch && isSupabaseConfigured ? prev : next;
        });
        if (!createdMatch) {
          if (isSupabaseConfigured) {
            return rollbackIfServerFailed(
              syncMatchServer(null, [], { action: "createMatch", draft }),
              rollbackState,
              "경기 생성",
              { action: "createMatch", details: localBlockDebug },
            ).then((result) => (result?.ok === false ? result : result?.matchId ?? result?.match?.id ?? null));
          }
          return Promise.resolve({
            ok: false,
            error: "local_reducer_blocked",
            details: localBlockDebug,
            message: localBlockNotification ? `${localBlockNotification.title}: ${localBlockNotification.body}` : "경기 생성 조건을 통과하지 못했습니다.",
          });
        }
        return rollbackIfServerFailed(
          syncMatchServer(createdMatch, syncedNotifications, { action: "createMatch", draft, preferredMatchId: createdMatch.id }),
          rollbackState,
          "경기 생성",
          { action: "createMatch", matchId: createdMatch.id },
        ).then((result) => (result?.ok === false ? result : createdId));
      },
      createTournament: async (draft) => {
        const serverReady = await ensureServerActionAvailable("/api/tournaments/sync-tournament", "토너먼트 생성");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("토너먼트 생성")) return Promise.resolve(null);
        if (isSupabaseConfigured) {
          return syncTournamentServer(null, [], {
            operation: {
              action: "createTournament",
              draft,
            },
          }).then((result) => (result?.ok === false ? result : result?.tournamentId ?? result?.tournament?.id ?? null));
        }
        let rollbackState = null;
        let createdId = null;
        let createdTournament = null;
        let createdMatches = [];
        let syncedNotifications = [];
        let localBlockNotification = null;
        let localBlockDebug = {};
        setState((prev) => {
          rollbackState = prev;
          const existingIds = new Set((prev.tournaments ?? []).map((tournament) => tournament.id));
          const existingMatchIds = new Set((prev.matches ?? []).map((match) => match.id));
          const next = createTournament({ ...prev, currentUserId }, draft);
          createdTournament = (next.tournaments ?? []).find((tournament) => !existingIds.has(tournament.id)) ?? null;
          createdId = createdTournament?.id ?? null;
          createdMatches = (next.matches ?? []).filter((match) => !existingMatchIds.has(match.id));
          syncedNotifications = createdTournament ? getNewTournamentNotifications(prev, next) : [];
          localBlockNotification = createdTournament ? null : getNewItems(prev.notifications ?? [], next.notifications ?? [])[0] ?? null;
          localBlockDebug = createdTournament ? {} : getActionActorDebug(prev, currentUserId);
          return next;
        });
        if (!createdTournament) return Promise.resolve({
          ok: false,
          error: "local_reducer_blocked",
          details: localBlockDebug,
          message: localBlockNotification ? `${localBlockNotification.title}: ${localBlockNotification.body}` : "대회 생성 조건을 통과하지 못했습니다.",
        });
        const preferredMatchIds = createdMatches.map((match) => match.id);
        return rollbackIfServerFailed(syncTournamentServer(createdTournament, syncedNotifications, {
          action: "create",
          operation: {
            action: "createTournament",
            draft: { ...draft, id: createdTournament.id, preferredMatchIds },
            preferredTournamentId: createdTournament.id,
            preferredMatchIds,
          },
        }), rollbackState, "토너먼트 생성", { action: "createTournament", tournamentId: createdTournament.id })
          .then((result) => (result?.ok === false ? result : createdId));
      },
      loadTournament: (tournamentId) => {
        if (!tournamentId || !ensureRemoteReady("대회 조회")) return Promise.resolve(0);
        return syncTournamentServer(null, [], {
          operation: {
            action: "loadTournament",
            tournamentId,
          },
        }).then((result) => (
          result?.state?.tournaments?.some((item) => item?.id === tournamentId) ? 1 : 0
        ));
      },
      approveTournamentTeam: (tournamentId, teamId) => {
        if (isSupabaseConfigured) {
          if (!ensureRemoteReady("토너먼트 팀 승인")) return Promise.resolve(null);
          return syncTournamentServer(null, [], {
            operation: {
              action: "approveTournamentTeam",
              tournamentId,
              teamId,
            },
          });
        }
        let rollbackState = null;
        let syncedTournament = null;
        let createdMatches = [];
        let syncedNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const existingMatchIds = new Set((prev.matches ?? []).map((match) => match.id));
          const next = approveTournamentTeam({ ...prev, currentUserId }, tournamentId, teamId);
          syncedTournament = (next.tournaments ?? []).find((tournament) => tournament.id === tournamentId) ?? null;
          createdMatches = (next.matches ?? []).filter((match) => !existingMatchIds.has(match.id));
          syncedNotifications = syncedTournament ? getNewTournamentNotifications(prev, next) : [];
          return next;
        });
        if (syncedTournament) {
          const preferredMatchIds = createdMatches.map((match) => match.id);
          rollbackIfServerFailed(syncTournamentServer(syncedTournament, syncedNotifications, {
            action: "approveTeam",
            teamId,
            operation: {
              action: "approveTournamentTeam",
              tournamentId,
              teamId,
              preferredMatchIds,
            },
          }), rollbackState, "토너먼트 팀 승인", { action: "approveTournamentTeam", tournamentId, teamId });
        }
      },
      updateTournamentMatchSchedule: (tournamentId, matchId, schedule) => {
        return applyMatchMutation(matchId, (prev) => updateTournamentMatchSchedule({ ...prev, currentUserId }, tournamentId, matchId, schedule), { action: "updateTournamentMatchSchedule", tournamentId, schedule });
      },
      forfeitTournamentMatch: (tournamentId, matchId, losingSide, reason = "팀 불참") => {
        return applyMatchMutation(matchId, (prev) => forfeitTournamentMatch({ ...prev, currentUserId }, tournamentId, matchId, losingSide, reason), { action: "forfeitTournamentMatch", tournamentId, losingSide, reason });
      },
      agreeMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => agreeMatch({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "agreeMatch", sideName, playerId }),
      submitMatchResult: (matchId, result) => applyMatchMutation(matchId, (prev) => submitMatchResult({ ...prev, currentUserId }, matchId, result), { action: "submitMatchResult", result }),
      handoffMatchRecorder: (matchId, sideName, nextRecorderId) => {
        applyMatchMutation(matchId, (prev) => handoffMatchRecorder({ ...prev, currentUserId }, matchId, sideName, nextRecorderId), { action: "handoffMatchRecorder", sideName, nextRecorderId });
      },
      substituteMatchPlayer: (matchId, sideName, activePlayerId, reservePlayerId) => {
        applyMatchMutation(matchId, (prev) => substituteMatchPlayer({ ...prev, currentUserId }, matchId, sideName, activePlayerId, reservePlayerId), { action: "substituteMatchPlayer", sideName, activePlayerId, reservePlayerId });
      },
      approveMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => approveMatch({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "approveMatch", sideName, playerId }),
      checkInMatchPlayer: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => checkInMatchPlayer({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "checkInMatchPlayer", sideName, playerId }),
      requestMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => requestMatchRefereeAbsence({ ...prev, currentUserId }, matchId), { action: "requestMatchRefereeAbsence" }),
      confirmMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => confirmMatchRefereeAbsence({ ...prev, currentUserId }, matchId), { action: "confirmMatchRefereeAbsence" }),
      toggleMatchStar: (matchId, targetUserId) => applyMatchMutation(matchId, (prev) => toggleMatchStar({ ...prev, currentUserId }, matchId, targetUserId), { action: "toggleMatchStar", targetUserId }),
      submitMatchThumbs: (matchId, targetUserIds) => applyMatchMutation(matchId, (prev) => submitMatchThumbs({ ...prev, currentUserId }, matchId, targetUserIds), { action: "submitMatchThumbs", targetUserIds }),
      disputeMatch: (matchId, reason) => applyMatchMutation(matchId, (prev) => disputeMatch({ ...prev, currentUserId }, matchId, reason), { action: "disputeMatch", reason }),
      cancelMatch: (matchId) => applyMatchMutation(matchId, (prev) => cancelMatch({ ...prev, currentUserId }, matchId), { action: "cancelMatch" }),
      deleteSoloRecord: (matchId) => applyMatchMutation(matchId, (prev) => deleteSoloRecord({ ...prev, currentUserId }, matchId), { action: "deleteSoloRecord" }),
      voidMatch: (matchId) => applyMatchMutation(matchId, (prev) => voidMatch({ ...prev, currentUserId }, matchId), { action: "voidMatch" }),
      resumeMatchApproval: (matchId, resultDraft = null) => applyMatchMutation(matchId, (prev) => resumeMatchApproval({ ...prev, currentUserId }, matchId, resultDraft), { action: "resumeMatchApproval", resultDraft }),
      startMatch: (matchId) => applyMatchMutation(matchId, (prev) => startMatch({ ...prev, currentUserId }, matchId), { action: "startMatch" }),
      endMatch: (matchId) => applyMatchMutation(matchId, (prev) => endMatch({ ...prev, currentUserId }, matchId), { action: "endMatch" }),
      addMatchLatePlayer: (matchId, draft) => applyMatchMutation(matchId, (prev) => addMatchLatePlayer({ ...prev, currentUserId }, matchId, draft), { action: "addMatchLatePlayer", draft }),
      removeMatchLatePlayer: (matchId, playerId) => applyMatchMutation(matchId, (prev) => removeMatchLatePlayer({ ...prev, currentUserId }, matchId, playerId), { action: "removeMatchLatePlayer", playerId }),
      updateSettings: (patch) => {
        if (!isSupabaseConfigured) {
          setState((prev) => updateSettings({ ...prev, currentUserId }, patch));
          return Promise.resolve(true);
        }
        let rollbackState = null;
        setState((prev) => {
          rollbackState = prev;
          return updateSettings({ ...prev, currentUserId }, patch);
        });
        return rollbackIfServerFailed(syncSettingsServer(patch), rollbackState, "설정 저장", { patch });
      },
      updatePrivacySettings: (patch) => {
        let nextPrivacy = null;
        let rollbackState = null;
        setState((prev) => {
          rollbackState = prev;
          const next = updatePrivacySettings({ ...prev, currentUserId }, patch);
          nextPrivacy = next.settings?.privacy ?? null;
          return next;
        });
        if (!isSupabaseConfigured) return Promise.resolve(true);
        return nextPrivacy
          ? rollbackIfServerFailed(syncSettingsServer({ privacy: nextPrivacy }), rollbackState, "설정 저장", { privacy: nextPrivacy })
          : Promise.resolve(true);
      },
      saveTheme: (theme) => {
        const nextTheme = theme === "light" ? "light" : "dark";
        if (!isSupabaseConfigured) {
          setState((prev) => updateSettings({ ...prev, currentUserId }, { theme: nextTheme }));
          return Promise.resolve(true);
        }
        if (!ensureRemoteReady("밝기 저장")) return Promise.resolve(false);
        const requestAuthUserId = authUserId;
        const requestVersion = themeMutationVersionRef.current + 1;
        themeMutationVersionRef.current = requestVersion;
        if (!themeCommittedValueRef.current) themeCommittedValueRef.current = stateRef.current.settings?.theme ?? "dark";
        const isCurrentRequest = () => (
          settingsAuthUserIdRef.current === requestAuthUserId && themeMutationVersionRef.current === requestVersion
        );
        setState((prev) => {
          return updateSettings({ ...prev, currentUserId }, { theme: nextTheme });
        });
        return syncSettingsServer({ theme: nextTheme }, { shouldApply: isCurrentRequest }).then((result) => {
          if (result?.stale) return false;
          if (result && result.ok !== false) {
            themeCommittedValueRef.current = nextTheme;
            return true;
          }
          if (!isCurrentRequest()) return false;
          const committedTheme = themeCommittedValueRef.current ?? "dark";
          setState((prev) => updateSettings({ ...prev, currentUserId }, { theme: committedTheme }));
          return false;
        });
      },
      blockUser: (userId) => applyBlockedUserMutation(userId, true),
      unblockUser: (userId) => applyBlockedUserMutation(userId, false),
      reportMatch: (matchId, reason, reportedUserIds) => {
        let createdReport = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.reports ?? []).map((report) => report.id));
          const next = reportMatch({ ...prev, currentUserId }, matchId, reason, reportedUserIds);
          createdReport = (next.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
          syncedNotifications = createdReport ? getNewReportNotifications(prev, next, createdReport) : [];
          return next;
        });
        if (createdReport) submitReportServer(createdReport, syncedNotifications);
      },
      reportCourtRequest: (requestId, reason) => {
        setState((prev) => reportCourtRequest({ ...prev, currentUserId }, requestId, reason));
        runServerAction("/api/court-requests/report", { requestId, reason });
      },
      reportCourt: (courtId, reason) => {
        let createdReport = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.reports ?? []).map((report) => report.id));
          const next = reportCourt({ ...prev, currentUserId }, courtId, reason);
          createdReport = (next.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
          syncedNotifications = createdReport ? getNewReportNotifications(prev, next, createdReport) : [];
          return next;
        });
        if (createdReport) submitReportServer(createdReport, syncedNotifications);
      },
      reportCourtReview: (reviewId, reason) => {
        let createdReport = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.reports ?? []).map((report) => report.id));
          const next = reportCourtReview({ ...prev, currentUserId }, reviewId, reason);
          createdReport = (next.reports ?? []).find((report) => !existingIds.has(report.id)) ?? null;
          syncedNotifications = createdReport ? getNewReportNotifications(prev, next, createdReport) : [];
          return next;
        });
        if (createdReport) submitReportServer(createdReport, syncedNotifications);
      },
      commitAdminReviewAction: async (draft) => {
        if (!isSupabaseConfigured) {
          setState((prev) => commitAdminReviewAction({ ...prev, currentUserId }, draft));
          return true;
        }
        if (!ensureRemoteReady("관리자 조치")) return false;
        const serverReady = await ensureServerActionAvailable("/api/admin/review-action", "관리자 조치");
        if (serverReady !== true) return serverReady;
        const result = await runServerAction("/api/admin/review-action", draft);
        if (!result || result.ok === false) return result;
        await refreshAdminState();
        return result;
      },
      commitAdminAppointmentAction: async (draft) => {
        if (!isSupabaseConfigured) {
          setState((prev) => commitAdminAppointmentAction({ ...prev, currentUserId }, draft));
          return true;
        }
        if (!ensureRemoteReady("관리자 임명")) return false;
        const serverReady = await ensureServerActionAvailable("/api/admin/appointment-action", "관리자 임명");
        if (serverReady !== true) return serverReady;
        const result = await runServerAction("/api/admin/appointment-action", draft);
        if (!result || result.ok === false) return result;
        await refreshAdminState();
        return result;
      },
      approveCourtRequest: async (requestId, approval = {}) => {
        if (!isSupabaseConfigured) {
          setState((prev) => approveCourtRequest({ ...prev, currentUserId }, requestId, approval));
          return true;
        }
        if (!ensureRemoteReady("구장 승인")) return false;
        const serverReady = await ensureServerActionAvailable("/api/court-requests/approve", "구장 승인");
        if (serverReady !== true) return serverReady;
        const result = await runServerAction("/api/court-requests/approve", { requestId, approval });
        if (!result || result.ok === false) return result;
        setState((prev) => mergeCourtApprovalResult(prev, requestId, result, currentUserId));
        return result;
      },
      markNotificationRead: (notificationId) => {
        setState((prev) => markNotificationRead(prev, notificationId));
        markNotificationReadServer({ notificationId });
      },
      markAllNotificationsRead: () => {
        setState((prev) => markAllNotificationsRead(prev));
        markNotificationReadServer({ all: true });
      },
      loadNotifications,
      deleteNotification: async (notificationId) => {
        const safeNotificationId = String(notificationId ?? "").trim();
        if (!safeNotificationId) return false;
        if (isSupabaseConfigured) {
          if (!ensureRemoteReady("알림 삭제")) return false;
          const serverReady = await ensureServerActionAvailable("/api/notifications/delete", "알림 삭제");
          if (serverReady !== true) return serverReady;
          const result = await runServerAction("/api/notifications/delete", { notificationId: safeNotificationId });
          if (!result || result.ok === false) return result;
        }
        setState((prev) => deleteNotification(prev, safeNotificationId));
        return true;
      },
      toggleFavoritePlayer: (userId) => {
        let active = false;
        setState((prev) => {
          const next = toggleFavoritePlayer(prev, userId);
          active = (next.settings?.favoritePlayerIds ?? []).includes(userId);
          return next;
        });
        syncFavoriteServer("player", userId, active);
      },
      toggleFavoriteTeam: (teamId) => {
        let active = false;
        setState((prev) => {
          const next = toggleFavoriteTeam(prev, teamId);
          active = (next.settings?.favoriteTeamIds ?? []).includes(teamId);
          return next;
        });
        syncFavoriteServer("team", teamId, active);
      },
      toggleFavoriteCourt: (courtId) => {
        let active = false;
        setState((prev) => {
          const next = toggleFavoriteCourt(prev, courtId);
          active = (next.settings?.favoriteCourtIds ?? []).includes(courtId);
          return next;
        });
        syncFavoriteServer("court", courtId, active);
      },
      toggleFavoriteReferee: (userId) => {
        let active = false;
        setState((prev) => {
          const next = toggleFavoriteReferee(prev, userId);
          active = (next.settings?.favoriteRefereeIds ?? []).includes(userId);
          return next;
        });
        syncFavoriteServer("referee", userId, active);
      },
      submitCourtRequest: (draft) => {
        if (!ensureRemoteReady("구장 등록요청")) return Promise.resolve(null);
        let createdRequest = null;
        let rollbackState = null;
        setState((prev) => {
          rollbackState = prev;
          const existingIds = new Set((prev.settings?.courtRequests ?? []).map((request) => request.id));
          const next = submitCourtRequest({ ...prev, currentUserId }, draft);
          createdRequest = (next.settings?.courtRequests ?? []).find((request) => !existingIds.has(request.id)) ?? null;
          return next;
        });
        if (!createdRequest) return Promise.resolve(null);
        if (!isSupabaseConfigured) return Promise.resolve(createdRequest.id);
        return rollbackIfServerFailed(
          runServerAction("/api/court-requests/submit", { request: createdRequest }),
          rollbackState,
          "구장 등록요청",
          { requestId: createdRequest.id },
        ).then((result) => (result && result.ok !== false ? result.requestId ?? createdRequest.id : null));
      },
      submitCourtReview: (matchId, draft) => {
        let submittedReview = null;
        let rollbackState = null;
        setState((prev) => {
          rollbackState = prev;
          const next = submitCourtReview({ ...prev, currentUserId }, matchId, draft);
          submittedReview = (next.settings?.courtReviews ?? []).find((review) => review.matchId === matchId && review.reviewerId === currentUserId) ?? null;
          return next;
        });
        if (!submittedReview) return Promise.resolve(null);
        if (!isSupabaseConfigured) return Promise.resolve(submittedReview);
        return rollbackIfServerFailed(
          runServerAction("/api/courts/submit-review", { review: submittedReview }),
          rollbackState,
          "구장 리뷰",
          { matchId, reviewId: submittedReview.id },
        ).then((result) => (result && result.ok !== false ? submittedReview : null));
      },
      startRefereeExamAttempt: (draft) => {
        if (isSupabaseConfigured) {
          return syncRefereeServer("startExam", { attempt: draft }).then((result) => {
            if (result?.ok === false || !result?.attempt) return null;
            upsertRefereeExamAttempt(result.attempt);
            return result.attempt;
          });
        }
        let createdAttempt = null;
        setState((prev) => {
          const existingIds = new Set((prev.settings?.refereeExamAttempts ?? []).map((attempt) => attempt.id));
          const next = startRefereeExamAttempt({ ...prev, currentUserId }, draft);
          createdAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => !existingIds.has(attempt.id)) ?? null;
          return next;
        });
        return Promise.resolve(createdAttempt);
      },
      finishRefereeExamAttempt: (attemptId, result) => {
        if (isSupabaseConfigured) {
          return syncRefereeServer("finishExam", { attempt: { id: attemptId, answers: result?.answers ?? result } }).then((serverResult) => {
            if (serverResult?.ok === false || !serverResult?.attempt) return null;
            upsertRefereeExamAttempt(serverResult.attempt);
            return serverResult.result ?? serverResult.attempt.result ?? null;
          });
        }
        let syncedAttempt = null;
        setState((prev) => {
          const beforeAttempt = (prev.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId);
          const next = finishRefereeExamAttempt({ ...prev, currentUserId }, attemptId, result);
          const nextAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId) ?? null;
          syncedAttempt = beforeAttempt && nextAttempt !== beforeAttempt ? nextAttempt : null;
          return next;
        });
        return Promise.resolve(syncedAttempt?.result ?? result ?? null);
      },
      submitRefereeRequest: (draft) => {
        let createdRequest = null;
        let syncedNotifications = [];
        setState((prev) => {
          const existingIds = new Set((prev.settings?.refereeRequests ?? []).map((request) => request.id));
          const next = submitRefereeRequest({ ...prev, currentUserId }, draft);
          createdRequest = (next.settings?.refereeRequests ?? []).find((request) => !existingIds.has(request.id)) ?? null;
          syncedNotifications = createdRequest ? getNewRefereeNotifications(prev, next) : [];
          return next;
        });
        if (createdRequest) syncRefereeServer("submitRequest", { request: createdRequest, notifications: syncedNotifications });
      },
      updateProfile: (patch, targetUserId = currentUserId) => {
        const safeTargetUserId = serverProfileBound ? currentUserId : targetUserId;
        const safePatch = profileLocked ? { ...patch, authUserId } : patch;
        let rollbackState = null;
        let nextProfile = null;
        setState((prev) => {
          rollbackState = prev;
          const next = updateProfile({ ...prev, currentUserId }, safePatch, safeTargetUserId);
          nextProfile = next.users.find((user) => user.id === safeTargetUserId) ?? null;
          return next;
        });
        if (!serverProfileBound || !nextProfile) return Promise.resolve({ ok: true });
        return persistProfileServer(nextProfile).then(async (result) => {
          if (result?.state) {
            const remoteState = normalizeServerState(result.state);
            setState((prev) => {
              const nextState = mergeRemoteProfileState(prev, remoteState ?? {});
              cacheCurrentProfileState(authUserId, nextState);
              return nextState;
            });
          } else if (result && result.ok !== false) {
            await refreshCurrentProfile();
          }
          return result;
        }).catch((error) => {
          rollbackServerMutation(rollbackState, "프로필 저장", {
            profileId: safeTargetUserId,
            error: getServerActionErrorText(error),
            statusCode: error.statusCode ?? null,
            details: error.details ?? null,
          });
          throw error;
        });
      },
      createTeam: async (draft) => {
        const serverReady = await ensureServerActionAvailable("/api/teams/sync-team", "팀 생성");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("팀 생성")) return { ok: false, error: "remote_not_ready" };
        let rollbackState = null;
        let createdTeam = null;
        let syncedNotifications = [];
        let localBlockNotification = null;
        setState((prev) => {
          rollbackState = prev;
          const existingIds = new Set((prev.teams ?? []).map((team) => team.id));
          const next = createTeam({ ...prev, currentUserId }, draft);
          createdTeam = (next.teams ?? []).find((team) => !existingIds.has(team.id)) ?? null;
          syncedNotifications = createdTeam ? getNewTeamNotifications(prev, next) : [];
          localBlockNotification = createdTeam ? null : getNewItems(prev.notifications ?? [], next.notifications ?? [])[0] ?? null;
          return next;
        });
        if (!createdTeam) return {
          ok: false,
          error: "local_reducer_blocked",
          message: localBlockNotification
            ? `${localBlockNotification.title}: ${localBlockNotification.body}`
            : "팀 생성 조건을 통과하지 못했습니다.",
        };
        const result = await rollbackIfServerFailed(
          syncTeamServer(createdTeam, syncedNotifications),
          rollbackState,
          "팀 생성",
          { teamId: createdTeam.id },
        );
        return result?.ok === false ? result : createdTeam.id;
      },
      deleteTeam: (teamId) => {
        let rollbackState = null;
        let deleted = false;
        let syncedNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const hadTeam = (prev.teams ?? []).some((team) => team.id === teamId);
          const next = deleteTeam({ ...prev, currentUserId }, teamId);
          deleted = hadTeam && !(next.teams ?? []).some((team) => team.id === teamId);
          syncedNotifications = deleted ? getNewTeamNotifications(prev, next) : [];
          return next;
        });
        if (deleted) rollbackIfServerFailed(deleteTeamServer(teamId, syncedNotifications), rollbackState, "팀 삭제", { teamId });
      },
      createRecruitingPost: async (draft) => {
        const serverReady = await ensureServerActionAvailable("/api/recruiting/sync-post", "방 생성");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("방 생성")) return Promise.resolve(null);
        if (isSupabaseConfigured) {
          return syncRecruitingPostServer(null, [], { action: "createRecruitingPost", draft }).then((result) => {
            if (!result || result?.ok === false) return result;
            return result?.post?.id ?? result?.postId ?? null;
          });
        }
        let rollbackState = null;
        let createdPost = null;
        let syncedNotifications = [];
        let localBlockNotification = null;
        let localBlockDebug = {};
        setState((prev) => {
          rollbackState = prev;
          const existingIds = new Set((prev.recruitingPosts ?? []).map((post) => post.id));
          const next = createRecruitingPost({ ...prev, currentUserId }, draft);
          createdPost = (next.recruitingPosts ?? []).find((post) => !existingIds.has(post.id)) ?? null;
          syncedNotifications = createdPost ? getNewRecruitingNotifications(prev, next, createdPost.id) : [];
          localBlockNotification = createdPost ? null : getNewItems(prev.notifications ?? [], next.notifications ?? [])[0] ?? null;
          localBlockDebug = createdPost ? {} : getActionActorDebug(prev, currentUserId);
          return !createdPost && isSupabaseConfigured ? prev : next;
        });
        if (!createdPost) {
          if (isSupabaseConfigured) {
            return rollbackIfServerFailed(
              syncRecruitingPostServer(null, [], { action: "createRecruitingPost", draft }),
              rollbackState,
              "방 생성",
              { action: "createRecruitingPost", details: localBlockDebug },
            ).then((result) => (result?.ok === false ? result : result?.postId ?? result?.post?.id ?? null));
          }
          return Promise.resolve({
            ok: false,
            error: "local_reducer_blocked",
            details: localBlockDebug,
            message: localBlockNotification ? `${localBlockNotification.title}: ${localBlockNotification.body}` : "방 생성 조건을 통과하지 못했습니다.",
          });
        }
        return rollbackIfServerFailed(
          syncRecruitingPostServer(createdPost, syncedNotifications, { action: "createRecruitingPost", draft, preferredPostId: createdPost.id }),
          rollbackState,
          "방 생성",
          { action: "createRecruitingPost", postId: createdPost.id },
        ).then((result) => {
          if (!result || result?.ok === false) return result;
          return result?.post?.id ?? result?.postId ?? createdPost.id;
        });
      },
      interestRecruitingPost: (postId, application) => applyRecruitingPostMutation(postId, (prev) => interestRecruitingPost({ ...prev, currentUserId }, postId, application), { action: "interestRecruitingPost", application, joinMode: application?.joinMode }),
      inviteRecruitingReferee: (postId, refereeId) => applyRecruitingPostMutation(postId, (prev) => inviteRecruitingReferee({ ...prev, currentUserId }, postId, refereeId), { action: "inviteRecruitingReferee", refereeId }),
      inviteRecruitingPlayers: (postId, invite) => applyRecruitingPostMutation(postId, (prev) => inviteRecruitingPlayers({ ...prev, currentUserId }, postId, invite), { action: "inviteRecruitingPlayers", invite }),
      acceptRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => acceptRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId), { action: "acceptRecruitingInvitation", invitationId, optimisticBeforeServerCheck: true }),
      declineRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => declineRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId), { action: "declineRecruitingInvitation", invitationId, optimisticBeforeServerCheck: true }),
      cancelRecruitingParticipation: (postId) => applyRecruitingPostMutation(postId, (prev) => cancelRecruitingParticipation({ ...prev, currentUserId }, postId), { action: "cancelRecruitingParticipation" }),
      updateRecruitingRoomRules: (postId, patch) => applyRecruitingPostMutation(postId, (prev) => updateRecruitingRoomRules({ ...prev, currentUserId }, postId, patch), { action: "updateRecruitingRoomRules", patch }),
      updateMatchRoomRules: (matchId, patch) => applyMatchMutation(matchId, (prev) => updateMatchRoomRules({ ...prev, currentUserId }, matchId, patch), { action: "updateMatchRoomRules", patch }),
      setMatchRoomPlayerPlacement: (matchId, playerId, placement) => applyMatchMutation(matchId, (prev) => setMatchRoomPlayerPlacement({ ...prev, currentUserId }, matchId, playerId, placement), { action: "setMatchRoomPlayerPlacement", playerId, placement }),
      setMatchRecordTeamRoster: (matchId, sideName, roster) => applyMatchMutation(matchId, (prev) => setMatchRecordTeamRoster({ ...prev, currentUserId }, matchId, sideName, roster), { action: "setMatchRecordTeamRoster", sideName, roster }),
      removeMatchRoomPlayer: (matchId, playerId) => applyMatchMutation(matchId, (prev) => removeMatchRoomPlayer({ ...prev, currentUserId }, matchId, playerId), { action: "removeMatchRoomPlayer", playerId }),
      sendRecruitingChat: (postId, body) => applyRecruitingPostMutation(postId, (prev) => sendRecruitingChat({ ...prev, currentUserId }, postId, body), { action: "sendRecruitingChat", body, optimisticBeforeServerCheck: true }),
      pollRecruitingChat: (postId) => {
        const roomId = String(postId ?? "").trim();
        if (!isSupabaseConfigured || !supabase || !roomId || typeof window === "undefined" || typeof document === "undefined") return () => {};
        let stopped = false;
        let intervalId = null;
        let fetching = false;
        const fetchMessages = async () => {
          if (stopped || fetching || document.hidden) return;
          fetching = true;
          try {
            const lastSeq = getRecruitingChatLastSeq(stateRef.current, roomId);
            let query = supabase
              .from("room_chat_messages")
              .select(ROOM_CHAT_MESSAGE_SELECT)
              .eq("room_type", "recruiting")
              .eq("room_id", roomId);
            if (lastSeq > 0) {
              query = query.gt("message_seq", lastSeq).order("message_seq", { ascending: true }).limit(ROOM_CHAT_POLL_LIMIT);
            } else {
              query = query.order("message_seq", { ascending: false }).limit(ROOM_CHAT_INITIAL_LIMIT);
            }
            const { data, error } = await query;
            if (error) throw error;
            const rows = lastSeq > 0 ? (data ?? []) : [...(data ?? [])].reverse();
            if (!rows.length) return;
            setState((prev) => mergeRecruitingChatMessageBatch(prev, roomId, rows));
          } catch (error) {
            console.warn("Recruiting chat polling skipped.", error.message);
          } finally {
            fetching = false;
          }
        };
        const start = () => {
          if (stopped || intervalId || document.hidden) return;
          void fetchMessages();
          intervalId = window.setInterval(fetchMessages, ROOM_CHAT_POLL_INTERVAL_MS);
        };
        const stop = () => {
          if (!intervalId) return;
          window.clearInterval(intervalId);
          intervalId = null;
        };
        const handleVisibilityChange = () => {
          if (document.hidden) {
            stop();
            return;
          }
          start();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        start();
        return () => {
          stopped = true;
          stop();
          document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
      },
      setRecruitingApplicantReserve: (postId, playerId, reserve) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantReserve({ ...prev, currentUserId }, postId, playerId, reserve), { action: "setRecruitingApplicantReserve", playerId, reserve });
      },
      setRecruitingApplicantPlacement: (postId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantPlacement({ ...prev, currentUserId }, postId, playerId, placement), { action: "setRecruitingApplicantPlacement", playerId, placement });
      },
      joinRecruitingSideParty: (postId, teamId, sideName, entryId) => {
        return applyRecruitingPostMutation(postId, (prev) => joinRecruitingSideParty({ ...prev, currentUserId }, postId, teamId, sideName, entryId), { action: "joinRecruitingSideParty", teamId, sideName, entryId });
      },
      setRecruitingSlotPosition: (postId, playerId, position) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingSlotPosition({ ...prev, currentUserId }, postId, playerId, position), { action: "setRecruitingSlotPosition", playerId, position });
      },
      setRecruitingPartyPlayerReserve: (postId, entryId, playerId, reserve) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingPartyPlayerReserve({ ...prev, currentUserId }, postId, entryId, playerId, reserve), { action: "setRecruitingPartyPlayerReserve", entryId, playerId, reserve });
      },
      setRecruitingPartyPlayerPlacement: (postId, entryId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingPartyPlayerPlacement({ ...prev, currentUserId }, postId, entryId, playerId, placement), { action: "setRecruitingPartyPlayerPlacement", entryId, playerId, placement });
      },
      setRecruitingTeamPartyRoster: (postId, entryId, roster) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingTeamPartyRoster({ ...prev, currentUserId }, postId, entryId, roster), { action: "setRecruitingTeamPartyRoster", entryId, roster });
      },
      detachRecruitingPartyPlayer: (postId, entryId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => detachRecruitingPartyPlayer({ ...prev, currentUserId }, postId, entryId, playerId, placement), { action: "detachRecruitingPartyPlayer", entryId, playerId, placement });
      },
      removeRecruitingPartyPlayer: (postId, entryId, playerId) => {
        applyRecruitingPostMutation(postId, (prev) => removeRecruitingPartyPlayer({ ...prev, currentUserId }, postId, entryId, playerId), { action: "removeRecruitingPartyPlayer", entryId, playerId });
      },
      setRecruitingStatRecorder: (postId, sideName, playerId) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingStatRecorder({ ...prev, currentUserId }, postId, sideName, playerId), { action: "setRecruitingStatRecorder", sideName, playerId });
      },
      kickRecruitingApplicant: (postId, playerId) => applyRecruitingPostMutation(postId, (prev) => kickRecruitingApplicant({ ...prev, currentUserId }, postId, playerId), { action: "kickRecruitingApplicant", playerId }),
      confirmRecruitingMatch: async (postId) => {
        const serverReady = await ensureServerActionAvailable("/api/recruiting/sync-post", "방 확정");
        if (serverReady !== true) return null;
        if (!ensureRemoteReady("방 확정")) return null;
        let rollbackState = null;
        setState((prev) => {
          rollbackState = prev;
          return prev;
        });
        return rollbackIfServerFailed(
          syncRecruitingPostServer(null, [], { action: "confirmRecruitingMatch", postId }),
          rollbackState,
          "방 확정",
          { action: "confirmRecruitingMatch", postId },
        ).then((result) => (result?.ok === false ? null : result?.matchId ?? result?.createdMatch?.id ?? result?.match?.id ?? null));
      },
      closeRecruitingPost: (postId) => applyRecruitingPostMutation(postId, (prev) => closeRecruitingPost({ ...prev, currentUserId }, postId), { action: "closeRecruitingPost" }),
      inviteTeamMember: (teamId, targetUserId, role = "regular") => applyTeamInvitationMutation(
        "팀 초대",
        (prev) => inviteTeamMember({ ...prev, currentUserId }, teamId, targetUserId, role),
        "invite",
        (_before, after) => {
          const invitation = (after.teamInvitations ?? []).find((item) => (
            item.teamId === teamId &&
            item.targetUserId === targetUserId &&
            item.fromUserId === currentUserId &&
            item.status === "pending"
          ));
          return { teamId, targetUserId, role, invitationId: invitation?.id };
        },
      ),
      acceptTeamInvitation: (invitationId) => applyTeamInvitationMutation(
        "팀 초대 수락",
        (prev) => acceptTeamInvitation({ ...prev, currentUserId }, invitationId),
        "accept",
        () => ({ invitationId }),
      ).then(async (result) => {
        if (result && result.ok !== false) await refreshRecruitingRelations();
        return result;
      }),
      declineTeamInvitation: (invitationId) => applyTeamInvitationMutation(
        "팀 초대 거절",
        (prev) => declineTeamInvitation({ ...prev, currentUserId }, invitationId),
        "decline",
        () => ({ invitationId }),
      ),
      cancelTeamInvitation: (invitationId) => applyTeamInvitationMutation(
        "팀 초대 취소",
        (prev) => cancelTeamInvitation({ ...prev, currentUserId }, invitationId),
        "cancel",
        () => ({ invitationId }),
      ),
      updateTeamMemberRole: (teamId, userId, role) => applyTeamMutation(teamId, (prev) => updateTeamMemberRole({ ...prev, currentUserId }, teamId, userId, role)),
      removeTeamMember: (teamId, userId) => applyTeamMutation(teamId, (prev) => removeTeamMember({ ...prev, currentUserId }, teamId, userId)),
      reset: () => setState(resetState({ includeDemo: !isSupabaseConfigured, authUserId, email: authEmail })),
      });
    },
    [authEmail, authUserId, currentUserId, deleteTeamServer, ensureRemoteReady, ensureServerActionAvailable, loadAdminContext, loadCourtDetail, loadDirectory, loadMatchDetail, loadMatchRecruitingSchedule, loadMatchTeamSchedule, loadMoreMatches, loadMoreRecruiting, loadNotifications, loadRecruitingRegion, loadRecruitingPost, loadRecorderMatches, loadReportableMatches, loadProfileRecords, profileRecordsLoaded, markNotificationReadServer, persistProfileServer, profileKey, profileLocked, refreshAdminState, refreshCurrentProfile, runServerAction, serverProfileBound, submitCourtDetailReview, submitReportServer, syncFavoriteServer, syncMatchServer, syncRecruitingPostServer, syncRefereeServer, syncSettingsServer, syncTeamInvitationServer, syncTeamServer, syncTournamentServer],
  );

  const safeCurrentUserId = currentUserId ?? currentUser?.id ?? "";
  const safeCurrentUser = currentUser
    ? { ...currentUser, representativeTeamId: state.settings?.representativeTeamId ?? currentUser.representativeTeamId ?? "" }
    : createProfileShell(authUserId ?? safeCurrentUserId, authEmail);
  return {
    state: { ...state, currentUserId: safeCurrentUserId || safeCurrentUser.id },
    currentUser: safeCurrentUser,
    currentUserId: safeCurrentUserId || safeCurrentUser.id,
    profileBound: true,
    profileLocked,
    remoteReady,
    serverBusy: serverActionPendingCount > 0,
    recorderMatchesLoaded,
    adminContext,
    matchPagination,
    recruitingPagination,
    directoryStatus,
    rankings,
    actions,
  };
}
