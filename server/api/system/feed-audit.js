import { getBearerToken, getSupabaseAdminClient, isMissingTable, readJsonBody, sendJson, uniqueStringIds as uniqueIds } from "../_supabaseAdmin.js";

const FEED_COLUMNS = "profile_id,entity_type,entity_id,relation,feed_scope,region_key,status,timing_type,scheduled_date,card_json,sort_at,is_active";
const CARD_COLUMNS = "entity_type,entity_id,card_json,updated_at";
const RECRUITING_SOURCE_COLUMNS = "id,status,visibility,scheduled_date,scheduled_time,scheduled_at,room_state,updated_at";
const MATCH_SOURCE_COLUMNS = "id,status,scheduled_date,scheduled_time,rules,updated_at";
const MAX_AUDIT_LIMIT = 500;
const MAX_SAMPLE_LIMIT = 25;

function reject(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

function assertAccess(request) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret || getBearerToken(request) !== secret) reject(401, "invalid_feed_audit_secret");
}

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function getCappedLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 200;
  return Math.max(1, Math.min(MAX_AUDIT_LIMIT, Math.floor(number)));
}

function normalizeEntityType(value = "") {
  const text = String(value ?? "").trim();
  if (text === "match" || text === "recruiting") return text;
  return "";
}

function getRequestValue(request, body, key, fallback = "") {
  const query = request.query ?? {};
  return body?.[key] ?? query[key] ?? fallback;
}

function asTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

