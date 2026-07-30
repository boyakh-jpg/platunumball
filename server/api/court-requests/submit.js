import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const requestPayload = body.request && typeof body.request === "object" ? body.request : {};
    const context = await getAuthenticatedContext(request);
    const { data, error } = await context.supabase.rpc("rankball_submit_court_request", {
      actor_profile_id: context.profileId,
      request_payload: requestPayload,
    });

    if (error) throw error;

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Court request submit failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_request_submit_failed" });
  }
}
