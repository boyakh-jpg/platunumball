import { allowRequestMethod, readJsonBody, requireAdminContext, sendJson } from "../_supabaseAdmin.js";
import { RATING_POLICY_GROUPS } from "../../lib/ratingPolicy.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const context = await requireAdminContext(request, { minimumLevel: 100 });
    const adminLevel = context.adminLevel;
    const body = await readJsonBody(request);
    const action = String(body.action ?? "load").trim();

    if (action === "load") {
      const { data, error } = await context.supabase.rpc("rankball_get_rating_policy", {
        p_actor_profile_id: context.profileId,
        p_actor_admin_level: adminLevel,
      });
      if (error) throw error;
      sendJson(response, 200, { ...(data ?? { ok: true }), schema: RATING_POLICY_GROUPS });
      return;
    }

    if (action !== "update") {
      sendJson(response, 400, { error: "unsupported_rating_policy_action" });
      return;
    }
    if (!body.policy || typeof body.policy !== "object" || Array.isArray(body.policy)) {
      sendJson(response, 400, { error: "invalid_rating_policy" });
      return;
    }

    const reason = String(body.reason ?? "").trim();
    if (reason.length < 4 || reason.length > 160) {
      sendJson(response, 400, { error: "rating_policy_reason_required" });
      return;
    }

    const { data, error } = await context.supabase.rpc("rankball_update_rating_policy", {
      p_actor_profile_id: context.profileId,
      p_actor_admin_level: adminLevel,
      p_expected_version: Number(body.expectedVersion ?? 0),
      p_policy: body.policy,
      p_reason: reason,
    });
    if (error) throw error;
    sendJson(response, 200, { ...(data ?? { ok: true }), schema: RATING_POLICY_GROUPS });
  } catch (error) {
    console.error("Admin rating policy failed.", error);
    const statusCode = error.code === "40001" || /stale_version/i.test(error.message ?? "") ? 409 : error.statusCode || 500;
    sendJson(response, statusCode, { error: error.message || "admin_rating_policy_failed" });
  }
}
