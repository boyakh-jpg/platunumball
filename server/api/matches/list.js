import {
  fetchCourtRowsByIds,
  flattenIdValues,
  firstRowBy as firstBy,
  getAdminLevel,
  getAuthenticatedContext,
  groupRowsBy as groupBy,
  isMissingRoomFeedCards,
  isMissingUserRoomFeed,
  loadCurrentUserTournamentIndex,
  mergeById,
  readJsonBody,
  sendJson,
  toDateTime,
  timeStep,
  uniqueValues as unique,
} from "../_supabaseAdmin.js";
import {
  normalizeState,
} from "../../../src/data/repository.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../src/data/profileMappers.js";
import { DEFAULT_SETTINGS } from "../../../src/data/repositoryDefaults.js";
import {
  COURT_COLUMNS,
  MATCH_LIST_COLUMNS,
  MATCH_PLAYER_COLUMNS,
  MATCH_RESULT_COLUMNS,
  PLAYER_STAT_COLUMNS,
  PROFILE_CARD_COLUMNS,
  PROFILE_ME_COLUMNS,
  TEAM_COLUMNS,
} from "../../../src/data/repositoryColumns.js";
import {
  MATCH_SIDE_FALLBACK_NAMES,
  REMOTE_CLIENT_ACTIVE_MATCH_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
} from "../../../src/lib/constants.js";
import { loadCurrentUserRecruitingFeedList } from "../recruiting/list.js";
import { getMatchRoomPhase, isMatchClosedNotice, isMatchRecordMatch, isPersonalRecordMatch, isSeedSampleMatch } from "../../../src/lib/matchUtils.js";

let userRoomFeedAvailable = true;
const MATCH_LIST_MAX_LIMIT = REMOTE_CLIENT_ACTIVE_MATCH_LIMIT;
const ACTIVE_MATCH_EXCLUDED_STATUSES = new Set(["confirmed", "closed"]);
const ACTIVE_MATCH_EXCLUDED_PHASES = new Set(["record"]);
const RECENT_COMPLETED_MATCH_HOURS = 24;
const RECENT_COMPLETED_MATCH_MAX_HOURS = 24 * 31 * REMOTE_CLIENT_RECORD_MONTHS;
const RECENT_COMPLETED_MATCH_LIMIT = 20;
const CLOSED_NOTICE_MATCH_LIMIT = 20;
const MATCH_FEED_ROW_MAX_LIMIT = 320;
const MATCH_FEED_ROW_FACTOR = 4;
const RECENT_COMPLETED_FEED_ROW_MAX_LIMIT = 80;
const MATCH_CANDIDATE_MIN_LIMIT = 80;
const MATCH_CANDIDATE_MAX_LIMIT = 500;
const MATCH_CANDIDATE_LIMIT_FACTOR = 10;

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

