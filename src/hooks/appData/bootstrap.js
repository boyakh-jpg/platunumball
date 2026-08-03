import { REMOTE_CLIENT_INITIAL_MATCH_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_INITIAL_RECRUITING_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECORD_MATCH_LIMIT } from "../../lib/constants.js";
import { REMOTE_CLIENT_RECRUITING_LIMIT } from "../../lib/constants.js";
import { hasDemoInitialState } from "../../data/repository.js";
import { isSupabaseConfigured } from "../../lib/supabase.js";
import { loadRemoteState } from "../../data/repository.js";
import { loadState } from "../../data/repository.js";
import { normalizeState } from "../../data/repository.js";
import { postServerAction } from "../../lib/serverActions.js";
import { readProfileCache } from "../../lib/storage.js";
import { setDemoInitialState } from "../../data/repository.js";
import { writeProfileCache } from "../../lib/storage.js";
import { attachRemoteMeta, getRemoteMeta } from "./metadata.js";
import { EMPTY_RECORD_ARCHIVE } from "./recordArchive.js";
import { getRecruitingStartFilterRequest } from "./remoteMerge.js";
import { normalizeServerState } from "./stateNormalization.js";

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
    return { profileOnly: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/admin") {
    return { profileOnly: true, includeMatchSummary: false, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
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
    return { endpoint: "playMatches", matchLimit: REMOTE_CLIENT_MATCH_LIMIT, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/profile") {
    return { endpoint: "profileMe", matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/profile/records") {
    return { endpoint: "profileRecords", matchLimit: REMOTE_CLIENT_RECORD_MATCH_LIMIT, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/settings/favorites") {
    return { profileOnly: true, includeFavorites: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app/notifications") {
    return { profileOnly: true, includeTeamInvitations: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
  }
  if (pathname === "/app" || pathname === "/login") {
    return { endpoint: "homeLoad", matchLimit: REMOTE_CLIENT_MATCH_LIMIT, recruitingLimit: REMOTE_CLIENT_RECRUITING_LIMIT, tournamentLimit: 0 };
  }
  return { profileOnly: true, matchLimit: 0, recruitingLimit: 0, tournamentLimit: 0 };
}

function getHomeRouteLoadKey(location = null) {
  return getRoutePathname(location) === "/app" ? "homeLoad" : "";
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

function getThinProfilePayload(authUserId, authEmail, options = {}) {
  const includeFavorites = options.includeFavorites === true;
  const includeTeamInvitations = options.includeTeamInvitations === true;
  const includeTeams = includeFavorites || includeTeamInvitations || options.includeTeams === true;
  return {
    authUserId,
    authEmail,
    includeFavorites,
    includeTeamInvitations,
    includeTeams,
    includeExtraProfiles: includeFavorites || includeTeamInvitations,
    includeTeamMemberProfiles: false,
    includeMatchSummary: options.includeMatchSummary !== false && !includeFavorites,
  };
}

async function loadProfileState(authUserId, authEmail, options = {}) {
  try {
    const payload = options.thin === true
      ? getThinProfilePayload(authUserId, authEmail, options)
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
  const homeLoadError = options.endpoint === "homeLoad" ? error || "home_load_empty_response" : "";
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
    ...(homeLoadError ? { homeLoadError } : {}),
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
          scheduleOnly: true,
          includeRecentCompleted: false,
          includeClosedNotices: true,
          includeCancelledSchedule: true,
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
    if (options.endpoint === "playMatches") {
      const result = await postServerAction(
        "/api/matches/list",
        {
          authUserId,
          authEmail,
          limit: loadOptions.matchLimit,
          listOnly: false,
          playOnly: true,
          adminContext: false,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { matchPage: result.page ?? null, playMatchListReady: true });
    }
    if (options.endpoint === "profileRecords") {
      const result = await postServerAction(
        "/api/records/list",
        {
          authUserId,
          authEmail,
          scope: "profile",
          detailLimit: options.matchLimit ?? REMOTE_CLIENT_RECORD_MATCH_LIMIT,
          archiveLimit: REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT,
        },
        { allowWhenDisabled: true },
      );
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), {
        profileRecordsLoaded: true,
        profileRecordArchive: {
          personalSummary: result.personalSummary ?? null,
          rows: result.archiveRecords ?? [],
          page: result.page ?? EMPTY_RECORD_ARCHIVE.page,
          windows: result.windows ?? EMPTY_RECORD_ARCHIVE.windows,
          loaded: true,
          loading: false,
          error: "",
        },
      });
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
      if (result?.state) return attachRemoteMeta(normalizeServerState(result.state), { profileRecordsLoaded: false });
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
        homeLoadError: "",
        homeSectionErrors: result.sectionErrors ?? {},
      });
    }
    if (options.endpoint) {
      return attachRemoteMeta(await loadProfileState(authUserId, authEmail, {
        thin: true,
        includeFavorites: options.endpoint === "homeLoad",
        includeTeams: options.endpoint === "homeLoad",
      }), getEndpointFallbackMeta(options));
    }
  } catch (error) {
    console.warn("Server state load failed. Falling back to profile-only state.", error.message);
    fallbackErrorMessage = error.message ?? "state_load_failed";
  }
  if (options.endpoint) {
    return attachRemoteMeta(await loadProfileState(authUserId, authEmail, {
      thin: true,
      includeFavorites: options.endpoint === "homeLoad",
      includeTeams: options.endpoint === "homeLoad",
    }), getEndpointFallbackMeta(options, fallbackErrorMessage));
  }
  return attachRemoteMeta(await loadProfileState(authUserId, authEmail, { thin: true }), {
    matchPage: { exhausted: true, recruitingScheduleChecked: true },
    recruitingPage: { exhausted: true, feedCounts: null },
    directoryLoaded: false,
    profileRecordsLoaded: false,
  });
}

function hasHomeLoadFailure(state = null) {
  const meta = getRemoteMeta(state);
  return Boolean(
    meta.homeLoadError
    || Object.keys(meta.homeSectionErrors ?? {}).length,
  );
}

function getHomeLoadFailureCount(state = null) {
  const meta = getRemoteMeta(state);
  return Number(Boolean(meta.homeLoadError)) + Object.keys(meta.homeSectionErrors ?? {}).length;
}

async function loadBackendStateWithHomeRetry(authUserId, authEmail, options = getInitialStateLoadOptions()) {
  const firstResult = await loadBackendState(authUserId, authEmail, options);
  if (options.endpoint !== "homeLoad" || !hasHomeLoadFailure(firstResult)) return firstResult;
  const retryResult = await loadBackendState(authUserId, authEmail, options);
  return getHomeLoadFailureCount(retryResult) < getHomeLoadFailureCount(firstResult)
    ? retryResult
    : firstResult;
}

export {
  cacheCurrentProfileState,
  ensureLocalDemoInitialState,
  getCachedBootstrapState,
  getHomeRouteLoadKey,
  getInitialStateLoadOptions,
  loadBackendStateWithHomeRetry,
  loadProfileState,
};
