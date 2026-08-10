import { mergeMatchesById, mergeRemoteById, mergeTeamsById } from "./entities.js";
import { filterBlockedIncomingInvitations, filterBlockedIncomingNotifications, mergeRemoteMatchPage } from "./pages.js";

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
function getRemoteDirectorySettings(settings = null, options = {}) {
  const {
    includeTheme = false,
    includeDirectorySettings = false,
    includeFavoriteSettings = false,
    preserveFavoriteSettings = false,
    preserveUserSettings = false,
  } = options;
  if (!settings) return null;
  const settingsPatch = {};
  if (includeTheme && (settings.theme === "light" || settings.theme === "dark")) settingsPatch.theme = settings.theme;
  if (!preserveUserSettings && settings.privacy && typeof settings.privacy === "object" && !Array.isArray(settings.privacy)) settingsPatch.privacy = settings.privacy;
  if (!preserveUserSettings && settings.notificationChannels && typeof settings.notificationChannels === "object" && !Array.isArray(settings.notificationChannels)) {
    settingsPatch.notificationChannels = settings.notificationChannels;
  }
  if (includeDirectorySettings && !preserveUserSettings) {
    DIRECTORY_SETTING_ARRAY_KEYS.forEach((key) => {
      if (Array.isArray(settings[key])) settingsPatch[key] = settings[key];
    });
  }
  if (includeFavoriteSettings && !preserveFavoriteSettings) {
    DIRECTORY_FAVORITE_SETTING_KEYS.forEach((key) => {
      if (Array.isArray(settings[key])) settingsPatch[key] = settings[key];
    });
  }
  return Object.keys(settingsPatch).length ? settingsPatch : null;
}
export function mergeRemoteDirectory(state, remoteState = {}, options = {}) {
  const settingsPatch = getRemoteDirectorySettings(remoteState.settings, options);
  const includeDirectorySettings = options.includeDirectorySettings === true;
  const append = options.append === true;
  const replaceAffiliations = options.replaceAffiliations === true;
  const visibleTeamInvitations = filterBlockedIncomingInvitations(remoteState.teamInvitations ?? [], state);
  const currentUser = (state.users ?? []).find((user) => user.id === state.currentUserId);
  const remoteUsers = options.preserveCurrentUserProfile
    ? (remoteState.users ?? []).filter((user) => (
      user.id !== state.currentUserId && (!currentUser?.authUserId || user.authUserId !== currentUser.authUserId)
    ))
    : remoteState.users;
  return {
    ...state,
    users: mergeRemoteById(state.users, remoteUsers),
    teams: mergeTeamsById(state.teams, remoteState.teams),
    teamInvitations: mergeRemoteById(state.teamInvitations, visibleTeamInvitations),
    affiliations: replaceAffiliations && Array.isArray(remoteState.affiliations)
      ? remoteState.affiliations
      : remoteState.affiliations?.length
        ? (append ? mergeRemoteById(state.affiliations, remoteState.affiliations) : remoteState.affiliations)
        : state.affiliations,
    seasons: remoteState.seasons?.length ? remoteState.seasons : state.seasons,
    reports: includeDirectorySettings && Array.isArray(remoteState.reports) ? mergeRemoteById(state.reports, remoteState.reports) : state.reports,
    settings: settingsPatch ? { ...state.settings, ...settingsPatch } : state.settings,
  };
}
export function mergeRemoteProfileState(state, remoteState = {}) {
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
export function mergeRemoteHomeState(state, remoteState = {}) {
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
export function mergeRemoteTournamentState(state, remoteState = {}) {
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
export function mergeRemoteAdminState(state, remoteState = {}, options = {}) {
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
