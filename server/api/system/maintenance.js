import { getBearerToken, getSupabaseAdminClient, readJsonBody, sendJson, toArray } from "../_supabaseAdmin.js";
import { getMatchRatingCommit } from "../_authoritativeState.js";
import { commitMatchRating } from "../matches/sync-match.js";
import { loadNormalizedMatchDetailFromClient, runAutomaticStateMaintenance } from "../../../src/data/repository.js";
import { normalizeDisputeWindowMinutes } from "../../../src/lib/constants.js";

const DEFAULT_MATCH_LIMIT = 10;
const FEED_REPAIR_ROW_FACTOR = 8;
const ROOM_FEED_RETENTION_DAYS = 7;
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

function isMissingTournamentLineupDeadlineRpc(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202" || error?.code === "42883" || message.includes("rankball_tournament_lineup_deadline_batch_action");
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
  const disputeMinutes = normalizeDisputeWindowMinutes(row.dispute_minutes);
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

  // Recruiting expiration is DB-authoritative; this reducer is only used for match auto-confirmation.
  const afterState = runAutomaticStateMaintenance({ ...beforeState, recruitingPosts: [] }, now);
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
    retentionDays: ROOM_FEED_RETENTION_DAYS,
    affected: checks.reduce((sum, row) => sum + Number(row?.affected_count ?? 0), 0),
    checks,
  };
}

async function expireRecruitingRooms(client) {
  const { data, error } = await client.rpc("rankball_expire_recruiting_rooms");
  if (error) throw error;
  return data && typeof data === "object"
    ? data
    : { ok: true, expiredCount: 0, rooms: [] };
}

