import {
  DISPUTE_WINDOW_MINUTES,
  MATCH_SIDE_FALLBACK_NAMES,
  REFEREE_TRUST_MIN,
  STAT_ENTRY_WINDOW_MINUTES,
} from "../lib/constants.js";
import { normalizeStatRecorders } from "../lib/matchUtils.js";

function toDateTime(date, time, fallback) {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? "?쇱젙 誘몄젙";
}

export function fromRemoteMatch(row, context) {
  const teamAPlayers = [...(context.playersByMatch.get(row.id) ?? [])]
    .filter((player) => player.side === "teamA")
    .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0))
    .map((player) => player.user_id);
  const teamBPlayers = [...(context.playersByMatch.get(row.id) ?? [])]
    .filter((player) => player.side === "teamB")
    .sort((a, b) => (a.slot_order ?? 0) - (b.slot_order ?? 0))
    .map((player) => player.user_id);
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
    createdAt: dispute.created_at,
  }));
  const agreements = {
    teamA: (context.agreementsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamA").map((item) => item.user_id),
    teamB: (context.agreementsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamB").map((item) => item.user_id),
  };
  const approvals = {
    teamA: (context.approvalsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamA").map((item) => item.user_id),
    teamB: (context.approvalsByMatch.get(row.id) ?? []).filter((item) => item.side === "teamB").map((item) => item.user_id),
  };
  const teamA = context.teamById[row.team_a_id];
  const teamB = context.teamById[row.team_b_id];
  const rawScheduledAt = toDateTime(row.scheduled_date, row.scheduled_time, row.scheduled_at);
  const legacyInstant = !row.rules?.timingType && rawScheduledAt === "利됱떆";
  const timingType = row.rules?.timingType === "instant" || legacyInstant ? "instant" : "scheduled";
  const scheduledAt = timingType === "instant" ? "利됱떆" : rawScheduledAt;
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
    court: row.court_name ?? context.courtById[row.court_id]?.name ?? "誘몄젙",
    visibility: row.visibility ?? row.rules?.visibility ?? "public",
    scheduledDate: row.scheduled_date,
    scheduledTime: row.scheduled_time ? String(row.scheduled_time).slice(0, 5) : "",
    scheduledAt,
    timingType,
    status: row.status ?? "contract",
    official: Boolean(row.official),
    preRegistered: Boolean(row.pre_registered),
    rules: { ...(row.rules ?? {}), playedPlayerIds, mmrExcludedPlayerIds, statRecorders },
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
    disputeMinutes: row.dispute_minutes ?? DISPUTE_WINDOW_MINUTES,
    createdBy: row.created_by ?? "",
    tournamentId: row.tournament_id,
    tournamentFormat: row.tournament_format,
    tournamentRound: row.tournament_round,
    tournamentFixture: row.tournament_fixture,
    tournamentMmrPolicy: row.tournament_mmr_policy,
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
