import {
  MATCH_SIDE_FALLBACK_NAMES,
  POST_MATCH_STATUSES,
  PLAYER_POSITIONS,
  PLAYER_STAT_FIELDS,
  REFEREE_TRUST_MIN,
  SOLO_RECORD_ANONYMOUS_POSITION,
  SOLO_RECORD_ANONYMOUS_SOURCE,
  SOLO_RECORD_MODE_IDS,
  STAT_ENTRY_WINDOW_MINUTES,
  normalizeDisputeWindowMinutes,
  normalizeBenchCapacity,
} from "../lib/constants.js";
import { addDateDays, getLocalDateInputValue, normalizeStatRecorders } from "../lib/matchUtils.js";
import {
  clearFuturePregameStartState,
  isFutureScheduledMatch,
  normalizeDisputeMinutes,
  repairFuturePregameTitle,
  repairLifecycleTitle,
  resetFuturePostMatchState,
} from "./matchLifecycleUtils.js";
import { makeId, uniquePlayerIds } from "./rowUtils.js";

function normalizeMatchParties(parties) {
  if (Array.isArray(parties)) return parties;
  if (!parties || typeof parties !== "object") return [];
  return Object.values(parties).filter((party) => party && typeof party === "object");
}

function normalizeMatchIdList(value) {
  return Array.isArray(value) ? uniquePlayerIds(value) : [];
}

function normalizeMatchSide(side = {}, fallbackName = "") {
  const source = side && typeof side === "object" ? side : {};
  return {
    ...source,
    name: source.name ?? fallbackName,
    teamId: source.teamId || null,
    players: normalizeMatchIdList(source.players),
    score: Number.isFinite(Number(source.score)) ? Number(source.score) : 0,
  };
}

export function normalizeMatch(match = {}, options = {}) {
  const source = match && typeof match === "object" ? match : {};
  const startedStatuses = ["agreed", "approval", "confirmed", "disputed", "void", "cancelled"];
  const started = startedStatuses.includes(source.status);
  const teamA = normalizeMatchSide(source.teamA, MATCH_SIDE_FALLBACK_NAMES.teamA);
  const teamB = normalizeMatchSide(source.teamB, MATCH_SIDE_FALLBACK_NAMES.teamB);
  const teamAPlayers = teamA.players;
  const teamBPlayers = teamB.players;
  const playedPlayerIds = source.playedPlayerIds ?? source.rules?.playedPlayerIds ?? {};
  const normalizedPlayedPlayerIds = {
    teamA: normalizeMatchIdList(playedPlayerIds.teamA),
    teamB: normalizeMatchIdList(playedPlayerIds.teamB),
  };

  const normalized = {
    ...source,
    status: source.status ?? "contract",
    teamA,
    teamB,
    agreements: source.agreements ?? {
      teamA: started ? [...teamAPlayers] : [],
      teamB: started ? [...teamBPlayers] : [],
    },
    approvals: source.approvals ?? { teamA: [], teamB: [] },
    disputes: source.disputes ?? [],
    refereeId: source.refereeId ?? "",
    refereeTrustMin: Number(source.refereeTrustMin ?? REFEREE_TRUST_MIN),
    statRecorders: normalizeStatRecorders(source.statRecorders ?? source.rules?.statRecorders),
    statEntryMinutes: Number(source.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES),
    disputeMinutes: normalizeDisputeMinutes(source),
    trustFeedback: source.trustFeedback ?? {},
    parties: normalizeMatchParties(source.parties ?? source.rules?.parties),
    playedPlayerIds: normalizedPlayedPlayerIds,
    rules: {
      ...(source.rules ?? {}),
      playedPlayerIds: normalizedPlayedPlayerIds,
    },
  };

  if (options.preserveAuthoritativeLifecycle === true) {
    return repairLifecycleTitle(normalized);
  }

  const pregameStartRepaired = clearFuturePregameStartState(normalized);

  if (isFutureScheduledMatch(pregameStartRepaired)) {
    if (POST_MATCH_STATUSES.has(pregameStartRepaired.status)) {
      return resetFuturePostMatchState(pregameStartRepaired);
    }
    return repairFuturePregameTitle(repairLifecycleTitle(pregameStartRepaired));
  }

  return repairLifecycleTitle(pregameStartRepaired);
}

export function toSoloRecordNumber(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(999, Math.floor(number)));
}

export function makeSoloRecordStats(score, stats = {}) {
  return Object.fromEntries(
    PLAYER_STAT_FIELDS.map((field) => [
      field.id,
      field.id === "points" ? toSoloRecordNumber(score) : toSoloRecordNumber(stats[field.id]),
    ]),
  );
}

export function normalizeSoloRecordMode(mode = "1v1") {
  const text = String(mode || "1v1").trim();
  return SOLO_RECORD_MODE_IDS.has(text) ? text : "1v1";
}

export function getSoloRecordSideSize(mode = "1v1") {
  const match = String(mode).match(/^(\d+)/);
  const value = match ? Number(match[1]) : 1;
  return Math.max(1, Math.min(5, Number.isFinite(value) ? value : 1));
}

