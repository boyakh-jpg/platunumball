import { isMissingUserRoomFeed, uniqueValues as unique } from "../_supabaseAdmin.js";
import { HOUR_MS } from "../../../shared/lib/matchConstants.js";
import { MATCH_LIST_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { REMOTE_CLIENT_ACTIVE_MATCH_LIMIT, REMOTE_CLIENT_MATCH_LIMIT, REMOTE_CLIENT_RECORD_MONTHS } from "../../../shared/lib/constants.js";
import { TERMINAL_MATCH_STATUS_VALUES } from "../../../shared/lib/notifications.js";

import { uniqueFeedCards } from "./_listProjection.js";
import { attachRoomFeedCards } from "./_listEnrichment.js";

let userRoomFeedAvailable = true;

let relatedActiveMatchListAvailable = true;

const MATCH_LIST_MAX_LIMIT = REMOTE_CLIENT_ACTIVE_MATCH_LIMIT;

const ACTIVE_MATCH_EXCLUDED_STATUS_VALUES = Object.freeze(["confirmed", ...TERMINAL_MATCH_STATUS_VALUES]);

const ACTIVE_MATCH_EXCLUDED_STATUSES = new Set(ACTIVE_MATCH_EXCLUDED_STATUS_VALUES);

export const RECENT_COMPLETED_MATCH_HOURS = 24;

const RECENT_COMPLETED_MATCH_MAX_HOURS = 24 * 31 * REMOTE_CLIENT_RECORD_MONTHS;

const RECENT_COMPLETED_MATCH_LIMIT = 20;

const CLOSED_NOTICE_MATCH_LIMIT = 20;

const MATCH_FEED_ROW_MAX_LIMIT = 320;

const MATCH_FEED_ROW_FACTOR = 4;

const RECENT_COMPLETED_FEED_ROW_MAX_LIMIT = 80;

export const MATCH_RELATED_FALLBACK_MAX_LIMIT = 80;

const MATCH_TERMINAL_STATUS_FILTER = `(${ACTIVE_MATCH_EXCLUDED_STATUS_VALUES.join(",")})`;

function getFeedOffsetCursor(value = "") {
  const text = String(value ?? "");
  if (!text.startsWith("feed:")) return 0;
  const offset = Number(text.slice(5));
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

function getMineOffsetCursor(value = "") {
  const text = String(value ?? "");
  if (!text.startsWith("mine:")) return 0;
  const offset = Number(text.slice(5));
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

function paginateMineMatchRows(rows, offset, limit) {
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

function isSafePostgrestLiteral(value = "") {
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

async function fetchJsonActorMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  if (!profileId) return [];
  const candidateLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const filters = [
    ["played_player_ids", { teamA: [profileId] }],
    ["played_player_ids", { teamB: [profileId] }],
    ["reserve_players", { teamA: [profileId] }],
    ["reserve_players", { teamB: [profileId] }],
  ];
  const results = await Promise.all(filters.map(([column, value]) => (
    client
      .from("matches")
      .select("id")
      .not("status", "in", MATCH_TERMINAL_STATUS_FILTER)
      .contains(column, value)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(candidateLimit)
  )));
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  return unique(results.flatMap((result) => (result.data ?? []).map((row) => row.id))).slice(0, candidateLimit);
}

async function fetchDirectActorMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  if (!profileId) return [];
  const candidateLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const [jsonActorMatchIds, playerResult, ownerResult] = await Promise.all([
    fetchJsonActorMatchIds(client, profileId, limit),
    client
      .from("match_players")
      .select("match_id")
      .eq("user_id", profileId)
      .limit(candidateLimit),
    client
      .from("matches")
      .select("id")
      .not("status", "in", MATCH_TERMINAL_STATUS_FILTER)
      .or(`created_by.eq.${profileId},referee_id.eq.${profileId},former_referee_id.eq.${profileId}`)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(candidateLimit),
  ]);
  if (playerResult.error) throw playerResult.error;
  if (ownerResult.error) throw ownerResult.error;
  const playerMatchIds = unique((playerResult.data ?? []).map((row) => row.match_id));
  const activePlayerResult = playerMatchIds.length
    ? await client
        .from("matches")
        .select("id")
        .in("id", playerMatchIds)
        .not("status", "in", MATCH_TERMINAL_STATUS_FILTER)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(candidateLimit)
    : { data: [], error: null };
  if (activePlayerResult.error) throw activePlayerResult.error;
  return unique([
    ...jsonActorMatchIds,
    ...(activePlayerResult.data ?? []).map((row) => row.id),
    ...(ownerResult.data ?? []).map((row) => row.id),
  ]).slice(0, candidateLimit);
}

async function fetchTeamRelatedMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, options = {}) {
  if (!profileId) return [];
  let memberQuery = client
    .from("team_members")
    .select("team_id,role")
    .eq("user_id", profileId)
    .limit(20);
  if (options.captainOnly === true) memberQuery = memberQuery.eq("role", "captain");
  const { data: memberRows, error: memberError } = await memberQuery;
  if (memberError) throw memberError;
  const teamIds = unique((memberRows ?? []).map((row) => row.team_id));
  if (!teamIds.length) return [];

  const queryLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const getTeamIds = (column) => {
    let query = client
      .from("matches")
      .select("id")
      .in(column, teamIds)
      .not("status", "in", MATCH_TERMINAL_STATUS_FILTER);
    if (options.tournamentOnly === true) query = query.not("tournament_id", "is", null);
    return query
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(queryLimit);
  };
  const [teamARows, teamBRows] = await Promise.all([getTeamIds("team_a_id"), getTeamIds("team_b_id")]);
  if (teamARows.error) throw teamARows.error;
  if (teamBRows.error) throw teamBRows.error;
  return unique([
    ...(teamARows.data ?? []).map((row) => row.id),
    ...(teamBRows.data ?? []).map((row) => row.id),
  ]).slice(0, queryLimit);
}

async function fetchRelatedActiveMatchFallback(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, includeTeamSchedule = false) {
  const [directIds, captainTournamentIds, memberTeamIds] = await Promise.all([
    fetchDirectActorMatchIds(client, profileId, limit),
    fetchTeamRelatedMatchIds(client, profileId, limit, { captainOnly: true, tournamentOnly: true }),
    includeTeamSchedule
      ? fetchTeamRelatedMatchIds(client, profileId, limit)
      : Promise.resolve([]),
  ]);
  const captainSet = new Set(captainTournamentIds);
  const memberSet = new Set(memberTeamIds);
  return {
    rows: unique([...directIds, ...captainTournamentIds, ...memberTeamIds])
      .slice(0, Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT)))
      .map((id) => ({
        id,
        directActor: directIds.includes(id),
        captainTournament: captainSet.has(id),
        memberTeam: memberSet.has(id),
      })),
    source: "bounded_fallback",
  };
}

