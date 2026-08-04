import { getCourtAiDailyQuota, getCourtRequestLimitState } from "../../lib/courtRequestVerification.js";
import { allowRequestMethod, getAuthenticatedContext, sendJson } from "../_supabaseAdmin.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;
  try {
    const context = await getAuthenticatedContext(request, { profileSelect: "id" });
    const [quota, requestLimit] = await Promise.all([
      getCourtAiDailyQuota(context.supabase),
      getCourtRequestLimitState(context.supabase, context.profileId),
    ]);
    sendJson(response, 200, { ok: true, quota, requestLimit });
  } catch (error) {
    console.error("Court AI quota load failed.", error.message);
    sendJson(response, error.statusCode || 500, { error: error.message || "court_ai_quota_load_failed" });
  }
}
