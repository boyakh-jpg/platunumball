import { getAdminLevel, getAuthenticatedContext, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { loadNormalizedRemoteStateFromClient, REMOTE_CLIENT_RECRUITING_LIMIT } from "../../../src/data/repository.js";
import { filterStateForProfile } from "../state/load.js";

let currentUserRecruitingRpcAvailable = true;

function getRecruitingCursor(posts = []) {
  const oldest = [...posts]
    .sort((a, b) => String(a.updatedAt ?? a.createdAt ?? "").localeCompare(String(b.updatedAt ?? b.createdAt ?? "")))
    .at(0);
  return oldest?.updatedAt ?? oldest?.createdAt ?? "";
}

function getTargetPostIds(body = {}) {
  return [
    body.postId,
    body.recruitingPostId,
    ...(Array.isArray(body.recruitingPostIds) ? body.recruitingPostIds : []),
  ].map((id) => String(id ?? "").trim()).filter(Boolean);
}

function uniqueIds(ids = []) {
  return [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
}

function mergeById(current = [], incoming = []) {
  const merged = new Map((current ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
  (incoming ?? []).forEach((item) => {
    if (item?.id) merged.set(item.id, item);
  });
  return [...merged.values()];
}

function mergeStateById(current = {}, incoming = {}) {
  return {
    ...current,
    ...incoming,
    users: mergeById(current.users, incoming.users),
    teams: mergeById(current.teams, incoming.teams),
    recruitingPosts: mergeById(current.recruitingPosts, incoming.recruitingPosts),
    settings: {
      ...(current.settings ?? {}),
      ...(incoming.settings ?? {}),
    },
  };
}

async function fetchPostIds(query, idColumn = "id") {
  const { data, error } = await query;
  if (error) {
    console.warn("Current user recruiting id query skipped.", error.message);
    return [];
  }
  return (data ?? []).map((row) => row?.[idColumn]).filter(Boolean);
}

async function fetchCurrentUserRecruitingPostIds(client, profileId = "", limit = REMOTE_CLIENT_RECRUITING_LIMIT) {
  if (!profileId) return [];
  const cappedLimit = Math.max(1, Math.min(80, Number(limit) || REMOTE_CLIENT_RECRUITING_LIMIT));
  if (currentUserRecruitingRpcAvailable) {
    const { data: rpcRows, error: rpcError } = await client.rpc("rankball_current_recruiting_post_ids", {
      p_profile_id: profileId,
      p_limit: cappedLimit,
    });
    if (!rpcError) {
      return uniqueIds((rpcRows ?? []).map((row) => row?.post_id ?? row?.id ?? row)).slice(0, cappedLimit);
    }
    currentUserRecruitingRpcAvailable = false;
    console.warn("Current user recruiting RPC skipped.", rpcError.message);
  }
  const [ownedPostIds, hostedPlayerPostIds, refereedPostIds, applicantPostIds, applicantPartyPostIds] = await Promise.all([
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_posts").select("id").eq("status", "open").eq("referee_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit)),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").eq("player_id", profileId).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
    fetchPostIds(client.from("recruiting_applications").select("post_id,updated_at").contains("player_ids", [profileId]).order("updated_at", { ascending: false }).limit(cappedLimit), "post_id"),
  ]);
  return uniqueIds([
    ...ownedPostIds,
    ...hostedPlayerPostIds,
    ...refereedPostIds,
    ...applicantPostIds,
    ...applicantPartyPostIds,
  ]).slice(0, cappedLimit);
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const context = await getAuthenticatedContext(request, { allowMissingProfile: true });
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId ? await getAdminLevel(context) : 0;
    const requestedLimit = Number(body.limit ?? body.recruitingLimit ?? REMOTE_CLIENT_RECRUITING_LIMIT);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const mineOnly = body.scope === "mine" || body.mine === true;
    const includeMine = mineOnly || body.includeMine === true;
    const mineLimit = mineOnly ? limit : REMOTE_CLIENT_RECRUITING_LIMIT;
    const currentUserPostIds = includeMine ? await fetchCurrentUserRecruitingPostIds(context.supabase, context.profileId, mineLimit) : [];
    const explicitPostIds = getTargetPostIds(body);
    const targetPostIds = uniqueIds([...explicitPostIds, ...(mineOnly ? currentUserPostIds : [])]);
    const normalized = await loadNormalizedRemoteStateFromClient(
      context.supabase,
      context.authUserId,
      context.authUser?.email ?? "",
      {
        clientState: true,
        isAdmin: adminLevel >= 30,
        scope: "recruiting",
        recruitingPostIds: targetPostIds,
        recruitingLimit: mineOnly && !targetPostIds.length ? 0 : limit,
        recruitingUpdatedBefore: body.cursor ?? body.recruitingUpdatedBefore ?? "",
        matchLimit: 0,
        tournamentLimit: 0,
      },
    );
    const profileId = context.profileId ?? normalized?.state?.currentUserId ?? "";
    const pageState = filterStateForProfile(normalized?.state ?? {}, profileId, adminLevel >= 30);
    const pagePosts = pageState.recruitingPosts ?? [];
    let state = pageState;
    if (includeMine && !mineOnly) {
      const loadedIds = new Set(pagePosts.map((post) => post.id));
      const missingMineIds = currentUserPostIds.filter((postId) => !loadedIds.has(postId));
      if (missingMineIds.length) {
        const mineNormalized = await loadNormalizedRemoteStateFromClient(
          context.supabase,
          context.authUserId,
          context.authUser?.email ?? "",
          {
            clientState: true,
            isAdmin: adminLevel >= 30,
            scope: "recruiting",
            recruitingPostIds: missingMineIds,
            recruitingLimit: 0,
            matchLimit: 0,
            tournamentLimit: 0,
          },
        );
        const mineState = filterStateForProfile(mineNormalized?.state ?? {}, profileId, adminLevel >= 30);
        state = mergeStateById(pageState, mineState);
      }
    }
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
        count: pagePosts.length,
        cursor: getRecruitingCursor(pagePosts),
        exhausted: mineOnly || Boolean(targetPostIds.length) || pagePosts.length < limit,
      },
      updatedAt: normalized?.updatedAt ?? 0,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "recruiting_list_failed" });
  }
}
