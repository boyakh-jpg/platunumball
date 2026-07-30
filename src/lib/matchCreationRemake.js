import { RECORD_TYPES } from "./constants.js";

const ROOM_REMAKE_ACCEPTED_STATUSES = new Set(["waiting", "ready", "accepted", "confirmed"]);

function getRoomRemakePlayerId(value) {
  if (typeof value === "string") return value.trim();
  return String(value?.id ?? value?.userId ?? value?.playerId ?? "").trim();
}

function getRoomRemakeInvitationGroups(source = {}, { pickup = false, teamRoom = false } = {}) {
  if (teamRoom) return [];
  if (Array.isArray(source.remakeInvitationGroups)) {
    return source.remakeInvitationGroups
      .map((group) => ({
        side: group.side === "teamA" ? "teamA" : "teamB",
        reserve: Boolean(group.reserve),
        playerIds: [...new Set((group.playerIds ?? []).map(getRoomRemakePlayerId).filter(Boolean))],
      }))
      .filter((group) => group.playerIds.length);
  }

  const hostId = getRoomRemakePlayerId(source.playerId ?? source.ownerId ?? source.createdBy ?? source.created_by);
  const refereeId = getRoomRemakePlayerId(source.refereeId ?? source.referee_id);
  const excludedIds = new Set([hostId, refereeId].filter(Boolean));
  const seenIds = new Set(excludedIds);
  const groups = new Map();
  const addPlayers = (values, side = "teamB", reserve = false) => {
    const key = pickup ? "pickup" : `${side === "teamA" ? "teamA" : "teamB"}:${reserve ? "reserve" : "active"}`;
    const playerIds = groups.get(key)?.playerIds ?? [];
    for (const value of values ?? []) {
      const playerId = getRoomRemakePlayerId(value);
      if (!playerId || seenIds.has(playerId)) continue;
      seenIds.add(playerId);
      playerIds.push(playerId);
    }
    if (playerIds.length) {
      groups.set(key, {
        side: pickup ? "teamB" : (side === "teamA" ? "teamA" : "teamB"),
        reserve: pickup ? false : Boolean(reserve),
        playerIds,
      });
    }
  };

  addPlayers(source.teamA?.players ?? source.playerIds, "teamA", false);
  addPlayers(source.teamB?.players ?? source.opponentPlayerIds, "teamB", false);
  addPlayers(source.reservePlayers?.teamA ?? source.reservePlayerIds, "teamA", true);
  addPlayers(source.reservePlayers?.teamB ?? source.opponentReservePlayerIds, "teamB", true);

  for (const applicant of source.applicants ?? []) {
    if (applicant?.role === "referee" || applicant?.joinMode === "referee") continue;
    const status = String(applicant?.status ?? "waiting").toLowerCase();
    if (!ROOM_REMAKE_ACCEPTED_STATUSES.has(status)) continue;
    addPlayers(
      Array.isArray(applicant?.playerIds) && applicant.playerIds.length
        ? applicant.playerIds
        : [applicant?.playerId],
      applicant?.side,
      applicant?.reserve,
    );
  }

  const pinnedReserves = source.roomState?.pinnedReservePlayers ?? {};
  addPlayers(pinnedReserves.teamA, "teamA", true);
  addPlayers(pinnedReserves.teamB, "teamB", true);
  return [...groups.values()];
}

