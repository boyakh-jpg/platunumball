import { isMissingUserRoomFeed, uniqueValues as unique } from "../_supabaseAdmin.js";
import { REMOTE_CLIENT_MATCH_LIMIT } from "../../../shared/lib/constants.js";
import { MATCH_LIST_COLUMNS } from "../../../shared/lib/repositoryColumns.js";
import { isMatchInPlayMenu } from "../../../shared/lib/matchRoomLifecycle.js";

import { isPlayableMatchRow } from "./_listProjection.js";
import {
  userRoomFeedAvailable,
  disableUserRoomFeed,
  MATCH_LIST_MAX_LIMIT,
  MATCH_FEED_ROW_MAX_LIMIT,
  MATCH_FEED_ROW_FACTOR,
  ACTIVE_MATCH_EXCLUDED_STATUS_VALUES,
  MATCH_TERMINAL_STATUS_FILTER,
  getMineOffsetCursor,
  paginateMineMatchRows,
  isSafePostgrestLiteral,
  fetchMatchRowsByIds,
} from "./_listFeedQueries.js";
export { RECENT_COMPLETED_MATCH_HOURS, isLegacyListFallbackAllowed, getCappedLimit, getCompletedSince, getRecentCompletedHours, fetchMatchFeedPage, fetchRecentCompletedMatchFeedPage, fetchClosedNoticeMatchFeedPage, mergeMatchFeedPages, fetchMatchRowsByIds, fetchCurrentUserCompletedMatchIds } from "./_listFeedQueries.js";

let relatedActiveMatchListAvailable = true;
let recorderMatchPageAvailable = true;

const ACTIVE_MATCH_EXCLUDED_STATUSES = new Set(ACTIVE_MATCH_EXCLUDED_STATUS_VALUES);

export const MATCH_RELATED_FALLBACK_MAX_LIMIT = 80;

function isMissingRecorderMatchPage(error = {}) {
  const message = String(error?.message ?? "");
  return error?.code === "PGRST202"
    || error?.code === "42883"
    || message.includes("rankball_recorder_match_page");
}

function isMissingFinalSubmissionColumn(error = {}) {
  return error?.code === "42703"
    || /final_submitted_(?:at|by)/i.test(String(error?.message ?? ""));
}

async function filterPlayMatchRows(client, rows = [], profileId = "", now = new Date()) {
  const matchIds = unique(rows.map((row) => row?.id));
  if (!matchIds.length) return [];

  let resultQuery = await client
    .from("match_results")
    .select("match_id,submitted_at,final_submitted_at")
    .in("match_id", matchIds);
  const legacyResultProjection = isMissingFinalSubmissionColumn(resultQuery.error);
  if (legacyResultProjection) {
    resultQuery = await client
      .from("match_results")
      .select("match_id,submitted_at")
      .in("match_id", matchIds);
  }
  if (resultQuery.error) throw resultQuery.error;

  const [playerQuery, disputeQuery] = await Promise.all([
    client
      .from("match_players")
      .select("match_id,user_id")
      .in("match_id", matchIds),
    client
      .from("match_disputes")
      .select("match_id,status")
      .in("match_id", matchIds)
      .eq("status", "open"),
  ]);
  if (playerQuery.error) throw playerQuery.error;
  const { data: disputeRows, error: disputeError } = disputeQuery;
  if (disputeError) throw disputeError;

  const resultByMatchId = new Map((resultQuery.data ?? []).map((row) => [row.match_id, row]));
  const openDisputeMatchIds = new Set((disputeRows ?? []).map((row) => row.match_id));
  const playersByMatchId = new Map();
  for (const player of playerQuery.data ?? []) {
    if (!playersByMatchId.has(player.match_id)) playersByMatchId.set(player.match_id, []);
    playersByMatchId.get(player.match_id).push(player);
  }
  return rows.filter((row) => {
    if (!isPlayableMatchRow(row, playersByMatchId.get(row.id) ?? [], profileId)) return false;
    const resultRow = resultByMatchId.get(row.id);
    const finalSubmittedAt = resultRow?.final_submitted_at
      ?? (legacyResultProjection && ["approval", "disputed"].includes(row.status) ? resultRow?.submitted_at : null);
    return isMatchInPlayMenu({
      ...row,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      confirmedAt: row.confirmed_at,
      statEntryMinutes: row.stat_entry_minutes,
      disputeMinutes: row.dispute_minutes,
      tournamentId: row.tournament_id,
      result: resultRow ? { submittedAt: resultRow.submitted_at, finalSubmittedAt } : null,
      disputes: openDisputeMatchIds.has(row.id) ? [{ status: "open" }] : [],
    }, now);
  });
}

