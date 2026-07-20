import { getAuthenticatedContext, sendJson } from "../_supabaseAdmin.js";
import { refreshProfileIconAchievements } from "../_profileIconAchievements.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const context = await getAuthenticatedContext(request);
    const achievements = await refreshProfileIconAchievements(context.supabase, context.profileId);
    sendJson(response, 200, { ok: true, ...achievements });
  } catch (error) {
    console.error("Profile icon achievements failed.", error.message);
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_icon_achievements_failed" });
  }
}
