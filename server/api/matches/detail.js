import { allowRequestMethod, getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadAuthoritativeState } from "../_authoritativeState.js";
import { filterStateForProfile } from "../../lib/stateVisibility.js";

export default async function handler(request, response) {
  if (!allowRequestMethod(request, response)) return;

  try {
    const body = await readJsonBody(request);
    const matchId = String(body.matchId ?? body.id ?? "").trim();
    if (!matchId) {
      sendJson(response, 400, { error: "match_id_required" });
      return;
    }

    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
    const rawState = await loadAuthoritativeState(context, {
      operation: { action: "loadMatch", matchId },
    });
    const profileId = context.profileId ?? rawState?.currentUserId ?? "";
    const state = filterStateForProfile(rawState ?? {}, profileId, adminLevel >= 30);
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
      updatedAt: match.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_detail_failed" });
  }
}
