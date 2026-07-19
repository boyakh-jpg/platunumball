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
    let query = context.supabase
      .from("notifications")
      .update({ read_at: readAt, updated_at: readAt })
      .or(`user_id.eq.${context.profileId},target_user_id.eq.${context.profileId}`);

    if (!body.all) {
      const notificationId = String(body.notificationId || "").trim();
      if (!notificationId) {
        sendJson(response, 400, { error: "missing_notification_id" });
        return;
      }
      query = query.eq("id", notificationId);
    } else {
      query = query.lte("due_at", readAt);
    }

    const { error } = await query;
    if (error) throw error;

    sendJson(response, 200, { ok: true, all: Boolean(body.all), readAt });
  } catch (error) {
    console.error("Notification read failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "notification_read_failed" });
  }
}
