import { normalizeDisputeWindowMinutes } from "./constants.js";

const RETIRED_MATCH_RECORDER_RULE_KEYS = Object.freeze([
  "statRecorders",
  "dualScoreRecorderSide",
]);

export function getDatePart(value) {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

export function getTimePart(value) {
  return String(value ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "";
}

export function toDbTime(value) {
  return value ? String(value).slice(0, 5) : null;
}

export function toDateTime(date, time, fallback, missingLabel = "일정 미정") {
  if (date && time) return `${date} ${String(time).slice(0, 5)}`;
  if (date) return date;
  return fallback ?? missingLabel;
}

export function getDbScheduleParts(item = {}) {
  const timingType = (
    item.timingType
    ?? item.timing_type
    ?? item.roomState?.timingType
    ?? item.room_state?.timingType
    ?? item.rules?.timingType
  ) === "instant" ? "instant" : "scheduled";
  const scheduledAtValue = item.scheduledAt ?? item.scheduled_at;
  const scheduledDate = timingType === "instant"
    ? null
    : item.scheduledDate || item.scheduled_date || getDatePart(scheduledAtValue) || null;
  const scheduledTime = timingType === "instant"
    ? null
    : toDbTime(item.scheduledTime ?? item.scheduled_time ?? getTimePart(scheduledAtValue));
  return {
    timingType,
    scheduledDate,
    scheduledTime,
    scheduledAt: timingType === "instant" ? null : [scheduledDate, scheduledTime].filter(Boolean).join(" ") || null,
  };
}

export function projectMatchPersistenceParts(match = {}) {
  const rules = { ...(match.rules ?? {}) };
  RETIRED_MATCH_RECORDER_RULE_KEYS.forEach((key) => {
    delete rules[key];
  });
  return {
    rules,
    playedPlayerIds: match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {},
    reservePlayers: match.reservePlayers ?? match.rules?.reservePlayers ?? {},
    mmrExcludedPlayerIds: match.mmrExcludedPlayerIds ?? match.rules?.mmrExcludedPlayerIds ?? [],
    anonymousPlayers: match.anonymousPlayers ?? {},
  };
}

export function projectMatchDbFields(match = {}, options = {}) {
  const schedule = options.schedule ?? getDbScheduleParts(match);
  const {
    rules,
    playedPlayerIds,
    reservePlayers,
    mmrExcludedPlayerIds,
    anonymousPlayers,
  } = options.persistence ?? projectMatchPersistenceParts(match);
  const visibility = match.visibility ?? match.rules?.visibility ?? "private";
  return {
    visibility,
    status: match.status ?? "contract",
    ranked: match.ranked !== false,
    mmr_limit_mode: match.mmrLimitMode ?? "block",
    trust_feedback: match.trustFeedback ?? {},
    referee_id: match.refereeId || null,
    former_referee_id: match.formerRefereeId || null,
    referee_trust_min: Number(match.refereeTrustMin ?? 90),
    stat_entry_minutes: Number(match.statEntryMinutes ?? 60),
    dispute_minutes: normalizeDisputeWindowMinutes(match.disputeMinutes),
    stat_recorders: {},
    played_player_ids: playedPlayerIds,
    reserve_players: reservePlayers,
    promoted_reserve_ids: match.promotedReserveIds ?? {},
    attendance: match.attendance ?? { teamA: [], teamB: [] },
    referee_absence_request: match.refereeAbsenceRequest ?? null,
    dispute_draft_result: match.disputeDraftResult ?? null,
    dispute_draft_updated_at: match.disputeDraftUpdatedAt ?? null,
    dispute_resolved_at: match.disputeResolvedAt ?? null,
    mmr_excluded_player_ids: mmrExcludedPlayerIds,
    anonymous_players: anonymousPlayers,
    tournament_id: match.tournamentId ?? null,
    tournament_format: match.tournamentFormat ?? null,
    tournament_round: match.tournamentRound ?? null,
    tournament_fixture: match.tournamentFixture ?? null,
    tournament_mmr_policy: match.tournamentMmrPolicy ?? null,
    official: Boolean(match.official),
    pre_registered: Boolean(match.preRegistered),
    scheduled_at: schedule.scheduledAt,
    scheduled_date: schedule.scheduledDate,
    scheduled_time: schedule.scheduledTime,
    score_a: Number(match.result?.scoreA ?? 0),
    score_b: Number(match.result?.scoreB ?? 0),
    rules: {
      ...rules,
      timingType: schedule.timingType,
      visibility,
    },
    evidence: match.evidence ?? [],
    rating_result: match.ratingResult ?? null,
    team_rating_result: match.teamRatingResult ?? null,
  };
}

export function projectPlayerStatDbFields(match = {}, userId = "", stat = {}) {
  const submission = match.result?.statSubmissions?.[userId] ?? {};
  return {
    recorded_by: submission.by ?? null,
    record_source: submission.source ?? "player",
    points: Number(stat.points ?? 0),
    rebounds: Number(stat.rebounds ?? 0),
    assists: Number(stat.assists ?? 0),
    steals: Number(stat.steals ?? 0),
    blocks: Number(stat.blocks ?? 0),
    turnovers: Number(stat.turnovers ?? 0),
    fouls: Number(stat.fouls ?? 0),
  };
}

export function projectPlayerStatRows(match = {}, updatedAt = new Date().toISOString()) {
  return Object.entries(match.result?.playerStats ?? {}).map(([userId, stat]) => ({
    match_id: match.id,
    user_id: userId,
    ...projectPlayerStatDbFields(match, userId, stat),
    updated_at: updatedAt,
  }));
}
