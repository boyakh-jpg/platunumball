import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";
import { fromRemoteReport } from "../../../shared/lib/remotePayloadMappers.js";

const ALLOWED_OPERATIONS = new Set(["assignSelf", "unassign", "markUrgent", "clearUrgent"]);

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await requireAdminContext(request);
    const body = await readJsonBody(request);
    const reportId = String(body.reportId ?? "").trim();
    const operation = String(body.operation ?? "").trim();
    if (!reportId) {
      sendJson(response, 400, { error: "missing_report_id" });
      return;
    }
    if (!ALLOWED_OPERATIONS.has(operation)) {
      sendJson(response, 400, { error: "invalid_report_operation" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_admin_report_operation", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: context.adminLevel,
      p_report_id: reportId,
      p_operation: operation,
    });
    if (error) {
      const mapped = new Error(error.message || "admin_report_operation_failed");
      mapped.statusCode = error.code === "42501" ? 403
        : error.code === "P0002" ? 404
        : error.code === "23505" ? 409
        : error.code === "22023" ? 400
        : 500;
      throw mapped;
    }

    sendJson(response, 200, { ...data, report: fromRemoteReport(data?.report ?? {}) });
  } catch (error) {
    console.error("Admin report operation failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "admin_report_operation_failed" });
  }
}
