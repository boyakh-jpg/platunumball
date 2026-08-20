import {
  MATCH_SIDES,
  PLAYER_STAT_FIELDS,
} from "./constants.js";
import { getMatchScoreEditableSides } from "./matchAuthority.js";
import {
  getMatchPlayerIds,
  getMatchSidePlayerIds,
} from "./matchParticipation.js";
import { isMatchRecordMatch } from "./matchRecordTypes.js";
import { getMatchRecordPlayerIds } from "./matchRoster.js";
import {
  canOperatorSubmitMissingPostgameResult,
  getMatchRecordWindow,
} from "./matchRoomLifecycle.js";
import { isMatchReferee } from "./refereeEligibility.js";

export function getAllowedStatFields(match = {}, userId, playerId = userId) {
  if (isMatchReferee(match, userId)) return PLAYER_STAT_FIELDS;
  return [];
}

export function getAllowedResultStatFields(match = {}, userId, playerId = userId) {
  return getAllowedStatFields(match, userId, playerId);
}

export function getMatchResultEntryPermission(match = {}, userId = "", options = {}) {
  const now = options.now ?? Date.now();
  const recordWindow = getMatchRecordWindow(match, now);
  const hasReferee = Boolean(match.refereeId);
  const currentUserIsReferee = isMatchReferee(match, userId)
    && options.refereeEligible !== false;
  const canOperatePostStart = Boolean(options.canOperatePostStart);
  const liveEditableScoreSides = getMatchScoreEditableSides(match, userId, {
    canOperatePostStart,
    refereeEligible: options.refereeEligible,
  });
  const canEnterSharedRecordScore = Boolean(
    !hasReferee
    && isMatchRecordMatch(match)
    && match.rules?.recordSetupReady === true
    && match.status === "agreed"
    && match.endedAt
    && !match.confirmedAt
    && canOperatePostStart
  );
  const hasRefereeAuthority = hasReferee && currentUserIsReferee;
  const canOperatePostgame = Boolean(
    hasRefereeAuthority
    && !match.confirmedAt
    && ["agreed", "approval"].includes(match.status)
  );
  const editableScoreSides = match.status === "disputed"
    ? []
    : match.endedAt
      ? canOperatePostgame || canEnterSharedRecordScore
        ? MATCH_SIDES
        : []
      : liveEditableScoreSides;
  const canEditDisputeDraft = Boolean(
    hasReferee
    && match.status === "disputed"
    && recordWindow.disputeOpen
    && hasRefereeAuthority
  );
  const postgameEntry = Boolean(
    match.endedAt
    && ["agreed", "approval"].includes(match.status)
    && !match.confirmedAt
    && !match.voidedAt
    && !match.cancelledAt
  );
  const operatorPostgamePoints = false;
  const playerIds = getMatchRecordPlayerIds(match);
  const getEditableStatFields = (playerId) => {
    if (canEditDisputeDraft && hasReferee) return PLAYER_STAT_FIELDS;
    if (hasReferee) return currentUserIsReferee ? PLAYER_STAT_FIELDS : [];
    const fields = getAllowedResultStatFields(
      match,
      userId,
      playerId,
      operatorPostgamePoints,
    );
    const pointsOnly = fields.length === 1 && fields[0]?.id === "points";
    if (postgameEntry && pointsOnly && getPlayerStatSubmitted(match, playerId)) {
      return [];
    }
    return fields;
  };
  const editablePlayerIds = playerIds.filter(
    (playerId) => getEditableStatFields(playerId).length > 0,
  );
  const canRecordByRole = hasReferee && currentUserIsReferee;
  const canSubmitLive = Boolean(
    canRecordByRole
    && match.status === "agreed"
    && match.startedAt
    && !match.endedAt
    && recordWindow.beforeEnd
  );
  const canSubmitMissingPostgameResult = canOperatorSubmitMissingPostgameResult(
    match,
    canOperatePostStart,
    now,
  );
  const canSubmitPostgame = Boolean(
    postgameEntry
    && (
      (canOperatePostgame && recordWindow.statOpen)
      || canSubmitMissingPostgameResult
    )
  );

  return {
    role: currentUserIsReferee
      ? "referee"
      : !hasReferee && canOperatePostStart
        ? "no_ref_host"
        : "none",
    canEditDisputeDraft,
    canSubmit: canEditDisputeDraft
      || canSubmitLive
      || canSubmitPostgame
      || canEnterSharedRecordScore,
    canSubmitLive,
    canSubmitPostgame,
    canSubmitMissingPostgameResult,
    editableScoreSides,
    editablePlayerIds,
    getEditableStatFields,
    operatorPostgamePoints,
    postgameEntry,
  };
}

export function normalizePlayerStats(playerStats = {}, playerIds = []) {
  return Object.fromEntries(
    playerIds.map((playerId) => {
      const current = playerStats[playerId] ?? {};
      return [
        playerId,
        Object.fromEntries(
          PLAYER_STAT_FIELDS.map(
            (field) => [field.id, Math.max(0, Number(current[field.id] ?? 0))],
          ),
        ),
      ];
    }),
  );
}

export function getPlayerStatSubmitted(match = {}, playerId) {
  const submissions = match.result?.statSubmissions;
  if (submissions && Object.keys(submissions).length) {
    return Boolean(submissions[playerId]);
  }
  return Boolean(match.result?.playerStats?.[playerId]);
}

export function getStatSubmissionStatus(match = {}) {
  const playerIds = getMatchPlayerIds(match);
  const submittedIds = playerIds.filter(
    (playerId) => getPlayerStatSubmitted(match, playerId),
  );

  return {
    total: playerIds.length,
    submitted: submittedIds.length,
    submittedIds,
    missingIds: playerIds.filter((playerId) => !submittedIds.includes(playerId)),
    complete: playerIds.length > 0 && submittedIds.length === playerIds.length,
  };
}

export function getResultPointAudit(match = {}, result = match.result) {
  const auditSide = (sideName) => {
    const scoreKey = sideName === "teamA" ? "scoreA" : "scoreB";
    const teamScore = Number(result?.[scoreKey] ?? match[sideName]?.score ?? 0);
    const statPoints = getMatchSidePlayerIds(match, sideName).reduce(
      (sum, playerId) => (
        sum + Number(result?.playerStats?.[playerId]?.points ?? 0)
      ),
      0,
    );
    return {
      teamScore,
      statPoints,
      matched: teamScore === statPoints,
    };
  };
  const teamA = auditSide("teamA");
  const teamB = auditSide("teamB");
  return {
    teamA,
    teamB,
    matched: teamA.matched && teamB.matched,
  };
}

export function formatStatLine(stats = {}) {
  const visible = PLAYER_STAT_FIELDS
    .filter((field) => Number(stats[field.id] ?? 0) > 0)
    .map((field) => `${field.shortLabel} ${Number(stats[field.id] ?? 0)}`);
  return visible.length ? visible.join(" · ") : "스탯 미입력";
}
