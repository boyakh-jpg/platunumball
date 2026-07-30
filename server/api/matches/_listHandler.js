import { allowRequestMethod, getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson, timeStep } from "../_supabaseAdmin.js";
import { PROFILE_ME_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../shared/lib/constants.js";

import { getCappedLimit } from "./_listQueries.js";
import { loadCompactMatchList } from "./_listLoader.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const startedAt = Date.now();
    const body = await readJsonBody(request);
    const debugTiming = body.debugTiming === true ? {} : null;
    const context = await timeStep(debugTiming, "authMs", () => (
      getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS })
    ));
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId
      ? await timeStep(debugTiming, "adminMs", () => getAdminLevel(context))
      : 0;
    const limit = getCappedLimit(body.limit ?? body.matchLimit ?? REMOTE_CLIENT_MATCH_LIMIT);
    const result = await loadCompactMatchList(context, body, adminLevel, limit, debugTiming);
    if (debugTiming) debugTiming.totalMs = Date.now() - startedAt;
    sendJson(response, 200, {
      ok: true,
      ...result,
      debugTiming: debugTiming ?? undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_list_failed" });
  }
}