export async function fetchRelatedActiveMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, includeTeamSchedule = false) {
  if (!profileId) return { rows: [], source: "none" };
  const cappedLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  if (relatedActiveMatchListAvailable) {
    const { data, error } = await client.rpc("rankball_related_active_match_list", {
      p_profile_id: profileId,
      p_limit: cappedLimit,
      p_include_team_schedule: includeTeamSchedule,
    });
    if (!error) {
      return {
        rows: Array.isArray(data?.rows) ? data.rows : [],
        source: "rpc",
      };
    }
    if (error.code !== "PGRST202" && error.code !== "42883") throw error;
    relatedActiveMatchListAvailable = false;
    console.warn("Related active match RPC unavailable; using bounded fallback.", error.message);
  }
  return fetchRelatedActiveMatchFallback(client, profileId, cappedLimit, includeTeamSchedule);
}

async function fetchCurrentUserMatchCandidateIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, includeJsonActors = false) {
  if (!profileId) return [];
  const candidateLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const [
    { data: playerRows, error: playerError },
    { data: relatedRows, error: relatedError },
  ] = await Promise.all([
    client
      .from("match_players")
      .select("match_id")
      .eq("user_id", profileId)
      .limit(candidateLimit),
    client
      .from("matches")
      .select("id")
      .or(`created_by.eq.${profileId},referee_id.eq.${profileId},former_referee_id.eq.${profileId}`)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(candidateLimit),
  ]);
  if (playerError) throw playerError;
  if (relatedError) throw relatedError;
  const jsonActorIds = includeJsonActors
    ? await fetchJsonActorMatchIds(client, profileId, limit)
    : [];
  const captainTournamentIds = await fetchTeamRelatedMatchIds(client, profileId, limit, { captainOnly: true, tournamentOnly: true });
  return unique([
    ...(playerRows ?? []).map((row) => row.match_id),
    ...(relatedRows ?? []).map((row) => row.id),
    ...jsonActorIds,
    ...captainTournamentIds,
  ]).slice(0, candidateLimit);
}

