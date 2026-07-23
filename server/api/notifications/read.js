import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request);
    const readAt = new Date().toISOString();
    const notificationId = String(body.notificationId || "").trim();
    if (!body.all && !notificationId) {
      sendJson(response, 400, { error: "missing_notification_id" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_mark_notifications_read_action", {
      p_profile_id: context.profileId,
      p_notification_id: body.all ? null : notificationId,
      p_all: Boolean(body.all),
      p_read_at: readAt,
    });
    if (error) throw error;
    const result = data && typeof data === "object" ? data : {};
    if (!body.all && Number(result.count ?? 0) === 0) {
      sendJson(response, 404, { error: "notification_not_found" });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      all: Boolean(body.all),
      readAt: result.readAt ?? readAt,
      count: Number(result.count ?? 0),
      notificationIds: Array.isArray(result.notificationIds) ? result.notificationIds : [],
    });
  } catch (error) {
    console.error("Notification read failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "notification_read_failed" });
  }
}
