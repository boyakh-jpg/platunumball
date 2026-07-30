import { MATCH_LIST_SCOPES } from "../../lib/matchUtils.js";
import { MATCH_LIST_STATUSES } from "../../lib/matchUtils.js";
import { ROOM_CHAT_CLIENT_CACHE_LIMIT } from "../../lib/roomChat.js";
import { ROOM_CHAT_OPTIMISTIC_MATCH_WINDOW_MS } from "../../lib/roomChat.js";
import { createMatchListStore } from "../../lib/matchUtils.js";
import { fromRoomChatMessageRow } from "../../lib/roomChat.js";
import { getCourtHoopCount } from "../../lib/courts.js";
import { isNotificationFromBlockedUser } from "../../lib/notifications.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { normalizeCourtOptionalBoolean } from "../../lib/courts.js";
import { makeClientNotificationId } from "./serverOperations.js";
import { normalizeServerState } from "./stateNormalization.js";

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
      const existingIsPartial = existing.membersPartial === true;
      const partialMembers = new Map([
        ...(existing.members ?? []),
        ...(item.members ?? []),
      ].filter((member) => member?.userId).map((member) => [member.userId, member]));
      merged.set(item.id, {
        ...existing,
        ...item,
        members: existingIsPartial
          ? [...partialMembers.values()]
          : existing.members ?? [],
        membersPartial: existingIsPartial,
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

function shouldUseIncomingMatchRow(incoming, existing) {
  if (!existing) return true;
  const incomingListOnly = incoming?.matchListOnly === true;
  const existingListOnly = existing?.matchListOnly === true;
  if (existingListOnly && !incomingListOnly) return true;
  if (incomingListOnly && !existingListOnly) return true;
  return shouldUseIncomingRoomRow(incoming, existing);
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

export function mergeMatchesById(current = [], incoming = [], forceIds = new Set()) {
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
    if (!forceIds.has(item.id) && !shouldUseIncomingMatchRow(item, existing)) return;
    if (item.matchListOnly === true && existing && existing.matchListOnly !== true) {
      // LEGACY READ-ONLY:
      // 과거 경기 데이터 해석 전용.
      // 신규 권한 판정 및 저장에 사용하지 않는다.
      const next = preserveExistingWhenEmpty(item, existing, [
        "agreements",
        "approvals",
        "disputes",
        "playedPlayerIds",
        "reservePlayers",
        "anonymousPlayers",
        "parties",
        "result",
        "attendance",
        "statRecorders",
      ]);
      next.teamA = {
        ...(existing.teamA ?? {}),
        ...(item.teamA ?? {}),
        players: existing.teamA?.players ?? [],
      };
      next.teamB = {
        ...(existing.teamB ?? {}),
        ...(item.teamB ?? {}),
        players: existing.teamB?.players ?? [],
      };
      next.rules = existing.rules;
      delete next.matchListOnly;
      merged.set(item.id, next);
      return;
    }
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
    if (item.matchListOnly !== true) delete next.matchListOnly;
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

export function mergeRecruitingPostsById(current = [], incoming = [], forceIds = new Set()) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (item.listCardOnly === true && existing && existing.listCardOnly !== true) {
      merged.set(item.id, {
        ...existing,
        ...(item.listCounts ? { listCounts: item.listCounts } : {}),
        ...(Array.isArray(item.__feedRelations)
          ? { __feedRelations: Array.from(new Set([...(existing.__feedRelations ?? []), ...item.__feedRelations])) }
          : {}),
      });
      return;
    }
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

function getStateMatchIds(state = {}) {
  return (state?.matches ?? []).map((match) => match?.id).filter(Boolean);
}

function createInitialMatchListStore(state = {}) {
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

const DIRECTORY_FAVORITE_SETTING_KEYS = [
  "favoritePlayerIds",
  "favoriteTeamIds",
  "favoriteCourtIds",
  "favoriteRefereeIds",
];

function getRemoteDirectorySettings(settings = null, { includeTheme = false, includeDirectorySettings = false, includeFavoriteSettings = false } = {}) {
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
  if (includeFavoriteSettings) {
    DIRECTORY_FAVORITE_SETTING_KEYS.forEach((key) => {
      if (Array.isArray(settings[key])) settingsPatch[key] = settings[key];
    });
  }
  return Object.keys(settingsPatch).length ? settingsPatch : null;
}

function mergeRemoteDirectory(state, remoteState = {}, options = {}) {
  const settingsPatch = getRemoteDirectorySettings(remoteState.settings, options);
  const includeDirectorySettings = options.includeDirectorySettings === true;
  const append = options.append === true;
  const visibleTeamInvitations = filterBlockedIncomingInvitations(remoteState.teamInvitations ?? [], state);
  return {
    ...state,
    users: mergeRemoteById(state.users, remoteState.users),
    teams: mergeTeamsById(state.teams, remoteState.teams),
    teamInvitations: mergeRemoteById(state.teamInvitations, visibleTeamInvitations),
    affiliations: remoteState.affiliations?.length
      ? (append ? mergeRemoteById(state.affiliations, remoteState.affiliations) : remoteState.affiliations)
      : state.affiliations,
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
    homeSummary: remoteState.homeSummary ?? mergedState.homeSummary,
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

const ADMIN_SECTION_REPORT_TYPES = {
  courts: new Set(["court", "court_review", "court_request"]),
  players: new Set(["player"]),
  matches: new Set(["match"]),
  teams: new Set(["team_emblem", "team_name", "affiliation_name"]),
  appointments: new Set(),
};

const ADMIN_SECTION_SETTING_KEYS = {
  courts: ["approvedCourts", "courtRequests", "courtReviews"],
  players: ["adminDisciplinaryActions"],
  matches: [],
  teams: [],
  appointments: ["adminAppointments", "refereeAppointments", "refereeRequests"],
};

function mergeRemoteAdminState(state, remoteState = {}, options = {}) {
  if (!state || options.append !== true) return remoteState;
  const section = ADMIN_SECTION_SETTING_KEYS[options.section] ? options.section : "courts";
  const append = true;
  const reportTypes = ADMIN_SECTION_REPORT_TYPES[section];
  const incomingReports = (remoteState.reports ?? []).filter((report) => reportTypes.has(report.type));
  const unrelatedReports = (state.reports ?? []).filter((report) => !reportTypes.has(report.type));
  const currentReports = append
    ? (state.reports ?? []).filter((report) => reportTypes.has(report.type))
    : [];
  const settings = { ...(state.settings ?? {}) };
  (ADMIN_SECTION_SETTING_KEYS[section] ?? []).forEach((key) => {
    const incoming = remoteState.settings?.[key] ?? [];
    settings[key] = append ? mergeRemoteById(settings[key] ?? [], incoming) : incoming;
  });

  return {
    ...state,
    currentUserId: remoteState.currentUserId ?? state.currentUserId,
    users: mergeRemoteById(state.users, remoteState.users),
    teams: section === "teams" || section === "matches"
      ? (append ? mergeTeamsById(state.teams, remoteState.teams) : remoteState.teams ?? [])
      : state.teams,
    matches: section === "matches" || section === "players"
      ? (append ? mergeMatchesById(state.matches, remoteState.matches) : remoteState.matches ?? [])
      : state.matches,
    affiliations: section === "teams"
      ? (append ? mergeRemoteById(state.affiliations, remoteState.affiliations) : remoteState.affiliations ?? [])
      : state.affiliations,
    settings,
    reports: mergeRemoteById([...unrelatedReports, ...currentReports], incomingReports),
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
    hoopCount: getCourtHoopCount(request),
    lighting: normalizeCourtOptionalBoolean(request.lighting),
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

function mergeMatchThumbsResult(state, result = {}, operation = {}) {
  const matchId = result.matchId ?? operation.matchId ?? "";
  const actorProfileId = result.actorProfileId ?? "";
  if (!matchId || !actorProfileId) return state;
  const targetUserIds = Array.isArray(result.targetUserIds)
    ? result.targetUserIds.filter(Boolean)
    : [];
  return {
    ...state,
    matches: (state.matches ?? []).map((match) => {
      if (match.id !== matchId) return match;
      const trustFeedback = match.trustFeedback ?? {};
      return {
        ...match,
        trustFeedback: {
          ...trustFeedback,
          stars: {
            ...(trustFeedback.stars ?? {}),
            [actorProfileId]: targetUserIds,
          },
          updatedAt: new Date().toISOString(),
        },
      };
    }),
  };
}

export {
  createInitialMatchListStore,
  filterBlockedIncomingNotifications,
  filterPendingMatches,
  filterPendingRecruitingPosts,
  getBlockedUserIdsFromState,
  getMatchPaginationCursor,
  getRecruitingChatLastSeq,
  getRecruitingPaginationCursor,
  getRecruitingPaginationOffset,
  getRecruitingRegionRequest,
  getRecruitingStartFilterRequest,
  getStateMatchIds,
  getStateRecruitingPostIds,
  mergeCourtApprovalResult,
  mergeMatchThumbsResult,
  mergeRecruitingChatMessage,
  mergeRecruitingChatMessageBatch,
  mergeRemoteAdminState,
  mergeRemoteDirectory,
  mergeRemoteHomeState,
  mergeRemoteMatchPage,
  mergeRemoteProfileState,
  mergeRemoteRecruitingPage,
  mergeRemoteTournamentState,
  mergeServerRoomResult,
};
