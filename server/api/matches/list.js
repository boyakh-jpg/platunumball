import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient, REMOTE_CLIENT_MATCH_LIMIT } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

function getMatchCursor(matches = []) {
  const oldest = [...matches]
    .sort((a, b) => String(a.updatedAt ?? a.createdAt ?? "").localeCompare(String(b.updatedAt ?? b.createdAt ?? "")))
    .at(0);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const adminLevel = context.profileId ? await getAdminLevel(context) : 0;
    const requestedLimit = Number(body.limit ?? body.matchLimit ?? REMOTE_CLIENT_MATCH_LIMIT);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : REMOTE_CLIENT_MATCH_LIMIT;
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        scope: "matches",
        matchLimit: limit,
        matchUpdatedBefore: body.cursor ?? body.matchUpdatedBefore ?? "",
        recruitingLimit: 0,
        tournamentLimit: 0,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const state = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const matches = state.matches ?? [];
    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        recruitingPosts: [],
        tournaments: [],
      },
      page: {
        limit,
        count: matches.length,
        cursor: getMatchCursor(matches),
        exhausted: matches.length < limit,
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_list_failed" });
  }
}
