import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const matchId = String(body.matchId ?? body.id ?? "").trim();
    if (!matchId) {
      sendJson(response, 400, { error: "match_id_required" });
      return;
    }

    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        scope: "matches",
        matchId,
        recruitingLimit: 0,
        tournamentLimit: 0,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const state = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const match = (state.matches ?? []).find((item) => item.id === matchId) ?? null;
    if (!match) {
      sendJson(response, 404, { error: "match_not_found", matchId });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [match],
        recruitingPosts: [],
        tournaments: [],
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_detail_failed" });
  }
}
