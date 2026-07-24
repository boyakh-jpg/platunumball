import { DEFAULT_BENCH_CAPACITY, MAX_BENCH_CAPACITY, RECORD_TYPES, getModeSize } from "./constants.js";
import { getDefaultMatchRules, getMatchRuleSummary, getMatchRulesPayload } from "./matchRules.js";

export const MATCH_INTENT_OPTIONS = Object.freeze([
  {
    id: "friendly",
    label: "친선전",
    description: "MMR을 반영하지 않습니다.",
  },
  {
    id: "standard_competitive",
    label: "경쟁전",
    description: "MMR을 반영합니다.",
  },
  {
    id: "pickup",
    label: "픽업",
    description: "개인으로 참가하고 현장에서 팀과 교대 순서를 정합니다.",
  },
]);

export const MATCH_PURPOSE_OPTIONS = Object.freeze([
  { id: "friendly", label: "친선전", description: "MMR을 반영하지 않습니다." },
  { id: "competitive", label: "경쟁전", description: "MMR을 반영합니다." },
]);

export const MATCH_FORMATION_OPTIONS = Object.freeze([
  {
    id: "prearranged",
    label: "경기 전 구성",
    description: "경기 전에 A/B사이드와 출전·후보를 정합니다.",
  },
  {
    id: "pickup",
    label: "현장 픽업",
    description: "개인으로 참가해 현장에서 팀과 교대 순서를 정합니다.",
  },
]);

export const PLAYING_TIME_POLICY_OPTIONS = Object.freeze([
  { id: "appearance_guaranteed", label: "최소 1회 출전" },
  { id: "equal_rotation", label: "균등 순환" },
  { id: "none", label: "출전 보장 없음" },
]);

export const PICKUP_ROTATION_MODE_OPTIONS = Object.freeze([
  { id: "period", label: "쿼터·하프 종료마다" },
  { id: "interval", label: "시간 간격으로" },
  { id: "manual", label: "직접 교대" },
]);

export const PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS = Object.freeze([
  {
    id: "manual",
    label: "현장 직접 배치",
    description: "체크인한 참가자를 방장 또는 심판이 직접 나눕니다.",
  },
  {
    id: "random",
    label: "완전 랜덤 배치",
    description: "체크인한 참가자를 무작위로 나눈 뒤 방장 또는 심판이 확정합니다.",
  },
  {
    id: "mmr_balanced",
    label: "MMR 균형 배치",
    description: "체크인한 참가자의 MMR 합이 비슷하도록 나눈 뒤 방장 또는 심판이 확정합니다.",
  },
]);

export const PICKUP_TEAM_ASSIGNMENT_RATING_SCALES = Object.freeze({
  manual: 0.9,
  random: 1,
  mmr_balanced: 1.1,
});

export const PAYMENT_POLICY_OPTIONS = Object.freeze([
  { id: "equal_all_confirmed", label: "확정 인원 전원 균등" },
  { id: "team_fixed_share", label: "팀별 균등" },
  { id: "host_pays", label: "방장 부담" },
  { id: "free", label: "참가비 없음" },
]);

export const VENUE_PAYMENT_TYPE_OPTIONS = Object.freeze([
  { id: "free_public", label: "무료 공공구장" },
  { id: "first_come_public", label: "무료·현장 선점" },
  { id: "paid_reserved", label: "유료·예약 완료" },
  { id: "paid_not_reserved", label: "유료·예약 전" },
  { id: "private", label: "사설·별도 협의" },
]);

export const VENUE_SECURED_OPTIONS = Object.freeze([
  { id: "confirmed", label: "확보 완료" },
  { id: "first_come", label: "현장 선점" },
  { id: "unconfirmed", label: "미확정" },
]);

export const RECORD_ENTRY_MODE_OPTIONS = Object.freeze([
  {
    id: "quick",
    label: "빠른 기록",
    description: "상대 정보 없이 날짜·방식·점수와 내 활약만 남깁니다.",
  },
  {
    id: "named",
    label: "이름 기록",
    description: "선수 이름을 자유롭게 적고 승인 없이 내 기록으로 저장합니다.",
  },
]);

