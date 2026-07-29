import {
  flattenIdValues,
  getAdminLevel,
  getAuthenticatedContext,
  readJsonBody,
  sendJson,
  toClientTeamWithMembers as toClientTeam,
  uniqueValues as unique,
} from "../_supabaseAdmin.js";
import { normalizeState } from "../../../shared/lib/stateNormalizer.js";
import { fromRemoteMatch } from "../../../shared/lib/matchMappers.js";
import { createProfileShell, fromRemoteProfile, getRemoteAppSettings } from "../../../shared/lib/profileMappers.js";
import { DEFAULT_SETTINGS } from "../../../shared/lib/repositoryDefaults.js";
import { filterStateForProfile } from "../state/load.js";
import {
  PROFILE_CARD_COLUMNS,
  PROFILE_ME_COLUMNS,
} from "../../../shared/lib/repositoryColumns.js";
import { asArray } from "../../../shared/lib/arrayValues.js";

import {
  REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT,
  REMOTE_CLIENT_RECORD_LIST_YEARS,
  REMOTE_CLIENT_RECORD_MATCH_LIMIT,
  REMOTE_CLIENT_RECORD_MONTHS,
} from "../../../shared/lib/constants.js";
import { getRecordWindowDates } from "../../../shared/lib/recordRetention.js";
import { toPublicProfilePrivacy } from "../directory/load.js";

const RECORD_SCOPE_PROFILE = "profile";
const RECORD_SCOPE_TEAM = "team";
const RECORD_SCOPES = new Set([RECORD_SCOPE_PROFILE, RECORD_SCOPE_TEAM]);
const RECORD_INDEX_COLUMNS = [
  "match_id",
  "record_date",
  "occurred_at",
  "side",
  "title",
  "mode",
  "court_id",
  "court_name",
  "team_id",
  "team_name",
  "opponent_team_id",
  "opponent_team_name",
  "score_for",
  "score_against",
  "outcome",
  "ranked",
  "tournament_id",
].join(",");
const PROFILE_RECORD_INDEX_COLUMNS = `${RECORD_INDEX_COLUMNS},profile_id,position,stats,record_type,visibility,owner_profile_id`;
const TEAM_RECORD_INDEX_COLUMNS = `${RECORD_INDEX_COLUMNS},visibility,reader_ids`;
const PROFILE_QUERY_CHUNK_SIZE = 100;
const VERIFIED_PUBLIC_STAT_SOURCES = new Set(["referee", "dispute_operator"]);

function normalizeLimit(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(parsed)));
}

