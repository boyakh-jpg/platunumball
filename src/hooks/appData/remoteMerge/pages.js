import { MATCH_LIST_SCOPES } from "../../../lib/matchUtils.js";
import { MATCH_LIST_STATUSES } from "../../../lib/matchUtils.js";
import { ROOM_CHAT_CLIENT_CACHE_LIMIT } from "../../../lib/roomChat.js";
import { ROOM_CHAT_OPTIMISTIC_MATCH_WINDOW_MS } from "../../../lib/roomChat.js";
import { createMatchListStore } from "../../../lib/matchUtils.js";
import { fromRoomChatMessageRow } from "../../../lib/roomChat.js";
import { isNotificationFromBlockedUser } from "../../../lib/notifications.js";
import { isSupabaseConfigured } from "../../../lib/supabase.js";
import { mergeMatchesById, mergeRecruitingPostsById, mergeRemoteById, mergeTeamsById } from "./entities.js";

function normalizeRecruitingChatMessage(message = {}) {
  return fromRoomChatMessageRow(message, { fallbackCreatedAt: new Date().toISOString() });
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
    return sortRecruitingChatMessages(next).slice(-ROOM_CHAT_CLIENT_CACHE_LIMIT);
  }
  const messageTime = Date.parse(message.createdAt || 0);
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const item = next[index];
    if (!isLikelyOptimisticChatMessage(item)) continue;
    if (item.userId !== message.userId || item.body !== message.body) continue;
    const itemTime = Date.parse(item.createdAt || 0);
    if (Number.isFinite(messageTime) && Number.isFinite(itemTime) && Math.abs(messageTime - itemTime) <= ROOM_CHAT_OPTIMISTIC_MATCH_WINDOW_MS) {
      next[index] = message;
      return sortRecruitingChatMessages(next).slice(-ROOM_CHAT_CLIENT_CACHE_LIMIT);
    }
  }
  return sortRecruitingChatMessages([...next, message]).slice(-ROOM_CHAT_CLIENT_CACHE_LIMIT);
}
function sortRecruitingChatMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const seqA = Number(a.messageSeq ?? 0);
    const seqB = Number(b.messageSeq ?? 0);
    if (seqA || seqB) return seqA - seqB;
    return String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? ""));
  });
}
export function mergeRecruitingChatMessage(state, postId = "", incomingMessage = {}) {
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
export function mergeRecruitingChatMessageBatch(state, postId = "", messages = []) {
  return (messages ?? []).reduce((nextState, message) => (
    mergeRecruitingChatMessage(nextState, postId, message)
  ), state);
}
export function getRecruitingChatLastSeq(state = {}, postId = "") {
  const roomId = String(postId ?? "").trim();
  const post = (state.recruitingPosts ?? []).find((item) => item.id === roomId);
  const messages = post?.roomState?.chatMessages ?? [];
  return Math.max(0, ...messages.map((message) => Number(message.messageSeq ?? 0)).filter(Number.isFinite));
}
function sortMatchesByRemoteCursor(matches = []) {
  return [...matches].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
}
export function getMatchPaginationCursor(matches = []) {
  const oldest = sortMatchesByRemoteCursor(matches).at(-1);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}
function sortRecruitingByRemoteCursor(posts = []) {
  return [...posts].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
}
export function getRecruitingPaginationCursor(posts = []) {
  const oldest = sortRecruitingByRemoteCursor(posts).at(-1);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}
export function getRecruitingPaginationOffset(page = null, fallbackOffset = 0) {
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
export function getStateRecruitingPostIds(state = {}) {
  return (state.recruitingPosts ?? []).map((post) => post?.id).filter(Boolean);
}
export function getStateMatchIds(state = {}) {
  return (state?.matches ?? []).map((match) => match?.id).filter(Boolean);
}
export function createInitialMatchListStore(state = {}) {
  if (isSupabaseConfigured) return createMatchListStore();
  const localScope = {
    ids: getStateMatchIds(state),
    status: MATCH_LIST_STATUSES.READY,
  };
  return createMatchListStore({
    [MATCH_LIST_SCOPES.PERSONAL]: {
      ...localScope,
      recruitingPostIds: getStateRecruitingPostIds(state),
    },
    [MATCH_LIST_SCOPES.TEAM]: localScope,
    [MATCH_LIST_SCOPES.PLAY]: localScope,
  });
}
export function getRecruitingRegionRequest(page = {}) {
  const regionScope = ["all", "region"].includes(page.regionScope) ? page.regionScope : "local";
  const regionKey = regionScope === "region" ? String(page.regionKey ?? "").trim() : "";
  return { regionScope, regionKey };
}
export function getRecruitingStartFilterRequest(page = {}) {
  const startFilter = String(page.startFilter ?? "").trim();
  if (startFilter === "instant") return { startFilter, timingType: "instant", scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(startFilter)) return { startFilter, timingType: "", scheduledDate: startFilter };
  const timingType = String(page.timingType ?? "").trim() === "instant" ? "instant" : "";
  const scheduledDate = String(page.scheduledDate ?? "").trim();
  if (timingType === "instant") return { startFilter: "instant", timingType, scheduledDate: "" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) return { startFilter: scheduledDate, timingType: "", scheduledDate };
  return { startFilter: "all", timingType: "", scheduledDate: "" };
}
export function getBlockedUserIdsFromState(state = {}) {
  return Array.isArray(state.settings?.blockedUserIds) ? state.settings.blockedUserIds : [];
}
export function filterBlockedIncomingInvitations(invitations = [], state = {}) {
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
export function filterBlockedIncomingNotifications(notifications = [], state = {}) {
  const blockedUserIds = getBlockedUserIdsFromState(state);
  const currentUserId = state.currentUserId ?? "";
  if (!currentUserId || !blockedUserIds.length) return notifications;
  return notifications.filter((notification) => !(
    notification?.targetUserId === currentUserId && isNotificationFromBlockedUser(notification, blockedUserIds)
  ));
}
export function mergeRemoteMatchPage(state, remoteState = {}, options = {}) {
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
export function mergeRemoteRecruitingPage(state, remoteState = {}, options = {}) {
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
export function filterPendingRecruitingPosts(remoteState = {}, pendingIds = new Set(), recentMutationTimes = new Map()) {
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
export function filterPendingMatches(remoteState = {}, pendingIds = new Set(), recentMutationTimes = new Map()) {
  const nextMatches = remoteState.matches ?? [];
  if ((!pendingIds.size && !recentMutationTimes.size) || !nextMatches.length) return remoteState;
  const filteredMatches = nextMatches.filter((match) => !pendingIds.has(match.id) && !recentMutationTimes.has(match.id));
  return filteredMatches.length === nextMatches.length ? remoteState : { ...remoteState, matches: filteredMatches };
}