export const RECORD_COMPOSITION_OPTIONS = Object.freeze([
  {
    id: "individual",
    label: "개인 구성",
    description: "A/B 선수를 계정으로 직접 채웁니다.",
  },
  {
    id: "team",
    label: "팀 구성",
    description: "등록된 두 팀의 팀장이 실제 출전 명단을 확인합니다.",
  },
]);

const RECORD_ENTRY_MODE_IDS = new Set(RECORD_ENTRY_MODE_OPTIONS.map((option) => option.id));
const RECORD_COMPOSITION_IDS = new Set(RECORD_COMPOSITION_OPTIONS.map((option) => option.id));

export function getRecordEntryMode(source = {}) {
  if (RECORD_ENTRY_MODE_IDS.has(source.recordEntryMode)) return source.recordEntryMode;
  return "quick";
}

export function getRecordComposition(source = {}) {
  if (RECORD_COMPOSITION_IDS.has(source.recordComposition)) return source.recordComposition;
  return source.hostJoinMode === "team" || source.teamOnly === true ? "team" : "individual";
}

export function getMatchCreationWizardType(source = {}, { recordIntent = false } = {}) {
  if (source.recordType === RECORD_TYPES.personalRecord) return "personal_record";
  if (source.recordType === RECORD_TYPES.matchRecord || recordIntent) return "match_record";
  if (source.visibility === "tournament") return "tournament";
  return "match";
}

const MATCH_INTENT_IDS = new Set(MATCH_INTENT_OPTIONS.map((option) => option.id));
const MATCH_PURPOSE_IDS = new Set(MATCH_PURPOSE_OPTIONS.map((option) => option.id));
const MATCH_FORMATION_IDS = new Set(MATCH_FORMATION_OPTIONS.map((option) => option.id));
const PLAYING_TIME_POLICY_IDS = new Set(PLAYING_TIME_POLICY_OPTIONS.map((option) => option.id));
const PICKUP_TEAM_ASSIGNMENT_MODE_IDS = new Set(PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS.map((option) => option.id));
const PAYMENT_POLICY_IDS = new Set(PAYMENT_POLICY_OPTIONS.map((option) => option.id));
const VENUE_PAYMENT_TYPE_IDS = new Set(VENUE_PAYMENT_TYPE_OPTIONS.map((option) => option.id));
const VENUE_SECURED_IDS = new Set(VENUE_SECURED_OPTIONS.map((option) => option.id));
const PERSONAL_RECORD_EXCLUDED_FIELDS = new Set([
  "matchIntent",
  "benchCapacity",
  "waitlistCapacity",
  "playingTimePolicy",
  "paymentPolicy",
  "benchPaymentAcknowledged",
  "lastPeriodStopMinutes",
  "venuePaymentType",
  "venueSecured",
  "venueFee",
  "refereeFee",
  "recordingFee",
  "equipmentFee",
  "otherFee",
  "costRoundUnit",
  "freeCancellationHours",
  "refundPolicy",
  "ballProvider",
  "vestsProvided",
  "scoreboardAvailable",
  "shotClockAvailable",
  "statRecorderAvailable",
  "courtReserved",
  "courtFee",
  "refereeWanted",
  "refereeId",
]);

function clampInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function normalizeMoney(value) {
  return clampInteger(value, 0, 0, 100_000_000);
}

export function getMatchCreationPolicySource(source = {}) {
  const rules = source?.rules && typeof source.rules === "object" ? source.rules : {};
  return { ...rules, ...source, rules };
}

export function getMatchPurpose(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  if (MATCH_PURPOSE_IDS.has(policySource.matchPurpose)) return policySource.matchPurpose;
  return policySource.matchIntent === "friendly" || policySource.matchIntent === "pickup" ? "friendly" : "competitive";
}

