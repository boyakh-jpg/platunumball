import { getBearerToken, getSupabaseAdminClient, readJsonBody, sendJson, toArray } from "../_supabaseAdmin.js";
import { getMatchRatingCommit } from "../_authoritativeState.js";
import { commitMatchRating } from "../matches/sync-match.js";
import { loadNormalizedMatchDetailFromClient, runAutomaticStateMaintenance } from "../../../src/data/repository.js";
import { DISPUTE_WINDOW_MINUTES } from "../../../src/lib/constants.js";

const DEFAULT_MATCH_LIMIT = 10;
const ACTIVE_RECRUITING_APPLICATION_STATUSES = new Set(["waiting", "ready", "confirmed"]);

function assertAccess(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || getBearerToken(request) !== secret) {
    const error = new Error("invalid_maintenance_secret");
    error.statusCode = 401;
    throw error;
  }
}

function normalizeLimit(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MATCH_LIMIT;
  return Math.max(1, Math.min(50, Math.floor(raw)));
}

function getLimit(request) {
  return normalizeLimit(request.query?.limit ?? process.env.RANKBALL_MAINTENANCE_MATCH_LIMIT ?? DEFAULT_MATCH_LIMIT);
}

function isMissingCleanupRpc(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202" || error?.code === "42883" || message.includes("rankball_cleanup_room_feed");
}

function getApplicationPlayerCount(row = {}, capacity = 5) {
  const playerIds = toArray(row.player_ids);
  if (playerIds.length) return Math.min(capacity, playerIds.length);
  return row.player_id ? 1 : 0;
}

function getHostPlayerCount(row = {}, capacity = 5) {
  const hostJoinMode = row.host_join_mode === "team" && row.team_id ? "team" : "player";
  const playerIds = hostJoinMode === "team" ? toArray(row.player_ids) : [];
  if (playerIds.length) return Math.min(capacity, playerIds.length);
  return row.player_id ? 1 : 0;
}

function getApprovalRows(match = {}) {
  return ["teamA", "teamB"].flatMap((side) => (
    (match.approvals?.[side] ?? []).filter(Boolean).map((userId) => ({
      match_id: match.id,
      user_id: userId,
      side,
    }))
  ));
}

function isDueApprovalRow(row = {}, nowMs = Date.now()) {
  const endedAtMs = row.ended_at ? new Date(row.ended_at).getTime() : NaN;
  if (!Number.isFinite(endedAtMs)) return false;
  const rawDisputeMinutes = Number(row.dispute_minutes ?? DISPUTE_WINDOW_MINUTES);
  const disputeMinutes = Number.isFinite(rawDisputeMinutes) && rawDisputeMinutes > 0
    ? Math.min(rawDisputeMinutes, DISPUTE_WINDOW_MINUTES)
    : DISPUTE_WINDOW_MINUTES;
  return nowMs > endedAtMs + disputeMinutes * 60000;
}

async function getCandidateMatchIds(client, limit, nowMs) {
  const { data: rows, error } = await client
    .from("matches")
    .select("id, ended_at, dispute_minutes, dispute_draft_result")
    .eq("status", "approval")
    .not("ended_at", "is", null)
    .is("confirmed_at", null)
    .is("rating_result", null)
    .is("dispute_draft_result", null)
    .order("ended_at", { ascending: true })
    .limit(limit * 4);
  if (error) throw error;

  const dueIds = (rows ?? [])
    .filter((row) => isDueApprovalRow(row, nowMs))
    .map((row) => row.id)
    .filter(Boolean);
  if (!dueIds.length) return [];

  const { data: resultRows, error: resultError } = await client
    .from("match_results")
    .select("match_id")
    .in("match_id", dueIds);
  if (resultError) throw resultError;

  const resultIds = new Set((resultRows ?? []).map((row) => row.match_id).filter(Boolean));
  return dueIds.filter((id) => resultIds.has(id)).slice(0, limit);
}

async function upsertApprovals(client, match) {
  const rows = getApprovalRows(match);
  if (!rows.length) return 0;
  const { error } = await client
    .from("match_approvals")
    .upsert(rows, { onConflict: "match_id,user_id" });
  if (error) throw error;
  return rows.length;
}

async function processMatch(client, matchId, now) {
  const normalized = await loadNormalizedMatchDetailFromClient(client, "", "", {
    matchId,
    isAdmin: true,
  });
  const beforeState = {
    ...(normalized?.state ?? {}),
    currentUserId: "system:maintenance",
  };
  const beforeMatch = (beforeState.matches ?? []).find((match) => match.id === matchId);
  if (!beforeMatch?.result || beforeMatch.status !== "approval" || beforeMatch.disputeDraftResult) {
    return { matchId, ok: false, skipped: true, reason: "not_auto_confirmable" };
  }

  const afterState = runAutomaticStateMaintenance(beforeState, now);
  const afterMatch = (afterState.matches ?? []).find((match) => match.id === matchId);
  if (afterMatch?.status !== "confirmed" || !afterMatch.ratingResult) {
    return { matchId, ok: false, skipped: true, reason: "maintenance_noop" };
  }

  const ratingCommit = getMatchRatingCommit(beforeState, afterState, afterMatch, "autoConfirmMatch");
  if (!ratingCommit) {
    return { matchId, ok: false, skipped: true, reason: "missing_rating_commit" };
  }

  const ratingResult = await commitMatchRating(
    { supabase: client, profileId: "system:maintenance" },
    ratingCommit,
  );
  const approvalCount = await upsertApprovals(client, afterMatch);

  return {
    matchId,
    ok: true,
    skipped: false,
    ratingCommitted: Boolean(ratingResult?.ok),
    ratingAlreadyCommitted: Boolean(ratingResult?.alreadyCommitted),
    approvalCount,
  };
}

