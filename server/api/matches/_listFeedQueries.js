import { isMissingUserRoomFeed, uniqueValues as unique } from "../_supabaseAdmin.js";
import { HOUR_MS } from "../../../shared/lib/matchConstants.js";
import { MATCH_LIST_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { REMOTE_CLIENT_ACTIVE_MATCH_LIMIT, REMOTE_CLIENT_MATCH_LIMIT, REMOTE_CLIENT_RECORD_MONTHS } from "../../../shared/lib/constants.js";
import { TERMINAL_MATCH_STATUS_VALUES } from "../../../shared/lib/notifications.js";
import { uniqueFeedCards } from "./_listProjection.js";
import { attachRoomFeedCards } from "./_listEnrichment.js";

export let userRoomFeedAvailable = true;

export function disableUserRoomFeed() {
  userRoomFeedAvailable = false;
}

export const MATCH_LIST_MAX_LIMIT = REMOTE_CLIENT_ACTIVE_MATCH_LIMIT;

export const ACTIVE_MATCH_EXCLUDED_STATUS_VALUES = Object.freeze(["confirmed", ...TERMINAL_MATCH_STATUS_VALUES]);

export const RECENT_COMPLETED_MATCH_HOURS = 24;

export const RECENT_COMPLETED_MATCH_MAX_HOURS = 24 * 31 * REMOTE_CLIENT_RECORD_MONTHS;

export const RECENT_COMPLETED_MATCH_LIMIT = 20;

export const CLOSED_NOTICE_MATCH_LIMIT = 20;

export const MATCH_FEED_ROW_MAX_LIMIT = 320;

export const MATCH_FEED_ROW_FACTOR = 4;

export const RECENT_COMPLETED_FEED_ROW_MAX_LIMIT = 80;

export const MATCH_TERMINAL_STATUS_FILTER = `(${ACTIVE_MATCH_EXCLUDED_STATUS_VALUES.join(",")})`;

export function getFeedOffsetCursor(value = "") {
  const text = String(value ?? "");
  if (!text.startsWith("feed:")) return 0;
  const offset = Number(text.slice(5));
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

export function getMineOffsetCursor(value = "") {
  const text = String(value ?? "");
  if (!text.startsWith("mine:")) return 0;
  const offset = Number(text.slice(5));
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

export function paginateMineMatchRows(rows, offset, limit) {
  const sortedRows = [...rows].sort((a, b) => (
    String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? ""))
      || String(b.id ?? "").localeCompare(String(a.id ?? ""))
  ));
  const pageRows = sortedRows.slice(offset, offset + limit);
  const nextOffset = offset + pageRows.length;
  return {
    rows: pageRows,
    cursor: nextOffset < sortedRows.length ? `mine:${nextOffset}` : "",
    exhausted: nextOffset >= sortedRows.length,
  };
}

export function isSafePostgrestLiteral(value = "") {
  return /^[A-Za-z0-9_:-]+$/.test(String(value ?? ""));
}

export function isLegacyListFallbackAllowed(body = {}) {
  return body.allowLegacyFallback === true || process.env.RANKBALL_ALLOW_LEGACY_LIST_FALLBACK === "true";
}

export function getCappedLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_MATCH_LIMIT;
  return Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Math.floor(number)));
}

export function getCompletedSince(body = {}) {
  const explicit = String(body.completedSince ?? body.completedAfter ?? "").trim();
  if (explicit) {
    const date = new Date(explicit);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  const months = Number(body.completedMonths);
  if (Number.isFinite(months) && months > 0) {
    const date = new Date();
    date.setMonth(date.getMonth() - Math.min(120, Math.floor(months)));
    return date.toISOString();
  }
  return "";
}

export function getRecentCompletedHours(body = {}) {
  const requested = Number(body.recentCompletedHours ?? body.completedHours);
  if (!Number.isFinite(requested) || requested <= 0) return RECENT_COMPLETED_MATCH_HOURS;
  return Math.max(1, Math.min(RECENT_COMPLETED_MATCH_MAX_HOURS, Math.floor(requested)));
}

export async function fetchMatchFeedPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "", activeOnly = false) {
  if (!profileId || !userRoomFeedAvailable) return null;
  if (String(cursor ?? "").startsWith("mine:")) return null;
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const offset = getFeedOffsetCursor(cursor);
  const { data: rpcData, error: rpcError } = await client.rpc("rankball_match_list", {
    p_profile_id: profileId,
    p_limit: cappedLimit,
    p_cursor: cursor,
    p_active_only: activeOnly,
  });
  if (!rpcError) {
    const rows = Array.isArray(rpcData?.rows) ? rpcData.rows : [];
    const ids = unique(rows.map((row) => row?.entity_id ?? row?.entityId).filter(Boolean));
    const cards = uniqueFeedCards(rows, ids);
    const hasAllCards = cards.length === ids.length;
    return {
      ids,
      cards,
      cursor: String(rpcData?.cursor ?? ""),
      exhausted: rpcData?.exhausted !== false,
      source: hasAllCards ? "rpc_card" : (cards.length ? "rpc_card_partial" : "rpc"),
    };
  }
  if (!isMissingUserRoomFeed(rpcError) && rpcError?.code !== "PGRST202") throw rpcError;

  const rowLimit = Math.min(MATCH_FEED_ROW_MAX_LIMIT, cappedLimit * MATCH_FEED_ROW_FACTOR);
  let query = client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation,status")
    .eq("entity_type", "match")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .neq("status", "closed")
    .in("relation", ["owner", "participant", "referee"]);
  if (activeOnly) query = query.not("status", "in", "(confirmed,closed)");
  const { data, error } = await query
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(offset, offset + rowLimit - 1);
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("Match feed skipped.", error.message);
      return null;
    }
    throw error;
  }
  const ids = unique((data ?? []).map((row) => row?.entity_id)).slice(0, cappedLimit);
  const feedRows = await attachRoomFeedCards(client, data ?? [], "match");
  const rows = feedRows.filter((row) => ids.includes(row?.entity_id));
  const cards = uniqueFeedCards(rows, ids);
  return {
    ids,
    cards,
    cursor: ids.length ? `feed:${offset + (data ?? []).length}` : "",
    exhausted: (data ?? []).length < rowLimit,
    source: cards.length === ids.length ? "feed_card" : (cards.length ? "feed_card_partial" : "feed"),
  };
}

