import { DEFAULT_RATING } from "../../lib/constants.js";
import { MAX_TEAM_MEMBERS } from "../../lib/constants.js";
import { MAX_TEAM_MEMBERSHIPS } from "../../lib/constants.js";
import { MAX_TEAM_NAME_LENGTH } from "../../lib/constants.js";
import { canChangeProfileName, normalizeProfileName } from "../../lib/profileSetup.js";
import { findDiscordConnectionOwner } from "../../lib/discord.js";
import { getDiscordConnectionUserId } from "../../lib/discord.js";
import { getProfileRegionSnapshot } from "../profileMappers.js";
import { getUserIdentityHashtag } from "../profileMappers.js";
import { isNotificationDue } from "../../lib/notifications.js";
import { makeId } from "../rowUtils.js";
import { normalizeTeamInviteRole } from "../teamMappers.js";
import { sameHashtag } from "../../lib/handles.js";
import { toHashtag } from "../../lib/handles.js";
import { getDisciplineBlockedState } from "./guards.js";

function getTeamManagementPermissionDeniedState(state) {
  return {
    ...state,
    notifications: [
      {
        id: makeId("n"),
        title: "팀 관리 권한 없음",
        body: "팀장만 팀원을 관리할 수 있습니다.",
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

export function markNotificationRead(state, notificationId) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) =>
      notification.id === notificationId ? { ...notification, readAt: notification.readAt ?? readAt } : notification,
    ),
  };
}

export function markAllNotificationsRead(state) {
  const readAt = new Date().toISOString();
  return {
    ...state,
    notifications: state.notifications.map((notification) => {
      const targetUserId = notification.targetUserId ?? notification.userId ?? "";
      if (notification.readAt || !isNotificationDue(notification) || (targetUserId && targetUserId !== state.currentUserId)) {
        return notification;
      }
      return { ...notification, readAt };
    }),
  };
}

export function deleteNotification(state, notificationId) {
  if (!notificationId) return state;
  return {
    ...state,
    notifications: state.notifications.filter((notification) => notification.id !== notificationId),
  };
}

export function updateProfile(state, patch, targetUserId = state.currentUserId) {
  const profileUserId = targetUserId || state.currentUserId;
  if (patch.discordConnection?.status === "linked" && findDiscordConnectionOwner(state.users, patch.discordConnection, profileUserId)) {
    return state;
  }
  const currentUser = state.users.find((user) => user.id === profileUserId);
  if (!currentUser) return state;
  const nextHandle = patch.handle ?? patch.hashtag;
  if (
    nextHandle &&
    (!currentUser.handleLockedAt || sameHashtag(nextHandle, getUserIdentityHashtag(currentUser))) &&
    state.users.some((user) => user.id !== profileUserId && sameHashtag(nextHandle, getUserIdentityHashtag(user)))
  ) {
    return state;
  }
  const profilePatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(profilePatch, "name")) {
    const name = normalizeProfileName(profilePatch.name);
    if (!name) return state;
    profilePatch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(profilePatch, "discordConnection")) {
    profilePatch.discordUserId = getDiscordConnectionUserId(profilePatch.discordConnection) || null;
  }
  const requestedHashtag = profilePatch.handle ?? profilePatch.hashtag;
  if ((currentUser.handleLockedAt || currentUser.hashtagLockedAt) && requestedHashtag && !sameHashtag(requestedHashtag, getUserIdentityHashtag(currentUser))) {
    delete profilePatch.handle;
    delete profilePatch.hashtag;
  }
  const currentBirthYearLocked = Boolean(currentUser.birthYearLockedAt && currentUser.birthYear);
  if (currentBirthYearLocked && profilePatch.birthYear && Number(profilePatch.birthYear) !== Number(currentUser.birthYear)) {
    delete profilePatch.birthYear;
  }
  if (profilePatch.handle || profilePatch.hashtag) {
    const hashtag = toHashtag(profilePatch.hashtag ?? profilePatch.handle, currentUser.id);
    profilePatch.handle = hashtag;
    profilePatch.hashtag = hashtag;
    profilePatch.handleLockedAt = currentUser.handleLockedAt ?? profilePatch.handleLockedAt ?? new Date().toISOString();
  }
  if (
    Object.prototype.hasOwnProperty.call(profilePatch, "regionSido") ||
    Object.prototype.hasOwnProperty.call(profilePatch, "regionDistrict") ||
    Object.prototype.hasOwnProperty.call(profilePatch, "region")
  ) {
    profilePatch.region = getProfileRegionSnapshot(
      profilePatch.regionSido ?? currentUser.regionSido,
      profilePatch.regionDistrict ?? currentUser.regionDistrict,
      profilePatch.region ?? currentUser.region,
    );
  }
  if (profilePatch.birthYear && !currentBirthYearLocked) {
    profilePatch.birthYearLockedAt = profilePatch.birthYearLockedAt ?? new Date().toISOString();
  }
  if (profilePatch.name && profilePatch.name !== currentUser.name) {
    if (!canChangeProfileName(currentUser)) delete profilePatch.name;
    else profilePatch.nameUpdatedAt = profilePatch.nameUpdatedAt ?? new Date().toISOString();
  }
  return {
    ...state,
    users: state.users.map((user) => (user.id === profileUserId ? { ...user, ...profilePatch } : user)),
  };
}

