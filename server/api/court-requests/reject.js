import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";

function makeHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function normalizeCourtRejectionInput(body = {}) {
  const requestId = String(body.requestId ?? "").trim();
  const reason = String(body.reason ?? "").trim();
  if (!requestId) throw makeHttpError("missing_request_id", 400);
  if (reason.length < 4 || reason.length > 500) throw makeHttpError("court_rejection_reason_invalid", 400);
  return { requestId, reason };
}

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await requireAdminContext(request);
    const { requestId, reason } = normalizeCourtRejectionInput(await readJsonBody(request));
    const { data, error } = await context.supabase.rpc("rankball_reject_court_request", {
      actor_profile_id: context.profileId,
      actor_admin_level: context.adminLevel,
      request_id: requestId,
      reason,
    });
    if (error) {
      if (String(error.message || "").includes("court_request_not_pending")) error.statusCode = 409;
      throw error;
    }
    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Court request rejection failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_request_rejection_failed" });
  }
}