export function getMatchFormationMode(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  if (MATCH_FORMATION_IDS.has(policySource.formationMode)) return policySource.formationMode;
  return policySource.matchIntent === "pickup" ? "pickup" : "prearranged";
}

export function getLegacyMatchIntent(source = {}) {
  if (getMatchFormationMode(source) === "pickup") return "pickup";
  return getMatchPurpose(source) === "friendly" ? "friendly" : "standard_competitive";
}

export function getPickupTeamAssignmentMode(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  return PICKUP_TEAM_ASSIGNMENT_MODE_IDS.has(policySource.pickupTeamAssignmentMode)
    ? policySource.pickupTeamAssignmentMode
    : "manual";
}

export function getPickupTeamAssignmentModeOption(source = {}) {
  const mode = typeof source === "string" ? source : getPickupTeamAssignmentMode(source);
  return PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS.find((option) => option.id === mode)
    ?? PICKUP_TEAM_ASSIGNMENT_MODE_OPTIONS[0];
}

export function getPickupTeamAssignmentRatingScale(source = {}) {
  const mode = typeof source === "string" ? source : getPickupTeamAssignmentMode(source);
  return PICKUP_TEAM_ASSIGNMENT_RATING_SCALES[mode] ?? PICKUP_TEAM_ASSIGNMENT_RATING_SCALES.manual;
}

export function getModeClockPreset(mode = "5v5", presetId = "community") {
  const defaults = getDefaultMatchRules(mode);
  if (mode !== "5v5") {
    return {
      ...defaults,
      lastPeriodStopMinutes: 0,
    };
  }
  if (presetId === "official") {
    return {
      ...defaults,
      lastPeriodStopMinutes: 0,
    };
  }
  return {
    ...defaults,
    endCondition: "time",
    periodCount: 4,
    periodMinutes: 8,
    clockMode: "running",
    timeLimit: 32,
    winByTwo: false,
    lastPeriodStopMinutes: 2,
  };
}

export function getMatchClockPresetOptions(mode = "5v5") {
  if (mode !== "5v5") {
    return [{ id: "small_default", label: `${mode} 기본`, patch: getModeClockPreset(mode) }];
  }
  return [
    { id: "community", label: "러닝타임 8분×4", patch: getModeClockPreset(mode, "community") },
    { id: "official", label: "스톱타임 10분×4", patch: getModeClockPreset(mode, "official") },
  ];
}

export function getMatchIntentPresetPatch(intent = "standard_competitive", mode = "5v5") {
  const matchIntent = MATCH_INTENT_IDS.has(intent) ? intent : "standard_competitive";
  const pickup = matchIntent === "pickup";
  const competitive = matchIntent === "standard_competitive";
  return {
    matchIntent,
    matchPurpose: pickup || !competitive ? "friendly" : "competitive",
    formationMode: pickup ? "pickup" : "prearranged",
    benchCapacity: DEFAULT_BENCH_CAPACITY,
    waitlistCapacity: 3,
    playingTimePolicy: pickup ? "equal_rotation" : "appearance_guaranteed",
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : undefined,
    pickupTeamAssignmentMode: pickup ? "manual" : undefined,
    paymentPolicy: "equal_all_confirmed",
    benchPaymentAcknowledged: true,
    ranked: competitive,
    official: false,
    preRegistered: true,
    ...(pickup ? { hostJoinMode: "player", teamOnly: false, mmrLimitMode: "off" } : {}),
    ...getModeClockPreset(mode, "community"),
  };
}

export function getMatchConfigurationChangePatch(source = {}, change = {}) {
  const formationMode = MATCH_FORMATION_IDS.has(change.formationMode)
    ? change.formationMode
    : getMatchFormationMode(source);
  const requestedPurpose = MATCH_PURPOSE_IDS.has(change.matchPurpose)
    ? change.matchPurpose
    : getMatchPurpose(source);
  const matchPurpose = requestedPurpose;
  const matchIntent = formationMode === "pickup"
    ? "pickup"
    : matchPurpose === "friendly" ? "friendly" : "standard_competitive";
  return {
    ...getMatchIntentChangePatch(source, matchIntent),
    matchPurpose,
    formationMode,
    ranked: matchPurpose === "competitive",
  };
}

