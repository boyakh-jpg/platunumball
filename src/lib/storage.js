import { STORAGE_KEY } from "./constants.js";

const PROFILE_BINDINGS_KEY = "rankball.auth.profile.v1";
const PROFILE_CACHE_KEY = "rankball.auth.profileCache.v2";
const LEGACY_PROFILE_CACHE_KEYS = ["rankball.auth.profileCache.v1"];
const MAX_LOCAL_STATE_CHARS = 1_800_000;
const PROFILE_CACHE_USER_FIELDS = [
  "id",
  "name",
  "handle",
  "hashtag",
  "position",
  "region",
  "regionSido",
  "regionDistrict",
  "trustScore",
  "avatarColor",
  "avatarKey",
  "avatarSource",
  "avatarIconKey",
  "avatarUpdatedAt",
  "avatarBackgroundEnabled",
  "avatarBorderEnabled",
  "avatarBorderColor",
  "ratings",
];

function pickFields(source = {}, fields = []) {
  return Object.fromEntries(fields
    .filter((field) => Object.prototype.hasOwnProperty.call(source, field))
    .map((field) => [field, source[field]]));
}

export function sanitizeProfileCacheEntry(entry = {}) {
  const user = entry?.user && typeof entry.user === "object"
    ? pickFields(entry.user, PROFILE_CACHE_USER_FIELDS)
    : {};
  const theme = entry?.settings?.theme === "light" ? "light" : "dark";
  return {
    user,
    settings: { theme },
    updatedAt: Number(entry.updatedAt ?? Date.now()),
  };
}

function clearLegacyProfileCaches() {
  if (typeof window === "undefined") return;
  LEGACY_PROFILE_CACHE_KEYS.forEach((key) => window.localStorage.removeItem(key));
}

export function readState(fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeState(state) {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(state);
    if (serialized.length > MAX_LOCAL_STATE_CHARS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch (error) {
    window.localStorage.removeItem(STORAGE_KEY);
    console.warn("BOXTIER local state cache skipped.", error);
  }
}

export function clearState() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function readProfileBindings() {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROFILE_BINDINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeProfileBindings(bindings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PROFILE_BINDINGS_KEY, JSON.stringify(bindings));
}

function readProfileCacheMap() {
  if (typeof window === "undefined") return {};
  try {
    clearLegacyProfileCaches();
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed)
      .map(([authUserId, entry]) => [authUserId, sanitizeProfileCacheEntry(entry)])
      .filter(([, entry]) => entry.user?.id));
  } catch {
    return {};
  }
}

function writeProfileCacheMap(cache) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    window.localStorage.removeItem(PROFILE_CACHE_KEY);
    console.warn("BOXTIER profile cache skipped.", error);
  }
}

export function readProfileCache(authUserId) {
  if (!authUserId) return null;
  const entry = readProfileCacheMap()[authUserId];
  if (!entry || typeof entry !== "object" || !entry.user?.id) {
    writeProfileCacheMap({});
    return null;
  }
  writeProfileCacheMap({ [authUserId]: entry });
  return entry;
}

export function writeProfileCache(authUserId, entry = {}) {
  if (!authUserId || !entry?.user?.id) return;
  readProfileCacheMap();
  writeProfileCacheMap({
    [authUserId]: sanitizeProfileCacheEntry({ ...entry, updatedAt: Date.now() }),
  });
}