function normalizeOffset(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function normalizeBoolean(value, fallback = true) {
  return value === undefined ? fallback : value !== false;
}

function mapCompactRecord(row = {}) {
  const isTeamB = row.side === "teamB";
  const recordType = String(row.record_type ?? "match").trim().toLowerCase();
  const personalRecord = ["solo", "personal_record"].includes(recordType);
  const rawStats = row.stats && typeof row.stats === "object" ? row.stats : {};
  const statsSource = String(rawStats.record_source ?? rawStats.recordSource ?? "").trim().toLowerCase();
  const stats = personalRecord || VERIFIED_PUBLIC_STAT_SOURCES.has(statsSource) ? rawStats : {};
  return {
    matchId: row.match_id ?? "",
    recordDate: row.record_date ?? "",
    occurredAt: row.occurred_at ?? null,
    side: row.side ?? "teamA",
    title: row.title ?? "경기 기록",
    mode: row.mode ?? "",
    courtId: row.court_id ?? "",
    court: row.court_name ?? "미정",
    teamId: row.team_id ?? "",
    teamName: row.team_name ?? (isTeamB ? "B사이드" : "A사이드"),
    opponentTeamId: row.opponent_team_id ?? "",
    opponentTeamName: row.opponent_team_name ?? (isTeamB ? "A사이드" : "B사이드"),
    score: Number(row.score_for ?? 0),
    opponentScore: Number(row.score_against ?? 0),
    result: row.outcome === "win" ? "W" : row.outcome === "loss" ? "L" : "D",
    ranked: row.ranked !== false,
    tournamentId: row.tournament_id ?? "",
    position: row.position ?? "",
    stats,
    recordType,
    visibility: row.visibility ?? "private",
    ownerProfileId: row.owner_profile_id ?? "",
  };
}

function appendRows(map, rows = []) {
  rows.forEach((row) => {
    if (!row?.match_id) return;
    const current = map.get(row.match_id) ?? [];
    current.push(row);
    map.set(row.match_id, current);
  });
}

function buildArchiveMatchState(context, archiveRows = [], profileRows = [], viewerTeamIds = new Set()) {
  const playersByMatch = new Map();
  const statsByMatch = new Map();
  const agreementsByMatch = new Map();
  const approvalsByMatch = new Map();
  const disputesByMatch = new Map();
  const resultsByMatch = {};
  const teamById = {};
  const courtById = {};
  const rawMatches = [];

  archiveRows.forEach((archiveRow) => {
    const payload = archiveRow?.payload && typeof archiveRow.payload === "object" ? archiveRow.payload : {};
    const matchRow = payload.match;
    if (!matchRow?.id) return;
    rawMatches.push(matchRow);
    appendRows(playersByMatch, asArray(payload.players));
    appendRows(statsByMatch, asArray(payload.stats));
    appendRows(agreementsByMatch, asArray(payload.agreements));
    appendRows(approvalsByMatch, asArray(payload.approvals));
    appendRows(disputesByMatch, asArray(payload.disputes));
    if (payload.result && typeof payload.result === "object" && Object.keys(payload.result).length) {
      resultsByMatch[matchRow.id] = payload.result;
    }
    asArray(payload.teams).forEach((teamRow) => {
      if (teamRow?.id) teamById[teamRow.id] = teamRow;
    });
    if (payload.court?.id) courtById[payload.court.id] = payload.court;
  });

  const users = profileRows.map((row) => ({
    ...fromRemoteProfile(row),
    privacy: toPublicProfilePrivacy(row.app_settings),
  }));
  const currentUser = context.profile
    ? fromRemoteProfile(context.profile)
    : createProfileShell(context.authUserId, context.authUser?.email ?? "");
  const userById = new Map(users.map((user) => [user.id, user]));
  userById.set(currentUser.id, { ...(userById.get(currentUser.id) ?? {}), ...currentUser });
  const teams = Object.values(teamById).map((teamRow) => ({
    ...toClientTeam(teamRow, viewerTeamIds.has(teamRow.id)
      ? [{ user_id: context.profileId, role: "regular" }]
      : []),
    membersPartial: true,
  }));
  const matches = rawMatches.map((matchRow) => fromRemoteMatch(matchRow, {
    playersByMatch,
    resultsByMatch,
    statsByMatch,
    disputesByMatch,
    agreementsByMatch,
    approvalsByMatch,
    teamById,
    courtById,
  }));

  return normalizeState({
    currentUserId: currentUser.id,
    users: [...userById.values()],
    teams,
    matches,
    settings: {
      ...DEFAULT_SETTINGS,
      ...getRemoteAppSettings(context.profile),
    },
  }, { includeDemo: false });
}

async function loadSubjectRows(client, options) {
  const table = options.scope === RECORD_SCOPE_TEAM ? "match_record_teams" : "match_record_participants";
  const subjectColumn = options.scope === RECORD_SCOPE_TEAM ? "team_id" : "profile_id";
  const columns = options.scope === RECORD_SCOPE_TEAM ? TEAM_RECORD_INDEX_COLUMNS : PROFILE_RECORD_INDEX_COLUMNS;
  const base = () => {
    let query = client.from(table).select(columns).eq(subjectColumn, options.subjectId);
    if (options.publicProfileOnly) {
      query = query.eq("visibility", "public");
    }
    return query
      .order("record_date", { ascending: false })
      .order("occurred_at", { ascending: false })
      .order("match_id", { ascending: false });
  };

  const recentPromise = options.includeDetail
    ? base()
      .gte("record_date", options.detailSince)
      .range(options.detailOffset, options.detailOffset + options.detailLimit)
    : Promise.resolve({ data: [], error: null });
  const archivePromise = options.includeArchive
    ? base()
      .gte("record_date", options.listSince)
      .lt("record_date", options.detailSince)
      .range(options.archiveOffset, options.archiveOffset + options.archiveLimit)
    : Promise.resolve({ data: [], error: null });
  const [recentResult, archiveResult] = await Promise.all([recentPromise, archivePromise]);
  if (recentResult.error) throw recentResult.error;
  if (archiveResult.error) throw archiveResult.error;
  const recentRows = recentResult.data ?? [];
  const archiveRows = archiveResult.data ?? [];
  return {
    recentRows: recentRows.slice(0, options.detailLimit),
    detailHasMore: recentRows.length > options.detailLimit,
    archiveRows: archiveRows.slice(0, options.archiveLimit),
    archiveHasMore: archiveRows.length > options.archiveLimit,
  };
}

async function loadViewerTeamIds(client, profileId = "", enabled = false) {
  if (!enabled || !profileId) return new Set();
  const { data, error } = await client
    .from("team_members")
    .select("team_id")
    .eq("user_id", profileId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.team_id).filter(Boolean));
}

