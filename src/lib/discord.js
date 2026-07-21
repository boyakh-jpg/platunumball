import { getNotificationActorId, getNotificationTargetPath, isNotificationDue } from "./notifications.js";
import { DISCORD_OAUTH_STATE_TTL_MS, getDiscordInviteCustomId } from "./discordProtocol.js";

export const DISCORD_NOTIFICATION_EVENTS = [
  { id: "match", label: "초대/경기" },
  { id: "approval", label: "승인/이의" },
  { id: "report", label: "신고 결과" },
];

const DISCORD_EVENT_IDS = new Set(DISCORD_NOTIFICATION_EVENTS.map((event) => event.id));
const DISCORD_OAUTH_STATE_STORAGE_KEY = "rankball_discord_oauth_state";

export function getDiscordChannel(settings = {}) {
  const discord = settings.notificationChannels?.discord ?? {};
  return {
    enabled: Boolean(discord.enabled),
    events: {
      match: true,
      approval: true,
      report: true,
      ...(discord.events ?? {}),
    },
  };
}

function getDiscordConnection(user = {}) {
  return user?.discordConnection ?? null;
}

export function getDiscordConnectionUserId(connection = {}) {
  return String(connection?.userId ?? "").trim();
}

export function isDiscordLinked(user = {}) {
  const connection = getDiscordConnection(user);
  return Boolean(connection?.status === "linked" && getDiscordConnectionUserId(connection));
}

export function findDiscordConnectionOwner(users = [], connection = {}, exceptUserId = "") {
  const discordUserId = getDiscordConnectionUserId(connection);
  if (!discordUserId) return null;
  return (
    users.find((user) => {
      if (!user || String(user.id) === String(exceptUserId)) return false;
      const userConnection = getDiscordConnection(user);
      return userConnection?.status === "linked" && getDiscordConnectionUserId(userConnection) === discordUserId;
    }) ?? null
  );
}

export function getDiscordDisplayName(user = {}) {
  const connection = getDiscordConnection(user);
  return connection?.username || connection?.globalName || connection?.userId || "";
}

function getDiscordAvatarUrl(user = {}) {
  const connection = getDiscordConnection(user);
  return isDiscordLinked(user) ? connection?.avatarUrl || "" : "";
}

export function getDiscordProfileUrl(user = {}) {
  const connection = getDiscordConnection(user);
  if (!isDiscordLinked(user)) return "";
  return `https://discord.com/users/${encodeURIComponent(connection.userId)}`;
}

export function getDiscordAvatarClassName(user = {}, className = "avatar") {
  return [className, getDiscordAvatarUrl(user) ? "image-avatar" : ""].filter(Boolean).join(" ");
}

export function getDiscordAvatarStyle(user = {}) {
  const avatarUrl = getDiscordAvatarUrl(user);
  return avatarUrl
    ? { "--avatar": user?.avatarColor, backgroundImage: `url("${avatarUrl}")` }
    : { "--avatar": user?.avatarColor };
}

function getRandomToken() {
  if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
    const values = new Uint32Array(4);
    window.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(36)).join("");
  }
  return Math.random().toString(36).slice(2);
}

function createDiscordOAuthState(userId = "") {
  const state = `${userId}.${Date.now().toString(36)}.${getRandomToken()}`;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(
      DISCORD_OAUTH_STATE_STORAGE_KEY,
      JSON.stringify({ state, userId, createdAt: Date.now() }),
    );
  }
  return state;
}

export function getDiscordOAuthStartUrl(userId = "") {
  const state = createDiscordOAuthState(userId);
  return `/api/auth/discord/start?state=${encodeURIComponent(state)}`;
}

function decodeBase64UrlJson(value) {
  const normalized = String(value ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(window.atob(padded));
}

function getAppUserIdFromOAuthState(state = "") {
  return String(state).split(".")[0] || "";
}

export function consumeDiscordOAuthResult(userId = "") {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const status = url.searchParams.get("discord");
  const error = url.searchParams.get("discordError");
  if (!status && !error) return null;

  const state = url.searchParams.get("discordState") ?? "";
  const encodedConnection = url.searchParams.get("discordConnection");
  let stored = null;
  try {
    stored = JSON.parse(window.sessionStorage.getItem(DISCORD_OAUTH_STATE_STORAGE_KEY) ?? "null");
  } catch {
    stored = null;
  }
  window.sessionStorage.removeItem(DISCORD_OAUTH_STATE_STORAGE_KEY);

  url.searchParams.delete("discord");
  url.searchParams.delete("discordState");
  url.searchParams.delete("discordConnection");
  url.searchParams.delete("discordError");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);

  const stateExpired = !stored?.createdAt || Date.now() - stored.createdAt > DISCORD_OAUTH_STATE_TTL_MS;
  if (!stored || stored.state !== state || stateExpired) {
    return { status: "error", error: "state_mismatch" };
  }
  if (error) return { status: "error", error };

  if (!encodedConnection) return { status: "error", error: "missing_connection" };
  try {
    return {
      status: "linked",
      appUserId: stored.userId || getAppUserIdFromOAuthState(state) || userId,
      connection: decodeBase64UrlJson(encodedConnection),
    };
  } catch {
    return { status: "error", error: "invalid_connection" };
  }
}

