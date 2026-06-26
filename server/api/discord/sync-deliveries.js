import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

const MAX_DELIVERIES = 100;
const ALLOWED_EVENTS = new Set(["match", "approval", "report"]);

function trimText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function normalizeDeliveries(deliveries) {
  if (!Array.isArray(deliveries)) return [];
  return deliveries
    .filter((delivery) => delivery && typeof delivery === "object" && !Array.isArray(delivery))
    .slice(0, MAX_DELIVERIES);
}

function getDiscordUserId(profile = {}) {
  if (profile.discord_user_id) return String(profile.discord_user_id);
  const connection = profile.discord_connection;
  if (connection && typeof connection === "object" && connection.status === "linked" && connection.userId) {
    return String(connection.userId);
  }
  return "";
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .filter((action) => action && typeof action === "object" && !Array.isArray(action))
    .slice(0, 5)
    .map((action) => ({
      id: trimText(action.id, 40),
      label: trimText(action.label, 80),
      style: action.style === "primary" ? "primary" : "secondary",
      customId: trimText(action.customId, 100),
    }))
    .filter((action) => action.customId);
}

function toDeliveryRow(delivery, profileId, discordUserId) {
  const id = trimText(delivery.id, 160);
  const notificationId = trimText(delivery.notificationId, 160);
  const event = ALLOWED_EVENTS.has(delivery.event) ? delivery.event : "match";
  const queuedAt = delivery.queuedAt || new Date().toISOString();
  if (!id || !notificationId) return null;
  if (delivery.targetUserId && delivery.targetUserId !== profileId) return null;
  if (delivery.status && delivery.status !== "queued") return null;

  const payload = {
    id,
    notificationId,
    targetUserId: profileId,
    discordUserId,
    event,
    title: trimText(delivery.title, 160),
    body: trimText(delivery.body, 1200),
    webPath: trimText(delivery.webPath, 500),
    webUrl: trimText(delivery.webUrl, 500),
    actions: normalizeActions(delivery.actions),
    status: "queued",
    queuedAt,
  };

  return {
    id,
    notification_id: notificationId,
    target_user_id: profileId,
    discord_user_id: discordUserId,
    event,
    status: "queued",
    payload,
    queued_at: queuedAt,
    created_at: queuedAt,
    updated_at: new Date().toISOString(),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const context = await getAuthenticatedContext(request);
    const body = await readJsonBody(request);
    const { data: profile, error: profileError } = await context.supabase
      .from("profiles")
      .select("id, discord_user_id, discord_connection")
      .eq("id", context.profileId)
      .maybeSingle();

    if (profileError) throw profileError;
    const discordUserId = getDiscordUserId(profile);
    if (!discordUserId) {
      sendJson(response, 200, { ok: true, count: 0 });
      return;
    }

    const rows = normalizeDeliveries(body.deliveries)
      .map((delivery) => toDeliveryRow(delivery, context.profileId, discordUserId))
      .filter(Boolean);

    if (!rows.length) {
      sendJson(response, 200, { ok: true, count: 0 });
      return;
    }

    const { error } = await context.supabase
      .from("discord_notification_deliveries")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });

    if (error) throw error;

    sendJson(response, 200, { ok: true, count: rows.length });
  } catch (error) {
    console.error("Discord delivery sync failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "discord_delivery_sync_failed" });
  }
}
