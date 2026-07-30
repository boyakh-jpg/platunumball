import { MATCH_SIDES } from "./constants.js";
import { isTerminalMatchStatus } from "./notifications.js";

export const TOURNAMENT_SCHEDULE_REVISION_LIMIT = 1;

export function hasTournamentMatchSchedule(match = {}) {
  return Boolean(
    String(match.scheduledDate ?? "").match(/^\d{4}-\d{2}-\d{2}$/)
    && String(match.scheduledTime ?? "").match(/^\d{2}:\d{2}/),
  );
}

export function getTournamentScheduleRevisionCount(match = {}) {
  const value = Number.parseInt(match.rules?.tournamentScheduleRevisionCount, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function hasTournamentLineupSubmission(match = {}) {
  return Boolean(
    match.tournamentId
    && MATCH_SIDES.some((sideName) => match.rules?.rosterReady?.[sideName] === true),
  );
}

export function getTournamentScheduleEditPolicy(match = {}) {
  const revisionCount = getTournamentScheduleRevisionCount(match);
  const hasSchedule = hasTournamentMatchSchedule(match);
  if (
    !match?.tournamentId
    || match.status === "confirmed"
    || isTerminalMatchStatus(match.status)
    || match.startedAt
    || match.endedAt
    || match.result
    || match.cancelledAt
    || match.voidedAt
  ) {
    return { allowed: false, reason: "lifecycle_locked", hasSchedule, revisionCount };
  }
  if (hasTournamentLineupSubmission(match)) {
    return { allowed: false, reason: "lineup_submitted", hasSchedule, revisionCount };
  }
  if (hasSchedule && revisionCount >= TOURNAMENT_SCHEDULE_REVISION_LIMIT) {
    return { allowed: false, reason: "revision_limit", hasSchedule, revisionCount };
  }
  return { allowed: true, reason: "", hasSchedule, revisionCount };
}

export function isTournamentMatchLineupEditable(match = {}) {
  return Boolean(
    match?.tournamentId
    && hasTournamentMatchSchedule(match)
    && match.status !== "confirmed"
    && !isTerminalMatchStatus(match.status)
    && !match.startedAt
    && !match.endedAt
    && !match.result
    && !match.cancelledAt
    && !match.voidedAt,
  );
}
