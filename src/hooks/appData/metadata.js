import { findDiscordConnectionOwner } from "../../lib/discord.js";
import { getDiscordConnectionUserId } from "../../lib/discord.js";
import { getClientProfileShellId, isPersistentAuthUserId, isPersistentProfileId } from "./serverOperations.js";

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

  const testLoginId = String(authUserId).startsWith("test-") ? String(authUserId).slice(5) : "";
  const testUser = testLoginId ? users.find((user) => user.testLoginId === testLoginId) : null;
  if (testUser) return testUser.id;
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

export {
  EMPTY_ADMIN_CONTEXT,
  attachRemoteMeta,
  getBoundAuthProfileId,
  getRemoteMeta,
  normalizeAdminContext,
  preserveLocalDiscordState,
  withServerAdminContext,
};
