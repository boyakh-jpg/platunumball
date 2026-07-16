export function getNotificationDueAt(notification = {}) {
  return notification.sendAt ?? notification.dueAt ?? notification.payload?.sendAt ?? notification.payload?.dueAt ?? "";
}

export function isNotificationDue(notification = {}, nowMs = Date.now()) {
  const dueAt = getNotificationDueAt(notification);
  if (!dueAt) return true;
  const dueMs = new Date(dueAt).getTime();
  return Number.isFinite(dueMs) ? dueMs <= nowMs : true;
}

export function getBlockedUserIds(settings = {}) {
  return [...new Set((Array.isArray(settings?.blockedUserIds) ? settings.blockedUserIds : [])
    .map((userId) => String(userId || "").trim())
    .filter(Boolean))];
}

export function getNotificationActorId(notification = {}) {
  const payload = notification?.payload && typeof notification.payload === "object" ? notification.payload : {};
  return String(
    notification.fromUserId ||
    notification.senderId ||
    notification.inviterId ||
    notification.actorId ||
    notification.createdBy ||
    payload.fromUserId ||
    payload.senderId ||
    payload.inviterId ||
    payload.actorId ||
    payload.createdBy ||
    "",
  ).trim();
}

export function isNotificationFromBlockedUser(notification = {}, blockedUserIds = []) {
  const actorId = getNotificationActorId(notification);
  return Boolean(actorId && new Set(blockedUserIds).has(actorId));
}

export function isNotificationVisibleToUser(notification = {}, userId = "", options = {}) {
  if (!notification?.id) return false;
  if (notification.targetUserId && notification.targetUserId !== userId) return false;
  if (isNotificationFromBlockedUser(notification, options.blockedUserIds)) return false;
  return options.includeFuture === true || isNotificationDue(notification, options.nowMs);
}

export function getNotificationHref(notification = {}) {
  if (notification.webPath) return notification.webPath;
  if (notification.tournamentId) return `/app/tournaments/${encodeURIComponent(notification.tournamentId)}`;
  if (notification.matchId) return `/app/matches?match=${encodeURIComponent(notification.matchId)}`;
  if (notification.recruitingPostId) return `/app/recruiting?post=${encodeURIComponent(notification.recruitingPostId)}`;
  return "/app/notifications";
}

export function isHomeActionNotification(notification = {}) {
  if (!notification || notification.readAt) return false;
  if (notification.actionRequired === true || notification.homeAction === true) return true;
  if (!notification.matchId && !notification.recruitingPostId) return false;
  return ["match", "approval", "recruiting", "invite"].includes(notification.discordEvent || notification.type || "");
}