export function parseSoloRecordRosterText(value = "") {
  return String(value ?? "")
    .split(/[\n,]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(" ");
      const maybePosition = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
      const hasPosition = PLAYER_POSITIONS.includes(maybePosition) && maybePosition !== "상관없음";
      return {
        name: hasPosition ? parts.slice(0, -1).join(" ").trim() : line,
        position: hasPosition ? maybePosition : SOLO_RECORD_ANONYMOUS_POSITION,
      };
    })
    .filter((entry) => entry.name);
}

function getSoloRecordEntryIdentity(entry = {}) {
  const text = String(entry.name ?? "").replace(/\s+/g, " ").trim();
  const hashtag = text.match(/#[^\s#]+/);
  if (hashtag?.[0]) return hashtag[0].toLowerCase();
  return text.toLowerCase();
}

export function getSoloRecordRosterError(teamAEntries = [], teamBEntries = [], sideSize = 1) {
  const teamALimit = Math.max(0, sideSize - 1);
  if (teamAEntries.length > teamALimit) return `우리 사이드는 본인 제외 ${teamALimit}명까지만 추가할 수 있습니다.`;
  if (teamBEntries.length > sideSize) return `상대 사이드는 ${sideSize}명까지만 추가할 수 있습니다.`;
  const seen = new Set();
  for (const entry of [...teamAEntries, ...teamBEntries]) {
    const identity = getSoloRecordEntryIdentity(entry);
    if (!identity) continue;
    if (seen.has(identity)) return "같은 선수를 우리/상대 또는 같은 사이드에 중복으로 넣을 수 없습니다.";
    seen.add(identity);
  }
  return "";
}

export function makeSoloRecordAnonymousSide({ count, entries = [] } = {}) {
  let anonymousIndex = 0;
  return Array.from({ length: count }, (_, index) => {
    const entry = entries[index] ?? {};
    const name = entry.name || `무기명 ${++anonymousIndex}`;
    return {
      id: makeId("anon"),
      name,
      position: entry.position || SOLO_RECORD_ANONYMOUS_POSITION,
      participationLabel: SOLO_RECORD_ANONYMOUS_SOURCE,
    };
  });
}

export function getSoloRecordDateRange(now = new Date()) {
  const today = getLocalDateInputValue(now);
  return {
    max: today,
    min: addDateDays(today, -1),
  };
}

function toDateTime(date, time, fallback) {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? "일정 미정";
}

export function getRemoteMatchActivePlayerIds(row = {}, sideName, playerRows = []) {
  const reservePlayers = row.reserve_players ?? row.rules?.reservePlayers ?? {};
  const reserveIds = new Set(normalizeMatchIdList(reservePlayers?.[sideName]));
  return uniquePlayerIds(
    [...(playerRows ?? [])]
      .filter((player) => player.side === sideName && !reserveIds.has(player.user_id))
      .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0))
      .map((player) => player.user_id),
  );
}

