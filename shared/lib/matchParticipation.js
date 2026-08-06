import {
  MATCH_SIDES,
  MINUTE_MS,
  RECORD_TYPES,
  REPORT_MATCH_WINDOW_MS,
} from "./constants.js";
import {
  projectMatchParticipationIds,
  projectMatchSideParticipationIds,
  uniquePlayerIds,
} from "./playerIds.js";
import { getMatchScheduledDate } from "./matchScheduleTime.js";
import {
  getMatchRecordType,
  isPersonalRecordMatch,
} from "./matchRecordTypes.js";

export const MATCH_RECORD_DURATION_MINUTES = 30;

export function getMatchPlayerIds(match = {}) {
  return projectMatchParticipationIds(match);
}

export function getMatchReviewParticipantIds(match = {}) {
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const actualPlayerIds = uniquePlayerIds([
    ...(playedPlayerIds.teamA ?? []),
    ...(playedPlayerIds.teamB ?? []),
  ]);
  return actualPlayerIds.length ? actualPlayerIds : getMatchPlayerIds(match);
}

export function getMatchSidePlayerIds(match = {}, sideName) {
  return projectMatchSideParticipationIds(match, sideName);
}

export function getMatchReservePlayerIds(match = {}, sideName) {
  const sourceMatch = match ?? {};
  const activeIds = new Set(sourceMatch[sideName]?.players ?? []);
  const tournamentHostPlayerId = sourceMatch.tournamentId
    ? sourceMatch.rules?.tournamentHostPlayerId ?? ""
    : "";
  const hideUnselectedTournamentHost = Boolean(
    tournamentHostPlayerId
    && sourceMatch.rules?.tournamentHostRosterSelected !== true
    && !activeIds.has(tournamentHostPlayerId),
  );
  const reserveIds = (sourceMatch.parties ?? [])
    .filter((party) => party.side === sideName)
    .flatMap((party) => [
      ...(party.reserve ? party.players ?? [] : []),
      ...(party.reserves ?? []),
    ]);

  return [
    ...new Set([
      ...(sourceMatch.reservePlayers?.[sideName] ?? []),
      ...reserveIds,
    ]),
  ].filter((playerId) => (
    playerId
    && !activeIds.has(playerId)
    && !(hideUnselectedTournamentHost && playerId === tournamentHostPlayerId)
  ));
}

export function getActualMatchPlayerIds(match = {}) {
  if (isPersonalRecordMatch(match)) return [];
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const played = uniquePlayerIds(
    MATCH_SIDES.flatMap((sideName) => playedPlayerIds?.[sideName] ?? []),
  );
  const reserves = new Set(
    MATCH_SIDES.flatMap((sideName) => getMatchReservePlayerIds(match, sideName)),
  );
  const currentPlayers = getMatchPlayerIds(match)
    .filter((playerId) => !reserves.has(playerId));
  return uniquePlayerIds([...played, ...currentPlayers])
    .filter((playerId) => !match.anonymousPlayers?.[playerId]);
}

export function getMatchRecordEndedAt(startedAt) {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (!Number.isFinite(start.getTime())) return null;
  return new Date(
    start.getTime() + MATCH_RECORD_DURATION_MINUTES * MINUTE_MS,
  );
}

export function normalizeActualMatchTimeRange(match = {}) {
  const sourceMatch = match ?? {};
  const recordType = getMatchRecordType(sourceMatch);
  let start = new Date(sourceMatch.startedAt ?? sourceMatch.started_at ?? "");
  let end = new Date(sourceMatch.endedAt ?? sourceMatch.ended_at ?? "");
  if (
    !Number.isFinite(start.getTime())
    && recordType === RECORD_TYPES.matchRecord
    && Number.isFinite(end.getTime())
  ) {
    start = new Date(
      end.getTime() - MATCH_RECORD_DURATION_MINUTES * MINUTE_MS,
    );
  }
  if (
    recordType === RECORD_TYPES.matchRecord
    && Number.isFinite(start.getTime())
  ) {
    end = getMatchRecordEndedAt(start);
  }
  if (
    !Number.isFinite(start.getTime())
    || !Number.isFinite(end?.getTime())
    || end <= start
  ) return null;
  return { startedAt: start, endedAt: end };
}

export function doMatchTimeRangesOverlap(first, second) {
  const firstRange = first?.startedAt instanceof Date
    ? first
    : normalizeActualMatchTimeRange(first);
  const secondRange = second?.startedAt instanceof Date
    ? second
    : normalizeActualMatchTimeRange(second);
  if (!firstRange || !secondRange) return false;
  return firstRange.startedAt < secondRange.endedAt
    && secondRange.startedAt < firstRange.endedAt;
}

