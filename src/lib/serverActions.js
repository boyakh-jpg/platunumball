import { isServerActionsEnabled, isSupabaseConfigured, supabase } from "./supabase.js";

const TEST_SESSION_KEY = "rankball.auth.testSession.v1";

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

export async function postServerAction(path, payload = {}) {
  if (!isServerActionsEnabled || !isSupabaseConfigured) return false;

  const accessToken = await getClientActionAccessToken();
  if (!accessToken) return false;

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
    throw new Error(body.error || `server_action_failed:${response.status}`);
  }

  return response.json().catch(() => ({ ok: true }));
}
