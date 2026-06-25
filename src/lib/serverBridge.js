import { isServerBridgeWriteEnabled, isSupabaseConfigured } from "./supabase.js";
import { getClientActionAccessToken } from "./serverActions.js";

export async function writeServerBridgeRows(table, rows = []) {
  if (!isServerBridgeWriteEnabled || !isSupabaseConfigured || !rows.length) return false;

  const accessToken = await getClientActionAccessToken();
  if (!accessToken) return false;

  const response = await fetch("/api/supabase/bridge", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ table, rows }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `server_bridge_failed:${response.status}`);
  }

  return true;
}
