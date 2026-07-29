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
import { HOUR_MS } from "../../../shared/lib/matchConstants.js";
import { projectMatchDisputeRows, projectMatchTimestamps } from "../../../shared/lib/matchReadProjection.js";
import { projectMatchActivePlayerIds } from "../../../shared/lib/playerIds.js";
import { projectTeamRow } from "../../../shared/lib/teamRowProjection.js";
import { compactClientUser } from "../../lib/clientProjection.js";
import {
  attachRoomFeedCardJson,
  collectUniqueRoomFeedCards,
  readRoomFeedCard,
} from "../../lib/roomFeedCards.js";
import {
  normalizeState,
} from "../../../shared/lib/stateNormalizer.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
import { DEFAULT_SETTINGS } from "../../../shared/lib/repositoryDefaults.js";
import { getReadableMatchStatRows, getReadableMatchStatSubmissions, getRemoteMatchActivePlayerIds } from "../../../shared/lib/matchMappers.js";
import {
  COURT_COLUMNS,
  MATCH_DISPUTE_COLUMNS,
  MATCH_LIST_COLUMNS,
  MATCH_PLAYER_COLUMNS,
  MATCH_RESULT_COLUMNS,
  PLAYER_STAT_COLUMNS,
  PROFILE_CARD_COLUMNS,
  PROFILE_ME_COLUMNS,
  TEAM_COLUMNS,
} from "../../../shared/lib/repositoryColumns.js";
import {
  MATCH_SIDES,
  MATCH_SIDE_FALLBACK_NAMES,
  REMOTE_CLIENT_ACTIVE_MATCH_LIMIT,
  REMOTE_CLIENT_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
  normalizeDisputeWindowMinutes,
} from "../../../shared/lib/constants.js";
import { loadCurrentUserRecruitingFeedList } from "../recruiting/list.js";
import { getMatchRoomPhase, isMatchClosedNotice, isMatchInPlayMenu, isMatchInScheduleMenu, isMatchRecordMatch, isPersonalRecordMatch, isSeedSampleMatch } from "../../../shared/lib/matchUtils.js";
import { TERMINAL_MATCH_STATUS_VALUES } from "../../../shared/lib/notifications.js";

let userRoomFeedAvailable = true;
let relatedActiveMatchListAvailable = true;
const MATCH_LIST_MAX_LIMIT = REMOTE_CLIENT_ACTIVE_MATCH_LIMIT;
const ACTIVE_MATCH_EXCLUDED_STATUS_VALUES = Object.freeze(["confirmed", ...TERMINAL_MATCH_STATUS_VALUES]);
const ACTIVE_MATCH_EXCLUDED_STATUSES = new Set(ACTIVE_MATCH_EXCLUDED_STATUS_VALUES);
const ACTIVE_MATCH_EXCLUDED_PHASES = new Set(["record"]);
const RECENT_COMPLETED_MATCH_HOURS = 24;
const RECENT_COMPLETED_MATCH_MAX_HOURS = 24 * 31 * REMOTE_CLIENT_RECORD_MONTHS;
const RECENT_COMPLETED_MATCH_LIMIT = 20;
const CLOSED_NOTICE_MATCH_LIMIT = 20;
const MATCH_FEED_ROW_MAX_LIMIT = 320;
const MATCH_FEED_ROW_FACTOR = 4;
const RECENT_COMPLETED_FEED_ROW_MAX_LIMIT = 80;
const MATCH_RELATED_FALLBACK_MAX_LIMIT = 80;
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
    const nextMatch = cardMatch
      ? {
          ...cardMatch,
          ...rowMatch,
          agreements: rowMatch.agreements?.teamA?.length || rowMatch.agreements?.teamB?.length ? rowMatch.agreements : cardMatch.agreements,
          approvals: rowMatch.approvals?.teamA?.length || rowMatch.approvals?.teamB?.length ? rowMatch.approvals : cardMatch.approvals,
          disputes: rowMatch.disputes?.length ? rowMatch.disputes : cardMatch.disputes,
          result: rowMatch.result ?? cardMatch.result ?? null,
        }
      : rowMatch;
    delete nextMatch.matchListOnly;
    merged.set(rowMatch.id, nextMatch);
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

