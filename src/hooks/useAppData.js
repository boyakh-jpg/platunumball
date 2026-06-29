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
  confirmRecruitingMatch,
  confirmMatchRefereeAbsence,
  createMatch,
  createProfileShell,
  createRecruitingPost,
  createTeam,
  createTournament,
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
  setRecruitingPartyPlayerPlacement,
  setRecruitingPartyPlayerReserve,
  setRecruitingReady,
  setRecruitingStatRecorder,
  startMatch,
  startRefereeExamAttempt,
  submitCourtRequest,
  submitCourtReview,
  finishRefereeExamAttempt,
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
  REMOTE_CLIENT_INITIAL_MATCH_LIMIT,
  REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECRUITING_LIMIT,
} from "../data/repository.js";
import { isSupabaseConfigured } from "../lib/supabase.js";
import { readProfileBindings, readProfileCache, writeProfileBindings, writeProfileCache } from "../lib/storage.js";
import { findDiscordConnectionOwner, getDiscordConnectionUserId } from "../lib/discord.js";
import { getServerActionAvailability, postServerAction } from "../lib/serverActions.js";

function sortByRating(items, selector) {
  return [...items].sort((a, b) => selector(b) - selector(a));
}

function isPersistentAuthUserId(authUserId) {
  return Boolean(authUserId && !String(authUserId).startsWith("test-") && !getBackendTestLoginId(authUserId));
}

function getBackendTestLoginId(authUserId = "") {
  const match = String(authUserId || "").toLowerCase().match(/^test:(rankball-\d{3})$/);
  return match?.[1] ?? "";
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
  "updateTournamentMatchSchedule",
  "agreeMatch",
  "submitMatchResult",
  "handoffMatchRecorder",
  "approveMatch",
  "checkInMatchPlayer",
  "requestMatchRefereeAbsence",
  "confirmMatchRefereeAbsence",
  "toggleMatchStar",
  "submitMatchThumbs",
  "disputeMatch",
  "cancelMatch",
  "voidMatch",
  "resumeMatchApproval",
  "startMatch",
  "endMatch",
  "addMatchLatePlayer",
  "removeMatchLatePlayer",
  "updateMatchRoomRules",
  "setMatchRoomPlayerPlacement",
  "removeMatchRoomPlayer",
  "createRecruitingPost",
  "interestRecruitingPost",
  "inviteRecruitingReferee",
  "inviteRecruitingPlayers",
  "acceptRecruitingInvitation",
  "declineRecruitingInvitation",
  "cancelRecruitingParticipation",
  "setRecruitingReady",
  "updateRecruitingRoomRules",
  "sendRecruitingChat",
  "setRecruitingApplicantReserve",
  "setRecruitingApplicantPlacement",
  "joinRecruitingSideParty",
  "setRecruitingSlotPosition",
  "setRecruitingPartyPlayerReserve",
  "setRecruitingPartyPlayerPlacement",
  "detachRecruitingPartyPlayer",
  "removeRecruitingPartyPlayer",
  "setRecruitingStatRecorder",
  "kickRecruitingApplicant",
  "confirmRecruitingMatch",
  "closeRecruitingPost",
]);

function getServerOperation(meta = {}) {
  if (meta.operation) {
    const explicitAction = String(meta.operation.action || meta.action || "");
    return SERVER_OPERATION_ACTIONS.has(explicitAction) ? meta.operation : null;
  }
  if (!meta.action) return null;
  if (!SERVER_OPERATION_ACTIONS.has(String(meta.action))) return null;
  const { operation: _operation, ...payload } = meta;
  return payload;
}

function upsertById(items = [], item = null) {
  if (!item?.id) return items;
  return [item, ...items.filter((current) => current.id !== item.id)];
}

function mergeById(current = [], incoming = []) {
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

function shouldUseIncomingRoomRow(incoming, existing) {
  if (!existing) return true;
  const incomingTime = new Date(incoming?.updatedAt ?? incoming?.createdAt ?? 0).getTime();
  const existingTime = new Date(existing?.updatedAt ?? existing?.createdAt ?? 0).getTime();
  if (!Number.isFinite(incomingTime) || !Number.isFinite(existingTime)) return true;
  return incomingTime >= existingTime;
}

function mergeMatchesById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (!shouldUseIncomingRoomRow(item, existing)) return;
    merged.set(item.id, preserveExistingWhenEmpty(item, existing, [
      "agreements",
      "approvals",
      "disputes",
      "playedPlayerIds",
      "reservePlayers",
      "anonymousPlayers",
      "parties",
      "result",
    ]));
  });
  return [...merged.values()];
}

function mergeRecruitingPostsById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (!item?.id) return;
    const existing = merged.get(item.id);
    if (!shouldUseIncomingRoomRow(item, existing)) return;
    const next = preserveExistingWhenEmpty(item, existing, ["applicants"]);
    if (existing?.roomState && item?.roomState) {
      next.roomState = preserveExistingWhenEmpty(item.roomState, existing.roomState, ["chatMessages", "kickLog", "invitations"]);
    }
    merged.set(item.id, next);
  });
  return [...merged.values()];
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

function getRecruitingRegionRequest(page = {}) {
  const regionScope = page.regionScope === "region" ? "region" : "local";
  const regionKey = regionScope === "region" ? String(page.regionKey ?? "").trim() : "";
  return { regionScope, regionKey };
}

function mergeRemoteMatchPage(state, remoteState = {}) {
  const nextMatches = remoteState.matches ?? [];
  const nextPosts = remoteState.recruitingPosts ?? [];
  if (!nextMatches.length && !nextPosts.length) return state;
  return {
    ...state,
    users: mergeById(state.users, remoteState.users),
    teams: mergeTeamsById(state.teams, remoteState.teams),
    matches: nextMatches.length ? sortMatchesByRemoteCursor(mergeMatchesById(state.matches, nextMatches)) : state.matches,
    tournaments: mergeById(state.tournaments, remoteState.tournaments),
    recruitingPosts: nextPosts.length ? mergeRecruitingPostsById(state.recruitingPosts, nextPosts) : state.recruitingPosts,
  };
}

