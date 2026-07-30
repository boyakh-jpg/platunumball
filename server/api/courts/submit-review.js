import { allowRequestMethod, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const reviewPayload = body.review && typeof body.review === "object" ? body.review : {};
    const context = await getAuthenticatedContext(request);
    const { data, error } = await context.supabase.rpc("rankball_submit_court_review", {
      actor_profile_id: context.profileId,
      review_payload: reviewPayload,
    });

    if (error) throw error;

    sendJson(response, 200, data ?? { ok: true });
  } catch (error) {
    console.error("Court review submit failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_review_submit_failed" });
  }
}
