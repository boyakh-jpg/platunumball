import {
  DAY_MS,
  HOUR_MS,
  INSTANT_ROOM_EXPIRE_MINUTES,
  MINUTE_MS,
  MATCH_SIDES,
  MODE_SIZES,
  PLAYER_STAT_FIELDS,
  PUBLIC_ROOM_SCHEDULE_MAX_DAYS,
  REMOTE_CLIENT_RECORD_MONTHS,
  RECORD_TYPES,
  REFEREE_TRUST_MIN,
  REPORT_MATCH_WINDOW_MS,
  ROOM_KINDS,
  SOLO_RECORD_ANONYMOUS_POSITION,
  SOLO_RECORD_ANONYMOUS_SOURCE,
  STAT_ENTRY_WINDOW_MINUTES,
  isRefereeGrade,
  normalizeDisputeWindowMinutes,
} from "./constants.js";
import { isTerminalMatchStatus } from "./notifications.js";
import { getPostgameRecordVerification } from "./postgameRecordVerification.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
const uniquePlayerIds = (playerIds = []) => [...new Set(playerIds.filter(Boolean))];
export { PUBLIC_ROOM_SCHEDULE_MAX_DAYS };
const PUBLIC_ROOM_CONFIRM_OPEN_HOURS = 24;
const PUBLIC_ROOM_CONFIRM_CLOSE_HOURS = 4;
const MATCH_CLOSED_NOTICE_GRACE_MINUTES = INSTANT_ROOM_EXPIRE_MINUTES;
export const MATCH_FINALIZATION_MINIMUM_MINUTES = 3;
export const MATCH_MANUAL_FINALIZATION_DELAY_MINUTES = 3;
export const MATCH_RECORD_DURATION_MINUTES = 30;
export { INSTANT_ROOM_EXPIRE_MINUTES };
export const MATCH_DISPUTE_REASON_OPTIONS = [
  "최종 점수 오기록",
  "내 득점 누락",
  "파울/개인 기록 오기록",
  "교체/후보 출전 누락",
  "기타",
];
export const OTHER_MATCH_DISPUTE_REASON = "기타";

export function getMatchSideScore(match = {}, sideName = "") {
  const resultKey = sideName === "teamA" ? "scoreA" : "scoreB";
  if (!resultKey) return 0;
  return Number(match.result?.[resultKey] ?? match[sideName]?.score ?? 0);
}

export function getMatchSideResult(match = {}, sideName = "") {
  if (!MATCH_SIDES.includes(sideName)) return "D";
  const otherSideName = sideName === "teamA" ? "teamB" : "teamA";
  const sideScore = getMatchSideScore(match, sideName);
  const otherScore = getMatchSideScore(match, otherSideName);
  if (sideScore === otherScore) return "D";
  return sideScore > otherScore ? "W" : "L";
}

function getDateToken(value = "") {
  return String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function getScheduledOccurrence(match = {}) {
  const date = getDateToken(match.scheduledDate ?? match.scheduled_date);
  if (date) {
    const time = String(match.scheduledTime ?? match.scheduled_time ?? "").match(/\d{2}:\d{2}/)?.[0] ?? "12:00";
    return `${date}T${time}:00+09:00`;
  }
  const scheduledAt = String(match.scheduledAt ?? match.scheduled_at ?? "").trim();
  return getDateToken(scheduledAt) ? scheduledAt : "";
}

export function getMatchPlayedAt(match = {}) {
  const recordType = getMatchRecordType(match);
  const authoredRecord = [RECORD_TYPES.matchRecord, RECORD_TYPES.personalRecord].includes(recordType);
  return [
    match.occurredAt,
    match.occurred_at,
    match.playedAt,
    match.played_at,
    authoredRecord ? getScheduledOccurrence(match) : "",
    match.startedAt,
    match.started_at,
    match.endedAt,
    match.ended_at,
    match.confirmedAt,
    match.confirmed_at,
    getScheduledOccurrence(match),
    match.createdAt,
    match.created_at,
  ].find((value) => String(value ?? "").trim()) ?? "";
}

export function getMatchPlayedDate(match = {}) {
  const indexedDate = getDateToken(match.recordDate ?? match.record_date);
  if (indexedDate) return indexedDate;
  const explicitDate = getDateToken(match.playedDate ?? match.played_date);
  if (explicitDate) return explicitDate;
  const recordType = getMatchRecordType(match);
  if ([RECORD_TYPES.matchRecord, RECORD_TYPES.personalRecord].includes(recordType)) {
    const authoredDate = getDateToken(match.scheduledDate ?? match.scheduled_date ?? match.scheduledAt ?? match.scheduled_at);
    if (authoredDate) return authoredDate;
  }
  const occurredAt = getMatchPlayedAt(match);
  const occurredMs = Date.parse(occurredAt);
  if (Number.isFinite(occurredMs)) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(occurredMs));
  }
  return getDateToken(occurredAt);
}

export function compareMatchRecency(a = {}, b = {}) {
  const aTime = Date.parse(getMatchPlayedAt(a));
  const bTime = Date.parse(getMatchPlayedAt(b));
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
  return getMatchPlayedDate(b).localeCompare(getMatchPlayedDate(a));
}

export function getSafeMatchSide(match = {}, sideName = "teamA", options = {}) {
  const side = match?.[sideName];
  const fallbackName = sideName === "teamA" ? "A" : "B";
  const teamIdFallback = options.teamIdFallback ?? "";
  const includeScore = options.includeScore === true;
  if (!side || typeof side !== "object") {
    return {
      name: fallbackName,
      teamId: teamIdFallback,
      players: [],
      ...(includeScore ? { score: 0 } : {}),
    };
  }
  return {
    ...side,
    name: side.name || fallbackName,
    teamId: side.teamId ?? teamIdFallback,
    players: Array.isArray(side.players) ? side.players : [],
    ...(includeScore ? { score: side.score ?? 0 } : {}),
  };
}

function getMatchDisputeScore(match = {}, sideName = "") {
  return getMatchSideScore(match, sideName);
}

function getMatchRecordType(match = {}) {
  return match?.rules?.recordType ?? match?.recordType ?? RECORD_TYPES.match;
}

export function isPersonalRecordMatch(match = {}) {
  return getMatchRecordType(match) === RECORD_TYPES.personalRecord;
}

export function isMatchRecordMatch(match = {}) {
  return getMatchRecordType(match) === RECORD_TYPES.matchRecord;
}

export function getMatchRecordCompositionLabel(match = {}) {
  if (!isMatchRecordMatch(match)) return "";
  return match?.rules?.recordComposition === "team" ? "팀 구성" : "개인 구성";
}

export function getMatchRecordSetupStatus(match = {}) {
  if (!isMatchRecordMatch(match)) return null;
  const composition = match?.rules?.recordComposition === "team" ? "team" : "individual";
  if (composition === "individual") {
    return match?.rules?.recordSetupReady === true
      ? { stage: "complete", label: "참가자 확정", tone: "green" }
      : { stage: "participants", label: "참가자 선택 필요", tone: "orange" };
  }

  const teamsSelected = Boolean(match?.teamA?.teamId && match?.teamB?.teamId);
  if (!teamsSelected) return { stage: "teams", label: "팀 선택 필요", tone: "orange" };
  if (match?.rules?.recordSetupReady === true) return { stage: "complete", label: "명단 확정 완료", tone: "green" };

  const readyCount = MATCH_SIDES.filter((sideName) => match?.rules?.rosterReady?.[sideName] === true).length;
  return readyCount
    ? { stage: "rosters", label: `${readyCount}/2팀 명단 확정`, tone: "orange" }
    : { stage: "rosters", label: "명단 확정 대기", tone: "orange" };
}

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

function isRecordKindMatch(match = {}) {
  return isPersonalRecordMatch(match) || isMatchRecordMatch(match);
}

export function makeAnonymousMatchPlayer(playerId, name, position = SOLO_RECORD_ANONYMOUS_POSITION) {
  return {
    id: playerId,
    name: String(name || "").trim() || "무기명",
    position: String(position || SOLO_RECORD_ANONYMOUS_POSITION).trim() || SOLO_RECORD_ANONYMOUS_POSITION,
    anonymous: true,
    participationLabel: SOLO_RECORD_ANONYMOUS_SOURCE,
    club: SOLO_RECORD_ANONYMOUS_SOURCE,
    avatarColor: "#64748b",
    trustScore: "-",
    ratings: { integrated: 0, modes: {} },
  };
}

export function getRoomKindFromMatch(match = {}) {
  if (isPersonalRecordMatch(match)) return ROOM_KINDS.personalRecord;
  if (isMatchRecordMatch(match)) return ROOM_KINDS.matchRecord;
  if (match.tournamentId) return ROOM_KINDS.tournament;
  return (match.visibility ?? match.rules?.visibility) === "public" ? ROOM_KINDS.publicRecruiting : ROOM_KINDS.privateInvite;
}

