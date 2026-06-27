import { getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        scope: "profile",
        matchLimit: 0,
        recruitingLimit: 0,
        tournamentLimit: 0,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const state = filterStateForProfile(normalized?.state ?? {}, profileId, false);

    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [],
        recruitingPosts: [],
        tournaments: [],
      },
      updatedAt: normalized?.updatedAt ?? 0,
      debug: body.debug === true ? { profileId } : undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "profile_me_failed" });
  }
}
