import { getBlockedUserIds, isNotificationFromBlockedUser } from "./notifications.js";
import {
  normalizeRecruitingPost,
  normalizeRecruitingRoomState,
} from "./recruiting.js";
import { normalizeMatch } from "./matchMappers.js";
import { DEFAULT_SETTINGS, EMPTY_STATE } from "./repositoryDefaults.js";
import { clone } from "./rowUtils.js";
import { normalizeRecruitingSchedules } from "./scheduleUtils.js";
import { normalizeSettings as normalizeSettingsCore } from "./settingsMappers.js";
import {
  mergeDemoDefaultsById,
  normalizeTeam,
  normalizeUser,
} from "./stateMappers.js";
import { normalizeTournament } from "./tournamentMappers.js";

let demoInitialState = null;

export function setDemoInitialState(state = null) {
  demoInitialState = state && typeof state === "object" ? state : null;
}

export function hasDemoInitialState() {
  return Boolean(demoInitialState);
}

export function getDemoInitialState() {
  return demoInitialState ?? EMPTY_STATE;
}

export function normalizeStateSettings(settings = {}, options = {}) {
  const includeDemo = options.includeDemo !== false;
  const demoState = includeDemo ? getDemoInitialState() : EMPTY_STATE;
  const fallbackSettings = includeDemo ? demoState.settings ?? {} : {};
  return normalizeSettingsCore(settings, { fallbackSettings });
}

export function normalizeState(state, options = {}) {
  const includeDemo = options.includeDemo !== false;
  const preserveAuthoritativeMatches = options.preserveAuthoritativeMatches ?? !includeDemo;
  const demoState = includeDemo ? getDemoInitialState() : EMPTY_STATE;
  const baseState = includeDemo ? clone(demoState) : clone(EMPTY_STATE);
  const notifications = state?.notifications?.length ? state.notifications : includeDemo ? demoState.notifications : [];
  const deletedTeamIds = new Set(state?.deletedTeamIds ?? []);
  const recruitingPosts = normalizeRecruitingSchedules(
    includeDemo ? mergeDemoDefaultsById(state?.recruitingPosts, demoState.recruitingPosts ?? []) : state?.recruitingPosts ?? [],
  );
  const currentUserId = state?.currentUserId ?? baseState.currentUserId ?? "";
  const settings = normalizeStateSettings(state?.settings ?? (includeDemo ? demoState.settings : DEFAULT_SETTINGS), { includeDemo });
  const blockedUserIds = getBlockedUserIds(settings);
  const blockedUserIdSet = new Set(blockedUserIds);
  const isBlockedIncomingInvitation = (invitation = {}) => (
    invitation.targetUserId === currentUserId && blockedUserIdSet.has(invitation.fromUserId)
  );
  const visibleRecruitingPosts = recruitingPosts.map(normalizeRecruitingPost).map((post) => {
    const roomState = normalizeRecruitingRoomState(post.roomState ?? {});
    const invitations = roomState.invitations.filter((invitation) => !isBlockedIncomingInvitation(invitation));
    return invitations.length === roomState.invitations.length
      ? post
      : { ...post, roomState: { ...roomState, invitations } };
  });

  return {
    ...baseState,
    ...state,
    deletedTeamIds: Array.from(deletedTeamIds),
    users: (includeDemo ? mergeDemoDefaultsById(state?.users, demoState.users) : state?.users ?? []).map(normalizeUser),
    teams: (includeDemo ? mergeDemoDefaultsById(state?.teams, demoState.teams) : state?.teams ?? [])
      .filter((team) => team && typeof team === "object" && !deletedTeamIds.has(team.id))
      .map(normalizeTeam),
    teamInvitations: (state?.teamInvitations ?? (includeDemo ? demoState.teamInvitations ?? [] : []))
      .filter((invitation) => !isBlockedIncomingInvitation(invitation)),
    affiliations: (includeDemo ? mergeDemoDefaultsById(state?.affiliations, demoState.affiliations) : state?.affiliations ?? []).filter((affiliation) => affiliation.type !== "club"),
    seasons: includeDemo ? mergeDemoDefaultsById(state?.seasons, demoState.seasons ?? []) : state?.seasons ?? [],
    matches: (includeDemo ? mergeDemoDefaultsById(state?.matches, demoState.matches) : state?.matches ?? [])
      .map((match) => normalizeMatch(match, { preserveAuthoritativeLifecycle: preserveAuthoritativeMatches })),
    tournaments: (includeDemo ? mergeDemoDefaultsById(state?.tournaments, demoState.tournaments ?? []) : state?.tournaments ?? []).map(normalizeTournament),
    notifications: notifications
      .map((notification) => ({ readAt: null, ...notification }))
      .filter((notification) => !(
        notification.targetUserId === currentUserId && isNotificationFromBlockedUser(notification, blockedUserIds)
      )),
    discordNotificationDeliveries: state?.discordNotificationDeliveries ?? (includeDemo ? demoState.discordNotificationDeliveries ?? [] : []),
    discordNotificationSeenKeys: state?.discordNotificationSeenKeys ?? (includeDemo ? demoState.discordNotificationSeenKeys ?? [] : []),
    discordNotificationSeenUsers: state?.discordNotificationSeenUsers ?? (includeDemo ? demoState.discordNotificationSeenUsers ?? [] : []),
    settings,
    reports: state?.reports ?? (includeDemo ? demoState.reports ?? [] : []),
    recruitingPosts: visibleRecruitingPosts,
  };
}