function sortByFeedOrder(items = [], ids = []) {
  const order = new Map((ids ?? []).filter(Boolean).map((id, index) => [id, index]));
  return [...(items ?? [])].sort((a, b) => {
    const orderA = order.has(a?.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const orderB = order.has(b?.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return String(b?.updatedAt ?? b?.createdAt ?? "").localeCompare(String(a?.updatedAt ?? a?.createdAt ?? ""));
  });
}

function appendRowFallbackSource(source = "feed") {
  return String(source).includes("+row") ? source : `${source}+row`;
}

function mergeMatchCardsWithRows(cards = [], rows = []) {
  const merged = new Map((cards ?? []).filter((match) => match?.id).map((match) => [match.id, match]));
  (rows ?? []).forEach((rowMatch) => {
    if (!rowMatch?.id) return;
    const cardMatch = merged.get(rowMatch.id);
    merged.set(rowMatch.id, cardMatch
      ? {
          ...cardMatch,
          ...rowMatch,
          agreements: rowMatch.agreements?.teamA?.length || rowMatch.agreements?.teamB?.length ? rowMatch.agreements : cardMatch.agreements,
          approvals: rowMatch.approvals?.teamA?.length || rowMatch.approvals?.teamB?.length ? rowMatch.approvals : cardMatch.approvals,
          disputes: rowMatch.disputes?.length ? rowMatch.disputes : cardMatch.disputes,
          result: rowMatch.result ?? cardMatch.result ?? null,
        }
      : rowMatch);
  });
  return [...merged.values()];
}

function mergeMatchRowsById(rows = [], extraRows = []) {
  const merged = new Map((rows ?? []).filter((row) => row?.id).map((row) => [row.id, row]));
  (extraRows ?? []).forEach((row) => {
    if (row?.id) merged.set(row.id, row);
  });
  return [...merged.values()];
}

function isSafePostgrestLiteral(value = "") {
  return /^[A-Za-z0-9_:-]+$/.test(String(value ?? ""));
}

function isLegacyListFallbackAllowed(body = {}) {
  return body.allowLegacyFallback === true || process.env.RANKBALL_ALLOW_LEGACY_LIST_FALLBACK === "true";
}

function normalizeFeedCard(row = {}) {
  const card = row?.card_json ?? row?.cardJson ?? row?.card ?? null;
  if (!card || typeof card !== "object" || Array.isArray(card)) return null;
  const id = card.id ?? row.entity_id ?? row.entityId;
  const relations = Array.isArray(row?.relations)
    ? row.relations
    : [row?.relation].filter(Boolean);
  const nextCard = id ? { ...card, id } : null;
  if (!nextCard?.teamA || typeof nextCard.teamA !== "object") return null;
  if (!nextCard?.teamB || typeof nextCard.teamB !== "object") return null;
  const hasTeamACount = Number.isFinite(Number(nextCard.teamA.count));
  const hasTeamBCount = Number.isFinite(Number(nextCard.teamB.count));
  if (!Array.isArray(nextCard.teamA.players) && !hasTeamACount) return null;
  if (!Array.isArray(nextCard.teamB.players) && !hasTeamBCount) return null;
  return {
    ...nextCard,
    __feedRelations: relations,
    teamA: {
      ...nextCard.teamA,
      players: Array.isArray(nextCard.teamA.players) ? nextCard.teamA.players : [],
      count: hasTeamACount ? Number(nextCard.teamA.count) : nextCard.teamA.players.length,
    },
    teamB: {
      ...nextCard.teamB,
      players: Array.isArray(nextCard.teamB.players) ? nextCard.teamB.players : [],
      count: hasTeamBCount ? Number(nextCard.teamB.count) : nextCard.teamB.players.length,
    },
  };
}

function uniqueFeedCards(rows = [], ids = []) {
  const idSet = new Set(ids);
  const cards = new Map();
  (rows ?? []).forEach((row) => {
    const id = row?.entity_id ?? row?.entityId;
    if (!id || !idSet.has(id) || cards.has(id)) return;
    const card = normalizeFeedCard(row);
    if (card) cards.set(id, card);
  });
  return ids.map((id) => cards.get(id)).filter(Boolean);
}

async function attachRoomFeedCards(client, rows = [], entityType = "match") {
  const ids = unique(rows.map((row) => row?.entity_id));
  if (!ids.length) return rows;
  const { data, error } = await client
    .from("room_feed_cards")
    .select("entity_id,card_json")
    .eq("entity_type", entityType)
    .in("entity_id", ids);
  if (error) {
    if (isMissingRoomFeedCards(error)) return rows;
    throw error;
  }
  const cardById = new Map((data ?? []).map((row) => [row.entity_id, row.card_json]));
  return rows.map((row) => ({
    ...row,
    card_json: cardById.get(row?.entity_id) ?? row?.card_json ?? {},
  }));
}

function collectMissingMatchCardReferences(cards = []) {
  return {
    teamIds: unique((cards ?? []).flatMap((match) => [
      match?.teamA?.teamId && !match?.teamA?.name ? match.teamA.teamId : "",
      match?.teamB?.teamId && !match?.teamB?.name ? match.teamB.teamId : "",
    ])),
    courtIds: unique((cards ?? []).map((match) => (match?.courtId && !match?.court ? match.courtId : ""))),
  };
}

function attachMatchCardReferences(match = {}, teamById = {}, courtById = {}) {
  if (!match?.id) return match;
  const courtName = match.court ?? courtById[match.courtId]?.name;
  const teamAId = match.teamA?.teamId;
  const teamBId = match.teamB?.teamId;
  return {
    ...match,
    ...(courtName ? { court: courtName } : {}),
    teamA: {
      ...(match.teamA ?? {}),
      name: match.teamA?.name ?? teamById[teamAId]?.name ?? MATCH_SIDE_FALLBACK_NAMES.teamA,
    },
    teamB: {
      ...(match.teamB ?? {}),
      name: match.teamB?.name ?? teamById[teamBId]?.name ?? MATCH_SIDE_FALLBACK_NAMES.teamB,
    },
  };
}

async function attachMatchPlayerCountsToCards(client, matches = [], debugTiming = null) {
  const ids = unique((matches ?? []).map((match) => match?.id));
  if (!ids.length) return matches;
  const { data, error } = await timeStep(debugTiming, "cardPlayerCountsMs", () => (
    client.from("match_players").select("match_id,side,user_id").in("match_id", ids)
  ));
  if (error) throw error;
  const countsByMatch = new Map(ids.map((id) => [id, { teamA: new Set(), teamB: new Set() }]));
  (data ?? []).forEach((row) => {
    const matchId = row?.match_id;
    const side = row?.side;
    const userId = row?.user_id;
    if (!matchId || !["teamA", "teamB"].includes(side) || !userId) return;
    if (!countsByMatch.has(matchId)) {
      countsByMatch.set(matchId, { teamA: new Set(), teamB: new Set() });
    }
    countsByMatch.get(matchId)[side].add(userId);
  });
  return matches.map((match) => {
    const counts = countsByMatch.get(match?.id);
    return {
      ...match,
      teamA: { ...(match.teamA ?? {}), count: counts.teamA.size },
      teamB: { ...(match.teamB ?? {}), count: counts.teamB.size },
    };
  });
}

function isSoloRecordMatch(match = {}) {
  return isPersonalRecordMatch(match);
}

function filterActiveMatchCards(matches = [], activeOnly = false, options = {}) {
  const visibleMatches = (matches ?? []).filter((match) => !isSeedSampleMatch(match));
  if (!activeOnly) return visibleMatches;
  const includeRecentCompleted = options.includeRecentCompleted === true;
  const includeRecordRooms = options.includeRecordRooms === true;
  return visibleMatches.filter((match) => (
    match?.status !== "closed" && (
      (includeRecentCompleted && match?.recentCompleted) ||
      ((includeRecordRooms || (!isSoloRecordMatch(match) && !isMatchRecordMatch(match))) && (
        isMatchClosedNotice(match) ||
        (!ACTIVE_MATCH_EXCLUDED_PHASES.has(getMatchRoomPhase(match).phase) && !match?.recentCompleted)
      ))
    )
  ));
}

function getCappedLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return REMOTE_CLIENT_MATCH_LIMIT;
  return Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Math.floor(number)));
}

