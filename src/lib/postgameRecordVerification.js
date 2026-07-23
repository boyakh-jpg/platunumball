const HOUR_MS = 60 * 60 * 1000;

export const POSTGAME_RECORD_APPROVAL_WINDOW_HOURS = 24;
export const POSTGAME_RECORD_REMINDER_HOURS = Object.freeze([0, 12, 22]);

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

  // participantAcceptedIds is the canonical field. participationAcceptedIds is read for legacy rows only.
  const participantAcceptedIds = uniqueIds([
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

  const participantAcceptedSet = new Set(participantAcceptedIds);
  const resultApprovedSet = new Set(resultApprovedIds);
  const rejectedSet = new Set(rejectedIds);
  const verifiedPlayerIds = requiredParticipantIds.filter((playerId) => (
    participantAcceptedSet.has(playerId)
    && resultApprovedSet.has(playerId)
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
  const elapsedMs = submittedAtMs === null ? 0 : Math.max(0, nowMs - submittedAtMs);
  const deadlineAtMs = submittedAtMs === null
    ? null
    : submittedAtMs + POSTGAME_RECORD_APPROVAL_WINDOW_HOURS * HOUR_MS;
  const expired = deadlineAtMs !== null && nowMs >= deadlineAtMs;
  const explicitlyDisputed = match.status === "disputed" || rejectedIds.length > 0;
  const fullyApproved = requiredParticipantIds.length > 0
    && verifiedPlayerIds.length === requiredParticipantIds.length;
  const verificationStatus = explicitlyDisputed
    ? "disputed"
    : fullyApproved
      ? "confirmed"
      : "partial";

  return {
    verificationStatus,
    requiredParticipantIds,
    participantAcceptedIds,
    resultApprovedIds,
    approvedIds: verifiedPlayerIds,
    unconfirmedIds,
    participationUnconfirmedIds,
    resultUnconfirmedIds,
    rejectedIds,
    anonymousPlayerIds,
    verifiedPlayerIds,
    playerStatEligibleIds: verifiedPlayerIds,
    playerStatExcludedIds: uniqueIds([...unconfirmedIds, ...rejectedIds, ...anonymousPlayerIds]),
    submittedAt,
    deadlineAt: deadlineAtMs === null ? null : new Date(deadlineAtMs).toISOString(),
    elapsedHours: elapsedMs / HOUR_MS,
    expired,
    timedOutUnconfirmedIds: expired ? unconfirmedIds : [],
    requiresReview: expired && unconfirmedIds.length > 0,
    canConfirmFully: verificationStatus === "confirmed",
    canAutoApprove: false,
    ranked: false,
    mmrPolicy: "forbidden",
    canApplyPersonalMmr: false,
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

  return POSTGAME_RECORD_REMINDER_HOURS
    .map((afterHours) => ({
      key: `postgame_record_approval_${afterHours}h`,
      afterHours,
      dueAt: new Date(new Date(verification.submittedAt).getTime() + afterHours * HOUR_MS).toISOString(),
      targetUserIds: targets,
      type: afterHours === 0 ? "postgame_record_approval_requested" : "postgame_record_approval_reminder",
    }))
    .filter((event) => verification.elapsedHours >= event.afterHours && !sentKeys.has(event.key));
}
