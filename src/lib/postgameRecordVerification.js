const MINUTE_MS = 60 * 1000;

export const POSTGAME_RECORD_AUTO_APPROVAL_MINUTES = 24 * 60;
export const POSTGAME_RECORD_REMINDER_MINUTES = Object.freeze([0, 12 * 60]);

function uniqueIds(values = []) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function collectIds(value) {
  if (!value) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectIds);
  if (typeof value !== "object") return [];
  if (value.playerId || value.userId) return [value.playerId ?? value.userId];
  return Object.values(value).flatMap(collectIds);
}

function getRecordSubmittedAt(match = {}) {
  return match.result?.submittedAt
    ?? match.recordSubmittedAt
    ?? match.result?.updatedAt
    ?? match.updatedAt
    ?? match.createdAt
    ?? null;
}

function getTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getSidePlayerIds(match = {}, sideName = "") {
  const played = match.playedPlayerIds?.[sideName] ?? match.rules?.playedPlayerIds?.[sideName];
  return uniqueIds(Array.isArray(played) && played.length ? played : match?.[sideName]?.players ?? []);
}

export function getPostgameRecordRequiredParticipantIds(match = {}) {
  const rosterIds = uniqueIds([
    ...getSidePlayerIds(match, "teamA"),
    ...getSidePlayerIds(match, "teamB"),
  ]);
  const fallbackApproverIds = uniqueIds(collectIds(match.rules?.recordApproverIds));
  const anonymousIds = new Set(Object.keys(match.anonymousPlayers ?? {}));
  return (rosterIds.length ? rosterIds : fallbackApproverIds)
    .filter((playerId) => !anonymousIds.has(playerId));
}

export function getPostgameRecordDecisionEligibility(match = {}, actorId = "") {
  const normalizedActorId = String(actorId ?? "").trim();
  const requiredParticipantIds = getPostgameRecordRequiredParticipantIds(match);
  if (!normalizedActorId) return { allowed: false, reason: "로그인 사용자 없음" };
  if (!requiredParticipantIds.includes(normalizedActorId)) {
    return { allowed: false, reason: "실제 참가자만 본인의 참가와 결과를 확인할 수 있음" };
  }
  if (["confirmed", "cancelled", "void", "voided"].includes(match.status)) {
    return { allowed: false, reason: "이미 종료된 기록" };
  }
  return { allowed: true, reason: "" };
}

