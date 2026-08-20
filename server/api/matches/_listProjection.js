import { flattenIdValues, toDateTime, uniqueValues as unique } from "../_supabaseAdmin.js";
import { projectMatchTimestamps } from "../../../shared/lib/matchReadProjection.js";
import { projectTeamRow } from "../../../shared/lib/teamRowProjection.js";
import { collectUniqueRoomFeedCards, readRoomFeedCard } from "../../lib/roomFeedCards.js";
import { getReadableMatchStatRows, getReadableMatchStatSubmissions, getRemoteMatchActivePlayerIds, getRemoteMatchPlayerTeams, normalizeMatchParties } from "../../../shared/lib/matchMappers.js";
import { MATCH_SIDE_FALLBACK_NAMES, normalizeDisputeWindowMinutes } from "../../../shared/lib/constants.js";
import { getMatchRoomPhase, isMatchClosedNotice, isMatchInScheduleMenu, isMatchRecordMatch, isPersonalRecordMatch, isSeedSampleMatch } from "../../../shared/lib/matchUtils.js";
import { isPubliclyReadableConfirmedMatch } from "../../../shared/lib/matchRecordTypes.js";

const ACTIVE_MATCH_EXCLUDED_PHASES = new Set(["record"]);

export function sortByFeedOrder(items = [], ids = []) {
  const order = new Map((ids ?? []).filter(Boolean).map((id, index) => [id, index]));
  return [...(items ?? [])].sort((a, b) => {
    const orderA = order.has(a?.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
    const orderB = order.has(b?.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return String(b?.updatedAt ?? b?.createdAt ?? "").localeCompare(String(a?.updatedAt ?? a?.createdAt ?? ""));
  });
}

export function appendRowFallbackSource(source = "feed") {
  return String(source).includes("+row") ? source : `${source}+row`;
}

export function mergeMatchCardsWithRows(cards = [], rows = []) {
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

export function mergeMatchRowsById(rows = [], extraRows = []) {
  const merged = new Map((rows ?? []).filter((row) => row?.id).map((row) => [row.id, row]));
  (extraRows ?? []).forEach((row) => {
    if (row?.id) merged.set(row.id, row);
  });
  return [...merged.values()];
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

export function uniqueFeedCards(rows = [], ids = []) {
  return collectUniqueRoomFeedCards(rows, ids, {
    normalizeCard: normalizeMatchFeedCard,
  });
}

export function collectMissingMatchCardReferences(cards = []) {
  return {
    teamIds: unique((cards ?? []).flatMap((match) => [
      match?.teamA?.teamId && !match?.teamA?.name ? match.teamA.teamId : "",
      match?.teamB?.teamId && !match?.teamB?.name ? match.teamB.teamId : "",
    ])),
    courtIds: unique((cards ?? []).map((match) => match?.courtId)),
  };
}

export function attachMatchCardReferences(match = {}, teamById = {}, courtById = {}) {
  if (!match?.id) return match;
  const courtName = courtById[match.courtId]?.name ?? match.court;
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

function isSoloRecordMatch(match = {}) {
  return isPersonalRecordMatch(match);
}

export function filterActiveMatchCards(matches = [], activeOnly = false, options = {}) {
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

function getMatchUserIds(match = {}) {
  return unique([
    match.createdBy,
    match.refereeId,
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
    ...(match.playedPlayerIds?.teamA ?? []),
    ...(match.playedPlayerIds?.teamB ?? []),
    ...(match.reservePlayers?.teamA ?? []),
    ...(match.reservePlayers?.teamB ?? []),
  ]);
}

export function isPlayableMatch(match = {}, profileId = "") {
  const recordType = String(match.rules?.recordType ?? "").trim().toLowerCase();
  if (["personal_record", "solo"].includes(recordType)) return false;
  if (!["agreed", "approval", "disputed"].includes(match.status)) return false;
  return getMatchUserIds(match).includes(profileId);
}

export function isPlayableMatchRow(row = {}, players = [], profileId = "") {
  const recordType = String(row.rules?.recordType ?? row.rules?.record_type ?? "").trim().toLowerCase();
  if (["personal_record", "solo"].includes(recordType)) return false;
  if (!["agreed", "approval", "disputed"].includes(row.status)) return false;
  return unique([
    row.created_by,
    row.referee_id,
    ...players.map((player) => player.user_id),
    ...flattenIdValues(row.played_player_ids),
    ...flattenIdValues(row.reserve_players),
  ]).includes(profileId);
}

export function getMatchRowActorIds(row = {}, players = []) {
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

export function canReadMatchRow(row = {}, players = [], profileId = "", isAdmin = false) {
  if (isAdmin) return true;
  if (isPubliclyReadableConfirmedMatch(row)) return true;
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
  const playerRows = playersByMatch.get(row.id) ?? [];
  const recordName = String(
    (sideName === "teamA" ? row.rules?.recordSummary?.teamAName : row.rules?.recordSummary?.teamBName) ?? "",
  ).trim();
  return {
    teamId,
    name: teamById[teamId]?.name ?? (recordName || MATCH_SIDE_FALLBACK_NAMES[sideName] || MATCH_SIDE_FALLBACK_NAMES.teamA),
    players: getRemoteMatchActivePlayerIds(row, sideName, playerRows),
    playerTeams: getRemoteMatchPlayerTeams(sideName, teamId, playerRows),
    score: score ?? 0,
  };
}

function toClientMatchResult(resultRow = null, statRows = [], allowPersonalStats = true) {
  const safeStatRows = allowPersonalStats ? statRows ?? [] : [];
  if (!resultRow && !safeStatRows.length) return null;
  return {
    scoreA: Number(resultRow?.score_a ?? 0),
    scoreB: Number(resultRow?.score_b ?? 0),
    periodScores: resultRow?.period_scores ?? [],
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
    finalSubmittedBy: resultRow?.final_submitted_by ?? "",
    finalSubmittedAt: resultRow?.final_submitted_at ?? "",
    updatedAt: resultRow?.submitted_at ?? "",
  };
}

export function toClientMatch(row = {}, playersByMatch = new Map(), teamById = {}, courtById = {}, resultsByMatch = {}, statsByMatch = new Map()) {
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
    court: courtById[row.court_id]?.name ?? row.court_name ?? "\uBBF8\uC815",
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
    parties: normalizeMatchParties(row.rules?.parties),
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
