import { allowRequestMethod, getSupabaseAdminClient, sendJson } from "../_supabaseAdmin.js";
import { resolveMatchPublicCode } from "../../lib/matchPublicCodeResolver.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response, ["GET"])) return;
  try {
    const result = await resolveMatchPublicCode(getSupabaseAdminClient(), request.query?.code);
    response.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    if (!result) return sendJson(response, 404, { error: "match_public_code_not_found" });
    return sendJson(response, 200, result);
  } catch (error) {
    console.warn("Match public code resolution failed.", error.message);
    return sendJson(response, 500, { error: "match_public_code_resolution_failed" });
  }
}