export async function fetchRefereeMatchPage(client, refereeId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  const safeRefereeId = String(refereeId ?? "").trim();
  if (!safeRefereeId) return { rows: [], cursor: "", exhausted: true };
  const candidateLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const { data, error } = await client
    .from("matches")
    .select(MATCH_LIST_COLUMNS)
    .eq("referee_id", safeRefereeId)
    .eq("status", "confirmed")
    .or("visibility.neq.private,visibility.is.null")
    .order("confirmed_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(candidateLimit);
  if (error) throw error;
  const rows = data ?? [];
  return { rows, cursor: "", exhausted: rows.length < candidateLimit };
}





























async function fetchJsonActorMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT, options = {}) {
  if (!profileId) return [];
  const candidateLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const filters = [
    ["played_player_ids", { teamA: [profileId] }],
    ["played_player_ids", { teamB: [profileId] }],
    ["reserve_players", { teamA: [profileId] }],
    ["reserve_players", { teamB: [profileId] }],
    ...(options.includeStatRecorders === false ? [] : [
      ["stat_recorders", { teamA: profileId }],
      ["stat_recorders", { teamB: profileId }],
    ]),
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

async function fetchPlayActorMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  if (!profileId) return [];
  const candidateLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const [jsonActorMatchIds, playerResult, ownerResult] = await Promise.all([
    fetchJsonActorMatchIds(client, profileId, limit, { includeStatRecorders: false }),
    client
      .from("match_players")
      .select("match_id")
      .eq("user_id", profileId)
      .limit(candidateLimit),
    client
      .from("matches")
      .select("id")
      .not("status", "in", MATCH_TERMINAL_STATUS_FILTER)
      .or(`created_by.eq.${profileId},referee_id.eq.${profileId}`)
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
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
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(candidateLimit)
    : { data: [], error: null };
  if (activePlayerResult.error) throw activePlayerResult.error;
  return unique([
    ...jsonActorMatchIds,
    ...(activePlayerResult.data ?? []).map((row) => row.id),
    ...(ownerResult.data ?? []).map((row) => row.id),
  ]).slice(0, candidateLimit);
}

async function fetchDirectActorMatchIds(client, profileId = "", limit = REMOTE_CLIENT_MATCH_LIMIT) {
  if (!profileId) return [];
  const candidateLimit = Math.max(1, Math.min(MATCH_RELATED_FALLBACK_MAX_LIMIT, Number(limit) || REMOTE_CLIENT_MATCH_LIMIT));
  const [jsonActorMatchIds, playerResult, submittedResult, ownerResult] = await Promise.all([
    fetchJsonActorMatchIds(client, profileId, limit),
    client
      .from("match_players")
      .select("match_id")
      .eq("user_id", profileId)
      .limit(candidateLimit),
    client
      .from("match_results")
      .select("match_id")
      .eq("submitted_by", profileId)
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
  if (submittedResult.error) throw submittedResult.error;
  if (ownerResult.error) throw ownerResult.error;
  const actorMatchIds = unique([
    ...(playerResult.data ?? []).map((row) => row.match_id),
    ...(submittedResult.data ?? []).map((row) => row.match_id),
  ]);
  const activeActorResult = actorMatchIds.length
    ? await client
        .from("matches")
        .select("id")
        .in("id", actorMatchIds)
        .not("status", "in", MATCH_TERMINAL_STATUS_FILTER)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(candidateLimit)
    : { data: [], error: null };
  if (activeActorResult.error) throw activeActorResult.error;
  return unique([
    ...jsonActorMatchIds,
    ...(activeActorResult.data ?? []).map((row) => row.id),
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
  if (recorderMatchPageAvailable) {
    const { data, error } = await client.rpc("rankball_recorder_match_page", {
      p_profile_id: profileId,
      p_limit: cappedLimit,
      p_cursor: cursor,
    });
    if (!error) {
      const ids = unique(Array.isArray(data?.ids) ? data.ids : []);
      const hydratedRows = await fetchMatchRowsByIds(client, ids);
      const rowById = new Map(hydratedRows.map((row) => [row.id, row]));
      const rows = ids.map((id) => rowById.get(id)).filter(Boolean);
      return {
        rows,
        cursor: String(data?.cursor ?? ""),
        exhausted: data?.exhausted !== false,
      };
    }
    if (!isMissingRecorderMatchPage(error)) throw error;
    recorderMatchPageAvailable = false;
    console.warn("Recorder match page RPC unavailable; using bounded fallback.", error.message);
  }
  if (String(cursor).startsWith("play:")) {
    const cursorError = new Error("Recorder match page cursor is unavailable; refresh the Play list.");
    cursorError.code = "PLAY_CURSOR_UNAVAILABLE";
    throw cursorError;
  }
  const offset = getMineOffsetCursor(cursor);
  if (userRoomFeedAvailable) {
    const chunkSize = Math.min(
      MATCH_FEED_ROW_MAX_LIMIT,
      Math.max(MATCH_RELATED_FALLBACK_MAX_LIMIT, cappedLimit * MATCH_FEED_ROW_FACTOR),
    );
    const eligibleRows = [];
    const seenEligibleIds = new Set();
    let scanned = 0;
    let feedExhausted = false;
    while (scanned < MATCH_FEED_ROW_MAX_LIMIT && eligibleRows.length < offset + cappedLimit + 1) {
      const chunkLimit = Math.min(chunkSize, MATCH_FEED_ROW_MAX_LIMIT - scanned);
      const { data, error } = await client
        .from("user_room_feed")
        .select("entity_id,sort_at")
        .eq("entity_type", "match")
        .eq("profile_id", profileId)
        .eq("is_active", true)
        .in("status", ["agreed", "approval", "disputed"])
        .in("relation", ["owner", "participant", "referee"])
        .order("sort_at", { ascending: false, nullsFirst: false })
        .order("entity_id", { ascending: false })
        .range(scanned, scanned + chunkLimit - 1);
      if (error) {
        if (!isMissingUserRoomFeed(error)) throw error;
        disableUserRoomFeed();
        break;
      }
      const candidateIds = unique((data ?? []).map((row) => row?.entity_id));
      const hydratedRows = await fetchMatchRowsByIds(client, candidateIds);
      const filteredRows = await filterPlayMatchRows(client, hydratedRows, profileId);
      for (const row of filteredRows) {
        if (!row?.id || seenEligibleIds.has(row.id)) continue;
        seenEligibleIds.add(row.id);
        eligibleRows.push(row);
      }
      scanned += (data ?? []).length;
      feedExhausted = (data ?? []).length < chunkLimit;
      if (feedExhausted || !(data ?? []).length) break;
    }
    if (userRoomFeedAvailable) {
      const pageRows = eligibleRows.slice(offset, offset + cappedLimit);
      const hasMore = eligibleRows.length > offset + pageRows.length || !feedExhausted;
      return {
        rows: pageRows,
        cursor: pageRows.length && hasMore ? `mine:${offset + pageRows.length}` : "",
        exhausted: !hasMore,
      };
    }
  }
  const candidateIds = await fetchPlayActorMatchIds(client, profileId, MATCH_RELATED_FALLBACK_MAX_LIMIT);
  const rows = await fetchMatchRowsByIds(client, candidateIds);
  const filteredRows = await filterPlayMatchRows(client, rows, profileId);
  return paginateMineMatchRows(filteredRows, offset, cappedLimit);
}