function normalizeMatchFeedCard(row = {}) {
  const candidate = readRoomFeedCard(row, { allowCardAlias: true });
  if (!candidate) return null;
  const { card, id } = candidate;
  const feedStatus = String(row?.status ?? "").trim();
  const relations = Array.isArray(row?.relations)
    ? row.relations
    : [row?.relation].filter(Boolean);
  const nextCard = { ...card, id };
  if (!nextCard?.teamA || typeof nextCard.teamA !== "object") return null;
  if (!nextCard?.teamB || typeof nextCard.teamB !== "object") return null;
  const recordType = String(nextCard.recordType ?? nextCard.rules?.recordType ?? "").trim();
  if (!recordType) return null;
  const hasTeamACount = Number.isFinite(Number(nextCard.teamA.count));
  const hasTeamBCount = Number.isFinite(Number(nextCard.teamB.count));
  if (!Array.isArray(nextCard.teamA.players) && !hasTeamACount) return null;
  if (!Array.isArray(nextCard.teamB.players) && !hasTeamBCount) return null;
  return {
    ...nextCard,
    ...(feedStatus ? { status: feedStatus } : {}),
    matchListOnly: true,
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
  return collectUniqueRoomFeedCards(rows, ids, {
    normalizeCard: normalizeMatchFeedCard,
  });
}

async function attachRoomFeedCards(client, rows = [], entityType = "match") {
  return attachRoomFeedCardJson(client, rows, {
    entityType,
    uniqueIds: unique,
    isMissingTableError: isMissingRoomFeedCards,
  });
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
    if (!matchId || !MATCH_SIDES.includes(side) || !userId) return;
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

async function attachOpenDisputeQueues(client, matches = [], debugTiming = null) {
  const disputedMatchIds = unique((matches ?? [])
    .filter((match) => match?.status === "disputed")
    .map((match) => match.id));
  if (!disputedMatchIds.length) return matches;
  const { data, error } = await timeStep(debugTiming, "openDisputesMs", () => (
    client
      .from("match_disputes")
      .select(MATCH_DISPUTE_COLUMNS)
      .in("match_id", disputedMatchIds)
      .eq("status", "open")
      .order("created_at", { ascending: true })
  ));
  if (error) throw error;
  const disputesByMatch = groupBy(data ?? [], "match_id");
  return (matches ?? []).map((match) => match?.status === "disputed"
    ? {
        ...match,
        disputes: projectMatchDisputeRows(disputesByMatch.get(match.id)),
      }
    : match);
}

function isSoloRecordMatch(match = {}) {
  return isPersonalRecordMatch(match);
}

function filterActiveMatchCards(matches = [], activeOnly = false, options = {}) {
  const includeRecordRooms = options.includeRecordRooms === true;
  const visibleMatches = (matches ?? []).filter((match) => (
    !isSeedSampleMatch(match)
    && (includeRecordRooms || (!isSoloRecordMatch(match) && !isMatchRecordMatch(match)))
  ));
  if (!activeOnly) return visibleMatches;
  if (options.scheduleOnly === true) {
    return visibleMatches.filter((match) => (
      isMatchInScheduleMenu(match) ||
      (options.includeCancelledSchedule === true && match?.status === "cancelled")
    ));
  }
  const includeRecentCompleted = options.includeRecentCompleted === true;
  return visibleMatches.filter((match) => (
    match?.status !== "closed" && (
      (includeRecentCompleted && match?.recentCompleted) ||
      (
        isMatchClosedNotice(match) ||
        (!ACTIVE_MATCH_EXCLUDED_PHASES.has(getMatchRoomPhase(match).phase) && !match?.recentCompleted)
      )
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

async function fetchRecentCompletedMatchFeedPage(client, profileId = "", hours = RECENT_COMPLETED_MATCH_HOURS, limit = RECENT_COMPLETED_MATCH_LIMIT) {
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

async function fetchClosedNoticeMatchFeedPage(client, profileId = "", limit = CLOSED_NOTICE_MATCH_LIMIT) {
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

function mergeMatchFeedPages(feedPage, extraPage) {
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

async function fetchRelatedActiveMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, includeTeamSchedule = false) {
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

async function fetchCurrentUserMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "", activeOnly = false, includeJsonActors = false) {
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

async function fetchPlayMatchPage(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, cursor = "") {
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
  const sortedRows = rows
    .filter((row) => ["agreed", "approval", "disputed"].includes(String(row.status ?? "")))
    .sort((a, b) => (
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

async function fetchCurrentUserCompletedMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, completedSince = "", allowLegacyFallback = false) {
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

function isPlayableMatch(match = {}, profileId = "", isAdmin = false) {
  if (!["agreed", "approval", "disputed"].includes(match.status)) return false;
  if (isAdmin) return true;
  return getMatchUserIds(match).includes(profileId);
}

function getMatchRowActorIds(row = {}, players = []) {
  // LEGACY READ-ONLY:
  // 과거 경기 데이터 해석 전용.
  // 신규 권한 판정 및 저장에 사용하지 않는다.
  return unique([
    row.created_by,
    row.rules?.tournamentOrganizerId,
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
  if (["solo", "personal_record"].includes(String(row.rules?.recordType ?? "").trim().toLowerCase())) return row.created_by === profileId;
  return getMatchRowActorIds(row, players).includes(profileId);
}

export function toClientTeam(row = {}) {
  return {
    ...projectTeamRow(row),
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
    players: getRemoteMatchActivePlayerIds(row, sideName, playersByMatch.get(row.id) ?? []),
    score: score ?? 0,
  };
}

function toClientMatchResult(resultRow = null, statRows = [], allowPersonalStats = true) {
  const safeStatRows = allowPersonalStats ? statRows ?? [] : [];
  if (!resultRow && !safeStatRows.length) return null;
  return {
    scoreA: Number(resultRow?.score_a ?? 0),
    scoreB: Number(resultRow?.score_b ?? 0),
    revision: Number(resultRow?.result_revision ?? 0),
    scoreRevisionA: Number(resultRow?.score_revision_a ?? 0),
    scoreRevisionB: Number(resultRow?.score_revision_b ?? 0),
    scoreSubmissions: resultRow?.score_submissions ?? {},
    playerStats: Object.fromEntries(safeStatRows.filter((row) => row?.user_id).map((row) => [
      row.user_id,
      {
        points: Number(row.points ?? 0),
        rebounds: Number(row.rebounds ?? 0),
        assists: Number(row.assists ?? 0),
        steals: Number(row.steals ?? 0),
        blocks: Number(row.blocks ?? 0),
        turnovers: Number(row.turnovers ?? 0),
        fouls: Number(row.fouls ?? 0),
      },
    ])),
    statSubmissions: allowPersonalStats ? getReadableMatchStatSubmissions(safeStatRows, resultRow?.stat_submissions) : {},
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
  // LEGACY READ-ONLY:
  // 과거 경기 데이터 해석 전용.
  // 신규 권한 판정 및 저장에 사용하지 않는다.
  const statRecorders = row.stat_recorders ?? row.rules?.statRecorders ?? {};
  const allowPersonalStats = Boolean(row.referee_id) || ["solo", "personal_record"].includes(String(row.rules?.recordType ?? "").trim().toLowerCase());
  const result = toClientMatchResult(
    resultsByMatch[row.id],
    getReadableMatchStatRows(row, statsByMatch.get(row.id) ?? []),
    allowPersonalStats,
  );
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
    dualScoreRecorderSide: row.dual_score_recorder_side ?? row.rules?.dualScoreRecorderSide ?? null,
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
    disputeMinutes: normalizeDisputeWindowMinutes(row.dispute_minutes),
    ...projectMatchTimestamps(row),
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
      includeClosed: true,
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
  const playOnly = body.playOnly === true;
  const scheduleOnly = body.scheduleOnly === true && !playOnly && !completedOnly;
  const completedSince = completedOnly ? getCompletedSince(body) : "";
  const activeOnly = body.activeOnly === true || playOnly;
  const includeTeamSchedule = body.includeTeamSchedule === true;
  const shouldLoadRecentCompleted = !scheduleOnly && !completedOnly && activeOnly && !cursor && body.includeRecentCompleted === true;
  const recentCompletedHours = shouldLoadRecentCompleted ? getRecentCompletedHours(body) : RECENT_COMPLETED_MATCH_HOURS;
  const includeCancelledSchedule = scheduleOnly && body.includeCancelledSchedule === true;
  const shouldLoadClosedNotices = body.includeClosedNotices !== false
    && !playOnly
    && !completedOnly
    && activeOnly
    && !cursor
    && (!scheduleOnly || includeCancelledSchedule);
  const allowLegacyFallback = isLegacyListFallbackAllowed(body);
  const filterMatchItems = (items = []) => {
    let filtered = filterActiveMatchCards(items, activeOnly, {
      includeRecentCompleted: shouldLoadRecentCompleted,
      includeRecordRooms: playOnly,
      scheduleOnly,
      includeCancelledSchedule,
    });
    if (playOnly) filtered = filtered.filter((match) => isMatchInPlayMenu(match) && isPlayableMatch(match, context.profileId, adminLevel >= 30));
    if (completedOnly) filtered = filtered.filter((match) => (
      match.status === "confirmed" &&
      (projectMatchActivePlayerIds(match).includes(context.profileId) || match.__feedRelations?.includes("participant"))
    ));
    return filtered;
  };
  const recruitingSchedulePromise = shouldLoadRecruitingSchedule
    ? loadCurrentRecruitingSchedule(context, adminLevel)
    : Promise.resolve(null);
  const [baseFeedPage, recentCompletedPage, closedNoticePage, relatedActivePage, relatedTournamentState] = await Promise.all([
    playOnly
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
    !cursor && !completedOnly && !playOnly && (activeOnly || includeTeamSchedule)
      ? timeStep(debugTiming, "relatedActiveMatchIdsMs", () => (
          fetchRelatedActiveMatchPage(context.supabase, context.profileId, limit, includeTeamSchedule)
        ))
      : Promise.resolve({ rows: [], source: "none" }),
    !cursor && !completedOnly && !playOnly
      ? timeStep(debugTiming, "relatedTournamentsMs", () => loadCurrentUserTournamentIndex(context.supabase, context.profileId))
      : Promise.resolve({ users: [], teams: [], tournaments: [] }),
  ]);
  const relatedActiveRows = relatedActivePage?.rows ?? [];
  const captainTournamentMatchIds = new Set(relatedActiveRows.filter((row) => row?.captainTournament).map((row) => row.id));
  const memberTeamMatchIds = new Set(relatedActiveRows.filter((row) => row?.memberTeam).map((row) => row.id));
  const feedPage = mergeMatchFeedPages(mergeMatchFeedPages(baseFeedPage, recentCompletedPage), closedNoticePage);
  const feedCardIds = new Set((feedPage?.cards ?? []).map((card) => card?.id).filter(Boolean));
  const recentCompletedIds = new Set(recentCompletedPage?.ids ?? []);
  let pageSource = "feed";
  let pageCursor = feedPage?.cursor ?? "";
  let pageExhausted = feedPage?.exhausted ?? true;
  let matchRows = [];
  let matches = [];
  if (feedPage) {
    pageSource = feedPage.source ?? "feed";
    const feedCards = feedPage.cards ?? [];
    if (feedPage.cards?.length) {
      matches = sortByFeedOrder(
        filterMatchItems(feedCards),
        feedPage.ids,
      );
    }
    const rowFallbackIds = completedOnly
      ? feedPage.ids ?? []
      : (feedPage.ids ?? []).filter((id) => !feedCardIds.has(id) || recentCompletedIds.has(id));
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

  if (playOnly) {
    const playPage = await timeStep(debugTiming, "playMatchesMs", () => (
      fetchPlayMatchPage(context.supabase, context.profileId, limit, cursor)
    ));
    const playRows = playPage?.rows ?? [];
    matchRows = mergeMatchRowsById(matchRows, playRows);
    pageSource = "play";
    pageCursor = playPage?.cursor ?? "";
    pageExhausted = playPage?.exhausted ?? true;
  }
  const loadedMatchIds = new Set(matchRows.map((row) => row?.id).filter(Boolean));
  const relatedRowIds = unique(relatedActiveRows.map((row) => row?.id)).filter((id) => (
    !loadedMatchIds.has(id)
    && (
      !feedCardIds.has(id)
      || captainTournamentMatchIds.has(id)
      || memberTeamMatchIds.has(id)
    )
  ));
  if (relatedRowIds.length) {
    const relatedMatchRows = await timeStep(debugTiming, "relatedActiveMatchRowsMs", () => (
      fetchMatchRowsByIds(context.supabase, relatedRowIds)
    ));
    matchRows = mergeMatchRowsById(matchRows, relatedMatchRows);
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
    const queuedMatches = await attachOpenDisputeQueues(context.supabase, countedMatches, debugTiming);
    const cardScope = collectMissingMatchCardReferences(queuedMatches);
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
    const referencedMatches = queuedMatches.map((match) => attachMatchCardReferences(match, teamById, courtById));
    const state = normalizeState({
      currentUserId: currentUser.id,
      users: [compactClientUser(currentUser, currentUser.id)],
      teams,
      matches: referencedMatches,
      settings,
    }, { includeDemo: false });
    const recruitingSchedule = await timeStep(debugTiming, "recruitingScheduleMs", () => recruitingSchedulePromise);
    const recruitingState = recruitingSchedule?.state ?? {};
    const recruitingScheduleCount = recruitingState.recruitingPosts?.length ?? 0;
    const mergedState = {
      ...state,
      users: mergeById(
        mergeById(mergeById(state.users, relatedTournamentState.users), recruitingState.users),
        [compactClientUser(currentUser, currentUser.id)],
      ),
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

  const hydrateCandidateLimit = Math.max(
    1,
    Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT),
  );
  matchRows = (matchRows ?? []).slice(0, hydrateCandidateLimit);
  const matchIds = matchRows.map((row) => row.id).filter(Boolean);
  const playerRowsPromise = matchIds.length
    ? timeStep(debugTiming, "matchPlayersMs", () => context.supabase.from("match_players").select(MATCH_PLAYER_COLUMNS).in("match_id", matchIds))
    : Promise.resolve({ data: [], error: null });
  const { data: playerRows, error: playerError } = await playerRowsPromise;
  if (playerError) throw playerError;

  const playersByMatch = groupBy(playerRows ?? [], "match_id");
  const readableRows = matchRows.filter((row) => (
    captainTournamentMatchIds.has(row.id) ||
    memberTeamMatchIds.has(row.id) ||
    canReadMatchRow(row, playersByMatch.get(row.id) ?? [], context.profileId ?? "", adminLevel >= 30)
  ));
  const hydrationRows = readableRows.filter((row) => {
    if (playOnly && row.status === "agreed") return true;
    const preview = toClientMatch(row, playersByMatch, {}, {}, {}, new Map());
    return filterMatchItems([preview]).length > 0;
  });
  const hydrationMatchIds = hydrationRows.map((row) => row.id).filter(Boolean);
  const resultRowsPromise = hydrationMatchIds.length
    ? timeStep(debugTiming, "matchResultsMs", () => context.supabase.from("match_results").select(MATCH_RESULT_COLUMNS).in("match_id", hydrationMatchIds))
    : Promise.resolve({ data: [], error: null });
  const statRowsPromise = hydrationMatchIds.length
    ? timeStep(debugTiming, "matchStatsMs", () => context.supabase.from("player_match_stats").select(PLAYER_STAT_COLUMNS).in("match_id", hydrationMatchIds))
    : Promise.resolve({ data: [], error: null });
  const teamIds = unique(hydrationRows.flatMap((row) => [row.team_a_id, row.team_b_id]));
  const courtIds = unique(hydrationRows.map((row) => (row.court_name ? "" : row.court_id)));
  const profileIds = unique(hydrationRows.flatMap((row) => getMatchRowActorIds(row, playersByMatch.get(row.id) ?? [])));
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
  const users = [...userById.values()].map((user) => compactClientUser(user, currentUser.id));

  const teams = (teamRows ?? []).map(toClientTeam);
  const teamById = Object.fromEntries(teams.map((team) => [team.id, team]));
  const courtById = firstBy(courtRows ?? [], "id");
  const rowMatches = hydrationRows
    .map((row) => {
      const match = toClientMatch(row, playersByMatch, teamById, courtById, resultsByMatch, statsByMatch);
      const relations = [
        ...(match.__feedRelations ?? []),
        ...(captainTournamentMatchIds.has(row.id) ? ["tournament_captain"] : []),
        ...(memberTeamMatchIds.has(row.id) ? ["team"] : []),
      ];
      return relations.length ? { ...match, __feedRelations: unique(relations) } : match;
    })
    .filter((match) => filterMatchItems([match]).length > 0);
  const countedMatches = matches.length
    ? await attachMatchPlayerCountsToCards(context.supabase, matches, debugTiming)
    : matches;
  matches = feedPage?.ids?.length
    ? sortByFeedOrder(mergeMatchCardsWithRows(countedMatches, rowMatches), feedPage.ids)
    : rowMatches.sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
  matches = await attachOpenDisputeQueues(context.supabase, matches, debugTiming);
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
    users: mergeById(
      mergeById(mergeById(state.users, relatedTournamentState.users), recruitingState.users),
      [compactClientUser(currentUser, currentUser.id)],
    ),
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