export function createTeam(state, teamDraft) {
  const disciplineBlock = getDisciplineBlockedState(state, "팀 생성");
  if (disciplineBlock) return disciplineBlock;
  const teamName = String(teamDraft.name ?? "").trim().replace(/\s+/g, " ");
  if (!teamName || teamName.length > MAX_TEAM_NAME_LENGTH) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀명 확인",
          body: `팀명은 ${MAX_TEAM_NAME_LENGTH}자 이하로 입력해야 합니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const captainId = state.currentUserId;
  const captainTeamCount = state.teams.filter((team) => team.members.some((member) => member.userId === captainId)).length;
  if (captainTeamCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 생성 제한",
          body: `가입할 수 있는 팀은 최대 ${MAX_TEAM_MEMBERSHIPS}개입니다.`,
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  const team = {
    id: makeId("t"),
    name: teamName,
    homeCourt: teamDraft.homeCourt,
    homeCourtId: teamDraft.homeCourtId,
    region: teamDraft.region,
    mmr: DEFAULT_RATING,
    wins: 0,
    losses: 0,
    accent: teamDraft.accent || "#58d2c0",
    members: [{ userId: captainId, role: "captain" }],
  };

  return {
    ...state,
    teams: [team, ...state.teams],
    notifications: [{ id: makeId("n"), title: "팀 생성", body: `${team.name} 팀이 등록됐습니다.`, tone: "team" }, ...state.notifications],
  };
}

export function deleteTeam(state, teamId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return state;

  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀 삭제 권한 없음",
          body: "팀장만 팀을 삭제할 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }

  return {
    ...state,
    deletedTeamIds: Array.from(new Set([...(state.deletedTeamIds ?? []), teamId])),
    teams: state.teams.filter((item) => item.id !== teamId),
    settings: {
      ...state.settings,
      favoriteTeamIds: (state.settings?.favoriteTeamIds ?? []).filter((id) => id !== teamId),
    },
    recruitingPosts: (state.recruitingPosts ?? []).map((post) => (
      post.teamId === teamId ? { ...post, teamId: null, status: "closed" } : post
    )),
    notifications: [
      {
        id: makeId("n"),
        title: "팀 삭제",
        body: `${team.name} 팀을 삭제했습니다. 기존 경기 기록은 유지됩니다.`,
        tone: "team",
      },
      ...state.notifications,
    ],
  };
}

function expirePendingTeamInvitations(teamInvitations = [], teamId, updatedAt) {
  return (teamInvitations ?? []).map((invitation) => (
    invitation.teamId === teamId && invitation.status === "pending"
      ? { ...invitation, status: "expired", updatedAt }
      : invitation
  ));
}

function getTeamInvitation(state, invitationId) {
  return (state.teamInvitations ?? []).find((invitation) => invitation.id === invitationId) ?? null;
}

export function inviteTeamMember(state, teamId, targetUserId, role = "regular") {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team || !targetUserId || team.members.some((member) => member.userId === targetUserId)) return state;
  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "팀 초대 권한 없음", body: "팀장만 팀원을 초대할 수 있습니다.", tone: "team" },
        ...state.notifications,
      ],
    };
  }
  if (team.members.length >= MAX_TEAM_MEMBERS) {
    return {
      ...state,
      teamInvitations: expirePendingTeamInvitations(state.teamInvitations, teamId, new Date().toISOString()),
      notifications: [
        { id: makeId("n"), title: "팀 초대 제한", body: `팀원은 최대 ${MAX_TEAM_MEMBERS}명까지 등록할 수 있습니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const membershipCount = state.teams.filter((item) => item.members.some((member) => member.userId === targetUserId)).length;
  if (membershipCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "팀 초대 제한", body: `상대가 이미 팀 한도 ${MAX_TEAM_MEMBERSHIPS}/${MAX_TEAM_MEMBERSHIPS}에 도달했습니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const existingPending = (state.teamInvitations ?? []).some((invitation) => (
    invitation.teamId === teamId &&
    invitation.targetUserId === targetUserId &&
    invitation.status === "pending"
  ));
  if (existingPending) {
    return {
      ...state,
      notifications: [
        { id: makeId("n"), title: "팀 초대 대기 중", body: "이미 보낸 팀 초대가 대기 중입니다.", tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const now = new Date().toISOString();
  const safeRole = normalizeTeamInviteRole(role);
  const invitation = {
    id: makeId("ti"),
    teamId,
    fromUserId: state.currentUserId,
    targetUserId,
    role: safeRole,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  return {
    ...state,
    teamInvitations: [invitation, ...(state.teamInvitations ?? [])],
    notifications: [
      {
        id: makeId("n"),
        title: "팀 초대",
        body: `${team.name} 팀 초대가 도착했습니다.`,
        tone: "team",
        type: "team_invite",
        teamId,
        teamInvitationId: invitation.id,
        targetUserId,
        fromUserId: state.currentUserId,
        createdAt: now,
        updatedAt: now,
      },
      ...state.notifications,
    ],
  };
}

export function acceptTeamInvitation(state, invitationId) {
  const invitation = getTeamInvitation(state, invitationId);
  if (!invitation || invitation.status !== "pending" || invitation.targetUserId !== state.currentUserId) return state;
  const team = state.teams.find((item) => item.id === invitation.teamId);
  if (!team || team.members.some((member) => member.userId === state.currentUserId)) return state;
  const now = new Date().toISOString();
  if (team.members.length >= MAX_TEAM_MEMBERS) {
    return {
      ...state,
      teamInvitations: expirePendingTeamInvitations(state.teamInvitations, team.id, now),
      notifications: [
        { id: makeId("n"), title: "팀 초대 만료", body: `${team.name} 팀 정원이 가득 찼습니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const membershipCount = state.teams.filter((item) => item.members.some((member) => member.userId === state.currentUserId)).length;
  if (membershipCount >= MAX_TEAM_MEMBERSHIPS) {
    return {
      ...state,
      teamInvitations: (state.teamInvitations ?? []).map((item) => item.id === invitationId ? { ...item, status: "expired", updatedAt: now } : item),
      notifications: [
        { id: makeId("n"), title: "팀 가입 제한", body: `가입할 수 있는 팀은 최대 ${MAX_TEAM_MEMBERSHIPS}개입니다.`, tone: "team" },
        ...state.notifications,
      ],
    };
  }
  const nextMemberCount = team.members.length + 1;
  const nextInvitations = (state.teamInvitations ?? []).map((item) => (
    item.id === invitationId ? { ...item, status: "accepted", updatedAt: now } : item
  ));
  return {
    ...state,
    teams: state.teams.map((item) => (
      item.id === team.id ? { ...item, members: [...item.members, { userId: state.currentUserId, role: normalizeTeamInviteRole(invitation.role) }] } : item
    )),
    teamInvitations: nextMemberCount >= MAX_TEAM_MEMBERS ? expirePendingTeamInvitations(nextInvitations, team.id, now) : nextInvitations,
    notifications: [
      { id: makeId("n"), title: "팀 가입 완료", body: `${team.name} 팀에 가입했습니다.`, tone: "team", teamId: team.id, createdAt: now, updatedAt: now },
      ...state.notifications,
    ],
  };
}

export function declineTeamInvitation(state, invitationId) {
  const invitation = getTeamInvitation(state, invitationId);
  if (!invitation || invitation.status !== "pending" || invitation.targetUserId !== state.currentUserId) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    teamInvitations: (state.teamInvitations ?? []).map((item) => item.id === invitationId ? { ...item, status: "declined", updatedAt: now } : item),
  };
}