export function getPostgameRecordVerification(match = {}, options = {}) {
  const nowMs = getTimestamp(options.now ?? new Date()) ?? Date.now();
  const submittedAt = getRecordSubmittedAt(match);
  const submittedAtMs = getTimestamp(submittedAt);
  const requiredParticipantIds = getPostgameRecordRequiredParticipantIds(match);
  const requiredIdSet = new Set(requiredParticipantIds);
  const anonymousPlayerIds = uniqueIds(Object.keys(match.anonymousPlayers ?? {}));

  const legacyParticipantAcceptedIds = uniqueIds([
    ...collectIds(match.participantAcceptedIds),
    ...collectIds(match.rules?.participantAcceptedIds),
    ...collectIds(match.rules?.participationAcceptedIds),
  ]).filter((playerId) => requiredIdSet.has(playerId));
  const resultApprovedIds = uniqueIds([
    ...collectIds(match.approvals),
    ...collectIds(match.recordApprovedIds),
    ...collectIds(match.rules?.recordApprovedIds),
  ]).filter((playerId) => requiredIdSet.has(playerId));
  const rejectedIds = uniqueIds([
    ...collectIds(match.participantRejectedIds),
    ...collectIds(match.recordRejectedIds),
    ...collectIds(match.rules?.participantRejectedIds),
    ...collectIds(match.rules?.recordRejectedIds),
    ...collectIds(match.rejections),
  ]).filter((playerId) => requiredIdSet.has(playerId));

  // 내 참가 확인은 본인 참가 사실과 결과를 함께 확인한다.
  // participantAcceptedIds는 기존 기록 호환을 위해 확인자까지 합쳐 반환한다.
  const participantAcceptedIds = uniqueIds([
    ...legacyParticipantAcceptedIds,
    ...resultApprovedIds,
  ]);
  const participantAcceptedSet = new Set(participantAcceptedIds);
  const resultApprovedSet = new Set(resultApprovedIds);
  const rejectedSet = new Set(rejectedIds);
  const verifiedPlayerIds = requiredParticipantIds.filter((playerId) => (
    resultApprovedSet.has(playerId)
    && !rejectedSet.has(playerId)
  ));
  const unconfirmedIds = requiredParticipantIds.filter((playerId) => !verifiedPlayerIds.includes(playerId) && !rejectedSet.has(playerId));
  const participationUnconfirmedIds = requiredParticipantIds.filter((playerId) => (
    !participantAcceptedSet.has(playerId) && !rejectedSet.has(playerId)
  ));
  const resultUnconfirmedIds = requiredParticipantIds.filter((playerId) => (
    participantAcceptedSet.has(playerId)
    && !resultApprovedSet.has(playerId)
    && !rejectedSet.has(playerId)
  ));
  const approvalWindowMinutes = POSTGAME_RECORD_AUTO_APPROVAL_MINUTES;
  const elapsedMs = submittedAtMs === null ? 0 : Math.max(0, nowMs - submittedAtMs);
  const deadlineAtMs = submittedAtMs === null
    ? null
    : submittedAtMs + approvalWindowMinutes * MINUTE_MS;
  const expired = deadlineAtMs !== null && nowMs >= deadlineAtMs;
  const openReportCount = Number(options.openReportCount ?? match.openReportCount ?? match.rules?.openReportCount ?? 0);
  const explicitlyDisputed = match.status === "disputed"
    || rejectedIds.length > 0
    || openReportCount > 0
    || (match.disputes ?? []).some((dispute) => dispute.status === "open");
  const confirmationThreshold = requiredParticipantIds.length
    ? Math.ceil(requiredParticipantIds.length * 2 / 3)
    : 0;
  const thresholdMet = confirmationThreshold > 0
    && verifiedPlayerIds.length >= confirmationThreshold;
  const autoApproved = expired && thresholdMet && !explicitlyDisputed;
  const finalVerifiedPlayerIds = verifiedPlayerIds;
  const finalUnconfirmedIds = unconfirmedIds;
  const verificationStatus = explicitlyDisputed
    ? "disputed"
    : autoApproved
      ? "confirmed"
      : "partial";

  return {
    verificationStatus,
    requiredParticipantIds,
    participantAcceptedIds,
    resultApprovedIds,
    approvedIds: finalVerifiedPlayerIds,
    unconfirmedIds: finalUnconfirmedIds,
    participationUnconfirmedIds,
    resultUnconfirmedIds,
    rejectedIds,
    anonymousPlayerIds,
    verifiedPlayerIds: finalVerifiedPlayerIds,
    playerStatEligibleIds: finalVerifiedPlayerIds,
    playerStatExcludedIds: uniqueIds([...finalUnconfirmedIds, ...rejectedIds, ...anonymousPlayerIds]),
    submittedAt,
    deadlineAt: deadlineAtMs === null ? null : new Date(deadlineAtMs).toISOString(),
    approvalWindowMinutes,
    confirmationThreshold,
    confirmedCount: verifiedPlayerIds.length,
    thresholdMet,
    elapsedMinutes: elapsedMs / MINUTE_MS,
    expired,
    timedOutUnconfirmedIds: [],
    requiresReview: explicitlyDisputed,
    canConfirmFully: verificationStatus === "confirmed",
    canAutoApprove: autoApproved,
    ranked: match.ranked !== false,
    mmrPolicy: "confirmed_participants_low",
    canApplyPersonalMmr: autoApproved && match.ranked !== false && verifiedPlayerIds.length > 0,
    canApplyTeamMmr: false,
  };
}

export function getDuePostgameRecordNotifications(match = {}, options = {}) {
  const verification = getPostgameRecordVerification(match, options);
  if (verification.verificationStatus === "confirmed" || verification.verificationStatus === "disputed") return [];
  if (!verification.submittedAt || verification.expired) return [];

  const sentKeys = new Set(uniqueIds([
    ...collectIds(match.recordNotificationSentKeys),
    ...collectIds(match.rules?.recordNotificationSentKeys),
    ...collectIds(options.sentKeys),
  ]));
  const targets = verification.unconfirmedIds;
  if (!targets.length) return [];

  return POSTGAME_RECORD_REMINDER_MINUTES
    .map((afterMinutes) => ({
      key: `postgame_record_approval_${afterMinutes}m`,
      afterMinutes,
      dueAt: new Date(new Date(verification.submittedAt).getTime() + afterMinutes * MINUTE_MS).toISOString(),
      targetUserIds: targets,
      type: afterMinutes === 0 ? "postgame_record_approval_requested" : "postgame_record_approval_reminder",
    }))
    .filter((event) => verification.elapsedMinutes >= event.afterMinutes && !sentKeys.has(event.key));
}
