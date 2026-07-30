import {
  DAY_MS,
  MATCH_SIDES,
  RECORD_TYPES,
} from "./constants.js";
import { uniquePlayerIds } from "./playerIds.js";
import {
  getMatchPlayerIds,
  getMatchReservePlayerIds,
} from "./matchParticipation.js";
import { isMatchRecordMatch } from "./matchRecordTypes.js";
import {
  getMatchUserParticipantSideName,
  getPlayerSideName,
} from "./matchRoster.js";
import { getMatchRoomPhase } from "./matchRoomLifecycle.js";
import { isMatchReferee } from "./refereeEligibility.js";

export function isTournamentMatchInUserSchedule(match = {}, userId = "") {
  const hasSchedule = Boolean(
    String(match.scheduledDate ?? "").match(/^\d{4}-\d{2}-\d{2}$/)
    || String(match.scheduledAt ?? "").match(/\d{4}-\d{2}-\d{2}/),
  );
  const feedRelations = Array.isArray(match.__feedRelations) ? match.__feedRelations : [];
  return Boolean(
    match.tournamentId
    && hasSchedule
    && (getMatchUserParticipantSideName(match, userId) || feedRelations.includes("participant")),
  );
}

export function isSeedSampleMatch(match = {}) {
  const id = String(match?.id ?? "");
  const title = String(match?.title ?? "");
  return id.startsWith("m_seed_upcoming_") || title.startsWith("Upcoming match sample ");
}

export function userNeedsMatchAgreement(match = {}, userId = "") {
  const sideName = getPlayerSideName(match, userId);
  return Boolean(
    sideName
    && match.status === "contract"
    && !(match.agreements?.[sideName] ?? []).includes(userId)
  );
}

export function userNeedsMatchApproval(match = {}, userId = "") {
  const sideName = getPlayerSideName(match, userId);
  if (getMatchRoomPhase(match).phase === "record") return false;
  if (match.rules?.recordType === RECORD_TYPES.matchRecord) {
    const requiredIds = match.rules?.recordApproverIds?.[sideName] ?? [];
    return Boolean(
      sideName
      && match.status === "approval"
      && requiredIds.includes(userId)
      && !(match.approvals?.[sideName] ?? []).includes(userId)
    );
  }
  return Boolean(
    sideName
    && match.status === "approval"
    && !(match.approvals?.[sideName] ?? []).includes(userId)
  );
}

function userMatchDecisionDone(match = {}, userId = "") {
  const sideName = getPlayerSideName(match, userId);
  if (!sideName) return false;
  if (match.status === "contract") {
    return (match.agreements?.[sideName] ?? []).includes(userId);
  }
  if (match.status === "approval") {
    if (match.rules?.recordType === RECORD_TYPES.matchRecord) {
      const requiredIds = match.rules?.recordApproverIds?.[sideName] ?? [];
      return !requiredIds.includes(userId)
        || (match.approvals?.[sideName] ?? []).includes(userId);
    }
    return (match.approvals?.[sideName] ?? []).includes(userId);
  }
  return false;
}

export function userNeedsMatchAction(match = {}, userId = "") {
  const phase = getMatchRoomPhase(match).phase;
  if (userNeedsMatchAgreement(match, userId)) return true;
  if (phase === "dispute" && match.status === "disputed") {
    return canUserResolveMatchDispute(match, userId);
  }
  return ["postgame", "dispute"].includes(phase)
    && !userMatchDecisionDone(match, userId);
}

export function getMatchHostPlayerId(match = {}, sourcePost = null) {
  const sourceRoomState = sourcePost?.roomState ?? {};
  if (match.tournamentId && !sourcePost) {
    const tournamentHostPlayerId = match.hostPlayerId
      ?? match.rules?.tournamentHostPlayerId
      ?? "";
    if (tournamentHostPlayerId) return tournamentHostPlayerId;
    return match.rules?.tournamentSideAssignmentLocked === true
      ? match.createdBy ?? ""
      : "";
  }
  return sourcePost?.ownerId
    || sourceRoomState.ownerId
    || sourcePost?.createdBy
    || sourcePost?.hostPlayerId
    || sourcePost?.userId
    || sourcePost?.createdPlayerId
    || sourcePost?.playerId
    || match.hostPlayerId
    || match.createdBy
    || match.createdPlayerId
    || match.playerId
    || match.teamA?.players?.[0]
    || "";
}

export function canUserResolveMatchDispute(
  match = {},
  userId = "",
  sourcePost = null,
) {
  if (!userId || match.status !== "disputed") return false;
  if (match.refereeId) return isMatchReferee(match, userId);
  return getMatchHostPlayerId(match, sourcePost) === userId;
}

export function getMatchTrustFeedbackParticipantIds(match = {}) {
  return uniquePlayerIds([
    ...getMatchPlayerIds(match),
    ...getMatchReservePlayerIds(match, "teamA"),
    ...getMatchReservePlayerIds(match, "teamB"),
    getMatchHostPlayerId(match),
    match.refereeId,
  ]);
}

export function getMatchTrustFeedbackClosesAt(match = {}) {
  const baseValue = match.confirmedAt
    || match.autoConfirmedAt
    || match.result?.updatedAt
    || match.result?.submittedAt
    || match.endedAt;
  const baseDate = baseValue ? new Date(baseValue) : null;
  if (!baseDate || !Number.isFinite(baseDate.getTime())) return null;
  return new Date(baseDate.getTime() + DAY_MS);
}

export function isMatchTrustFeedbackOpen(match = {}, now = Date.now()) {
  if (match.status !== "confirmed") return false;
  const closesAt = getMatchTrustFeedbackClosesAt(match);
  if (!closesAt) return false;
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  return Number.isFinite(nowMs) && nowMs <= closesAt.getTime();
}

export function getMatchTrustFeedbackLimit(match = {}) {
  const activeCount = getMatchPlayerIds(match).length;
  const operationIds = new Set([
    getMatchHostPlayerId(match),
    match.refereeId,
  ].filter(Boolean));
  return Math.max(1, Math.floor(activeCount / 2)) + (operationIds.size ? 1 : 0);
}

export function getMatchScoreEditableSides(match = {}, userId = "", {
  canOperatePostStart = false,
  refereeEligible = true,
  clockController = false,
} = {}) {
  if (!userId) return [];
  if (isMatchRecordMatch(match) && match.endedAt && canOperatePostStart) {
    return MATCH_SIDES;
  }
  const gameClockEnabled = match.rules?.gameClockEnabled !== false
    && match.rules?.gameClockEnabled !== "false";
  if (match.refereeId) {
    return isMatchReferee(match, userId) && refereeEligible !== false
      ? MATCH_SIDES
      : [];
  }
  if (gameClockEnabled && clockController) return MATCH_SIDES;
  if (gameClockEnabled) return [];
  if (canOperatePostStart) return MATCH_SIDES;
  return [];
}

export function hasMatchScoreboardOperators(match = {}) {
  if (match.refereeId) return true;
  return Boolean(getMatchHostPlayerId(match));
}