export function buildRoomRemakeDraft(source = {}, dependencies = {}) {
  const { getMatchCreationPolicyPayload, getMatchRulesPayload } = dependencies;
  const sourceRules = source?.rules && typeof source.rules === "object" ? source.rules : {};
  const sourceRoomState = source?.roomState && typeof source.roomState === "object" ? source.roomState : {};
  const normalizedSource = {
    ...sourceRules,
    ...source,
    rules: sourceRules,
  };
  const explicitExpectedCount = Number(normalizedSource.remakeExpectedCount);
  const sourceSequence = Number(
    sourceRoomState.remakeSequence
      ?? sourceRules.remakeSequence
      ?? normalizedSource.remakeSequence
      ?? 0,
  );
  const remakeExpectedCount = Number.isInteger(explicitExpectedCount) && explicitExpectedCount > 0
    ? explicitExpectedCount
    : Math.max(1, Number.isInteger(sourceSequence) && sourceSequence > 0 ? sourceSequence + 1 : 1);
  const mode = String(normalizedSource.mode || "5v5");
  const policy = getMatchCreationPolicyPayload(normalizedSource);
  const rules = getMatchRulesPayload(normalizedSource, { mode });
  const visibility = normalizedSource.visibility === "public" ? "public" : "private";
  const pickup = policy.formationMode === "pickup";
  const teamRoom = !pickup && policy.hostJoinMode === "team";
  const teamAId = teamRoom
    ? normalizedSource.teamId ?? normalizedSource.teamAId ?? normalizedSource.teamA?.teamId
    : undefined;
  const teamBId = teamRoom && visibility === "private"
    ? normalizedSource.targetTeamId ?? normalizedSource.opponentTeamId ?? normalizedSource.teamBId ?? normalizedSource.teamB?.teamId
    : undefined;
  const remakeInvitationGroups = getRoomRemakeInvitationGroups(normalizedSource, { pickup, teamRoom });
  const remakeCancellationReason = String(
    normalizedSource.remakeCancellationReason
      ?? sourceRules.cancellationReason
      ?? sourceRoomState.cancellationReasonText
      ?? "",
  ).trim();
  const remakeInviteCount = teamRoom
    ? Number(Boolean(teamBId))
    : remakeInvitationGroups.reduce((sum, group) => sum + group.playerIds.length, 0);
  const memo = String(normalizedSource.memo ?? "")
    .split(/\r?\n/)
    .filter((line) => !/^(구장 예약|공개방|비공개방):/.test(line.trim()))
    .join("\n")
    .trim();

  return {
    recordType: RECORD_TYPES.match,
    visibility,
    timingType: normalizedSource.timingType === "instant" ? "instant" : "scheduled",
    scheduledDate: "",
    scheduledTime: "",
    title: String(normalizedSource.title || `${mode} 경기`).trim(),
    mode,
    ...rules,
    ...policy,
    courtId: normalizedSource.courtId ?? normalizedSource.court_id ?? "",
    court: String(normalizedSource.court ?? normalizedSource.courtName ?? "").trim(),
    teamAId,
    teamBId,
    playerIds: [],
    reservePlayerIds: [],
    opponentPlayerIds: [],
    opponentReservePlayerIds: [],
    opponentLeaderId: "",
    approvalModeA: normalizedSource.approvalModeA ?? "leader",
    approvalModeB: normalizedSource.approvalModeB ?? "leader",
    mmrRangeMode: normalizedSource.mmrRangeMode ?? "narrow",
    ageRestriction: normalizedSource.ageRestriction ?? "any",
    refereeWanted: Boolean(normalizedSource.refereeWanted || normalizedSource.refereeId),
    refereeId: "",
    preRegistered: normalizedSource.preRegistered !== false,
    objectionWindow: normalizedSource.objectionWindow ?? `${Number(normalizedSource.disputeMinutes) || 15}분`,
    evidence: [],
    memo,
    stakes: String(normalizedSource.stakes ?? ""),
    remakeExpectedCount,
    remakeCancellationReason,
    remakeInvitationGroups,
    remakeTeamAId: teamAId,
    remakeTeamBId: teamBId,
    remakeInviteCount,
    remakeReinvite: normalizedSource.remakeReinvite !== false && remakeInviteCount > 0,
  };
}

export function getRoomRemakeWarningCopy(count = 1) {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  if (safeCount >= 3) {
    return `같은 설정으로 방을 연속 ${safeCount}회 다시 만드는 단계입니다. 반복 취소·재생성은 운영 검토 후 신뢰도가 조정될 수 있습니다.`;
  }
  if (safeCount === 2) {
    return "같은 설정으로 방을 연속 2회 다시 만드는 단계입니다. 3회 이상 반복하면 운영 검토 후 신뢰도가 조정될 수 있습니다.";
  }
  return "같은 설정으로 다시 만들기를 반복하면 2회부터 경고가 표시되며, 3회 이상은 운영 검토 후 신뢰도가 조정될 수 있습니다.";
}