export function getMatchIntentChangePatch(source = {}, intent = "standard_competitive") {
  const matchIntent = MATCH_INTENT_IDS.has(intent) ? intent : "standard_competitive";
  const pickup = matchIntent === "pickup";
  const sourcePlayingTimePolicy = PLAYING_TIME_POLICY_IDS.has(source.playingTimePolicy)
    ? source.playingTimePolicy
    : "appearance_guaranteed";
  const playingTimePolicy = pickup
    ? "equal_rotation"
    : sourcePlayingTimePolicy;
  const benchCapacity = clampInteger(source.benchCapacity, DEFAULT_BENCH_CAPACITY, 0, MAX_BENCH_CAPACITY);
  const paymentPolicy = PAYMENT_POLICY_IDS.has(source.paymentPolicy) ? source.paymentPolicy : "equal_all_confirmed";
  const requiresAcknowledgement = benchCapacity > 0
    && paymentPolicy === "equal_all_confirmed"
    && playingTimePolicy === "none";

  return {
    matchIntent,
    playingTimePolicy,
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : undefined,
    ranked: matchIntent === "standard_competitive",
    official: false,
    preRegistered: true,
    benchPaymentAcknowledged: requiresAcknowledgement ? Boolean(source.benchPaymentAcknowledged) : true,
    ...(pickup ? { hostJoinMode: "player", teamOnly: false, mmrLimitMode: "off" } : {}),
  };
}

export function getMatchModeChangePatch(source = {}, mode = "5v5") {
  const nextMode = String(mode || "5v5");
  if (String(source.mode || "") === nextMode) return { mode: nextMode };
  const preset = getModeClockPreset(nextMode, "community");
  return {
    mode: nextMode,
    ...preset,
    attackRule: source.attackRule ?? preset.attackRule,
    foulRule: source.foulRule ?? preset.foulRule,
    ball: source.ball ?? preset.ball,
    meetingPoint: source.meetingPoint ?? preset.meetingPoint,
    meetBeforeMinutes: source.meetBeforeMinutes ?? preset.meetBeforeMinutes,
  };
}

export function getDefaultMatchCreationPolicy(mode = "5v5") {
  return {
    ...getMatchIntentPresetPatch("standard_competitive", mode),
    venuePaymentType: "free_public",
    venueSecured: "confirmed",
    venueFee: 0,
    refereeFee: 0,
    recordingFee: 0,
    equipmentFee: 0,
    otherFee: 0,
    costRoundUnit: 100,
    freeCancellationHours: 24,
    refundPolicy: "full_before_deadline",
    ballProvider: "host",
    vestsProvided: false,
    scoreboardAvailable: false,
    shotClockAvailable: false,
    statRecorderAvailable: false,
  };
}

