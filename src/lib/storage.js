import { STORAGE_KEY } from "./constants.js";

const PROFILE_BINDINGS_KEY = "rankball.auth.profile.v1";

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
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

export function clearProfileBinding(authUserId) {
  if (typeof window === "undefined" || !authUserId) return;
  const bindings = readProfileBindings();
  delete bindings[authUserId];
  writeProfileBindings(bindings);
}
