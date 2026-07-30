import {
  allowRequestMethod,
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
import { filterStateForProfile } from "../../lib/stateVisibility.js";
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

export const RECORD_SCOPE_PROFILE = "profile";

export const RECORD_SCOPE_TEAM = "team";

export const RECORD_SCOPES = new Set([RECORD_SCOPE_PROFILE, RECORD_SCOPE_TEAM]);

export const VERIFIED_PUBLIC_STAT_SOURCES = new Set(["referee", "dispute_operator"]);

export function normalizeLimit(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(parsed)));
}

export function normalizeOffset(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function normalizeBoolean(value, fallback = true) {
  return value === undefined ? fallback : value !== false;
}

export function mapCompactRecord(row = {}) {
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

export function canReadProfileRecord(row = {}, viewerProfileId = "", subjectId = "") {
  const personalRecord = ["solo", "personal_record"].includes(String(row.record_type ?? "").trim().toLowerCase());
  const ownsProfile = Boolean(viewerProfileId && viewerProfileId === subjectId);
  if (personalRecord && row.owner_profile_id !== subjectId) return false;
  return ownsProfile || (row.visibility ?? "private") === "public";
}

export function mapPersonalRecordMetrics(row = {}, prefix = "") {
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

export function mapPersonalRecordSummary(row = {}, publicOnly = false) {
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