export function getRoomRemakeDraft(source = {}) {
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

export function getMatchCreationPolicyPayload(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const mode = String(policySource.mode || "5v5");
  const onCourtCount = getModeSize(mode, 5);
  const benchCapacity = clampInteger(policySource.benchCapacity, DEFAULT_BENCH_CAPACITY, 0, MAX_BENCH_CAPACITY);
  const formationMode = getMatchFormationMode(policySource);
  const matchPurpose = getMatchPurpose(policySource);
  const matchIntent = getLegacyMatchIntent({ ...policySource, matchPurpose, formationMode });
  const pickup = formationMode === "pickup";
  const playingTimePolicy = pickup
    ? "equal_rotation"
    : PLAYING_TIME_POLICY_IDS.has(policySource.playingTimePolicy)
      ? policySource.playingTimePolicy
      : "appearance_guaranteed";
  const paymentPolicy = PAYMENT_POLICY_IDS.has(policySource.paymentPolicy) ? policySource.paymentPolicy : "equal_all_confirmed";
  const venuePaymentType = VENUE_PAYMENT_TYPE_IDS.has(policySource.venuePaymentType) ? policySource.venuePaymentType : "free_public";
  const venueSecured = VENUE_SECURED_IDS.has(policySource.venueSecured) ? policySource.venueSecured : "confirmed";
  const freeVenue = venuePaymentType === "free_public" || venuePaymentType === "first_come_public";
  const venueFee = freeVenue ? 0 : normalizeMoney(policySource.venueFee ?? policySource.courtFee);
  const refereeFee = normalizeMoney(policySource.refereeFee);
  const recordingFee = normalizeMoney(policySource.recordingFee);
  const equipmentFee = normalizeMoney(policySource.equipmentFee);
  const otherFee = normalizeMoney(policySource.otherFee);
  const totalCost = venueFee + refereeFee + recordingFee + equipmentFee + otherFee;
  const costRoundUnit = [100, 500].includes(Number(policySource.costRoundUnit)) ? Number(policySource.costRoundUnit) : 100;
  const confirmedCapacity = (onCourtCount + benchCapacity) * 2;
  const estimatedFeePerPlayer = paymentPolicy === "equal_all_confirmed" && totalCost > 0
    ? Math.ceil(totalCost / confirmedCapacity / costRoundUnit) * costRoundUnit
    : 0;
  const requiresBenchPaymentAcknowledgement = benchCapacity > 0
    && paymentPolicy === "equal_all_confirmed"
    && playingTimePolicy === "none";
  const periodCount = clampInteger(policySource.periodCount, 1, 1, 4);
  const requestedRotationMode = String(policySource.rotationMode ?? "");
  const rotationMode = pickup
    ? ["period", "interval", "manual"].includes(requestedRotationMode)
      ? requestedRotationMode
      : periodCount > 1 ? "period" : "interval"
    : undefined;
  const requestedRotationMinutes = clampInteger(policySource.rotationIntervalMinutes, 5, 3, 10);
  const rotationIntervalMinutes = [3, 5, 7, 10].includes(requestedRotationMinutes) ? requestedRotationMinutes : 5;
  const pickupTeamAssignmentMode = pickup ? getPickupTeamAssignmentMode(policySource) : undefined;

  return {
    matchIntent,
    matchPurpose,
    formationMode,
    onCourtCount,
    starterCount: onCourtCount,
    benchCapacity,
    teamCapacity: onCourtCount + benchCapacity,
    participantCapacity: pickup ? (onCourtCount + benchCapacity) * 2 : undefined,
    waitingPlayerCapacity: pickup ? benchCapacity * 2 : undefined,
    waitlistCapacity: clampInteger(policySource.waitlistCapacity, 3, 0, 10),
    playingTimePolicy,
    rotationMode,
    rotationIntervalMinutes: pickup && rotationMode === "interval" ? rotationIntervalMinutes : undefined,
    pickupTeamAssignmentMode,
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : policySource.hostJoinMode === "team" ? "team_captain_assigns" : "automatic",
    hostJoinMode: pickup ? "player" : policySource.hostJoinMode === "team" ? "team" : "player",
    teamOnly: pickup ? false : policySource.hostJoinMode === "team" || policySource.teamOnly === true,
    ranked: matchPurpose === "competitive" && policySource.ranked !== false,
    official: pickup ? false : Boolean(policySource.official),
    mmrLimitMode: pickup ? "off" : policySource.mmrLimitMode,
    paymentPolicy,
    benchPaymentAcknowledged: Boolean(policySource.benchPaymentAcknowledged),
    requiresBenchPaymentAcknowledgement,
    lastPeriodStopMinutes: policySource.clockMode === "running"
      ? clampInteger(policySource.lastPeriodStopMinutes, 0, 0, clampInteger(policySource.periodMinutes, 60, 1, 60))
      : 0,
    venuePaymentType,
    venueSecured,
    venueFee,
    refereeFee,
    recordingFee,
    equipmentFee,
    otherFee,
    totalCost,
    costRoundUnit,
    estimatedFeePerPlayer,
    freeCancellationHours: clampInteger(policySource.freeCancellationHours, 24, 0, 168),
    refundPolicy: ["full_before_deadline", "no_refund", "custom"].includes(policySource.refundPolicy)
      ? policySource.refundPolicy
      : "full_before_deadline",
    ballProvider: ["host", "venue", "participant", "unknown"].includes(policySource.ballProvider)
      ? policySource.ballProvider
      : "host",
    vestsProvided: Boolean(policySource.vestsProvided),
    scoreboardAvailable: Boolean(policySource.scoreboardAvailable),
    shotClockAvailable: Boolean(policySource.shotClockAvailable),
    statRecorderAvailable: Boolean(policySource.statRecorderAvailable),
  };
}

export function getScopedMatchCreationPolicyPayload(source = {}, scope = "match") {
  if (scope === "personal_record") return {};
  const policy = getMatchCreationPolicyPayload(source);
  if (scope === "match") return policy;
  const rosterPolicy = {
    onCourtCount: policy.onCourtCount,
    starterCount: policy.starterCount,
    benchCapacity: policy.benchCapacity,
    teamCapacity: policy.teamCapacity,
    waitlistCapacity: policy.waitlistCapacity,
    playingTimePolicy: policy.playingTimePolicy,
    lineupSelectionPolicy: policy.lineupSelectionPolicy,
    lastPeriodStopMinutes: policy.lastPeriodStopMinutes,
  };
  if (scope === "match_record") {
    return {
      onCourtCount: policy.onCourtCount,
      starterCount: policy.onCourtCount,
      benchCapacity: 0,
      teamCapacity: policy.onCourtCount,
      waitlistCapacity: 0,
    };
  }
  if (scope === "tournament") {
    return {
      ...rosterPolicy,
      ballProvider: policy.ballProvider,
      vestsProvided: policy.vestsProvided,
      scoreboardAvailable: policy.scoreboardAvailable,
      shotClockAvailable: policy.shotClockAvailable,
      statRecorderAvailable: policy.statRecorderAvailable,
    };
  }
  return rosterPolicy;
}

export function getPersonalRecordDraftPayload(source = {}) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !PERSONAL_RECORD_EXCLUDED_FIELDS.has(key)));
}

