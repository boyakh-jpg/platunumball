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

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
const uniquePlayerIds = (playerIds = []) => [...new Set(playerIds.filter(Boolean))];
export { PUBLIC_ROOM_SCHEDULE_MAX_DAYS };
const PUBLIC_ROOM_CONFIRM_OPEN_HOURS = 24;
const PUBLIC_ROOM_CONFIRM_CLOSE_HOURS = 4;
const MATCH_CLOSED_NOTICE_GRACE_MINUTES = INSTANT_ROOM_EXPIRE_MINUTES;
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

export function compareMatchRecency(a = {}, b = {}) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
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
  const sideApprovalsComplete = getApprovalStatus(match, teams, "teamA").approved && getApprovalStatus(match, teams, "teamB").approved;
  const anonymousIds = new Set(Object.keys(match.anonymousPlayers ?? {}));
  const excludedIds = new Set([...(match.mmrExcludedPlayerIds ?? []), ...(match.rules?.mmrExcludedPlayerIds ?? [])]);
  const playerIds = getMatchRecordPlayerIds(match);
  const mmrEligiblePlayerIds = playerIds.filter((playerId) => !anonymousIds.has(playerId) && !excludedIds.has(playerId));
  const hasMmrBlockedPlayer = playerIds.some((playerId) => anonymousIds.has(playerId) || excludedIds.has(playerId));
  const blockingReasons = [];

  if (isPersonalRecordMatch(match)) blockingReasons.push("내 기록은 검증/MMR 대상이 아님");
  if (!hasResult) blockingReasons.push("결과 없음");
  if (disputed) blockingReasons.push("이의 처리 필요");
  if (isMatchRecordMatch(match) && !sideApprovalsComplete) blockingReasons.push("양측 기록 확인 필요");
  if (isTeamRecord && !teamRosterConfirmed) blockingReasons.push("팀 출전 명단 확정 필요");
  if (isTeamRecord && hasMmrBlockedPlayer) blockingReasons.push("팀 MMR 제외 선수가 있음");
  if (!isTeamRecord && getMatchRecordType(match) === RECORD_TYPES.matchRecord) blockingReasons.push("팀 MMR 대상 아님");

  const recordRoomConfirmed = !isMatchRecordMatch(match) || sideApprovalsComplete;
  const recordRosterConfirmed = !isMatchRecordMatch(match) || !isTeamRecord || teamRosterConfirmed;
  const canVerify = !isPersonalRecordMatch(match) && hasResult && !disputed && recordRoomConfirmed;
  return {
    recordType,
    roomKind: getRoomKindFromMatch(match),
    canSave: true,
    canConfirm: isMatchRecordMatch(match) && hasResult,
    canVerify,
    canApplyPersonalMmr: canVerify && ranked && recordRosterConfirmed && mmrEligiblePlayerIds.length > 0,
    canApplyTeamMmr: canVerify && ranked && recordRosterConfirmed && isTeamRecord && !hasMmrBlockedPlayer,
    isTeamRecord,
    teamRosterConfirmed,
    mmrEligiblePlayerIds,
    blockingReasons,
  };
}

export function getMatchPlayerDisputePoints(match = {}, playerId = "") {
  if (!playerId) return 0;
  return Number(match.result?.playerStats?.[playerId]?.points ?? 0);
}

export function buildMatchDisputeRequest({ match = {}, playerId = "", playerName = "", requestedPoints = "", reason = "", customReason = "" } = {}) {
  const scoreA = getMatchDisputeScore(match, "teamA");
  const scoreB = getMatchDisputeScore(match, "teamB");
  const currentPoints = getMatchPlayerDisputePoints(match, playerId);
  const nextPoints = Number(requestedPoints);
  const pointText = playerId && Number.isFinite(nextPoints)
    ? `${playerName || "본인"} 득점 ${currentPoints}->${Math.max(0, nextPoints)}`
    : "본인 득점 확인 요청";
  const reasonText = reason === OTHER_MATCH_DISPUTE_REASON
    ? String(customReason || OTHER_MATCH_DISPUTE_REASON).trim()
    : String(reason || MATCH_DISPUTE_REASON_OPTIONS[0]).trim();
  return {
    reason: `점수판 ${scoreA}:${scoreB} / ${pointText} / 사유: ${reasonText}`,
    playerId,
    requestedPoints: playerId && Number.isFinite(nextPoints) ? Math.min(999, Math.max(0, nextPoints)) : null,
  };
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
  const source = match.scheduledDate ?? match.scheduledAt ?? match.confirmedAt ?? match.createdAt ?? "";
  return isDateWithinPastMonths(source, months, now);
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
  return getDecisionStatus(match, teams, sideName, "approvals");
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
    ...Object.values(normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders)),
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

export function withEffectiveMatchStatRecorders(match = {}) {
  if (!match || match.refereeId) return match;
  const currentRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const nextRecorders = getEffectiveStatRecorders(match);
  if (currentRecorders.teamA === nextRecorders.teamA && currentRecorders.teamB === nextRecorders.teamB) return match;
  return {
    ...match,
    statRecorders: nextRecorders,
    rules: {
      ...(match.rules ?? {}),
      statRecorders: nextRecorders,
    },
  };
}

