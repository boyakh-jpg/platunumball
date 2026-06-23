import {
  DISPUTE_WINDOW_MINUTES,
  PLAYER_STAT_FIELDS,
  REFEREE_TRUST_MIN,
  STAT_ENTRY_WINDOW_MINUTES,
} from "./constants.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value) => Math.round(value * 10) / 10;
const uniquePlayerIds = (playerIds = []) => [...new Set(playerIds.filter(Boolean))];
export const PUBLIC_ROOM_SCHEDULE_MAX_DAYS = 5;
export const PUBLIC_ROOM_CONFIRM_OPEN_HOURS = 24;
export const PUBLIC_ROOM_CONFIRM_CLOSE_HOURS = 4;
export const INSTANT_ROOM_EXPIRE_MINUTES = 60;

function addDateDays(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function getRoomTimingType(room = {}) {
  const value = room.timingType ?? room.rules?.timingType ?? room.roomState?.timingType;
  return value === "instant" || room.scheduledAt === "즉시" ? "instant" : "scheduled";
}

export function isInstantRoom(room = {}) {
  return getRoomTimingType(room) === "instant";
}

export function getLocalDateInputValue(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function getPublicRoomMaxDateInput(now = new Date()) {
  return addDateDays(getLocalDateInputValue(now), PUBLIC_ROOM_SCHEDULE_MAX_DAYS);
}

export function getSideMajority(side = {}) {
  const total = side.players?.length ?? 0;
  return Math.floor(total / 2) + 1;
}

export function isCaptainApprovalRequired() {
  return false;
}

export function getTeamCaptainId(teams = [], teamId) {
  const team = teams.find((item) => item.id === teamId);
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

export function getSideCaptainId(match = {}, teams = [], sideName) {
  return getTeamCaptainId(teams, match[sideName]?.teamId);
}

function getDecisionStatus(match = {}, teams = [], sideName, decisionKey) {
  const side = match[sideName] ?? { players: [] };
  const approvals = match[decisionKey]?.[sideName] ?? [];
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

export function getMatchSidePlayerIds(match = {}, sideName) {
  const side = match[sideName] ?? {};
  const playedPlayerIds = match.playedPlayerIds ?? match.rules?.playedPlayerIds ?? {};
  return uniquePlayerIds([...(side.players ?? []), ...(playedPlayerIds[sideName] ?? [])]);
}

export function getMatchReservePlayerIds(match = {}, sideName) {
  const activeIds = new Set(match[sideName]?.players ?? []);
  const reserveIds = (match.parties ?? [])
    .filter((party) => party.side === sideName)
    .flatMap((party) => [
      ...(party.reserve ? party.players ?? [] : []),
      ...(party.reserves ?? []),
    ]);

  return [...new Set([...(match.reservePlayers?.[sideName] ?? []), ...reserveIds])]
    .filter((playerId) => playerId && !activeIds.has(playerId));
}

export function getMatchSideLeaderId(match = {}, teams = [], sideName) {
  const sidePlayerIds = getMatchSidePlayerIds(match, sideName);
  const sideReserveIds = getMatchReservePlayerIds(match, sideName);
  const sideRosterIds = uniquePlayerIds([...sidePlayerIds, ...sideReserveIds]);
  const partyLeaderId = (match.parties ?? [])
    .filter((party) => party.side === sideName)
    .map((party) => party.partyLeaderId ?? party.leaderId ?? party.playerId ?? party.players?.[0] ?? "")
    .find((playerId) => playerId && sideRosterIds.includes(playerId));
  if (partyLeaderId) return partyLeaderId;
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

export function getMatchRosterSideName(match = {}, playerId) {
  return getPlayerSideName(match, playerId)
    ?? (getMatchReservePlayerIds(match, "teamA").includes(playerId) ? "teamA" : null)
    ?? (getMatchReservePlayerIds(match, "teamB").includes(playerId) ? "teamB" : null);
}

export function getMatchHostPlayerId(match = {}) {
  return match.createdBy || match.hostPlayerId || match.createdPlayerId || match.playerId || match.teamA?.players?.[0] || "";
}

export function getMatchTrustFeedbackParticipantIds(match = {}) {
  const statRecorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
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
    ...Object.values(normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders)),
  ].filter(Boolean));
  return Math.max(1, Math.floor(activeCount / 2)) + (operationIds.size ? 1 : 0);
}

export function getMatchReferee(match = {}, users = []) {
  return users.find((user) => user.id === match.refereeId) ?? null;
}

export function isEligibleReferee(user = {}, minTrust = REFEREE_TRUST_MIN) {
  return Number(user?.trustScore ?? 0) >= Number(minTrust ?? REFEREE_TRUST_MIN);
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

export function getStatRecorderSides(match = {}, userId) {
  if (!userId) return [];
  const recorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  return ["teamA", "teamB"].filter((sideName) => recorders[sideName] === userId);
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

export function getMatchEndDate(match = {}) {
  if (match.endedAt) {
    const ended = new Date(match.endedAt);
    if (Number.isFinite(ended.getTime())) return ended;
  }
  const fallback = match.result?.submittedAt ?? match.confirmedAt;
  if (!fallback) return null;
  const parsed = new Date(fallback);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function getMatchScheduledDate(match = {}) {
  if (isInstantRoom(match)) return null;
  const source = match.scheduledDate
    ? `${match.scheduledDate}T${match.scheduledTime || "00:00"}`
    : String(match.scheduledAt ?? "").replace(" ", "T");
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function getPublicRoomTimingStatus(room = {}, now = new Date()) {
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const timingType = getRoomTimingType(room);
  if (timingType === "instant") {
    const createdAt = new Date(room.createdAt ?? nowDate);
    const expiresAt = new Date(createdAt.getTime() + INSTANT_ROOM_EXPIRE_MINUTES * 60000);
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
  const createLeadAllowed = scheduledMs > nowMs + PUBLIC_ROOM_CONFIRM_CLOSE_HOURS * 3600000;
  const confirmOpenMs = scheduledMs - PUBLIC_ROOM_CONFIRM_OPEN_HOURS * 3600000;
  const confirmCloseMs = scheduledMs - PUBLIC_ROOM_CONFIRM_CLOSE_HOURS * 3600000;
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

export const ROOM_PHASE_META = {
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
  return room.refereeId ? "심판 있음" : "심판 없음";
}

export function getMatchRoomPhase(match = {}, now = new Date()) {
  if (match.status === "cancelled") return ROOM_PHASE_META.cancelled;
  if (match.status === "void") return ROOM_PHASE_META.void;
  if (match.status === "confirmed") return ROOM_PHASE_META.record;
  if ((match.status === "approval" || match.status === "disputed") && getMatchRecordWindow(match, now).disputeExpired) {
    return ROOM_PHASE_META.record;
  }
  if (match.status === "approval" || match.status === "disputed") return ROOM_PHASE_META.dispute;
  if (match.endedAt || (match.status === "agreed" && match.result)) return ROOM_PHASE_META.postgame;
  if (getMatchStartDate(match)) return ROOM_PHASE_META.live;

  if (match.status === "agreed" || match.status === "contract") {
    if (isInstantRoom(match)) return ROOM_PHASE_META.checkin;
    const scheduledAt = getMatchScheduledDate(match);
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (scheduledAt && Number.isFinite(nowMs) && nowMs >= scheduledAt.getTime()) return ROOM_PHASE_META.checkin;
    return ROOM_PHASE_META.locked;
  }

  return ROOM_PHASE_META.waiting;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Number(minutes ?? 0) * 60000);
}

export function getMatchRecordWindow(match = {}, now = Date.now()) {
  const startAt = getMatchStartDate(match);
  const endAt = getMatchEndDate(match);
  const statEntryMinutes = Number(match.statEntryMinutes ?? STAT_ENTRY_WINDOW_MINUTES);
  const rawDisputeMinutes = Number(match.disputeMinutes ?? DISPUTE_WINDOW_MINUTES);
  const disputeMinutes = Number.isFinite(rawDisputeMinutes) && rawDisputeMinutes > 0
    ? Math.min(rawDisputeMinutes, DISPUTE_WINDOW_MINUTES)
    : DISPUTE_WINDOW_MINUTES;

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

export function getAllowedStatFields(match = {}, userId, playerId = userId) {
  if (isMatchReferee(match, userId)) return PLAYER_STAT_FIELDS;
  const playerSideName = getMatchRosterSideName(match, playerId);
  const recorders = normalizeStatRecorders(match.statRecorders ?? match.rules?.statRecorders);
  if (playerSideName && recorders[playerSideName]) {
    return recorders[playerSideName] === userId ? PLAYER_STAT_FIELDS : [];
  }
  if (playerId !== userId) return [];
  return PLAYER_STAT_FIELDS.filter((field) => field.id === "points");
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