export function getMatchCreationValidation(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const policy = getMatchCreationPolicyPayload(policySource);
  const errors = [];
  const warnings = [];
  const paidVenue = policy.venuePaymentType === "paid_reserved" || policy.venuePaymentType === "paid_not_reserved";
  if (paidVenue && policy.venueFee <= 0) errors.push("유료구장은 대관료를 1원 이상 입력해야 합니다.");
  if (policy.requiresBenchPaymentAcknowledgement && !policy.benchPaymentAcknowledged) {
    errors.push("후보의 동일 결제와 출전 미보장 조건을 확인해야 합니다.");
  }
  if (policy.formationMode === "pickup") {
    if (policy.hostJoinMode !== "player" || policy.teamOnly === true) {
      errors.push("픽업은 개인 참가 방식으로만 만들 수 있습니다.");
    }
    if (policy.official !== false) {
      errors.push("픽업은 공식 경기로 만들 수 없습니다.");
    }
    warnings.push("체크인에서 방장 또는 배정 심판이 팀 배치와 교대 순서를 확정해야 시작할 수 있습니다.");
  }
  if (policy.venueSecured === "first_come") {
    warnings.push("현장 상황에 따라 경기가 취소되거나 다른 장소로 이동할 수 있습니다.");
  }
  if (policy.venueSecured === "unconfirmed" && policySource.ranked !== false) {
    warnings.push("경쟁전 구장이 아직 확보되지 않았습니다.");
  }
  return { policy, errors, warnings };
}

function formatCurrency(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}

const BALL_PROVIDER_LABELS = Object.freeze({
  host: "방장 제공",
  venue: "구장 제공",
  participant: "참가자 제공",
  unknown: "현장 협의",
});

