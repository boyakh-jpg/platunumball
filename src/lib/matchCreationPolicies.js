import { DEFAULT_BENCH_CAPACITY, MAX_BENCH_CAPACITY, RECORD_TYPES, getModeSize } from "./constants.js";
import { getDefaultMatchRules, getMatchRuleSummary } from "./matchRules.js";

export const MATCH_INTENT_OPTIONS = Object.freeze([
  {
    id: "friendly",
    label: "친선전",
    description: "MMR을 반영하지 않고 후보 출전을 보장합니다.",
  },
  {
    id: "standard_competitive",
    label: "경쟁전",
    description: "MMR을 반영하며 출전 정책은 따로 정합니다.",
  },
  {
    id: "pickup",
    label: "픽업",
    description: "개인으로 참가하고 현장에서 팀과 교대 순서를 정합니다.",
  },
]);

export const PLAYING_TIME_POLICY_OPTIONS = Object.freeze([
  { id: "appearance_guaranteed", label: "최소 1회 출전" },
  { id: "equal_rotation", label: "균등 순환" },
  { id: "none", label: "출전 보장 없음" },
]);

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
const PLAYING_TIME_POLICY_IDS = new Set(PLAYING_TIME_POLICY_OPTIONS.map((option) => option.id));
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
    benchCapacity: DEFAULT_BENCH_CAPACITY,
    waitlistCapacity: 3,
    playingTimePolicy: pickup ? "equal_rotation" : "appearance_guaranteed",
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : undefined,
    paymentPolicy: "equal_all_confirmed",
    benchPaymentAcknowledged: true,
    ranked: competitive,
    official: false,
    preRegistered: true,
    ...(pickup ? { hostJoinMode: "player", teamOnly: false, mmrLimitMode: "off" } : {}),
    ...getModeClockPreset(mode, "community"),
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
    : matchIntent === "friendly" && sourcePlayingTimePolicy === "none"
      ? "appearance_guaranteed"
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

export function getMatchCreationPolicyPayload(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const mode = String(policySource.mode || "5v5");
  const onCourtCount = getModeSize(mode, 5);
  const benchCapacity = clampInteger(policySource.benchCapacity, DEFAULT_BENCH_CAPACITY, 0, MAX_BENCH_CAPACITY);
  const matchIntent = MATCH_INTENT_IDS.has(policySource.matchIntent) ? policySource.matchIntent : "standard_competitive";
  const pickup = matchIntent === "pickup";
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

  return {
    matchIntent,
    onCourtCount,
    starterCount: onCourtCount,
    benchCapacity,
    teamCapacity: onCourtCount + benchCapacity,
    waitlistCapacity: clampInteger(policySource.waitlistCapacity, 3, 0, 10),
    playingTimePolicy,
    lineupSelectionPolicy: pickup ? "no_fixed_starter" : policySource.hostJoinMode === "team" ? "team_captain_assigns" : "automatic",
    hostJoinMode: pickup ? "player" : policySource.hostJoinMode === "team" ? "team" : "player",
    teamOnly: pickup ? false : policySource.hostJoinMode === "team" || policySource.teamOnly === true,
    ranked: pickup ? false : policySource.ranked !== false,
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
  if (policy.matchIntent === "pickup") {
    if (policy.hostJoinMode !== "player" || policy.teamOnly === true) {
      errors.push("픽업은 개인 참가 방식으로만 만들 수 있습니다.");
    }
    if (policy.ranked !== false || policy.official !== false) {
      errors.push("픽업은 MMR을 반영하지 않습니다.");
    }
    warnings.push("자동 로테이션은 지원하지 않습니다. 방장이 현장에서 팀과 교대 순서를 수동으로 정합니다.");
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

export function getMatchCreationSummary(source = {}) {
  const policySource = getMatchCreationPolicySource(source);
  const policy = getMatchCreationPolicyPayload(policySource);
  const intent = MATCH_INTENT_OPTIONS.find((option) => option.id === policy.matchIntent) ?? MATCH_INTENT_OPTIONS[1];
  const playingTime = PLAYING_TIME_POLICY_OPTIONS.find((option) => option.id === policy.playingTimePolicy)?.label ?? "출전 보장 없음";
  const payment = PAYMENT_POLICY_OPTIONS.find((option) => option.id === policy.paymentPolicy)?.label ?? "확정 인원 전원 균등";
  const pickup = policy.matchIntent === "pickup";
  const rosterText = pickup
    ? `개인 참가 · 코트 ${policy.onCourtCount}명씩${policy.benchCapacity > 0 ? ` · 순환 대기 최대 ${policy.benchCapacity}명씩` : ""}`
    : policy.benchCapacity > 0
    ? `사이드당 선발 ${policy.onCourtCount}명과 후보 ${policy.benchCapacity}명`
    : `사이드당 출전 ${policy.onCourtCount}명`;
  const costText = policy.totalCost > 0
    ? `총 ${formatCurrency(policy.totalCost)}${policy.estimatedFeePerPlayer > 0 ? ` · 1인 예상 ${formatCurrency(policy.estimatedFeePerPlayer)}` : ""}`
    : "참가비 없음";
  return {
    policy,
    rows: [
      { label: "경기 성격", value: intent.label },
      { label: "명단", value: `${policySource.mode || "5v5"} · ${rosterText}` },
      ...(pickup ? [{ label: "운영 정책", value: "고정 선발·후보 없음 · 방장 수동 순환" }] : policy.benchCapacity > 0 ? [{ label: "출전 정책", value: playingTime }] : []),
      { label: "경기 규칙", value: getMatchRuleSummary(policySource, policySource.mode) },
      { label: "비용", value: `${costText} · ${payment}` },
      { label: "구장", value: policySource.court || "구장 미정" },
      { label: "일정", value: policySource.timingType === "instant" ? "즉시" : [policySource.scheduledDate, policySource.scheduledTime].filter(Boolean).join(" ") || "일정 미정" },
    ],
    sentence: pickup
      ? "개인 참가자를 받아 현장에서 팀을 나눕니다. 방장이 교대 순서를 수동으로 운영하며 MMR은 반영되지 않습니다."
      : policy.benchCapacity > 0
      ? `${rosterText}입니다. 후보의 출전 정책은 '${playingTime}', 비용 정책은 '${payment}'입니다.`
      : `${rosterText}이며 비용 정책은 '${payment}'입니다.`,
  };
}
