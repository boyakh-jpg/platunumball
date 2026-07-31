import { DEFAULT_SETTINGS } from "../repositoryDefaults.js";
import { FAVORITE_LIMIT } from "../../lib/constants.js";
import { REFEREE_TRUST_MIN } from "../../lib/constants.js";
import { getRegisteredCourts } from "../../lib/courts.js";
import { isEligibleReferee } from "../../lib/matchUtils.js";
import { isNotificationFromBlockedUser } from "../../lib/notifications.js";
import { makeId } from "../rowUtils.js";
import { normalizeStateSettings as normalizeSettings } from "../stateNormalizer.js";
import { toggleId } from "../rowUtils.js";

export function updatePrivacySettings(state, patch) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      privacy: {
        ...(state.settings?.privacy ?? DEFAULT_SETTINGS.privacy),
        ...patch,
      },
    }),
  };
}

export function updateSettings(state, patch) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      ...patch,
    }),
  };
}

export function blockUser(state, userId) {
  if (!userId || userId === state.currentUserId) return state;
  const blockedUserIds = Array.from(new Set([...(state.settings?.blockedUserIds ?? []), userId]));
  const blockedUserIdSet = new Set(blockedUserIds);
  const blockedUser = state.users.find((user) => user.id === userId);
  const isBlockedIncomingInvitation = (invitation = {}) => (
    invitation.targetUserId === state.currentUserId && blockedUserIdSet.has(invitation.fromUserId)
  );
  const visibleRecruitingPosts = (state.recruitingPosts ?? []).map((post) => {
    const roomState = post.roomState ?? {};
    const invitations = (roomState.invitations ?? []).filter((invitation) => !isBlockedIncomingInvitation(invitation));
    return invitations.length === (roomState.invitations ?? []).length
      ? post
      : { ...post, roomState: { ...roomState, invitations } };
  });

  return {
    ...state,
    settings: normalizeSettings({ ...(state.settings ?? {}), blockedUserIds }),
    teamInvitations: (state.teamInvitations ?? []).filter((invitation) => !isBlockedIncomingInvitation(invitation)),
    recruitingPosts: visibleRecruitingPosts,
    notifications: [
      {
        id: makeId("n"),
        title: "플레이어 차단",
        body: `${blockedUser?.name ?? "선택한 플레이어"}가 홈 검색과 추천 목록에서 숨겨집니다.`,
        tone: "team",
      },
      ...(state.notifications ?? []).filter((notification) => !(
        notification.targetUserId === state.currentUserId && isNotificationFromBlockedUser(notification, blockedUserIds)
      )),
    ],
  };
}

export function unblockUser(state, userId) {
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      blockedUserIds: (state.settings?.blockedUserIds ?? []).filter((id) => id !== userId),
    }),
  };
}

export function toggleFavoritePlayer(state, userId) {
  if (!state.users.some((user) => user.id === userId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoritePlayerIds: toggleId(state.settings?.favoritePlayerIds, userId, FAVORITE_LIMIT),
    }),
  };
}

export function toggleFavoriteTeam(state, teamId) {
  if (!state.teams.some((team) => team.id === teamId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteTeamIds: toggleId(state.settings?.favoriteTeamIds, teamId, FAVORITE_LIMIT),
    }),
  };
}

export function toggleFavoriteCourt(state, courtId) {
  if (!getRegisteredCourts(state).some((court) => court.id === courtId)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteCourtIds: toggleId(state.settings?.favoriteCourtIds, courtId, FAVORITE_LIMIT),
    }),
  };
}

export function toggleFavoriteReferee(state, userId) {
  const referee = state.users.find((user) => user.id === userId);
  if (!referee || !isEligibleReferee(referee, REFEREE_TRUST_MIN, state.settings?.refereeAppointments)) return state;
  return {
    ...state,
    settings: normalizeSettings({
      ...(state.settings ?? {}),
      favoriteRefereeIds: toggleId(state.settings?.favoriteRefereeIds, userId, FAVORITE_LIMIT),
    }),
  };
}
