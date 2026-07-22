import { STORAGE_KEY } from "./constants.js";

const PROFILE_BINDINGS_KEY = "rankball.auth.profile.v1";
const PROFILE_CACHE_KEY = "rankball.auth.profileCache.v1";
const MAX_LOCAL_STATE_CHARS = 1_800_000;
const MAX_PROFILE_CACHE_ENTRIES = 8;

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
    const raw = window.localStorage.getItem(PROFILE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
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
  if (!entry || typeof entry !== "object") return null;
  if (!entry.user?.id) return null;
  return entry;
}

export function writeProfileCache(authUserId, entry = {}) {
  if (!authUserId || !entry?.user?.id) return;
  const cache = readProfileCacheMap();
  cache[authUserId] = {
    user: entry.user,
    settings: entry.settings && typeof entry.settings === "object" ? entry.settings : {},
    updatedAt: Date.now(),
  };
  const trimmed = Object.fromEntries(
    Object.entries(cache)
      .sort(([, a], [, b]) => Number(b?.updatedAt ?? 0) - Number(a?.updatedAt ?? 0))
      .slice(0, MAX_PROFILE_CACHE_ENTRIES),
  );
  writeProfileCacheMap(trimmed);
}
