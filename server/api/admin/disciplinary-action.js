import { readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const context = await requireAdminContext(request, { minimumLevel: 50 });
    const adminLevel = context.adminLevel;
    const body = await readJsonBody(request);
    const targetUserId = String(body.userId ?? body.targetUserId ?? "").trim();
    if (!targetUserId) {
      sendJson(response, 400, { error: "missing_target_user_id" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_commit_admin_disciplinary_action", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_target_user_id: targetUserId,
      p_action_type: String(body.actionType ?? "suspendTarget"),
      p_type: String(body.type ?? "suspension"),
      p_duration_days: Number(body.durationDays ?? 3),
      p_reason: String(body.reason ?? ""),
    });

    if (error) throw error;

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin disciplinary action failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "admin_disciplinary_action_failed" });
  }
}
