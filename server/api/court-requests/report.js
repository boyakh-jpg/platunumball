import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const requestId = String(body.requestId ?? "").trim();
    const reason = (String(body.reason ?? "허위 구장 등록").trim() || "허위 구장 등록").slice(0, 500);
    if (!requestId) {
      sendJson(response, 400, { error: "missing_request_id" });
      return;
    }

    const context = await getAuthenticatedContext(request);
    const { data: courtRequest, error: courtRequestError } = await context.supabase
      .from("court_requests")
      .select("id,status,requested_by")
      .eq("id", requestId)
      .maybeSingle();
    if (courtRequestError) throw courtRequestError;
    if (!courtRequest) {
      const error = new Error("court_request_not_found");
      error.statusCode = 404;
      throw error;
    }
    if (courtRequest.requested_by === context.profileId) {
      const error = new Error("cannot_report_own_court_request");
      error.statusCode = 403;
      throw error;
    }
    if (!["pending", "reported"].includes(courtRequest.status)) {
      const error = new Error("court_request_not_reportable");
      error.statusCode = 409;
      throw error;
    }

    const { data, error } = await context.supabase.rpc("rankball_report_court_request", {
      actor_profile_id: context.profileId,
      request_id: requestId,
      reason,
    });

    if (error) {
      if (String(error.message || "").includes("cannot_report_own_court_request")) {
        error.statusCode = 403;
      }
      if (["approved_court_request_cannot_be_reported", "court_request_not_reportable"].some((code) => (
        String(error.message || "").includes(code)
      ))) {
        error.statusCode = 409;
      }
      throw error;
    }

    const reportId = String(data?.reportId ?? "").trim();
    if (!reportId) throw new Error("court_request_report_receipt_missing");
    const { data: reportReceipt, error: reportReceiptError } = await context.supabase
      .from("reports")
      .select("id,status,created_at")
      .eq("id", reportId)
      .eq("user_id", context.profileId)
      .maybeSingle();
    if (reportReceiptError) throw reportReceiptError;
    if (!reportReceipt) throw new Error("court_request_report_receipt_missing");

    sendJson(response, 200, {
      ...(data ?? { ok: true }),
      reportId: reportReceipt.id,
      status: reportReceipt.status,
      createdAt: reportReceipt.created_at,
    });
  } catch (error) {
    console.error("Court request report failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_request_report_failed" });
  }
}
