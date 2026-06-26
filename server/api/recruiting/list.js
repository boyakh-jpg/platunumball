import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient, REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

function getRecruitingCursor(posts = []) {
  const oldest = [...posts]
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
    const requestedLimit = Number(body.limit ?? body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        scope: "recruiting",
        recruitingLimit: limit,
        recruitingUpdatedBefore: body.cursor ?? body.recruitingUpdatedBefore ?? "",
        matchLimit: 0,
        tournamentLimit: 0,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const state = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const posts = state.recruitingPosts ?? [];
    sendJson(response, 200, {
      ok: true,
      state: {
        ...state,
        matches: [],
        tournaments: [],
      },
      page: {
        limit,
        count: posts.length,
        cursor: getRecruitingCursor(posts),
        exhausted: posts.length < limit,
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "recruiting_list_failed" });
  }
}
