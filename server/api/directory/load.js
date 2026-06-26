import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        matchLimit: 0,
        recruitingLimit: 0,
        tournamentLimit: 0,
        matchListOnly: true,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const state = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);

    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [],
        recruitingPosts: [],
        tournaments: [],
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "directory_load_failed" });
  }
}
