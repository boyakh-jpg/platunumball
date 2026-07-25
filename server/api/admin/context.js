import { requireAdminContext, sendJson } from "../_supabaseAdmin.js";

function getAdminGradeFromLevel(level = 0) {
  if (level >= 100) return "owner";
  if (level >= 80) return "senior";
  if (level >= 60) return "regionManager";
  if (level >= 50) return "matchManager";
  if (level >= 30) return "support";
  return "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const context = await requireAdminContext(request);
    sendJson(response, 200, {
      ok: true,
      profileId: context.profileId,
      adminLevel: context.adminLevel,
      adminGrade: getAdminGradeFromLevel(context.adminLevel),
    });
  } catch (error) {
    console.error("Admin context failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "admin_context_failed" });
  }
}
