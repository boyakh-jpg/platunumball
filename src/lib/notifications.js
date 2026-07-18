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

const TERMINAL_MATCH_STATUSES = new Set(["cancelled", "canceled", "void", "voided", "closed"]);
const TERMINAL_RECRUITING_STATUSES = new Set(["cancelled", "canceled", "closed", "expired"]);

function normalizeStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function getNotificationTargetStatus(notification = {}, options = {}) {
  const explicitStatus = normalizeStatus(notification.targetStatus ?? notification.payload?.targetStatus);
  if (explicitStatus) return explicitStatus;

  if (notification.matchId) {
    const match = (options.matches ?? []).find((item) => item?.id === notification.matchId);
    return normalizeStatus(match?.status);
  }

  if (notification.recruitingPostId) {
    const post = (options.recruitingPosts ?? []).find((item) => item?.id === notification.recruitingPostId);
    return normalizeStatus(post?.status ?? post?.roomState?.status);
  }

  return "";
}

export function isNotificationTargetUnavailable(notification = {}, options = {}) {
  if (notification.targetUnavailable === true || notification.payload?.targetUnavailable === true) return true;
  const targetStatus = getNotificationTargetStatus(notification, options);
  if (!targetStatus) return false;
  return notification.matchId
    ? TERMINAL_MATCH_STATUSES.has(targetStatus)
    : TERMINAL_RECRUITING_STATUSES.has(targetStatus);
}

export function isTerminalRoomNotice(notification = {}) {
  const type = normalizeStatus(notification.type ?? notification.discordEvent);
  const title = String(notification.title ?? "");
  return /(cancel|close|expire|void)/.test(type) || /(취소|무효|만료|종료)/.test(title);
}

export function isNotificationDisplayable(notification = {}, options = {}) {
  return !isNotificationTargetUnavailable(notification, options) || isTerminalRoomNotice(notification);
}

export function getNotificationHref(notification = {}) {
  if (isNotificationTargetUnavailable(notification)) return "/app/notifications";
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
