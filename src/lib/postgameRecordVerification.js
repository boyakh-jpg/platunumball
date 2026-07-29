const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

export const POSTGAME_RECORD_AUTO_FINALIZE_HOURS = 24;
export const POSTGAME_RECORD_AUTO_APPROVAL_MINUTES = POSTGAME_RECORD_AUTO_FINALIZE_HOURS * 60;
export const POSTGAME_RECORD_REMINDER_MINUTES = Object.freeze([0, 60, 12 * 60]);
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

function getRecordConfirmationOpenedAt(match = {}) {
  return match.result?.submittedAt
    ?? match.rules?.recordResultSubmittedAt
    ?? getRecordSubmittedAt(match);
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

export function getPostgameRecordApprovalThreshold(participantCount = 0) {
  const count = Math.max(0, Math.floor(Number(participantCount) || 0));
  return count > 0 ? Math.ceil(count * 2 / 3) : 0;
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
  const confirmationOpenedAt = getRecordConfirmationOpenedAt(match);
  const confirmationOpenedAtMs = getTimestamp(confirmationOpenedAt);
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
  const elapsedMs = confirmationOpenedAtMs === null ? 0 : Math.max(0, nowMs - confirmationOpenedAtMs);
  const deadlineAtMs = confirmationOpenedAtMs === null
    ? null
    : confirmationOpenedAtMs + POSTGAME_RECORD_AUTO_FINALIZE_HOURS * HOUR_MS;
  const expired = deadlineAtMs !== null && nowMs >= deadlineAtMs;
  const explicitlyDisputed = match.status === "disputed" || rejectedIds.length > 0;
  const approvalThreshold = getPostgameRecordApprovalThreshold(requiredParticipantIds.length);
  const thresholdMet = approvalThreshold > 0 && verifiedPlayerIds.length >= approvalThreshold;
  const autoFinalizable = expired && thresholdMet && !explicitlyDisputed;
  const verificationStatus = explicitlyDisputed
    ? "disputed"
    : thresholdMet
      ? "confirmed"
      : expired
        ? "insufficient"
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
    playerStatEligibleIds: [],
    playerStatExcludedIds: uniqueIds([...requiredParticipantIds, ...rejectedIds, ...anonymousPlayerIds]),
    submittedAt,
    confirmationOpenedAt,
    deadlineAt: deadlineAtMs === null ? null : new Date(deadlineAtMs).toISOString(),
    approvalWindowMinutes,
    elapsedMinutes: elapsedMs / MINUTE_MS,
    expired,
    approvalThreshold,
    approvalCount: verifiedPlayerIds.length,
    thresholdMet,
    timedOutUnconfirmedIds: expired ? unconfirmedIds : [],
    requiresReview: explicitlyDisputed,
    canConfirmFully: thresholdMet && !explicitlyDisputed,
    canAutoApprove: false,
    canAutoFinalize: autoFinalizable,
    ranked: true,
    mmrPolicy: "verified_participants_partial",
    canApplyPersonalMmr: thresholdMet && !explicitlyDisputed,
    canApplyTeamMmr: false,
  };
}

export function getDuePostgameRecordNotifications(match = {}, options = {}) {
  const verification = getPostgameRecordVerification(match, options);
  if (verification.verificationStatus === "confirmed" || verification.verificationStatus === "disputed" || verification.expired) return [];
  if (!verification.submittedAt || verification.expired) return [];

  const sentKeys = new Set(uniqueIds([
    ...collectIds(match.recordNotificationSentKeys),
    ...collectIds(match.rules?.recordNotificationSentKeys),
    ...collectIds(options.sentKeys),
  ]));
  const targets = verification.unconfirmedIds;
  if (!targets.length) return [];
  const nowMs = getTimestamp(options.now ?? new Date()) ?? Date.now();
  const submittedAtMs = getTimestamp(verification.submittedAt);
  const reminderElapsedMinutes = submittedAtMs === null
    ? 0
    : Math.max(0, nowMs - submittedAtMs) / MINUTE_MS;

  return POSTGAME_RECORD_REMINDER_MINUTES
    .map((afterMinutes) => ({
      key: `postgame_record_approval_${afterMinutes}m`,
      afterMinutes,
      dueAt: new Date(new Date(verification.submittedAt).getTime() + afterMinutes * MINUTE_MS).toISOString(),
      targetUserIds: targets,
      type: afterMinutes === 0 ? "postgame_record_approval_requested" : "postgame_record_approval_reminder",
    }))
    .filter((event) => reminderElapsedMinutes >= event.afterMinutes && !sentKeys.has(event.key));
}