async function cleanupRoomFeed(client, now) {
  const { data, error } = await client.rpc("rankball_cleanup_room_feed", {
    p_now: now.toISOString(),
  });
  if (error) {
    if (isMissingCleanupRpc(error)) {
      return { ok: false, skipped: true, error: "rankball_cleanup_room_feed_missing", checks: [] };
    }
    throw error;
  }
  const checks = Array.isArray(data) ? data : [];
  return {
    ok: true,
    skipped: false,
    affected: checks.reduce((sum, row) => sum + Number(row?.affected_count ?? 0), 0),
    checks,
  };
}

async function refreshRecruitingFeed(client, postId) {
  const { error } = await client.rpc("rankball_refresh_recruiting_feed_for_post", { p_post_id: postId });
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (error.code === "PGRST202" || error.code === "42883" || message.includes("rankball_refresh_recruiting_feed_for_post")) {
      return false;
    }
    throw error;
  }
  return true;
}

async function normalizeRecruitingSideCapacity(client, limit, now) {
  const { data: posts, error: postError } = await client
    .from("recruiting_posts")
    .select("id,mode,side_capacity,host_side,host_join_mode,team_id,player_id,player_ids,updated_at")
    .eq("status", "open")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (postError) throw postError;

  const postRows = posts ?? [];
  if (!postRows.length) return { ok: true, checked: 0, reserved: 0, posts: [] };

  const postIds = postRows.map((post) => post.id).filter(Boolean);
  const { data: applications, error: applicationError } = await client
    .from("recruiting_applications")
    .select("post_id,kind,team_id,player_id,side,status,reserve,player_ids,created_at,updated_at")
    .in("post_id", postIds)
    .eq("reserve", false)
    .in("status", [...ACTIVE_RECRUITING_APPLICATION_STATUSES]);
  if (applicationError) throw applicationError;

  const applicationsByPost = new Map();
  (applications ?? []).forEach((row) => {
    const rows = applicationsByPost.get(row.post_id) ?? [];
    rows.push(row);
    applicationsByPost.set(row.post_id, rows);
  });

  const reservedRows = [];
  for (const post of postRows) {
    const capacity = Math.max(1, Math.min(5, Number(post.side_capacity) || 5));
    const hostSide = post.host_side === "teamB" ? "teamB" : "teamA";
    const sideCounts = { teamA: 0, teamB: 0 };
    sideCounts[hostSide] = getHostPlayerCount(post, capacity);
    const rows = [...(applicationsByPost.get(post.id) ?? [])].sort((a, b) => (
      String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) ||
      String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? "")) ||
      String(a.player_id ?? "").localeCompare(String(b.player_id ?? ""))
    ));

    rows.forEach((row) => {
      const side = row.side === "teamA" ? "teamA" : "teamB";
      const count = getApplicationPlayerCount(row, capacity);
      if (sideCounts[side] + count <= capacity) {
        sideCounts[side] += count;
        return;
      }
      reservedRows.push(row);
    });
  }

  for (const row of reservedRows) {
    const { error } = await client
      .from("recruiting_applications")
      .update({ reserve: true, updated_at: now.toISOString() })
      .match({ post_id: row.post_id, player_id: row.player_id, kind: row.kind });
    if (error) throw error;
  }

  const changedPostIds = [...new Set(reservedRows.map((row) => row.post_id).filter(Boolean))];
  let refreshed = 0;
  for (const postId of changedPostIds) {
    if (await refreshRecruitingFeed(client, postId)) refreshed += 1;
  }

  return {
    ok: true,
    checked: postRows.length,
    reserved: reservedRows.length,
    refreshed,
    posts: changedPostIds,
  };
}

export async function runSystemMaintenance(client = getSupabaseAdminClient(), options = {}) {
  const limit = normalizeLimit(options.limit ?? process.env.RANKBALL_MAINTENANCE_MATCH_LIMIT ?? DEFAULT_MATCH_LIMIT);
  const now = options.now instanceof Date ? options.now : new Date();
  const includeRecruitingCapacityCleanup = options.includeRecruitingCapacityCleanup === true;
  const candidateIds = await getCandidateMatchIds(client, limit, now.getTime());
  const results = [];

  for (const matchId of candidateIds) {
    results.push(await processMatch(client, matchId, now));
  }

  return {
    ok: results.every((result) => result.ok || result.skipped),
    candidateCount: candidateIds.length,
    confirmedCount: results.filter((result) => result.ok).length,
    feedCleanup: await cleanupRoomFeed(client, now),
    recruitingCapacityCleanup: includeRecruitingCapacityCleanup
      ? await normalizeRecruitingSideCapacity(client, limit, now)
      : { ok: true, skipped: true, reason: "disabled" },
    results,
  };
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertAccess(request);
    const client = getSupabaseAdminClient();
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    sendJson(response, 200, await runSystemMaintenance(client, {
      limit: normalizeLimit(body.limit ?? getLimit(request)),
      includeRecruitingCapacityCleanup: body.includeRecruitingCapacityCleanup !== false,
    }));
  } catch (error) {
    console.error("System maintenance failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "maintenance_failed" });
  }
}
