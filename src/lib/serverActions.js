import { isServerActionsEnabled, isSupabaseConfigured, supabase } from "./supabase.js";

const TEST_SESSION_KEY = "rankball.auth.testSession.v1";

function createServerActionError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = { reason: code, ...details };
  return error;
}

export async function getClientActionAccessToken() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
  if (accessToken) return accessToken;

  if (typeof window === "undefined") return "";
  try {
    const testSession = JSON.parse(window.localStorage.getItem(TEST_SESSION_KEY) || "null");
    return typeof testSession?.access_token === "string" ? testSession.access_token : "";
  } catch {
    return "";
  }
}

export async function postServerAction(path, payload = {}, options = {}) {
  if (!isSupabaseConfigured) return false;
  if (!options.allowWhenDisabled && !isServerActionsEnabled) {
    throw createServerActionError("server_actions_disabled", { path });
  }

  const accessToken = await getClientActionAccessToken();
  if (!accessToken) {
    throw createServerActionError("server_action_missing_access_token", { path });
  }

  const response = await fetch(path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const errorCode = body.error || `server_action_failed:${response.status}`;
    const error = new Error(errorCode);
    error.code = errorCode;
    error.statusCode = response.status;
    error.details = body.details ?? null;
    throw error;
  }

  return response.json().catch(() => ({ ok: true }));
}
