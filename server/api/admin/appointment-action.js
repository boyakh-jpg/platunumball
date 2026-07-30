import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await requireAdminContext(request);
    const adminLevel = context.adminLevel;
    const body = await readJsonBody(request);
    const actionType = String(body.actionType ?? "appointReferee");
    const targetUserId = String(body.userId ?? body.targetUserId ?? "").trim();
    const appointmentId = String(body.appointmentId ?? "").trim();

    if (["revokeAppointment", "extendAppointment"].includes(actionType) && !appointmentId) {
      sendJson(response, 400, { error: "missing_appointment_id" });
      return;
    }
    if (!["revokeAppointment", "extendAppointment"].includes(actionType) && !targetUserId) {
      sendJson(response, 400, { error: "missing_target_user_id" });
      return;
    }

    if (actionType === "extendAppointment") {
      const { data, error } = await context.supabase.rpc("rankball_extend_admin_appointment_action", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
        p_appointment_id: appointmentId,
        p_term_days: Number(body.termDays ?? 30),
        p_reason: String(body.reason ?? ""),
      });

      if (error) throw error;

      sendJson(response, 200, data ?? { ok: true });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_commit_admin_appointment_action", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_action_type: actionType,
      p_target_user_id: targetUserId,
      p_appointment_id: appointmentId,
      p_admin_grade: String(body.adminGrade ?? ""),
      p_referee_grade: String(body.refereeGrade ?? ""),
      p_term_days: Number(body.termDays ?? 0),
      p_reason: String(body.reason ?? ""),
    });

    if (error) throw error;

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Admin appointment action failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "admin_appointment_action_failed" });
  }
}