export function getMatchOperationsSummaryRows(source = {}) {
  const policy = getMatchCreationPolicyPayload(source);
  const equipmentLabels = [
    policy.vestsProvided ? "조끼 제공" : "조끼 없음",
    policy.scoreboardAvailable ? "점수판 있음" : "점수판 없음",
    policy.shotClockAvailable ? "샷클락 있음" : "샷클락 없음",
    policy.statRecorderAvailable ? "기록원 있음" : "기록원 없음",
  ];
  return [
    { label: "공 제공", value: BALL_PROVIDER_LABELS[policy.ballProvider] ?? BALL_PROVIDER_LABELS.host },
    { label: "운영 장비", value: equipmentLabels.join(" · ") },
  ];
}

export function getMatchCreationSummary(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const policy = getMatchCreationPolicyPayload(policySource);
  const purpose = MATCH_PURPOSE_OPTIONS.find((option) => option.id === policy.matchPurpose) ?? MATCH_PURPOSE_OPTIONS[1];
  const playingTime = PLAYING_TIME_POLICY_OPTIONS.find((option) => option.id === policy.playingTimePolicy)?.label ?? "출전 보장 없음";
  const payment = PAYMENT_POLICY_OPTIONS.find((option) => option.id === policy.paymentPolicy)?.label ?? "확정 인원 전원 균등";
  const pickup = policy.formationMode === "pickup";
  const rosterText = pickup
    ? `개인 참가 · 출전 ${policy.onCourtCount * 2}명${policy.waitingPlayerCapacity > 0 ? ` · 통합 대기 ${policy.waitingPlayerCapacity}명` : ""}`
    : policy.benchCapacity > 0
    ? `사이드당 선발 ${policy.onCourtCount}명과 후보 ${policy.benchCapacity}명`
    : `사이드당 출전 ${policy.onCourtCount}명`;
  const costText = policy.totalCost > 0
    ? `총 ${formatCurrency(policy.totalCost)}${policy.estimatedFeePerPlayer > 0 ? ` · 1인 예상 ${formatCurrency(policy.estimatedFeePerPlayer)}` : ""}`
    : "참가비 없음";
  return {
    policy,
    rows: [
      { label: "경기 목적", value: purpose.label },
      { label: "팀 구성", value: pickup ? "현장 픽업" : "경기 전 구성" },
      { label: "명단", value: `${policySource.mode || "5v5"} · ${rosterText}` },
      ...(pickup ? [{ label: "팀 배치", value: "출석 후 현장 결정" }] : []),
      ...(pickup ? [{ label: "운영 정책", value: policy.rotationMode === "period" ? "쿼터·하프 종료마다 균등 교대" : policy.rotationMode === "interval" ? `${policy.rotationIntervalMinutes}분 간격 균등 교대` : "방장·심판 직접 교대" }] : policy.benchCapacity > 0 ? [{ label: "출전 정책", value: playingTime }] : []),
      { label: "경기 규칙", value: getMatchRuleSummary(policySource, policySource.mode) },
      ...getMatchOperationsSummaryRows(policy),
      { label: "비용", value: `${costText} · ${payment}` },
      { label: "구장", value: policySource.court || "구장 미정" },
      { label: "일정", value: policySource.timingType === "instant" ? "즉시" : [policySource.scheduledDate, policySource.scheduledTime].filter(Boolean).join(" ") || "일정 미정" },
    ],
    sentence: pickup
      ? `개인 참가자를 통합 풀로 모집하고 출석 후 현장에서 팀 배치 방식을 정합니다.${policy.ranked ? " 최종 방식에 따라 MMR 반영률이 달라집니다." : " 친선전은 MMR을 반영하지 않습니다."}`
      : policy.benchCapacity > 0
      ? `${rosterText}입니다. 후보의 출전 정책은 '${playingTime}', 비용 정책은 '${payment}'입니다.`
      : `${rosterText}이며 비용 정책은 '${payment}'입니다.`,
  };
}
