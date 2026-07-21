import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const requestId = String(body.requestId ?? "").trim();
    const approval = body.approval && typeof body.approval === "object" ? body.approval : {};
    if (!requestId) {
      sendJson(response, 400, { error: "missing_request_id" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const adminLevel = await getAdminLevel(context);
    const { data, error } = await context.supabase.rpc("rankball_approve_court_request", {
      actor_profile_id: context.profileId,
      actor_admin_level: adminLevel,
      request_id: requestId,
      approval_payload: {
        approvedName: String(approval.approvedName ?? "").trim(),
        addressVerified: approval.addressVerified === true,
        multipleCourtsVerified: approval.multipleCourtsVerified === true,
      },
    });

    if (error) {
      if (["court_request_not_pending", "court_request_report_pending"].some((code) => (
        String(error.message || "").includes(code)
      ))) {
        error.statusCode = 409;
      }
      throw error;
    }

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Court request approval failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_request_approval_failed" });
  }
}