async function fetchFeedRows(client, options = {}) {
  const {
    entityType,
    profileId,
    feedScope,
    regionKey,
    relation,
    limit,
  } = options;
  let query = client
    .from("user_room_feed")
    .select(FEED_COLUMNS)
    .eq("is_active", true)
    .order("sort_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (entityType) query = query.eq("entity_type", entityType);
  if (profileId) query = query.eq("profile_id", profileId);
  if (feedScope) query = query.eq("feed_scope", feedScope);
  if (regionKey) query = query.eq("region_key", regionKey);
  if (relation) query = query.eq("relation", relation);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function fetchCardsByType(client, rows = []) {
  const byType = new Map();
  rows.forEach((row) => {
    const entityType = normalizeEntityType(row?.entity_type);
    if (!entityType) return;
    byType.set(entityType, uniqueIds([...(byType.get(entityType) ?? []), row.entity_id]));
  });

  const cardMap = new Map();
  for (const [entityType, ids] of byType) {
    if (!ids.length) continue;
    const { data, error } = await client
      .from("room_feed_cards")
      .select(CARD_COLUMNS)
      .eq("entity_type", entityType)
      .in("entity_id", ids);
    if (error) throw error;
    (data ?? []).forEach((row) => {
      cardMap.set(`${row.entity_type}:${row.entity_id}`, row);
    });
  }
  return cardMap;
}

async function fetchSourcesByType(client, rows = []) {
  const recruitingIds = uniqueIds(rows.filter((row) => row.entity_type === "recruiting").map((row) => row.entity_id));
  const matchIds = uniqueIds(rows.filter((row) => row.entity_type === "match").map((row) => row.entity_id));
  const sourceMap = new Map();

  if (recruitingIds.length) {
    const { data, error } = await client
      .from("recruiting_posts")
      .select(RECRUITING_SOURCE_COLUMNS)
      .in("id", recruitingIds);
    if (error) throw error;
    (data ?? []).forEach((row) => sourceMap.set(`recruiting:${row.id}`, row));
  }

  if (matchIds.length) {
    const { data, error } = await client
      .from("matches")
      .select(MATCH_SOURCE_COLUMNS)
      .in("id", matchIds);
    if (error) throw error;
    (data ?? []).forEach((row) => sourceMap.set(`match:${row.id}`, row));
  }

  return sourceMap;
}

function getCardJson(cardRow = {}) {
  const card = cardRow?.card_json;
  return card && typeof card === "object" && !Array.isArray(card) ? card : null;
}

function getCardInvalidReasons(feedRow = {}, cardRow = {}, sourceRow = {}) {
  const reasons = [];
  const card = getCardJson(cardRow);
  if (!card) return ["missing_card_json"];
  const cardId = String(card.id ?? card.entityId ?? card.entity_id ?? "").trim();
  if (cardId && cardId !== feedRow.entity_id) reasons.push("entity_id_mismatch");
  const cardStatus = String(card.status ?? "").trim();
  if (cardStatus && sourceRow?.status && cardStatus !== sourceRow.status) reasons.push("status_mismatch");
  if (feedRow.entity_type === "recruiting") {
    const roomState = card.roomState && typeof card.roomState === "object" ? card.roomState : {};
    const hasHost = Boolean(card.playerId || card.ownerId || card.hostId || card.host?.id || roomState.ownerId);
    if (!hasHost) reasons.push("missing_host_identity");
    if (!card.updatedAt && !card.updated_at && !cardRow.updated_at) reasons.push("missing_updated_at");
  }
  return reasons;
}

function getSourceClosedReason(feedRow = {}, sourceRow = {}) {
  if (!sourceRow) return "orphan_source_missing";
  if (feedRow.entity_type === "recruiting" && sourceRow.status !== "open") return `source_status_${sourceRow.status || "unknown"}`;
  if (feedRow.entity_type === "match" && ["closed", "cancelled", "void"].includes(String(sourceRow.status ?? ""))) {
    return `source_status_${sourceRow.status}`;
  }
  return "";
}

function samplePush(samples, key, value) {
  if (!samples[key]) samples[key] = [];
  if (samples[key].length < MAX_SAMPLE_LIMIT) samples[key].push(value);
}

async function checkFeedTriggers(client) {
  const { data, error } = await client.rpc("rankball_feed_trigger_health");
  if (error) {
    if (error.code === "PGRST202" || /not found|does not exist/i.test(error.message ?? "")) {
      return { ok: false, error: error.message || "feed_trigger_health_missing", triggers: [] };
    }
    throw error;
  }
  return { ok: true, triggers: data ?? [] };
}

function auditRows(rows = [], cardMap = new Map(), sourceMap = new Map()) {
  const counts = {
    activeFeedRows: rows.length,
    uniqueEntities: new Set(rows.map((row) => `${row.entity_type}:${row.entity_id}`)).size,
    missingCards: 0,
    orphanSources: 0,
    staleCards: 0,
    invalidCards: 0,
    activeButClosedSources: 0,
    feedStatusMismatches: 0,
  };
  const samples = {};

  rows.forEach((row) => {
    const key = `${row.entity_type}:${row.entity_id}`;
    const cardRow = cardMap.get(key);
    const sourceRow = sourceMap.get(key);
    if (!cardRow) {
      counts.missingCards += 1;
      samplePush(samples, "missingCards", { entityType: row.entity_type, entityId: row.entity_id, relation: row.relation, profileId: row.profile_id });
    }
    if (!sourceRow) {
      counts.orphanSources += 1;
      samplePush(samples, "orphanSources", { entityType: row.entity_type, entityId: row.entity_id, relation: row.relation, profileId: row.profile_id });
      return;
    }

    const sourceClosedReason = getSourceClosedReason(row, sourceRow);
    if (sourceClosedReason) {
      counts.activeButClosedSources += 1;
      samplePush(samples, "activeButClosedSources", { entityType: row.entity_type, entityId: row.entity_id, reason: sourceClosedReason });
    }

    if (row.status && sourceRow.status && row.status !== sourceRow.status) {
      counts.feedStatusMismatches += 1;
      samplePush(samples, "feedStatusMismatches", { entityType: row.entity_type, entityId: row.entity_id, feedStatus: row.status, sourceStatus: sourceRow.status });
    }

    if (cardRow) {
      const cardTime = asTime(cardRow.updated_at ?? cardRow.card_json?.updatedAt ?? cardRow.card_json?.updated_at);
      const sourceTime = asTime(sourceRow.updated_at);
      if (sourceTime && (!cardTime || cardTime + 1000 < sourceTime)) {
        counts.staleCards += 1;
        samplePush(samples, "staleCards", { entityType: row.entity_type, entityId: row.entity_id, cardUpdatedAt: cardRow.updated_at ?? null, sourceUpdatedAt: sourceRow.updated_at ?? null });
      }
      const invalidReasons = getCardInvalidReasons(row, cardRow, sourceRow);
      if (invalidReasons.length) {
        counts.invalidCards += 1;
        samplePush(samples, "invalidCards", { entityType: row.entity_type, entityId: row.entity_id, reasons: invalidReasons });
      }
    }
  });

  return { counts, samples };
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    assertAccess(request);
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    if (body.repair === true || body.cleanup === true) reject(400, "feed_audit_is_read_only");
    const client = getSupabaseAdminClient();
    const limit = getCappedLimit(getRequestValue(request, body, "limit", 200));
    const entityType = normalizeEntityType(getRequestValue(request, body, "entityType", ""));
    const feedRows = await fetchFeedRows(client, {
      entityType,
      profileId: String(getRequestValue(request, body, "profileId", "") || "").trim(),
      feedScope: String(getRequestValue(request, body, "feedScope", "") || "").trim(),
      regionKey: String(getRequestValue(request, body, "regionKey", "") || "").trim(),
      relation: String(getRequestValue(request, body, "relation", "") || "").trim(),
      limit,
    });
    const [cardMap, sourceMap, feedTriggerCheck] = await Promise.all([
      fetchCardsByType(client, feedRows),
      fetchSourcesByType(client, feedRows),
      checkFeedTriggers(client),
    ]);
    const audit = auditRows(feedRows, cardMap, sourceMap);
    sendJson(response, 200, {
      ok: true,
      readOnly: true,
      filters: { entityType: entityType || "all", limit },
      ...audit,
      feedTriggerCheck,
    });
  } catch (error) {
    if (isMissingTable(error, "user_room_feed") || isMissingTable(error, "room_feed_cards")) {
      sendJson(response, 200, { ok: false, readOnly: true, error: error.message || "feed_audit_table_missing" });
      return;
    }
    sendJson(response, error.statusCode || 500, { error: error.message || "feed_audit_failed" });
  }
}
