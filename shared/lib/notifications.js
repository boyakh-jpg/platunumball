export const CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES = Object.freeze([
  "match-reminder-1h",
  "match-attendance-20m",
  "match-attendance-10m",
  "match-manager-attendance-10m",
]);
export const LEGACY_MATCH_SCHEDULED_NOTICE_PREFIXES = Object.freeze([
  "match-reminder-24h",
  "match-reminder-2h",
  "match-manager-checkin-10m",
  "match-manager-start-5m",
  "match-manager-start-now",
  "match-reminder-2m",
  "match-started",
]);
export const MATCH_SCHEDULED_NOTICE_PREFIXES = Object.freeze([
  ...CURRENT_MATCH_SCHEDULED_NOTICE_PREFIXES,
  ...LEGACY_MATCH_SCHEDULED_NOTICE_PREFIXES,
]);
export const MATCH_ATTENDANCE_READY_NOTICE_PREFIX = "match-attendance-ready";
export const MATCH_POSTGAME_NOTICE_PREFIXES = Object.freeze([
  "match-ended-score",
  "match-dispute-check",
]);
export const MATCH_CANCEL_NOTICE_PREFIXES = Object.freeze([
  ...MATCH_SCHEDULED_NOTICE_PREFIXES,
  MATCH_ATTENDANCE_READY_NOTICE_PREFIX,
  ...MATCH_POSTGAME_NOTICE_PREFIXES,
]);

export function getNotificationDueAt(notification = {}) {
  return notification.sendAt ?? notification.dueAt ?? notification.payload?.sendAt ?? notification.payload?.dueAt ?? "";
}

export function getNotificationDisplayAt(notification = {}) {
  const dueAt = getNotificationDueAt(notification);
  const dueMs = new Date(dueAt).getTime();
  if (dueAt && Number.isFinite(dueMs)) return new Date(dueMs).toISOString();
  return notification.createdAt ?? notification.updatedAt ?? "";
}

export function compareNotificationsNewestFirst(left = {}, right = {}) {
  const leftDisplayMs = new Date(getNotificationDisplayAt(left)).getTime();
  const rightDisplayMs = new Date(getNotificationDisplayAt(right)).getTime();
  if (Number.isFinite(leftDisplayMs) && Number.isFinite(rightDisplayMs) && leftDisplayMs !== rightDisplayMs) {
    return rightDisplayMs - leftDisplayMs;
  }
  return String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""));
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

export const TERMINAL_MATCH_STATUS_VALUES = Object.freeze(["cancelled", "canceled", "void", "voided", "closed"]);
export const TERMINAL_RECRUITING_STATUS_VALUES = Object.freeze(["cancelled", "canceled", "closed", "expired"]);
const TERMINAL_MATCH_STATUSES = new Set(TERMINAL_MATCH_STATUS_VALUES);
const TERMINAL_RECRUITING_STATUSES = new Set(TERMINAL_RECRUITING_STATUS_VALUES);

function normalizeStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isTerminalMatchStatus(value = "") {
  return TERMINAL_MATCH_STATUSES.has(normalizeStatus(value));
}

export function isTerminalRecruitingStatus(value = "") {
  return TERMINAL_RECRUITING_STATUSES.has(normalizeStatus(value));
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
    ? isTerminalMatchStatus(targetStatus)
    : isTerminalRecruitingStatus(targetStatus);
}

export function isTerminalRoomNotice(notification = {}) {
  const type = normalizeStatus(notification.type ?? notification.discordEvent);
  const title = String(notification.title ?? "");
  return /(cancel|close|expire|void)/.test(type) || /(취소|무효|만료|종료)/.test(title);
}

function getTerminalNotificationKind(notification = {}) {
  const source = [
    notification.type,
    notification.discordEvent,
    notification.payload?.action,
    notification.payload?.status,
    notification.title,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/(cancel|canceled|cancelled|취소)/.test(source)) return "cancelled";
  if (/(void|voided|무효)/.test(source)) return "voided";
  if (/(close|closed|expire|expired|만료|종료)/.test(source)) return "closed";
  return "";
}

function getTerminalNotificationKey(notification = {}) {
  const kind = getTerminalNotificationKind(notification);
  const targetId = notification.targetUserId ?? notification.userId ?? "";
  const entityId = notification.matchId ?? notification.recruitingPostId ?? "";
  return kind && targetId && entityId ? `${targetId}:${entityId}:${kind}` : "";
}

function getNotificationCanonicalScore(notification = {}) {
  return Number(Boolean(notification.type)) * 4
    + Number(Boolean(notification.targetUserId)) * 2
    + Number(notification.payload?.skipDiscordSync === true)
    + Number(String(notification.id ?? "").startsWith("notice-"));
}

export function dedupeNotifications(notifications = []) {
  const output = [];
  const indexByKey = new Map();
  (Array.isArray(notifications) ? notifications : []).forEach((notification) => {
    if (!notification?.id) return;
    const key = getTerminalNotificationKey(notification);
    if (!key || !indexByKey.has(key)) {
      if (key) indexByKey.set(key, output.length);
      output.push(notification);
      return;
    }

    const index = indexByKey.get(key);
    const current = output[index];
    const preferred = getNotificationCanonicalScore(notification) > getNotificationCanonicalScore(current)
      ? notification
      : current;
    const other = preferred === notification ? current : notification;
    output[index] = {
      ...preferred,
      readAt: preferred.readAt ?? other.readAt ?? null,
    };
  });
  return output;
}

export function mergeNotificationRefresh(currentNotifications = [], remoteNotifications = [], options = {}) {
  const deletedIds = options.deletedIds instanceof Set
    ? options.deletedIds
    : new Set(options.deletedIds ?? []);
  const currentById = new Map((currentNotifications ?? []).map((notification) => [String(notification.id), notification]));
  return (remoteNotifications ?? [])
    .filter((notification) => !deletedIds.has(String(notification.id)))
    .map((notification) => {
      if (!options.preserveLocalChanges) return notification;
      const current = currentById.get(String(notification.id));
      return current?.readAt ? { ...notification, readAt: current.readAt } : notification;
    });
}

export function isNotificationDisplayable(notification = {}, options = {}) {
  if (notification.payload?.supersededBy) return false;
  return !isNotificationTargetUnavailable(notification, options) || isTerminalRoomNotice(notification);
}

export function getNotificationTargetPath(notification = {}) {
  if (notification.webPath) return notification.webPath;
  if (notification.tournamentId) return `/app/tournaments/${encodeURIComponent(notification.tournamentId)}`;
  if (notification.matchId) return `/app/matches?match=${encodeURIComponent(notification.matchId)}`;
  if (notification.recruitingPostId) return `/app/recruiting?post=${encodeURIComponent(notification.recruitingPostId)}`;
  return "/app/notifications";
}

export function getNotificationHref(notification = {}) {
  if (isNotificationTargetUnavailable(notification) && !isTerminalRoomNotice(notification)) return "/app/notifications";
  return getNotificationTargetPath(notification);
}

export function isHomeActionNotification(notification = {}) {
  if (!notification || notification.readAt) return false;
  if (notification.actionRequired === true || notification.homeAction === true) return true;
  if (!notification.matchId && !notification.recruitingPostId) return false;
  return ["match", "approval", "recruiting", "invite"].includes(notification.discordEvent || notification.type || "");
}