export async function fetchCurrentUserMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "", activeOnly = false, includeJsonActors = false) {
  if (!profileId) return null;
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const offset = getMineOffsetCursor(cursor);
  if (includeJsonActors && activeOnly && isSafePostgrestLiteral(profileId)) {
    const relatedPage = await fetchRelatedActiveMatchPage(
      client,
      profileId,
      Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, offset + cappedLimit),
      false,
    );
    const relatedIds = unique((relatedPage.rows ?? []).map((row) => row?.id));
    const relatedRows = await fetchMatchRowsByIds(client, relatedIds);
    const filteredRows = relatedRows
      .filter((row) => ["agreed", "approval", "disputed"].includes(String(row.status ?? "")));
    return paginateMineMatchRows(filteredRows, offset, cappedLimit);
  }
  const candidateIds = await fetchCurrentUserMatchCandidateIds(client, profileId, cappedLimit, includeJsonActors);
  if (!candidateIds.length) {
    return { rows: [], cursor: "", exhausted: true };
  }
  const rows = await fetchMatchRowsByIds(client, candidateIds);
  const filteredRows = activeOnly
    ? rows.filter((row) => !ACTIVE_MATCH_EXCLUDED_STATUSES.has(String(row.status ?? "")))
    : rows;
  return paginateMineMatchRows(filteredRows, offset, cappedLimit);
}

export async function fetchPlayMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "") {
  if (!profileId) return { rows: [], cursor: "", exhausted: true };
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const offset = getMineOffsetCursor(cursor);
  const candidateIds = await fetchCurrentUserMatchCandidateIds(
    client,
    profileId,
    offset + cappedLimit,
    true,
  );
  const rows = await fetchMatchRowsByIds(client, candidateIds);
  const filteredRows = rows.filter((row) => ["agreed", "approval", "disputed"].includes(String(row.status ?? "")));
  return paginateMineMatchRows(filteredRows, offset, cappedLimit);
}

async function fetchCurrentUserCompletedFallbackMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, completedSince = "") {
  if (!profileId) return { ids: [], exhausted: true, source: "completed_fallback" };
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const rowLimit = Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Math.max(cappedLimit, cappedLimit * 2));
  const { data: playerRows, error: playerError } = await client
    .from("match_players")
    .select("match_id")
    .eq("user_id", profileId)
    .limit(rowLimit);
  if (playerError) throw playerError;
  const candidateIds = unique((playerRows ?? []).map((row) => row?.match_id)).slice(0, rowLimit);
  if (!candidateIds.length) return { ids: [], exhausted: true, source: "completed_fallback" };
  const rows = await fetchMatchRowsByIds(client, candidateIds);
  const ids = rows
    .filter((row) => {
      if (row.status !== "confirmed") return false;
      if (!completedSince) return true;
      const rowTime = row.confirmed_at ?? row.updated_at ?? row.scheduled_at ?? row.created_at ?? "";
      return String(rowTime) >= completedSince;
    })
    .sort((a, b) => String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? "")))
    .map((row) => row.id)
    .slice(0, cappedLimit);
  return {
    ids,
    exhausted: candidateIds.length < rowLimit || ids.length < cappedLimit,
    source: "completed_fallback",
  };
}

export async function fetchCurrentUserCompletedMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, completedSince = "", allowLegacyFallback = false) {
  if (!profileId) return { ids: [], cards: [], exhausted: true, source: "completed_feed" };
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const rowLimit = cappedLimit;
  if (!userRoomFeedAvailable) {
    if (!allowLegacyFallback) return { ids: [], cards: [], exhausted: true, source: "completed_feed_unavailable" };
    return fetchCurrentUserCompletedFallbackMatchIds(client, profileId, cappedLimit, completedSince);
  }
  let query = client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation,status")
    .eq("entity_type", "match")
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .eq("status", "confirmed")
    .eq("relation", "participant");
  if (completedSince) query = query.gte("sort_at", completedSince);
  const { data, error } = await query
    .order("sort_at", { ascending: false, nullsFirst: false })
    .order("entity_id", { ascending: false })
    .range(0, rowLimit - 1);
  if (error) {
    if (isMissingUserRoomFeed(error)) {
      userRoomFeedAvailable = false;
      console.warn("Completed match feed skipped.", error.message);
      if (!allowLegacyFallback) return { ids: [], cards: [], exhausted: true, source: "completed_feed_unavailable" };
      return fetchCurrentUserCompletedFallbackMatchIds(client, profileId, cappedLimit, completedSince);
    }
    throw error;
  }
  const rows = await attachRoomFeedCards(client, data ?? [], "match");
  const ids = unique(rows.map((row) => row?.entity_id)).slice(0, cappedLimit);
  const cards = uniqueFeedCards(rows, ids);
  return {
    ids,
    cards,
    exhausted: rows.length < rowLimit || ids.length < cappedLimit,
    source: cards.length === ids.length ? "completed_feed_card" : (cards.length ? "completed_feed_card_partial" : "completed_feed"),
  };
}