async function processTournamentLineupDeadlines(client, limit, now) {
  const { data, error } = await client.rpc("rankball_tournament_lineup_deadline_batch_action", {
    p_now: now.toISOString(),
    p_limit: limit,
  });
  if (error) {
    if (isMissingTournamentLineupDeadlineRpc(error)) {
      return { ok: false, skipped: true, error: "rankball_tournament_lineup_deadline_batch_action_missing" };
    }
    throw error;
  }
  return data && typeof data === "object"
    ? data
    : { ok: true, checkedCount: 0, readyCount: 0, forfeitCount: 0, organizerReviewCount: 0, results: [] };
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

async function refreshMatchFeed(client, matchId) {
  const { error } = await client.rpc("rankball_refresh_match_feed_for_match", { p_match_id: matchId });
  if (error) {
    const message = String(error.message ?? "").toLowerCase();
    if (error.code === "PGRST202" || error.code === "42883" || message.includes("rankball_refresh_match_feed_for_match")) {
      return false;
    }
    throw error;
  }
  return true;
}

function parseMaintenanceBoolean(value) {
  return value === true || value === "true" || value === "1";
}

function getMaintenanceFeedRepairOption(request, body = {}) {
  const value = body.includeFeedRepair ?? request.query?.includeFeedRepair;
  if (value === undefined || value === null || value === "") return true;
  return parseMaintenanceBoolean(value);
}

function getFeedCardTime(cardRow = {}) {
  const value = cardRow.updated_at ?? cardRow.card_json?.updatedAt ?? cardRow.card_json?.updated_at ?? "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function getSourceTime(sourceRow = {}) {
  const time = Date.parse(sourceRow.updated_at ?? "");
  return Number.isFinite(time) ? time : 0;
}

async function fetchFeedRepairCandidates(client, limit) {
  const { data: feedRows, error: feedError } = await client
    .from("user_room_feed")
    .select("entity_type,entity_id,status")
    .eq("is_active", true)
    .in("entity_type", ["recruiting", "match"])
    .order("sort_at", { ascending: false, nullsFirst: false })
    .limit(limit * FEED_REPAIR_ROW_FACTOR);
  if (feedError) throw feedError;

  const entities = [...new Map((feedRows ?? [])
    .filter((row) => row?.entity_type && row?.entity_id)
    .map((row) => [`${row.entity_type}:${row.entity_id}`, row])).values()].slice(0, limit);
  const recruitingIds = entities.filter((row) => row.entity_type === "recruiting").map((row) => row.entity_id);
  const matchIds = entities.filter((row) => row.entity_type === "match").map((row) => row.entity_id);
  const cardMap = new Map();
  const sourceMap = new Map();

  for (const entityType of ["recruiting", "match"]) {
    const ids = entityType === "recruiting" ? recruitingIds : matchIds;
    if (!ids.length) continue;
    const { data, error } = await client
      .from("room_feed_cards")
      .select("entity_type,entity_id,updated_at,card_json")
      .eq("entity_type", entityType)
      .in("entity_id", ids);
    if (error) throw error;
    (data ?? []).forEach((row) => cardMap.set(`${row.entity_type}:${row.entity_id}`, row));
  }

  if (recruitingIds.length) {
    const { data, error } = await client
      .from("recruiting_posts")
      .select("id,status,updated_at")
      .in("id", recruitingIds);
    if (error) throw error;
    (data ?? []).forEach((row) => sourceMap.set(`recruiting:${row.id}`, row));
  }

  if (matchIds.length) {
    const { data, error } = await client
      .from("matches")
      .select("id,status,updated_at")
      .in("id", matchIds);
    if (error) throw error;
    (data ?? []).forEach((row) => sourceMap.set(`match:${row.id}`, row));
  }

  const candidates = entities
    .map((row) => {
      const key = `${row.entity_type}:${row.entity_id}`;
      const cardRow = cardMap.get(key);
      const sourceRow = sourceMap.get(key);
      if (!sourceRow) return null;
      const sourceTime = getSourceTime(sourceRow);
      const cardTime = getFeedCardTime(cardRow);
      const cardJson = cardRow?.card_json && typeof cardRow.card_json === "object" ? cardRow.card_json : null;
      const cardStatus = String(cardJson?.status ?? "").trim();
      const stale = sourceTime && (!cardTime || cardTime + 1000 < sourceTime);
      const invalid = !cardJson || (cardStatus && cardStatus !== sourceRow.status);
      return stale || invalid ? { entityType: row.entity_type, entityId: row.entity_id } : null;
    })
    .filter(Boolean);
  return { checked: entities.length, candidates };
}

async function repairStaleRoomFeed(client, limit) {
  const audit = await fetchFeedRepairCandidates(client, limit);
  const candidates = audit.candidates;
  const results = [];
  for (const candidate of candidates) {
    const ok = candidate.entityType === "match"
      ? await refreshMatchFeed(client, candidate.entityId)
      : await refreshRecruitingFeed(client, candidate.entityId);
    results.push({ ...candidate, ok });
  }
  return {
    ok: results.every((result) => result.ok),
    checked: audit.checked,
    candidates: candidates.length,
    repaired: results.filter((result) => result.ok).length,
    results,
  };
}

function shouldManualRefreshRecruitingFeed() {
  return process.env.RANKBALL_MAINTENANCE_MANUAL_FEED_REFRESH === "true";
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
  if (shouldManualRefreshRecruitingFeed()) {
    for (const postId of changedPostIds) {
      if (await refreshRecruitingFeed(client, postId)) refreshed += 1;
    }
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
  const includeFeedRepair = options.includeFeedRepair === true || process.env.RANKBALL_MAINTENANCE_FEED_REPAIR === "true";
  const tournamentLineupDeadlines = await processTournamentLineupDeadlines(client, limit, now);
  const recruitingExpiration = await expireRecruitingRooms(client);
  const candidateIds = await getCandidateMatchIds(client, limit, now.getTime());
  const results = [];

  for (const matchId of candidateIds) {
    results.push(await processMatch(client, matchId, now));
  }

  return {
    ok: (tournamentLineupDeadlines.ok || tournamentLineupDeadlines.skipped) && results.every((result) => result.ok || result.skipped),
    candidateCount: candidateIds.length,
    confirmedCount: results.filter((result) => result.ok).length,
    tournamentLineupDeadlines,
    recruitingExpiration,
    feedCleanup: await cleanupRoomFeed(client, now),
    feedRepair: includeFeedRepair
      ? await repairStaleRoomFeed(client, limit)
      : { ok: true, skipped: true, reason: "disabled" },
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
    const body = (request.method === "POST" ? await readJsonBody(request) : {}) ?? {};
    if (Object.prototype.hasOwnProperty.call(body, "now") || request.query?.now !== undefined) {
      const error = new Error("maintenance_now_not_allowed");
      error.statusCode = 400;
      throw error;
    }
    sendJson(response, 200, await runSystemMaintenance(client, {
      limit: normalizeLimit(body.limit ?? getLimit(request)),
      includeRecruitingCapacityCleanup: body.includeRecruitingCapacityCleanup !== false,
      includeFeedRepair: getMaintenanceFeedRepairOption(request, body),
    }));
  } catch (error) {
    console.error("System maintenance failed.", error);
    sendJson(response, error.statusCode || 500, { error: error.message || "maintenance_failed" });
  }
}