export function getRecorderHandoffPatch(match, sideName, currentRecorderId, nextRecorderId) {
  const side = match[sideName] ?? {};
  const sidePlayers = side.players ?? [];
  const reserveIds = getMatchReservePlayerIds(match, sideName);
  const currentIsPlayer = sidePlayers.includes(currentRecorderId);
  const currentIsReserve = reserveIds.includes(currentRecorderId);
  const nextIsPlayer = sidePlayers.includes(nextRecorderId);
  const nextIsReserve = reserveIds.includes(nextRecorderId);
  if (!nextIsPlayer && !nextIsReserve) return { valid: false, match, swapped: false };

  const recordWindow = getMatchRecordWindow(match);
  const shouldSwap = recordWindow.beforeEnd && (
    (currentIsReserve && nextIsPlayer) ||
    (currentIsPlayer && nextIsReserve)
  );
  if (!shouldSwap) return { valid: true, match, swapped: false };

  const activeInId = currentIsReserve ? currentRecorderId : nextRecorderId;
  const benchedId = currentIsReserve ? nextRecorderId : currentRecorderId;
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
  const statRecorders = getEffectiveStatRecorders(match);
  return uniquePlayerIds([
    ...getMatchPlayerIds(match),
    ...getMatchReservePlayerIds(match, "teamA"),
    ...getMatchReservePlayerIds(match, "teamB"),
    getMatchHostPlayerId(match),
    match.refereeId,
    ...Object.values(statRecorders),
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
    ...Object.values(getEffectiveStatRecorders(match)),
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
  return {
    teamA: recorders.teamA ?? "",
    teamB: recorders.teamB ?? "",
  };
}

export function getEffectiveStatRecorders(match = {}) {
  if (match.refereeId) return { teamA: "", teamB: "" };
  const recorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  const getRecorder = (sideName) => {
    const currentRecorderId = recorders[sideName];
    const reserveIds = getMatchReservePlayerIds(match, sideName);
    if (currentRecorderId && reserveIds.includes(currentRecorderId)) return currentRecorderId;
    if (reserveIds[0]) return reserveIds[0];
    const sideRosterIds = getMatchSideRecordPlayerIds(match, sideName, true);
    if (currentRecorderId && sideRosterIds.includes(currentRecorderId)) return currentRecorderId;
    return "";
  };

  return {
    teamA: getRecorder("teamA"),
    teamB: getRecorder("teamB"),
  };
}

export function getDesignatedScoreRecorderId(match = {}) {
  if (match.refereeId) return "";
  const designatedSide = match.rules?.dualScoreRecorderSide ?? match.dualScoreRecorderSide ?? match.dual_score_recorder_side;
  if (!MATCH_SIDES.includes(designatedSide)) return "";
  const recorders = getEffectiveStatRecorders(match);
  const oppositeSide = designatedSide === "teamA" ? "teamB" : "teamA";
  if (!recorders[designatedSide] || recorders[oppositeSide]) return "";
  return recorders[designatedSide];
}

export function getMatchScoreEditableSides(match = {}, userId = "", { canOperatePostStart = false, refereeEligible = true } = {}) {
  if (!userId) return [];
  if (match.refereeId) {
    return isMatchReferee(match, userId) && refereeEligible !== false ? MATCH_SIDES : [];
  }
  if (canOperatePostStart) return MATCH_SIDES;
  if (getDesignatedScoreRecorderId(match) === userId) return MATCH_SIDES;
  return getStatRecorderSides(match, userId);
}

export function hasMatchScoreboardOperators(match = {}) {
  if (match.refereeId) return true;
  return Boolean(getMatchHostPlayerId(match));
}

export function getStatRecorderSides(match = {}, userId) {
  if (!userId) return [];
  const recorders = getEffectiveStatRecorders(match);
  return MATCH_SIDES.filter((sideName) => recorders[sideName] === userId);
}

export function isMatchStatRecorder(match = {}, userId, sideName = null) {
  const recorderSides = getStatRecorderSides(match, userId);
  return sideName ? recorderSides.includes(sideName) : recorderSides.length > 0;
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
        : getDesignatedScoreRecorderId(match) === userId
          ? "score_recorder"
          : editableScoreSides.length
            ? "side_recorder"
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

export function calculatePlayerStatBoost(match = {}, playerId, actual = 0.5) {
  const stats = match.result?.playerStats?.[playerId] ?? match.playerStats?.[playerId];
  if (!stats) return 0;

  const source = match.result?.statSubmissions?.[playerId]?.source;
  const sourceFactor = source === "referee" ? 1 : source === "candidate_recorder" ? 0.72 : source === "player" ? 0.5 : 1;
  const raw = PLAYER_STAT_FIELDS.reduce((sum, field) => sum + Number(stats[field.id] ?? 0) * field.weight, 0);
  const capped = clamp(raw, -0.8, 2.2);
  const resultFactor = actual === 1 ? 1 : actual === 0 ? 0.55 : 0.75;
  return round(capped * resultFactor * sourceFactor);
}

export function formatStatLine(stats = {}) {
  const visible = PLAYER_STAT_FIELDS
    .filter((field) => Number(stats[field.id] ?? 0) > 0)
    .map((field) => `${field.shortLabel} ${Number(stats[field.id] ?? 0)}`);
  return visible.length ? visible.join(" · ") : "스탯 미입력";
}