function getRecordSideRosterStatus(match = {}, sideName = "") {
  const side = match?.[sideName] ?? {};
  const teamId = side.teamId ?? "";
  const playerIds = getMatchSideRecordPlayerIds(match, sideName);
  const sideCapacity = Math.max(1, Math.min(5, MODE_SIZES[match.mode] ?? playerIds.length));
  const playerTeams = side.playerTeams ?? {};
  const rosterConfirmed = Boolean(
    teamId &&
    playerIds.length === sideCapacity &&
    playerIds.every((playerId) => playerTeams[playerId] === teamId),
  );
  return { playerIds, teamId, sideCapacity, rosterConfirmed };
}

export function evaluateRecordVerification(match = {}, options = {}) {
  const recordType = getMatchRecordType(match);
  const teams = Array.isArray(options.teams) ? options.teams : [];
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
  const excludedIds = new Set([...(match.mmrExcludedPlayerIds ?? []), ...(match.rules?.mmrExcludedPlayerIds ?? [])]);
  const playerIds = getMatchRecordPlayerIds(match);
  const verifiedIds = new Set(postgameVerification?.verifiedPlayerIds ?? playerIds);
  const mmrEligiblePlayerIds = playerIds.filter((playerId) => (
    verifiedIds.has(playerId)
    && !anonymousIds.has(playerId)
    && !excludedIds.has(playerId)
  ));
  const hasMmrBlockedPlayer = playerIds.some((playerId) => anonymousIds.has(playerId) || excludedIds.has(playerId));
  const blockingReasons = [];

  if (isPersonalRecordMatch(match)) blockingReasons.push("내 기록은 검증/MMR 대상이 아님");
  if (!hasResult) blockingReasons.push("결과 없음");
  if (disputed) blockingReasons.push("이의 처리 필요");
  if (isMatchRecordMatch(match) && !sideApprovalsComplete) blockingReasons.push("전체 참가자 2/3 확인 필요");
  if (isMatchRecordMatch(match)) blockingReasons.push("사후 경기기록방은 팀 MMR 대상 아님");

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
      ? canVerify && recordRosterConfirmed && postgameVerification.canApplyPersonalMmr && mmrEligiblePlayerIds.length > 0
      : canVerify && ranked && recordRosterConfirmed && mmrEligiblePlayerIds.length > 0,
    canApplyTeamMmr: !isMatchRecordMatch(match) && canVerify && ranked && recordRosterConfirmed && isTeamRecord && !hasMmrBlockedPlayer,
    isTeamRecord,
    teamRosterConfirmed,
    mmrEligiblePlayerIds,
    mmrScale: postgameVerification?.mmrScale ?? 1,
    approvalThreshold: postgameVerification?.approvalThreshold ?? 0,
    approvalCount: postgameVerification?.approvalCount ?? 0,
    blockingReasons,
  };
}

export function getMatchPlayerDisputePoints(match = {}, playerId = "") {
  if (!playerId) return 0;
  return Number(match.result?.playerStats?.[playerId]?.points ?? 0);
}

export function getMatchResultRevision(match = {}) {
  return Math.max(
    0,
    Number(match.result?.revision ?? 0),
    Number(match.result?.scoreRevisionA ?? 0),
    Number(match.result?.scoreRevisionB ?? 0),
  );
}

function normalizeWholeStatLine(stats = {}) {
  return Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => {
    const value = Number(stats?.[id] ?? 0);
    return [id, Number.isInteger(value) && value >= 0 && value <= 999 ? value : 0];
  }));
}

export function normalizeTeamScoresDisputeRequest({ match = {}, requestedScoreA, requestedScoreB, baseRevision, reason = "" } = {}) {
  const scoreA = Number(requestedScoreA);
  const scoreB = Number(requestedScoreB);
  const revision = Number(baseRevision);
  if (![scoreA, scoreB, revision].every(Number.isInteger)) return null;
  if (scoreA < 0 || scoreA > 999 || scoreB < 0 || scoreB > 999 || revision < 0) return null;
  return {
    kind: "team_scores",
    requestedScoreA: scoreA,
    requestedScoreB: scoreB,
    baseRevision: revision,
    reason: String(reason ?? "").trim(),
  };
}

export function normalizePlayerStatsDisputeRequest({ match = {}, playerId = "", requestedStats = {}, baseRevision, reason = "" } = {}) {
  const safePlayerId = String(playerId ?? "").trim();
  const revision = Number(baseRevision);
  if (!safePlayerId || !Number.isInteger(revision) || revision < 0) return null;
  const allowedIds = new Set(PLAYER_STAT_FIELDS.map(({ id }) => id));
  if (
    !requestedStats
    || typeof requestedStats !== "object"
    || Array.isArray(requestedStats)
    || Object.keys(requestedStats).some((id) => !allowedIds.has(id))
  ) return null;
  const stats = Object.fromEntries(PLAYER_STAT_FIELDS.map(({ id }) => {
    const value = Number(requestedStats[id] ?? 0);
    return [id, value];
  }));
  if (Object.values(stats).some((value) => !Number.isInteger(value) || value < 0 || value > 999)) return null;
  return {
    kind: "player_stats",
    playerId: safePlayerId,
    requestedStats: stats,
    baseRevision: revision,
    reason: String(reason ?? "").trim(),
  };
}

export function buildMatchDisputeRequest({
  match = {},
  playerId = "",
  requestedStats = {},
  reason = "",
  customReason = "",
} = {}) {
  const currentStats = normalizeWholeStatLine(match.result?.playerStats?.[playerId] ?? {});
  const reasonText = reason === OTHER_MATCH_DISPUTE_REASON
    ? String(customReason || OTHER_MATCH_DISPUTE_REASON).trim()
    : String(reason || MATCH_DISPUTE_REASON_OPTIONS[0]).trim();
  return normalizePlayerStatsDisputeRequest({
    match,
    playerId,
    requestedStats: { ...currentStats, ...requestedStats },
    baseRevision: getMatchResultRevision(match),
    reason: reasonText,
  });
}

export function normalizeDisputeRequest(disputeInput = "") {
  if (disputeInput && typeof disputeInput === "object") {
    return {
      ...disputeInput,
      reason: String(disputeInput.reason ?? "").trim(),
    };
  }
  return { reason: String(disputeInput ?? "").trim() };
}

export function getSubmittedStatPatch(playerStats = {}, targetPlayerIds = []) {
  const targetSet = new Set(targetPlayerIds);
  const validFieldIds = new Set(PLAYER_STAT_FIELDS.map((field) => field.id));
  return Object.fromEntries(
    Object.entries(playerStats ?? {})
      .filter(([playerId]) => targetSet.has(playerId))
      .map(([playerId, stats]) => [
        playerId,
        Object.fromEntries(
          Object.entries(stats ?? {})
            .filter(([fieldId]) => validFieldIds.has(fieldId))
            .map(([fieldId, value]) => [fieldId, Math.max(0, Number(value ?? 0))]),
        ),
      ])
      .filter(([, stats]) => Object.keys(stats).length),
  );
}

export function getMergedResultScore(match, playerStats, sideName, fallbackScore = 0) {
  const sidePlayerIds = getMatchSidePlayerIds(match, sideName);
  if (!sidePlayerIds.length) return Number(fallbackScore ?? match[sideName]?.score ?? 0);
  return sidePlayerIds.reduce((sum, playerId) => sum + Number(playerStats[playerId]?.points ?? 0), 0);
}

export function buildMatchResultSubmission(match = {}, draft = {}, getEditableStatFields = () => [], options = {}) {
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
      return options.editableScoreSides
        ? Number(currentScore)
        : getMergedResultScore(match, sourcePlayerStats, sideName, currentScore);
    }
    const nextScore = Number(draft[resultKey]);
    return Number.isFinite(nextScore) ? Math.min(999, Math.max(0, nextScore)) : Number(currentScore);
  };

  return {
    scoreA: getSubmittedScore("teamA"),
    scoreB: getSubmittedScore("teamB"),
    playerStats,
  };
}

export function fillMatchDecision(match, decisionKey) {
  return {
    ...(match[decisionKey] ?? { teamA: [], teamB: [] }),
    teamA: [...new Set([...(match[decisionKey]?.teamA ?? []), ...(match.teamA?.players ?? [])])],
    teamB: [...new Set([...(match[decisionKey]?.teamB ?? []), ...(match.teamB?.players ?? [])])],
  };
}

