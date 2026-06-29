import { getSupabaseAdminClient, readJsonBody, sendJson } from "../_supabaseAdmin.js";
import { getMatchRatingCommit } from "../_authoritativeState.js";
import { commitMatchRating } from "../matches/sync-match.js";
import { loadNormalizedRemoteStateFromClient, runAutomaticStateMaintenance } from "../../../src/data/repository.js";
import { DISPUTE_WINDOW_MINUTES } from "../../../src/lib/constants.js";

const DEFAULT_MATCH_LIMIT = 10;

function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? "";
}

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
  const normalized = await loadNormalizedRemoteStateFromClient(client, "", "", {
    scope: "matches",
    matchIds: [matchId],
    clientState: false,
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

export async function runSystemMaintenance(client = getSupabaseAdminClient(), options = {}) {
  const limit = normalizeLimit(options.limit ?? process.env.RANKBALL_MAINTENANCE_MATCH_LIMIT ?? DEFAULT_MATCH_LIMIT);
  const now = options.now instanceof Date ? options.now : new Date();
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
    sendJson(response, 200, await runSystemMaintenance(client, { limit: normalizeLimit(body.limit ?? getLimit(request)) }));
  } catch (error) {
    console.error("System maintenance failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "maintenance_failed" });
  }
}