export function fromRemoteMatch(row, context) {
  const matchPlayers = context.playersByMatch.get(row.id) ?? [];
  const teamAPlayers = getRemoteMatchActivePlayerIds(row, "teamA", matchPlayers);
  const teamBPlayers = getRemoteMatchActivePlayerIds(row, "teamB", matchPlayers);
  const resultRow = context.resultsByMatch[row.id];
  const statRows = context.statsByMatch.get(row.id) ?? [];
  const playerStats = Object.fromEntries(
    statRows.map((stat) => [
      stat.user_id,
      {
        points: stat.points ?? 0,
        rebounds: stat.rebounds ?? 0,
        assists: stat.assists ?? 0,
        steals: stat.steals ?? 0,
        blocks: stat.blocks ?? 0,
        fouls: stat.fouls ?? 0,
      },
    ]),
  );
  const disputes = (context.disputesByMatch.get(row.id) ?? []).map((dispute) => ({
    id: dispute.id,
    by: dispute.user_id,
    reason: dispute.reason,
    request: dispute.request_payload ?? {},
    status: dispute.status ?? "open",
    resolvedAt: dispute.resolved_at ?? null,
    resolvedBy: dispute.resolved_by ?? "",
    resolution: dispute.resolution ?? "",
    createdAt: dispute.created_at,
  }));
  const agreements = {
    teamA: (context.agreementsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamA").map((item) => item.user_id),
    teamB: (context.agreementsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamB").map((item) => item.user_id),
  };
  const reapprovalStartedAt = row.dispute_resolved_at ? Date.parse(row.dispute_resolved_at) : Number.NaN;
  const currentApprovalRows = (context.approvalsByMatch.get(row.id) ?? []).filter((item) => (
    !Number.isFinite(reapprovalStartedAt)
      || (Number.isFinite(Date.parse(item.approved_at)) && Date.parse(item.approved_at) >= reapprovalStartedAt)
  ));
  const approvals = {
    teamA: currentApprovalRows.filter((item) => item.side === "teamA").map((item) => item.user_id),
    teamB: currentApprovalRows.filter((item) => item.side === "teamB").map((item) => item.user_id),
  };
  const teamA = context.teamById[row.team_a_id];
  const teamB = context.teamById[row.team_b_id];
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const legacyInstant = !row.rules?.timingType && rawScheduledAt === "즉시";
  const timingType = row.rules?.timingType === "instant" || legacyInstant ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "즉시" : rawScheduledAt;
  const playedPlayerIds = row.played_player_ids ?? row.rules?.playedPlayerIds ?? {};
  const mmrExcludedPlayerIds = row.mmr_excluded_player_ids ?? row.rules?.mmrExcludedPlayerIds ?? [];
  const statRecorders = normalizeStatRecorders(row.stat_recorders ?? row.rules?.statRecorders);
  const recordTeamAName = String(row.rules?.recordSummary?.teamAName ?? "").trim() || MATCH_SIDE_FALLBACK_NAMES.teamA;
  const recordTeamBName = String(row.rules?.recordSummary?.teamBName ?? "").trim() || MATCH_SIDE_FALLBACK_NAMES.teamB;
  const scoreA = resultRow?.score_a ?? row.score_a ?? 0;
  const scoreB = resultRow?.score_b ?? row.score_b ?? 0;

  return {
    id: row.id,
    title: row.title,
    mode: row.mode,
    courtId: row.court_id ?? null,
    court: row.court_name ?? context.courtById[row.court_id]?.name ?? "미정",
    visibility: row.visibility ?? row.rules?.visibility ?? "public",
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt,
    timingType,
    status: row.status ?? "contract",
    official: Boolean(row.official),
    preRegistered: Boolean(row.pre_registered),
    rules: { ...(row.rules ?? {}), benchCapacity: normalizeBenchCapacity(row.benchCapacity ?? row.rules?.benchCapacity), playedPlayerIds, mmrExcludedPlayerIds, statRecorders },
    memo: row.memo,
    stakes: row.stakes,
    ranked: row.ranked !== false,
    mmrLimitMode: row.mmr_limit_mode ?? "block",
    mmrRangeMode: row.rules?.mmrRangeMode,
    ratingScale: row.rules?.ratingScale,
    trustFeedback: row.trust_feedback ?? {},
    refereeId: row.referee_id ?? "",
    refereeTrustMin: row.referee_trust_min ?? REFEREE_TRUST_MIN,
    statRecorders,
    statEntryMinutes: row.stat_entry_minutes ?? STAT_ENTRY_WINDOW_MINUTES,
    disputeMinutes: normalizeDisputeWindowMinutes(row.dispute_minutes),
    createdBy: row.created_by ?? "",
    recruitingPostId: row.rules?.recruitingPostId ?? "",
    tournamentId: row.tournament_id,
    tournamentFormat: row.tournament_format,
    tournamentRound: row.tournament_round,
    tournamentFixture: row.tournament_fixture,
    tournamentMmrPolicy: row.tournament_mmr_policy,
    forfeitSide: row.rules?.forfeit?.losingSide ?? "",
    forfeitReason: row.rules?.forfeit?.reason ?? "",
    forfeitedAt: row.rules?.forfeit?.decidedAt ?? null,
    forfeitedBy: row.rules?.forfeit?.decidedBy ?? "",
    objectionWindow: row.objection_window,
    evidence: row.evidence ?? [],
    teamA: { name: teamA?.name ?? recordTeamAName, teamId: row.team_a_id, players: teamAPlayers, score: scoreA },
    teamB: { name: teamB?.name ?? recordTeamBName, teamId: row.team_b_id, players: teamBPlayers, score: scoreB },
    agreements,
    approvals,
    disputes,
    playedPlayerIds,
    reservePlayers: row.reserve_players ?? row.rules?.reservePlayers ?? {},
    promotedReserveIds: row.promoted_reserve_ids ?? {},
    attendance: row.attendance ?? { teamA: [], teamB: [] },
    refereeAbsenceRequest: row.referee_absence_request ?? null,
    formerRefereeId: row.former_referee_id ?? "",
    disputeDraftResult: row.dispute_draft_result ?? null,
    disputeDraftUpdatedAt: row.dispute_draft_updated_at ?? null,
    disputeResolvedAt: row.dispute_resolved_at ?? null,
    voidReason: row.void_reason ?? "",
    voidedBy: row.voided_by ?? "",
    voidSnapshot: row.void_snapshot ?? {},
    voidReview: row.void_review ?? {},
    mmrExcludedPlayerIds,
    anonymousPlayers: row.anonymous_players ?? {},
    result: resultRow
      ? {
          scoreA: resultRow.score_a,
          scoreB: resultRow.score_b,
          playerStats,
          statSubmissions: resultRow.stat_submissions ?? {},
          submittedBy: resultRow.submitted_by,
          submittedAt: resultRow.submitted_at,
        }
      : null,
    ratingResult: Array.isArray(row.rating_result) ? row.rating_result : null,
    teamRatingResult: row.team_rating_result && !Array.isArray(row.team_rating_result) ? row.team_rating_result : null,
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
