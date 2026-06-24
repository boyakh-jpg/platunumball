import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const reportId = String(body.reportId ?? "").trim();
    if (!reportId) {
      sendJson(response, 400, { error: "missing_report_id" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const adminLevel = await getAdminLevel(context);
    const { data, error } = await context.supabase.rpc("rankball_commit_admin_review_action", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_report_id: reportId,
      p_action_type: String(body.actionType ?? "validReport"),
      p_target_user_id: String(body.targetUserId ?? ""),
      p_duration_days: Number(body.durationDays ?? 3),
      p_reason: String(body.reason ?? ""),
      p_feedback: String(body.feedback ?? ""),
    });

    if (error) throw error;

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin review action failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "admin_review_action_failed" });
  }
}