function mergeRemoteRecruitingPage(state, remoteState = {}) {
  const nextPosts = remoteState.recruitingPosts ?? [];
  if (!nextPosts.length) return state;
  return {
    ...state,
    users: mergeById(state.users, remoteState.users),
    teams: mergeTeamsById(state.teams, remoteState.teams),
    recruitingPosts: sortRecruitingByRemoteCursor(mergeRecruitingPostsById(state.recruitingPosts, nextPosts)),
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

function incrementFeedCount(feedCounts, key) {
  if (!feedCounts) return feedCounts;
  const current = Number(feedCounts[key]);
  if (!Number.isFinite(current)) return feedCounts;
  return { ...feedCounts, [key]: current + 1 };
}

function filterPendingMatches(remoteState = {}, pendingIds = new Set(), recentMutationTimes = new Map()) {
  const nextMatches = remoteState.matches ?? [];
  if ((!pendingIds.size && !recentMutationTimes.size) || !nextMatches.length) return remoteState;
  const filteredMatches = nextMatches.filter((match) => !pendingIds.has(match.id) && !recentMutationTimes.has(match.id));
  return filteredMatches.length === nextMatches.length ? remoteState : { ...remoteState, matches: filteredMatches };
}

function getRemoteDirectorySettings(settings = null, { includeTheme = false } = {}) {
  if (!settings) return null;
  if (includeTheme) return settings;
  const { theme: _theme, ...settingsWithoutTheme } = settings;
  return settingsWithoutTheme;
}

function mergeRemoteDirectory(state, remoteState = {}, options = {}) {
  const settingsPatch = getRemoteDirectorySettings(remoteState.settings, options);
  return {
    ...state,
    users: mergeById(state.users, remoteState.users),
    teams: mergeById(state.teams, remoteState.teams),
    teamInvitations: mergeById(state.teamInvitations, remoteState.teamInvitations),
    affiliations: remoteState.affiliations?.length ? remoteState.affiliations : state.affiliations,
    seasons: remoteState.seasons?.length ? remoteState.seasons : state.seasons,
    settings: settingsPatch ? { ...state.settings, ...settingsPatch } : state.settings,
  };
}

function mergeRemoteProfileState(state, remoteState = {}) {
  const profileUserId = remoteState.currentUserId ?? state.currentUserId;
  const nextState = mergeRemoteDirectory(state, remoteState, { includeTheme: true });
  if (!Array.isArray(remoteState.teamInvitations) || !profileUserId) return nextState;
  const unrelatedInvitations = (state.teamInvitations ?? []).filter((invitation) => (
    invitation.fromUserId !== profileUserId &&
    invitation.targetUserId !== profileUserId
  ));
  return {
    ...nextState,
    teamInvitations: [...remoteState.teamInvitations, ...unrelatedInvitations],
  };
}

function mergeServerRoomResult(state, result = {}) {
  if (!result || typeof result !== "object") return state;
  const nextPost = result.post ?? null;
  const nextMatch = result.createdMatch ?? result.match ?? null;
  if (!nextPost && !nextMatch) return state;
  return {
    ...state,
    recruitingPosts: nextPost ? upsertById(state.recruitingPosts ?? [], nextPost) : state.recruitingPosts,
    matches: nextMatch ? upsertById(state.matches ?? [], nextMatch) : state.matches,
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
  const backendTestLoginId = getBackendTestLoginId(authUserId);
  if (backendTestLoginId) {
    const currentUser = users.find((user) => user.id === state.currentUserId);
    if (String(currentUser?.testLoginId ?? "").toLowerCase() === backendTestLoginId) return currentUser.id;
    const testUser = users.find((user) => String(user.testLoginId ?? "").toLowerCase() === backendTestLoginId);
    if (testUser) return testUser.id;
    return state.currentUserId ?? "";
  }

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

function getInitialStateLoadOptions() {
  const pathname = typeof window !== "undefined" ? window.location.pathname.replace(/\/$/, "") : "";
  const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const teamDetailMatch = pathname.match(/^\/app\/teams\/([^/]+)$/);
  if (teamDetailMatch) {
    return { endpoint: "teamDetail", teamId: decodeURIComponent(teamDetailMatch[1]), matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/teams") {
    return { endpoint: "teamsList", matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/matches") {
    if (searchParams?.get("match")) return { profileOnly: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
    return { endpoint: "matchesList", matchLimit: 200, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/recruiting") {
    if (searchParams?.get("post")) return { profileOnly: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
    return { endpoint: "recruitingList", matchLimit: 0, recruitingLimit: REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT, tournamentLimit: 0 };
  }
  if (pathname === "/app/recorder") {
    return { endpoint: "recorderMatches", matchLimit: REMOTE_CLIENT_MATCH_LIMIT, recruitingLimit: 0, tournamentLimit: 0 };
  }
  return { matchLimit: REMOTE_CLIENT_INITIAL_MATCH_LIMIT, recruitingLimit: REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT };
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

async function loadProfileState(authUserId, authEmail) {
  try {
    const result = await postServerAction(
      "/api/profile/me",
      { authUserId, authEmail },
      { allowWhenDisabled: true },
    );
    if (result?.state) return normalizeServerState(result.state);
  } catch (error) {
    console.warn("Server profile load failed. Falling back to direct Supabase read.", error.message);
  }
  return loadRemoteState(authUserId, authEmail, {
    scope: "profile",
    matchLimit: 0,
    recruitingLimit: 0,
    tournamentLimit: 0,
  });
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
          includeRecruitingSchedule: true,
          adminContext: false,
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
          includeMine: true,
          regionScope: "local",
          listOnly: true,
          adminContext: false,
          includeFeedCounts: true,
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
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { matchPage: result.page ?? null });
    }
    const result = await postServerAction(
      "/api/state/load",
      { authUserId, authEmail, ...loadOptions },
      { allowWhenDisabled: true },
    );
    if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { recruitingPage: result.page ?? null });
  } catch (error) {
    console.warn("Server state load failed. Falling back to direct Supabase read.", error.message);
  }
  return loadRemoteState(authUserId, authEmail, loadOptions);
}

export function useAppData(authUser = null) {
  const authUserId = typeof authUser === "string" ? authUser : authUser?.id ?? null;
  const authEmail = typeof authUser === "object" ? authUser?.email ?? authUser?.user_metadata?.email ?? "" : "";
  const [state, setRawState] = useState(() => syncNotificationDeliveries(getCachedBootstrapState(authUserId, authEmail)));
  const setState = useCallback((updater) => {
    setRawState((prev) => syncNotificationDeliveries(typeof updater === "function" ? updater(prev) : updater));
  }, []);
  const [profileBindings, setProfileBindings] = useState(() => readProfileBindings());
  const [adminContext, setAdminContext] = useState(EMPTY_ADMIN_CONTEXT);
  const [matchPagination, setMatchPagination] = useState({ loading: false, exhausted: !isSupabaseConfigured, error: "", cursor: "", recruitingScheduleChecked: false, recruitingScheduleLoading: false });
  const [recruitingPagination, setRecruitingPagination] = useState({ loading: false, exhausted: !isSupabaseConfigured, error: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", feedCounts: null });
  const [directoryStatus, setDirectoryStatus] = useState({ loading: false, loaded: !isSupabaseConfigured, error: "" });
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);
  const adminContextRef = useRef(EMPTY_ADMIN_CONTEXT);
  const remoteReadyRef = useRef(!isSupabaseConfigured);
  const directoryPromiseRef = useRef(null);
  const pendingRecruitingPostIdsRef = useRef(new Set());
  const recentRecruitingMutationTimesRef = useRef(new Map());
  const pendingMatchIdsRef = useRef(new Set());
  const recentMatchMutationTimesRef = useRef(new Map());
  const syncedDiscordDeliveryIdsRef = useRef(new Set());
  const profileKey = authUserId ?? "local-demo";
  const profileLocked = isPersistentAuthUserId(authUserId);
  const backendTestLoginId = getBackendTestLoginId(authUserId);
  const serverProfileBound = profileLocked || Boolean(backendTestLoginId);
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
    }, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId || !remoteReady) return;
    cacheCurrentProfileState(authUserId, state);
  }, [authUserId, remoteReady, state.currentUserId, state.settings, state.users]);

  useEffect(() => {
    if (!isSupabaseConfigured || !authUserId) {
      remoteReadyRef.current = !isSupabaseConfigured;
      setRemoteReady(!isSupabaseConfigured);
      setMatchPagination({ loading: false, exhausted: true, error: "", cursor: "", recruitingScheduleChecked: false, recruitingScheduleLoading: false });
      setRecruitingPagination({ loading: false, exhausted: true, error: "", cursor: "", offset: 0, regionScope: "local", regionKey: "", feedCounts: null });
      setDirectoryStatus({ loading: false, loaded: true, error: "" });
      return undefined;
    }

    let mounted = true;
    remoteReadyRef.current = false;
    setRemoteReady(false);
    directoryPromiseRef.current = null;
    pendingRecruitingPostIdsRef.current = new Set();
    recentRecruitingMutationTimesRef.current = new Map();
    pendingMatchIdsRef.current = new Set();
    recentMatchMutationTimesRef.current = new Map();
    setState(getCachedBootstrapState(authUserId, authEmail));
    setDirectoryStatus({ loading: false, loaded: false, error: "" });
    const initialLoadOptions = getInitialStateLoadOptions();
    const initialLoad = initialLoadOptions.profileOnly
      ? loadProfileState(authUserId, authEmail)
      : loadBackendState(authUserId, authEmail, initialLoadOptions);
    initialLoad
      .then((remoteState) => {
        if (!mounted) return;
        if (remoteState) {
          const remoteMeta = getRemoteMeta(remoteState);
          const maintainedState = isSupabaseConfigured ? remoteState : runAutomaticStateMaintenance(remoteState);
          const initialMatchLimit = Number(initialLoadOptions.matchLimit ?? 0);
          const initialRecruitingLimit = Number(initialLoadOptions.recruitingLimit ?? 0);
          cacheCurrentProfileState(authUserId, maintainedState);
          setState((prev) => withServerAdminContext(preserveLocalDiscordState(prev, maintainedState), adminContextRef.current));
          setMatchPagination({
            loading: false,
            exhausted: initialMatchLimit <= 0 || Boolean(remoteMeta.matchPage?.exhausted) || (maintainedState.matches?.length ?? 0) < initialMatchLimit,
            error: "",
            cursor: remoteMeta.matchPage?.cursor ?? getMatchPaginationCursor(maintainedState.matches),
            recruitingScheduleChecked: Boolean(remoteMeta.matchPage?.recruitingScheduleChecked),
            recruitingScheduleLoading: false,
          });
          setRecruitingPagination({
            loading: false,
            exhausted: initialRecruitingLimit <= 0 || Boolean(remoteMeta.recruitingPage?.exhausted) || (maintainedState.recruitingPosts?.length ?? 0) < initialRecruitingLimit,
            error: "",
            cursor: remoteMeta.recruitingPage?.cursor ?? getRecruitingPaginationCursor(maintainedState.recruitingPosts),
            offset: getRecruitingPaginationOffset(remoteMeta.recruitingPage, maintainedState.recruitingPosts?.length ?? 0),
            ...getRecruitingRegionRequest(remoteMeta.recruitingPage),
            feedCounts: remoteMeta.recruitingPage?.feedCounts ?? null,
          });
          if (remoteMeta.directoryLoaded) {
            setDirectoryStatus({ loading: false, loaded: true, error: "" });
          }
        }
        remoteReadyRef.current = true;
        setRemoteReady(true);
      })
      .catch((error) => {
        console.warn("Supabase hydration failed. Remote state remains empty.", error.message);
        remoteReadyRef.current = true;
        setMatchPagination({ loading: false, exhausted: true, error: error.message ?? "state_load_failed", cursor: "", recruitingScheduleChecked: false, recruitingScheduleLoading: false });
        setRecruitingPagination({ loading: false, exhausted: true, error: error.message ?? "state_load_failed", cursor: "", offset: 0, regionScope: "local", regionKey: "", feedCounts: null });
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
    adminContextRef.current = EMPTY_ADMIN_CONTEXT;
    setAdminContext(EMPTY_ADMIN_CONTEXT);
    setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
  }, [authUserId, setState]);

  const loadAdminContext = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) {
      adminContextRef.current = EMPTY_ADMIN_CONTEXT;
      setAdminContext(EMPTY_ADMIN_CONTEXT);
      setState((prev) => withServerAdminContext(prev, EMPTY_ADMIN_CONTEXT));
      return EMPTY_ADMIN_CONTEXT;
    }
    try {
      const result = await postServerAction("/api/admin/context", {}, { allowWhenDisabled: true });
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
  }, [authUserId, setState]);

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
  const ensureServerActionAvailable = useCallback(async (path, label = "저장") => {
    if (!isSupabaseConfigured) return true;
    const availability = await getServerActionAvailability(path);
    if (availability.ok) return true;
    const errorCode = availability.error || "server_action_unavailable";
    console.warn(`Server action unavailable before optimistic update: ${path}`, {
      reason: errorCode,
      path,
    });
    pushLocalWarning("서버 저장 실패", `${label}이 서버에 저장되지 않았습니다. 이유: ${errorCode}`, {
      payload: { path, error: errorCode },
    });
    return { ok: false, error: errorCode, path };
  }, [pushLocalWarning]);
  const runServerAction = useCallback((path, payload) => {
    return postServerAction(path, payload).then((result) => {
      if (!result) throw new Error("server_action_unavailable");
      return result;
    }).catch((error) => {
      const errorCode = getServerActionErrorText(error);
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
  }, [pushLocalWarning]);
  const persistProfileServer = useCallback((profile) => {
    const promise = postServerAction("/api/profile/upsert", { profile }, { allowWhenDisabled: true }).then((result) => {
      if (!result) throw new Error("profile_server_action_unavailable");
      return result;
    });
    promise.catch((error) => {
      console.warn("Profile server action failed.", error.message);
    });
    return promise;
  }, []);
  const syncRecruitingPostServer = useCallback((post, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!post?.id && !operation) return Promise.resolve(false);
    const pendingPostId = post?.id ?? operation?.postId ?? meta.postId ?? "";
    const mutationStartedAt = Date.now();
    if (pendingPostId) {
      pendingRecruitingPostIdsRef.current.add(pendingPostId);
      recentRecruitingMutationTimesRef.current.set(pendingPostId, mutationStartedAt);
    }
    const payload = operation
      ? { operation, ...(post?.id ? { post } : {}), notifications, createdMatch: meta.createdMatch ?? null }
      : { post, notifications, ...meta };
    return runServerAction("/api/recruiting/sync-post", payload).then((result) => {
      if (result?.post || result?.createdMatch) setState((prev) => mergeServerRoomResult(prev, result));
      return result;
    }).finally(() => {
      if (!pendingPostId) return;
      pendingRecruitingPostIdsRef.current.delete(pendingPostId);
      if (recentRecruitingMutationTimesRef.current.get(pendingPostId) === mutationStartedAt) {
        recentRecruitingMutationTimesRef.current.delete(pendingPostId);
      }
    });
  }, [runServerAction, setState]);
  const syncMatchServer = useCallback((match, notifications = [], meta = {}) => {
    const operation = getServerOperation(meta);
    if (!match?.id && !operation) return Promise.resolve(false);
    const pendingMatchId = match?.id ?? operation?.matchId ?? meta.matchId ?? "";
    const mutationStartedAt = Date.now();
    if (pendingMatchId) {
      pendingMatchIdsRef.current.add(pendingMatchId);
      recentMatchMutationTimesRef.current.set(pendingMatchId, mutationStartedAt);
    }
    const payload = operation ? { operation, ...(match?.id ? { match } : {}), notifications } : { match, notifications, ...meta };
    return runServerAction("/api/matches/sync-match", payload).then((result) => {
      if (result?.match) setState((prev) => mergeServerRoomResult(prev, result));
      return result;
    }).finally(() => {
      if (!pendingMatchId) return;
      pendingMatchIdsRef.current.delete(pendingMatchId);
      if (recentMatchMutationTimesRef.current.get(pendingMatchId) === mutationStartedAt) {
        recentMatchMutationTimesRef.current.delete(pendingMatchId);
      }
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
    return runServerAction("/api/teams/sync-team", { teamInviteAction, ...payload });
  }, [runServerAction]);
  const syncTournamentServer = useCallback((tournament, notifications = [], meta = {}) => {
    if (!tournament?.id) return Promise.resolve(false);
    const operation = getServerOperation(meta);
    const payload = operation ? { operation } : { tournament, notifications, ...meta };
    return runServerAction("/api/tournaments/sync-tournament", payload);
  }, [runServerAction]);
  const syncRefereeServer = useCallback((action, payload = {}) => {
    if (!action) return;
    runServerAction("/api/referee/sync", { action, ...payload });
  }, [runServerAction]);
  const syncFavoriteServer = useCallback((targetType, targetId, active) => {
    if (!targetType || !targetId) return;
    runServerAction("/api/favorites/sync", { targetType, targetId, active });
  }, [runServerAction]);
  const markNotificationReadServer = useCallback((payload = {}) => {
    runServerAction("/api/notifications/read", payload);
  }, [runServerAction]);
  const syncSettingsServer = useCallback((settingsPatch = {}) => {
    return runServerAction("/api/settings/sync", { settings: settingsPatch }).then((result) => {
      if (result?.settings) {
        setState((prev) => {
          const nextState = updateSettings({ ...prev, currentUserId }, result.settings);
          cacheCurrentProfileState(authUserId, nextState);
          return nextState;
        });
      }
      return result;
    });
  }, [authUserId, currentUserId, runServerAction, setState]);

  const refreshCurrentProfile = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
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
  }, [authEmail, authUserId, setState]);

  const loadMoreMatches = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId || matchPagination.loading || matchPagination.exhausted) return false;
    const cursor = matchPagination.cursor || getMatchPaginationCursor(state.matches);
    if (!cursor && (state.matches?.length ?? 0) > 0) {
      setMatchPagination((prev) => ({ ...prev, loading: false, exhausted: true, error: "", cursor: "" }));
      return false;
    }
    const pageLimit = cursor ? REMOTE_CLIENT_MATCH_LIMIT : REMOTE_CLIENT_INITIAL_MATCH_LIMIT;
    setMatchPagination((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const result = await postServerAction(
        "/api/matches/list",
        {
          authUserId,
          authEmail,
          limit: pageLimit,
          ...(cursor ? { cursor } : {}),
          listOnly: true,
          includeRecruitingSchedule: false,
          adminContext: false,
        },
        { allowWhenDisabled: true },
      );
      const rawRemoteState = result?.state ?? {};
      const rawMatchCount = rawRemoteState.matches?.length ?? 0;
      const remoteState = normalizeServerState(filterPendingMatches(rawRemoteState, pendingMatchIdsRef.current, recentMatchMutationTimesRef.current));
      const nextMatches = remoteState.matches ?? [];
      setState((prev) => mergeRemoteMatchPage(prev, remoteState));
      setMatchPagination((prev) => ({
        loading: false,
        exhausted: Boolean(result?.page?.exhausted) || rawMatchCount < pageLimit,
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
  }, [authEmail, authUserId, matchPagination.cursor, matchPagination.exhausted, matchPagination.loading, setState, state.matches]);

  const loadMatchRecruitingSchedule = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId || matchPagination.recruitingScheduleLoading) return false;
    setMatchPagination((prev) => ({ ...prev, recruitingScheduleLoading: true, error: "" }));
    try {
      const result = await postServerAction(
        "/api/matches/list",
        {
          authUserId,
          authEmail,
          limit: REMOTE_CLIENT_MATCH_LIMIT,
          listOnly: true,
          activeOnly: true,
          includeRecruitingSchedule: true,
          adminContext: false,
        },
        { allowWhenDisabled: true },
      );
      const remoteState = normalizeServerState(filterPendingRecruitingPosts(result?.state ?? {}, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
      setState((prev) => mergeRemoteMatchPage(prev, remoteState));
      setMatchPagination((prev) => ({
        ...prev,
        recruitingScheduleLoading: false,
        error: "",
        recruitingScheduleChecked: true,
        cursor: prev.cursor || result?.page?.cursor || getMatchPaginationCursor(remoteState.matches ?? []),
      }));
      return remoteState.recruitingPosts?.length ?? 0;
    } catch (error) {
      console.warn("Match recruiting schedule load failed.", error.message);
      setMatchPagination((prev) => ({ ...prev, recruitingScheduleLoading: false, error: error.message ?? "match_recruiting_schedule_load_failed" }));
      return false;
    }
  }, [authEmail, authUserId, matchPagination.recruitingScheduleLoading, setState]);

  const loadMatchDetail = useCallback(async (matchId) => {
    if (!isSupabaseConfigured || !authUserId || !matchId) return false;
    try {
      const result = await postServerAction(
        "/api/matches/detail",
        {
          authUserId,
          authEmail,
          matchId,
        },
        { allowWhenDisabled: true },
      );
      const remoteState = normalizeServerState(result?.state ?? {});
      const nextMatches = remoteState.matches ?? [];
      setState((prev) => mergeRemoteMatchPage(prev, remoteState));
      return nextMatches.length;
    } catch (error) {
      console.warn("Match detail load failed.", error.message);
      return false;
    }
  }, [authEmail, authUserId, setState]);

  const loadRecorderMatches = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    try {
      const result = await postServerAction(
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
      return nextMatches.length;
    } catch (error) {
      console.warn("Recorder match load failed.", error.message);
      return false;
    }
  }, [authEmail, authUserId, setState]);

  const loadMoreRecruiting = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId || recruitingPagination.loading || recruitingPagination.exhausted) return false;
    const offset = getRecruitingPaginationOffset(recruitingPagination, recruitingPagination.offset ?? 0);
    const regionRequest = getRecruitingRegionRequest(recruitingPagination);
    setRecruitingPagination((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const result = await postServerAction(
        "/api/recruiting/list",
        {
          authUserId,
          authEmail,
          limit: REMOTE_CLIENT_RECRUITING_LIMIT,
          offset,
          regionScope: "local",
          ...(regionRequest.regionKey ? { regionKey: regionRequest.regionKey } : {}),
          listOnly: true,
          adminContext: false,
          includeFeedCounts: true,
        },
        { allowWhenDisabled: true },
      );
      const rawRemoteState = result?.state ?? {};
      const rawPostCount = rawRemoteState.recruitingPosts?.length ?? 0;
      const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
      const nextPosts = remoteState.recruitingPosts ?? [];
      setState((prev) => mergeRemoteRecruitingPage(prev, remoteState));
      const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
      setRecruitingPagination({
        loading: false,
        exhausted: pageHasExhausted ? result.page.exhausted : rawPostCount < REMOTE_CLIENT_RECRUITING_LIMIT,
        error: "",
        cursor: result?.page?.cursor ?? String(offset + rawPostCount),
        offset: getRecruitingPaginationOffset(result?.page, offset + rawPostCount),
        ...regionRequest,
        feedCounts: result?.page?.feedCounts ?? recruitingPagination.feedCounts ?? null,
      });
      return nextPosts.length;
    } catch (error) {
      console.warn("More recruiting load failed.", error.message);
      setRecruitingPagination((prev) => ({ ...prev, loading: false, exhausted: false, error: error.message ?? "recruiting_page_load_failed" }));
      return false;
    }
  }, [authEmail, authUserId, recruitingPagination, setState, state.recruitingPosts]);

  const loadRecruitingRegion = useCallback(async ({ regionKey = "", regionScope = "local" } = {}) => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const regionRequest = getRecruitingRegionRequest({ regionScope: regionScope === "region" && regionKey ? "region" : "local", regionKey });
    setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, loading: true, exhausted: false, error: "", cursor: "", offset: 0 }));
    try {
      const result = await postServerAction(
        "/api/recruiting/list",
        {
          authUserId,
          authEmail,
          limit: REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
          offset: 0,
          regionScope: "local",
          ...(regionRequest.regionKey ? { regionKey: regionRequest.regionKey } : {}),
          includeMine: true,
          listOnly: true,
          adminContext: false,
          includeFeedCounts: true,
        },
        { allowWhenDisabled: true },
      );
      const rawRemoteState = result?.state ?? {};
      const rawPostCount = rawRemoteState.recruitingPosts?.length ?? 0;
      const remoteState = normalizeServerState(filterPendingRecruitingPosts(rawRemoteState, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
      const nextPosts = remoteState.recruitingPosts ?? [];
      setState((prev) => mergeRemoteRecruitingPage(prev, remoteState));
      const pageHasExhausted = typeof result?.page?.exhausted === "boolean";
      setRecruitingPagination({
        loading: false,
        exhausted: pageHasExhausted ? result.page.exhausted : rawPostCount < REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT,
        error: "",
        cursor: result?.page?.cursor ?? String(rawPostCount),
        offset: getRecruitingPaginationOffset(result?.page, rawPostCount),
        ...regionRequest,
        feedCounts: result?.page?.feedCounts ?? recruitingPagination.feedCounts ?? null,
      });
      return nextPosts.length;
    } catch (error) {
      console.warn("Recruiting region load failed.", error.message);
      setRecruitingPagination((prev) => ({ ...prev, ...regionRequest, loading: false, exhausted: false, error: error.message ?? "recruiting_region_load_failed", cursor: "", offset: 0 }));
      return false;
    }
  }, [authEmail, authUserId, recruitingPagination.feedCounts, setState]);

  const loadRecruitingPost = useCallback(async (postId) => {
    if (!isSupabaseConfigured || !authUserId || !postId) return false;
    try {
      const result = await postServerAction(
        "/api/recruiting/list",
        {
          authUserId,
          authEmail,
          postId,
          limit: 1,
          adminContext: false,
        },
        { allowWhenDisabled: true },
      );
      const remoteState = normalizeServerState(result?.state ?? {});
      const nextPosts = remoteState.recruitingPosts ?? [];
      setState((prev) => mergeRemoteRecruitingPage(prev, remoteState));
      setRecruitingPagination((prev) => ({
        ...prev,
        feedCounts: result?.page?.feedCounts ?? prev.feedCounts ?? null,
      }));
      return nextPosts.length;
    } catch (error) {
      console.warn("Recruiting post load failed.", error.message);
      return false;
    }
  }, [authEmail, authUserId, setState]);

  const loadMyRecruitingPosts = useCallback(async (roomScope = "") => {
    if (!isSupabaseConfigured || !authUserId) return false;
    const requestedRoomScope = ["created", "joined", "invited"].includes(roomScope) ? roomScope : "";
    try {
      const result = await postServerAction(
        "/api/recruiting/list",
        {
          authUserId,
          authEmail,
          scope: "mine",
          ...(requestedRoomScope ? { roomScope: requestedRoomScope } : {}),
          limit: REMOTE_CLIENT_RECRUITING_LIMIT,
          adminContext: false,
        },
        { allowWhenDisabled: true },
      );
      const remoteState = normalizeServerState(filterPendingRecruitingPosts(result?.state ?? {}, pendingRecruitingPostIdsRef.current, recentRecruitingMutationTimesRef.current));
      const nextPosts = remoteState.recruitingPosts ?? [];
      setState((prev) => mergeRemoteRecruitingPage(prev, remoteState));
      setRecruitingPagination((prev) => ({
        ...prev,
        feedCounts: result?.page?.feedCounts ?? prev.feedCounts ?? null,
      }));
      return nextPosts.length;
    } catch (error) {
      console.warn("My recruiting load failed.", error.message);
      return false;
    }
  }, [authEmail, authUserId, setState]);

  const loadDirectory = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) return false;
    if (directoryStatus.loaded) return true;
    if (directoryPromiseRef.current) return directoryPromiseRef.current;

    const pathname = typeof window !== "undefined" ? window.location.pathname.replace(/\/$/, "") : "";
    const useTeamDirectory = pathname === "/app/teams" || pathname.startsWith("/app/teams/");
    const endpoint = useTeamDirectory ? "/api/teams/list" : "/api/directory/load";
    setDirectoryStatus((prev) => ({ ...prev, loading: true, error: "" }));
    const promise = postServerAction(
      endpoint,
      { authUserId, authEmail },
      { allowWhenDisabled: true },
    ).then((result) => {
      const remoteState = result?.state ?? {};
      setState((prev) => mergeRemoteDirectory(prev, remoteState));
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
  }, [authEmail, authUserId, directoryStatus.loaded, setState]);

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
      const applyRecruitingPostMutation = async (postId, reducer, meta = {}) => {
        const serverReady = await ensureServerActionAvailable("/api/recruiting/sync-post", "방 변경");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("방 변경")) return;
        const operation = getServerOperation({ ...meta, postId });
        let rollbackState = null;
        let syncedPost = null;
        let syncedNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const beforePost = (prev.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          const next = reducer(prev);
          const nextPost = (next.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          syncedPost = nextPost && nextPost !== beforePost ? nextPost : null;
          syncedNotifications = syncedPost ? getNewRecruitingNotifications(prev, next, postId) : [];
          return !syncedPost && operation && isSupabaseConfigured ? prev : next;
        });
        if (syncedPost) rollbackIfServerFailed(syncRecruitingPostServer(syncedPost, syncedNotifications, { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
        else if (operation) rollbackIfServerFailed(syncRecruitingPostServer(null, [], { ...meta, postId }), rollbackState, "방 변경", { action: meta.action, postId });
      };
      const applyMatchMutation = async (matchId, reducer, meta = {}) => {
        const serverReady = await ensureServerActionAvailable("/api/matches/sync-match", "경기 변경");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("경기 변경")) return;
        const operation = getServerOperation({ ...meta, matchId });
        let rollbackState = null;
        let syncedMatch = null;
        let syncedNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const beforeMatch = (prev.matches ?? []).find((match) => match.id === matchId) ?? null;
          const next = reducer(prev);
          const nextMatch = (next.matches ?? []).find((match) => match.id === matchId) ?? null;
          syncedMatch = nextMatch && nextMatch !== beforeMatch ? nextMatch : null;
          syncedNotifications = syncedMatch ? getNewMatchNotifications(prev, next, matchId) : [];
          return !syncedMatch && operation && isSupabaseConfigured ? prev : next;
        });
        if (syncedMatch) rollbackIfServerFailed(syncMatchServer(syncedMatch, syncedNotifications, { ...meta, matchId }), rollbackState, "경기 변경", { action: meta.action, matchId });
        else if (operation) rollbackIfServerFailed(syncMatchServer(null, [], { ...meta, matchId }), rollbackState, "경기 변경", { action: meta.action, matchId });
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
        rollbackIfServerFailed(syncTeamInvitationServer(action, payload), rollbackState, label, { action, ...payload });
      };

      return ({
        loadMatchDetail,
        loadMatchRecruitingSchedule,
        refreshCurrentProfile,
        loadDirectory,
        loadAdminContext,
        loadMoreMatches,
        loadMoreRecruiting,
        loadRecruitingRegion,
        loadRecruitingPost,
        loadMyRecruitingPosts,
        loadRecorderMatches,
        switchUser: (userId) => {
        if (profileLocked) return false;
        setProfileBindings((current) => {
          const next = { ...current, [profileKey]: userId };
          writeProfileBindings(next);
          return next;
        });
        setState((prev) => ({ ...prev, currentUserId: userId }));
        return true;
      },
      createMatch: async (draft) => {
        const serverReady = await ensureServerActionAvailable("/api/matches/sync-match", "경기 생성");
        if (serverReady !== true) return serverReady;
        if (!ensureRemoteReady("경기 생성")) return null;
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
      approveTournamentTeam: (tournamentId, teamId) => {
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
        applyMatchMutation(matchId, (prev) => updateTournamentMatchSchedule({ ...prev, currentUserId }, tournamentId, matchId, schedule), { action: "updateTournamentMatchSchedule", tournamentId, schedule });
      },
      agreeMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => agreeMatch({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "agreeMatch", sideName, playerId }),
      submitMatchResult: (matchId, result) => applyMatchMutation(matchId, (prev) => submitMatchResult({ ...prev, currentUserId }, matchId, result), { action: "submitMatchResult", result }),
      handoffMatchRecorder: (matchId, sideName, nextRecorderId) => {
        applyMatchMutation(matchId, (prev) => handoffMatchRecorder({ ...prev, currentUserId }, matchId, sideName, nextRecorderId), { action: "handoffMatchRecorder", sideName, nextRecorderId });
      },
      approveMatch: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => approveMatch({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "approveMatch", sideName, playerId }),
      checkInMatchPlayer: (matchId, sideName, playerId) => applyMatchMutation(matchId, (prev) => checkInMatchPlayer({ ...prev, currentUserId }, matchId, sideName, playerId), { action: "checkInMatchPlayer", sideName, playerId }),
      requestMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => requestMatchRefereeAbsence({ ...prev, currentUserId }, matchId), { action: "requestMatchRefereeAbsence" }),
      confirmMatchRefereeAbsence: (matchId) => applyMatchMutation(matchId, (prev) => confirmMatchRefereeAbsence({ ...prev, currentUserId }, matchId), { action: "confirmMatchRefereeAbsence" }),
      toggleMatchStar: (matchId, targetUserId) => applyMatchMutation(matchId, (prev) => toggleMatchStar({ ...prev, currentUserId }, matchId, targetUserId), { action: "toggleMatchStar", targetUserId }),
      submitMatchThumbs: (matchId, targetUserIds) => applyMatchMutation(matchId, (prev) => submitMatchThumbs({ ...prev, currentUserId }, matchId, targetUserIds), { action: "submitMatchThumbs", targetUserIds }),
      disputeMatch: (matchId, reason) => applyMatchMutation(matchId, (prev) => disputeMatch({ ...prev, currentUserId }, matchId, reason), { action: "disputeMatch", reason }),
      cancelMatch: (matchId) => applyMatchMutation(matchId, (prev) => cancelMatch({ ...prev, currentUserId }, matchId), { action: "cancelMatch" }),
      voidMatch: (matchId) => applyMatchMutation(matchId, (prev) => voidMatch({ ...prev, currentUserId }, matchId), { action: "voidMatch" }),
      resumeMatchApproval: (matchId, resultDraft = null) => applyMatchMutation(matchId, (prev) => resumeMatchApproval({ ...prev, currentUserId }, matchId, resultDraft), { action: "resumeMatchApproval", resultDraft }),
      startMatch: (matchId) => applyMatchMutation(matchId, (prev) => startMatch({ ...prev, currentUserId }, matchId), { action: "startMatch" }),
      endMatch: (matchId) => applyMatchMutation(matchId, (prev) => endMatch({ ...prev, currentUserId }, matchId), { action: "endMatch" }),
      addMatchLatePlayer: (matchId, draft) => applyMatchMutation(matchId, (prev) => addMatchLatePlayer({ ...prev, currentUserId }, matchId, draft), { action: "addMatchLatePlayer", draft }),
      removeMatchLatePlayer: (matchId, playerId) => applyMatchMutation(matchId, (prev) => removeMatchLatePlayer({ ...prev, currentUserId }, matchId, playerId), { action: "removeMatchLatePlayer", playerId }),
      updateSettings: (patch) => {
        setState((prev) => updateSettings({ ...prev, currentUserId }, patch));
        syncSettingsServer(patch);
      },
      updatePrivacySettings: (patch) => {
        let nextPrivacy = null;
        setState((prev) => {
          const next = updatePrivacySettings({ ...prev, currentUserId }, patch);
          nextPrivacy = next.settings?.privacy ?? null;
          return next;
        });
        if (nextPrivacy) syncSettingsServer({ privacy: nextPrivacy });
      },
      saveTheme: (theme) => {
        const nextTheme = theme === "light" ? "light" : "dark";
        if (!isSupabaseConfigured) {
          setState((prev) => updateSettings({ ...prev, currentUserId }, { theme: nextTheme }));
          return Promise.resolve(true);
        }
        if (!ensureRemoteReady("밝기 저장")) return Promise.resolve(false);
        let rollbackState = null;
        setState((prev) => {
          rollbackState = prev;
          return updateSettings({ ...prev, currentUserId }, { theme: nextTheme });
        });
        return rollbackIfServerFailed(
          syncSettingsServer({ theme: nextTheme }),
          rollbackState,
          "밝기 저장",
          { theme: nextTheme },
        ).then((result) => Boolean(result && result.ok !== false));
      },
      blockUser: (userId) => setState((prev) => blockUser({ ...prev, currentUserId }, userId)),
      unblockUser: (userId) => setState((prev) => unblockUser({ ...prev, currentUserId }, userId)),
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
      commitAdminReviewAction: (draft) => {
        setState((prev) => commitAdminReviewAction({ ...prev, currentUserId }, draft));
        runServerAction("/api/admin/review-action", draft);
      },
      commitAdminAppointmentAction: (draft) => {
        setState((prev) => commitAdminAppointmentAction({ ...prev, currentUserId }, draft));
        runServerAction("/api/admin/appointment-action", draft);
      },
      approveCourtRequest: (requestId) => {
        setState((prev) => approveCourtRequest({ ...prev, currentUserId }, requestId));
        runServerAction("/api/court-requests/approve", { requestId });
      },
      markNotificationRead: (notificationId) => {
        setState((prev) => markNotificationRead(prev, notificationId));
        markNotificationReadServer({ notificationId });
      },
      markAllNotificationsRead: () => {
        setState((prev) => markAllNotificationsRead(prev));
        markNotificationReadServer({ all: true });
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
        setState((prev) => {
          const next = submitCourtReview({ ...prev, currentUserId }, matchId, draft);
          submittedReview = (next.settings?.courtReviews ?? []).find((review) => review.matchId === matchId && review.reviewerId === currentUserId) ?? null;
          return next;
        });
        if (submittedReview) runServerAction("/api/courts/submit-review", { review: submittedReview });
      },
      startRefereeExamAttempt: (draft) => {
        let createdAttempt = null;
        setState((prev) => {
          const existingIds = new Set((prev.settings?.refereeExamAttempts ?? []).map((attempt) => attempt.id));
          const next = startRefereeExamAttempt({ ...prev, currentUserId }, draft);
          createdAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => !existingIds.has(attempt.id)) ?? null;
          return next;
        });
        if (createdAttempt) syncRefereeServer("startExam", { attempt: createdAttempt });
      },
      finishRefereeExamAttempt: (attemptId, result) => {
        let syncedAttempt = null;
        setState((prev) => {
          const beforeAttempt = (prev.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId);
          const next = finishRefereeExamAttempt({ ...prev, currentUserId }, attemptId, result);
          const nextAttempt = (next.settings?.refereeExamAttempts ?? []).find((attempt) => attempt.id === attemptId) ?? null;
          syncedAttempt = beforeAttempt && nextAttempt !== beforeAttempt ? nextAttempt : null;
          return next;
        });
        if (syncedAttempt) syncRefereeServer("finishExam", { attempt: syncedAttempt });
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
        return persistProfileServer(nextProfile).catch((error) => {
          rollbackServerMutation(rollbackState, "프로필 저장", {
            profileId: safeTargetUserId,
            error: getServerActionErrorText(error),
            statusCode: error.statusCode ?? null,
            details: error.details ?? null,
          });
          throw error;
        });
      },
      createTeam: (draft) => {
        if (!ensureRemoteReady("팀 생성")) return;
        let rollbackState = null;
        let createdTeam = null;
        let syncedNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const existingIds = new Set((prev.teams ?? []).map((team) => team.id));
          const next = createTeam({ ...prev, currentUserId }, draft);
          createdTeam = (next.teams ?? []).find((team) => !existingIds.has(team.id)) ?? null;
          syncedNotifications = createdTeam ? getNewTeamNotifications(prev, next) : [];
          return next;
        });
        if (createdTeam) rollbackIfServerFailed(syncTeamServer(createdTeam, syncedNotifications), rollbackState, "팀 생성", { teamId: createdTeam.id });
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
          setRecruitingPagination((prev) => ({ ...prev, feedCounts: incrementFeedCount(prev.feedCounts, "created") }));
          setMatchPagination((prev) => ({ ...prev, error: "", recruitingScheduleChecked: false }));
          loadMatchRecruitingSchedule();
          return result?.post?.id ?? result?.postId ?? createdPost.id;
        });
      },
      interestRecruitingPost: (postId, application) => applyRecruitingPostMutation(postId, (prev) => interestRecruitingPost({ ...prev, currentUserId }, postId, application), { action: "interestRecruitingPost", application, joinMode: application?.joinMode }),
      inviteRecruitingReferee: (postId, refereeId) => applyRecruitingPostMutation(postId, (prev) => inviteRecruitingReferee({ ...prev, currentUserId }, postId, refereeId), { action: "inviteRecruitingReferee", refereeId }),
      inviteRecruitingPlayers: (postId, invite) => applyRecruitingPostMutation(postId, (prev) => inviteRecruitingPlayers({ ...prev, currentUserId }, postId, invite), { action: "inviteRecruitingPlayers", invite }),
      acceptRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => acceptRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId), { action: "acceptRecruitingInvitation", invitationId }),
      declineRecruitingInvitation: (postId, invitationId) => applyRecruitingPostMutation(postId, (prev) => declineRecruitingInvitation({ ...prev, currentUserId }, postId, invitationId), { action: "declineRecruitingInvitation", invitationId }),
      cancelRecruitingParticipation: (postId) => applyRecruitingPostMutation(postId, (prev) => cancelRecruitingParticipation({ ...prev, currentUserId }, postId), { action: "cancelRecruitingParticipation" }),
      setRecruitingReady: (postId, ready) => applyRecruitingPostMutation(postId, (prev) => setRecruitingReady({ ...prev, currentUserId }, postId, ready), { action: "setRecruitingReady", ready }),
      updateRecruitingRoomRules: (postId, patch) => applyRecruitingPostMutation(postId, (prev) => updateRecruitingRoomRules({ ...prev, currentUserId }, postId, patch), { action: "updateRecruitingRoomRules", patch }),
      updateMatchRoomRules: (matchId, patch) => applyMatchMutation(matchId, (prev) => updateMatchRoomRules({ ...prev, currentUserId }, matchId, patch), { action: "updateMatchRoomRules", patch }),
      setMatchRoomPlayerPlacement: (matchId, playerId, placement) => applyMatchMutation(matchId, (prev) => setMatchRoomPlayerPlacement({ ...prev, currentUserId }, matchId, playerId, placement), { action: "setMatchRoomPlayerPlacement", playerId, placement }),
      removeMatchRoomPlayer: (matchId, playerId) => applyMatchMutation(matchId, (prev) => removeMatchRoomPlayer({ ...prev, currentUserId }, matchId, playerId), { action: "removeMatchRoomPlayer", playerId }),
      sendRecruitingChat: (postId, body) => applyRecruitingPostMutation(postId, (prev) => sendRecruitingChat({ ...prev, currentUserId }, postId, body), { action: "sendRecruitingChat", body }),
      setRecruitingApplicantReserve: (postId, playerId, reserve) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantReserve({ ...prev, currentUserId }, postId, playerId, reserve), { action: "setRecruitingApplicantReserve", playerId, reserve });
      },
      setRecruitingApplicantPlacement: (postId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => setRecruitingApplicantPlacement({ ...prev, currentUserId: playerId || currentUserId }, postId, playerId, placement), { action: "setRecruitingApplicantPlacement", playerId, placement });
      },
      joinRecruitingSideParty: (postId, teamId, sideName, entryId) => {
        applyRecruitingPostMutation(postId, (prev) => joinRecruitingSideParty({ ...prev, currentUserId }, postId, teamId, sideName, entryId), { action: "joinRecruitingSideParty", teamId, sideName, entryId });
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
      detachRecruitingPartyPlayer: (postId, entryId, playerId, placement) => {
        applyRecruitingPostMutation(postId, (prev) => detachRecruitingPartyPlayer({ ...prev, currentUserId: playerId || currentUserId }, postId, entryId, playerId, placement), { action: "detachRecruitingPartyPlayer", entryId, playerId, placement });
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
        let createdId = null;
        let createdMatch = null;
        let syncedPost = null;
        let syncedNotifications = [];
        let syncedMatchNotifications = [];
        setState((prev) => {
          rollbackState = prev;
          const existingIds = new Set((prev.matches ?? []).map((match) => match.id));
          const beforePost = (prev.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          const next = confirmRecruitingMatch({ ...prev, currentUserId }, postId);
          createdId = (next.matches ?? []).find((match) => !existingIds.has(match.id))?.id ?? null;
          createdMatch = createdId ? (next.matches ?? []).find((match) => match.id === createdId) ?? null : null;
          const nextPost = (next.recruitingPosts ?? []).find((post) => post.id === postId) ?? null;
          syncedPost = nextPost && nextPost !== beforePost ? nextPost : null;
          syncedNotifications = syncedPost ? getNewRecruitingNotifications(prev, next, postId) : [];
          syncedMatchNotifications = createdMatch ? getNewMatchNotifications(prev, next, createdMatch.id) : [];
          return !createdMatch && !syncedPost && isSupabaseConfigured ? prev : next;
        });
        if (syncedPost || createdMatch) {
          return rollbackIfServerFailed(
            syncedPost
              ? syncRecruitingPostServer(syncedPost, [...syncedNotifications, ...syncedMatchNotifications], { action: "confirmRecruitingMatch", postId, preferredMatchId: createdMatch?.id, createdMatch })
              : syncMatchServer(createdMatch, syncedMatchNotifications, { action: "confirmRecruitingMatch", matchId: createdMatch?.id, recruitingPostId: postId }),
            rollbackState,
            "방 확정",
            { action: "confirmRecruitingMatch", postId, matchId: createdMatch?.id },
          ).then((result) => (result?.ok === false ? null : result?.matchId ?? result?.createdMatch?.id ?? result?.match?.id ?? createdId));
        }
        if (isSupabaseConfigured) {
          return rollbackIfServerFailed(
            syncRecruitingPostServer(null, [], { action: "confirmRecruitingMatch", postId }),
            rollbackState,
            "방 확정",
            { action: "confirmRecruitingMatch", postId },
          ).then((result) => (result?.ok === false ? null : result?.matchId ?? result?.createdMatch?.id ?? result?.match?.id ?? null));
        }
        return createdId;
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
      ),
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
    [authEmail, authUserId, currentUserId, deleteTeamServer, ensureRemoteReady, ensureServerActionAvailable, loadAdminContext, loadDirectory, loadMatchDetail, loadMatchRecruitingSchedule, loadMoreMatches, loadMoreRecruiting, loadRecruitingRegion, loadRecruitingPost, loadMyRecruitingPosts, loadRecorderMatches, markNotificationReadServer, persistProfileServer, profileKey, profileLocked, refreshCurrentProfile, runServerAction, serverProfileBound, submitReportServer, syncFavoriteServer, syncMatchServer, syncRecruitingPostServer, syncRefereeServer, syncSettingsServer, syncTeamInvitationServer, syncTeamServer, syncTournamentServer],
  );

  const safeCurrentUserId = currentUserId ?? currentUser?.id ?? "";
  const safeCurrentUser = currentUser ?? createProfileShell(authUserId ?? safeCurrentUserId, authEmail);
  return { state: { ...state, currentUserId: safeCurrentUserId || safeCurrentUser.id }, currentUser: safeCurrentUser, currentUserId: safeCurrentUserId || safeCurrentUser.id, profileBound: true, profileLocked, remoteReady, adminContext, matchPagination, recruitingPagination, directoryStatus, rankings, actions };
}
