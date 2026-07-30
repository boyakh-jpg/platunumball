import { isServerActionsEnabled, isSupabaseConfigured, supabase } from "./supabase.js";
import { assertSafeInputPayload } from "./inputSecurity.js";

let cachedActionSession = { accessToken: "", expiresAtMs: 0 };

function isFreshSession(session = null) {
  if (!session?.access_token) return false;
  const expiresAtMs = Number(session.expires_at ?? 0) * 1000;
  return !expiresAtMs || expiresAtMs - Date.now() > 30000;
}

export function setClientActionSession(session = null) {
  cachedActionSession = {
    accessToken: session?.access_token ?? "",
    expiresAtMs: Number(session?.expires_at ?? 0) * 1000,
  };
}

function createServerActionError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = { reason: code, ...details };
  return error;
}

async function getSupabaseActionAccessToken({ forceRefresh = false } = {}) {
  if (!isSupabaseConfigured || !supabase) return "";

  if (forceRefresh) {
    const refreshed = await supabase.auth.refreshSession().catch(() => null);
    if (isFreshSession(refreshed?.data?.session)) {
      setClientActionSession(refreshed.data.session);
      return refreshed.data.session.access_token;
    }
  }

  const { data } = await supabase.auth.getSession();
  if (isFreshSession(data?.session)) {
    setClientActionSession(data.session);
    return data.session.access_token;
  }

  const refreshed = await supabase.auth.refreshSession().catch(() => null);
  if (isFreshSession(refreshed?.data?.session)) {
    setClientActionSession(refreshed.data.session);
    return refreshed.data.session.access_token;
  }

  setClientActionSession(null);
  return "";
}

export async function getClientActionAccessToken() {
  if (
    cachedActionSession.accessToken &&
    (!cachedActionSession.expiresAtMs || cachedActionSession.expiresAtMs - Date.now() > 30000)
  ) {
    return cachedActionSession.accessToken;
  }

  // Server actions only use the current Supabase Auth session.
  return getSupabaseActionAccessToken();
}

export async function getServerActionAvailability(path = "") {
  if (!isSupabaseConfigured) return { ok: false, error: "supabase_not_configured", path };
  if (!isServerActionsEnabled) return { ok: false, error: "server_actions_disabled", path };
  const accessToken = await getClientActionAccessToken();
  if (!accessToken) return { ok: false, error: "server_action_missing_access_token", path };
  return { ok: true, accessToken, path };
}

async function requestServerAction(path, payload, accessToken) {
  return fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function readServerActionError(response) {
  const body = await response.json().catch(() => ({}));
  const errorCode = body.error || `server_action_failed:${response.status}`;
  const error = new Error(errorCode);
  error.code = errorCode;
  error.statusCode = response.status;
  error.details = body.details ?? null;
  return error;
}

export async function postServerAction(path, payload = {}, options = {}) {
  try {
    assertSafeInputPayload(payload, { path: "$payload" });
  } catch (error) {
    if (error?.details?.message) error.message = error.details.message;
    throw error;
  }
  if (!isSupabaseConfigured) return false;
  if (!options.allowWhenDisabled && !isServerActionsEnabled) {
    throw createServerActionError("server_actions_disabled", { path });
  }

  const accessToken = await getClientActionAccessToken();
  if (!accessToken) {
    throw createServerActionError("server_action_missing_access_token", { path });
  }

  let response = await requestServerAction(path, payload, accessToken);
  if (response.status === 401) {
    const refreshedAccessToken = await getSupabaseActionAccessToken({ forceRefresh: true });
    if (refreshedAccessToken) {
      response = await requestServerAction(path, payload, refreshedAccessToken);
    }
  }

  if (!response.ok) {
    const error = await readServerActionError(response);
    throw error;
  }

  return response.json().catch(() => ({ ok: true }));
}
