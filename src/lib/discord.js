export const DISCORD_NOTIFICATION_EVENTS = [
  { id: "match", label: "초대/경기" },
  { id: "approval", label: "승인/이의" },
  { id: "report", label: "신고 결과" },
];

const DISCORD_EVENT_IDS = new Set(DISCORD_NOTIFICATION_EVENTS.map((event) => event.id));

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

export function getDiscordConnection(user = {}) {
  return user.discordConnection ?? null;
}

export function isDiscordLinked(user = {}) {
  const connection = getDiscordConnection(user);
  return Boolean(connection?.status === "linked" && connection.userId);
}

export function getDiscordDisplayName(user = {}) {
  const connection = getDiscordConnection(user);
  return connection?.username || connection?.globalName || connection?.userId || "";
}

export function getDiscordAvatarUrl(user = {}) {
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
    ? { "--avatar": user.avatarColor, backgroundImage: `url("${avatarUrl}")` }
    : { "--avatar": user.avatarColor };
}

export function createDemoDiscordConnection(user = {}) {
  const username = String(user.handle || user.name || "rankball").replace(/^@/, "");
  const seed = Math.abs(Number(String(user.id ?? "").replace(/\D/g, "")) || 0) % 5;
  return {
    provider: "discord",
    status: "linked",
    userId: `demo-discord-${user.id}`,
    username,
    avatarUrl: `https://cdn.discordapp.com/embed/avatars/${seed}.png`,
    linkedAt: new Date().toISOString(),
    source: "demo",
  };
}

export function getNotificationDiscordEvent(notification = {}) {
  const explicitEvent = notification.discordEvent || notification.eventType || notification.type;
  if (DISCORD_EVENT_IDS.has(explicitEvent)) return explicitEvent;
  if (notification.reportId || notification.tone === "report" || notification.type === "report_action") return "report";
  if (notification.tone === "orange") return "approval";
  return "match";
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
  const nextDeliveries = notifications
    .filter((notification) => notification?.id && !notification.readAt)
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
        discordUserId: getDiscordConnection(targetUser).userId,
        event,
        title: notification.title,
        body: notification.body,
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
