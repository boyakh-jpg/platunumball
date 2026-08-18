export const EXTERNAL_NOTIFICATION_MODES = Object.freeze({
  push: "push",
  discord: "discord",
  both: "both",
  none: "none",
});

export const NOTIFICATION_CATEGORIES = Object.freeze({
  game: "game",
  recruiting: "recruiting",
  team: "team",
  record: "record",
  service: "service",
});

export const DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES = Object.freeze({
  mode: EXTERNAL_NOTIFICATION_MODES.none,
  gameRecruiting: true,
  team: true,
  recordTier: true,
  service: false,
});

const ALLOWED_MODES = new Set(Object.values(EXTERNAL_NOTIFICATION_MODES));

export function normalizeNotificationDeliveryPreferences(value = {}) {
  const mode = ALLOWED_MODES.has(value?.mode)
    ? value.mode
    : DEFAULT_NOTIFICATION_DELIVERY_PREFERENCES.mode;
  return {
    mode,
    gameRecruiting: value?.gameRecruiting !== false,
    team: value?.team !== false,
    recordTier: value?.recordTier !== false,
    service: value?.service === true,
  };
}

export function getNotificationCategory(notification = {}) {
  const type = String(notification.type ?? notification.discordEvent ?? "").toLowerCase();
  if (notification.recruitingPostId) {
    return NOTIFICATION_CATEGORIES.recruiting;
  }
  if (/(team|tournament|member|roster)/.test(type)) {
    return NOTIFICATION_CATEGORIES.team;
  }
  if (/(recruit|application|invite|candidate|reserve)/.test(type)) {
    return NOTIFICATION_CATEGORIES.recruiting;
  }
  if (/(record|tier|mmr|rank|stat|dispute|objection)/.test(type)) {
    return NOTIFICATION_CATEGORIES.record;
  }
  if (notification.matchId || /(match|game|score|referee|attendance|confirm)/.test(type)) {
    return NOTIFICATION_CATEGORIES.game;
  }
  return NOTIFICATION_CATEGORIES.service;
}

export function isNotificationCategoryEnabled(preferences, category) {
  const normalized = normalizeNotificationDeliveryPreferences(preferences);
  if (category === NOTIFICATION_CATEGORIES.game || category === NOTIFICATION_CATEGORIES.recruiting) {
    return normalized.gameRecruiting;
  }
  if (category === NOTIFICATION_CATEGORIES.team) return normalized.team;
  if (category === NOTIFICATION_CATEGORIES.record) return normalized.recordTier;
  return normalized.service;
}

export function isExternalChannelEnabled(preferences, channel) {
  const mode = normalizeNotificationDeliveryPreferences(preferences).mode;
  return mode === EXTERNAL_NOTIFICATION_MODES.both || mode === channel;
}

export function normalizeSafeAppPath(value, fallback = "/app/notifications") {
  const path = String(value ?? "").trim();
  if (!/^\/app(?:\/|$)/.test(path) || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) {
    return fallback;
  }
  try {
    const url = new URL(path, "https://boxtier.invalid");
    if (url.origin !== "https://boxtier.invalid" || !/^\/app(?:\/|$)/.test(url.pathname)) return fallback;
    if (url.pathname.startsWith("/app/auth/") || url.pathname === "/app/login") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function createMinimalPushPayload(notification = {}, targetPath) {
  const id = String(notification.id ?? "");
  return {
    id,
    type: String(notification.type ?? "notification").slice(0, 80),
    title: String(notification.title ?? "BOXTIER 알림").slice(0, 80),
    body: String(notification.body ?? "새 알림이 있습니다.").slice(0, 160),
    path: normalizeSafeAppPath(targetPath),
    tag: String(notification.tag ?? `boxtier-${id || "notification"}`).slice(0, 120),
    timestamp: String(notification.timestamp ?? notification.createdAt ?? new Date().toISOString()),
  };
}

export function normalizeKakaoOpenProfileUrl(value) {
  const input = String(value ?? "").trim();
  if (!input) return "";
  if (input.length > 200) return "";
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:"
      || url.hostname !== "open.kakao.com"
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
    ) return "";
    if (!/^\/o\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return "";
    return `https://open.kakao.com${url.pathname}`.replace(/\/$/, "");
  } catch {
    return "";
  }
}