export async function fetchRecentCompletedMatchFeedPage(client, profileId = "", hours = RECENT_COMPLETED_MATCH_HOURS, limit = RECENT_COMPLETED_MATCH_LIMIT) {
  if (!profileId || !userRoomFeedAvailable) return null;
  const cappedLimit = Math.max(1, Math.min(RECENT_COMPLETED_MATCH_LIMIT, Number(limit) || RECENT_COMPLETED_MATCH_LIMIT));
  const since = new Date(Date.now() - Math.max(1, Number(hours) || RECENT_COMPLETED_MATCH_HOURS) * HOUR_MS).toISOString();
  const rowLimit = Math.min(RECENT_COMPLETED_FEED_ROW_MAX_LIMIT, cappedLimit * MATCH_FEED_ROW_FACTOR);
  const { data, error } = await client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation,status")
    .eq("entity_type", "match")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .eq("status", "confirmed")
    .gte("sort_at", since)
    .in("relation", ["owner", "participant", "referee"])
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(0, rowLimit - 1);
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("Recent completed match feed skipped.", error.message);
      return null;
    }
    throw error;
  }
  const ids = unique((data ?? []).map((row) => row?.entity_id)).slice(0, cappedLimit);
  return {
    ids,
    cards: [],
    source: "recent_completed_feed",
  };
}

export async function fetchClosedNoticeMatchFeedPage(client, profileId = "", limit = CLOSED_NOTICE_MATCH_LIMIT) {
  if (!profileId || !userRoomFeedAvailable) return null;
  const cappedLimit = Math.max(1, Math.min(CLOSED_NOTICE_MATCH_LIMIT, Number(limit) || CLOSED_NOTICE_MATCH_LIMIT));
  const rowLimit = Math.min(RECENT_COMPLETED_FEED_ROW_MAX_LIMIT, cappedLimit * MATCH_FEED_ROW_FACTOR);
  const { data, error } = await client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation,status")
    .eq("entity_type", "match")
    .eq("profile_id", profileId)
    .eq("is_active", false)
    .in("status", ["cancelled", "void"])
    .in("relation", ["owner", "participant", "referee"])
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(0, rowLimit - 1);
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("Closed notice match feed skipped.", error.message);
      return null;
    }
    throw error;
  }
  const ids = unique((data ?? []).map((row) => row?.entity_id)).slice(0, cappedLimit);
  const feedRows = await attachRoomFeedCards(client, data ?? [], "match");
  const rows = feedRows.filter((row) => ids.includes(row?.entity_id));
  const cards = uniqueFeedCards(rows, ids).map((card) => ({ ...card, closedNotice: true }));
  return {
    ids,
    cards,
    source: cards.length === ids.length
      ? "closed_notice_feed_card"
      : (cards.length ? "closed_notice_feed_card_partial" : "closed_notice_feed"),
  };
}

export function mergeMatchFeedPages(feedPage, extraPage) {
  if (!extraPage?.ids?.length) return feedPage;
  if (!feedPage) return { ...extraPage, cursor: "", exhausted: true };
  const ids = unique([...(feedPage.ids ?? []), ...(extraPage.ids ?? [])]);
  const cardMap = new Map((feedPage.cards ?? []).filter((card) => card?.id).map((card) => [card.id, card]));
  (extraPage.cards ?? []).forEach((card) => {
    if (!card?.id) return;
    const currentCard = cardMap.get(card.id);
    if (!currentCard || card.closedNotice === true) {
      cardMap.set(card.id, currentCard ? { ...currentCard, ...card } : card);
    }
  });
  const cards = ids.map((id) => cardMap.get(id)).filter(Boolean);
  const hasAllCards = cards.length === ids.length;
  return {
    ...feedPage,
    ids,
    cards,
    source: hasAllCards && feedPage.source === "rpc_card" && extraPage.source === "recent_completed_feed_card"
      ? "rpc_card+recent_completed"
      : feedPage.source,
  };
}

export async function fetchMatchRowsByIds(client, matchIds = []) {
  const ids = unique(matchIds);
  if (!ids.length) return [];
  const { data, error } = await client
    .from("matches")
    .select(MATCH_LIST_COLUMNS)
    .in("id", ids);
  if (error) throw error;
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...(data ?? [])].sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
}