function getNotificationDiscordEvent(notification = {}) {
  const explicitEvent = notification.discordEvent || notification.eventType || notification.type;
  if (DISCORD_EVENT_IDS.has(explicitEvent)) return explicitEvent;
  if (notification.reportId || notification.tone === "report" || notification.type === "report_action") return "report";
  if (notification.tone === "orange") return "approval";
  return "match";
}

function getAppBaseUrl() {
  const configuredUrl = String(import.meta.env?.VITE_PUBLIC_APP_URL ?? "").trim().replace(/\/$/, "");
  if (configuredUrl) return configuredUrl;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "";
}

function getNotificationWebPath(notification = {}) {
  return getNotificationTargetPath(notification);
}

function getNotificationWebUrl(notification = {}) {
  const webPath = getNotificationWebPath(notification);
  const appBaseUrl = getAppBaseUrl();
  return appBaseUrl ? `${appBaseUrl}${webPath}` : webPath;
}

function getDiscordActionId(action, recruitingPostId, invitationId) {
  return getDiscordInviteCustomId(action, recruitingPostId, invitationId);
}

function getDiscordNotificationActions(notification = {}) {
  if (Array.isArray(notification.discordActions)) return notification.discordActions;
  if (!notification.recruitingPostId || !notification.invitationId) return [];
  return [
    {
      id: "accept",
      label: "수락",
      style: "primary",
      customId: getDiscordActionId("accept", notification.recruitingPostId, notification.invitationId),
    },
    {
      id: "decline",
      label: "거절",
      style: "secondary",
      customId: getDiscordActionId("decline", notification.recruitingPostId, notification.invitationId),
    },
  ];
}

export function syncDiscordNotificationDeliveries(state = {}) {
  const currentUserId = state.currentUserId;
  const notifications = state.notifications ?? [];
  const visibleNotificationKeys = notifications
    .filter((notification) => notification?.id)
    .filter((notification) => !notification.targetUserId || notification.targetUserId === currentUserId)
    .map((notification) => `${currentUserId}:${notification.id}`);
  const seenUsers = new Set(state.discordNotificationSeenUsers ?? []);
  const hasSeenBaseline = seenUsers.has(currentUserId);
  const seenKeys = new Set(state.discordNotificationSeenKeys ?? []);
  const nextSeenKeys = Array.from(new Set([...visibleNotificationKeys, ...seenKeys])).slice(0, 1000);
  const nextSeenUsers = Array.from(new Set([currentUserId, ...seenUsers])).filter(Boolean).slice(0, 100);
  const seenChanged = nextSeenKeys.length !== seenKeys.size;
  if (!hasSeenBaseline) {
    return { ...state, discordNotificationSeenKeys: nextSeenKeys, discordNotificationSeenUsers: nextSeenUsers };
  }
  const channel = getDiscordChannel(state.settings);
  if (!currentUserId || !channel.enabled) {
    return seenChanged ? { ...state, discordNotificationSeenKeys: nextSeenKeys, discordNotificationSeenUsers: nextSeenUsers } : state;
  }

  const targetUser = (state.users ?? []).find((user) => user.id === currentUserId);
  if (!isDiscordLinked(targetUser)) {
    return seenChanged ? { ...state, discordNotificationSeenKeys: nextSeenKeys, discordNotificationSeenUsers: nextSeenUsers } : state;
  }

  const existingDeliveries = state.discordNotificationDeliveries ?? [];
  const queuedNotificationIds = new Set(existingDeliveries.map((delivery) => delivery.notificationId));
  const now = new Date().toISOString();
  const discordUserId = getDiscordConnectionUserId(getDiscordConnection(targetUser));
  const nextDeliveries = notifications
    .filter((notification) => notification?.id && !notification.readAt)
    .filter((notification) => isNotificationDue(notification))
    .filter((notification) => notification.skipDiscordSync !== true)
    .filter((notification) => !queuedNotificationIds.has(notification.id))
    .filter((notification) => !notification.targetUserId || notification.targetUserId === currentUserId)
    .filter((notification) => !seenKeys.has(`${currentUserId}:${notification.id}`))
    .map((notification) => {
      const event = getNotificationDiscordEvent(notification);
      if (!channel.events[event]) return null;
      return {
        id: `discord-${currentUserId}-${notification.id}`,
        notificationId: notification.id,
        targetUserId: currentUserId,
        discordUserId,
        event,
        title: notification.title,
        body: notification.body,
        webPath: getNotificationWebPath(notification),
        webUrl: getNotificationWebUrl(notification),
        actions: getDiscordNotificationActions(notification),
        fromUserId: getNotificationActorId(notification),
        status: "queued",
        queuedAt: now,
      };
    })
    .filter(Boolean);

  if (!nextDeliveries.length && !seenChanged) return state;
  return {
    ...state,
    discordNotificationDeliveries: [...nextDeliveries, ...existingDeliveries],
    discordNotificationSeenKeys: nextSeenKeys,
    discordNotificationSeenUsers: nextSeenUsers,
  };
}
