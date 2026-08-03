import { getNotificationActorId, getNotificationTargetPath, isNotificationDue } from "./notifications.js";
import { DISCORD_OAUTH_STATE_TTL_MS, isDiscordOAuthState } from "./discordProtocol.js";
import { getSafeImageUrl } from "./inputSecurity.js";
import { postServerAction } from "./serverActions.js";

export const DISCORD_NOTIFICATION_EVENTS = [
  { id: "match", label: "초대/경기" },
  { id: "approval", label: "승인/이의" },
  { id: "report", label: "신고 결과" },
];

const DISCORD_EVENT_IDS = new Set(DISCORD_NOTIFICATION_EVENTS.map((event) => event.id));
const DISCORD_OAUTH_STATE_STORAGE_KEY = "rankball_discord_oauth_state";
let discordOAuthResultPromise = null;

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
  return isDiscordLinked(user) ? getSafeImageUrl(connection?.avatarUrl || "") : "";
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

function getSafeDiscordAuthorizeUrl(value = "", expectedState = "") {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.hostname !== "discord.com" || url.pathname !== "/oauth2/authorize") return "";
    return url.searchParams.get("state") === expectedState ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function startDiscordOAuth(userId = "") {
  if (typeof window === "undefined") return "";
  const result = await postServerAction("/api/auth/discord/start", {}, { allowWhenDisabled: true });
  const state = String(result?.state || "");
  const authorizeUrl = getSafeDiscordAuthorizeUrl(result?.authorizeUrl, state);
  if (!isDiscordOAuthState(state) || !authorizeUrl) throw new Error("discord_oauth_start_invalid");
  window.sessionStorage.setItem(
    DISCORD_OAUTH_STATE_STORAGE_KEY,
    JSON.stringify({ state, userId: result?.profileId || userId, createdAt: Date.now() }),
  );
  discordOAuthResultPromise = null;
  window.location.assign(authorizeUrl);
  return authorizeUrl;
}

function clearDiscordOAuthResultUrl(url) {
  url.searchParams.delete("discord");
  url.searchParams.delete("discordState");
  url.searchParams.delete("discordConnection");
  url.searchParams.delete("discordError");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function acknowledgeDiscordOAuthResult() {
  discordOAuthResultPromise = null;
}

export function consumeDiscordOAuthResult(userId = "") {
  if (typeof window === "undefined") return null;
  if (discordOAuthResultPromise) return discordOAuthResultPromise;
  const url = new URL(window.location.href);
  const status = url.searchParams.get("discord");
  const error = url.searchParams.get("discordError");
  if (!status && !error) return null;

  let stored = null;
  try {
    stored = JSON.parse(window.sessionStorage.getItem(DISCORD_OAUTH_STATE_STORAGE_KEY) ?? "null");
  } catch {
    stored = null;
  }
  const stateExpired = !stored?.createdAt || Date.now() - stored.createdAt > DISCORD_OAUTH_STATE_TTL_MS;
  discordOAuthResultPromise = (async () => {
    try {
      if (error) return { status: "error", error };
      if (status !== "pending" || !stored || stateExpired || !isDiscordOAuthState(stored.state)) {
        return { status: "error", error: "state_mismatch" };
      }
      const result = await postServerAction(
        "/api/auth/discord/complete",
        { state: stored.state },
        { allowWhenDisabled: true },
      );
      if (!result?.connection) return { status: "error", error: "missing_connection" };
      return {
        status: "linked",
        appUserId: result.profileId || stored.userId || userId,
        connection: result.connection,
      };
    } catch (completionError) {
      return { status: "error", error: completionError?.code || completionError?.message || "discord_oauth_failed" };
    } finally {
      window.sessionStorage.removeItem(DISCORD_OAUTH_STATE_STORAGE_KEY);
      clearDiscordOAuthResultUrl(url);
    }
  })();
  return discordOAuthResultPromise;
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
        actions: [],
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
