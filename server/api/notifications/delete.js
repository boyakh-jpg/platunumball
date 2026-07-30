import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const notificationId = String(body.notificationId || "").trim();
    if (!notificationId || notificationId.length > 200) {
      sendJson(response, 400, { error: "invalid_notification_id" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const { data, error } = await context.supabase
      .from("notifications")
      .delete()
      .eq("id", notificationId)
      .or(`user_id.eq.${context.profileId},target_user_id.eq.${context.profileId}`)
      .select("id");
    if (error) throw error;

    sendJson(response, 200, {
      ok: true,
      notificationId,
      deleted: (data ?? []).some((row) => row.id === notificationId),
    });
  } catch (error) {
    console.error("Notification delete failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "notification_delete_failed" });
  }
}