export function canReadProfileRecord(row = {}, viewerProfileId = "", subjectId = "") {
  const personalRecord = ["solo", "personal_record"].includes(String(row.record_type ?? "").trim().toLowerCase());
  const ownsProfile = Boolean(viewerProfileId && viewerProfileId === subjectId);
  if (personalRecord && row.owner_profile_id !== subjectId) return false;
  return ownsProfile || (row.visibility ?? "private") === "public";
}

function mapPersonalRecordMetrics(row = {}, prefix = "") {
  const number = (field) => Number(row[`${prefix}${field}`] ?? 0);
  return {
    recordCount: number("record_count"), winCount: number("win_count"), lossCount: number("loss_count"),
    drawCount: number("draw_count"), statCount: number("stat_count"), points: number("points"),
    rebounds: number("rebounds"), assists: number("assists"), steals: number("steals"),
    blocks: number("blocks"), fouls: number("fouls"),
  };
}

export function limitPublicProfileStats(state = {}, subjectId = "", allowStats = false) {
  return {
    ...state,
    matches: (state.matches ?? []).map((match) => {
      if (!match.result) return match;
      const targetStats = match.result.playerStats?.[subjectId];
      const targetSubmission = match.result.statSubmissions?.[subjectId];
      return {
        ...match,
        result: {
          ...match.result,
          playerStats: allowStats && targetStats ? { [subjectId]: targetStats } : {},
          statSubmissions: allowStats && targetSubmission ? { [subjectId]: targetSubmission } : {},
        },
      };
    }),
  };
}

export function limitPublicPersonalSummary(summary = null, allowStats = false) {
  if (!summary || allowStats) return summary;
  return {
    ...summary,
    statCount: 0,
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    fouls: 0,
  };
}

function mapPersonalRecordSummary(row = {}, publicOnly = false) {
  const publicSummary = {
    ...mapPersonalRecordMetrics(row, "public_"),
    visibilityScope: "public",
  };
  if (publicOnly) return {
    ...publicSummary,
    publicRecordCount: publicSummary.recordCount,
  };
  return {
    ...mapPersonalRecordMetrics(row),
    publicRecordCount: publicSummary.recordCount,
    publicSummary,
    visibilityScope: "all",
  };
}

async function loadPersonalRecordSummary(client, profileId = "", publicOnly = false) {
  const { data, error } = await client
    .from("profile_personal_record_summaries")
    .select("profile_id,record_count,win_count,loss_count,draw_count,stat_count,points,rebounds,assists,steals,blocks,fouls,public_record_count,public_win_count,public_loss_count,public_draw_count,public_stat_count,public_points,public_rebounds,public_assists,public_steals,public_blocks,public_fouls")
    .eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  return mapPersonalRecordSummary(data ?? {}, publicOnly);
}

export function canReadTeamRecord(row = {}, profileId = "", viewerTeamIds = new Set(), isAdmin = false) {
  if (isAdmin) return true;
  if ((row.visibility ?? "public") !== "private") return true;
  if (viewerTeamIds.has(row.team_id) || viewerTeamIds.has(row.opponent_team_id)) return true;
  return asArray(row.reader_ids).includes(profileId);
}

export function buildRecordPage(options = {}) {
  return {
    detailIncluded: options.includeDetail,
    detailNextOffset: options.includeDetail && options.detailHasMore
      ? options.detailOffset + options.detailLimit
      : null,
    detailExhausted: !options.includeDetail ? null : !options.detailHasMore,
    detailLimit: options.detailLimit,
    detailOffset: options.detailOffset,
    detailCount: options.detailCount,
    archiveIncluded: options.includeArchive,
    archiveLimit: options.archiveLimit,
    archiveOffset: options.archiveOffset,
    archiveNextOffset: options.includeArchive && options.archiveHasMore
      ? options.archiveOffset + options.archiveLimit
      : null,
    archiveExhausted: !options.includeArchive ? null : !options.archiveHasMore,
  };
}

