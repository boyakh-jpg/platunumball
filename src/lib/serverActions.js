import { isServerActionsEnabled, isSupabaseConfigured, supabase } from "./supabase.js";

export async function postServerAction(path, payload = {}) {
  if (!isServerActionsEnabled || !isSupabaseConfigured) return false;

  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;
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