function getCompletedSince(body = {}) {
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

function getRecentCompletedHours(body = {}) {
  const requested = Number(body.recentCompletedHours ?? body.completedHours);
  if (!Number.isFinite(requested) || requested <= 0) return RECENT_COMPLETED_MATCH_HOURS;
  return Math.max(1, Math.min(RECENT_COMPLETED_MATCH_MAX_HOURS, Math.floor(requested)));
}

async function fetchMatchFeedPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "", activeOnly = false) {
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
    .select("entity_id,sort_at,relation")
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

async function fetchRecentCompletedMatchFeedPage(client, profileId = "", hours = RECENT_COMPLETED_MATCH_HOURS, limit = RECENT_COMPLETED_MATCH_LIMIT) {
  if (!profileId || !userRoomFeedAvailable) return null;
  const cappedLimit = Math.max(1, Math.min(RECENT_COMPLETED_MATCH_LIMIT, Number(limit) || RECENT_COMPLETED_MATCH_LIMIT));
  const since = new Date(Date.now() - Math.max(1, Number(hours) || RECENT_COMPLETED_MATCH_HOURS) * 60 * 60 * 1000).toISOString();
  const rowLimit = Math.min(RECENT_COMPLETED_FEED_ROW_MAX_LIMIT, cappedLimit * MATCH_FEED_ROW_FACTOR);
  const { data, error } = await client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation")
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

async function fetchClosedNoticeMatchFeedPage(client, profileId = "", limit = CLOSED_NOTICE_MATCH_LIMIT) {
  if (!profileId || !userRoomFeedAvailable) return null;
  const cappedLimit = Math.max(1, Math.min(CLOSED_NOTICE_MATCH_LIMIT, Number(limit) || CLOSED_NOTICE_MATCH_LIMIT));
  const rowLimit = Math.min(RECENT_COMPLETED_FEED_ROW_MAX_LIMIT, cappedLimit * MATCH_FEED_ROW_FACTOR);
  const { data, error } = await client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation")
    .eq("entity_type", "match")
    .eq("profile_id", profileId)
    .eq("is_active", true)
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

function mergeMatchFeedPages(feedPage, extraPage) {
  if (!extraPage?.ids?.length) return feedPage;
  if (!feedPage) return { ...extraPage, cursor: "", exhausted: true };
  const ids = unique([...(feedPage.ids ?? []), ...(extraPage.ids ?? [])]);
  const cardMap = new Map();
  [...(feedPage.cards ?? []), ...(extraPage.cards ?? [])].forEach((card) => {
    if (card?.id && !cardMap.has(card.id)) cardMap.set(card.id, card);
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

async function fetchMatchRowsByIds(client, matchIds = []) {
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
  const candidateLimit = Math.max(
    MATCH_CANDIDATE_MIN_LIMIT,
    Math.min(MATCH_CANDIDATE_MAX_LIMIT, Number(limit || REMOTE_CLIENT_MATCH_LIMIT) * MATCH_CANDIDATE_LIMIT_FACTOR),
  );
  const filters = [
    ["stat_recorders", { teamA: profileId }],
    ["stat_recorders", { teamB: profileId }],
    ["played_player_ids", { teamA: [profileId] }],
    ["played_player_ids", { teamB: [profileId] }],
    ["reserve_players", { teamA: [profileId] }],
    ["reserve_players", { teamB: [profileId] }],
  ];
  const results = await Promise.all(filters.map(([column, value]) => (
    client
      .from("matches")
      .select("id")
      .not("status", "in", "(confirmed,closed)")
      .contains(column, value)
      .limit(candidateLimit)
  )));
  const error = results.find((result) => result.error)?.error;
  if (error) throw error;
  return unique(results.flatMap((result) => (result.data ?? []).map((row) => row.id)));
}

async function fetchCaptainTournamentMatchRows(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  return [];
}

async function fetchCurrentUserMatchCandidateIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, includeJsonActors = false) {
  if (!profileId) return [];
  const candidateLimit = Math.max(
    MATCH_CANDIDATE_MIN_LIMIT,
    Math.min(MATCH_CANDIDATE_MAX_LIMIT, Number(limit || REMOTE_CLIENT_MATCH_LIMIT) * MATCH_CANDIDATE_LIMIT_FACTOR),
  );
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
  const captainTournamentRows = await fetchCaptainTournamentMatchRows(client, profileId, limit);
  return unique([
    ...(playerRows ?? []).map((row) => row.match_id),
    ...(relatedRows ?? []).map((row) => row.id),
    ...jsonActorIds,
    ...captainTournamentRows.map((row) => row.id),
  ]);
}

async function fetchCurrentUserMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "", activeOnly = false, includeJsonActors = false) {
  if (!profileId) return null;
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const offset = getMineOffsetCursor(cursor);
  if (includeJsonActors && activeOnly && isSafePostgrestLiteral(profileId)) {
    const candidateLimit = Math.max(
      MATCH_CANDIDATE_MIN_LIMIT,
      Math.min(MATCH_CANDIDATE_MAX_LIMIT, cappedLimit * MATCH_CANDIDATE_LIMIT_FACTOR),
    );
    const containsJson = (value) => JSON.stringify(value);
    const actorFilter = [
      `created_by.eq.${profileId}`,
      `referee_id.eq.${profileId}`,
      `former_referee_id.eq.${profileId}`,
      `stat_recorders.cs.${containsJson({ teamA: profileId })}`,
      `stat_recorders.cs.${containsJson({ teamB: profileId })}`,
      `played_player_ids.cs.${containsJson({ teamA: [profileId] })}`,
      `played_player_ids.cs.${containsJson({ teamB: [profileId] })}`,
      `reserve_players.cs.${containsJson({ teamA: [profileId] })}`,
      `reserve_players.cs.${containsJson({ teamB: [profileId] })}`,
    ].join(",");
    const [
      { data: playerRows, error: playerError },
      { data: actorRows, error: actorError },
      captainTournamentRows,
    ] = await Promise.all([
      client
        .from("match_players")
        .select("match_id")
        .eq("user_id", profileId)
        .limit(candidateLimit),
      client
        .from("matches")
        .select(MATCH_LIST_COLUMNS)
        .in("status", ["agreed", "approval", "disputed"])
        .or(actorFilter)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(candidateLimit),
      fetchCaptainTournamentMatchRows(client, profileId, cappedLimit),
    ]);
    if (playerError) throw playerError;
    if (actorError) throw actorError;
    const actorMatchRows = mergeMatchRowsById(actorRows ?? [], captainTournamentRows);
    const actorIds = new Set(actorMatchRows.map((row) => row.id));
    const playerMatchIds = unique((playerRows ?? []).map((row) => row.match_id)).filter((id) => !actorIds.has(id));
    const playerMatchRows = playerMatchIds.length ? await fetchMatchRowsByIds(client, playerMatchIds) : [];
    const filteredRows = mergeMatchRowsById(actorMatchRows, playerMatchRows)
      .filter((row) => ["agreed", "approval", "disputed"].includes(String(row.status ?? "")));
    const sortedRows = [...filteredRows].sort((a, b) => (
      String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? ""))
        || String(b.id ?? "").localeCompare(String(a.id ?? ""))
    ));
    const pageRows = sortedRows.slice(offset, offset + cappedLimit);
    const nextOffset = offset + pageRows.length;
    return {
      rows: pageRows,
      cursor: nextOffset < sortedRows.length ? `mine:${nextOffset}` : "",
      exhausted: nextOffset >= sortedRows.length,
    };
  }
  const candidateIds = await fetchCurrentUserMatchCandidateIds(client, profileId, cappedLimit, includeJsonActors);
  if (!candidateIds.length) {
    return { rows: [], cursor: "", exhausted: true };
  }
  const rows = await fetchMatchRowsByIds(client, candidateIds);
  const filteredRows = activeOnly
    ? rows.filter((row) => !ACTIVE_MATCH_EXCLUDED_STATUSES.has(String(row.status ?? "")))
    : rows;
  const sortedRows = [...filteredRows].sort((a, b) => (
    String(b.updated_at ?? b.created_at ?? "").localeCompare(String(a.updated_at ?? a.created_at ?? ""))
      || String(b.id ?? "").localeCompare(String(a.id ?? ""))
  ));
  const pageRows = sortedRows.slice(offset, offset + cappedLimit);
  const nextOffset = offset + pageRows.length;
  return {
    rows: pageRows,
    cursor: nextOffset < sortedRows.length ? `mine:${nextOffset}` : "",
    exhausted: nextOffset >= sortedRows.length,
  };
}

async function fetchCurrentUserCompletedFallbackMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, completedSince = "") {
  if (!profileId) return { ids: [], exhausted: true, source: "completed_fallback" };
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const rowLimit = Math.min(600, cappedLimit * 3);
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

async function fetchCurrentUserCompletedMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, completedSince = "", allowLegacyFallback = false) {
  if (!profileId) return { ids: [], cards: [], exhausted: true, source: "completed_feed" };
  const cappedLimit = Math.max(1, Math.min(MATCH_LIST_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const rowLimit = Math.min(600, cappedLimit * 3);
  if (!userRoomFeedAvailable) {
    if (!allowLegacyFallback) return { ids: [], cards: [], exhausted: true, source: "completed_feed_unavailable" };
    return fetchCurrentUserCompletedFallbackMatchIds(client, profileId, cappedLimit, completedSince);
  }
  let query = client
    .from("user_room_feed")
    .select("entity_id,sort_at,relation")
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

function getMatchUserIds(match = {}) {
  return unique([
    match.createdBy,
    match.refereeId,
    match.formerRefereeId,
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...(match.reservePlayers?.teamA ?? []),
    ...(match.reservePlayers?.teamB ?? []),
  ]);
}

function getMatchPlayerIds(match = {}) {
  return unique([
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
  ]);
}

function getRecorderMatchUserIds(match = {}) {
  return unique([
    ...getMatchUserIds(match),
    match.result?.submittedBy,
    ...Object.keys(match.result?.playerStats ?? {}),
    ...flattenIdValues(match.result?.statSubmissions),
    ...flattenIdValues(match.statRecorders),
    ...flattenIdValues(match.rules?.statRecorders),
  ]);
}

function isRecorderMatch(match = {}, profileId = "", isAdmin = false) {
  if (!["agreed", "approval", "disputed"].includes(match.status)) return false;
  if (isAdmin) return true;
  return getRecorderMatchUserIds(match).includes(profileId);
}

function getMatchRowActorIds(row = {}, players = []) {
  return unique([
    row.created_by,
    row.referee_id,
    row.former_referee_id,
    ...players.map((player) => player.user_id),
    ...flattenIdValues(row.played_player_ids),
    ...flattenIdValues(row.reserve_players),
    ...flattenIdValues(row.stat_recorders),
    ...flattenIdValues(row.rules?.playedPlayerIds),
    ...flattenIdValues(row.rules?.reservePlayers),
    ...flattenIdValues(row.rules?.statRecorders),
  ]);
}

function canReadMatchRow(row = {}, players = [], profileId = "", isAdmin = false) {
  if (isAdmin) return true;
  if ((row.visibility ?? row.rules?.visibility ?? "public") !== "private") return true;
  return getMatchRowActorIds(row, players).includes(profileId);
}

function compactUser(user = {}, profileId = "") {
  const compact = {
    id: user.id,
    name: user.name,
    handle: user.handle,
    hashtag: user.hashtag,
    position: user.position,
    region: user.region,
    avatarColor: user.avatarColor,
    trustScore: user.trustScore,
    ratings: Number.isFinite(Number(user.ratings?.integrated)) ? { integrated: user.ratings.integrated } : undefined,
    ageGroup: user.ageGroup,
  };
  if (user.id !== profileId) return compact;
  return {
    ...compact,
    regionSido: user.regionSido,
    regionDistrict: user.regionDistrict,
    school: user.school,
    company: user.company,
    club: user.club,
    streak: user.streak,
    ratings: user.ratings,
    authUserId: user.authUserId,
    testLoginId: user.testLoginId,
    birthYear: user.birthYear,
    ageGroupCheckedSeason: user.ageGroupCheckedSeason,
    onboardingComplete: user.onboardingComplete,
    profileVersion: user.profileVersion,
    handleLockedAt: user.handleLockedAt,
    birthYearLockedAt: user.birthYearLockedAt,
    nameUpdatedAt: user.nameUpdatedAt,
    discordConnection: user.discordConnection,
    discordUserId: user.discordUserId,
  };
}

function toClientTeam(row = {}) {
  return {
    id: row.id,
    name: row.name,
    homeCourt: row.home_court,
    region: row.region,
    mmr: row.mmr ?? 1200,
    wins: row.wins ?? 0,
    losses: row.losses ?? 0,
    accent: row.accent,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? row.created_at ?? null,
    membersPartial: true,
    members: [],
  };
}

function toClientMatchSide(row = {}, sideName = "teamA", playersByMatch = new Map(), teamById = {}) {
  const teamId = sideName === "teamA" ? row.team_a_id : row.team_b_id;
  const score = sideName === "teamA" ? row.score_a : row.score_b;
  const recordName = String(
    (sideName === "teamA" ? row.rules?.recordSummary?.teamAName : row.rules?.recordSummary?.teamBName) ?? "",
  ).trim();
  return {
    teamId,
    name: teamById[teamId]?.name ?? (recordName || MATCH_SIDE_FALLBACK_NAMES[sideName] || MATCH_SIDE_FALLBACK_NAMES.teamA),
    players: [...(playersByMatch.get(row.id) ?? [])]
      .filter((player) => player.side === sideName)
      .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0))
      .map((player) => player.user_id),
    score: score ?? 0,
  };
}

function toClientMatchResult(resultRow = null, statRows = []) {
  if (!resultRow && !(statRows ?? []).length) return null;
  return {
    scoreA: Number(resultRow?.score_a ?? 0),
    scoreB: Number(resultRow?.score_b ?? 0),
    playerStats: Object.fromEntries((statRows ?? []).filter((row) => row?.user_id).map((row) => [
      row.user_id,
      {
        points: Number(row.points ?? 0),
        rebounds: Number(row.rebounds ?? 0),
        assists: Number(row.assists ?? 0),
        steals: Number(row.steals ?? 0),
        blocks: Number(row.blocks ?? 0),
        fouls: Number(row.fouls ?? 0),
      },
    ])),
    statSubmissions: resultRow?.stat_submissions ?? {},
    submittedBy: resultRow?.submitted_by ?? "",
    submittedAt: resultRow?.submitted_at ?? "",
    updatedAt: resultRow?.submitted_at ?? "",
  };
}

function toClientMatch(row = {}, playersByMatch = new Map(), teamById = {}, courtById = {}, resultsByMatch = {}, statsByMatch = new Map()) {
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const legacyInstant = !row.rules?.timingType && rawScheduledAt === "\uC989\uC2DC";
  const timingType = row.rules?.timingType === "instant" || legacyInstant ? "instant" : "scheduled";
  const playedPlayerIds = row.played_player_ids ?? row.rules?.playedPlayerIds ?? {};
  const reservePlayers = row.reserve_players ?? row.rules?.reservePlayers ?? {};
  const mmrExcludedPlayerIds = row.mmr_excluded_player_ids ?? row.rules?.mmrExcludedPlayerIds ?? [];
  const anonymousPlayers = row.anonymous_players ?? {};
  const statRecorders = row.stat_recorders ?? row.rules?.statRecorders ?? {};
  const result = toClientMatchResult(resultsByMatch[row.id], statsByMatch.get(row.id) ?? []);
  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    courtId: row.court_id ?? null,
    court: row.court_name ?? courtById[row.court_id]?.name ?? "\uBBF8\uC815",
    visibility: row.visibility ?? row.rules?.visibility ?? "public",
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt: timingType === "instant" ? "\uC989\uC2DC" : rawScheduledAt,
    timingType,
    status: row.status ?? "contract",
    official: Boolean(row.official),
    preRegistered: Boolean(row.pre_registered),
    ranked: row.ranked !== false,
    refereeId: row.referee_id ?? "",
    formerRefereeId: row.former_referee_id ?? "",
    refereeWanted: Boolean(row.referee_id || row.rules?.refereeWanted),
    createdBy: row.created_by ?? "",
    recruitingPostId: row.rules?.recruitingPostId ?? "",
    tournamentId: row.tournament_id ?? "",
    teamA: {
      ...toClientMatchSide(row, "teamA", playersByMatch, teamById),
      ...(result ? { score: result.scoreA } : {}),
    },
    teamB: {
      ...toClientMatchSide(row, "teamB", playersByMatch, teamById),
      ...(result ? { score: result.scoreB } : {}),
    },
    agreements: { teamA: [], teamB: [] },
    approvals: { teamA: [], teamB: [] },
    disputes: [],
    playedPlayerIds,
    reservePlayers,
    mmrExcludedPlayerIds,
    anonymousPlayers,
    parties: row.rules?.parties ?? {},
    result,
    rules: {
      ...(row.rules ?? {}),
      targetScore: row.rules?.targetScore,
      timeLimit: row.rules?.timeLimit,
      winByTwo: row.rules?.winByTwo,
      ball: row.rules?.ball,
      playedPlayerIds,
      mmrExcludedPlayerIds,
      statRecorders,
    },
    statRecorders,
    statEntryMinutes: row.stat_entry_minutes ?? 60,
    disputeMinutes: row.dispute_minutes ?? 30,
    createdAt: row.created_at,
    agreedAt: row.agreed_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    confirmedAt: row.confirmed_at,
    cancelledAt: row.cancelled_at,
    voidedAt: row.voided_at,
    updatedAt: row.updated_at ?? row.created_at,
  };
}

async function loadCurrentRecruitingSchedule(context, adminLevel = 0) {
  if (!context.profileId) return null;
  try {
    const result = await loadCurrentUserRecruitingFeedList(context, {
      adminLevel,
      limit: REMOTE_CLIENT_MATCH_LIMIT,
      includeFeedCounts: false,
      skipCardReferenceRows: false,
      preferFreshRows: true,
    });
    return result?.state?.recruitingPosts?.length ? result : null;
  } catch (error) {
    console.warn("Match list recruiting schedule skipped.", error.message);
    return null;
  }
}

export async function loadCompactMatchList(context, body = {}, adminLevel = 0, limit = REMOTE_CLIENT_MATCH_LIMIT, debugTiming = null) {
  const cursor = String(body.cursor ?? body.matchUpdatedBefore ?? "").trim();
  const shouldLoadRecruitingSchedule = !cursor && body.includeRecruitingSchedule === true;
  const completedOnly = body.completedOnly === true;
  const recorderOnly = body.recorderOnly === true;
  const completedSince = completedOnly ? getCompletedSince(body) : "";
  const activeOnly = body.activeOnly === true || recorderOnly;
  const shouldLoadRecentCompleted = !completedOnly && activeOnly && !cursor && body.includeRecentCompleted === true;
  const recentCompletedHours = shouldLoadRecentCompleted ? getRecentCompletedHours(body) : RECENT_COMPLETED_MATCH_HOURS;
  const shouldLoadClosedNotices = body.includeClosedNotices !== false && !recorderOnly && !completedOnly && activeOnly && !cursor;
  const allowLegacyFallback = isLegacyListFallbackAllowed(body);
  const filterMatchItems = (items = []) => {
    let filtered = filterActiveMatchCards(items, activeOnly, {
      includeRecentCompleted: shouldLoadRecentCompleted,
      includeRecordRooms: recorderOnly,
    });
    if (recorderOnly) filtered = filtered.filter((match) => isRecorderMatch(match, context.profileId, adminLevel >= 30));
    if (completedOnly) filtered = filtered.filter((match) => (
      match.status === "confirmed" &&
      (getMatchPlayerIds(match).includes(context.profileId) || match.__feedRelations?.includes("participant"))
    ));
    return filtered;
  };
  const recruitingSchedulePromise = shouldLoadRecruitingSchedule
    ? loadCurrentRecruitingSchedule(context, adminLevel)
    : Promise.resolve(null);
  const [baseFeedPage, recentCompletedPage, closedNoticePage, captainTournamentRows, relatedTournamentState] = await Promise.all([
    recorderOnly
      ? Promise.resolve(null)
      : completedOnly
      ? timeStep(debugTiming, "completedFeedMs", () => fetchCurrentUserCompletedMatchIds(context.supabase, context.profileId, limit, completedSince, allowLegacyFallback))
      : timeStep(debugTiming, "feedMs", () => fetchMatchFeedPage(context.supabase, context.profileId, limit, cursor, activeOnly)),
    shouldLoadRecentCompleted
      ? timeStep(debugTiming, "recentCompletedMs", () => fetchRecentCompletedMatchFeedPage(context.supabase, context.profileId, recentCompletedHours))
      : Promise.resolve(null),
    shouldLoadClosedNotices
      ? timeStep(debugTiming, "closedNoticeMs", () => fetchClosedNoticeMatchFeedPage(context.supabase, context.profileId))
      : Promise.resolve(null),
    !cursor && !completedOnly && !recorderOnly
      ? timeStep(debugTiming, "captainTournamentMatchesMs", () => fetchCaptainTournamentMatchRows(context.supabase, context.profileId, limit))
      : Promise.resolve([]),
    !cursor && !completedOnly && !recorderOnly
      ? timeStep(debugTiming, "relatedTournamentsMs", () => loadCurrentUserTournamentIndex(context.supabase, context.profileId))
      : Promise.resolve({ users: [], teams: [], tournaments: [] }),
  ]);
  const captainTournamentMatchIds = new Set((captainTournamentRows ?? []).map((row) => row.id).filter(Boolean));
  const feedPage = mergeMatchFeedPages(mergeMatchFeedPages(baseFeedPage, recentCompletedPage), closedNoticePage);
  let pageSource = "feed";
  let pageCursor = feedPage?.cursor ?? "";
  let pageExhausted = feedPage?.exhausted ?? true;
  let matchRows = [];
  let matches = [];
  if (feedPage) {
    pageSource = feedPage.source ?? "feed";
    const feedCards = feedPage.cards ?? [];
    const cardIds = new Set(feedCards.map((card) => card?.id).filter(Boolean));
    if (feedPage.cards?.length) {
      matches = sortByFeedOrder(
        filterMatchItems(feedCards),
        feedPage.ids,
      );
    }
    const rowFallbackIds = completedOnly
      ? feedPage.ids ?? []
      : (feedPage.ids ?? []).filter((id) => !cardIds.has(id));
    if (rowFallbackIds.length) {
      pageSource = appendRowFallbackSource(pageSource);
      matchRows = await timeStep(debugTiming, "matchRowsMs", () => (
        fetchMatchRowsByIds(context.supabase, rowFallbackIds)
      ));
    }
  } else {
    pageSource = allowLegacyFallback ? "fallback_mine" : "feed_unavailable";
    if (allowLegacyFallback) {
      const minePage = await timeStep(debugTiming, "fallbackMineMs", () => (
        fetchCurrentUserMatchPage(context.supabase, context.profileId, limit, cursor, activeOnly)
      ));
      matchRows = minePage?.rows ?? [];
      pageCursor = minePage?.cursor ?? "";
      pageExhausted = minePage?.exhausted ?? true;
    }
  }

  if (recorderOnly) {
    const recorderPage = await timeStep(debugTiming, "recorderFallbackMs", () => (
      fetchCurrentUserMatchPage(context.supabase, context.profileId, limit, "", true, true)
    ));
    const recorderRows = recorderPage?.rows ?? [];
    matchRows = mergeMatchRowsById(matchRows, recorderRows);
    pageSource = "recorder";
    pageCursor = recorderPage?.cursor ?? "";
    pageExhausted = recorderPage?.exhausted ?? true;
  }
  if (captainTournamentRows?.length) {
    matchRows = mergeMatchRowsById(matchRows, captainTournamentRows);
    pageSource = appendRowFallbackSource(pageSource);
  }

  const currentUser = context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...getRemoteAppSettings(context.profile),
  };

  if (matches.length && !matchRows.length) {
    const countedMatches = await attachMatchPlayerCountsToCards(context.supabase, matches, debugTiming);
    const cardScope = collectMissingMatchCardReferences(countedMatches);
    const [
      { data: teamRows, error: teamError },
      { data: courtRows, error: courtError },
    ] = await timeStep(debugTiming, "cardRelatedRowsMs", () => Promise.all([
      cardScope.teamIds.length
        ? context.supabase.from("teams").select(TEAM_COLUMNS).in("id", cardScope.teamIds).is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
      fetchCourtRowsByIds(context.supabase, cardScope.courtIds, COURT_COLUMNS),
    ]));
    if (teamError) throw teamError;
    if (courtError) throw courtError;
    const teams = (teamRows ?? []).map(toClientTeam);
    const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
    const courtById = firstBy(courtRows ?? [], "id");
    const referencedMatches = countedMatches.map((match) => attachMatchCardReferences(match, teamById, courtById));
    const state = normalizeState({
      currentUserId: currentUser.id,
      users: [compactUser(currentUser, currentUser.id)],
      teams,
      matches: referencedMatches,
      settings,
    }, { includeDemo: false });
    const recruitingSchedule = await timeStep(debugTiming, "recruitingScheduleMs", () => recruitingSchedulePromise);
    const recruitingState = recruitingSchedule?.state ?? {};
    const recruitingScheduleCount = recruitingState.recruitingPosts?.length ?? 0;
    const mergedState = {
      ...state,
      users: mergeById(mergeById(state.users, relatedTournamentState.users), recruitingState.users),
      teams: mergeById(mergeById(state.teams, relatedTournamentState.teams), recruitingState.teams),
      recruitingPosts: recruitingState.recruitingPosts ?? [],
      tournaments: relatedTournamentState.tournaments ?? [],
    };

    return {
      state: {
        ...mergedState,
        affiliations: [],
        seasons: [],
        reports: [],
        notifications: [],
        discordNotificationDeliveries: [],
      },
      page: {
        limit,
        count: matches.length,
        cursor: pageCursor,
        exhausted: pageExhausted,
        source: pageSource,
        completedSince: completedSince || undefined,
        recruitingScheduleChecked: shouldLoadRecruitingSchedule,
        recruitingScheduleCount,
      },
      updatedAt: Math.max(
        ...[...referencedMatches, context.profile].filter(Boolean)
          .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
          .filter((value) => Number.isFinite(value)),
        0,
      ),
    };
  }

  const matchIds = (matchRows ?? []).map((row) => row.id).filter(Boolean);
  const playerRowsPromise = matchIds.length
    ? timeStep(debugTiming, "matchPlayersMs", () => context.supabase.from("match_players").select(MATCH_PLAYER_COLUMNS).in("match_id", matchIds))
    : Promise.resolve({ data: [], error: null });
  const resultRowsPromise = matchIds.length
    ? timeStep(debugTiming, "matchResultsMs", () => context.supabase.from("match_results").select(MATCH_RESULT_COLUMNS).in("match_id", matchIds))
    : Promise.resolve({ data: [], error: null });
  const statRowsPromise = matchIds.length
    ? timeStep(debugTiming, "matchStatsMs", () => context.supabase.from("player_match_stats").select(PLAYER_STAT_COLUMNS).in("match_id", matchIds))
    : Promise.resolve({ data: [], error: null });
  const { data: playerRows, error: playerError } = await playerRowsPromise;
  if (playerError) throw playerError;

  const playersByMatch = groupBy(playerRows ?? [], "match_id");
  const readableRows = (matchRows ?? []).filter((row) => (
    captainTournamentMatchIds.has(row.id) ||
    canReadMatchRow(row, playersByMatch.get(row.id) ?? [], context.profileId ?? "", adminLevel >= 30)
  ));
  const teamIds = unique(readableRows.flatMap((row) => [row.team_a_id, row.team_b_id]));
  const courtIds = unique(readableRows.map((row) => (row.court_name ? "" : row.court_id)));
  const profileIds = unique(readableRows.flatMap((row) => getMatchRowActorIds(row, playersByMatch.get(row.id) ?? [])));
  const profileIdsForLookup = profileIds.filter((profileId) => profileId !== currentUser.id);

  const [
    { data: resultRows, error: resultError },
    { data: statRows, error: statError },
    { data: teamRows, error: teamError },
    { data: courtRows, error: courtError },
    { data: profileRows, error: profileError },
  ] = await Promise.all([
    resultRowsPromise,
    statRowsPromise,
    teamIds.length
      ? timeStep(debugTiming, "matchTeamsMs", () => context.supabase.from("teams").select(TEAM_COLUMNS).in("id", teamIds).is("deleted_at", null))
      : Promise.resolve({ data: [], error: null }),
    timeStep(debugTiming, "matchCourtsMs", () => fetchCourtRowsByIds(context.supabase, courtIds, COURT_COLUMNS)),
    profileIdsForLookup.length
      ? timeStep(debugTiming, "matchProfilesMs", () => context.supabase.from("profiles").select(PROFILE_CARD_COLUMNS).in("id", profileIdsForLookup))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (resultError) throw resultError;
  if (statError) throw statError;
  if (teamError) throw teamError;
  if (courtError) throw courtError;
  if (profileError) throw profileError;

  const resultsByMatch = firstBy(resultRows ?? [], "match_id");
  const statsByMatch = groupBy(statRows ?? [], "match_id");
  const userById = new Map((profileRows ?? []).map((row) => {
    const user = fromRemoteProfile(row);
    return [user.id, user];
  }));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });
  const users = [...userById.values()].map((user) => compactUser(user, currentUser.id));

  const teams = (teamRows ?? []).map(toClientTeam);
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const courtById = firstBy(courtRows ?? [], "id");
  const rowMatches = readableRows
    .map((row) => {
      const match = toClientMatch(row, playersByMatch, teamById, courtById, resultsByMatch, statsByMatch);
      if (!captainTournamentMatchIds.has(row.id)) return match;
      return { ...match, __feedRelations: unique([...(match.__feedRelations ?? []), "tournament_captain"]) };
    })
    .filter((match) => filterMatchItems([match]).length > 0);
  const countedMatches = matches.length
    ? await attachMatchPlayerCountsToCards(context.supabase, matches, debugTiming)
    : matches;
  matches = feedPage?.ids?.length
    ? sortByFeedOrder(mergeMatchCardsWithRows(countedMatches, rowMatches), feedPage.ids)
    : rowMatches.sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
  const state = normalizeState({
    currentUserId: currentUser.id,
    users,
    teams,
    matches,
    settings,
  }, { includeDemo: false });
  const recruitingSchedule = await timeStep(debugTiming, "recruitingScheduleMs", () => recruitingSchedulePromise);
  const recruitingState = recruitingSchedule?.state ?? {};
  const recruitingScheduleCount = recruitingState.recruitingPosts?.length ?? 0;
  const mergedState = {
    ...state,
    users: mergeById(mergeById(state.users, relatedTournamentState.users), recruitingState.users),
    teams: mergeById(mergeById(state.teams, relatedTournamentState.teams), recruitingState.teams),
    recruitingPosts: recruitingState.recruitingPosts ?? [],
    tournaments: relatedTournamentState.tournaments ?? [],
  };

  return {
    state: {
      ...mergedState,
      affiliations: [],
      seasons: [],
      reports: [],
      notifications: [],
      discordNotificationDeliveries: [],
    },
    page: {
      limit,
      count: matches.length,
      cursor: pageCursor,
      exhausted: pageExhausted,
      source: pageSource,
      completedSince: completedSince || undefined,
      recruitingScheduleChecked: shouldLoadRecruitingSchedule,
      recruitingScheduleCount,
    },
    updatedAt: Math.max(
      ...[...(matchRows ?? []), ...matches, context.profile].filter(Boolean)
        .map((row) => new Date(row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at ?? 0).getTime())
        .filter((value) => Number.isFinite(value)),
      0,
    ),
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const startedAt = Date.now();
    const body = await readJsonBody(request);
    const debugTiming = body.debugTiming === true ? {} : null;
    const context = await timeStep(debugTiming, "authMs", () => (
      getAuthenticatedContext(request, { allowMissingProfile: true, profileSelect: PROFILE_ME_COLUMNS })
    ));
    const shouldLoadAdminContext = body.adminContext !== false && body.includeAdminContext !== false;
    const adminLevel = shouldLoadAdminContext && context.profileId
      ? await timeStep(debugTiming, "adminMs", () => getAdminLevel(context))
      : 0;
    const limit = getCappedLimit(body.limit ?? body.matchLimit ?? REMOTE_CLIENT_MATCH_LIMIT);
    const result = await loadCompactMatchList(context, body, adminLevel, limit, debugTiming);
    if (debugTiming) debugTiming.totalMs = Date.now() - startedAt;
    sendJson(response, 200, {
      ok: true,
      ...result,
      debugTiming: debugTiming ?? undefined,
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "matches_list_failed" });
  }
}