async function loadArchivePayloads(client, matchIds = []) {
  if (!matchIds.length) return [];
  const { data, error } = await client
    .from("match_record_archives")
    .select("match_id,payload")
    .in("match_id", matchIds);
  if (error) throw error;
  const rowById = new Map((data ?? []).map((row) => [row.match_id, row]));
  const missingIds = matchIds.filter((matchId) => !rowById.has(matchId));
  if (missingIds.length) {
    const missingError = new Error("record_archive_incomplete");
    missingError.statusCode = 503;
    throw missingError;
  }
  return matchIds.map((matchId) => rowById.get(matchId));
}

async function loadProfileRows(client, archiveRows = []) {
  const profileIds = unique(archiveRows.flatMap((archiveRow) => {
    const payload = archiveRow?.payload && typeof archiveRow.payload === "object" ? archiveRow.payload : {};
    const matchRow = payload.match && typeof payload.match === "object" ? payload.match : {};
    const resultRow = payload.result && typeof payload.result === "object" ? payload.result : {};
    // LEGACY READ-ONLY:
    // 과거 경기 데이터 해석 전용.
    // 신규 권한 판정 및 저장에 사용하지 않는다.
    return [
      matchRow.created_by,
      matchRow.referee_id,
      matchRow.former_referee_id,
      matchRow.voided_by,
      resultRow.submitted_by,
      ...flattenIdValues(matchRow.stat_recorders),
      ...flattenIdValues(matchRow.rules?.statRecorders),
      ...asArray(payload.players).map((row) => row?.user_id),
      ...asArray(payload.stats).flatMap((row) => [row?.user_id, row?.recorded_by]),
      ...asArray(payload.agreements).map((row) => row?.user_id),
      ...asArray(payload.approvals).map((row) => row?.user_id),
      ...asArray(payload.disputes).flatMap((row) => [row?.user_id, row?.resolved_by]),
    ];
  }));
  if (!profileIds.length) return [];
  const rows = [];
  for (let index = 0; index < profileIds.length; index += PROFILE_QUERY_CHUNK_SIZE) {
    const { data, error } = await client
      .from("profiles")
      .select(`${PROFILE_CARD_COLUMNS},app_settings`)
      .in("id", profileIds.slice(index, index + PROFILE_QUERY_CHUNK_SIZE));
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  return rows;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "method_not_allowed" });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const scope = String(body.scope ?? RECORD_SCOPE_PROFILE).trim().toLowerCase();
    if (!RECORD_SCOPES.has(scope)) {
      sendJson(response, 400, { error: "record_scope_invalid" });
      return;
    }
    const context = await getAuthenticatedContext(request, {
      allowMissingProfile: true,
      profileSelect: PROFILE_ME_COLUMNS,
    });
    const subjectId = scope === RECORD_SCOPE_TEAM
      ? String(body.teamId ?? "").trim()
      : String(body.profileId ?? context.profileId ?? "").trim();
    if (!subjectId) {
      sendJson(response, 400, { error: scope === RECORD_SCOPE_TEAM ? "team_id_required" : "profile_required" });
      return;
    }
    const publicProfileOnly = scope === RECORD_SCOPE_PROFILE && subjectId !== context.profileId;
    let subjectProfileRow = null;
    if (scope === RECORD_SCOPE_PROFILE) {
      const { data: profileRow, error: profileError } = await context.supabase
        .from("profiles").select(`${PROFILE_CARD_COLUMNS},app_settings`).eq("id", subjectId).maybeSingle();
      if (profileError) throw profileError;
      if (!profileRow) {
        sendJson(response, 404, { error: "profile_not_found", profileId: subjectId });
        return;
      }
      subjectProfileRow = profileRow;
    }
    if (scope === RECORD_SCOPE_TEAM) {
      const { data: teamRow, error: teamError } = await context.supabase
        .from("teams")
        .select("id")
        .eq("id", subjectId)
        .is("deleted_at", null)
        .maybeSingle();
      if (teamError) throw teamError;
      if (!teamRow) {
        sendJson(response, 404, { error: "team_not_found", teamId: subjectId });
        return;
      }
    }

    const { detailSince, listSince } = getRecordWindowDates();
    const includeDetail = normalizeBoolean(body.includeDetail, true);
    const includeArchive = normalizeBoolean(body.includeArchive, true);
    if (!includeDetail && !includeArchive) {
      sendJson(response, 400, { error: "record_range_required" });
      return;
    }
    const archiveLimit = normalizeLimit(body.archiveLimit, REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT, REMOTE_CLIENT_RECORD_ARCHIVE_LIMIT);
    const archiveOffset = normalizeOffset(body.archiveOffset);
    const detailLimit = normalizeLimit(body.detailLimit, REMOTE_CLIENT_RECORD_MATCH_LIMIT, REMOTE_CLIENT_RECORD_MATCH_LIMIT);
    const detailOffset = normalizeOffset(body.detailOffset);
    const isAdmin = scope === RECORD_SCOPE_TEAM && context.profileId
      ? await getAdminLevel(context) >= 30
      : false;
    const viewerTeamIds = await loadViewerTeamIds(
      context.supabase,
      context.profileId,
      scope === RECORD_SCOPE_TEAM && !isAdmin,
    );
    const subjectRows = await loadSubjectRows(context.supabase, {
      scope,
      subjectId,
      detailSince,
      listSince,
      detailLimit,
      detailOffset,
      archiveLimit,
      archiveOffset,
      includeDetail,
      includeArchive,
      publicProfileOnly,
    });
    const readableRecentRows = scope === RECORD_SCOPE_TEAM
      ? subjectRows.recentRows.filter((row) => canReadTeamRecord(row, context.profileId, viewerTeamIds, isAdmin))
      : subjectRows.recentRows.filter((row) => canReadProfileRecord(row, context.profileId, subjectId));
    const readableArchiveRows = scope === RECORD_SCOPE_TEAM
      ? subjectRows.archiveRows.filter((row) => canReadTeamRecord(row, context.profileId, viewerTeamIds, isAdmin))
      : subjectRows.archiveRows.filter((row) => canReadProfileRecord(row, context.profileId, subjectId));
    const recentMatchIds = unique(readableRecentRows.map((row) => row.match_id));
    const archivePayloads = await loadArchivePayloads(context.supabase, recentMatchIds);
    const loadedProfileRows = await loadProfileRows(context.supabase, archivePayloads);
    const profileRows = [...new Map(
      [subjectProfileRow, ...loadedProfileRows]
        .filter((row) => row?.id)
        .map((row) => [row.id, row]),
    ).values()];
    const profilePrivacy = scope === RECORD_SCOPE_PROFILE
      ? toPublicProfilePrivacy(subjectProfileRow?.app_settings)
      : null;
    const rawState = buildArchiveMatchState(context, archivePayloads, profileRows, viewerTeamIds);
    const readableState = filterStateForProfile(rawState, context.profileId, isAdmin);
    const state = publicProfileOnly
      ? limitPublicProfileStats(readableState, subjectId, profilePrivacy?.statSummary === true)
      : readableState;
    const archiveRecords = readableArchiveRows.map((row) => {
      const record = mapCompactRecord(row);
      return publicProfileOnly && profilePrivacy?.statSummary !== true
        ? { ...record, stats: {} }
        : record;
    });
    const rawPersonalSummary = scope === RECORD_SCOPE_PROFILE
      ? await loadPersonalRecordSummary(context.supabase, subjectId, publicProfileOnly)
      : null;
    const personalSummary = publicProfileOnly
      ? limitPublicPersonalSummary(rawPersonalSummary, profilePrivacy?.statSummary === true)
      : rawPersonalSummary;

    sendJson(response, 200, {
      ok: true,
      scope,
      subjectId,
      personalSummary,
      windows: {
        detailMonths: REMOTE_CLIENT_RECORD_MONTHS,
        listYears: REMOTE_CLIENT_RECORD_LIST_YEARS,
        detailSince,
        listSince,
      },
      state: {
        ...state,
        teams: [],
        recruitingPosts: [],
        tournaments: [],
        reports: [],
        notifications: [],
        discordNotificationDeliveries: [],
      },
      archiveRecords,
      page: buildRecordPage({
        includeDetail,
        detailHasMore: subjectRows.detailHasMore,
        detailLimit,
        detailOffset,
        detailCount: recentMatchIds.length,
        includeArchive,
        archiveHasMore: subjectRows.archiveHasMore,
        archiveLimit,
        archiveOffset,
      }),
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, { error: error.message || "record_list_failed" });
  }
}
