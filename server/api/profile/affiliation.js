import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { normalizeAffiliationName } from "../../../shared/lib/affiliations.js";
import { loadCurrentProfileState, PROFILE_ME_COLUMNS } from "./me.js";

function mapAffiliationError(error = {}) {
  const message = String(error.message || "affiliation_update_failed");
  const mapped = new Error(message);
  mapped.statusCode = error.code === "P0002"
    ? 404
    : error.code === "42501"
      ? 403
      : error.code === "23505"
        ? 409
        : message.startsWith("affiliation_change_cooldown:")
          ? 429
          : 400;
  return mapped;
}
export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { profileSelect: PROFILE_ME_COLUMNS });
    const affiliationId = String(body.affiliationId ?? "").trim();
    const affiliationName = normalizeAffiliationName(body.name ?? body.affiliationName ?? "");
    const { data, error } = await context.supabase.rpc("rankball_set_profile_affiliation", {
      p_actor_profile_id: context.profileId,
      p_affiliation_id: affiliationId || null,
      p_affiliation_name: affiliationName || null,
    });
    if (error) throw mapAffiliationError(error);

    const { data: updatedProfile, error: profileError } = await context.supabase
      .from("profiles")
      .select(PROFILE_ME_COLUMNS)
      .eq("id", context.profileId)
      .single();
    if (profileError) throw profileError;

    const profileState = await loadCurrentProfileState({
      ...context,
      profile: updatedProfile,
    });
    sendJson(response, 200, { ...(data ?? { ok: true }), ...profileState });
  } catch (error) {
    console.error("Profile affiliation update failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "affiliation_update_failed" });
  }
}
