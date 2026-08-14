import {
  DAY_MS,
  MODE_SIZES,
  REMOTE_CLIENT_RECORD_MONTHS,
} from "./constants.js";
import { getPostgameRecordVerification } from "./postgameRecordVerification.js";
import { getMatchSidePlayerIds } from "./matchParticipation.js";
import {
  compareMatchRecency,
  getMatchPlayedDate,
} from "./matchPlayedDate.js";
import {
  getMatchRecordType,
  getRoomKindFromMatch,
  isMatchRecordMatch,
  isPersonalRecordMatch,
} from "./matchRecordTypes.js";
import {
  getActualMatchPlayerSideName,
  getMatchRecordPlayerIds,
  getMatchSideRecordPlayerIds,
} from "./matchRoster.js";
import { validateMatchPeriodScores } from "./matchPeriodScores.js";
import {
  cleanRoomTitle,
  getMatchRecordWindow,
} from "./matchRoomLifecycle.js";
import { isDateWithinPastMonths } from "./matchTimeUtils.js";

export function getMatchCancelCopy(match = {}) {
  if (isMatchRecordMatch(match)) {
    return {
      actionLabel: "기록 취소",
      notificationTitle: "기록 취소",
      notificationBody: `${cleanRoomTitle(match?.title, "경기 기록")} 기록이 취소됐습니다.`,
      discordIntro: "경기 기록이 취소되었습니다. 기록 상세에서 상태를 확인해 주세요.",
    };
  }
  return {
    actionLabel: "경기 취소",
    notificationTitle: "경기 취소",
    notificationBody: `${cleanRoomTitle(match?.title, "경기")} 경기방이 취소됐습니다.`,
    discordIntro: "경기방이 취소되었습니다. 경기 상세에서 취소 사유를 확인해 주세요.",
  };
}

function getRecordSideRosterStatus(match = {}, sideName = "") {
  const side = match?.[sideName] ?? {};
  const teamId = side.teamId ?? "";
  const playerIds = getMatchSideRecordPlayerIds(match, sideName);
  const sideCapacity = Math.max(1, Math.min(5, MODE_SIZES[match.mode] ?? playerIds.length));
  const playerTeams = side.playerTeams ?? {};
  const rosterConfirmed = Boolean(
    teamId
    && playerIds.length === sideCapacity
    && playerIds.every((playerId) => playerTeams[playerId] === teamId)
  );
  return { playerIds, teamId, sideCapacity, rosterConfirmed };
}

export function evaluateRecordVerification(match = {}, options = {}) {
  const recordType = getMatchRecordType(match);
  const ranked = match.ranked !== false;
  const result = match.disputeDraftResult ?? match.result;
  const hasResult = Boolean(result);
  const disputed = match.status === "disputed" || Boolean(match.disputeDraftResult);
  const teamAId = match.teamA?.teamId ?? "";
  const teamBId = match.teamB?.teamId ?? "";
  const isTeamRecord = Boolean(teamAId && teamBId);
  const teamARoster = getRecordSideRosterStatus(match, "teamA");
  const teamBRoster = getRecordSideRosterStatus(match, "teamB");
  const teamRosterConfirmed = isTeamRecord && teamARoster.rosterConfirmed && teamBRoster.rosterConfirmed;
  const postgameVerification = isMatchRecordMatch(match)
    ? getPostgameRecordVerification(match, options)
    : null;
  const sideApprovalsComplete = postgameVerification?.thresholdMet === true;
  const anonymousIds = new Set(Object.keys(match.anonymousPlayers ?? {}));
  const excludedIds = new Set([
    ...(match.mmrExcludedPlayerIds ?? []),
    ...(match.rules?.mmrExcludedPlayerIds ?? []),
  ]);
  const playerIds = getMatchRecordPlayerIds(match);
  const verifiedIds = new Set(postgameVerification?.verifiedPlayerIds ?? playerIds);
  const mmrEligiblePlayerIds = playerIds.filter((playerId) => (
    verifiedIds.has(playerId)
    && !anonymousIds.has(playerId)
    && !excludedIds.has(playerId)
  ));
  const hasMmrBlockedPlayer = playerIds.some(
    (playerId) => anonymousIds.has(playerId) || excludedIds.has(playerId),
  );
  const blockingReasons = [];

  if (isPersonalRecordMatch(match)) blockingReasons.push("내 기록은 검증/MMR 대상이 아님");
  if (!hasResult) blockingReasons.push("결과 없음");
  if (disputed) blockingReasons.push("이의 처리 필요");
  if (isMatchRecordMatch(match) && !sideApprovalsComplete) blockingReasons.push("전체 참가자 2/3 확인 필요");
  if (isMatchRecordMatch(match)) blockingReasons.push("사후 경기 기록은 팀 MMR 대상 아님");

  const recordRoomConfirmed = !isMatchRecordMatch(match) || sideApprovalsComplete;
  const recordRosterConfirmed = !isMatchRecordMatch(match) || match.rules?.recordSetupReady === true;
  const canVerify = !isPersonalRecordMatch(match) && hasResult && !disputed && recordRoomConfirmed;
  return {
    recordType,
    roomKind: getRoomKindFromMatch(match),
    canSave: true,
    canConfirm: isMatchRecordMatch(match) && hasResult,
    canVerify,
    canApplyPersonalMmr: isMatchRecordMatch(match)
      ? canVerify
        && recordRosterConfirmed
        && postgameVerification.canApplyPersonalMmr
        && mmrEligiblePlayerIds.length > 0
      : canVerify && ranked && recordRosterConfirmed && mmrEligiblePlayerIds.length > 0,
    canApplyTeamMmr: !isMatchRecordMatch(match)
      && canVerify
      && ranked
      && recordRosterConfirmed
      && isTeamRecord
      && !hasMmrBlockedPlayer,
    isTeamRecord,
    teamRosterConfirmed,
    mmrEligiblePlayerIds,
    mmrScale: postgameVerification?.mmrScale ?? 1,
    approvalThreshold: postgameVerification?.approvalThreshold ?? 0,
    approvalCount: postgameVerification?.approvalCount ?? 0,
    blockingReasons,
  };
}