export function isAutoDecisionDue(match, nowMs = Date.now()) {
  const recordWindow = getMatchRecordWindow(match, nowMs);
  return Boolean(recordWindow.endAt && nowMs >= recordWindow.endAt.getTime() + DAY_MS);
}

export function addDateDays(dateValue, days) {
  const match = String(dateValue ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function getRoomTimingType(room = {}) {
  const value = room.timingType ?? room.rules?.timingType ?? room.roomState?.timingType;
  return value === "instant" || room.scheduledAt === "즉시" ? "instant" : "scheduled";
}

export function isInstantRoom(room = {}) {
  return getRoomTimingType(room) === "instant";
}

export function getLocalDateInputValue(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export const RECORD_CREATION_WINDOW_MS = DAY_MS;

export function getSeoulTimeInputValue(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

export function getRecordCreationWindowStatus(dateValue, timeValue, now = new Date()) {
  const date = String(dateValue ?? "").trim();
  const time = String(timeValue ?? "").trim();
  const nowDate = now instanceof Date ? now : new Date(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(nowDate.getTime())) {
    return { valid: false, reason: "invalid", occurredAtMs: null, ageMs: null };
  }
  const occurredAtMs = Date.parse(`${date}T${time}:00+09:00`);
  if (!Number.isFinite(occurredAtMs)) return { valid: false, reason: "invalid", occurredAtMs: null, ageMs: null };
  const ageMs = nowDate.getTime() - occurredAtMs;
  if (ageMs < 0) return { valid: false, reason: "future", occurredAtMs, ageMs };
  if (ageMs > RECORD_CREATION_WINDOW_MS) return { valid: false, reason: "expired", occurredAtMs, ageMs };
  return { valid: true, reason: "", occurredAtMs, ageMs };
}

export function formatKoreanDateTime(value, options = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const displayOptions = Object.keys(options).length ? options : {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  };
  return date.toLocaleString("ko-KR", {
    ...displayOptions,
    timeZone: "Asia/Seoul",
  });
}

export function getPublicRoomMaxDateInput(now = new Date()) {
  return addDateDays(getLocalDateInputValue(now), PUBLIC_ROOM_SCHEDULE_MAX_DAYS);
}

export function isDateWithinPastMonths(value, months = 6, now = new Date()) {
  const dateValue = String(value ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!dateValue) return true;
  const todayValue = getLocalDateInputValue(now);
  const [year, month, day] = todayValue.split("-").map(Number);
  const targetMonthIndex = month - 1 - Math.max(0, Number(months) || 0);
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonthIndex + 1, 0)).getUTCDate();
  const cutoffValue = [
    targetYear,
    String(normalizedMonthIndex + 1).padStart(2, "0"),
    String(Math.min(day, lastDay)).padStart(2, "0"),
  ].join("-");
  return dateValue >= cutoffValue;
}

export function isMatchWithinRecordDetailWindow(match = {}, months = REMOTE_CLIENT_RECORD_MONTHS, now = new Date()) {
  return isDateWithinPastMonths(getMatchPlayedDate(match), months, now);
}

export function getPlayerRecentRecordMatches(matches = [], playerId = "", options = {}) {
  const limit = Number(options.limit);
  const records = [...matches]
    .filter((match) => (
      match.status === "confirmed"
      && getPlayerSideName(match, playerId)
      && isMatchWithinRecordDetailWindow(match, options.months, options.now)
    ))
    .sort(compareMatchRecency);
  return Number.isInteger(limit) && limit >= 0 ? records.slice(0, limit) : records;
}

function getSideMajority(side = {}) {
  const total = side.players?.length ?? 0;
  return Math.floor(total / 2) + 1;
}

function isCaptainApprovalRequired() {
  return false;
}

export function getTeamCaptainId(teams = [], teamId) {
  const team = teams.find((item) => item.id === teamId);
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

function getSideCaptainId(match = {}, teams = [], sideName) {
  return getTeamCaptainId(teams, match[sideName]?.teamId);
}

function getDecisionStatus(match = {}, teams = [], sideName, decisionKey) {
  const side = match[sideName] ?? { players: [] };
  const sourceApprovals = match[decisionKey]?.[sideName] ?? [];
  const recordApproverMap = match.rules?.recordApproverIds;
  const recordApprovalConfigured = decisionKey === "approvals"
    && match.rules?.recordType === RECORD_TYPES.matchRecord
    && recordApproverMap
    && typeof recordApproverMap === "object";
  const requiredIds = recordApprovalConfigured
    ? uniquePlayerIds(recordApproverMap?.[sideName] ?? [])
    : [];
  const approvals = recordApprovalConfigured
    ? sourceApprovals.filter((playerId) => requiredIds.includes(playerId))
    : sourceApprovals;
  if (recordApprovalConfigured) {
    const approvalMode = match.rules?.recordApprovalMode?.[sideName] === "captain" ? "captain" : "all";
    const approved = requiredIds.length > 0 && requiredIds.every((playerId) => approvals.includes(playerId));
    return {
      approvals,
      total: side.players?.length ?? 0,
      majority: requiredIds.length,
      requiredIds,
      approvalMode,
      approvalLabel: approvalMode === "captain" ? "팀장 승인" : "전원 승인",
      captainId: approvalMode === "captain" ? requiredIds[0] ?? null : null,
      captainRequired: approvalMode === "captain",
      captainApproved: approvalMode !== "captain" || approved,
      majorityApproved: approved,
      approved,
    };
  }
  const captainId = getSideCaptainId(match, teams, sideName);
  const teamAgreement = decisionKey === "agreements" && Boolean(side.teamId);
  const captainRequired = teamAgreement || isCaptainApprovalRequired(match);
  const majority = teamAgreement ? 1 : getSideMajority(side);
  const majorityApproved = teamAgreement
    ? Boolean(captainId ? approvals.includes(captainId) : approvals.length)
    : approvals.length >= majority;
  const captainApproved = !captainRequired || !captainId || approvals.includes(captainId);

  return {
    approvals,
    total: side.players?.length ?? 0,
    majority,
    requiredIds: side.players ?? [],
    approvalMode: "majority",
    approvalLabel: "과반 승인",
    captainId,
    captainRequired,
    captainApproved,
    majorityApproved,
    approved: majorityApproved && captainApproved,
  };
}

export function getAgreementStatus(match = {}, teams = [], sideName) {
  return getDecisionStatus(match, teams, sideName, "agreements");
}

export function getApprovalStatus(match = {}, teams = [], sideName) {
  if (!isMatchRecordMatch(match)) {
    return {
      approvals: [],
      total: match[sideName]?.players?.length ?? 0,
      majority: 0,
      requiredIds: [],
      approvalMode: match.refereeId ? "referee" : "host",
      approvalLabel: match.refereeId ? "심판 최종 승인" : "방장 최종 승인",
      captainId: null,
      captainRequired: false,
      captainApproved: false,
      majorityApproved: false,
      approved: false,
    };
  }
  const requiredIds = uniquePlayerIds(
    match.rules?.recordApproverIds?.[sideName]?.length
      ? match.rules.recordApproverIds[sideName]
      : getMatchSidePlayerIds(match, sideName),
  ).filter((playerId) => !match.anonymousPlayers?.[playerId]);
  const approvals = uniquePlayerIds(match.approvals?.[sideName] ?? [])
    .filter((playerId) => requiredIds.includes(playerId));
  const approved = requiredIds.length > 0
    && requiredIds.every((playerId) => approvals.includes(playerId));
  return {
    approvals,
    total: requiredIds.length,
    majority: requiredIds.length,
    requiredIds,
    approvalMode: "participant_confirmation",
    approvalLabel: "내 참가 확인",
    captainId: null,
    captainRequired: false,
    captainApproved: approved,
    majorityApproved: approved,
    approved,
  };
}

export function getMatchPlayerIds(match = {}) {
  return uniquePlayerIds([...getMatchSidePlayerIds(match, "teamA"), ...getMatchSidePlayerIds(match, "teamB")]);
}

export function getMatchReviewParticipantIds(match = {}) {
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const actualPlayerIds = uniquePlayerIds([
    ...(playedPlayerIds.teamA ?? []),
    ...(playedPlayerIds.teamB ?? []),
  ]);
  return actualPlayerIds.length ? actualPlayerIds : getMatchPlayerIds(match);
}

export function getActualMatchPlayerIds(match = {}) {
  if (isPersonalRecordMatch(match)) return [];
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const played = uniquePlayerIds(MATCH_SIDES.flatMap((sideName) => playedPlayerIds?.[sideName] ?? []));
  if (played.length) return played.filter((playerId) => !match.anonymousPlayers?.[playerId]);
  const reserves = new Set(MATCH_SIDES.flatMap((sideName) => getMatchReservePlayerIds(match, sideName)));
  return getMatchPlayerIds(match).filter((playerId) => !reserves.has(playerId) && !match.anonymousPlayers?.[playerId]);
}

export function getMatchRecordEndedAt(startedAt) {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (!Number.isFinite(start.getTime())) return null;
  return new Date(start.getTime() + MATCH_RECORD_DURATION_MINUTES * MINUTE_MS);
}

export function normalizeActualMatchTimeRange(match = {}) {
  const sourceMatch = match ?? {};
  const recordType = getMatchRecordType(sourceMatch);
  let start = new Date(sourceMatch.startedAt ?? sourceMatch.started_at ?? "");
  let end = new Date(sourceMatch.endedAt ?? sourceMatch.ended_at ?? "");
  if (!Number.isFinite(start.getTime()) && recordType === RECORD_TYPES.matchRecord && Number.isFinite(end.getTime())) {
    start = new Date(end.getTime() - MATCH_RECORD_DURATION_MINUTES * MINUTE_MS);
  }
  if (recordType === RECORD_TYPES.matchRecord && Number.isFinite(start.getTime())) {
    end = getMatchRecordEndedAt(start);
  }
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end?.getTime()) || end <= start) return null;
  return { startedAt: start, endedAt: end };
}

export function doMatchTimeRangesOverlap(first, second) {
  const firstRange = first?.startedAt instanceof Date ? first : normalizeActualMatchTimeRange(first);
  const secondRange = second?.startedAt instanceof Date ? second : normalizeActualMatchTimeRange(second);
  if (!firstRange || !secondRange) return false;
  return firstRange.startedAt < secondRange.endedAt && secondRange.startedAt < firstRange.endedAt;
}

export function getMatchOverlapConflict(candidate = {}, matches = []) {
  if (isPersonalRecordMatch(candidate) || ["cancelled", "void"].includes(candidate.status)) return null;
  const candidateRange = normalizeActualMatchTimeRange(candidate);
  const candidatePlayers = new Set(getActualMatchPlayerIds(candidate));
  if (!candidateRange || !candidatePlayers.size) return null;
  return matches.find((existing) => {
    if (!existing?.id || existing.id === candidate.id || isPersonalRecordMatch(existing) || ["cancelled", "void"].includes(existing.status)) return false;
    if (!doMatchTimeRangesOverlap(candidateRange, normalizeActualMatchTimeRange(existing))) return false;
    return getActualMatchPlayerIds(existing).some((playerId) => candidatePlayers.has(playerId));
  }) ?? null;
}

export function getReportableMatchTimeMs(match = {}) {
  const rawDate = (match.status === "void" ? match.voidedAt : null)
    ?? match.endedAt ?? match.confirmedAt ?? match.scheduledDate ?? match.scheduledAt ?? match.createdAt;
  if (!rawDate) return 0;
  if (match.scheduledDate && rawDate === match.scheduledDate) {
    return getMatchScheduledDate(match)?.getTime() ?? 0;
  }
  const value = new Date(rawDate).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function getMatchSidePlayerIds(match = {}, sideName) {
  const sourceMatch = match ?? {};
  const side = sourceMatch[sideName] ?? {};
  const playedPlayerIds = sourceMatch.playedPlayerIds ?? sourceMatch.rules?.playedPlayerIds ?? {};
  return uniquePlayerIds([...(side.players ?? []), ...(playedPlayerIds[sideName] ?? [])]);
}

export function getMatchReservePlayerIds(match = {}, sideName) {
  const sourceMatch = match ?? {};
  const activeIds = new Set(sourceMatch[sideName]?.players ?? []);
  const tournamentHostPlayerId = sourceMatch.tournamentId
    ? sourceMatch.rules?.tournamentHostPlayerId ?? ""
    : "";
  const hideUnselectedTournamentHost = Boolean(
    tournamentHostPlayerId &&
    sourceMatch.rules?.tournamentHostRosterSelected !== true &&
    !activeIds.has(tournamentHostPlayerId)
  );
  const reserveIds = (sourceMatch.parties ?? [])
    .filter((party) => party.side === sideName)
    .flatMap((party) => [
      ...(party.reserve ? party.players ?? [] : []),
      ...(party.reserves ?? []),
    ]);

  return [...new Set([...(sourceMatch.reservePlayers?.[sideName] ?? []), ...reserveIds])]
    .filter((playerId) => (
      playerId &&
      !activeIds.has(playerId) &&
      !(hideUnselectedTournamentHost && playerId === tournamentHostPlayerId)
    ));
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
  const canSelfSubstitute = Boolean(userId && reservePlayerIds.includes(userId));
  return {
    canManage,
    canSelfSubstitute,
    allowedReservePlayerIds: canManage ? reservePlayerIds : canSelfSubstitute ? [userId] : [],
  };
}

export function isMatchLateAttendancePlayer(match = {}, playerId = "") {
  const latePlayerIds = match.rules?.lateAttendancePlayerIds;
  return Boolean(playerId && Array.isArray(latePlayerIds) && latePlayerIds.includes(playerId));
}

export function getMatchPlayerPlacement(match = {}, playerId = "") {
  for (const sideName of MATCH_SIDES) {
    if ((match[sideName]?.players ?? []).includes(playerId)) return { side: sideName, reserve: false };
    if (getMatchReservePlayerIds(match, sideName).includes(playerId)) return { side: sideName, reserve: true };
  }
  return null;
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

export function canRequestVoidMatchRestore(match = {}, userId = "", nowMs = Date.now()) {
  if (match?.status !== "void" || !userId) return false;
  const targetUserId = getVoidMatchRestoreTargetUserId(match);
  if (!targetUserId || targetUserId === userId) return false;
  const reportTime = getReportableMatchTimeMs(match);
  return getReportableMatchUserIds(match).includes(userId)
    && reportTime >= nowMs - REPORT_MATCH_WINDOW_MS
    && reportTime <= nowMs;
}

export function isMatchSideTeamParty(match = {}, sideName = "") {
  const sourceMatch = match ?? {};
  const side = sourceMatch[sideName] ?? {};
  return Boolean(side.teamId) && uniquePlayerIds([...(side.players ?? []), ...getMatchReservePlayerIds(sourceMatch, sideName)]).length >= 2;
}

export function isMatchPartyTeamParty(party = {}) {
  return Boolean(party.teamId) && uniquePlayerIds([...(party.players ?? []), ...(party.reserves ?? [])]).length >= 2;
}

export function getMatchPlayerTeamId(match = {}, sideName, playerId) {
  const side = match[sideName] ?? {};
  if (side.playerTeams?.[playerId]) return side.playerTeams[playerId];
  const party = (match.parties ?? []).find((item) => (
    item.side === sideName &&
    [...(item.players ?? []), ...(item.reserves ?? [])].includes(playerId)
  ));
  return party?.teamId ?? side.teamId ?? null;
}

export function getMatchRosterSwapPatch(match, sideName, activePlayerId, reservePlayerId) {
  const side = match[sideName] ?? {};
  const sidePlayers = side.players ?? [];
  const reserveIds = getMatchReservePlayerIds(match, sideName);
  const currentIsPlayer = sidePlayers.includes(activePlayerId);
  const currentIsReserve = reserveIds.includes(activePlayerId);
  const nextIsPlayer = sidePlayers.includes(reservePlayerId);
  const nextIsReserve = reserveIds.includes(reservePlayerId);
  if (!nextIsPlayer && !nextIsReserve) return { valid: false, match, swapped: false };

  const recordWindow = getMatchRecordWindow(match);
  const shouldSwap = recordWindow.beforeEnd && (
    (currentIsReserve && nextIsPlayer) ||
    (currentIsPlayer && nextIsReserve)
  );
  if (!shouldSwap) return { valid: true, match, swapped: false };

  const activeInId = currentIsReserve ? activePlayerId : reservePlayerId;
  const benchedId = currentIsReserve ? reservePlayerId : activePlayerId;
  const nextPlayers = sidePlayers.map((playerId) => (playerId === benchedId ? activeInId : playerId));
  const currentReservePlayers = match.reservePlayers?.[sideName] ?? [];
  const nextReservePlayers = uniquePlayerIds([
    ...currentReservePlayers.filter((playerId) => playerId !== activeInId),
    benchedId,
  ]);
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  const nextPlayedPlayerIds = {
    ...playedPlayerIds,
    [sideName]: uniquePlayerIds([...(playedPlayerIds[sideName] ?? []), ...sidePlayers, activeInId, benchedId]),
  };
  const playerTeams = { ...(side.playerTeams ?? {}) };
  [activeInId, benchedId].forEach((playerId) => {
    const teamId = getMatchPlayerTeamId(match, sideName, playerId);
    if (teamId) playerTeams[playerId] = teamId;
  });

  return {
    valid: true,
    swapped: true,
    activeInId,
    benchedId,
    match: {
      ...match,
      [sideName]: {
        ...side,
        players: uniquePlayerIds(nextPlayers),
        playerTeams,
      },
      reservePlayers: {
        ...(match.reservePlayers ?? {}),
        [sideName]: nextReservePlayers,
      },
      playedPlayerIds: nextPlayedPlayerIds,
      rules: {
        ...(match.rules ?? {}),
        playedPlayerIds: nextPlayedPlayerIds,
      },
    },
  };
}

export function updateMatchPartiesForPlayer(match = {}, playerId = "", sideName = "", reserve = false, remove = false) {
  return (match.parties ?? [])
    .map((party) => {
      const hadPlayer = (party.players ?? []).includes(playerId) || (party.reserves ?? []).includes(playerId);
      const nextPlayers = uniquePlayerIds(party.players ?? []).filter((id) => id !== playerId);
      const nextReserves = uniquePlayerIds(party.reserves ?? []).filter((id) => id !== playerId);
      if (!remove && hadPlayer && party.side === sideName) {
        if (reserve) nextReserves.push(playerId);
        else nextPlayers.push(playerId);
      }
      const nextRosterIds = uniquePlayerIds([...nextPlayers, ...nextReserves]);
      const currentLeaderId = party.partyLeaderId ?? party.leaderId ?? party.playerId ?? "";
      const nextLeaderId = currentLeaderId && nextRosterIds.includes(currentLeaderId)
        ? currentLeaderId
        : nextRosterIds[0] ?? "";
      return {
        ...party,
        partyLeaderId: nextLeaderId,
        players: uniquePlayerIds(nextPlayers),
        reserves: uniquePlayerIds(nextReserves),
        reserve: party.reserve && !nextPlayers.length,
      };
    })
    .filter((party) => (party.players ?? []).length || (party.reserves ?? []).length);
}

export function clearMatchPlayerDecision(nextMatch, playerId) {
  const attendance = getMatchAttendance(nextMatch);
  return {
    ...nextMatch,
    agreements: {
      teamA: (nextMatch.agreements?.teamA ?? []).filter((id) => id !== playerId),
      teamB: (nextMatch.agreements?.teamB ?? []).filter((id) => id !== playerId),
    },
    approvals: {
      teamA: (nextMatch.approvals?.teamA ?? []).filter((id) => id !== playerId),
      teamB: (nextMatch.approvals?.teamB ?? []).filter((id) => id !== playerId),
    },
    attendance: {
      teamA: attendance.teamA.filter((id) => id !== playerId),
      teamB: attendance.teamB.filter((id) => id !== playerId),
    },
  };
}

export function getMatchAttendance(match = {}) {
  return {
    teamA: uniquePlayerIds(match.attendance?.teamA ?? []),
    teamB: uniquePlayerIds(match.attendance?.teamB ?? []),
  };
}

export function applyOperatorAttendance(match = {}, operatorId = "") {
  const placement = getMatchPlayerPlacement(match, operatorId);
  if (!placement) return match;
  const attendance = getMatchAttendance(match);
  if (attendance[placement.side].includes(operatorId)) return match;
  return {
    ...match,
    attendance: {
      ...attendance,
      [placement.side]: uniquePlayerIds([...attendance[placement.side], operatorId]),
    },
  };
}

function getMatchAttendanceTargetIds(match = {}, sideName) {
  return uniquePlayerIds([
    ...(match[sideName]?.players ?? []),
    ...getMatchReservePlayerIds(match, sideName),
  ]);
}

export function getMissingMatchAttendance(match = {}) {
  const attendance = getMatchAttendance(match);
  return MATCH_SIDES.flatMap((sideName) => (
    getMatchAttendanceTargetIds(match, sideName)
      .filter((playerId) => !attendance[sideName].includes(playerId))
      .map((playerId) => ({ sideName, playerId }))
  ));
}

export function getMatchSideLeaderId(match = {}, teams = [], sideName) {
  const sourceMatch = match ?? {};
  const sidePlayerIds = getMatchSidePlayerIds(match, sideName);
  const sideReserveIds = getMatchReservePlayerIds(match, sideName);
  const sideRosterIds = uniquePlayerIds([...sidePlayerIds, ...sideReserveIds]);
  const partyLeaderId = (sourceMatch.parties ?? [])
    .filter((party) => party.side === sideName)
    .flatMap((party) => [
      party.partyLeaderId,
      party.leaderId,
      party.playerId,
      ...(party.players ?? []),
      ...(party.reserves ?? []),
    ])
    .find((playerId) => playerId && sideRosterIds.includes(playerId));
  if (partyLeaderId) return partyLeaderId;
  const hostPlayerId = sourceMatch.createdBy ?? "";
  if (hostPlayerId && sideRosterIds.includes(hostPlayerId)) return hostPlayerId;
  return sidePlayerIds[0] ?? sideReserveIds[0] ?? "";
}

export function getMatchSideRecordPlayerIds(match = {}, sideName, includeReserves = false) {
  return uniquePlayerIds([
    ...getMatchSidePlayerIds(match, sideName),
    ...(includeReserves ? getMatchReservePlayerIds(match, sideName) : []),
  ]);
}

export function getMatchRecordPlayerIds(match = {}, includeReserves = false) {
  return uniquePlayerIds([
    ...getMatchSideRecordPlayerIds(match, "teamA", includeReserves),
    ...getMatchSideRecordPlayerIds(match, "teamB", includeReserves),
  ]);
}

export function getPlayerSideName(match = {}, playerId) {
  if (getMatchSidePlayerIds(match, "teamA").includes(playerId)) return "teamA";
  if (getMatchSidePlayerIds(match, "teamB").includes(playerId)) return "teamB";
  return null;
}

export function getPlayerMatchResult(match = {}, playerId = "") {
  return getMatchSideResult(match, getPlayerSideName(match, playerId));
}

export function getMatchRosterSideName(match = {}, playerId) {
  return getPlayerSideName(match, playerId)
    ?? (getMatchReservePlayerIds(match, "teamA").includes(playerId) ? "teamA" : null)
    ?? (getMatchReservePlayerIds(match, "teamB").includes(playerId) ? "teamB" : null);
}

function getMatchUserSideName(match = {}, userId = "") {
  return getPlayerSideName(match, userId);
}

export function getMatchUserParticipantSideName(match = {}, userId = "") {
  return getMatchRosterSideName(match, userId);
}

export function isMatchRelatedToUser(match = {}, userId = "") {
  return Boolean(
    userId &&
    (
      getMatchUserParticipantSideName(match, userId) ||
      match.createdBy === userId ||
      match.refereeId === userId ||
      match.formerRefereeId === userId
    )
  );
}

export function isTournamentMatchInUserSchedule(match = {}, userId = "") {
  const hasSchedule = Boolean(
    String(match.scheduledDate ?? "").match(/^\d{4}-\d{2}-\d{2}$/) ||
    String(match.scheduledAt ?? "").match(/\d{4}-\d{2}-\d{2}/),
  );
  const feedRelations = Array.isArray(match.__feedRelations) ? match.__feedRelations : [];
  return Boolean(
    match.tournamentId &&
    hasSchedule &&
    (getMatchUserParticipantSideName(match, userId) || feedRelations.includes("participant")),
  );
}

export const TOURNAMENT_SCHEDULE_REVISION_LIMIT = 1;

export function hasTournamentMatchSchedule(match = {}) {
  return Boolean(
    String(match.scheduledDate ?? "").match(/^\d{4}-\d{2}-\d{2}$/) &&
    String(match.scheduledTime ?? "").match(/^\d{2}:\d{2}/),
  );
}

export function getTournamentScheduleRevisionCount(match = {}) {
  const value = Number.parseInt(match.rules?.tournamentScheduleRevisionCount, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function hasTournamentLineupSubmission(match = {}) {
  return Boolean(
    match.tournamentId &&
    MATCH_SIDES.some((sideName) => match.rules?.rosterReady?.[sideName] === true),
  );
}

export function getTournamentScheduleEditPolicy(match = {}) {
  const revisionCount = getTournamentScheduleRevisionCount(match);
  const hasSchedule = hasTournamentMatchSchedule(match);
  if (
    !match?.tournamentId ||
    match.status === "confirmed" ||
    isTerminalMatchStatus(match.status) ||
    match.startedAt ||
    match.endedAt ||
    match.result ||
    match.cancelledAt ||
    match.voidedAt
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
    match?.tournamentId &&
    hasTournamentMatchSchedule(match) &&
    match.status !== "confirmed" &&
    !isTerminalMatchStatus(match.status) &&
    !match.startedAt &&
    !match.endedAt &&
    !match.result &&
    !match.cancelledAt &&
    !match.voidedAt
  );
}

export function isSeedSampleMatch(match = {}) {
  const id = String(match?.id ?? "");
  const title = String(match?.title ?? "");
  return id.startsWith("m_seed_upcoming_") || title.startsWith("Upcoming match sample ");
}

export function userNeedsMatchAgreement(match = {}, userId = "") {
  const sideName = getMatchUserSideName(match, userId);
  return Boolean(sideName && match.status === "contract" && !(match.agreements?.[sideName] ?? []).includes(userId));
}

export function userNeedsMatchApproval(match = {}, userId = "") {
  const sideName = getMatchUserSideName(match, userId);
  if (getMatchRoomPhase(match).phase === "record") return false;
  if (match.rules?.recordType === RECORD_TYPES.matchRecord) {
    const requiredIds = match.rules?.recordApproverIds?.[sideName] ?? [];
    return Boolean(sideName && match.status === "approval" && requiredIds.includes(userId) && !(match.approvals?.[sideName] ?? []).includes(userId));
  }
  return Boolean(sideName && match.status === "approval" && !(match.approvals?.[sideName] ?? []).includes(userId));
}

function userMatchDecisionDone(match = {}, userId = "") {
  const sideName = getMatchUserSideName(match, userId);
  if (!sideName) return false;
  if (match.status === "contract") return (match.agreements?.[sideName] ?? []).includes(userId);
  if (match.status === "approval") {
    if (match.rules?.recordType === RECORD_TYPES.matchRecord) {
      const requiredIds = match.rules?.recordApproverIds?.[sideName] ?? [];
      return !requiredIds.includes(userId) || (match.approvals?.[sideName] ?? []).includes(userId);
    }
    return (match.approvals?.[sideName] ?? []).includes(userId);
  }
  return false;
}

export function userNeedsMatchAction(match = {}, userId = "") {
  const phase = getMatchRoomPhase(match).phase;
  if (userNeedsMatchAgreement(match, userId)) return true;
  if (phase === "dispute" && match.status === "disputed") return canUserResolveMatchDispute(match, userId);
  return ["postgame", "dispute"].includes(phase) && !userMatchDecisionDone(match, userId);
}

export function getMatchHostPlayerId(match = {}, sourcePost = null) {
  const sourceRoomState = sourcePost?.roomState ?? {};
  if (match.tournamentId && !sourcePost) {
    const tournamentHostPlayerId = match.hostPlayerId ?? match.rules?.tournamentHostPlayerId ?? "";
    if (tournamentHostPlayerId) return tournamentHostPlayerId;
    return match.rules?.tournamentSideAssignmentLocked === true ? match.createdBy ?? "" : "";
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

export function canUserResolveMatchDispute(match = {}, userId = "", sourcePost = null) {
  if (!userId || match.status !== "disputed") return false;
  if (match.refereeId) return isMatchReferee(match, userId);
  return getMatchHostPlayerId(match, sourcePost) === userId;
}

export function getOpenMatchDisputes(match = {}) {
  return (match.disputes ?? []).filter((dispute) => dispute?.status === "open");
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
  const baseValue = match.confirmedAt || match.autoConfirmedAt || match.result?.updatedAt || match.result?.submittedAt || match.endedAt;
  const baseDate = baseValue ? new Date(baseValue) : null;
  if (!baseDate || !Number.isFinite(baseDate.getTime())) return null;
  return addMinutes(baseDate, 24 * 60);
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

export function getMatchReferee(match = {}, users = []) {
  return users.find((user) => user.id === match.refereeId) ?? null;
}

const INACTIVE_REFEREE_STATUSES = new Set(["pending", "rejected", "revoked", "expired", "suspended", "blocked"]);
const TEST_REFEREE_LOGIN_IDS = new Set(["rankball-001", "rankball-011"]);

function isActiveRefereeStatus(status = "active") {
  return !INACTIVE_REFEREE_STATUSES.has(String(status || "active"));
}

function isActiveRefereeTerm(record = {}, nowMs = Date.now(), throughMs = nowMs) {
  const startsAt = record.startsAt ? new Date(record.startsAt).getTime() : 0;
  const endsAt = record.endsAt ? new Date(record.endsAt).getTime() : Infinity;
  const normalizedStart = Number.isFinite(startsAt) ? startsAt : 0;
  const normalizedEnd = Number.isFinite(endsAt) ? endsAt : Infinity;
  const normalizedThrough = Number.isFinite(throughMs) ? Math.max(nowMs, throughMs) : nowMs;
  return normalizedStart <= nowMs && normalizedThrough <= normalizedEnd;
}

function hasRefereeQualification(user = {}, refereeAppointments = [], nowMs = Date.now(), throughMs = nowMs) {
  if (!user?.id) return false;
  if (TEST_REFEREE_LOGIN_IDS.has(String(user.testLoginId ?? "").toLowerCase())) return true;
  const profile = user.refereeProfile ?? {};
  const profileGrade = profile.grade ?? user.refereeGrade;
  const profileStatus = profile.status ?? user.refereeStatus ?? "active";
  const profileQualified = (
    user.officialReferee === true ||
    user.refereeLicenseVerified === true ||
    profile.licenseVerified === true ||
    profile.examPassed === true ||
    isRefereeGrade(profileGrade)
  );
  if (profileQualified && isActiveRefereeStatus(profileStatus) && isActiveRefereeTerm(profile, nowMs, throughMs)) return true;

  return refereeAppointments.some((appointment) => {
    const appointmentUserId = appointment.userId ?? appointment.user_id;
    const role = appointment.role ?? "referee";
    const grade = appointment.grade ?? appointment.refereeGrade;
    return (
      appointmentUserId === user.id &&
      role === "referee" &&
      isRefereeGrade(grade) &&
      isActiveRefereeStatus(appointment.status) &&
      isActiveRefereeTerm(appointment, nowMs, throughMs)
    );
  });
}

export function isEligibleReferee(user = {}, minTrust = REFEREE_TRUST_MIN, refereeAppointments = [], throughDate = null) {
  const parsedThroughMs = throughDate
    ? new Date(String(throughDate).length === 10 ? `${throughDate}T23:59:59.999Z` : throughDate).getTime()
    : Date.now();
  return (
    Number(user?.trustScore ?? 0) >= Number(minTrust ?? REFEREE_TRUST_MIN) &&
    hasRefereeQualification(user, refereeAppointments, Date.now(), parsedThroughMs)
  );
}

export function isMatchReferee(match = {}, userId) {
  return Boolean(match.refereeId && userId && match.refereeId === userId);
}

export function normalizeStatRecorders(recorders = {}) {
  // LEGACY READ-ONLY:
  // 과거 경기 데이터 해석 전용.
  // 신규 권한 판정 및 저장에 사용하지 않는다.
  return {
    teamA: recorders.teamA ?? "",
    teamB: recorders.teamB ?? "",
  };
}

export function getMatchScoreEditableSides(match = {}, userId = "", {
  canOperatePostStart = false,
  refereeEligible = true,
  clockController = false,
} = {}) {
  if (!userId) return [];
  if (isMatchRecordMatch(match) && match.endedAt && canOperatePostStart) return MATCH_SIDES;
  const gameClockEnabled = match.rules?.gameClockEnabled !== false
    && match.rules?.gameClockEnabled !== "false";
  if (match.refereeId) {
    return isMatchReferee(match, userId) && refereeEligible !== false ? MATCH_SIDES : [];
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

export function getMatchStartDate(match = {}) {
  const actualStart = match.startedAt;
  if (actualStart) {
    const started = new Date(actualStart);
    if (Number.isFinite(started.getTime())) return started;
  }
  return null;
}

function getMatchEndDate(match = {}) {
  if (match.endedAt) {
    const ended = new Date(match.endedAt);
    if (Number.isFinite(ended.getTime())) return ended;
  }
  if (match.status === "agreed" && match.startedAt && !match.endedAt) return null;
  const fallback = match.result?.submittedAt ?? match.confirmedAt;
  if (!fallback) return null;
  const parsed = new Date(fallback);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function getMatchScheduledDate(match = {}) {
  if (isInstantRoom(match)) return null;
  const raw = match.scheduledDate
    ? `${match.scheduledDate} ${match.scheduledTime || "00:00"}`
    : String(match.scheduledAt ?? "").trim();
  const kstMatch = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/);
  const source = kstMatch ? `${kstMatch[1]}T${kstMatch[2]}:00+09:00` : raw;
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function isMatchClosedNotice(match = {}, now = new Date()) {
  if (isRecordKindMatch(match)) return false;
  const status = String(match.status ?? "");
  if (status === "cancelled" || status === "void") return true;
  if (status === "confirmed" || status === "closed") return false;
  if (match.endedAt || match.result || getMatchStartDate(match)) return false;
  if (!["agreed", "contract"].includes(status)) return false;
  const scheduledAt = getMatchScheduledDate(match);
  if (!scheduledAt) return false;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs)) return false;
  return nowMs >= scheduledAt.getTime() + MATCH_CLOSED_NOTICE_GRACE_MINUTES * MINUTE_MS;
}

function getInstantRoomExpiresAt(room = {}) {
  if (!isInstantRoom(room)) return null;
  const createdAt = new Date(room.createdAt ?? room.created_at ?? "");
  if (!Number.isFinite(createdAt.getTime())) return null;
  return new Date(createdAt.getTime() + INSTANT_ROOM_EXPIRE_MINUTES * MINUTE_MS);
}

function formatLocalClock(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function getRoomScheduleLabel(room = {}) {
  if (isInstantRoom(room)) {
    const expiresLabel = formatLocalClock(getInstantRoomExpiresAt(room));
    return expiresLabel ? `즉시 · ${expiresLabel} 종료` : "즉시";
  }
  return [room.scheduledDate, room.scheduledTime].filter(Boolean).join(" ") || room.scheduledAt || "일정 미정";
}

export function getPublicRoomTimingStatus(room = {}, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const timingType = getRoomTimingType(room);
  if (timingType === "instant") {
    const createdAt = new Date(room.createdAt ?? nowDate);
    const expiresAt = getInstantRoomExpiresAt(room) ?? new Date(createdAt.getTime() + INSTANT_ROOM_EXPIRE_MINUTES * MINUTE_MS);
    return {
      timingType,
      label: "즉시",
      detail: "정원 충족 시 바로 확정 가능",
      canConfirm: true,
      canCreate: true,
      expired: Number.isFinite(expiresAt.getTime()) && nowMs > expiresAt.getTime(),
      expiresAt,
    };
  }

  const scheduledAt = getMatchScheduledDate(room);
  if (!scheduledAt) {
    return {
      timingType,
      label: "일정 필요",
      detail: "날짜와 시간을 입력해야 합니다.",
      canConfirm: false,
      canCreate: false,
      expired: false,
      scheduledAt: null,
    };
  }

  const scheduledMs = scheduledAt.getTime();
  if (room.visibility === "private") {
    return {
      timingType,
      label: "예약방",
      detail: "비공개방은 경기 전까지 확정할 수 있습니다.",
      canConfirm: scheduledMs > nowMs,
      canCreate: scheduledMs > nowMs,
      expired: false,
      scheduledAt,
    };
  }
  const today = getLocalDateInputValue(nowDate);
  const maxDate = getPublicRoomMaxDateInput(nowDate);
  const dateValue = String(room.scheduledDate ?? "").slice(0, 10);
  const dateAllowed = dateValue >= today && dateValue <= maxDate;
  const createLeadAllowed = scheduledMs > nowMs + PUBLIC_ROOM_CONFIRM_CLOSE_HOURS * HOUR_MS;
  const confirmOpenMs = scheduledMs - PUBLIC_ROOM_CONFIRM_OPEN_HOURS * HOUR_MS;
  const confirmCloseMs = scheduledMs - PUBLIC_ROOM_CONFIRM_CLOSE_HOURS * HOUR_MS;
  const beforeConfirmOpen = nowMs < confirmOpenMs;
  const afterConfirmClose = nowMs > confirmCloseMs;

  return {
    timingType,
    label: beforeConfirmOpen ? "확정 가능 시간 대기" : afterConfirmClose ? "확정 마감" : "경기 확정 가능",
    detail: beforeConfirmOpen
      ? "경기 24시간 전부터 확정할 수 있습니다."
      : afterConfirmClose
        ? "경기 4시간 전 확정 마감이 지났습니다."
        : "방장이 경기 확정을 누를 수 있습니다.",
    canConfirm: dateAllowed && !beforeConfirmOpen && !afterConfirmClose,
    canCreate: dateAllowed && createLeadAllowed,
    expired: afterConfirmClose,
    scheduledAt,
    confirmOpenAt: new Date(confirmOpenMs),
    confirmCloseAt: new Date(confirmCloseMs),
  };
}

const ROOM_PHASE_META = {
  waiting: { phase: "waiting", label: "대기방", listLabel: "모집 중", tone: "blue", actionLabel: "방 보기" },
  locked: { phase: "locked", label: "확정방", listLabel: "확정방", tone: "green", actionLabel: "방 보기" },
  checkin: { phase: "checkin", label: "경기준비방", listLabel: "경기준비", tone: "orange", actionLabel: "준비" },
  live: { phase: "live", label: "경기시작", listLabel: "경기 진행", tone: "blue", actionLabel: "기록" },
  postgame: { phase: "postgame", label: "경기종료", listLabel: "경기 종료", tone: "orange", actionLabel: "기록완료" },
  dispute: { phase: "dispute", label: "이의신청방", listLabel: "이의신청", tone: "orange", actionLabel: "처리" },
  record: { phase: "record", label: "기록방", listLabel: "기록방", tone: "green", actionLabel: "보기" },
  cancelled: { phase: "cancelled", label: "취소", listLabel: "취소", tone: "neutral", actionLabel: "보기" },
  void: { phase: "void", label: "무효", listLabel: "무효", tone: "neutral", actionLabel: "보기" },
};

export function cleanRoomTitle(title = "", fallback = "경기방") {
  const cleaned = String(title || "")
    .replace(/^FLOW\s*/i, "")
    .trim();
  return cleaned || fallback;
}

export function getTournamentMatchDisplayTitle(match = {}, fallback = "") {
  if (!match.tournamentId) return String(fallback || match.title || "").trim();

  const round = Math.max(0, Number(match.tournamentRound) || 0);
  const fixture = Math.max(0, Number(match.tournamentFixture) || 0);
  const stageLabel = fixture
    ? (match.tournamentFormat === "tournament" ? `${round || 1}R-${fixture}` : `L-${fixture}`)
    : "";
  const matchupLabel = [match.teamA?.name, match.teamB?.name].filter(Boolean).join(" vs ");
  return [stageLabel, matchupLabel].filter(Boolean).join(" · ") || String(fallback || match.title || "대회 경기").trim();
}

export function getRoomVisibilityLabel(room = {}, sourceRoom = null) {
  if (room.tournamentId) return "대회방";
  const visibility = room.visibility ?? sourceRoom?.visibility;
  if (visibility) return visibility === "private" ? "비공개방" : "공개방";
  return room.recruitingPostId ? "공개방" : "비공개방";
}

export function getRoomCompetitionLabel(room = {}) {
  return room.ranked === false ? "친선전" : "정규전";
}

export function getRoomRefereeLabel(room = {}) {
  if (room.refereeId) return "심판 있음";
  if (room.refereeWanted || room.roomState?.refereeWanted) return "심판 모집";
  return "심판 없음";
}

export function isTournamentMatchSideRosterReady(match = {}, sideName = "") {
  if (!match.tournamentId || !MATCH_SIDES.includes(sideName)) return false;
  if (match.rules?.rosterReady?.[sideName] !== true) return false;
  const readyAt = match.rules?.rosterReadyAt?.[sideName];
  const scheduledAt = getMatchScheduledDate(match);
  if (!readyAt || !scheduledAt) return true;
  const readyAtMs = new Date(readyAt).getTime();
  return Number.isFinite(readyAtMs) && readyAtMs <= scheduledAt.getTime();
}

export function isTournamentMatchRosterReady(match = {}) {
  return !match.tournamentId || (
    isTournamentMatchSideRosterReady(match, "teamA") &&
    isTournamentMatchSideRosterReady(match, "teamB")
  );
}

export function getMatchRoomPhase(match = {}, now = new Date()) {
  if (match.status === "cancelled") return ROOM_PHASE_META.cancelled;
  if (match.status === "void") return ROOM_PHASE_META.void;
  if (match.status === "confirmed") return ROOM_PHASE_META.record;
  if (match.status === "disputed" && getOpenMatchDisputes(match).length) return ROOM_PHASE_META.dispute;
  if ((match.status === "approval" || match.status === "disputed") && getMatchRecordWindow(match, now).disputeExpired) {
    return ROOM_PHASE_META.record;
  }
  if (match.status === "approval" || match.status === "disputed") return ROOM_PHASE_META.dispute;
  if (match.endedAt) return ROOM_PHASE_META.postgame;
  if (getMatchStartDate(match)) return ROOM_PHASE_META.live;
  if (match.status === "agreed" && match.result) return ROOM_PHASE_META.postgame;

  if (match.status === "agreed" || match.status === "contract") {
    if (match.tournamentId && !isTournamentMatchRosterReady(match)) return ROOM_PHASE_META.locked;
    if (isInstantRoom(match)) return ROOM_PHASE_META.checkin;
    const scheduledAt = getMatchScheduledDate(match);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (
      scheduledAt
      && Number.isFinite(nowMs)
      && nowMs >= scheduledAt.getTime() - (10 * MINUTE_MS)
    ) return ROOM_PHASE_META.checkin;
    return ROOM_PHASE_META.locked;
  }

  return ROOM_PHASE_META.waiting;
}

const MATCH_ROOM_CHAT_LOCKED_PHASES = new Set(["dispute", "record", "cancelled", "void"]);

export function isMatchRoomChatLocked(match = {}, now = new Date()) {
  const phase = getMatchRoomPhase(match, now).phase;
  const status = String(match.status ?? "").trim().toLowerCase();
  return MATCH_ROOM_CHAT_LOCKED_PHASES.has(phase) || isTerminalMatchStatus(status);
}

export function isMatchInScheduleMenu(match = {}, now = new Date()) {
  return ["locked", "checkin"].includes(getMatchRoomPhase(match, now).phase);
}

export function isMatchInPlayMenu(match = {}, now = new Date()) {
  return ["live", "postgame", "dispute"].includes(getMatchRoomPhase(match, now).phase);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes ?? 0) * MINUTE_MS);
}

export function getMatchRecordWindow(match = {}, now = Date.now()) {
  const startAt = getMatchStartDate(match);
  const endAt = getMatchEndDate(match);
  const statEntryMinutes = Number(match.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES);
  const disputeMinutes = normalizeDisputeWindowMinutes(match.disputeMinutes);

  if (!endAt) {
    return {
      endAt: null,
      statClosesAt: null,
      disputeClosesAt: null,
      beforeStart: !startAt,
      beforeEnd: Boolean(startAt),
      statOpen: false,
      disputeOpen: false,
      statExpired: false,
      disputeExpired: false,
    };
  }

  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const endMs = endAt.getTime();
  const statClosesAt = addMinutes(endAt, statEntryMinutes);
  const disputeClosesAt = addMinutes(endAt, disputeMinutes);

  return {
    endAt,
    statClosesAt,
    disputeClosesAt,
    beforeEnd: nowMs < endMs,
    statOpen: nowMs >= endMs && nowMs <= statClosesAt.getTime(),
    disputeOpen: nowMs >= endMs && nowMs <= disputeClosesAt.getTime(),
    statExpired: nowMs > statClosesAt.getTime(),
    disputeExpired: nowMs > disputeClosesAt.getTime(),
  };
}

export function getMatchFinalizationWindow(match = {}, now = Date.now()) {
  const sourceMatch = match ?? {};
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const submittedAtMs = new Date(
    sourceMatch.result?.submittedAt ?? sourceMatch.result?.submitted_at ?? "",
  ).getTime();
  const endedAtMs = new Date(sourceMatch.endedAt ?? sourceMatch.ended_at ?? "").getTime();
  const baseMs = Math.max(
    Number.isFinite(submittedAtMs) ? submittedAtMs : 0,
    Number.isFinite(endedAtMs) ? endedAtMs : 0,
  );
  const availableAtMs = baseMs
    ? baseMs + MATCH_FINALIZATION_MINIMUM_MINUTES * MINUTE_MS
    : 0;
  return {
    availableAt: availableAtMs ? new Date(availableAtMs) : null,
    ready: availableAtMs > 0 && nowMs >= availableAtMs,
  };
}

export function getMatchManualFinalizationStatus(match = {}, now = Date.now()) {
  const sourceMatch = match ?? {};
  const submittedAt = sourceMatch.result?.submittedAt ?? sourceMatch.result?.submitted_at ?? null;
  const submittedAtMs = submittedAt ? new Date(submittedAt).getTime() : NaN;
  const nowMs = typeof now === "number" ? now : new Date(now).getTime();
  const readyAtMs = Number.isFinite(submittedAtMs)
    ? submittedAtMs + MATCH_MANUAL_FINALIZATION_DELAY_MINUTES * MINUTE_MS
    : NaN;
  return {
    submittedAt,
    ready: Number.isFinite(nowMs) && Number.isFinite(readyAtMs) && nowMs >= readyAtMs,
    readyAt: Number.isFinite(readyAtMs) ? new Date(readyAtMs) : null,
    remainingMs: Number.isFinite(nowMs) && Number.isFinite(readyAtMs)
      ? Math.max(0, readyAtMs - nowMs)
      : null,
  };
}

export function canOperatorSubmitMissingPostgameResult(match = {}, canOperatePostStart = false, now = Date.now()) {
  if (!canOperatePostStart || match.result) return false;
  if (["confirmed", "void", "cancelled", "disputed"].includes(match.status)) return false;
  if (!getMatchEndDate(match)) return false;
  return getMatchRoomPhase(match, now).phase === "postgame";
}

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
  const currentUserIsReferee = isMatchReferee(match, userId) && options.refereeEligible !== false;
  const canOperatePostStart = Boolean(options.canOperatePostStart);
  const liveEditableScoreSides = getMatchScoreEditableSides(match, userId, {
    canOperatePostStart,
    refereeEligible: options.refereeEligible,
  });
  const canEnterSharedRecordScore = Boolean(
    !hasReferee &&
    isMatchRecordMatch(match) &&
    match.rules?.recordSetupReady === true &&
    match.status === "agreed" &&
    match.endedAt &&
    !match.confirmedAt &&
    canOperatePostStart,
  );
  const hasRefereeAuthority = hasReferee && currentUserIsReferee;
  const canOperatePostgame = Boolean(
    hasRefereeAuthority &&
    !match.confirmedAt &&
    ["agreed", "approval"].includes(match.status),
  );
  const editableScoreSides = match.status === "disputed"
    ? []
    : match.endedAt
      ? canOperatePostgame || canEnterSharedRecordScore ? MATCH_SIDES : []
      : liveEditableScoreSides;
  const canEditDisputeDraft = Boolean(
    hasReferee &&
    match.status === "disputed" &&
    recordWindow.disputeOpen &&
    hasRefereeAuthority,
  );
  const postgameEntry = Boolean(
    match.endedAt &&
    ["agreed", "approval"].includes(match.status) &&
    !match.confirmedAt &&
    !match.voidedAt &&
    !match.cancelledAt,
  );
  const operatorPostgamePoints = false;
  const playerIds = getMatchRecordPlayerIds(match);
  const getEditableStatFields = (playerId) => {
    if (canEditDisputeDraft && hasReferee) return PLAYER_STAT_FIELDS;
    if (hasReferee) return currentUserIsReferee ? PLAYER_STAT_FIELDS : [];
    const fields = getAllowedResultStatFields(match, userId, playerId, operatorPostgamePoints);
    const pointsOnly = fields.length === 1 && fields[0]?.id === "points";
    if (postgameEntry && pointsOnly && getPlayerStatSubmitted(match, playerId)) return [];
    return fields;
  };
  const editablePlayerIds = playerIds.filter((playerId) => getEditableStatFields(playerId).length > 0);
  const canRecordByRole = hasReferee && currentUserIsReferee;
  const canSubmitLive = Boolean(
    canRecordByRole &&
    match.status === "agreed" &&
    match.startedAt &&
    !match.endedAt &&
    recordWindow.beforeEnd,
  );
  const canSubmitMissingPostgameResult = hasReferee
    && canOperatorSubmitMissingPostgameResult(match, canOperatePostStart, now);
  const canSubmitPostgame = Boolean(
    canOperatePostgame &&
    postgameEntry &&
    (recordWindow.statOpen || canSubmitMissingPostgameResult),
  );

  return {
    role: currentUserIsReferee
      ? "referee"
      : !hasReferee && canOperatePostStart
        ? "no_ref_host"
        : "none",
    canEditDisputeDraft,
    canSubmit: canEditDisputeDraft || canSubmitLive || canSubmitPostgame,
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
          PLAYER_STAT_FIELDS.map((field) => [field.id, Math.max(0, Number(current[field.id] ?? 0))]),
        ),
      ];
    }),
  );
}

export function getPlayerStatSubmitted(match = {}, playerId) {
  const submissions = match.result?.statSubmissions;
  if (submissions && Object.keys(submissions).length) return Boolean(submissions[playerId]);
  return Boolean(match.result?.playerStats?.[playerId]);
}

export function getStatSubmissionStatus(match = {}) {
  const playerIds = getMatchPlayerIds(match);
  const submittedIds = playerIds.filter((playerId) => getPlayerStatSubmitted(match, playerId));

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
      (sum, playerId) => sum + Number(result?.playerStats?.[playerId]?.points ?? 0),
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