export function getMatchOverlapConflict(candidate = {}, matches = []) {
  if (
    isPersonalRecordMatch(candidate)
    || ["cancelled", "void"].includes(candidate.status)
  ) return null;
  const candidateRange = normalizeActualMatchTimeRange(candidate);
  const candidatePlayers = new Set(getActualMatchPlayerIds(candidate));
  if (!candidateRange || !candidatePlayers.size) return null;
  return matches.find((existing) => {
    if (
      !existing?.id
      || existing.id === candidate.id
      || isPersonalRecordMatch(existing)
      || ["cancelled", "void"].includes(existing.status)
    ) return false;
    if (
      !doMatchTimeRangesOverlap(
        candidateRange,
        normalizeActualMatchTimeRange(existing),
      )
    ) return false;
    return getActualMatchPlayerIds(existing)
      .some((playerId) => candidatePlayers.has(playerId));
  }) ?? null;
}

export function getReportableMatchTimeMs(match = {}) {
  const rawDate = (match.status === "void" ? match.voidedAt : null)
    ?? match.endedAt
    ?? match.confirmedAt
    ?? match.scheduledDate
    ?? match.scheduledAt
    ?? match.createdAt;
  if (!rawDate) return 0;
  if (match.scheduledDate && rawDate === match.scheduledDate) {
    return getMatchScheduledDate(match)?.getTime() ?? 0;
  }
  const value = new Date(rawDate).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function getMatchSubstitutionAccess(
  match = {},
  userId = "",
  sideName = "",
  { canOperate = false } = {},
) {
  const reservePlayerIds = MATCH_SIDES.includes(sideName)
    ? getMatchReservePlayerIds(match, sideName)
    : [];
  const canManage = Boolean(canOperate);
  const canSelfSubstitute = Boolean(
    userId && reservePlayerIds.includes(userId),
  );
  return {
    canManage,
    canSelfSubstitute,
    allowedReservePlayerIds: canManage
      ? reservePlayerIds
      : canSelfSubstitute
        ? [userId]
        : [],
  };
}

export function isMatchLateAttendancePlayer(match = {}, playerId = "") {
  const latePlayerIds = match.rules?.lateAttendancePlayerIds;
  return Boolean(
    playerId
    && Array.isArray(latePlayerIds)
    && latePlayerIds.includes(playerId),
  );
}

export function getMatchPlayerPlacement(match = {}, playerId = "") {
  for (const sideName of MATCH_SIDES) {
    if ((match[sideName]?.players ?? []).includes(playerId)) {
      return { side: sideName, reserve: false };
    }
    if (getMatchReservePlayerIds(match, sideName).includes(playerId)) {
      return { side: sideName, reserve: true };
    }
  }
  return null;
}

export function getMatchParticipationCancellationState(
  match = {},
  userId = "",
) {
  const placement = getMatchPlayerPlacement(match, userId);
  const recordType = getMatchRecordType(match);
  const blocked = !userId
    || !placement
    || Boolean(match.tournamentId)
    || recordType !== RECORD_TYPES.match
    || !["contract", "agreed"].includes(match.status)
    || Boolean(match.startedAt || match.endedAt || match.result || match.cancelledAt || match.voidedAt);
  return {
    allowed: !blocked,
    side: placement?.side ?? "",
    reserve: placement?.reserve === true,
  };
}

export function getMatchParticipationCancellationPenalty(
  match = {},
  policy = {},
  now = new Date(),
) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const scheduledAt = getMatchScheduledDate(match);
  const checkinMs = scheduledAt
    ? scheduledAt.getTime() - (match.rules?.qrAttendanceEnabled === true ? 20 : 10) * MINUTE_MS
    : Number.NEGATIVE_INFINITY;
  if (!scheduledAt || nowMs >= checkinMs) {
    return Math.max(0, Math.min(15, Number(policy.participantCancelCheckinPenalty ?? 4)));
  }
  if (scheduledAt.getTime() - nowMs <= 4 * 60 * MINUTE_MS) {
    return Math.max(0, Math.min(10, Number(policy.participantCancelShortNoticePenalty ?? 2)));
  }
  return 0;
}

export function getReportableMatchUserIds(match = {}) {
  return uniquePlayerIds([
    match.createdBy,
    match.refereeId,
    match.formerRefereeId,
    ...getMatchPlayerIds(match),
    ...getMatchReservePlayerIds(match, "teamA"),
    ...getMatchReservePlayerIds(match, "teamB"),
  ]);
}

export function getVoidMatchRestoreTargetUserId(match = {}) {
  return String(match.voidedBy ?? match.createdBy ?? "").trim();
}

export function canRequestVoidMatchRestore(
  match = {},
  userId = "",
  nowMs = Date.now(),
) {
  if (match?.status !== "void" || !userId) return false;
  const targetUserId = getVoidMatchRestoreTargetUserId(match);
  if (!targetUserId || targetUserId === userId) return false;
  const reportTime = getReportableMatchTimeMs(match);
  return getReportableMatchUserIds(match).includes(userId)
    && reportTime >= nowMs - REPORT_MATCH_WINDOW_MS
    && reportTime <= nowMs;
}