export function getMergedResultScore(match, playerStats, sideName, fallbackScore = 0) {
  const sidePlayerIds = getMatchSidePlayerIds(match, sideName);
  if (!sidePlayerIds.length) return Number(fallbackScore ?? match[sideName]?.score ?? 0);
  return sidePlayerIds.reduce(
    (sum, playerId) => sum + Number(playerStats[playerId]?.points ?? 0),
    0,
  );
}

export function buildMatchResultSubmission(
  match = {},
  draft = {},
  getEditableStatFields = () => [],
  options = {},
) {
  const sourcePlayerStats = draft.playerStats ?? {};
  const editableScoreSides = new Set(options.editableScoreSides ?? []);
  const playerStats = Object.fromEntries(
    getMatchRecordPlayerIds(match)
      .map((playerId) => {
        const allowedFieldIds = new Set(getEditableStatFields(playerId).map((field) => field.id));
        const statPatch = Object.fromEntries(
          Object.entries(sourcePlayerStats[playerId] ?? {})
            .filter(([fieldId]) => allowedFieldIds.has(fieldId))
            .map(([fieldId, value]) => [fieldId, Math.max(0, Number(value ?? 0))]),
        );
        return [playerId, statPatch];
      })
      .filter(([, statPatch]) => Object.keys(statPatch).length > 0),
  );

  const getSubmittedScore = (sideName) => {
    const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
    const currentScore = match.disputeDraftResult?.[resultKey]
      ?? match.result?.[resultKey]
      ?? match[sideName]?.score
      ?? 0;
    if (!editableScoreSides.has(sideName)) {
      return getMergedResultScore(match, sourcePlayerStats, sideName, currentScore);
    }
    const nextScore = Number(draft[resultKey]);
    return Number.isFinite(nextScore)
      ? Math.min(999, Math.max(0, nextScore))
      : Number(currentScore);
  };

  const scoreA = getSubmittedScore("teamA");
  const scoreB = getSubmittedScore("teamB");
  const periodScoreResult = validateMatchPeriodScores(draft.periodScores, match.rules, { scoreA, scoreB });
  if (!periodScoreResult.valid) {
    const error = new Error("invalid_match_period_scores");
    error.userMessage = periodScoreResult.error;
    throw error;
  }

  return {
    scoreA,
    scoreB,
    playerStats,
    periodScores: periodScoreResult.periodScores,
  };
}

export function isAutoDecisionDue(match, nowMs = Date.now()) {
  const recordWindow = getMatchRecordWindow(match, nowMs);
  return Boolean(recordWindow.endAt && nowMs >= recordWindow.endAt.getTime() + DAY_MS);
}

export function isMatchWithinRecordDetailWindow(
  match = {},
  months = REMOTE_CLIENT_RECORD_MONTHS,
  now = new Date(),
) {
  return isDateWithinPastMonths(getMatchPlayedDate(match), months, now);
}

export function getPlayerRecentRecordMatches(matches = [], playerId = "", options = {}) {
  const limit = Number(options.limit);
  const records = [...matches]
    .filter((match) => (
      match.status === "confirmed"
      && getActualMatchPlayerSideName(match, playerId)
      && isMatchWithinRecordDetailWindow(match, options.months, options.now)
    ))
    .sort(compareMatchRecency);
  return Number.isInteger(limit) && limit >= 0 ? records.slice(0, limit) : records;
}