export function cancelTeamInvitation(state, invitationId) {
  const invitation = getTeamInvitation(state, invitationId);
  if (!invitation || invitation.status !== "pending") return state;
  const team = state.teams.find((item) => item.id === invitation.teamId);
  const captain = team?.members.find((member) => member.role === "captain");
  if (invitation.fromUserId !== state.currentUserId && captain?.userId !== state.currentUserId) return state;
  const now = new Date().toISOString();
  return {
    ...state,
    teamInvitations: (state.teamInvitations ?? []).map((item) => item.id === invitationId ? { ...item, status: "cancelled", updatedAt: now } : item),
  };
}

export function updateTeamMemberRole(state, teamId, userId, role) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return state;
  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) return getTeamManagementPermissionDeniedState(state);
  if (role === "captain" || userId === captain.userId) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀장 변경 제한",
          body: "팀장 이전은 별도 기능이 생길 때까지 지원하지 않습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      return {
        ...team,
        members: team.members.map((member) => (
          member.userId === userId ? { ...member, role: normalizeTeamInviteRole(role) } : member
        )),
      };
    }),
  };
}

export function removeTeamMember(state, teamId, userId) {
  const team = state.teams.find((item) => item.id === teamId);
  if (!team) return state;
  const captain = team.members.find((member) => member.role === "captain");
  if (captain?.userId !== state.currentUserId) return getTeamManagementPermissionDeniedState(state);
  if (userId === captain.userId || team.members.length <= 1) {
    return {
      ...state,
      notifications: [
        {
          id: makeId("n"),
          title: "팀장 제외 제한",
          body: "팀장은 팀 삭제 또는 별도 이전 기능으로만 변경할 수 있습니다.",
          tone: "team",
        },
        ...state.notifications,
      ],
    };
  }
  return {
    ...state,
    teams: state.teams.map((team) => {
      if (team.id !== teamId) return team;
      return {
        ...team,
        members: team.members.filter((member) => member.userId !== userId),
      };
    }),
  };
}
